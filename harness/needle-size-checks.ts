/**
 * Checks for needle sizes in the frontend: the reading of a pattern's
 * free-text size into canonical mm keys, the sidebar's facet of them, and the
 * setting that spells each size in metric, US, or both.
 *
 * The parser cases are the ones `needle_size.rs` is tested against, so the
 * table the sidebar reads and the sizes the backend files agree; a change to
 * one side that is not made to the other fails here.
 *
 * Run with the harness open:
 *   window.__needleSizeChecks()
 */
import { sizesOf, sizeLabel } from "../src/views/needle-size";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

interface StubStore {
  patterns: { id: string; needleSize: string; tags: string[] }[];
  needleSizeDisplay?: string;
}

export async function verifyNeedleSizes() {
  const results: CheckResult[] = [];

  // As needle_size.rs's tests.
  const readings: [string, string[]][] = [
    ["3.5mm / US 5", ["3.5"]],
    ["US 6", ["4"]],
    ["3.75 mm / US 5 and 3.25 mm / US 3", ["3.25", "3.75"]],
    ["3.5mm and 3mm circular needles", ["3", "3.5"]],
    ["3.5mm, 4mm, 4.5mm", ["3.5", "4", "4.5"]],
    ["4 and 5", ["4", "5"]],
    ["5 mm / US H-8", ["5"]],
    ["5mm / US I/9", ["5.5"]],
    ["4.0mm", ["4"]],
    ["4mm / 10mm", ["4", "10"]],
    ["4mm / US 6 and 5.5mm / US 9", ["4", "5.5"]],
    ["US 10.5", ["6.5"]],
    ["needles 4.5, 60 cm", []],
    ["Use 4mm needles", ["4"]],
    ["US size 8", ["5"]],
    ["US 6.0", ["4"]],
    ["3.5 – 4 mm", ["3.5", "4"]],
    ["UK 10", []],
    ["Hook: US G/6 (4 mm)", ["4"]],
    ["US 7 (4.5 mm) 80 cm circular", ["4.5"]],
    ["some wool", []],
  ];
  for (const [text, want] of readings) {
    const got = sizesOf(text);
    check(results, `“${text}” reads as ${want.join(", ") || "nothing"}`, JSON.stringify(got) === JSON.stringify(want), got.join(", "));
  }

  check(results, "metric spells a size in millimetres", sizeLabel("4 mm", "6", "metric") === "4 mm");
  check(results, "US spells it as the US number", sizeLabel("4 mm", "6", "us") === "US 6");
  check(results, "both spells it in both systems", sizeLabel("4 mm", "6", "both") === "4 mm / US 6");
  check(results, "a size with no US number falls back to millimetres", sizeLabel("3 mm", "", "us") === "3 mm");

  // The sidebar, end to end against the stub: a seeded pattern given two
  // sizes counts under both, ticking a size filters by it, two ticked sizes
  // OR, and the boxes' labels follow the saved display setting.
  const store = (window as unknown as { __store: StubStore }).__store;
  const invoke = (window as unknown as {
    __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__.invoke;
  const p3 = store.patterns.find((p) => p.id === "p3")!;
  const originalSize = p3.needleSize;
  const box = (v: string) =>
    document.querySelector<HTMLInputElement>(`.library [data-slot="needle"] .facet-list input[value="${v}"]`);
  const labelOf = (v: string) => box(v)?.closest("label");
  const cardIds = () => [...document.querySelectorAll<HTMLElement>(".library .card")].map((c) => c.dataset.open!);
  const idsFor = (keys: string[]) =>
    store.patterns.filter((p) => sizesOf(p.needleSize).some((s) => keys.includes(s))).map((p) => p.id);
  const shownIs = (keys: string[]) => cardIds().sort().join(",") === idsFor(keys).sort().join(",");
  try {
    check(results, "the display setting defaults to both", (await invoke("get_needle_size_display")) === "both");

    // p3 is a plain "3mm"; through update_pattern it becomes two sizes, so the
    // facet counts it under each and the filter finds it under each.
    await invoke("update_pattern", { pattern: { ...p3, needleSize: "3.5mm and 4mm" } });

    (document.querySelector('.tab-bar [data-tab="patterns"]') as HTMLElement).click();
    await waitFor(() => !!box("4"), "the needle size facets");
    const facetKeys = [...document.querySelectorAll<HTMLInputElement>('.library [data-slot="needle"] .facet-list input[data-filter="needleSize"]')].map((i) => i.value);
    check(results, "the facets are in size order", facetKeys.every((v, i) => i === 0 || parseFloat(facetKeys[i - 1]) < parseFloat(v)), facetKeys.join(","));
    const label4 = labelOf("4")!;
    check(results, "4 mm is counted once per pattern that uses it", Number(label4.querySelector("em")!.textContent) === idsFor(["4"]).length, label4.querySelector("em")!.textContent ?? "");
    check(results, "…and labelled in both systems", label4.querySelector("span")!.textContent === "4 mm / US 6", label4.querySelector("span")!.textContent ?? "");

    box("4")!.checked = true;
    box("4")!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => shownIs(["4"]), "the 4 mm results");
    const four = cardIds();
    check(results, "4 mm shows the plain 4mm patterns and the two-size one", four.includes("p1") && four.includes("p3"), four.join(","));

    box("2.75")!.checked = true;
    box("2.75")!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => shownIs(["4", "2.75"]), "the OR-ed results");
    const ored = cardIds();
    check(results, "a second ticked size ORs rather than narrows", ored.length >= four.length && ored.includes("p1") && ored.includes("p3"), ored.join(","));

    (document.querySelector('.library [data-act="clear"]') as HTMLElement).click();
    // Every pattern but the books, which are under Books.
    await waitFor(() => cardIds().length === store.patterns.filter((p) => !p.tags.some((t) => t.toLowerCase() === "book")).length, "the cleared filters");

    // The display setting: saved, the re-mounted library spells every size in
    // metric only.
    await invoke("save_needle_size_display", { display: "metric" });
    check(results, "the saved setting is read back", (await invoke("get_needle_size_display")) === "metric");
    (document.querySelector('.tab-bar [data-tab="patterns"]') as HTMLElement).click();
    await waitFor(() => !!box("4"), "the re-mounted facets");
    check(results, "with metric saved, 4 mm is spelt in millimetres only", labelOf("4")!.querySelector("span")!.textContent === "4 mm", labelOf("4")!.querySelector("span")!.textContent ?? "");
    const labels = [...document.querySelectorAll<HTMLElement>(".library [data-slot=\"needle\"] .facet-list label span")].map((s) => s.textContent ?? "");
    check(results, "…and no box mentions a US number", labels.every((t) => !t.includes("/ US")), labels.join("|"));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    await invoke("save_needle_size_display", { display: "both" }).catch(() => {});
    const current = store.patterns.find((p) => p.id === "p3");
    if (current && current.needleSize !== originalSize) {
      await invoke("update_pattern", { pattern: { ...current, needleSize: originalSize } }).catch(() => {});
    }
    (document.querySelector('.tab-bar [data-tab="patterns"]') as HTMLElement)?.click();
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.tools):not(.projects)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__needleSizeChecks = verifyNeedleSizes;
