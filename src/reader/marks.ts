import { api, type Annotation } from "../api";
import {
  fromPageRect,
  isDistinctStrokePoint,
  mergeRects,
  parsePoints,
  parseRects,
  pointsToJson,
  rectsForRanges,
  rectsToJson,
  toPageRect,
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
export type MarkTool = "none" | "highlight" | "note" | "draw";

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
    this.scroller.addEventListener("dragstart", (e) => e.preventDefault());
  }

  /** Mounts the overlay above the document. */
  attach(): void {
    const pane = this.scroller.parentElement;
    if (pane && this.host.parentElement !== pane) pane.appendChild(this.host);
    this.repaint();
  }

  detach(): void {
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
    for (const mark of this.marks) {
      if (mark.page !== pageNumber) continue;
      const page = this.doc.pageElement(pageNumber);
      if (!page) continue;
      if (mark.kind === "draw") this.paintDrawing(mark, page);
      else this.paintRects(mark, page);
    }
  }

  private paintRects(mark: Annotation, page: HTMLElement): void {
    const rects = mark.kind === "note" ? noteRects(mark) : parseRects(mark.geometry);
    for (const rect of rects) {
      const box = fromPageRect(rect, page);
      const el = document.createElement("div");
      el.className = `mark mark-${mark.kind}`;
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.setProperty("--mark-colour", mark.color);
      el.dataset.id = mark.id;
      el.title = "Click to remove this highlight";
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
    const box = page.getBoundingClientRect();
    // The svg is positioned over the page, so stroke coordinates are page
    // fractions scaled to the page's pixel size.
    svg.style.left = `${box.left}px`;
    svg.style.top = `${box.top}px`;
    svg.style.width = `${box.width}px`;
    svg.style.height = `${box.height}px`;
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.setProperty("--mark-colour", mark.color);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", toPath(points));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
    this.host.appendChild(svg);
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

    const created = await api.addAnnotation(this.patternId, {
      kind: "highlight",
      page: pageNumber,
      geometry: rectsToJson(rects),
      quote,
      // The occurrence matters only where the text has to be re-found, which
      // is an EPUB. For a PDF the rectangles are the record.
      occurrence: 0,
      color: this.colour,
      text: "",
    });
    this.marks.push(created);
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
  async addNoteAt(x: number, y: number): Promise<boolean> {
    const pageNumber = this.doc.currentPage();
    const page = this.doc.pageElement(pageNumber);
    if (!page) return false;
    const text = window.prompt("Note:");
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
      page: pageNumber,
      geometry: rectsToJson([rect]),
      quote: "",
      occurrence: 0,
      color: this.colour,
      text,
    });
    this.marks.push(created);
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
    const what = hit.kind === "note" ? "this note" : hit.kind === "draw" ? "this drawing" : "this highlight";
    if (!window.confirm(`Remove ${what}?`)) return false;
    await api.deleteAnnotation(hit.id);
    this.marks = this.marks.filter((m) => m.id !== hit.id);
    this.repaint();
    return true;
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
      const rects = mark.kind === "draw" ? boundsOf(parsePoints(mark.geometry)) : mark.kind === "note" ? noteRects(mark) : parseRects(mark.geometry);
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

  // ---------- drawing ----------

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const pageNumber = this.doc.currentPage();
    const page = this.doc.pageElement(pageNumber);
    if (!page) return;
    // Never start a mark on the highlight line or the counter: those have their
    // own drag behaviour and a mark under them would be unreachable.
    if ((e.target as HTMLElement).closest(".highlight-line, .highlight-layer")) return;

    if (this.tool === "draw") {
      const point = this.pointFrom(e, page);
      if (!point) return;
      e.preventDefault();
      this.drawingPointer = e.pointerId;
      this.liveStroke = [point];
      // Capture keeps the stroke coming when the pointer leaves the page, which
      // is what stops a long drag from jumping. It is an improvement, not a
      // requirement: it throws if the pointer is already gone, and losing the
      // whole stroke over that would be far worse than losing the capture.
      try {
        this.scroller.setPointerCapture(e.pointerId);
      } catch {
        // Drawing still works; it just stops at the edge of the page.
      }
      this.beginLiveStroke(page);
    } else if (this.tool === "note") {
      e.preventDefault();
      void this.addNoteAt(e.clientX, e.clientY);
    } else if (this.tool === "none") {
      // With no tool chosen, a click on a mark removes it. Deliberately not a
      // modifier: the toolbar has an eraser for the deliberate case, and this
      // is the shortcut most people will want.
      const hit = this.markAt(e.clientX, e.clientY);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        void this.removeAt(e.clientX, e.clientY);
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.drawingPointer !== e.pointerId) return;
    const page = this.doc.pageElement(this.doc.currentPage());
    if (!page) return;
    const point = this.pointFrom(e, page);
    if (!point || !isDistinctStrokePoint(this.liveStroke, point)) return;
    this.liveStroke.push(point);
    this.extendLiveStroke();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drawingPointer !== e.pointerId) return;
    this.drawingPointer = null;
    try {
      if (this.scroller.hasPointerCapture(e.pointerId)) {
        this.scroller.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Already released, which is the normal case when capture never took.
    }
    const points = this.liveStroke;
    this.liveStroke = [];
    this.liveNode?.remove();
    this.liveNode = null;
    // A tap is not a stroke. Saving one would leave a dot nobody drew.
    if (points.length < 2) return;
    const pageNumber = this.doc.currentPage();
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
        this.repaint();
      });
  };

  private pointFrom(e: PointerEvent, page: HTMLElement): Point | null {
    const box = page.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
    };
  }

  private beginLiveStroke(page: HTMLElement): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mark mark-draw live");
    const box = page.getBoundingClientRect();
    svg.style.left = `${box.left}px`;
    svg.style.top = `${box.top}px`;
    svg.style.width = `${box.width}px`;
    svg.style.height = `${box.height}px`;
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
