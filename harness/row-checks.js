/**
 * Checks for the highlight line's steps, on a real line over a scrolling
 * pane: each count moves it exactly one row along the pattern -- its own
 * height, from wherever it was put -- and near the pane's edges the pattern
 * moves under it instead, by the same row, so the line never drifts off the
 * chart's rows. And a click in the pattern puts the line there only when its
 * grip readied it.
 *
 * Run with the harness open:
 *   window.__rowChecks()
 */
import { HighlightLine } from "../src/reader/highlight";

function check(results, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, detail: ok ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
}

/** A 400 px pane over 4000 px of pattern, and a 20 px line half way down. */
function pane() {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-2000px;top:0;width:300px;height:400px;";
  const scroller = document.createElement("div");
  scroller.style.cssText = "position:absolute;inset:0;overflow:auto;";
  const content = document.createElement("div");
  content.style.height = "4000px";
  scroller.appendChild(content);
  box.appendChild(scroller);
  document.body.appendChild(box);
  const line = new HighlightLine({
    patternId: "rows", enabled: true, offsetY: 0.5, thickness: 20, width: 0, insetX: 0,
    color: "#e5484d", opacity: 0.3, animate: false, animationMs: 0, readsUp: false,
  });
  line.attach(scroller);
  // Where the line is on the pattern, whatever has scrolled.
  const at = () => scroller.scrollTop + line.top;
  return { box, scroller, line, at };
}

export function runRowChecks() {
  const results = [];
  const { box, scroller, line, at } = pane();
  try {
    const start = at();
    line.stepRow(1, false);
    check(results, "a count moves the line one row: its own height", at() - start, 20);
    line.commitTop(203);
    const off = at();
    line.stepRow(1, false);
    check(results, "put somewhere off any grid, it still moves its own height, not to a grid", at() - off, 20);

    // Down past the bottom of the pane: the pattern moves under the line, a row at a time.
    const before = at();
    for (let i = 0; i < 40; i++) line.stepRow(1, false);
    check(results, "forty rows down is forty rows along the pattern, scrolled or not", at() - before, 800);
    check(results, "…the pattern scrolled, the line kept in the pane", [scroller.scrollTop > 0, line.top >= 0 && line.top + 20 <= 400], [true, true]);
    const top = line.top;
    line.stepRow(1, false);
    check(results, "…once scrolling, the line stays put and the pattern moves a row", [line.top === top, at() - before], [true, 820]);
    for (let i = 0; i < 41; i++) line.stepRow(-1, false);
    check(results, "back up as many rows: back where it was", at(), before);

    // At the very top of the pattern, nothing scrolls: the line goes to the pane's top, and no further.
    scroller.scrollTop = 0;
    line.commitTop(60, 0);
    for (let i = 0; i < 10; i++) line.stepRow(-1, false);
    check(results, "at the start of the pattern the line reaches the top, and stops", [scroller.scrollTop, line.top], [0, 0]);
    // And at its end, to the pane's bottom.
    scroller.scrollTop = 4000;
    line.commitTop(200, 0);
    for (let i = 0; i < 20; i++) line.stepRow(1, false);
    check(results, "at the end of the pattern the line reaches the bottom, and stops", line.top, 380);

    // A click in the pattern: only once the grip readied the line.
    line.commitTop(100, 0);
    check(results, "a click in the pattern does not move the line on its own", [line.placeAt(250), line.top], [false, 100]);
    line.setReady(true);
    check(results, "…readied by a click on its grip, the next click puts it there, once", [line.placeAt(250), line.top, line.isReady], [true, 250, false]);
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
