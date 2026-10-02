/**
 * Checks for the bulk add flow ("Add folder…").
 *
 * These run against the live, stubbed app rather than pure functions: the
 * point of the feature is the wiring — the toolbar button, the dialog answer,
 * the folder scan, the per-file adds, and the summary — so the checks click
 * the real button and read the real panel.
 *
 * One subtlety: when a run ends, main.ts re-mounts the library, which removes
 * the panel in the same microtask chain that marks it done. A polling loop can
 * never see the finished panel, so the summary is captured by a
 * MutationObserver instead — its callback is queued when the panel turns done,
 * before the continuation that clears the screen.
 *
 * Run with the harness open:
 *   window.__bulkAddChecks()
 */

function check(results, name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, what, timeoutMs = 15000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

export async function verifyBulkAdd() {
  const results = [];
  const store = window.__store;

  // Captures the summary line the moment a panel is marked done (see the
  // header comment for why polling cannot).
  let lastSummary = "";
  const observer = new MutationObserver(() => {
    const note = document.querySelector(".scan-panel.done [data-el='note']");
    if (note) lastSummary = note.textContent;
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
  });

  const clickAddFolder = () => {
    const btn = document.querySelector('button[data-act="add-folder"]');
    if (!btn) throw new Error("no Add folder button on screen");
    btn.click();
  };
  const titles = (wanted) =>
    wanted.filter((t) => store.patterns.some((p) => p.title === t));

  try {
    // Describing is switched on, so the summary can point at it.
    await window.__TAURI_INTERNALS__.invoke("get_ai_settings");
    store.aiSettings.enabled = true;

    // --- a mixed folder adds its patterns, and only its patterns ---
    const before = store.patterns.length;
    window.__seedFolder("/patterns", [
      "a_scarf.pdf",
      "b-hat.EPUB",
      "notes.txt",
      "sub/cabled_socks.pdf",
    ]);
    window.__nextDialogPick = "/patterns";
    lastSummary = "";
    clickAddFolder();
    await waitFor(() => lastSummary !== "", "the first run's summary");

    check(
      results,
      "every PDF and EPUB in the folder is added",
      store.patterns.length === before + 3,
      `${store.patterns.length - before} added, want 3`,
    );
    check(
      results,
      "titles are derived from the file names",
      JSON.stringify(titles(["a scarf", "b hat", "cabled socks"])) ===
        JSON.stringify(["a scarf", "b hat", "cabled socks"]),
      `found ${JSON.stringify(titles(["a scarf", "b hat", "cabled socks"]))}`,
    );
    check(
      results,
      "the summary reports 3 added",
      lastSummary.includes("3 added"),
      lastSummary,
    );
    check(
      results,
      "the summary points at Describe after adds",
      lastSummary.includes("Run Describe"),
      lastSummary,
    );

    // --- the same folder again is all skips ---
    lastSummary = "";
    window.__nextDialogPick = "/patterns";
    await waitFor(() => !!document.querySelector('button[data-act="add-folder"]'), "the library");
    clickAddFolder();
    await waitFor(() => lastSummary !== "", "the second run's summary");

    check(
      results,
      "a repeat run reports the duplicates as already in the library",
      lastSummary.includes("3 already in the library"),
      lastSummary,
    );
    check(
      results,
      "a repeat run adds nothing",
      !/\d+ added/.test(lastSummary) && store.patterns.length === before + 3,
      `${lastSummary}; ${store.patterns.length - before} in store`,
    );

    // --- Stop ends a run early ---
    window.__seedFolder(
      "/many",
      Array.from({ length: 30 }, (_, i) => `f${String(i + 1).padStart(2, "0")}.pdf`),
    );
    window.__nextDialogPick = "/many";
    lastSummary = "";
    await waitFor(() => !!document.querySelector('button[data-act="add-folder"]'), "the library");
    clickAddFolder();
    // The stub pauses between adds, so this click lands mid-run.
    await waitFor(() => !!document.querySelector(".scan-panel [data-el='stop']"), "the Stop button");
    document.querySelector(".scan-panel [data-el='stop']").click();
    await waitFor(() => lastSummary !== "", "the stopped run's summary");

    const manyAdded = store.patterns.filter((p) => /^f\d\d$/.test(p.title)).length;
    check(
      results,
      "Stop ends the run before every file is added",
      manyAdded < 30,
      `${manyAdded} of 30 added`,
    );
    check(
      results,
      "a stopped run says so in the summary",
      lastSummary.startsWith("Stopped."),
      lastSummary,
    );
  } catch (err) {
    check(results, "the suite ran to completion", false, String(err && err.message || err));
  } finally {
    observer.disconnect();
    window.__nextDialogPick = null;
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

if (typeof window !== "undefined") {
  window.__bulkAddChecks = verifyBulkAdd;
}
