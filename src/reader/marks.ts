import { api, type Annotation } from "../api";
import { askText, askYesNo } from "../dialogs";
import {
  findQuoteRanges,
  isDistinctStrokePoint,
  mergeRects,
  parsePoints,
  parseRects,
  pointsToJson,
  rectsToJson,
  toPageRect,
  visibleRectsForRanges,
  type Point,
  type Rect,
} from "../annotations";
import { boxFromView, boxToView, pointFromView, pointToView, type Rotation } from "./rotation";

/**
 * Highlights, notes and drawings on the page.
 *
 * Every page gets its own layer, and a mark is drawn on the layer of the page
 * it belongs to, positioned in percentages of that page. On a PDF the layer is
 * a child of the page element itself; an EPUB chapter is an iframe, which
 * cannot hold children, so its layer sits over the frame as a sibling inside
 * the chapter list. Either way the layer is inside the scrolled content, so a
 * mark moves with its page when the reader scrolls, zooms or resizes the
 * window, with nothing having to reposition it.
 *
 * This replaced a single overlay outside the document that drew only the page
 * at the top of the pane. That had three consequences, all of which looked
 * like "the highlighter does not work": a selection on any other visible page
 * was refused; marks on the lower of two visible pages were not drawn; and
 * marks stayed put while the page scrolled under them until scrolling
 * stopped. The overlay also sat outside the scroller, so a click on a mark
 * never reached the scroller's handlers at all.
 *
 * Drawing is pointer-captured, so a stroke that leaves the page, crosses the
 * sidebar, or outruns the pointer still finishes where it started rather than
 * jumping.
 */

/** What the toolbar has selected. */
export type MarkTool = "none" | "highlight" | "note" | "draw" | "erase" | "pin";

/** How far round the eraser rubs out, as a fraction of the page's width. */
const ERASER = 0.014;

/** Colours offered, chosen to stay legible over a mostly white page. */
export const MARK_COLOURS = [
  { value: "#ffd60a", label: "Yellow" },
  { value: "#46a758", label: "Green" },
  { value: "#5aa9f7", label: "Blue" },
  { value: "#e5484d", label: "Red" },
  { value: "#c77dff", label: "Purple" },
];

/** How far a press may travel and still count as a click on a mark. */
const CLICK_SLOP = 5;

export class MarkLayer {
  private scroller: HTMLElement;
  private patternId: string;
  private doc: MarkTarget;
  /** The layer each page's marks are drawn on, by page number. */
  private hosts = new Map<number, HTMLElement>();

  private marks: Annotation[] = [];
  private tool: MarkTool = "none";
  private colour = MARK_COLOURS[0].value;

  /** The stroke in progress, and the node drawing it. */
  private liveStroke: Point[] = [];
  private liveNode: SVGSVGElement | null = null;
  private drawingPointer: number | null = null;
  /** The page a stroke started on, which is where it is saved even if the
   * pointer wanders onto another page mid-drag. */
  private drawingPage = 0;
  /** Which pen the stroke in progress is: the thin pen, or the highlighter. */
  private drawingKind: "draw" | "highlight" = "draw";
  /** The element holding pointer capture for the stroke, if capture took. */
  private captureEl: Element | null = null;
  /**
   * A press on a mark with Select, waiting to see whether it is a click.
   *
   * Acting on the press itself -- as this used to -- meant a drag that merely
   * started on a highlight opened "Remove this highlight?" instead of selecting
   * the words, so text that had been highlighted once could never be selected
   * again. Only a press that comes back up where it went down is a click.
   */
  private pendingClick: { pointer: number; x: number; y: number; id: string } | null = null;
  /**
   * A mark being moved, or resized by its corner, with Select: what it was,
   * on the page as shown, so each move works from there rather than adding up.
   */
  private grabbed: { pointer: number; x: number; y: number; id: string; mode: "move" | "size"; stored: string; page: HTMLElement; moved: boolean } | null = null;
  /**
   * The eraser being dragged: each drawing it has touched, as it was, and the
   * pieces of it still left, on the page as shown. Saved on release.
   */
  private erasing: { pointer: number; n: number; page: HTMLElement; base: Map<string, Annotation>; parts: Map<string, Point[][]> } | null = null;
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
  onPinSelect: ((e: PointerEvent, page: HTMLElement, pageNumber: number) => void) | null = null;

