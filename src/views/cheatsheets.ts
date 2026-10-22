import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, isLive, toBytes, type Cheatsheet, type Pattern, type SheetRegion } from "../api";
import { askChoice, askForm, askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { showNotice } from "../notice";
import { AbbreviationsPanel, SymbolsPanel } from "./abbreviations";
import { symbolSvg } from "./stitches";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * The one to open, once: asked for from elsewhere -- a board's card, the
 * book being read -- the tab opens on it; otherwise on its cards.
 */
function readOpen(): string {
  try {
    const id = localStorage.getItem("cheatsheets:open") ?? "";
    localStorage.removeItem("cheatsheets:open");
    return id;
  } catch {
    return "";
  }
}

/** Opens the tab on this one, the next time it is shown. */
export function keepOpen(id: string): void {
  try {
    localStorage.setItem("cheatsheets:open", id);
  } catch {
    // Remembered for this run only.
  }
}

/** The glossaries' places in the list, where a sheet's id would be. */
const ABBREVIATIONS = "abbreviations";
const SYMBOLS = "symbols";

/** How big pages are drawn, as a share of the pane's width. */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/** A cheatsheet's card on a board, as it is put there. */
export const SHEET_CARD: [number, number] = [420, 540];

/** How small a box may be, in pixels on screen, before it counts as a slip. */
const MIN_BOX_PX = 12;

/**
 * The Cheatsheets tab: what is kept to look things up in, a card for each,
 * the glossaries first; a card clicked opens it on a page of its own, with
 * the way back to the cards. A page online is shown in a frame where the
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
  /** Drawing a box round the part of the page to keep: the whole page shown for it. */
  private cropping = false;
  private search = "";

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
          <input type="search" class="mc-search" data-f="search" placeholder="Search names, notes, books, sites…" aria-label="Search the cheatsheets" />
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
    this.root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.f !== "search") return;
      this.search = el.value;
      this.paintList();
    });
    [this.sheets, this.patterns] = await Promise.all([api.listCheatsheets().catch(() => [] as Cheatsheet[]), api.listPatterns({}).catch(() => [] as Pattern[])]);
    if (this.openId !== ABBREVIATIONS && this.openId !== SYMBOLS && !this.sheets.some((s) => s.id === this.openId)) this.openId = "";
    this.paintList();
    await this.paintView();
  }

  /** Opens one on its page, or none: the cards. */
  private async show(id: string): Promise<void> {
    this.cropping = false;
    this.openId = id;
    this.paintList();
    await this.paintView();
    this.root.querySelector(".lib-body")?.scrollTo?.({ top: 0 });
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
    if (s.region) return `${book}, part of page ${s.pageFrom}`;
    return `${book}, ${s.pageTo > s.pageFrom ? `pages ${s.pageFrom}–${s.pageTo}` : `page ${s.pageFrom}`}`;
  }

  // ---------- the list ----------

  /** Whether a text has every word searched for. */
  private matches(text: string): boolean {
    const words = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const said = text.toLowerCase();
    return words.every((w) => said.includes(w));
  }

  private paintList(): void {
    const list = this.root.querySelector<HTMLElement>('[data-el="list"]')!;
    // The glossary first, always there: it is the app's, not one kept.
    const abbreviations = this.matches("Abbreviations ssk, k2tog, w&t… and your own glossary")
      ? `<button class="sheet-item${this.openId === ABBREVIATIONS ? " on" : ""}" data-sheet="${ABBREVIATIONS}" title="What ssk, k2tog or w&amp;t means">
        <span class="sheet-kind" aria-hidden="true">🔤</span>
        <span class="sheet-text"><b>Abbreviations</b><span>ssk, k2tog, w&amp;t… and your own</span><em>A glossary, yours added to it</em></span>
      </button>`
      : "";
    const symbols = this.matches("Chart symbols yo, k2tog, ssk… as charts draw them glossary")
      ? `<button class="sheet-item${this.openId === SYMBOLS ? " on" : ""}" data-sheet="${SYMBOLS}" title="What each square of a chart means">
        <span class="sheet-kind" aria-hidden="true">${symbolSvg("k2tog", 30)}</span>
        <span class="sheet-text"><b>Chart symbols</b><span>yo, k2tog, ssk… as charts draw them</span><em>What each square of a chart means</em></span>
      </button>`
      : "";
    // Found by its name, its note, and where it is from: the book or the site.
    const shown = this.sheets.filter((s) => this.matches(`${s.title} ${s.notes} ${this.source(s)} ${s.kind === "web" ? s.url : ""}`));
    list.innerHTML = abbreviations + symbols + (shown.length
      ? shown
          .map(
            (s) => `
          <button class="sheet-item${s.id === this.openId ? " on" : ""}" data-sheet="${esc(s.id)}" title="${esc(s.title)}">
            <span class="sheet-kind" aria-hidden="true">${s.kind === "web" ? "🌐" : "📖"}</span>
            <span class="sheet-text"><b>${esc(s.title)}</b><span>${esc(this.source(s))}</span>${s.notes ? `<em>${esc(s.notes)}</em>` : ""}</span>
          </button>`,
          )
          .join("")
      : this.sheets.length
        ? `<p class="hint sheet-none">Nothing matches the search.</p>`
        : `<div class="empty sheet-none">
            <h2>No cheatsheets yet</h2>
            <p>Keep what you look things up in while knitting: a web page (a tutorial, a table of yarn weights, a video), or pages from a book in the library.</p>
            <p class="hint">In a book you are reading, <b>Cheatsheet…</b> keeps the page you are on.</p>
          </div>`);
    // The cards, or the one open on its page.
    this.root.classList.toggle("sheet-open", !!this.openId);
  }

  // ---------- the one open ----------

  private async paintView(): Promise<void> {
    this.drawToken++;
    const view = this.root.querySelector<HTMLElement>('[data-el="view"]')!;
    const back = `<button class="ghost sheet-back" data-act="back" title="All the cheatsheets">← Cheatsheets</button>`;
    if (this.openId === ABBREVIATIONS || this.openId === SYMBOLS) {
      view.innerHTML = `${back}<div class="sheet-panel"></div>`;
      const panel = view.querySelector<HTMLElement>(".sheet-panel")!;
      await (this.openId === ABBREVIATIONS ? new AbbreviationsPanel(panel) : new SymbolsPanel(panel)).mount();
      return;
    }
    const s = this.sheet();
    if (!s) {
      view.innerHTML = "";
      return;
    }
    const at = this.sheets.indexOf(s);
    const web = s.kind === "web";
    const book = this.book(s);
    view.innerHTML = `
      <header class="sheet-head">
        ${back}
        <input class="sheet-title" data-f="title" value="${esc(s.title)}" aria-label="Its name" maxlength="200" />
        <span class="hint sheet-source">${esc(this.source(s))}</span>
        <span class="sheet-tools">
          ${
            web
              ? `<button class="ghost" data-act="window" title="In a window of its own, beside the app">Window ↗</button>
                 <button class="ghost" data-act="browser" title="In your web browser">Browser ↗</button>`
              : `${s.kind === "pages" ? `<button class="ghost icon-btn" data-act="zoom-out" title="Smaller" aria-label="Smaller">−</button><button class="ghost icon-btn" data-act="zoom-in" title="Bigger" aria-label="Bigger">+</button>` : ""}
                 ${book ? `<button class="ghost" data-act="open-book" title="Open the book at ${s.kind === "chapter" ? "this chapter" : "these pages"}">In the book ↗</button>` : ""}
                 ${s.kind === "pages" ? `<button class="ghost" data-act="pages" title="Which pages it shows">Pages…</button>` : ""}
                 ${s.kind === "pages" && s.pageTo === s.pageFrom && !this.cropping ? `<button class="ghost" data-act="crop" title="Keep only part of the page: a box drawn round the table or chart">${s.region ? "Crop again…" : "Crop…"}</button>` : ""}
                 ${s.region && !this.cropping ? `<button class="ghost" data-act="whole" title="Show all of the page again">Whole page</button>` : ""}
                 ${this.cropping ? `<span class="hint sheet-crop-hint">Drag a box around the part to keep</span><button class="ghost" data-act="crop-cancel">Cancel</button>` : ""}`
          }
          <button class="ghost" data-act="to-board" title="Show it on a project's board, beside your pattern and yarn">To a project…</button>
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
      body.innerHTML = `${sheetFrameHtml(s)}
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

  /**
   * The pages, drawn from the book's file at the pane's width, as zoomed. A
   * part of a page is drawn as it is on the page at that size, and only it:
   * the page is shifted so the box lands at the canvas's corner.
   */
  private async paintPages(s: Cheatsheet, book: Pattern, body: HTMLElement): Promise<void> {
    const token = this.drawToken;
    body.innerHTML = `<p class="calc-wait">Drawing the pages…</p>`;
    const pages = document.createElement("div");
    pages.className = "sheet-pages";
    const width = Math.max(320, body.clientWidth - 40) * ZOOMS[this.zoom];
    const cropping = this.cropping;
    const failed = await drawSheetPages(
      s,
      book,
      width,
      cropping ? null : s.region,
      (canvas) => {
        if (!pages.isConnected) body.replaceChildren(pages);
        if (!cropping) return void pages.appendChild(canvas);
        const frame = document.createElement("div");
        frame.className = "sheet-crop";
        frame.appendChild(canvas);
        pages.appendChild(frame);
        this.cropOn(s, frame);
      },
      () => token === this.drawToken,
    );
    if (failed && token === this.drawToken) body.innerHTML = `<p class="calc-wait">${esc(failed)}</p>`;
  }

  // ---------- doing things ----------

  private async onClick(e: MouseEvent): Promise<void> {
    const item = closestEl(e.target, "[data-sheet]");
    if (item) return void (await this.show(item.dataset.sheet!));
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "back") return void (await this.show(""));
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
      if (act === "to-board") await this.toBoard(s);
      if (act === "crop" || act === "crop-cancel") {
        this.cropping = act === "crop";
        await this.paintView();
      }
      if (act === "whole") {
        await this.save({ ...s, region: null });
        this.paintList();
        await this.paintView();
      }
      if (act === "up" || act === "down") {
        const at = this.sheets.indexOf(s);
        this.sheets = await api.moveCheatsheet(s.id, at + (act === "up" ? -1 : 1));
        this.paintList();
        await this.paintView();
      }
      if (act === "remove") {
        if (!(await askYesNo(`Remove the cheatsheet “${s.title}”?${s.kind === "pages" ? " The book stays in the library." : ""}`, { title: "Remove cheatsheet", okLabel: "Remove", danger: true }))) return;
        await api.deleteCheatsheet(s.id);
        this.sheets = this.sheets.filter((x) => x.id !== s.id);
        // Back to the cards.
        await this.show("");
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
    // The new one shown in the list, whatever was searched for.
    this.search = "";
    const search = this.root.querySelector<HTMLInputElement>('[data-f="search"]');
    if (search) search.value = "";
    await this.show(s.id);
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

  /**
   * Draws a box on the page shown whole: the part kept, saved as soon as the
   * pointer lets go. A click, or a slip of the hand, is not a box.
   */
  private cropOn(s: Cheatsheet, frame: HTMLElement): void {
    const at = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
    };
    frame.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = at(e);
      const band = document.createElement("div");
      band.className = "pin-band";
      frame.appendChild(band);
      let box: SheetRegion = { x: start.x, y: start.y, w: 0, h: 0 };
      const move = (ev: PointerEvent) => {
        const here = at(ev);
        box = { x: Math.min(start.x, here.x), y: Math.min(start.y, here.y), w: Math.abs(here.x - start.x), h: Math.abs(here.y - start.y) };
        Object.assign(band.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
      };
      const stop = () => {
        frame.removeEventListener("pointermove", move);
        frame.removeEventListener("pointerup", up);
        frame.removeEventListener("pointercancel", stop);
        band.remove();
      };
      const up = () => {
        stop();
        const r = frame.getBoundingClientRect();
        if (box.w * r.width < MIN_BOX_PX || box.h * r.height < MIN_BOX_PX) return;
        void this.keepBox(s, box);
      };
      try {
        frame.setPointerCapture(e.pointerId);
      } catch {
        // It still draws while the pointer stays over the page.
      }
      frame.addEventListener("pointermove", move);
      frame.addEventListener("pointerup", up);
      frame.addEventListener("pointercancel", stop);
    });
  }

  private async keepBox(s: Cheatsheet, box: SheetRegion): Promise<void> {
    try {
      await this.save({ ...s, region: box });
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Cheatsheet");
    }
    this.cropping = false;
    this.paintList();
    await this.paintView();
  }

  /** On a project's board, under what is there, as the board shows it: the card says where. */
  private async toBoard(s: Cheatsheet): Promise<void> {
    const projects = (await api.listProjects().catch(() => [])).filter((p) => isLive(p.status));
    if (!projects.length) return say("There is no project on the needles or planned to put it on.", "To a project");
    const id = await askChoice(`Which project's board is “${s.title}” to go on?`, projects.map((p) => ({ value: p.id, label: p.name })), { title: "To a project" });
    if (!id) return;
    const items = await api.listBoardItems(id).catch(() => []);
    const y = items.reduce((low, i) => Math.max(low, i.y + i.h + 40), 40);
    await api.addBoardItem(id, { kind: "sheet", x: 40, y, w: SHEET_CARD[0], h: SHEET_CARD[1], data: { sheetId: s.id } });
    const name = projects.find((p) => p.id === id)!.name;
    showNotice(`On the board of ${name}.`, { label: "Open", run: () => void this.root.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id })) });
  }

  private async choosePages(s: Cheatsheet): Promise<void> {
    const pages = await askPages(s.title, s.pageFrom, s.pageTo, false);
    if (!pages) return;
    // The box was drawn on the page it was of.
    const same = pages.from === s.pageFrom && pages.to === s.pageTo;
    await this.save({ ...s, pageFrom: pages.from, pageTo: pages.to, region: same ? s.region : null });
    this.paintList();
    await this.paintView();
  }
}

