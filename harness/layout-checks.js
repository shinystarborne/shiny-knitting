/**
 * Regression checks for the app shell's layout.
 *
 * These exist because of a bug that every functional test missed: a view
 * overwrote the screen element's class, which broke the `flex`/`min-height`
 * chain that makes a scrolling pane work. The reader still rendered, all the
 * data was correct, and the tests passed — the document simply grew to its
 * full length instead of scrolling, so the mouse wheel did nothing.
 *
 * Run against a built bundle, which is where it bit:
 *   npm run harness:build && npm run harness:serve
 *   then open http://localhost:1422/harness/index.html
 */

/** Asserts a condition, collecting rather than throwing so every check runs. */
function check(results, name, condition, detail) {
  results.push({ name, ok: !!condition, detail: detail ?? "" });
}

export function runLayoutChecks(doc = document, win = window) {
  const results = [];
  const q = (sel) => doc.querySelector(sel);

  // The screen must keep its class. A view that writes over it is the bug.
  check(results, "screen element exists", !!q(".screen"));
  check(
    results,
    "screen keeps its own class",
    !!q(".screen") && !q(".screen").classList.contains("library"),
    q(".screen") ? q(".screen").className : "missing",
  );

  // The layout chain must be height-constrained from #app down to the
  // scrolling pane. Any ancestor that is taller than the viewport has let go
  // of the constraint.
  const pane = q(".results") || q(".doc-scroller");
  check(results, "a scrolling pane is present", !!pane);
  if (pane) {
    const overflows = pane.scrollHeight > pane.clientHeight + 10;

    // The invariant that always holds, and the one the original bug broke:
    // however much content there is, the pane is at most a window tall.
    check(
      results,
      "scrolling pane fits the window",
      pane.clientHeight <= win.innerHeight + 1,
      `pane=${pane.clientHeight} window=${win.innerHeight}`,
    );

    // Walk up and look for the first ancestor that has outgrown the window,
    // which is where the chain broke.
    let broken = null;
    let node = pane.parentElement;
    while (node && node !== doc.documentElement) {
      if (node.clientHeight > win.innerHeight + 1) {
        broken = `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}=${node.clientHeight}`;
        break;
      }
      node = node.parentElement;
    }
    check(results, "no ancestor overflows the window", !broken, broken || "none");

    // Overflow has to be scrollable rather than clipped away.
    const overflowY = win.getComputedStyle(pane).overflowY;
    check(
      results,
      "pane is scrollable, not clipped",
      overflowY === "auto" || overflowY === "scroll",
      `overflow-y=${overflowY}`,
    );

    // When there genuinely is more content than fits, the pane must move.
    // With only a few cards there is nothing to scroll, and saying otherwise
    // would be a false failure.
    if (overflows) {
      const before = pane.scrollTop;
      pane.scrollTop = before + 400;
      const moved = pane.scrollTop !== before;
      pane.scrollTop = before;
      check(results, "pane scrolls when it overflows", moved);
    } else {
      results.push({
        name: "pane scrolls when it overflows",
        ok: true,
        detail: "not applicable: content fits",
      });
    }
  }

  return results;
}

/** Runs the checks and reports in a form a test driver can assert on. */
export async function verifyLayout() {
  const results = runLayoutChecks();
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

// Exposed for a driver; also runs on load so the harness shows the result.
if (typeof window !== "undefined") {
  window.__layoutChecks = verifyLayout;
  window.addEventListener("load", () => {
    window.__layoutCheckResult = null;
    // Deferred: the app renders its first screen asynchronously.
    setTimeout(async () => {
      window.__layoutCheckResult = await verifyLayout();
    }, 2500);
  });
}
