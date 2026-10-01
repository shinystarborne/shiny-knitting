/**
 * The contents panel: the document's own outline, and the reader's bookmarks.
 *
 * Ported from Shelfmind's PdfContentsPanel. Two tabs: the PDF's embedded
 * outline (pattern books and magazines often have one; for an EPUB it is the
 * chapter list) and named page bookmarks, which are always available. A
 * document with no outline opens on the bookmarks tab rather than an empty
 * first screen.
 */
import { api, type Bookmark } from "../api";
import type { OutlineItem } from "./pdf";

/** The part of the reader the panel needs. */
export interface ContentsTarget {
  outline(): Promise<OutlineItem[]>;
  currentPage(): number;
  goToPage(page: number): void;
}

export class ContentsPanel {
  private host: HTMLElement;
  private patternId: string;
  private doc: ContentsTarget;
  private el: HTMLElement | null = null;
  private tab: "outline" | "bookmarks" = "outline";
  /** Null while it has not been read yet. */
  private outline: OutlineItem[] | null = null;
  private bookmarks: Bookmark[] = [];
  /** Called when the panel opens or closes, so its toolbar button can light up. */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(host: HTMLElement, patternId: string, doc: ContentsTarget) {
    this.host = host;
    this.patternId = patternId;
    this.doc = doc;
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  toggle(): void {
    if (this.el) this.close();
    else void this.open();
  }

  async open(): Promise<void> {
    if (this.el) return;
    this.el = document.createElement("div");
    this.el.className = "contents-panel";
    this.host.appendChild(this.el);
    this.onToggle?.(true);
    this.render();
    await Promise.all([this.loadBookmarks(), this.loadOutline()]);
    this.render();
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.onToggle?.(false);
  }

  /** One click, a sensible default name; rename afterwards. */
  async bookmarkCurrentPage(): Promise<void> {
    const page = this.doc.currentPage();
    const made = await api.addBookmark(this.patternId, page, `Page ${page}`);
    this.bookmarks.push(made);
    if (this.el) {
      this.tab = "bookmarks";
      this.render();
    }
  }

  private async loadBookmarks(): Promise<void> {
    try {
      this.bookmarks = await api.listBookmarks(this.patternId);
    } catch {
      this.bookmarks = [];
    }
  }

  private async loadOutline(): Promise<void> {
    if (this.outline !== null) return;
    try {
      this.outline = await this.doc.outline();
    } catch {
      this.outline = [];
    }
    // No outline: land on the bookmarks rather than an empty first screen.
    if (!this.outline.length) this.tab = "bookmarks";
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    el.textContent = "";

    const header = div("contents-header");
    const tabs = div("contents-tabs");
    const count = this.bookmarks.length ? ` (${this.bookmarks.length})` : "";
    tabs.append(
      this.tabButton("outline", "Outline"),
      this.tabButton("bookmarks", `🔖 Bookmarks${count}`),
    );
    const close = iconButton("✕", "Close panel", () => this.close());
    header.append(tabs, close);

    const scroll = div("contents-scroll");
    if (this.tab === "outline") this.renderOutline(scroll);
    else this.renderBookmarks(scroll);

    el.append(header, scroll);
  }

  private tabButton(tab: "outline" | "bookmarks", label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = tab === this.tab ? "contents-tab on" : "contents-tab";
    b.textContent = label;
    b.addEventListener("click", () => {
      this.tab = tab;
      this.render();
    });
    return b;
  }

  private renderOutline(into: HTMLElement): void {
    if (this.outline === null) {
      into.append(empty("Reading outline…"));
      return;
    }
    if (!this.outline.length) {
      into.append(empty("This PDF has no built-in outline — use bookmarks instead."));
      return;
    }
    const walk = (items: OutlineItem[], depth: number) => {
      for (const it of items) {
        const row = div(it.page ? "outline-item" : "outline-item no-page");
        row.style.paddingLeft = `${8 + depth * 14}px`;
        row.title = it.page ? `Go to page ${it.page}` : it.title;
        const title = span("outline-title", it.title);
        row.append(title);
        if (it.page) {
          const page = it.page;
          row.append(span("outline-page", String(page)));
          row.addEventListener("click", () => this.doc.goToPage(page));
        }
        into.append(row);
        if (it.items.length) walk(it.items, depth + 1);
      }
    };
    walk(this.outline, 0);
  }

  private renderBookmarks(into: HTMLElement): void {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "bookmark-add";
    add.textContent = `🔖 Bookmark page ${this.doc.currentPage()}`;
    add.addEventListener("click", () => void this.bookmarkCurrentPage());
    into.append(add);

    if (!this.bookmarks.length) {
      into.append(empty("No bookmarks yet."));
      return;
    }
    const sorted = [...this.bookmarks].sort((a, b) => a.page - b.page || a.sortOrder - b.sortOrder);
    for (const b of sorted) into.append(this.bookmarkRow(b));
  }

  private bookmarkRow(b: Bookmark): HTMLElement {
    const row = div("bookmark-item");
    const label = span("bookmark-label", `🔖 ${b.title}`);
    label.title = `Go to page ${b.page}`;
    label.addEventListener("click", () => this.doc.goToPage(b.page));

    const rename = iconButton("✏️", "Rename", () => {
      const input = document.createElement("input");
      input.className = "bookmark-rename";
      input.value = b.title;
      let done = false;
      const commit = async (save: boolean) => {
        if (done) return;
        done = true;
        const title = input.value.trim();
        if (save && title && title !== b.title) {
          try {
            Object.assign(b, await api.renameBookmark(b.id, title));
          } catch {
            // Left as it was; the row shows the old name again.
          }
        }
        this.render();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void commit(true);
        if (e.key === "Escape") void commit(false);
      });
      input.addEventListener("blur", () => void commit(true));
      label.replaceWith(input);
      input.focus();
      input.select();
    });
    const remove = iconButton("✕", "Delete bookmark", async () => {
      await api.deleteBookmark(b.id);
      this.bookmarks = this.bookmarks.filter((x) => x.id !== b.id);
      this.render();
    });
    row.append(label, span("outline-page", String(b.page)), rename, remove);
    return row;
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function empty(text: string): HTMLElement {
  const el = div("contents-empty");
  el.textContent = text;
  return el;
}

function iconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ghost contents-icon";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}
