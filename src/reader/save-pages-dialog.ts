import * as pdfjs from "pdfjs-dist";
import { api, toBytes, type Pattern } from "../api";
import { customDialog } from "../dialogs";
import { closestEl } from "../dom";
import { formatRanges, parseRanges, pdfPages, epubPages } from "./save-pages";

/** What the dialog needs of the pattern on screen. */
export interface PagesSource {
  pageCount: number;
  currentPage(): number;
  /** An EPUB's chapters' names. */
  chapterTitles?: () => Promise<string[]>;
  /** An EPUB chapter's markup, self-contained, by its place (1-based). */
  chapterHtml?: (chapter: number) => string;
}

/** Thumbnails of a PDF's pages, drawn as they come into view: this wide, in CSS pixels. */
const THUMB_W = 96;

/**
 * Choosing pages of the pattern on screen (or chapters, for an EPUB) and
 * saving them as a PDF where the Save dialog says. Pages are typed ("1-3,
 * 7") or ticked on their thumbnails, the one being read to start with.
 */
export function savePagesDialog(pattern: Pattern, source: PagesSource): Promise<void> {
  const epub = pattern.format === "epub";
  const word = epub ? "chapter" : "page";
  const max = source.pageCount;
  return new Promise((resolve) => {
    let thumbDoc: pdfjs.PDFDocumentProxy | null = null;
    let observer: IntersectionObserver | null = null;
    const finish = () => {
      observer?.disconnect();
      void thumbDoc?.destroy();
      dialog.close();
      resolve();
    };
    const dialog = customDialog(epub ? "Save chapters as a PDF" : "Save pages as a PDF", finish, "save-pages-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <p class="dialog-hint">${
        epub
          ? "An EPUB has chapters rather than pages: each chapter chosen is laid out on A4 pages, as pictures of the pages, to print."
          : "The pages are copied as they are: sharp, and their words still selectable."
      }</p>
      <label class="dialog-field"><span class="dialog-label">${epub ? "Chapters" : "Pages"} <em>of ${max}</em></span>
        <input class="dialog-input" data-f="pages" value="${source.currentPage()}" placeholder="e.g. 1-3, 7" /></label>
      <div class="save-pages-quick">
        <button class="ghost" data-act="this">This ${word}</button>
        <button class="ghost" data-act="all">All</button>
        <button class="ghost" data-act="none">None</button>
        <span class="hint" data-el="count"></span>
      </div>
      <div class="save-pages-list${epub ? " chapters" : ""}" data-el="list"></div>
      <label class="dialog-field"><span class="dialog-label">File name</span>
        <input class="dialog-input" data-f="name" /></label>
      <p class="form-error" data-el="error" hidden></p>
      <p class="hint" data-el="status" hidden></p>
      <div class="dialog-actions">
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save as PDF…</button>
      </div>`,
    );
    const card = dialog.card;
    const pagesBox = card.querySelector<HTMLInputElement>('[data-f="pages"]')!;
    const nameBox = card.querySelector<HTMLInputElement>('[data-f="name"]')!;
    const list = card.querySelector<HTMLElement>('[data-el="list"]')!;
    const status = card.querySelector<HTMLElement>('[data-el="status"]')!;
    const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
    let nameTyped = false;

    const chosen = () => parseRanges(pagesBox.value, max);
    /** The ticks, the count and the suggested name, from the pages typed. */
    const sync = () => {
      const pages = chosen();
      for (const el of list.querySelectorAll<HTMLElement>("[data-page]")) el.classList.toggle("on", pages.includes(Number(el.dataset.page)));
      card.querySelector('[data-el="count"]')!.textContent = pages.length ? `${pages.length} ${word}${pages.length === 1 ? "" : "s"}` : `No ${word}s chosen`;
      if (!nameTyped) nameBox.value = `${pattern.title} — ${pages.length === 1 ? word : `${word}s`} ${formatRanges(pages)}`;
    };
    const set = (pages: number[]) => {
      pagesBox.value = formatRanges(pages).replace(/–/g, "-");
      sync();
    };

    // The pages to tick: a thumbnail each for a PDF, the chapters' names for an EPUB.
    if (epub) {
      void (source.chapterTitles?.() ?? Promise.resolve([] as string[])).then((titles) => {
        list.innerHTML = Array.from({ length: max }, (_, i) => `<button class="save-chapter" data-page="${i + 1}"><b>${i + 1}</b> ${esc(titles[i] ?? `Chapter ${i + 1}`)}</button>`).join("");
        sync();
      });
    } else {
      list.innerHTML = Array.from({ length: max }, (_, i) => `<button class="save-thumb" data-page="${i + 1}" title="Page ${i + 1}"><canvas></canvas><span>${i + 1}</span></button>`).join("");
      void api.readFile(pattern.id).then(async (raw) => {
        thumbDoc = await pdfjs.getDocument({ data: toBytes(raw).slice() }).promise;
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer!.unobserve(entry.target);
              void drawThumb(thumbDoc!, entry.target as HTMLElement);
            }
          },
          { root: list, rootMargin: "200px" },
        );
        for (const el of list.querySelectorAll("[data-page]")) observer.observe(el);
      });
      sync();
    }

    pagesBox.addEventListener("input", sync);
    nameBox.addEventListener("input", () => (nameTyped = true));
    card.addEventListener("click", async (e) => {
      const tile = closestEl(e.target, "[data-page]");
      if (tile) {
        const n = Number(tile.dataset.page);
        const pages = chosen();
        set(pages.includes(n) ? pages.filter((p) => p !== n) : [...pages, n].sort((a, b) => a - b));
        return;
      }
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "cancel") return finish();
      if (act === "this") return set([source.currentPage()]);
      if (act === "all") return set(Array.from({ length: max }, (_, i) => i + 1));
      if (act === "none") return set([]);
      if (act !== "save") return;
      const pages = chosen();
      error.hidden = true;
      if (!pages.length) {
        error.textContent = `Choose the ${word}s to save: tick them, or type them, as 1-3, 7.`;
        error.hidden = false;
        return;
      }
      const button = card.querySelector<HTMLButtonElement>('[data-act="save"]')!;
      button.disabled = true;
      status.hidden = false;
      status.textContent = epub ? "Laying the chapters out on pages…" : "Copying the pages…";
      try {
        const name = nameBox.value.trim() || pattern.title;
        const bytes = epub
          ? await epubPages(
              pages.map((p) => source.chapterHtml!(p)),
              name,
              (done, total) => (status.textContent = `Laying the chapters out on pages: ${done} of ${total}…`),
            )
          : await pdfPages(toBytes(await api.readFile(pattern.id)), pages, name);
        status.textContent = "Choose where to save it…";
        const path = await api.saveFile("pdf", name, bytes);
        if (path === null) {
          status.hidden = true;
          button.disabled = false;
          return;
        }
        status.textContent = `Saved to ${path}`;
        button.hidden = true;
        card.querySelector<HTMLButtonElement>('[data-act="cancel"]')!.textContent = "Done";
      } catch (err) {
        status.hidden = true;
        error.textContent = err instanceof Error ? err.message : String(err);
        error.hidden = false;
        button.disabled = false;
      }
    });
    dialog.show(pagesBox);
  });
}

/** A page's thumbnail, drawn small. */
async function drawThumb(doc: pdfjs.PDFDocumentProxy, tile: HTMLElement): Promise<void> {
  try {
    const page = await doc.getPage(Number(tile.dataset.page));
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (THUMB_W * 2) / base.width });
    const canvas = tile.querySelector("canvas")!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    tile.classList.add("drawn");
  } catch {
    // A page that cannot be drawn small is still chosen by its number.
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
