/**
 * Search inside the PDF.
 *
 * Ported from Shelfmind's in-reader search: every page's text is read once,
 * matches are counted across the whole document, and stepping through them
 * jumps to each one with the current match picked out from the rest. Stepping
 * starts from the first match on or after the page being read, so a search
 * finds what is ahead of you rather than sending you back to page 1.
 */
import { countMatches } from "../annotations";
import type { SearchHit } from "./pdf";

/** The part of the reader the search bar needs. */
export interface SearchTarget {
  searchTexts(): Promise<string[]>;
  setSearch(query: string | null, current?: SearchHit | null): void;
  goToPage(page: number): void;
  currentPage(): number;
  pageElement(page: number): HTMLElement | null;
}

/** Shorter queries match nearly everything, which helps nobody. */
const MIN_QUERY = 2;

export class SearchBar {
  private host: HTMLElement;
  private scroller: HTMLElement;
  private doc: SearchTarget;
  private el: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private count: HTMLElement | null = null;
  private texts: string[] | null = null;
  private hits: SearchHit[] = [];
  private index = 0;
  private typingTimer: number | null = null;
  /** Bumped per jump, so an older jump stops trying to scroll its match into view. */
  private revealToken = 0;
  /** Called when the bar opens or closes, so its toolbar button can light up. */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(host: HTMLElement, scroller: HTMLElement, doc: SearchTarget) {
    this.host = host;
    this.scroller = scroller;
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
    if (this.el) {
      this.input?.focus();
      this.input?.select();
      return;
    }
    const el = document.createElement("div");
    el.className = "search-bar";
    const input = document.createElement("input");
    input.className = "search-input";
    input.placeholder = "Loading PDF text…";
    input.disabled = true;
    input.setAttribute("aria-label", "Search this PDF");
    const count = document.createElement("span");
    count.className = "search-count";
    el.append(
      input,
      count,
      barButton("▲", "Previous match", () => this.step(-1)),
      barButton("▼", "Next match", () => this.step(1)),
      barButton("✕", "Close search", () => this.close()),
    );
    input.addEventListener("input", () => {
      clearTimeout(this.typingTimer ?? undefined);
      this.typingTimer = window.setTimeout(() => this.run(), 150);
    });
    input.addEventListener("keydown", (e) => {
      // Kept to the field: Escape on the document would otherwise also leave
      // the pattern, and letters would reach the reader's own keys.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      }
    });
    this.el = el;
    this.input = input;
    this.count = count;
    this.host.appendChild(el);
    this.onToggle?.(true);

    this.texts ??= await this.doc.searchTexts();
    if (this.el !== el) return;
    // A scanned pattern is pictures of pages with no text in them at all, so
    // say so, rather than offer a field that will only ever answer "0 / 0".
    if (!this.texts.some((t) => t)) {
      input.placeholder = "No searchable text — this PDF is scanned pages";
      el.classList.add("no-text");
      return;
    }
    input.disabled = false;
    input.placeholder = "Search this PDF…";
    input.focus();
    if (input.value.trim()) this.run();
  }

  close(): void {
    clearTimeout(this.typingTimer ?? undefined);
    this.revealToken++;
    this.el?.remove();
    this.el = null;
    this.input = null;
    this.count = null;
    this.hits = [];
    this.doc.setSearch(null);
    this.onToggle?.(false);
  }

  private get query(): string {
    return this.input?.value.trim() ?? "";
  }

  private run(): void {
    const query = this.query;
    this.hits = [];
    if (query.length >= MIN_QUERY && this.texts) {
      this.texts.forEach((text, i) => {
        const n = countMatches(text, query);
        for (let k = 0; k < n; k++) this.hits.push({ page: i + 1, occurrence: k });
      });
    }
    if (!this.hits.length) {
      this.doc.setSearch(null);
      this.updateCount();
      return;
    }
    const here = this.doc.currentPage();
    const ahead = this.hits.findIndex((h) => h.page >= here);
    this.index = ahead >= 0 ? ahead : 0;
    this.show();
  }

  private step(direction: 1 | -1): void {
    if (!this.hits.length) return;
    this.index = (this.index + direction + this.hits.length) % this.hits.length;
    this.show();
  }

  private show(): void {
    this.updateCount();
    const hit = this.hits[this.index];
    this.doc.setSearch(this.query, hit ?? null);
    if (hit) this.reveal(hit);
  }

  private updateCount(): void {
    if (!this.count) return;
    this.count.textContent =
      this.query.length < MIN_QUERY ? "" : this.hits.length ? `${this.index + 1} / ${this.hits.length}` : "0 / 0";
  }

  /**
   * Brings the current match into the middle of the pane.
   *
   * Its page may not be painted yet -- pages are painted as they come near the
   * view -- so the page is jumped to first if it is off screen, and the match
   * is centred once its page has drawn it.
   */
  private reveal(hit: SearchHit): void {
    const token = ++this.revealToken;
    const page = this.doc.pageElement(hit.page);
    const pane = this.scroller.getBoundingClientRect();
    const box = page?.getBoundingClientRect();
    if (!box || box.bottom < pane.top || box.top > pane.bottom) this.doc.goToPage(hit.page);
    const deadline = Date.now() + 4000;
    const tick = () => {
      if (token !== this.revealToken) return;
      const el = this.scroller.querySelector<HTMLElement>(".search-hit.current");
      if (el) {
        const r = el.getBoundingClientRect();
        this.scroller.scrollTop += r.top + r.height / 2 - (pane.top + pane.height / 2);
        return;
      }
      if (Date.now() < deadline) window.setTimeout(tick, 80);
    };
    tick();
  }
}

function barButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ghost icon-btn";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}
