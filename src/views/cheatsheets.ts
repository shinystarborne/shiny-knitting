import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, toBytes, type Cheatsheet, type Pattern } from "../api";
import { askChoice, askForm, askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** The one open, remembered after. */
function readOpen(): string {
  try {
    return localStorage.getItem("cheatsheets:open") ?? "";
  } catch {
    return "";
  }
}

export function keepOpen(id: string): void {
  try {
    localStorage.setItem("cheatsheets:open", id);
  } catch {
    // Remembered for this run only.
  }
}

/** How big pages are drawn, as a share of the pane's width. */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/**
 * The Cheatsheets tab: what is kept to look things up in, listed down the
 * side and open beside the list. A page online is shown in a frame where the
 * site allows it, and otherwise opens in a window of its own; pages of a PDF
 * are drawn from the book's own file, sharp at any size; an EPUB's chapter is
 * the copy kept of it.
 */
export class CheatsheetsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private sheets: Cheatsheet[] = [];
  private patterns: Pattern[] = [];
  private openId = readOpen();
  private zoom = 3;
  /** Drawing the pages of a PDF, so one started for another sheet stops. */
  private drawToken = 0;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library cheatsheets";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Cheatsheets</h1>
        <div class="lib-actions">
          <button class="ghost" data-act="add-pages" title="Pages of a PDF in the library: a table of cast-ons, a chart of increases">+ Pages from a book…</button>
          <button class="primary" data-act="add-web" title="A page online, or an embed code: kept to read here">+ Web page</button>
        </div>
      </header>
      <div class="lib-body">
        <aside class="filters sheet-list" data-el="list"></aside>
        <main class="sheet-view" data-el="view"></main>
      </div>`;
    this.screen.appendChild(this.root);
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => void this.onChange(e));
    [this.sheets, this.patterns] = await Promise.all([api.listCheatsheets().catch(() => [] as Cheatsheet[]), api.listPatterns({}).catch(() => [] as Pattern[])]);
    if (!this.sheets.some((s) => s.id === this.openId)) this.openId = this.sheets[0]?.id ?? "";
    this.paintList();
    await this.paintView();
  }

  destroy(): void {
    this.drawToken++;
    this.root?.remove();
  }

  private sheet(id = this.openId): Cheatsheet | undefined {
    return this.sheets.find((s) => s.id === id);
  }

  private book(s: Cheatsheet): Pattern | undefined {
    return this.patterns.find((p) => p.id === s.patternId);
  }

  /** Where it is from, in a line: the site, or the book and its pages. */
  private source(s: Cheatsheet): string {
    if (s.kind === "web") {
      try {
        return new URL(s.url).host.replace(/^www\./, "");
      } catch {
        return s.url;
      }
    }
    const book = this.book(s)?.title ?? "A book no longer in the library";
    if (s.kind === "chapter") return `${book}, chapter ${s.pageFrom}`;
    return `${book}, ${s.pageTo > s.pageFrom ? `pages ${s.pageFrom}–${s.pageTo}` : `page ${s.pageFrom}`}`;
  }

  // ---------- the list ----------

  private paintList(): void {
    const list = this.root.querySelector<HTMLElement>('[data-el="list"]')!;
    list.innerHTML = this.sheets.length
      ? this.sheets
          .map(
            (s) => `
          <button class="sheet-item${s.id === this.openId ? " on" : ""}" data-sheet="${esc(s.id)}" title="${esc(s.title)}">
            <span class="sheet-kind" aria-hidden="true">${s.kind === "web" ? "🌐" : "📖"}</span>
            <span class="sheet-text"><b>${esc(s.title)}</b><span>${esc(this.source(s))}</span></span>
          </button>`,
          )
          .join("")
      : `<p class="hint sheet-none">Nothing kept yet.</p>`;
  }

  // ---------- the one open ----------

  private async paintView(): Promise<void> {
    this.drawToken++;
    const view = this.root.querySelector<HTMLElement>('[data-el="view"]')!;
    const s = this.sheet();
    if (!s) {
      view.innerHTML = `
        <div class="empty">
          <h2>No cheatsheets yet</h2>
          <p>Keep what you look things up in while knitting: a web page (a tutorial, a table of yarn weights, a video), or pages from a book in the library.</p>
          <p class="hint">In a book you are reading, <b>Cheatsheet…</b> keeps the page you are on.</p>
        </div>`;
      return;
    }
    const at = this.sheets.indexOf(s);
    const web = s.kind === "web";
    const book = this.book(s);
    view.innerHTML = `
      <header class="sheet-head">
        <input class="sheet-title" data-f="title" value="${esc(s.title)}" aria-label="Its name" maxlength="200" />
        <span class="hint sheet-source">${esc(this.source(s))}</span>
        <span class="sheet-tools">
          ${
            web
              ? `<button class="ghost" data-act="window" title="In a window of its own, beside the app">Window ↗</button>
                 <button class="ghost" data-act="browser" title="In your web browser">Browser ↗</button>`
              : `${s.kind === "pages" ? `<button class="ghost icon-btn" data-act="zoom-out" title="Smaller" aria-label="Smaller">−</button><button class="ghost icon-btn" data-act="zoom-in" title="Bigger" aria-label="Bigger">+</button>` : ""}
                 ${book ? `<button class="ghost" data-act="open-book" title="Open the book at ${s.kind === "chapter" ? "this chapter" : "these pages"}">In the book ↗</button>` : ""}
                 ${s.kind === "pages" ? `<button class="ghost" data-act="pages" title="Which pages it shows">Pages…</button>` : ""}`
          }
          <button class="ghost icon-btn" data-act="up" title="Up the list" aria-label="Up the list" ${at === 0 ? "disabled" : ""}>↑</button>
          <button class="ghost icon-btn" data-act="down" title="Down the list" aria-label="Down the list" ${at === this.sheets.length - 1 ? "disabled" : ""}>↓</button>
          <button class="ghost danger-text" data-act="remove">Remove</button>
        </span>
      </header>
      <input class="sheet-note" data-f="notes" value="${esc(s.notes)}" placeholder="A note: what it is for, which size…" maxlength="4000" />
      <div class="sheet-body" data-el="body"></div>`;
    const body = view.querySelector<HTMLElement>('[data-el="body"]')!;
    if (web) return this.paintWeb(s, body);
    if (!book) {
      body.innerHTML = `<div class="empty"><h2>The book is gone</h2><p>The book these were kept from is no longer in the library: put it back from the Bin, or add it again, to read them.</p></div>`;
      return;
    }
    if (s.kind === "chapter") return this.paintChapter(s, body);
    await this.paintPages(s, book, body);
  }

  private paintWeb(s: Cheatsheet, body: HTMLElement): void {
    if (s.framable) {
      body.innerHTML = `<iframe class="sheet-frame" src="${esc(s.url)}" title="${esc(s.title)}" referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation" allow="fullscreen; encrypted-media; picture-in-picture"></iframe>
        <p class="hint sheet-frame-note">Blank, or refusing? Some sites will not be shown inside another app: <button class="link" data-act="not-framable">open it in a window of its own instead</button>.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="empty sheet-refused">
        <h2>${esc(this.source(s))} will not be shown inside another app</h2>
        <p>The site says so to every app, to keep its pages its own. It opens in a window of its own instead, beside this one, or in your browser.</p>
        <div class="sheet-refused-actions">
          <button class="primary" data-act="window">Open in a window of its own</button>
          <button class="ghost" data-act="browser">Open in your browser</button>
          <button class="link" data-act="framable" title="Show it in a frame here after all">Try here anyway</button>
        </div>
      </div>`;
  }

  private async paintChapter(s: Cheatsheet, body: HTMLElement): Promise<void> {
    const token = this.drawToken;
    let html: string;
    try {
      html = await api.readCheatsheetCopy(s.id);
    } catch (err) {
      body.innerHTML = `<p class="calc-wait">${esc(err instanceof Error ? err.message : String(err))}</p>`;
      return;
    }
    if (token !== this.drawToken) return;
    const frame = document.createElement("iframe");
    frame.className = "sheet-frame sheet-chapter";
    // As the reader shows a chapter: its own styles, no scripts, nothing reaching the app.
    frame.setAttribute("sandbox", "");
    frame.title = s.title;
    frame.srcdoc = html;
    body.replaceChildren(frame);
  }

  /** The pages, drawn from the book's file at the pane's width, as zoomed. */
  private async paintPages(s: Cheatsheet, book: Pattern, body: HTMLElement): Promise<void> {
    const token = this.drawToken;
    body.innerHTML = `<p class="calc-wait">Drawing the pages…</p>`;
    let doc: pdfjs.PDFDocumentProxy;
    try {
      doc = await pdfjs.getDocument({ data: toBytes(await api.readFile(book.id)) }).promise;
    } catch (err) {
      body.innerHTML = `<p class="calc-wait">${esc(`The book could not be read: ${err instanceof Error ? err.message : String(err)}`)}</p>`;
      return;
    }
    try {
      if (token !== this.drawToken) return;
      const pages = document.createElement("div");
      pages.className = "sheet-pages";
      body.replaceChildren(pages);
      const width = Math.max(320, body.clientWidth - 40) * ZOOMS[this.zoom];
      const last = Math.min(s.pageTo, doc.numPages);
      if (s.pageFrom > doc.numPages) {
        body.innerHTML = `<p class="calc-wait">The book has ${doc.numPages} pages: Pages… to choose others.</p>`;
        return;
      }
      for (let n = s.pageFrom; n <= last; n++) {
        const page = await doc.getPage(n);
        if (token !== this.drawToken) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement("canvas");
        canvas.className = "sheet-page";
        canvas.dataset.page = String(n);
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(width)}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        pages.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
        page.cleanup();
      }
    } finally {
      await doc.destroy().catch(() => {});
    }
  }

  // ---------- doing things ----------

  private async onClick(e: MouseEvent): Promise<void> {
    const item = closestEl(e.target, "[data-sheet]");
    if (item) {
      this.openId = item.dataset.sheet!;
      keepOpen(this.openId);
      this.paintList();
      return void (await this.paintView());
    }
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "add-web") return this.addWeb();
    if (act === "add-pages") return this.addPages();
    const s = this.sheet();
    if (!s) return;
    try {
      if (act === "window") await api.openCheatsheetWindow(s.id, s.url, s.title);
      if (act === "browser") await api.openLink(s.url);
      if (act === "not-framable" || act === "framable") {
        await this.save({ ...s, framable: act === "framable" });
        await this.paintView();
      }
      if (act === "zoom-in" || act === "zoom-out") {
        const next = Math.max(0, Math.min(ZOOMS.length - 1, this.zoom + (act === "zoom-in" ? 1 : -1)));
        if (next !== this.zoom) {
          this.zoom = next;
          await this.paintView();
        }
      }
      if (act === "open-book") this.root.dispatchEvent(new CustomEvent("open-pattern-at", { bubbles: true, detail: { id: s.patternId, page: s.pageFrom } }));
      if (act === "pages") await this.choosePages(s);
      if (act === "up" || act === "down") {
        const at = this.sheets.indexOf(s);
        this.sheets = await api.moveCheatsheet(s.id, at + (act === "up" ? -1 : 1));
        this.paintList();
        await this.paintView();
      }
      if (act === "remove") {
        if (!(await askYesNo(`Remove the cheatsheet “${s.title}”?${s.kind === "pages" ? " The book stays in the library." : ""}`, { title: "Remove cheatsheet", okLabel: "Remove", danger: true }))) return;
        await api.deleteCheatsheet(s.id);
        const at = this.sheets.indexOf(s);
        this.sheets = this.sheets.filter((x) => x.id !== s.id);
        this.openId = this.sheets[Math.min(at, this.sheets.length - 1)]?.id ?? "";
        keepOpen(this.openId);
        this.paintList();
        await this.paintView();
      }
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Cheatsheet");
    }
  }

  /** The name and the note, saved as they are changed. */
  private async onChange(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const f = el.dataset.f;
    const s = this.sheet();
    if (!s || (f !== "title" && f !== "notes")) return;
    const value = el.value.trim();
    if (f === "title" && !value) {
      el.value = s.title;
      return;
    }
    await this.save({ ...s, [f]: value });
    if (f === "title") this.paintList();
  }

  private async save(s: Cheatsheet): Promise<void> {
    const saved = await api.updateCheatsheet(s);
    this.sheets = this.sheets.map((x) => (x.id === saved.id ? saved : x));
  }

  private async added(s: Cheatsheet): Promise<void> {
    this.sheets = [s, ...this.sheets.filter((x) => x.id !== s.id)];
    this.openId = s.id;
    keepOpen(s.id);
    this.paintList();
    await this.paintView();
  }

  private async addWeb(): Promise<void> {
    const answer = await askForm(
      [
        { label: "Address, or embed code", placeholder: "https://… or <iframe …>" },
        { label: "Name", placeholder: "Optional: the page's own title is used" },
      ],
      { title: "A web page", okLabel: "Keep it" },
    );
    if (!answer) return;
    try {
      await this.added(await api.addCheatsheet({ kind: "web", url: answer["Address, or embed code"], title: answer.Name }));
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "A web page");
    }
  }

  /** Pages of a PDF: the book picked, books first, then the pages. */
  private async addPages(): Promise<void> {
    const pdfs = this.patterns.filter((p) => p.format === "pdf" && !p.fileMissing);
    if (!pdfs.length) return say("There is no PDF in the library to keep pages of. An EPUB's chapter is kept from the book itself: open it, and Cheatsheet….", "Pages from a book");
    const isBook = (p: Pattern) => p.tags.some((t) => t.toLowerCase() === "book");
    const sorted = [...pdfs].sort((a, b) => Number(isBook(b)) - Number(isBook(a)) || a.title.localeCompare(b.title));
    const id = await askChoice(
      "Which book, or pattern, are they in?",
      sorted.map((p) => ({ value: p.id, label: p.title, group: isBook(p) ? "Books" : "Patterns" })),
      { title: "Pages from a book" },
    );
    if (!id) return;
    const pattern = pdfs.find((p) => p.id === id)!;
    const pages = await askPages(pattern.title, 1, 1);
    if (!pages) return;
    try {
      await this.added(await api.addCheatsheet({ kind: "pages", patternId: id, pageFrom: pages.from, pageTo: pages.to, title: pages.title }));
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Pages from a book");
    }
  }

  private async choosePages(s: Cheatsheet): Promise<void> {
    const pages = await askPages(s.title, s.pageFrom, s.pageTo, false);
    if (!pages) return;
    await this.save({ ...s, pageFrom: pages.from, pageTo: pages.to });
    this.paintList();
    await this.paintView();
  }
}

/** Asks which pages, and a name when it is new; null when cancelled. */
export async function askPages(name: string, from: number, to: number, naming = true): Promise<{ from: number; to: number; title: string } | null> {
  for (;;) {
    const answer = await askForm(
      [
        { label: "From page", value: String(from), type: "number" },
        { label: "To page", value: String(to), type: "number" },
        ...(naming ? [{ label: "Name", placeholder: `Optional: “${name}, p. ${from}”` }] : []),
      ],
      { title: naming ? "Keep as a cheatsheet" : "Which pages", okLabel: naming ? "Keep it" : "Show them" },
    );
    if (!answer) return null;
    const a = Number(answer["From page"]);
    const b = Number(answer["To page"] || a);
    if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a) return { from: a, to: b, title: (answer.Name ?? "").trim() };
    await say("Give the pages as numbers, the first no later than the last: 12 to 13.", "Which pages");
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
