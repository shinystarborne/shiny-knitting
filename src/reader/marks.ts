import { api, type Annotation } from "../api";
import { askText, askYesNo } from "../dialogs";
import {
  findQuoteRanges,
  fromPageRect,
  isDistinctStrokePoint,
  mergeRects,
  occurrenceAt,
  parsePoints,
  parseRects,
  pointsToJson,
  rectsForRanges,
  rectsToJson,
  toPageRect,
  visibleRectsForRanges,
  type ClientRect,
  type Point,
  type Rect,
} from "../annotations";

/**
 * Highlights, notes and drawings on the page.
 *
 * The layer sits above the document and paints the stored geometry over it. It
 * is an overlay rather than anything inserted into the document, for the same
 * reason the highlight line is: a PDF page is a canvas, and EPUBs are
 * sandboxed iframes whose contents must not be rewritten. Overlaying means the
 * same code works for both, and a mark cannot be lost by a re-render.
 *
 * Drawing is pointer-captured, so a stroke that leaves the page, crosses the
 * sidebar, or outruns the pointer still finishes where it started rather than
 * jumping.
 */

/** What the toolbar has selected. */
export type MarkTool = "none" | "highlight" | "note" | "draw" | "pin";

/** Colours offered, chosen to stay legible over a mostly white page. */
export const MARK_COLOURS = [
  { value: "#ffd60a", label: "Yellow" },
  { value: "#46a758", label: "Green" },
  { value: "#5aa9f7", label: "Blue" },
  { value: "#e5484d", label: "Red" },
  { value: "#c77dff", label: "Purple" },
];

export class MarkLayer {
  private host: HTMLElement;
  private scroller: HTMLElement;
  private patternId: string;
  private doc: MarkTarget;

  private marks: Annotation[] = [];
  private tool: MarkTool = "none";
  private colour = MARK_COLOURS[0].value;

  /** The stroke in progress, and the node drawing it. */
  private liveStroke: Point[] = [];
  private liveNode: SVGSVGElement | null = null;
  private drawingPointer: number | null = null;
  /** The page a stroke started on, which is where it is saved even if the
   * reader scrolls to another page mid-drag. */
  private drawingPage = 0;
  /** The element holding pointer capture for the stroke, if capture took. */
  private captureEl: Element | null = null;
  /** The note editor, while one is open. */
  private notePopover: HTMLElement | null = null;
  /** The click listener that dismisses the note editor, so it can always be
   * removed when the editor closes, however it closed. */
  private noteDismiss: ((e: MouseEvent) => void) | null = null;
  /** Chapter documents already wired, so none is wired twice. */
  private wiredFrames = new WeakSet<HTMLIFrameElement>();
  /** Removers for everything attached to EPUB chapter frames and documents. */
  private frameTeardowns: (() => void)[] = [];
  /**
   * Called when a pin drag starts, if a pin layer is attached.
   *
   * Set by the reader rather than reaching for the layer directly, so the mark
   * layer does not have to know that pins exist.
   */
  onPinSelect: ((e: PointerEvent, page: HTMLElement) => void) | null = null;

  /**
   * Called whenever a mark is added or removed, so the toolbar can grey out
   * Undo and Clear when there is nothing left to act on.
   */
  onChange: (() => void) | null = null;

