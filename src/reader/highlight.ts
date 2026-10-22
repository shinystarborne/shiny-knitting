import type { HighlightSettings } from "../api";

/** What the line needs of the document under it: its pages, as laid out now. */
export interface LineDoc {
  pageCount: number;
  pageElement(page: number): HTMLElement | null;
  currentPage(): number;
}

/** Narrower or shorter than this, a line could not be found again to drag. */
const MIN_W = 0.02;
const MIN_H_PX = 3;

/**
 * The highlight line: a band on a page of the pattern, marking the row being
 * knitted.
 *
 * It belongs to the page, not the window: kept as the page it is on and its
 * box there, as shares of the page's width and height. So it scrolls with
 * the pattern -- scroll away to check something, and it is still on its row
 * when you come back -- and stays on that row whatever the window, the
 * pane's width or the zoom. It is laid out again whenever the pages are.
 *
 * Supported interactions:
 *  - Each row counted moves it its own height along the page (on to the
 *    next page past the end of one), bringing it into view
 *  - The round grip moves it anywhere on the page, or onto another page;
 *    clicked, it readies the line, and the next click in the pattern puts it
 *    there
 *  - The corner handle makes it wider, narrower, taller or shorter: as wide
 *    as the chart, as tall as one of its rows
 */
export class HighlightLine {
  private host: HTMLDivElement;
  private el: HTMLDivElement;
  private grip: HTMLDivElement;
  private sizer: HTMLDivElement;
  private settings: HighlightSettings;
  private scroller: HTMLElement | null = null;
  private doc: LineDoc | null = null;

  /** A drag of the grip (move) or the corner (size), and where it took hold. */
  private dragging: "move" | "size" | null = null;
  private grabX = 0;
  private grabY = 0;
  private pressX = 0;
  private pressY = 0;
  private moved = false;
  /** Readied by a click on the grip: the next click in the content puts the line there. */
  private ready = false;
  /** Where a smooth scroll still under way is going, so steps taken during it add up. */
  private scrollGoal: number | null = null;
  /** Cancels an in-flight smooth scroll when a new movement starts. */
  private animToken = 0;
  private observer: ResizeObserver | null = null;

  constructor(settings: HighlightSettings) {
    this.settings = { ...settings };

    this.host = document.createElement("div");
    this.host.className = "highlight-layer";

    this.el = document.createElement("div");
    this.el.className = "highlight-line";
    this.el.setAttribute("role", "slider");
    this.el.setAttribute("aria-label", "Highlight line");
    this.el.tabIndex = 0;

    this.grip = document.createElement("div");
    this.grip.className = "highlight-grip";
    this.el.appendChild(this.grip);

    this.sizer = document.createElement("div");
    this.sizer.className = "highlight-size";
    this.sizer.title = "Drag to resize the line, e.g. as wide as the chart and as tall as one row";
    this.el.appendChild(this.sizer);

    this.host.appendChild(this.el);
    this.setReady(false);
    this.apply();
    this.bindEvents();
  }

  get element(): HTMLElement {
    return this.host;
  }

