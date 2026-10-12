/**
 * Checks for the highlight line on the pattern's pages: kept as its page
 * and its box there, it scrolls with the pattern, keeps its row when the
 * pages are laid out at another size, moves its own height for each row
 * counted (on to the next page past the end of one), is found again when
 * the pattern was scrolled away from it, and moves and sizes freely.
 *
 * Run with the harness open:
 *   window.__rowChecks()
 */
import { HighlightLine } from "../src/reader/highlight";

function check(results, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, detail: ok ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
}

const near = (a, b, by = 1) => Math.abs(a - b) <= by;

/** A 400 px pane over three 300 × 1000 pages, 20 px apart, and a line on them. */
function pane() {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-3000px;top:0;width:420px;height:400px;";
  const scroller = document.createElement("div");
  scroller.style.cssText = "position:absolute;inset:0;overflow:auto;";
  const pages = [1, 2, 3].map(() => {
    const p = document.createElement("div");
    p.style.cssText = "width:300px;height:1000px;margin:0 20px 20px;background:#fff;";
    scroller.appendChild(p);
    return p;
  });
  box.appendChild(scroller);
  document.body.appendChild(box);
  const doc = { pageCount: 3, pageElement: (n) => pages[n - 1] ?? null, currentPage: () => 1 };
  const line = new HighlightLine({
    patternId: "rows", enabled: true, offsetY: 0.5, thickness: 20, width: 0, insetX: 0,
    color: "#e5484d", opacity: 0.3, animate: false, animationMs: 0, readsUp: false,
    page: 0, boxX: 0, boxY: 0, boxW: 0, boxH: 0,
  });
  line.attach(scroller, doc);
  return { box, scroller, pages, line };
}

export function runRowChecks() {
  const results = [];
  const { box, scroller, pages, line } = pane();
  try {
    check(results, "a line kept before it belonged to a page is given one: where it sat in the window, as tall as it was", [line.placeIfNew(), line.current.page, near(line.contentTop, 200), near(line.heightPx, 20)], [true, 1, true, true]);
    const at = line.contentTop;
    line.stepRow(1, false);
    check(results, "a row counted moves it its own height along the page", near(line.contentTop - at, 20), true);

    // Scrolled away to check something, it stays on its row; a count finds it again.
    scroller.scrollTop = 1500;
    check(results, "scrolled away, the line stays on its row of the page", near(line.contentTop, at + 20), true);
    line.stepRow(1, false);
    check(results, "…and the next count brings it back into view, on its next row", [near(line.contentTop, at + 40), line.viewTop >= 0 && line.viewTop < 400], [true, true]);

    // Laid out at another size (another display, a wider pane, a zoom): the same row of the page.
    const share = line.current.boxY;
    for (const p of pages) p.style.height = "1600px";
    line.layout();
    check(results, "the pages laid out taller, the line keeps the same place on its page, and grows with it", [near(line.contentTop, share * 1600), near(line.heightPx, 32)], [true, true]);
    for (const p of pages) p.style.height = "1000px";
    line.layout();

    // Past the end of a page, on to the next; back again, to the last row of the one before.
    line.update({ ...line.current, boxY: 0.97, boxH: 0.02 });
    line.stepRow(1, false);
    check(results, "past the end of a page it goes on to the top of the next", [line.current.page, line.current.boxY], [2, 0]);
    line.stepRow(-1, false);
    check(results, "…and back, to the last row of the one before", [line.current.page, near(line.current.boxY, 0.98, 0.001)], [1, true]);

    // Moved anywhere, sideways too, and sized.
    const r = pages[0].getBoundingClientRect();
    line.update({ ...line.current, boxX: 0.02, boxW: 0.5, boxY: 0.2 });
    line.moveTo(r.left + 90, r.top + 300);
    check(results, "moved by its grip anywhere on the page, across too", [near(line.current.boxX, 0.3, 0.005), near(line.current.boxY, 0.3, 0.005)], [true, true]);
    line.sizeTo(r.left + 90 + 120, r.top + 300 + 25);
    check(results, "…and sized by its corner: as wide as the chart, as tall as a row", [near(line.current.boxW, 0.4, 0.005), near(line.current.boxH, 0.025, 0.002)], [true, true]);
    line.moveTo(r.left + 90, pages[1].getBoundingClientRect().top + 100);
    check(results, "…dragged down onto the next page, it is on that page", line.current.page, 2);
    line.fullWidth();
    check(results, "Full width puts it across its page", [line.current.boxX, line.current.boxW], [0, 1]);

    // A click in the pattern: only once the grip readied the line.
    const before = line.current.boxY;
    check(results, "a click in the pattern does not move the line on its own", [line.placeAt(pages[1].getBoundingClientRect().top + 500), line.current.boxY === before], [false, true]);
    line.setReady(true);
    check(results, "…readied by a click on its grip, the next click puts it there, once", [line.placeAt(pages[1].getBoundingClientRect().top + 500), near(line.current.boxY, 0.5, 0.002), line.isReady], [true, true, false]);
  } finally {
    line.detach();
    box.remove();
  }
  return results;
}

export async function verifyRows() {
  const results = runRowChecks();
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

if (typeof window !== "undefined") {
  window.__rowChecks = verifyRows;
  window.addEventListener("load", () => {
    setTimeout(async () => {
      window.__rowCheckResult = await verifyRows();
    }, 1500);
  });
}