/**
 * A cheatsheet's pages, drawn from its book at a width: each page, or the
 * part of it kept, a canvas handed to `place` before it is painted, so they
 * show as they come. Stops when `live` says the drawing is no longer wanted.
 * Says why, when they cannot be drawn; null when they were.
 */
export async function drawSheetPages(
  s: Cheatsheet,
  book: Pattern,
  width: number,
  region: SheetRegion | null,
  place: (canvas: HTMLCanvasElement) => void,
  live: () => boolean = () => true,
): Promise<string | null> {
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: toBytes(await api.readFile(book.id)) }).promise;
  } catch (err) {
    return `The book could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    if (!live()) return null;
    if (s.pageFrom > doc.numPages) return `The book has ${doc.numPages} pages: Pages… to choose others.`;
    const last = Math.min(s.pageTo, doc.numPages);
    for (let n = s.pageFrom; n <= last; n++) {
      const page = await doc.getPage(n);
      if (!live()) return null;
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const box = region ?? { x: 0, y: 0, w: 1, h: 1 };
      const canvas = document.createElement("canvas");
      canvas.className = region ? "sheet-page sheet-part" : "sheet-page";
      canvas.dataset.page = String(n);
      canvas.width = Math.max(1, Math.floor(viewport.width * box.w));
      canvas.height = Math.max(1, Math.floor(viewport.height * box.h));
      canvas.style.width = `${Math.floor(width * box.w)}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      place(canvas);
      await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -box.x * viewport.width, -box.y * viewport.height] }).promise;
      page.cleanup();
    }
    return null;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/** A web page kept, in a frame: sandboxed, as a video's player is. */
export function sheetFrameHtml(s: Pick<Cheatsheet, "url" | "title">, className = "sheet-frame"): string {
  return `<iframe class="${className}" src="${esc(s.url)}" title="${esc(s.title)}" referrerpolicy="strict-origin-when-cross-origin"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation" allow="fullscreen; encrypted-media; picture-in-picture"></iframe>`;
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