  /** Puts the line in the scrolling pattern, over the document's pages. */
  attach(scroller: HTMLElement, doc: LineDoc): void {
    this.scroller = scroller;
    this.doc = doc;
    scroller.classList.add("has-line");
    if (this.host.parentElement !== scroller) scroller.appendChild(this.host);
    this.observer?.disconnect();
    // The pages are laid out again when the pane changes size: so is the line.
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(scroller);
    // Wheel and touch are the reader's own scrolling: an easing scroll still
    // under way would otherwise keep writing over it.
    scroller.addEventListener("wheel", this.cancelAnimation, { passive: true });
    scroller.addEventListener("touchstart", this.cancelAnimation, { passive: true });
    this.apply();
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scroller) {
      this.scroller.removeEventListener("wheel", this.cancelAnimation);
      this.scroller.removeEventListener("touchstart", this.cancelAnimation);
    }
    this.host.remove();
  }

  private cancelAnimation = (): void => {
    this.animToken++;
    this.scrollGoal = null;
  };

  update(settings: HighlightSettings): void {
    this.settings = { ...settings };
    this.apply();
  }

  /** Whether the line is switched on and showing. */
  get enabled(): boolean {
    return this.settings.enabled;
  }

  get current(): HighlightSettings {
    return { ...this.settings };
  }

  /** Whether it has a place on a page yet. */
  get placed(): boolean {
    return this.settings.page > 0 && this.settings.boxW > 0 && this.settings.boxH > 0;
  }

  private apply(): void {
    const s = this.settings;
    this.host.style.display = s.enabled ? "block" : "none";
    this.el.style.background = s.color;
    this.el.style.opacity = String(s.opacity);
    this.layout();
  }

  /**
   * Gives a line with no place yet one: on the page in view, where the old
   * line sat in the window, as tall as its old thickness, across the page.
   * Lines kept before they belonged to a page arrive here once.
   */
  placeIfNew(): boolean {
    const scroller = this.scroller;
    const doc = this.doc;
    if (this.placed || !scroller || !doc || !scroller.clientHeight) return false;
    const s = this.settings;
    const y = scroller.scrollTop + (s.offsetY || 0.35) * scroller.clientHeight;
    const page = this.pageAtContentY(y) ?? doc.currentPage();
    const box = this.pageBox(page);
    if (!box || !box.height) return false;
    s.page = page;
    s.boxW = s.width > 0 ? Math.min(1, s.width / box.width) : 0.96;
    s.boxX = (1 - s.boxW) / 2;
    s.boxH = Math.min(0.5, Math.max(MIN_H_PX, s.thickness || 3) / box.height);
    s.boxY = clamp((y - box.top) / box.height, 0, 1 - s.boxH);
    this.layout();
    return true;
  }

  /** A page's box in the scrolling content's own coordinates, as laid out now. */
  private pageBox(page: number): { left: number; top: number; width: number; height: number } | null {
    const scroller = this.scroller;
    const el = this.doc?.pageElement(page);
    if (!scroller || !el) return null;
    const sr = scroller.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    return {
      left: pr.left - sr.left - scroller.clientLeft + scroller.scrollLeft,
      top: pr.top - sr.top - scroller.clientTop + scroller.scrollTop,
      width: pr.width,
      height: pr.height,
    };
  }

  /** The page at a height in the scrolling content, or the nearest. */
  private pageAtContentY(y: number): number | null {
    const doc = this.doc;
    if (!doc) return null;
    let best: number | null = null;
    let bestGap = Infinity;
    for (let n = 1; n <= doc.pageCount; n++) {
      const b = this.pageBox(n);
      if (!b || !b.height) continue;
      if (y >= b.top && y < b.top + b.height) return n;
      const gap = Math.min(Math.abs(y - b.top), Math.abs(y - b.top - b.height));
      if (gap < bestGap) {
        bestGap = gap;
        best = n;
      }
    }
    return best;
  }

  /** Lays the line over its page as the page is now. */
  layout(): void {
    const s = this.settings;
    const box = this.placed ? this.pageBox(s.page) : null;
    if (!box || !box.height) {
      this.el.style.visibility = "hidden";
      return;
    }
    this.el.style.visibility = "";
    this.el.style.left = `${box.left + s.boxX * box.width}px`;
    this.el.style.top = `${box.top + s.boxY * box.height}px`;
    this.el.style.width = `${Math.max(4, s.boxW * box.width)}px`;
    this.el.style.height = `${Math.max(1, s.boxH * box.height)}px`;
    this.el.setAttribute("aria-valuenow", `${s.page}:${Math.round(s.boxY * 1000) / 10}`);
  }

  /** The line's top in the scrolling content, in pixels. */
  get contentTop(): number {
    return parseFloat(this.el.style.top || "0") || 0;
  }

  /** The line's height on screen now, in pixels. */
  get heightPx(): number {
    return parseFloat(this.el.style.height || "0") || 0;
  }

  /** The line's top within the pane as scrolled now. */
  get viewTop(): number {
    return this.contentTop - (this.scroller?.scrollTop ?? 0);
  }

  private bindEvents(): void {
    // The grip moves the line; the band itself takes no pointer, so the words
    // under it can still be selected and marked.
    const start = (kind: "move" | "size") => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragging = kind;
      this.pressX = e.clientX;
      this.pressY = e.clientY;
      this.moved = false;
      const r = this.el.getBoundingClientRect();
      this.grabX = e.clientX - r.left;
      this.grabY = e.clientY - r.top;
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer counts as down: the drag still works.
      }
      document.body.classList.add(kind === "move" ? "dragging-highlight" : "sizing-highlight");
    };
    this.grip.addEventListener("pointerdown", start("move"));
    this.sizer.addEventListener("pointerdown", start("size"));

    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      if (!this.moved && Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) < 3) return;
      this.moved = true;
      if (this.dragging === "move") this.moveTo(e.clientX - this.grabX, e.clientY - this.grabY);
      else this.sizeTo(e.clientX, e.clientY);
    };
    this.grip.addEventListener("pointermove", move);
    this.sizer.addEventListener("pointermove", move);

    const end = (e: PointerEvent) => {
      const kind = this.dragging;
      if (!kind) return;
      this.dragging = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Never captured: nothing to let go.
      }
      document.body.classList.remove("dragging-highlight", "sizing-highlight");
      // A press on the grip that did not move is a click: it readies the line
      // to be put somewhere, or lets it go again.
      if (!this.moved) {
        if (kind === "move") this.setReady(!this.ready);
        return;
      }
      this.setReady(false);
      this.flush();
    };
    for (const h of [this.grip, this.sizer]) {
      h.addEventListener("pointerup", end);
      h.addEventListener("pointercancel", end);
    }
    this.grip.addEventListener("dblclick", () => this.onConfigureRequest?.());
  }

  /** The page under a point on screen, and its box on screen. */
  private pageAtClient(clientY: number): { page: number; rect: DOMRect } | null {
    const doc = this.doc;
    if (!doc) return null;
    let best: { page: number; rect: DOMRect } | null = null;
    let bestGap = Infinity;
    for (let n = 1; n <= doc.pageCount; n++) {
      const rect = doc.pageElement(n)?.getBoundingClientRect();
      if (!rect || !rect.height) continue;
      if (clientY >= rect.top && clientY < rect.bottom) return { page: n, rect };
      const gap = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (gap < bestGap) {
        bestGap = gap;
        best = { page: n, rect };
      }
    }
    return best;
  }

  /** Moves the line's top-left corner to a point on screen: onto the page there. */
  moveTo(clientLeft: number, clientTop: number): void {
    const s = this.settings;
    const at = this.pageAtClient(clientTop + this.heightPx / 2);
    if (!at) return;
    s.page = at.page;
    s.boxX = clamp((clientLeft - at.rect.left) / at.rect.width, 0, 1 - s.boxW);
    s.boxY = clamp((clientTop - at.rect.top) / at.rect.height, 0, 1 - s.boxH);
    this.layout();
  }

  /** Makes the line reach to a point on screen: wider or narrower, taller or shorter. */
  sizeTo(clientRight: number, clientBottom: number): void {
    const s = this.settings;
    const rect = this.doc?.pageElement(s.page)?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const left = rect.left + s.boxX * rect.width;
    const top = rect.top + s.boxY * rect.height;
    s.boxW = clamp((clientRight - left) / rect.width, MIN_W, 1 - s.boxX);
    s.boxH = clamp((clientBottom - top) / rect.height, MIN_H_PX / rect.height, 1 - s.boxY);
    this.layout();
  }

  /** Across the whole width of its page. */
  fullWidth(): void {
    this.settings.boxX = 0;
    this.settings.boxW = 1;
    this.layout();
  }

  /** Whether a click in the content puts the line there: once its grip has been clicked. */
  get isReady(): boolean {
    return this.ready;
  }

  setReady(on: boolean): void {
    this.ready = on;
    this.el.classList.toggle("ready", on);
    this.grip.title = on
      ? "Click in the pattern to place the line (Esc to cancel)"
      : "Drag to move the line, or click and then click in the pattern to place it. Double-click for settings.";
  }

  /** Puts the line's top where the content was clicked, if it was readied for it. Returns whether it moved. */
  placeAt(clientY: number): boolean {
    if (!this.ready) return false;
    const at = this.pageAtClient(clientY);
    if (!at) return false;
    const s = this.settings;
    s.page = at.page;
    s.boxY = clamp((clientY - at.rect.top) / at.rect.height, 0, 1 - s.boxH);
    this.layout();
    this.setReady(false);
    this.flush();
    return true;
  }

  /**
   * Moves the line one row along the pattern: its own height on its page,
   * on to the next page past the end of one (or back to the one before).
   * Then brings it into view as the pattern scrolls: kept where it is on
   * screen once it nears the pane's top or bottom, or found again if the
   * pattern was scrolled away from it.
   */
  stepRow(direction: 1 | -1, smooth: boolean): void {
    const s = this.settings;
    if (!this.placed || !this.doc) return;
    const before = this.scroller?.clientHeight ? this.viewTop : null;
    const next = s.boxY + direction * s.boxH;
    if (next + s.boxH > 1 + 1e-9 && s.page < this.doc.pageCount) {
      s.page += 1;
      s.boxY = 0;
    } else if (next < -1e-9 && s.page > 1) {
      s.page -= 1;
      s.boxY = Math.max(0, 1 - s.boxH);
    } else {
      s.boxY = clamp(next, 0, 1 - s.boxH);
    }
    this.layout();
    this.keepInView(before, smooth);
  }

  /** Moves the line by some pixels on its page (Shift with the arrows), keeping it in view. */
  moveLineBy(delta: number, smooth: boolean): void {
    const s = this.settings;
    const box = this.placed ? this.pageBox(s.page) : null;
    if (!box || !box.height) return;
    const before = this.scroller?.clientHeight ? this.viewTop : null;
    s.boxY = clamp(s.boxY + delta / box.height, 0, 1 - s.boxH);
    this.layout();
    this.keepInView(before, smooth);
  }

  /**
   * Keeps the line in view after it moved: where it was on screen, once it
   * nears the pane's edges (the pattern moving by as much as the line did),
   * or a third of the way down if the pattern had been scrolled away from it.
   */
  private keepInView(before: number | null, smooth: boolean): void {
    const scroller = this.scroller;
    if (!scroller || !scroller.clientHeight) return;
    const vh = scroller.clientHeight;
    const top = this.viewTop;
    const h = this.heightPx;
    const base = this.scrollGoal ?? scroller.scrollTop;
    if (before === null || before + h < 0 || before > vh) {
      this.scrollTo(this.contentTop - vh * 0.35, smooth);
    } else if (top < vh * 0.1 || top + h > vh * 0.85) {
      this.scrollTo(base + (top - before), smooth);
    }
  }

  /** Brings the line into view: a third of the way down the pane. */
  show(smooth = false): void {
    if (!this.placed || !this.scroller?.clientHeight) return;
    this.layout();
    this.scrollTo(this.contentTop - this.scroller.clientHeight * 0.35, smooth);
  }

  /** Scrolls the content by some pixels, leaving the line where it is on the page. */
  nudge(delta: number, smooth: boolean): void {
    if (!this.scroller) return;
    this.scrollTo((this.scrollGoal ?? this.scroller.scrollTop) + delta, smooth);
  }

  private scrollTo(target: number, smooth: boolean): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const goal = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
    if (this.settings.animate && smooth) {
      this.smoothScrollTo(goal);
    } else {
      // An instant write supersedes any smooth scroll still in flight.
      this.animToken++;
      this.scrollGoal = null;
      scroller.scrollTop = goal;
    }
  }

  private smoothScrollTo(target: number): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const token = ++this.animToken;
    const start = scroller.scrollTop;
    const distance = target - start;
    this.scrollGoal = target;
    if (Math.abs(distance) < 1) {
      scroller.scrollTop = target;
      this.scrollGoal = null;
      return;
    }
    const duration = Math.min(Math.max(this.settings.animationMs, 80), 1200);
    const startTime = performance.now();
    const step = (now: number) => {
      if (token !== this.animToken) return;
      const t = Math.min((now - startTime) / duration, 1);
      // easeOutCubic: fast start, gentle settle.
      scroller.scrollTop = start + distance * (1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(step);
      else this.scrollGoal = null;
    };
    requestAnimationFrame(step);
  }

  /** Fires when the line asks to open the settings panel. */
  onConfigureRequest: (() => void) | null = null;

  /** Fires whenever the line's place changes, for keeping. */
  onChange: ((settings: HighlightSettings) => void) | null = null;

  flush(): void {
    this.onChange?.(this.current);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
