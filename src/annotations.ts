/**
 * Where a mark lives on a page, and how to find it again.
 *
 * Two documents, two coordinate systems, because they behave nothing alike.
 *
 * **PDF** pages are fixed. A rectangle is stored in normalised page
 * coordinates — 0..1 on each axis, relative to the page itself — so a
 * highlight stays exactly where it was put when the window is resized, the
 * page is zoomed, or the reader is opened on a different screen. Nothing about
 * the page is known at save time beyond its size.
 *
 * **EPUB** text reflows. The same text on a phone and on a monitor wraps at
 * different points, so a stored rectangle would point at the wrong words
 * entirely. A mark on an EPUB is therefore stored as *what was marked* — the
 * text, and which occurrence of it — and the rectangle is worked out afresh
 * each time it is drawn. That is what makes a highlight survive a change of
 * window size on a reflowable document.
 *
 * Geometry is stored as a JSON string, matching the backend's column.
 */

/** One rectangle in normalised page coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in normalised page coordinates, as a drawing stroke is stored. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle in viewport pixels, as the browser reports it. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Converts a rectangle from viewport pixels into normalised page coordinates.
 *
 * `page` is the element the page is painted into, which is what both
 * coordinate systems are relative to. Clamping to 0..1 matters: a selection
 * that runs past the edge of a page, which happens when a paragraph straddles
 * a page break, would otherwise store a rectangle that draws nowhere.
 */
export function toPageRect(rect: ClientRect, page: HTMLElement): Rect {
  const box = page.getBoundingClientRect();
  // A zero-sized page would divide by zero and produce Infinity, which
  // serialises to null and comes back as a mark that cannot be drawn.
  const w = box.width || 1;
  const h = box.height || 1;
  return {
    x: clamp01((rect.left - box.left) / w),
    y: clamp01((rect.top - box.top) / h),
    w: clamp01(rect.width / w),
    h: clamp01(rect.height / h),
  };
}

/** The inverse: normalised page coordinates back to viewport pixels. */
export function fromPageRect(rect: Rect, page: HTMLElement): ClientRect {
  const box = page.getBoundingClientRect();
  return {
    left: box.left + rect.x * box.width,
    top: box.top + rect.y * box.height,
    width: rect.w * box.width,
    height: rect.h * box.height,
  };
}

/** True when a stored rectangle is usable, so junk can be skipped on load. */
export function isUsableRect(rect: unknown): rect is Rect {
  if (!rect || typeof rect !== "object") return false;
  const r = rect as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number" &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    r.w > 0 &&
    r.h > 0
  );
}

/** Parses stored geometry, dropping anything unusable rather than throwing. */
export function parseRects(geometry: string): Rect[] {
  try {
    const parsed: unknown = JSON.parse(geometry);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUsableRect);
  } catch {
    // A row written by a version that stored a different shape should cost
    // that one mark, not the whole document.
    return [];
  }
}

export function parsePoints(geometry: string): Point[] {
  try {
    const parsed: unknown = JSON.parse(geometry);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Point =>
        !!p &&
        typeof p === "object" &&
        typeof (p as Point).x === "number" &&
        typeof (p as Point).y === "number" &&
        Number.isFinite((p as Point).x) &&
        Number.isFinite((p as Point).y),
    );
  } catch {
    return [];
  }
}

export const rectsToJson = (rects: Rect[]): string => JSON.stringify(rects);
export const pointsToJson = (points: Point[]): string => JSON.stringify(points);

/**
 * Finds the ranges a quote covers inside a container.
 *
 * Used for EPUB text, where the marked text lives in the chapter's iframe and
 * has to be re-found rather than remembered. Matching is done on the container's
 * own text with whitespace collapsed, because the DOM's text nodes split words
 * and newlines in ways that have nothing to do with what the reader sees.
 *
 * `occurrence` picks which match to use when the same words appear more than
 * once — "row 1" and "with wrong side facing" both do — and it is the one part
 * of a mark that survives the text reflowing, since the order of occurrences
 * does not change when the line breaks do.
 *
 * Returns one range per piece of text node the quote covers, so a selection
 * spanning a tag boundary comes back as several ranges rather than one that
 * silently covers the wrong words.
 */
export function findQuoteRanges(container: HTMLElement, quote: string, occurrence: number): Range[] {
  const wanted = normalise(quote);
  if (!wanted) return [];
  const nth = Math.max(0, Math.floor(occurrence) || 0);

  // Walk the text nodes in order, building a map from the collapsed string
  // back to the node and offset it came from. Without this, an index into the
  // string means nothing to the DOM.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; start: number; text: string }[] = [];
  let flat = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!text) continue;
    // Collapse the same way the comparison does, so the offsets line up.
    const collapsed = text.replace(/\s+/g, " ");
    pieces.push({ node: node as Text, start: flat.length, text: collapsed });
    flat += collapsed;
  }
  const haystack = flat.replace(/\s+/g, " ").trim();
  if (!haystack.includes(wanted)) return [];

  // Find the nth occurrence.
  let from = 0;
  let index = -1;
  for (let n = 0; n <= nth; n++) {
    index = haystack.indexOf(wanted, from);
    if (index < 0) return [];
    from = index + wanted.length;
  }

  // Turn the character span into DOM ranges, splitting wherever the span
  // crosses a text-node boundary.
  const ranges: Range[] = [];
  let spanStart = index;
  const spanEnd = index + wanted.length;
  for (const piece of pieces) {
    const pieceStart = piece.start;
    const pieceEnd = piece.start + piece.text.length;
    if (pieceEnd <= spanStart || pieceStart >= spanEnd) continue;
    const from_ = Math.max(0, spanStart - pieceStart);
    const to = Math.min(piece.text.length, spanEnd - pieceStart);
    try {
      const range = document.createRange();
      range.setStart(piece.node, from_);
      range.setEnd(piece.node, to);
      ranges.push(range);
    } catch {
      // Offsets can fall outside a node whose text changed under us; skipping
      // that piece loses a fragment, not the mark.
    }
  }
  return ranges;
}