  constructor(scroller: HTMLElement, patternId: string, doc: MarkTarget) {
    this.scroller = scroller;
    this.patternId = patternId;
    this.doc = doc;

    this.host = document.createElement("div");
    this.host.className = "mark-layer";

    this.scroller.addEventListener("pointerdown", this.onPointerDown);
    this.scroller.addEventListener("pointermove", this.onPointerMove);
    this.scroller.addEventListener("pointerup", this.onPointerUp);
    this.scroller.addEventListener("pointercancel", this.onPointerUp);
    // A drag over text would otherwise start a selection, which fights with
    // drawing and is never wanted while a drawing tool is active.
    this.scroller.addEventListener("dragstart", this.onDragStart);
    // A stroke without pointer capture gets no pointerup when the pointer is
    // released outside the window; without this the live SVG would leak.
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  /** Mounts the overlay above the document. */
  attach(): void {
    const pane = this.scroller.parentElement;
    if (pane && this.host.parentElement !== pane) pane.appendChild(this.host);
    this.attachFrames();
    this.repaint();
  }

  detach(): void {
    this.closeNotePopover();
    this.scroller.removeEventListener("pointerdown", this.onPointerDown);
    this.scroller.removeEventListener("pointermove", this.onPointerMove);
    this.scroller.removeEventListener("pointerup", this.onPointerUp);
    this.scroller.removeEventListener("pointercancel", this.onPointerUp);
    this.scroller.removeEventListener("dragstart", this.onDragStart);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    for (const teardown of this.frameTeardowns) teardown();
    this.frameTeardowns = [];
    this.wiredFrames = new WeakSet();
    this.host.remove();
  }

  setTool(tool: MarkTool): void {
    this.tool = tool;
    this.scroller.classList.toggle("mark-tool-draw", tool === "draw");
    this.scroller.classList.toggle("mark-tool-pick", tool === "none");
    this.host.dataset.tool = tool;
  }

  get currentTool(): MarkTool {
    return this.tool;
  }

  setColour(colour: string): void {
    this.colour = colour;
    this.repaint();
  }

  get currentColour(): string {
    return this.colour;
  }

  async refresh(): Promise<void> {
    try {
      this.marks = await api.listAnnotations(this.patternId);
    } catch {
      // A pattern with unreadable marks should still open.
      this.marks = [];
    }
    this.onChange?.();
    this.repaint();
  }

  /**
   * Repaints every mark for the page currently on screen.
   *
   * Only the visible page is drawn. A 200-page pattern with marks throughout
   * would otherwise build a few hundred invisible nodes on every repaint, and
   * the page elements do not exist until they are laid out anyway.
   */
  repaint(): void {
    this.host.textContent = "";
    const pageNumber = this.doc.currentPage();
    const page = this.doc.pageElement(pageNumber);
    if (!page) return;
    // An EPUB's text has moved since the mark was made, so its rectangles are
    // worked out again from the quote rather than read back. A PDF's have not,
    // and a stored rectangle is exact and costs nothing.
    const reflowing = page instanceof HTMLIFrameElement;
    const text = reflowing ? this.doc.textLayerFor(pageNumber) : null;
    for (const mark of this.marks) {
      if (mark.page !== pageNumber) continue;
      if (mark.kind === "draw") {
        this.paintDrawing(mark, page);
        continue;
      }
      if (reflowing && mark.kind === "highlight" && mark.quote && text) {
        const ranges = findQuoteRanges(text, mark.quote, mark.occurrence);
        if (!ranges.length) continue; // The passage is gone after an edit.
        // Dropped rather than clamped if the passage has scrolled outside the
        // chapter's visible box, so a mark never lands on the page edge.
        this.paintRects(mark, page, visibleRectsForRanges(ranges, page));
        continue;
      }
      this.paintRects(mark, page);
    }
  }

  private paintRects(mark: Annotation, page: HTMLElement, given?: Rect[]): void {
    const rects =
      given ?? (mark.kind === "note" ? noteRects(mark) : parseRects(mark.geometry));
    for (const rect of rects) {
      const box = fromPageRect(rect, page);
      const el = document.createElement("div");
      el.className = `mark mark-${mark.kind}`;
      this.place(el, box);
      el.style.setProperty("--mark-colour", mark.color);
      el.dataset.id = mark.id;
      el.title = `Click to remove ${describeMark(mark)}`;
      if (mark.kind === "note") {
        el.dataset.role = "note";
        el.title = mark.text ? `${mark.text}\n\nClick to remove` : "Note\n\nClick to remove";
      }
      this.host.appendChild(el);
    }
  }

  private paintDrawing(mark: Annotation, page: HTMLElement): void {
    const points = parsePoints(mark.geometry);
    if (points.length < 2) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mark mark-draw");
    svg.dataset.id = mark.id;
    // The svg is positioned over the page, so stroke coordinates are page
    // fractions scaled to the page's pixel size.
    this.place(svg, page.getBoundingClientRect());
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.setProperty("--mark-colour", mark.color);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", toPath(points));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    this.host.appendChild(svg);
  }

  /**
   * Positions an overlay node over a page box, in the layer's own coordinates.
   *
   * The layer clips marks to the reading pane (overflow, in the stylesheet),
   * so a mark on a page that has scrolled half out of view is cut at the pane
   * edge rather than bleeding over the reader bar. Clipping requires the marks
   * to be the layer's absolute children rather than fixed to the viewport,
   * which is why the page box -- measured against the viewport -- is shifted
   * by the layer's own box here.
   */
  private place(el: HTMLElement | SVGSVGElement, box: ClientRect | DOMRect): void {
    const origin = this.host.getBoundingClientRect();
    el.style.left = `${box.left - origin.left}px`;
    el.style.top = `${box.top - origin.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  }

  // ---------- selection to highlight ----------

  /**
   * Turns the current text selection into a highlight.
   *
   * Returns false when there is nothing to highlight, so the caller can leave
   * the selection alone rather than clearing it on a stray click.
   */
  async highlightSelection(): Promise<boolean> {
    const range = this.currentSelection();
    if (!range) return false;
    const quote = range.toString().replace(/\s+/g, " ").trim();
    if (!quote) return false;

    const pageNumber = this.doc.currentPage();
    const page = this.doc.pageElement(pageNumber);
    if (!page) return false;

    const rects = mergeRects(rectsForRanges([range], page));
    if (!rects.length) return false;

    // On an EPUB the text will move, so what is recorded is *which* passage
    // this was and the rectangles are only there to paint it right now. On a
    // PDF the page is fixed, the rectangles are the record, and the quote is
    // kept purely so the mark can be labelled later.
    const reflowing = page instanceof HTMLIFrameElement;
    const text = reflowing ? this.doc.textLayerFor(pageNumber) : null;
    const occurrence = text ? occurrenceAt(text, range, quote) : 0;

    const created = await api.addAnnotation(this.patternId, {
      kind: "highlight",
      page: pageNumber,
      geometry: rectsToJson(rects),
      quote,
      occurrence,
      color: this.colour,
      text: "",
    });
    this.marks.push(created);
    this.onChange?.();
    const selection = this.selectionFor(range);
    selection?.removeAllRanges();
    this.repaint();
    return true;
  }

  /**
   * The range the reader currently has selected, if it is a usable one.
   *
   * A selection inside an EPUB chapter's iframe belongs to that frame, not to
   * the outer document, so the frame's own selection is preferred. A selection
   * that starts outside the page being viewed is refused: a mark belongs to the
   * page under the selection, and guessing would put it on the wrong one.
   */
  private currentSelection(): Range | null {
    const outer = window.getSelection();
    if (outer && !outer.isCollapsed && outer.rangeCount > 0) {
      const node = outer.getRangeAt(0).startContainer;
      // Which page the selection starts in, if it is in one at all.
      const page = this.doc.pageElement(this.doc.currentPage());
      if (page && (page.contains(node) || this.doc.textLayerFor(this.doc.currentPage())?.contains(node))) {
        return outer.getRangeAt(0);
      }
    }
    // Fall back to a chapter iframe, for a selection made inside one.
    const pageNumber = this.doc.currentPage();
    const frame = this.ownerFrame(pageNumber);
    if (frame) {
      const inner = frame.contentWindow?.getSelection();
      if (inner && !inner.isCollapsed && inner.rangeCount > 0) return inner.getRangeAt(0);
    }
    return null;
  }

  /** The document a range belongs to, so its selection can be cleared. */
  private selectionFor(range: Range): Selection | null {
    const win = range.startContainer.ownerDocument?.defaultView;
    return win?.getSelection() ?? null;
  }

  /** The iframe a chapter is rendered in, when the document is an EPUB. */
  private ownerFrame(page: number): HTMLIFrameElement | null {
    const el = this.doc.pageElement(page);
    return el instanceof HTMLIFrameElement ? el : null;
  }

  /** Places a note where the reader clicked, asking for its text first. */
  async addNoteAt(x: number, y: number, pageNumber?: number): Promise<boolean> {
    const onPage = pageNumber ?? this.doc.currentPage();
    const page = this.doc.pageElement(onPage);
    if (!page) return false;
    const text = await askText("Note:");
    if (text === null) return false;

    const rect: Rect = {
      x: Math.max(0, Math.min(1, (x - page.getBoundingClientRect().left) / (page.getBoundingClientRect().width || 1))),
      y: Math.max(0, Math.min(1, (y - page.getBoundingClientRect().top) / (page.getBoundingClientRect().height || 1))),
      // A note is a marker, not a block of text, so it gets a small fixed size
      // in page fractions.
      w: 0.03,
      h: 0.022,
    };
    const created = await api.addAnnotation(this.patternId, {
      kind: "note",
      page: onPage,
      geometry: rectsToJson([rect]),
      quote: "",
      occurrence: 0,
      color: this.colour,
      text,
    });
    this.marks.push(created);
    this.onChange?.();
    this.repaint();
    return true;
  }

  /**
   * Removes the mark under a point, after asking.
   *
   * A single click deleting work with no undo would be a nasty surprise, so it
   * confirms first. The mark says what will happen on hover, so the behaviour
   * is discoverable rather than a trap.
   */
  async removeAt(x: number, y: number): Promise<boolean> {
    const hit = this.markAt(x, y);
    if (!hit) return false;
    const what = describeMark(hit);
    if (!(await askYesNo(`Remove ${what}?`, { okLabel: "Remove", danger: true }))) return false;
    await this.removeById(hit.id);
    this.repaint();
    return true;
  }

  /**
   * Opens a note for reading and editing, or says why it cannot be opened.
   *
   * Notes are the one mark with something to say, so clicking one opens it
   * rather than offering to delete it: a note you can only create and destroy
   * is not much use once you have thought of a better wording.
   */
  async editNoteAt(x: number, y: number): Promise<boolean> {
    const hit = this.markAt(x, y);
    if (!hit || hit.kind !== "note") return false;
    this.closeNotePopover();

    const pop = document.createElement("div");
    pop.className = "note-popover";
    const textarea = document.createElement("textarea");
    textarea.value = hit.text;
    textarea.rows = 4;
    textarea.setAttribute("aria-label", "Note text");

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const save = button("Save", "primary");
    const remove = button("Remove", "danger");
    const close = button("Close", "ghost");
    actions.append(save, remove, close);
    pop.append(textarea, actions);

    const anchor = this.host.querySelector<HTMLElement>(`[data-id="${hit.id}"]`);
    const box = (anchor ?? this.scroller).getBoundingClientRect();
    pop.style.left = `${Math.min(box.left, window.innerWidth - 300)}px`;
    pop.style.top = `${Math.min(box.bottom + 8, window.innerHeight - 220)}px`;
    // Mounted beside the mark layer, not inside it: repaint() clears the
    // layer on every scroll, and an editor living there would lose the
    // textarea mid-sentence. The popover is positioned against the viewport,
    // so a sibling mount changes nothing about where it appears.
    (this.host.parentElement ?? this.host).appendChild(pop);
    this.notePopover = pop;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    save.addEventListener("click", async () => {
      const text = textarea.value.trim();
      // An emptied note is a note the user changed their mind about, so it is
      // removed rather than left as an empty dot.
      if (!text) {
        await this.removeById(hit.id);
      } else {
        await api.editAnnotation(hit.id, text, hit.color);
        const stored = this.marks.find((m) => m.id === hit.id);
        if (stored) stored.text = text;
      }
      this.closeNotePopover();
      this.repaint();
    });
    remove.addEventListener("click", async () => {
      this.closeNotePopover();
      // Asked from the note editor rather than over it, so the popover is not
      // left hanging behind a question it cannot answer.
      if (await askYesNo(`Remove ${describeMark(hit)}?`, { okLabel: "Remove", danger: true })) {
        await this.removeById(hit.id);
        this.repaint();
      }
    });
    close.addEventListener("click", () => this.closeNotePopover());

    // Clicking elsewhere dismisses, on the next tick so the click that opened
    // this does not immediately close it. The listener is remembered so
    // closeNotePopover can always take it back: a popover closed by its own
    // buttons returns early here (the closing click bubbled from inside), and
    // a forgotten listener would close the next popover on its opening click.
    const dismiss = (e: MouseEvent) => {
      if (pop.contains(e.target as Node)) return;
      this.closeNotePopover();
    };
    this.noteDismiss = dismiss;
    setTimeout(() => {
      if (this.noteDismiss === dismiss) document.addEventListener("click", dismiss);
    }, 0);
    return true;
  }

  private async removeById(id: string): Promise<void> {
    await api.deleteAnnotation(id);
    this.marks = this.marks.filter((m) => m.id !== id);
    this.onChange?.();
  }

  /** Whether there is anything to undo or clear, for greying out the buttons. */
  get hasMarks(): boolean {
    return this.marks.length > 0;
  }

  /**
   * Removes the most recently made mark, with no confirmation.
   *
   * Undo is the fast path for "that was a mistake", made right after making
   * it, so asking first would defeat the point. `marks` is appended to in the
   * order marks are created, so the last element is the last one made,
   * regardless of which page it landed on.
   */
  async undoLast(): Promise<boolean> {
    const last = this.marks[this.marks.length - 1];
    if (!last) return false;
    await this.removeById(last.id);
    this.repaint();
    return true;
  }

  /**
   * Removes every highlight, note and drawing on this pattern, after asking.
   *
   * Asked once for the whole batch rather than once per mark: the point of a
   * clean slate is that it is one action, not forty confirmations.
   */
  async clearAll(): Promise<boolean> {
    const count = this.marks.length;
    if (!count) return false;
    const what = count === 1 ? "1 mark" : `${count} marks`;
    if (!(await askYesNo(`Remove all ${what} on this pattern? This cannot be undone.`, { okLabel: "Remove all", danger: true }))) {
      return false;
    }
    const ids = this.marks.map((m) => m.id);
    this.marks = [];
    this.onChange?.();
    this.repaint();
    await Promise.all(ids.map((id) => api.deleteAnnotation(id).catch(() => {})));
    return true;
  }

  private closeNotePopover(): void {
    if (this.noteDismiss) {
      document.removeEventListener("click", this.noteDismiss);
      this.noteDismiss = null;
    }
    this.notePopover?.remove();
    this.notePopover = null;
  }

  /** The topmost mark under a point, or null. */
  markAt(x: number, y: number): Annotation | null {
    for (const mark of [...this.marks].reverse()) {
      if (mark.page !== this.doc.currentPage()) continue;
      const page = this.doc.pageElement(mark.page);
      if (!page) continue;
      const box = page.getBoundingClientRect();
      const px = (x - box.left) / (box.width || 1);
      const py = (y - box.top) / (box.height || 1);
      const rects = this.hitRects(mark, page);
      for (const r of rects) {
        // Drawings are strokes a few pixels wide, so the hit area is grown to
        // something a finger can actually hit.
        const pad = mark.kind === "draw" ? 0.01 : 0;
        if (px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad) {
          return mark;
        }
      }
    }
    return null;
  }

  /**
   * The rectangles a mark is hit-tested against.
   *
   * An EPUB highlight is redrawn from its quote on every repaint, because the
   * text reflows; testing against the geometry stored at save time would
   * accept clicks wherever the passage used to be, which diverges from what is
   * visible after any reflow. So a reflowed mark is tested against the same
   * re-found rectangles it is drawn from. Everything else is fixed geometry
   * and is tested as stored.
   */
  private hitRects(mark: Annotation, page: HTMLElement): Rect[] {
    if (mark.kind === "draw") return boundsOf(parsePoints(mark.geometry));
    if (mark.kind === "note") return noteRects(mark);
    if (page instanceof HTMLIFrameElement) {
      const text = this.doc.textLayerFor(mark.page);
      const ranges = text && mark.quote ? findQuoteRanges(text, mark.quote, mark.occurrence) : [];
      return ranges.length ? visibleRectsForRanges(ranges, page) : [];
    }
    return parseRects(mark.geometry);
  }

  // ---------- drawing ----------

  private onDragStart = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown(e, 0, 0, this.doc.currentPage());
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerMove(e, 0, 0);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drawingPointer !== e.pointerId) return;
    this.drawingPointer = null;
    // The live state is reset before anything that can throw, so a stroke is
    // never left half-drawn on screen when the release comes without capture.
    const points = this.liveStroke;
    const pageNumber = this.drawingPage;
    this.liveStroke = [];
    this.liveNode?.remove();
    this.liveNode = null;
    try {
      if (this.captureEl?.hasPointerCapture(e.pointerId)) {
        this.captureEl.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Already released, which is the normal case when capture never took.
    }
    this.captureEl = null;
    // A tap is not a stroke. Saving one would leave a dot nobody drew.
    if (points.length < 2) return;
    // Saved against the page the stroke started on: its points were measured
    // there, and a page change mid-drag would otherwise file it wrongly.
    void api
      .addAnnotation(this.patternId, {
        kind: "draw",
        page: pageNumber,
        geometry: pointsToJson(points),
        quote: "",
        occurrence: 0,
        color: this.colour,
        text: "",
      })
      .then((created) => {
        this.marks.push(created);
        this.onChange?.();
        this.repaint();
      });
  };

  private pointerDown(e: PointerEvent, dx: number, dy: number, pageNumber: number): void {
    if (e.button !== 0) return;
    const page = this.doc.pageElement(pageNumber);
    if (!page) return;
    const x = e.clientX + dx;
    const y = e.clientY + dy;
    // Never start a mark on the highlight line or the counter: those have their
    // own drag behaviour and a mark under them would be unreachable.
    if ((e.target as HTMLElement).closest(".highlight-line, .highlight-layer")) return;

    if (this.tool === "pin") {
      // A pin is a crop of the page rather than a mark drawn on it, so the pin
      // layer owns the drag. It is reached through here so that one tool is
      // active at a time: a drag that started as a pin must not also leave a
      // note behind on the way.
      e.preventDefault();
      this.onPinSelect?.(e, page);
    } else if (this.tool === "draw") {
      const point = this.pointFrom(x, y, page);
      if (!point) return;
      e.preventDefault();
      this.drawingPointer = e.pointerId;
      this.drawingPage = pageNumber;
      this.liveStroke = [point];
      // Capture keeps the stroke coming when the pointer leaves the page, which
      // is what stops a long drag from jumping. It is an improvement, not a
      // requirement: it throws if the pointer is already gone, and losing the
      // whole stroke over that would be far worse than losing the capture.
      // Inside an EPUB chapter the scroller cannot capture the frame's pointer,
      // so the element under the press captures it within the frame instead.
      this.captureEl = null;
      try {
        const target = page instanceof HTMLIFrameElement ? (e.target as Element) : this.scroller;
        target.setPointerCapture(e.pointerId);
        this.captureEl = target;
      } catch {
        // Drawing still works; it just stops at the edge of the page.
      }
      this.beginLiveStroke(page);
    } else if (this.tool === "note") {
      e.preventDefault();
      void this.addNoteAt(x, y, pageNumber);
    } else if (this.tool === "none") {
      // With no tool chosen, a click on a mark does something useful to it: a
      // note opens for editing, anything else offers to be removed.
      const hit = this.markAt(x, y);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        if (hit.kind === "note") void this.editNoteAt(x, y);
        else void this.removeAt(x, y);
      }
    }
  }

  private pointerMove(e: PointerEvent, dx: number, dy: number): void {
    if (this.drawingPointer !== e.pointerId) return;
    const page = this.doc.pageElement(this.drawingPage);
    if (!page) return;
    const point = this.pointFrom(e.clientX + dx, e.clientY + dy, page);
    if (!point || !isDistinctStrokePoint(this.liveStroke, point)) return;
    this.liveStroke.push(point);
    this.extendLiveStroke();
  }

  private pointFrom(x: number, y: number, page: HTMLElement): Point | null {
    const box = page.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: (x - box.left) / box.width,
      y: (y - box.top) / box.height,
    };
  }

  private beginLiveStroke(page: HTMLElement): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mark mark-draw live");
    this.place(svg, page.getBoundingClientRect());
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.setProperty("--mark-colour", this.colour);
    this.host.appendChild(svg);
    this.liveNode = svg;
    this.extendLiveStroke();
  }

  private extendLiveStroke(): void {
    if (!this.liveNode) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", toPath(this.liveStroke));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    this.liveNode.appendChild(path);
  }

  // ---------- EPUB chapter frames ----------

  /**
   * Wires the tool listeners into every EPUB chapter frame.
   *
   * Pointer and key events inside a chapter's iframe are dispatched to the
   * frame's own document and never reach the scroller, so without this the
   * note and draw tools -- and the H shortcut -- are dead on an EPUB. The
   * handlers are the same ones the scroller uses; only the coordinates are
   * translated, from the frame's viewport into the outer one the marks are
   * measured in.
   */
  private attachFrames(): void {
    for (let page = 1; ; page++) {
      const el = this.doc.pageElement(page);
      if (!el) break;
      if (el instanceof HTMLIFrameElement) this.wireFrame(el);
    }
  }

  private wireFrame(frame: HTMLIFrameElement): void {
    if (this.wiredFrames.has(frame)) return;
    this.wiredFrames.add(frame);
    let wired: Document | null = null;

    const onDown = (e: Event) => this.framePointerDown(frame, e as PointerEvent);
    const onMove = (e: Event) => this.framePointerMove(frame, e as PointerEvent);
    const onUp = (e: Event) => this.onPointerUp(e as PointerEvent);
    const onDrag = (e: Event) => e.preventDefault();
    const onKey = (e: Event) => this.frameKeyDown(e as KeyboardEvent);

    const unbind = () => {
      if (!wired) return;
      wired.removeEventListener("pointerdown", onDown);
      wired.removeEventListener("pointermove", onMove);
      wired.removeEventListener("pointerup", onUp);
      wired.removeEventListener("pointercancel", onUp);
      wired.removeEventListener("dragstart", onDrag);
      wired.removeEventListener("keydown", onKey);
      wired = null;
    };
    // Rendering a chapter replaces its document, so the wiring is redone on
    // load rather than once: a listener on the old document hears nothing.
    const bind = () => {
      const doc = frame.contentDocument;
      if (!doc || doc === wired) return;
      unbind();
      wired = doc;
      doc.addEventListener("pointerdown", onDown);
      doc.addEventListener("pointermove", onMove);
      doc.addEventListener("pointerup", onUp);
      doc.addEventListener("pointercancel", onUp);
      doc.addEventListener("dragstart", onDrag);
      doc.addEventListener("keydown", onKey);
    };
    bind();
    frame.addEventListener("load", bind);
    this.frameTeardowns.push(() => {
      unbind();
      frame.removeEventListener("load", bind);
    });
  }

  /** The page a chapter frame renders, so a mark lands on the right page. */
  private pageForFrame(frame: HTMLIFrameElement): number {
    for (let page = 1; ; page++) {
      const el = this.doc.pageElement(page);
      if (!el) return this.doc.currentPage();
      if (el === frame) return page;
    }
  }

  private framePointerDown(frame: HTMLIFrameElement, e: PointerEvent): void {
    const box = frame.getBoundingClientRect();
    this.pointerDown(e, box.left, box.top, this.pageForFrame(frame));
  }

  private framePointerMove(frame: HTMLIFrameElement, e: PointerEvent): void {
    const box = frame.getBoundingClientRect();
    this.pointerMove(e, box.left, box.top);
  }

  /**
   * The H shortcut, forwarded from inside a chapter.
   *
   * The reader's own key handling lives on the scroller, which a keypress in
   * an iframe never reaches. Only highlighting is mirrored here: it is the one
   * mark action with a key, and the selection it acts on is in the frame.
   */
  private frameKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The frame has its own realm, so instanceof against the outer
    // HTMLInputElement would never match; the tag name is realm-agnostic.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (e.key.toLowerCase() !== "h") return;
    e.preventDefault();
    void this.highlightSelection();
  }
}

/** The subset of a reader document the mark layer needs. */
export interface MarkTarget {
  /** 1-based page currently at the top of the view. */
  currentPage(): number;
  /** The element a page is painted into, or null when it is not laid out. */
  pageElement(page: number): HTMLElement | null;
  /**
   * The element holding a page's real text, for re-finding a quote.
   *
   * Null for a PDF that has not rendered yet, and for an image-only scan,
   * which has no text at all.
   */
  textLayerFor(page: number): HTMLElement | null;
}

/** How a mark is named when asking whether to remove it. */
function describeMark(mark: Annotation): string {
  if (mark.kind === "note") return "this note";
  if (mark.kind === "draw") return "this drawing";
  return mark.quote ? `this highlight on “${mark.quote.slice(0, 40)}”` : "this highlight";
}

function button(label: string, kind: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.className = kind;
  el.type = "button";
  return el;
}

/** A note's marker box, with a little slack so the dot is easy to click. */
function noteRects(mark: Annotation): Rect[] {
  return parseRects(mark.geometry).map((r) => ({
    x: r.x,
    y: r.y,
    w: Math.max(r.w, 0.02),
    h: Math.max(r.h, 0.018),
  }));
}

function boundsOf(points: Point[]): Rect[] {
  if (!points.length) return [];
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }];
}

/** An SVG path through the points, smoothed so a stroke does not look faceted. */
function toPath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    // A quadratic through the midpoint of each pair: enough smoothing to look
    // like a pen without overshooting on a sharp change of direction.
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;
    d += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export { mergeRects, toPageRect };