  /**
   * Called whenever a mark is added or removed, so the toolbar can grey out
   * Undo and Clear when there is nothing left to act on.
   */
  onChange: (() => void) | null = null;

  constructor(scroller: HTMLElement, patternId: string, doc: MarkTarget) {
    this.scroller = scroller;
    this.patternId = patternId;
    this.doc = doc;

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

  attach(): void {
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
    for (const host of this.hosts.values()) host.remove();
    this.hosts.clear();
  }

  setTool(tool: MarkTool): void {
    this.tool = tool;
    this.scroller.classList.toggle("mark-tool-draw", tool === "draw" || tool === "highlight");
    this.scroller.classList.toggle("mark-tool-pick", tool === "none");
    this.scroller.classList.toggle("mark-tool-erase", tool === "erase");
  }

  get currentTool(): MarkTool {
    return this.tool;
  }

  setColour(colour: string): void {
    this.colour = colour;
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

  // ---------- pages ----------

  /** Every page that is laid out, in order. */
  private *pages(): Generator<[number, HTMLElement]> {
    for (let n = 1; ; n++) {
      const el = this.doc.pageElement(n);
      if (!el) return;
      yield [n, el];
    }
  }

  /** The page under a point in the outer viewport, if there is one. */
  private pageAt(x: number, y: number): [number, HTMLElement] | null {
    for (const [n, el] of this.pages()) {
      const box = el.getBoundingClientRect();
      // Pages run top to bottom, so once one starts below the point, none of
      // the rest can contain it.
      if (box.top > y) break;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return [n, el];
    }
    return null;
  }

  /**
   * The layer a page's marks are drawn on, made the first time it is needed.
   *
   * On a PDF it is a child of the page, so it is the page's size wherever the
   * page is. An EPUB frame cannot hold children, so there the layer is placed
   * over the frame in the chapter list, and moved whenever the chapters
   * reflow -- which is when this is called again.
   */
  private hostFor(n: number, page: HTMLElement): HTMLElement {
    let host = this.hosts.get(n);
    const frame = page instanceof HTMLIFrameElement;
    const parent = frame ? page.parentElement : page;
    if (!host || host.parentElement !== parent) {
      host?.remove();
      host = document.createElement("div");
      host.className = "page-marks";
      host.dataset.page = String(n);
      parent?.appendChild(host);
      this.hosts.set(n, host);
    }
    if (frame) {
      host.style.inset = "auto";
      host.style.left = `${page.offsetLeft}px`;
      host.style.top = `${page.offsetTop}px`;
      host.style.width = `${page.offsetWidth}px`;
      host.style.height = `${page.offsetHeight}px`;
    }
    return host;
  }

  // ---------- painting ----------

  /**
   * Redraws every page's marks.
   *
   * Called when marks change and when the document's layout changes. Not on
   * scroll: the layers are inside the scrolled content, so they already move
   * with it.
   */
  repaint(): void {
    const byPage = new Map<number, Annotation[]>();
    for (const mark of this.marks) {
      const list = byPage.get(mark.page);
      if (list) list.push(mark);
      else byPage.set(mark.page, [mark]);
    }
    // A page whose last mark was removed still has that mark drawn.
    for (const [n, host] of this.hosts) {
      if (!byPage.has(n)) clearPainted(host);
    }
    for (const [n, marks] of byPage) {
      const page = this.doc.pageElement(n);
      if (!page) continue;
      const host = this.hostFor(n, page);
      clearPainted(host);
      // An EPUB's text has moved since the mark was made, so its rectangles
      // are worked out again from the quote rather than read back. A PDF's have
      // not, and a stored rectangle is exact and costs nothing.
      const reflowing = page instanceof HTMLIFrameElement;
      const text = reflowing ? this.doc.textLayerFor(n) : null;
      for (const stored of marks) {
        const mark = this.shown(stored);
        if (isStroke(mark)) {
          this.paintDrawing(mark, host, page);
        } else if (reflowing && mark.kind === "highlight" && mark.quote) {
          if (!text) continue;
          const ranges = findQuoteRanges(text, mark.quote, mark.occurrence);
          // Gone after an edit, or outside the chapter's box mid-reflow: drawn
          // nowhere rather than against the page edge.
          if (ranges.length) this.paintRects(mark, host, visibleRectsForRanges(ranges, page));
        } else {
          this.paintRects(mark, host, mark.kind === "note" ? noteRects(mark) : parseRects(mark.geometry));
        }
      }
    }
  }

  /** How far a page is turned; an EPUB chapter never is. */
  private turnOf(page: number): Rotation {
    return this.doc.rotationOf?.(page) ?? 0;
  }

  /**
   * A mark as it shows on its page: stored upright, and turned here to match
   * a page the reader has rotated. See rotation.ts.
   */
  private shown(mark: Annotation): Annotation {
    const r = this.turnOf(mark.page);
    if (!r) return mark;
    const geometry = isStroke(mark)
      ? pointsToJson(parsePoints(mark.geometry).map((p) => pointToView(p, r)))
      : rectsToJson(parseRects(mark.geometry).map((b) => boxToView(b, r)));
    return { ...mark, geometry };
  }

  private paintRects(mark: Annotation, host: HTMLElement, rects: Rect[]): void {
    for (const rect of rects) {
      const el = document.createElement("div");
      el.className = `mark mark-${mark.kind}`;
      el.style.left = pct(rect.x);
      el.style.top = pct(rect.y);
      el.style.width = pct(rect.w);
      el.style.height = pct(rect.h);
      el.style.setProperty("--mark-colour", mark.color);
      el.dataset.id = mark.id;
      if (mark.kind === "note") el.title = mark.text || "Note";
      host.appendChild(el);
    }
  }

  private paintDrawing(mark: Annotation, host: HTMLElement, page: HTMLElement): void {
    const points = parsePoints(mark.geometry);
    if (points.length < 2) return;
    const svg = strokeSvg(mark.color, mark.kind === "highlight", page);
    svg.dataset.id = mark.id;
    setStroke(svg, points);
    host.appendChild(svg);
  }

  // ---------- notes and removal ----------

  /** Places a note where the reader clicked, asking for its text first. */
  async addNoteAt(x: number, y: number, pageNumber: number): Promise<boolean> {
    const page = this.doc.pageElement(pageNumber);
    if (!page) return false;
    const box = page.getBoundingClientRect();
    const text = await askText("Note:");
    if (text === null) return false;

    const rect: Rect = {
      x: Math.max(0, Math.min(1, (x - box.left) / (box.width || 1))),
      y: Math.max(0, Math.min(1, (y - box.top) / (box.height || 1))),
      // A note is a marker, not a block of text, so it gets a small fixed size
      // in page fractions.
      w: 0.03,
      h: 0.022,
    };
    const created = await api.addAnnotation(this.patternId, {
      kind: "note",
      page: pageNumber,
      // Measured on the page as shown, stored upright.
      geometry: rectsToJson([boxFromView(rect, this.turnOf(pageNumber))]),
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
   * Removes a mark, after asking.
   *
   * A single click deleting work with no undo would be a nasty surprise, so it
   * confirms first.
   */
  private async removeMark(mark: Annotation): Promise<boolean> {
    if (!(await askYesNo(`Remove ${describeMark(mark)}?`, { okLabel: "Remove", danger: true }))) {
      return false;
    }
    await this.removeById(mark.id);
    this.repaint();
    return true;
  }

  /**
   * Opens a note for reading and editing.
   *
   * Notes are the one mark with something to say, so clicking one opens it
   * rather than offering to delete it: a note you can only create and destroy
   * is not much use once you have thought of a better wording.
   */
  private editNote(mark: Annotation): void {
    this.closeNotePopover();

    const pop = document.createElement("div");
    pop.className = "note-popover";
    const textarea = document.createElement("textarea");
    textarea.value = mark.text;
    textarea.rows = 4;
    textarea.setAttribute("aria-label", "Note text");

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const save = button("Save", "primary");
    const remove = button("Remove", "danger");
    const close = button("Close", "ghost");
    actions.append(save, remove, close);
    pop.append(textarea, actions);

    const anchor = this.scroller.querySelector<HTMLElement>(`.mark[data-id="${mark.id}"]`);
    const box = (anchor ?? this.scroller).getBoundingClientRect();
    pop.style.left = `${Math.min(box.left, window.innerWidth - 300)}px`;
    pop.style.top = `${Math.min(box.bottom + 8, window.innerHeight - 220)}px`;
    // Fixed-positioned, and mounted outside the scrolled content so a repaint
    // of the page's layer cannot take the textarea away mid-sentence.
    (this.scroller.parentElement ?? document.body).appendChild(pop);
    this.notePopover = pop;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    save.addEventListener("click", async () => {
      const text = textarea.value.trim();
      // An emptied note is a note the user changed their mind about, so it is
      // removed rather than left as an empty dot.
      if (!text) {
        await this.removeById(mark.id);
      } else {
        await api.editAnnotation(mark.id, text, mark.color);
        const stored = this.marks.find((m) => m.id === mark.id);
        if (stored) stored.text = text;
      }
      this.closeNotePopover();
      this.repaint();
    });
    remove.addEventListener("click", async () => {
      this.closeNotePopover();
      // Asked from the note editor rather than over it, so the popover is not
      // left hanging behind a question it cannot answer.
      await this.removeMark(mark);
    });
    close.addEventListener("click", () => this.closeNotePopover());

    // Clicking elsewhere dismisses, on the next tick so the click that opened
    // this does not immediately close it. The listener is remembered so
    // closeNotePopover can always take it back.
    const dismiss = (e: MouseEvent) => {
      if (pop.contains(e.target as Node)) return;
      this.closeNotePopover();
    };
    this.noteDismiss = dismiss;
    setTimeout(() => {
      if (this.noteDismiss === dismiss) document.addEventListener("click", dismiss);
    }, 0);
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

  /** The topmost mark under a point in the outer viewport, or null. */
  markAt(x: number, y: number): Annotation | null {
    const hit = this.pageAt(x, y);
    if (!hit) return null;
    const [n, page] = hit;
    const box = page.getBoundingClientRect();
    const px = (x - box.left) / (box.width || 1);
    const py = (y - box.top) / (box.height || 1);
    for (const mark of [...this.marks].reverse()) {
      if (mark.page !== n) continue;
      // Strokes are lines, so the hit area is grown to something a finger can
      // actually hit -- and a highlighter band is broader than a pen line.
      const pad = !isStroke(mark) ? 0 : mark.kind === "highlight" ? 0.012 : 0.01;
      for (const r of this.hitRects(mark, n, page)) {
        if (px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad) {
          return mark;
        }
      }
    }
    return null;
  }

  /** Whether a mark can be moved, or resized by its corner, from where it was pressed. */
  private grabMode(mark: Annotation, x: number, y: number, page: HTMLElement): "move" | "size" | null {
    const textHighlight = mark.kind === "highlight" && !isStroke(mark) && !!mark.quote;
    if (textHighlight) return null;
    const box = page.getBoundingClientRect();
    const bounds = this.viewBounds(mark);
    if (!bounds) return null;
    const right = box.left + (bounds.x + bounds.w) * box.width;
    const bottom = box.top + (bounds.y + bounds.h) * box.height;
    const corner = Math.abs(x - right) <= 12 && Math.abs(y - bottom) <= 12;
    return corner && mark.kind !== "note" ? "size" : "move";
  }

  /** The box round a mark on its page as shown, in fractions of the page. */
  private viewBounds(stored: Annotation): Rect | null {
    const mark = this.shown(stored);
    const rects = isStroke(mark) ? boundsOf(parsePoints(mark.geometry)) : mark.kind === "note" ? noteRects(mark) : parseRects(mark.geometry);
    if (!rects.length) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  }

  /** Moves or resizes the grabbed mark under the pointer, from where it was. */
  private dragMark(e: PointerEvent): void {
    const g = this.grabbed!;
    if (e.pointerId !== g.pointer) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= CLICK_SLOP) return;
    g.moved = true;
    const mark = this.marks.find((m) => m.id === g.id);
    if (!mark) return;
    const box = g.page.getBoundingClientRect();
    const dx = (e.clientX - g.x) / (box.width || 1);
    const dy = (e.clientY - g.y) / (box.height || 1);
    const r = this.turnOf(mark.page);
    const from = this.shown({ ...mark, geometry: g.stored });
    const bounds = this.viewBounds({ ...mark, geometry: g.stored })!;
    // Resized from the top-left corner, which stays put; never smaller than a sliver.
    const sx = g.mode === "size" ? Math.max(0.02, bounds.w + dx) / Math.max(0.001, bounds.w) : 1;
    const sy = g.mode === "size" ? Math.max(0.02, bounds.h + dy) / Math.max(0.001, bounds.h) : 1;
    const mx = g.mode === "move" ? dx : 0;
    const my = g.mode === "move" ? dy : 0;
    const fx = (v: number) => bounds.x + (v - bounds.x) * sx + mx;
    const fy = (v: number) => bounds.y + (v - bounds.y) * sy + my;
    mark.geometry = isStroke(mark)
      ? pointsToJson(parsePoints(from.geometry).map((p) => pointFromView({ x: fx(p.x), y: fy(p.y) }, r)))
      : rectsToJson(parseRects(from.geometry).map((b) => boxFromView({ x: fx(b.x), y: fy(b.y), w: b.w * sx, h: b.h * sy }, r)));
    this.repaint();
  }

  /**
   * Rubs out what is under the eraser: each drawing on the page loses the
   * points within reach, splitting where the eraser went through it. Shown at
   * once; kept on release.
   */
  private eraseAt(x: number, y: number): void {
    const er = this.erasing!;
    const at = pointFrom(x, y, er.page);
    if (!at) return;
    const box = er.page.getBoundingClientRect();
    const ry = (ERASER * box.width) / (box.height || 1);
    const near = (p: Point) => ((p.x - at.x) / ERASER) ** 2 + ((p.y - at.y) / ry) ** 2 <= 1;
    let changed = false;
    for (const mark of this.marks) {
      if (mark.page !== er.n || !isStroke(mark) || mark.id.startsWith("erase:")) continue;
      const base = er.base.get(mark.id) ?? mark;
      const parts = er.parts.get(mark.id) ?? [parsePoints(this.shown(base).geometry)];
      if (!parts.some((part) => part.some(near))) continue;
      er.base.set(mark.id, base);
      const next: Point[][] = [];
      for (const part of parts) {
        let run: Point[] = [];
        for (const p of part) {
          if (near(p)) {
            if (run.length >= 2) next.push(run);
            run = [];
          } else run.push(p);
        }
        if (run.length >= 2) next.push(run);
      }
      er.parts.set(mark.id, next);
      changed = true;
    }
    if (changed) this.previewErasing();
  }

  /** The drawings as the eraser has left them, in place of how they were. */
  private previewErasing(): void {
    const er = this.erasing!;
    const touched = new Set(er.base.keys());
    this.marks = this.marks.filter((m) => !touched.has(m.id) && !(m.id.startsWith("erase:") && touched.has(m.id.split(":")[1])));
    for (const [id, parts] of er.parts) {
      const base = er.base.get(id)!;
      const r = this.turnOf(base.page);
      parts.forEach((part, i) => {
        this.marks.push({ ...base, id: i === 0 ? id : `erase:${id}:${i}`, geometry: pointsToJson(part.map((p) => pointFromView(p, r))) });
      });
    }
    this.repaint();
  }

  /** Keeps what the eraser did: a drawing gone, cut shorter, or in pieces. */
  private async finishErasing(): Promise<void> {
    const er = this.erasing!;
    this.erasing = null;
    try {
      if (this.scroller.hasPointerCapture(er.pointer)) this.scroller.releasePointerCapture(er.pointer);
    } catch {
      // Already released.
    }
    for (const [id, parts] of er.parts) {
      const base = er.base.get(id)!;
      try {
        if (!parts.length) {
          await api.deleteAnnotation(id);
          continue;
        }
        const first = this.marks.find((m) => m.id === id);
        if (first) Object.assign(first, await api.moveAnnotation(id, first.geometry));
        for (let i = 1; i < parts.length; i++) {
          const piece = this.marks.find((m) => m.id === `erase:${id}:${i}`);
          if (!piece) continue;
          const created = await api.addAnnotation(this.patternId, {
            kind: base.kind,
            page: base.page,
            geometry: piece.geometry,
            quote: "",
            occurrence: 0,
            color: base.color,
            text: "",
          });
          Object.assign(piece, created);
        }
      } catch {
        // What could not be kept is shown as it is stored.
        await this.refresh();
        return;
      }
    }
    this.onChange?.();
    this.repaint();
  }

  /** With Select, the pointer says what a press on a mark would do: move it, or size it by its corner. */
  private hoverCursor(e: PointerEvent): void {
    if (this.tool !== "none" || this.drawingPointer !== null) return;
    const hit = this.pageAt(e.clientX, e.clientY);
    const mark = hit ? this.markAt(e.clientX, e.clientY) : null;
    const mode = mark && hit ? this.grabMode(mark, e.clientX, e.clientY, hit[1]) : null;
    const cursor = mode === "size" ? "nwse-resize" : mode === "move" ? "move" : "";
    if (this.scroller.style.cursor !== cursor) this.scroller.style.cursor = cursor;
  }

  /**
   * The rectangles a mark is hit-tested against.
   *
   * An EPUB highlight is redrawn from its quote, because the text reflows;
   * testing against the geometry stored at save time would accept clicks
   * wherever the passage used to be. So a reflowed mark is tested against the
   * same re-found rectangles it is drawn from. Everything else is fixed
   * geometry and is tested as stored.
   */
  private hitRects(stored: Annotation, n: number, page: HTMLElement): Rect[] {
    const mark = this.shown(stored);
    if (isStroke(mark)) return boundsOf(parsePoints(mark.geometry));
    if (mark.kind === "note") return noteRects(mark);
    if (page instanceof HTMLIFrameElement) {
      const text = this.doc.textLayerFor(n);
      const ranges = text && mark.quote ? findQuoteRanges(text, mark.quote, mark.occurrence) : [];
      return ranges.length ? visibleRectsForRanges(ranges, page) : [];
    }
    return parseRects(mark.geometry);
  }

  // ---------- pointer ----------

  private onDragStart = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Presses inside a chapter frame are handled by that frame's own
    // listeners; this one sees presses on the outer document only.
    this.pointerDown(e, 0, 0, this.pageAt(e.clientX, e.clientY));
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.grabbed) return this.dragMark(e);
    if (this.erasing && this.erasing.pointer === e.pointerId) return this.eraseAt(e.clientX, e.clientY);
    this.hoverCursor(e);
    this.pointerMove(e, 0, 0);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.erasing && this.erasing.pointer === e.pointerId) return void this.finishErasing();
    const grabbed = this.grabbed;
    if (grabbed && grabbed.pointer === e.pointerId) {
      this.grabbed = null;
      if (grabbed.moved) {
        // Moved or resized, not clicked: kept, and nothing asked.
        this.pendingClick = null;
        const mark = this.marks.find((m) => m.id === grabbed.id);
        if (mark) {
          void api
            .moveAnnotation(mark.id, mark.geometry)
            .then((stored) => Object.assign(mark, stored))
            .catch(() => {
              mark.geometry = grabbed.stored;
              this.repaint();
            });
        }
        return;
      }
    }
    const pending = this.pendingClick;
    if (pending && pending.pointer === e.pointerId) {
      this.pendingClick = null;
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      const mark = this.marks.find((m) => m.id === pending.id);
      if (moved <= CLICK_SLOP && mark) {
        if (mark.kind === "note") this.editNote(mark);
        else void this.removeMark(mark);
      }
    }

    if (this.drawingPointer !== e.pointerId) return;
    this.drawingPointer = null;
    // The live state is reset before anything that can throw, so a stroke is
    // never left half-drawn on screen when the release comes without capture.
    const points = this.liveStroke;
    const pageNumber = this.drawingPage;
    const kind = this.drawingKind;
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
    // there. A highlighter stroke is stored as a highlight whose geometry is
    // points rather than rectangles -- see isMarkerStroke.
    void api
      .addAnnotation(this.patternId, {
        kind,
        page: pageNumber,
        // Measured on the page as shown, stored upright.
        geometry: pointsToJson(points.map((p) => pointFromView(p, this.turnOf(pageNumber)))),
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

  /**
   * One press, from the outer document or a chapter frame.
   *
   * `dx`/`dy` translate a frame's coordinates into the outer viewport the
   * marks are measured in; `hit` is the page under the press, if any.
   */
  private pointerDown(e: PointerEvent, dx: number, dy: number, hit: [number, HTMLElement] | null): void {
    if (e.button !== 0) return;
    const x = e.clientX + dx;
    const y = e.clientY + dy;
    // Never start a mark on the highlight line or the counter: those have their
    // own drag behaviour and a mark under them would be unreachable.
    if ((e.target as HTMLElement).closest?.(".highlight-line, .highlight-layer")) return;

    if (this.tool === "none") {
      // With no tool chosen, a click on a mark does something useful to it: a
      // note opens for editing, anything else offers to be removed. Decided on
      // release, so that a drag starting on a mark still selects text.
      const mark = this.markAt(x, y);
      this.pendingClick = mark ? { pointer: e.pointerId, x: e.clientX, y: e.clientY, id: mark.id } : null;
      // A drawing, a note or a box can be moved, and a drawing or a box resized
      // by its corner; text highlights stay with their words.
      const page = hit?.[1];
      const mode = mark && page && dx === 0 && dy === 0 ? this.grabMode(mark, x, y, page) : null;
      if (mark && page && mode) {
        e.preventDefault();
        this.grabbed = { pointer: e.pointerId, x, y, id: mark.id, mode, stored: mark.geometry, page, moved: false };
        try {
          this.scroller.setPointerCapture(e.pointerId);
        } catch {
          // It still moves while the pointer stays over the page.
        }
      }
      return;
    }
    if (!hit) return;
    const [n, page] = hit;

    if (this.tool === "pin") {
      // A pin is a crop of the page rather than a mark drawn on it, so the pin
      // layer owns the drag. It is reached through here so that one tool is
      // active at a time.
      e.preventDefault();
      this.onPinSelect?.(e, page, n);
    } else if (this.tool === "draw" || this.tool === "highlight") {
      const point = pointFrom(x, y, page);
      if (!point) return;
      e.preventDefault();
      this.drawingPointer = e.pointerId;
      this.drawingPage = n;
      this.drawingKind = this.tool;
      this.liveStroke = [point];
      // Capture keeps the stroke coming when the pointer leaves the page, which
      // is what stops a long drag from jumping. It is an improvement, not a
      // requirement: it throws if the pointer is already gone. Inside an EPUB
      // chapter the scroller cannot capture the frame's pointer, so the element
      // under the press captures it within the frame instead.
      this.captureEl = null;
      try {
        const target = page instanceof HTMLIFrameElement ? (e.target as Element) : this.scroller;
        target.setPointerCapture(e.pointerId);
        this.captureEl = target;
      } catch {
        // Drawing still works; it just stops at the edge of the page.
      }
      this.beginLiveStroke(n, page);
    } else if (this.tool === "note") {
      e.preventDefault();
      void this.addNoteAt(x, y, n);
    } else if (this.tool === "erase" && !(page instanceof HTMLIFrameElement)) {
      e.preventDefault();
      this.erasing = { pointer: e.pointerId, n, page, base: new Map(), parts: new Map() };
      try {
        this.scroller.setPointerCapture(e.pointerId);
      } catch {
        // It still rubs out while the pointer stays over the page.
      }
      this.eraseAt(x, y);
    }
  }

  private pointerMove(e: PointerEvent, dx: number, dy: number): void {
    if (this.drawingPointer !== e.pointerId) return;
    const page = this.doc.pageElement(this.drawingPage);
    if (!page) return;
    const point = pointFrom(e.clientX + dx, e.clientY + dy, page);
    if (!point || !isDistinctStrokePoint(this.liveStroke, point)) return;
    this.liveStroke.push(point);
    this.extendLiveStroke();
  }

  private beginLiveStroke(n: number, page: HTMLElement): void {
    const svg = strokeSvg(this.colour, this.drawingKind === "highlight", page);
    svg.classList.add("live");
    this.hostFor(n, page).appendChild(svg);
    this.liveNode = svg;
    this.extendLiveStroke();
  }

  private extendLiveStroke(): void {
    if (this.liveNode) setStroke(this.liveNode, this.liveStroke);
  }

  // ---------- EPUB chapter frames ----------

  /**
   * Wires the tool listeners into every EPUB chapter frame.
   *
   * Pointer events inside a chapter's iframe are dispatched to the frame's own
   * document and never reach the scroller, so without this every tool is dead
   * on an EPUB. The
   * handlers are the same ones the scroller uses; only the coordinates are
   * translated, from the frame's viewport into the outer one the marks are
   * measured in.
   */
  private attachFrames(): void {
    for (const [, el] of this.pages()) {
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

    const unbind = () => {
      if (!wired) return;
      wired.removeEventListener("pointerdown", onDown);
      wired.removeEventListener("pointermove", onMove);
      wired.removeEventListener("pointerup", onUp);
      wired.removeEventListener("pointercancel", onUp);
      wired.removeEventListener("dragstart", onDrag);
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
    };
    bind();
    frame.addEventListener("load", bind);
    this.frameTeardowns.push(() => {
      unbind();
      frame.removeEventListener("load", bind);
    });
  }

  /** The page a chapter frame renders, so a mark lands on the right page. */
  private pageForFrame(frame: HTMLIFrameElement): number | null {
    for (const [n, el] of this.pages()) {
      if (el === frame) return n;
    }
    return null;
  }

  private framePointerDown(frame: HTMLIFrameElement, e: PointerEvent): void {
    const box = frame.getBoundingClientRect();
    const n = this.pageForFrame(frame);
    this.pointerDown(e, box.left, box.top, n === null ? null : [n, frame]);
  }

  private framePointerMove(frame: HTMLIFrameElement, e: PointerEvent): void {
    const box = frame.getBoundingClientRect();
    this.pointerMove(e, box.left, box.top);
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
  /** How far the reader has turned a page; absent for a document that cannot turn. */
  rotationOf?(page: number): Rotation;
}

/** Removes a layer's drawn marks, leaving a stroke still being drawn alone. */
function clearPainted(host: HTMLElement): void {
  host.querySelectorAll(".mark:not(.live)").forEach((el) => el.remove());
}

const pct = (n: number): string => `${n * 100}%`;

/**
 * A highlighter stroke: a highlight whose geometry is stroke points rather
 * than rectangles.
 *
 * Stored under the existing highlight kind, so no new kind is needed on the
 * backend, and a build from before the highlighter existed skips these rather
 * than misreading them -- it parses highlight geometry as rectangles, and a
 * point has no width.
 */
function isMarkerStroke(mark: Annotation): boolean {
  if (mark.kind !== "highlight") return false;
  try {
    const geometry: unknown = JSON.parse(mark.geometry);
    return Array.isArray(geometry) && geometry.length > 0 && !("w" in geometry[0]);
  } catch {
    return false;
  }
}

/** A pen drawing or a highlighter stroke: anything drawn as a line. */
const isStroke = (mark: Annotation): boolean => mark.kind === "draw" || isMarkerStroke(mark);

/**
 * An svg covering the whole page, for one stroke.
 *
 * A pen line is thin and stays the same width on screen at any zoom. A
 * highlighter band has to cover the same words at any zoom, so its width is in
 * page units -- and a width in page units only scales evenly if the viewBox has
 * the page's own proportions, which is what `aspect` is for. The points are
 * still page fractions; `setStroke` stretches y to match.
 */
function strokeSvg(colour: string, marker: boolean, page: HTMLElement): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", marker ? "mark mark-draw marker" : "mark mark-draw");
  const aspect = marker ? page.offsetHeight / (page.offsetWidth || 1) || 1 : 1;
  svg.setAttribute("viewBox", `0 0 1 ${aspect}`);
  svg.dataset.aspect = String(aspect);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.setProperty("--mark-colour", colour);
  return svg;
}

/** Draws (or redraws) a stroke's points into its svg. */
function setStroke(svg: SVGSVGElement, points: Point[]): void {
  const aspect = Number(svg.dataset.aspect) || 1;
  const path =
    svg.querySelector("path") ??
    svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
  const scaled = aspect === 1 ? points : points.map((p) => ({ x: p.x, y: p.y * aspect }));
  path.setAttribute("d", toPath(scaled));
  if (!svg.classList.contains("marker")) path.setAttribute("vector-effect", "non-scaling-stroke");
}

function pointFrom(x: number, y: number, page: HTMLElement): Point | null {
  const box = page.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
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