function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Which occurrence of a quote a selection is on.
 *
 * Built on `findQuoteRanges` deliberately, so the two cannot disagree about
 * what "the third occurrence" means. If saving counted matches one way and
 * drawing counted them another, a mark would be saved against one passage and
 * drawn over a different one, and nothing would look wrong until the text
 * reflowed.
 *
 * Walking the document with `compareDocumentPosition` rather than adding up
 * character offsets keeps this exact: a DOM position has to be compared with
 * another DOM position, and any index arithmetic in between is a chance to be
 * off by the length of a collapsed run of whitespace.
 *
 * Returns 0 for a quote that is not present, which is the best available
 * answer and makes a missing anchor fall back to the first match.
 */
export function occurrenceAt(container: HTMLElement, range: Range, quote: string): number {
  const wanted = normalise(quote);
  if (!wanted) return 0;

  // The answer is the last match that starts at or before the selection, which
  // is not the same as the first match after it: a selection made on a passage
  // starts exactly where that passage starts, so it is not "after" it and
  // would be skipped entirely.
  let best = 0;
  let matched = false;
  // Bounded so a pathological document cannot spin here: a passage is never
  // going to be the five-hundredth identical occurrence.
  for (let n = 0; n < 500; n++) {
    const candidate = findQuoteRanges(container, wanted, n);
    if (!candidate.length) break;
    if (startsAfter(candidate[0], range.startContainer, range.startOffset)) break;
    best = n;
    matched = true;
  }
  return matched ? best : 0;
}

/** True when a boundary sits strictly after a given position in the document. */
function startsAfter(boundary: Range, node: Node, offset: number): boolean {
  const other = boundary.startContainer;
  if (other === node) return boundary.startOffset > offset;
  // The argument preceding the reference means the reference comes later, which
  // is what is being asked.
  return (other.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

/**
 * The rectangles for a set of ranges that actually fall inside the page.
 *
 * Unlike `rectsForRanges`, a rectangle entirely outside the page is dropped
 * rather than clamped into it. That matters for a reflowable document: while a
 * chapter is re-laying out, or before its frame has been resized to fit, the
 * text a mark refers to can be outside the frame's visible box. Clamping would
 * then paint the mark against the wrong edge of the page, which looks like a
 * mark on the wrong words -- worse than no mark at all. A rectangle that
 * overhangs the edge slightly is still drawn, because that is just a
 * selection running past a margin.
 */
export function visibleRectsForRanges(ranges: Range[], page: HTMLElement): Rect[] {
  const box = page.getBoundingClientRect();
  const inside: Rect[] = [];
  for (const range of ranges) {
    for (const rect of range.getClientRects()) {
      const overlaps =
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top;
      if (!overlaps) continue;
      const r = toPageRect(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        page,
      );
      if (r.w > 0 && r.h > 0) inside.push(r);
    }
  }
  return mergeRects(inside);
}

/**
 * The rectangles for a set of ranges, relative to a page element.
 *
 * A range that spans a line break reports a rectangle covering both lines, so
 * ranges are split per client rect: that is what makes a highlight look like a
 * highlight rather than one tall block over the wrong words.
 */
export function rectsForRanges(ranges: Range[], page: HTMLElement): Rect[] {
  const out: Rect[] = [];
  for (const range of ranges) {
    for (const rect of range.getClientRects()) {
      const r = toPageRect(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        page,
      );
      // Zero-height rects come from collapsed whitespace and draw nothing.
      if (r.w > 0 && r.h > 0) out.push(r);
    }
  }
  return mergeRects(out);
}

/**
 * Merges rectangles that sit on the same line.
 *
 * A single word can come back as several rects when it is split across text
 * nodes, which would draw as two blocks with a seam between them. Two rects
 * belong to the same line when their vertical centres are within half a line
 * height; anything further apart is a different line and must stay separate.
 */
export function mergeRects(rects: Rect[]): Rect[] {
  if (rects.length < 2) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const rect of sorted) {
    const last = out[out.length - 1];
    const sameLine =
      last !== undefined && Math.abs(last.y + last.h / 2 - (rect.y + rect.h / 2)) < last.h * 0.5;
    if (last && sameLine) {
      const left = Math.min(last.x, rect.x);
      const top = Math.min(last.y, rect.y);
      out[out.length - 1] = {
        x: left,
        y: top,
        w: Math.max(last.x + last.w, rect.x + rect.w) - left,
        h: Math.max(last.y + last.h, rect.y + rect.h) - top,
      };
    } else {
      out.push({ ...rect });
    }
  }
  return out;
}

/** Drops points closer together than this, so a stroke is not thousands of points. */
export const STROKE_MIN_DISTANCE = 0.0015;

/** True when a new point is far enough from the last to be worth keeping. */
export function isDistinctStrokePoint(points: Point[], candidate: Point): boolean {
  const last = points[points.length - 1];
  if (!last) return true;
  return (
    Math.abs(last.x - candidate.x) >= STROKE_MIN_DISTANCE ||
    Math.abs(last.y - candidate.y) >= STROKE_MIN_DISTANCE
  );
}
