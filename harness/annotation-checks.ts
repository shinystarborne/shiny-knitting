/**
 * Checks for the annotation coordinate mapping.
 *
 * The geometry is the part of marking that has to be exactly right and is easy
 * to get quietly wrong: a mark that is a few pixels off looks fine at the
 * window size you tested it at and lands on the wrong words at any other. So
 * these run against real DOM elements laid out by the browser, not against
 * mocked rectangles, because the rounding and clamping only misbehave when
 * there is a real box to divide by.
 *
 * Run with a harness page open:
 *   window.__annotationChecks()
 */
import {
  findQuoteRanges,
  fromPageRect,
  isUsableRect,
  isDistinctStrokePoint,
  mergeRects,
  parsePoints,
  parseRects,
  rectsForRanges,
  toPageRect,
} from "../src/annotations";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(
  results: CheckResult[],
  name: string,
  condition: unknown,
  detail = "",
): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

/** A positioned element, so getBoundingClientRect returns something real. */
function fakePage(width: number, height: number, top = 0, left = 0): HTMLElement {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  document.body.appendChild(el);
  return el;
}

function closeTo(a: number, b: number, tolerance = 0.002): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function runAnnotationChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const pages: HTMLElement[] = [];
  const track = (el: HTMLElement) => (pages.push(el), el);

  // --- PDF: client rects to normalised page coordinates, and back ---
  const page = track(fakePage(800, 1000, 100, 50));

  const mid = toPageRect({ left: 450, top: 600, width: 400, height: 20 }, page);
  check(results, "rect maps to the page's own coordinates", closeTo(mid.x, 0.5), `x=${mid.x}`);
  check(results, "rect y is relative to the page, not the window", closeTo(mid.y, 0.5), `y=${mid.y}`);
  check(results, "rect width scales with the page", closeTo(mid.w, 0.5), `w=${mid.w}`);
  check(results, "rect height scales with the page", closeTo(mid.h, 0.02), `h=${mid.h}`);

  const back = fromPageRect(mid, page);
  check(results, "round trip returns the same pixels", closeTo(back.left, 450, 1) && closeTo(back.top, 600, 1), JSON.stringify(back));

  // The whole point of normalising: a mark survives the window changing.
  const narrow = track(fakePage(400, 1000, 100, 50));
  const fromNarrow = fromPageRect(mid, narrow);
  check(results, "the same mark lands proportionally on a narrower page", closeTo(fromNarrow.left, 250, 1) && closeTo(fromNarrow.width, 200, 1), JSON.stringify(fromNarrow));

  // --- clamping, for a selection that runs off the edge ---
  const over = toPageRect({ left: -30, top: 980, width: 900, height: 40 }, page);
  check(results, "a rect is clamped into 0..1", over.x === 0 && over.y >= 0 && over.y <= 1 && over.w <= 1, JSON.stringify(over));
  const topLeft = toPageRect({ left: 0, top: 0, width: 0, height: 0 }, page);
  check(results, "a zero-sized rect does not divide by zero", Number.isFinite(topLeft.w) && Number.isFinite(topLeft.h), JSON.stringify(topLeft));

  // A zero-sized page must not produce Infinity, which would serialise to null.
  const collapsed = track(fakePage(0, 0));
  const onCollapsed = toPageRect({ left: 5, top: 5, width: 5, height: 5 }, collapsed);
  check(results, "a collapsed page still yields finite numbers", Object.values(onCollapsed).every(Number.isFinite), JSON.stringify(onCollapsed));

  // --- parsing stored geometry, including junk ---
  check(results, "valid rects parse", parseRects('[{"x":0,"y":0,"w":1,"h":1}]').length === 1);
  check(results, "malformed JSON is dropped, not thrown", parseRects("{not json").length === 0);
  check(results, "a non-array is dropped", parseRects('{"x":0}').length === 0);
  check(results, "rects with no area are dropped", parseRects('[{"x":0,"y":0,"w":0,"h":1},{"x":0,"y":0,"w":1,"h":1}]').length === 1);
  check(results, "non-numeric entries are dropped", parseRects('[{"x":"0","y":0,"w":1,"h":1},{"x":0,"y":0,"w":1,"h":1}]').length === 1);
  check(results, "isUsableRect rejects null", !isUsableRect(null));
  check(results, "points parse", parsePoints('[{"x":0.1,"y":0.2}]').length === 1);
  check(results, "junk points are dropped", parsePoints('[{"x":1},{"x":0.1,"y":0.2}]').length === 1);

  // --- merging, so a word split across text nodes is one block ---
  const split = mergeRects([
    { x: 0.10, y: 0.20, w: 0.05, h: 0.02 },
    { x: 0.151, y: 0.20, w: 0.04, h: 0.02 },
  ]);
  check(results, "adjacent rects on one line merge", split.length === 1, JSON.stringify(split));
  check(results, "the merged rect spans both", closeTo(split[0].w, 0.091) && closeTo(split[0].x, 0.10), JSON.stringify(split[0]));

  const twoLines = mergeRects([
    { x: 0.10, y: 0.20, w: 0.30, h: 0.02 },
    { x: 0.10, y: 0.25, w: 0.20, h: 0.02 },
  ]);
  check(results, "rects on different lines stay separate", twoLines.length === 2, JSON.stringify(twoLines));
  check(results, "merging does not mutate its input", JSON.stringify(mergeRects([{ x: 0, y: 0, w: 1, h: 1 }])) === '[{"x":0,"y":0,"w":1,"h":1}]');

  // --- drawing strokes: thin out the points ---
  check(results, "the first point is always kept", isDistinctStrokePoint([], { x: 0, y: 0 }));
  check(results, "a point far enough away is kept", isDistinctStrokePoint([{ x: 0, y: 0 }], { x: 0.5, y: 0.5 }));
  check(results, "a point on top of the last is dropped", !isDistinctStrokePoint([{ x: 0.5, y: 0.5 }], { x: 0.5005, y: 0.5 }));

  // --- EPUB: re-finding a quote in real DOM text ---
  const chapter = track(fakePage(600, 400));
  chapter.innerHTML =
    "<p>Row 1 of the chart</p><p>Row 1 of the chart</p><p>with wrong side facing</p>";

  const first = findQuoteRanges(chapter, "Row 1 of the chart", 0);
  check(results, "the first occurrence is found", first.length > 0, `${first.length} ranges`);
  const second = findQuoteRanges(chapter, "Row 1 of the chart", 1);
  check(results, "a later occurrence is found", second.length > 0);
  check(results, "the two occurrences are different places", first.length > 0 && second.length > 0 && first[0].startContainer !== second[0].startContainer);
  // Ordering has to be compared in the document, not by startOffset: each
  // paragraph is its own text node, so the offsets are both 0 and mean
  // nothing about which quote came first.
  const precedes = first[0] && second[0]
    ? Boolean(first[0].startContainer.compareDocumentPosition(second[0].startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)
    : false;
  check(results, "the chosen occurrence really is the later one", precedes);

  check(results, "a quote that is not present yields nothing", findQuoteRanges(chapter, "no such words", 0).length === 0);
  check(results, "an occurrence past the end yields nothing", findQuoteRanges(chapter, "Row 1 of the chart", 9).length === 0);
  check(results, "an empty quote yields nothing", findQuoteRanges(chapter, "   ", 0).length === 0);

  // Whitespace in the DOM must not stop a match: the quote comes from what the
  // reader selected, which is collapsed, while the markup is not.
  const spaced = track(fakePage(400, 200));
  spaced.innerHTML = "<p>stockinette,   after\n  blocking</p>";
  check(results, "collapsed whitespace still matches", findQuoteRanges(spaced, "stockinette, after blocking", 0).length > 0);

  // A quote spanning an element boundary.
  const across = track(fakePage(400, 200));
  across.innerHTML = "<p>knit <em>two</em> together</p>";
  const spanning = findQuoteRanges(across, "knit two together", 0);
  check(results, "a quote across tags comes back as several ranges", spanning.length >= 2, `${spanning.length} ranges`);

  // Ranges to rectangles, which is what a highlight is drawn from.
  const rects = rectsForRanges(spanning, across);
  check(results, "ranges become drawable rectangles", rects.length >= 1 && rects.every((r) => r.w > 0 && r.h > 0), JSON.stringify(rects));
  check(results, "the rectangles stay inside the page", rects.every((r) => r.x >= 0 && r.y >= 0 && r.w <= 1 && r.h <= 1), JSON.stringify(rects));

  for (const el of pages) el.remove();
  return results;
}

export async function verifyAnnotations() {
  const results = runAnnotationChecks();
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

declare global {
  interface Window {
    __annotationChecks: typeof verifyAnnotations;
    __annotationCheckResult: Awaited<ReturnType<typeof verifyAnnotations>> | null;
  }
}

if (typeof window !== "undefined") {
  window.__annotationChecks = verifyAnnotations;
  window.addEventListener("load", () => {
    setTimeout(async () => {
      window.__annotationCheckResult = await verifyAnnotations();
    }, 2000);
  });
}
