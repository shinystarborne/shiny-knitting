import { api, type Masterclass } from "../api";
import { findAbbreviations, loadGlossary, videoFor, type Entry, type Found } from "../views/abbreviations";

/** How long the pointer rests on one before it is explained. */
const REST_MS = 300;

/**
 * An abbreviation in a pattern's text explained when pointed at: resting the
 * pointer on "ssk" shows beside it what it means, from the glossary (yours
 * too), with a masterclass video where one covers it. Read from the PDF's
 * text layer, so a scanned pattern, with no text, has nothing to point at.
 */
export class AbbrTips {
  private scroller: HTMLElement;
  private tip: HTMLElement;
  private entries: Entry[] = [];
  private masterclasses: Masterclass[] = [];
  private at = { x: 0, y: 0 };
  private frame = 0;
  private restTimer = 0;
  private hideTimer = 0;
  /** The one shown, or waited on: its text node and where in it. */
  private current: { node: Node; start: number } | null = null;

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.tip = document.createElement("div");
    this.tip.className = "abbr-tip";
    this.tip.hidden = true;
    document.body.append(this.tip);
    scroller.addEventListener("mousemove", this.onMove);
    scroller.addEventListener("mouseleave", this.hideSoon);
    scroller.addEventListener("scroll", this.hide, { passive: true });
    scroller.addEventListener("mousedown", this.hide);
    // Over the tip itself it stays, so its video can be clicked.
    this.tip.addEventListener("mouseenter", () => window.clearTimeout(this.hideTimer));
    this.tip.addEventListener("mouseleave", this.hideSoon);
    this.tip.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-url]");
      if (btn) void api.openLink(btn.dataset.url!).catch(() => {});
    });
    void loadGlossary().then((g) => ({ entries: this.entries, masterclasses: this.masterclasses } = g));
  }

  detach(): void {
    this.scroller.removeEventListener("mousemove", this.onMove);
    this.scroller.removeEventListener("mouseleave", this.hideSoon);
    this.scroller.removeEventListener("scroll", this.hide);
    this.scroller.removeEventListener("mousedown", this.hide);
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    cancelAnimationFrame(this.frame);
    this.tip.remove();
  }

  private onMove = (e: MouseEvent): void => {
    this.at = { x: e.clientX, y: e.clientY };
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.look();
      });
    }
  };

  /** What is under the pointer: an abbreviation in the text layer, and where it is drawn. */
  private hit(): { found: Found; node: Node; rect: DOMRect } | null {
    const { x, y } = this.at;
    const range = document.caretRangeFromPoint?.(x, y);
    const node = range?.startContainer;
    if (!range || !node || node.nodeType !== Node.TEXT_NODE || !node.parentElement?.closest(".text-layer")) return null;
    const text = node.textContent ?? "";
    for (const found of findAbbreviations(text, this.entries)) {
      if (range.startOffset < found.start || range.startOffset > found.end) continue;
      // The caret is the nearest one, so the pointer must be on the word itself.
      const r = document.createRange();
      r.setStart(node, found.start);
      r.setEnd(node, found.end);
      const rect = r.getBoundingClientRect();
      if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) return { found, node, rect };
    }
    return null;
  }

  private look(): void {
    const hit = this.entries.length ? this.hit() : null;
    if (!hit) {
      window.clearTimeout(this.restTimer);
      if (!this.tip.hidden) this.hideSoon();
      else this.current = null;
      return;
    }
    if (this.current && this.current.node === hit.node && this.current.start === hit.found.start) {
      window.clearTimeout(this.hideTimer);
      return;
    }
    this.current = { node: hit.node, start: hit.found.start };
    window.clearTimeout(this.restTimer);
    this.restTimer = window.setTimeout(() => this.show(hit.found, hit.rect), REST_MS);
  }

  private show(found: Found, rect: DOMRect): void {
    window.clearTimeout(this.hideTimer);
    const video = videoFor(found.entry, this.masterclasses);
    this.tip.innerHTML = `
      <b class="abbr-tip-term">${esc(found.text)}</b>${found.entry.own ? ` <span class="hint">yours</span>` : ""}
      <span class="abbr-tip-meaning">${esc(found.entry.meaning)}</span>
      ${video ? `<button class="link abbr-tip-video" data-url="${esc(video.part.url)}" title="From your masterclasses: ${esc(video.masterclass.title)}">▶ ${esc(video.part.title)}</button>` : ""}`;
    this.tip.hidden = false;
    // Below the word, kept on screen; above it when there is no room below.
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    const below = rect.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
  }

  private hide = (): void => {
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    this.tip.hidden = true;
    this.current = null;
  };

  /** Gone after a moment, unless the pointer goes onto the tip or back onto the word. */
  private hideSoon = (): void => {
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(this.hide, 250);
  };
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
