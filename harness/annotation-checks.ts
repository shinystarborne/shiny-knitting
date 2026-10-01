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
  countMatches,
  findTextMatches,
  pageSearchText,
  findQuoteRanges,
  fromPageRect,
  isUsableRect,
  isDistinctStrokePoint,
  mergeRects,
  occurrenceAt,
  parsePoints,
  parseRects,
  rectsForRanges,
  textInRect,
  toPageRect,
  visibleRectsForRanges,
} from "../src/annotations";
import { boxFromView, boxToView, normalRotation, pointFromView, pointToView, type Rotation } from "../src/reader/rotation";
import { titleFor } from "../src/reader/pins";

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

  // --- A passage outside the visible box is dropped, not clamped ---
  // A reflowable chapter re-lays out, and while it is doing so, or before its
  // frame has been resized to fit, the text a mark refers to can sit outside
  // the box the mark is measured against. Clamping would paint it against the
  // page edge, which reads as a mark on the wrong words.
  const scrolled = track(fakePage(600, 120, 0, 0));
  scrolled.style.overflow = "hidden";
  scrolled.innerHTML =
    '<p style="margin:0">visible text</p>' +
    // A large top margin puts this paragraph unambiguously below the 120px
    // box, rather than merely looking like it should be.
    '<p style="margin:400px 0 0">and a great deal of further text that has ended ' +
    'up well below the visible box, with the word sts down here where nobody ' +
    'can see it at all</p>';
  const outside = findQuoteRanges(scrolled, "sts", 0);
  check(results, "an off-page passage is found", outside.length > 0);
  const dropped = visibleRectsForRanges(outside, scrolled);
  check(results, "an off-page passage is dropped, not clamped", dropped.length === 0, JSON.stringify(dropped));
  const visibleQuote = findQuoteRanges(scrolled, "visible text", 0);
  check(results, "a visible passage is still drawn", visibleRectsForRanges(visibleQuote, scrolled).length > 0);

  // --- Naming a card from the words under the crop ---
  // A pin's title comes from the text inside its crop, so getting this wrong
  // means every card is called "Pin 2" or, worse, is named after a neighbouring
  // paragraph.
  const named = track(fakePage(600, 400));
  named.innerHTML =
    '<div class="text-layer">' +
    '<span style="position:absolute;left:20px;top:20px;width:300px">Row 1: k1, yo.</span>' +
    '<span style="position:absolute;left:20px;top:200px;width:300px">Row 2: k2, k1.</span>' +
    "</div>";
  const upper = textInRect(named, named, { x: 0, y: 0, w: 1, h: 0.3 });
  check(results, "a crop over the first line names that line", upper === "Row 1: k1, yo.", upper);
  const lower = textInRect(named, named, { x: 0, y: 0.4, w: 1, h: 0.3 });
  check(results, "a crop lower down names that line instead", lower === "Row 2: k2, k1.", lower);
  const both = textInRect(named, named, { x: 0, y: 0, w: 1, h: 1 });
  check(results, "a crop over both names both, in reading order", both === "Row 1: k1, yo. Row 2: k2, k1.", both);
  const nothing = textInRect(named, named, { x: 0.6, y: 0.8, w: 0.05, h: 0.05 });
  check(results, "a crop over blank paper names nothing", nothing === "", JSON.stringify(nothing));
  // A zero-sized box has no area to divide by, and must not report the whole
  // page's text or throw.
  const noArea = textInRect(named, named, { x: 0.2, y: 0.2, w: 0, h: 0 });
  check(results, "a collapsed crop names nothing rather than everything", noArea === "", JSON.stringify(noArea));

  // A card name is a label, not a transcript: a crop over a long run of
  // instructions is cut to fit, and ends on a whole word.
  const long = titleFor(
    "Row 1: k1, yo. Work across the row, then turn. Repeat for the length given.",
    1,
  );
  check(results, "a long card name is cut to fit", long.length <= 60, `${long.length}: ${long}`);
  check(results, "a cut card name ends on a whole word", !/\w…$/.test(long.slice(0, -1)) || long.endsWith("…"), long);
  check(results, "a card name keeps the start of the text", long.startsWith("Row 1: k1, yo."), long);
  check(results, "a chart with no text gets a plain name", titleFor("", 2) === "Pin 2", titleFor("", 2));
  check(results, "whitespace is not a name", titleFor("   \n  ", 3) === "Pin 3", titleFor("   \n  ", 3));
  // A pattern is full of labels that look like sentence ends. Cutting at one
  // would name every card after its own heading, which is worse than useless.
  const heading = titleFor("Row 1: k1, yo. Work across the row, then turn.", 1);
  check(results, "a card name is not cut at a heading's colon", heading.startsWith("Row 1: k1"), heading);
  const trimmed = titleFor("  Row 1:   k1,  yo.  ", 1);
  check(results, "runs of whitespace in a name are collapsed", trimmed === "Row 1: k1, yo.", trimmed);

  // --- Which occurrence is a selection on? This is what an EPUB mark is
  // saved against, and getting it wrong draws the mark on the wrong words. ---
  const repeats = track(fakePage(600, 400));
  repeats.innerHTML =
    "<p>Row 1: k1, yo.</p><p>Some other text.</p><p>Row 1: k1, yo.</p><p>Row 1: k1, yo.</p>";

  const secondPara = repeats.children[2].firstChild as Text;
  const onSecond = document.createRange();
  onSecond.setStart(secondPara, 0);
  onSecond.setEnd(secondPara, 5);
  check(results, "a selection on the second match reports occurrence 1", occurrenceAt(repeats, onSecond, "Row 1: k1, yo.") === 1, String(occurrenceAt(repeats, onSecond, "Row 1: k1, yo.")));

  const thirdPara = repeats.children[3].firstChild as Text;
  const onThird = document.createRange();
  onThird.setStart(thirdPara, 0);
  onThird.setEnd(thirdPara, 5);
  check(results, "a selection on the third match reports occurrence 2", occurrenceAt(repeats, onThird, "Row 1: k1, yo.") === 2, String(occurrenceAt(repeats, onThird, "Row 1: k1, yo.")));

  const firstPara = repeats.children[0].firstChild as Text;
  const onFirst = document.createRange();
  onFirst.setStart(firstPara, 0);
  onFirst.setEnd(firstPara, 5);
  check(results, "a selection on the first match reports occurrence 0", occurrenceAt(repeats, onFirst, "Row 1: k1, yo.") === 0);

  // The round trip that matters: a mark saved against an occurrence must be
  // drawn over the words it was made from.
  for (const n of [0, 1, 2]) {
    const found = findQuoteRanges(repeats, "Row 1: k1, yo.", n);
    const back = occurrenceAt(repeats, found[0], "Row 1: k1, yo.");
    check(results, `occurrence ${n} survives save and redraw`, back === n, `came back as ${back}`);
  }

  // A quote that is not there at all must not claim a match.
  check(results, "an absent quote reports occurrence 0", occurrenceAt(repeats, onFirst, "not in the text") === 0);
  check(results, "an empty quote reports occurrence 0", occurrenceAt(repeats, onFirst, "  ") === 0);

  // --- Search: counting a page's text and drawing its matches must agree ---
  // A PDF text layer is one span per run of text. The page text that search
  // counts joins runs with spaces, so the drawn matches must treat a span
  // boundary as a space too, or "the third match" would mean different words
  // to the counter and to the page.
  const layer = track(fakePage(600, 200));
  layer.innerHTML =
    '<span>Knit</span><span>two together, then</span><span>knit two</span><br><span>KNIT  TWO again</span>';
  const runs = ["Knit", "two together, then", "knit two", "KNIT  TWO again"];
  const text = pageSearchText(runs);
  check(results, "page text joins runs with a space", text === "knit two together, then knit two knit two again", text);
  check(results, "matches are counted case-insensitively", countMatches(text, "Knit Two") === 3, String(countMatches(text, "Knit Two")));
  const drawn = findTextMatches(layer, "knit two");
  check(results, "the same matches are found in the page", drawn.length === 3, `${drawn.length} found`);
  check(results, "a match across two spans comes back as two ranges", drawn[0]?.length === 2, `${drawn[0]?.length}`);
  check(results, "a match inside one span is one range", drawn[1]?.length === 1, `${drawn[1]?.length}`);
  check(results, "the boundary space is not part of a range", drawn[0]?.map((r) => r.toString()).join("|") === "Knit|two", drawn[0]?.map((r) => r.toString()).join("|"));
  // The collapsed second space is skipped, as findQuoteRanges does, so this is
  // two ranges on one line -- which draw as one band once merged.
  const doubled = drawn[2]?.map((r) => r.toString()).join("") ?? "";
  check(results, "a match over doubled whitespace still covers both words", doubled.replace(/\s+/g, " ").trim() === "KNIT TWO", JSON.stringify(doubled));
  check(results, "no matches for absent text", findTextMatches(layer, "purl").length === 0 && countMatches(text, "purl") === 0);
  check(results, "an empty query matches nothing", findTextMatches(layer, "  ").length === 0 && countMatches(text, " ") === 0);

  // --- Turned pages: stored upright, shown turned ---
  const corner = { x: 0.1, y: 0.2 };
  const p90 = pointToView(corner, 90);
  check(results, "a quarter turn clockwise takes the top left to the top right", closeTo(p90.x, 0.8) && closeTo(p90.y, 0.1), JSON.stringify(p90));
  const p270 = pointToView(corner, 270);
  check(results, "three quarters takes it to the bottom left", closeTo(p270.x, 0.2) && closeTo(p270.y, 0.9), JSON.stringify(p270));
  for (const r of [0, 90, 180, 270] as Rotation[]) {
    const back = pointFromView(pointToView(corner, r), r);
    check(results, `a point turned ${r}° and back is where it was`, closeTo(back.x, corner.x) && closeTo(back.y, corner.y), JSON.stringify(back));
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
    const shown = boxToView(box, r);
    const again = boxFromView(shown, r);
    check(results, `a box turned ${r}° and back is the same box`, closeTo(again.x, box.x) && closeTo(again.y, box.y) && closeTo(again.w, box.w) && closeTo(again.h, box.h), JSON.stringify(again));
    if (r === 90 || r === 270) {
      check(results, `a box turned ${r}° swaps its width and height`, closeTo(shown.w, box.h) && closeTo(shown.h, box.w), JSON.stringify(shown));
    }
  }
  check(results, "turns wrap round to a quarter", normalRotation(-90) === 270 && normalRotation(450) === 90 && normalRotation(360) === 0, "");

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
