/**
 * Checks for the highlight line's row grid.
 *
 * The line steps in bands exactly one thickness tall, which is what makes it
 * usable over a schematic: set the thickness to the on-screen height of one
 * chart row and each press lands on the next row. The arithmetic is a pure
 * function, so it can be checked directly rather than by pressing keys and
 * looking at the DOM — which is what makes the edge cases (the top, the
 * bottom, a line dragged off the grid) testable at all.
 *
 * Run with the harness open:
 *   window.__rowChecks()
 */
import { stepTop } from "../src/reader/highlight";

function check(results, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, detail: ok ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
}

export function runRowChecks() {
  const results = [];

  // The case from the specification: a line covering 0-5 moves to 5-10, then
  // to 10-15. Each press advances by exactly one thickness.
  check(results, "steps down one band at a time", [0, 1, 2, 3].map((i) => stepTop(i * 5, 5, 1000, 1)), [
    5, 10, 15, 20,
  ]);
  check(results, "steps back one band at a time", [20, 15, 10].map((t) => stepTop(t, 5, 1000, -1)), [
    15, 10, 5,
  ]);

  // Row one has to be reachable, which is why the first band sits at 0 rather
  // than behind a margin.
  check(results, "the first band is reachable", stepTop(0, 5, 1000, -1), 0);
  check(results, "stepping up from the first band stays there", stepTop(2, 5, 1000, -1), 0);

  // A line dragged off the grid enters the next band from the one it is over,
  // rather than snapping back to roughly where it was.
  check(results, "a line off the grid steps to the next band", stepTop(3, 5, 1000, 1), 5);
  check(results, "a line off the grid steps to the previous band", stepTop(8, 5, 1000, -1), 5);
  check(results, "a line just above a boundary steps forward one band", stepTop(7, 5, 1000, 1), 10);

  // Thick lines, which is the whole point of the feature: a band big enough to
  // cover a block of chart text.
  check(results, "a thick band still advances by its own height", [0, 1, 2].map((i) => stepTop(i * 120, 120, 1000, 1)), [
    120, 240, 360,
  ]);

  // The last band has to fit, or stepping to it would push the line off screen.
  check(results, "the last band fits inside the area", stepTop(990, 5, 1000, 1), 995);
  check(results, "stepping past the last band stops there", stepTop(995, 5, 1000, 1), 995);

  // A degenerate thickness must not divide by zero or loop.
  check(results, "a zero thickness still moves", stepTop(10, 0, 1000, 1), 11);
  check(results, "a negative thickness is treated as one pixel", stepTop(10, -5, 1000, 1), 11);

  // An area smaller than one band has nowhere to go.
  check(results, "an area smaller than a band pins to zero", stepTop(0, 50, 20, 1), 0);

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
