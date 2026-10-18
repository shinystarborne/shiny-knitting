/**
 * Checks for the chart symbols explained: in Cheatsheets, each stitch drawn
 * with its abbreviation, its meaning from the glossary (one of yours in its
 * place), what it is worked as on a wrong-side row, and a video where one
 * covers it; and on a lace chart, the stitch pointed at said beside it.
 *
 * Run with the harness open:
 *   window.__symbolChecks()
 */
import type { Abbreviation, Chart } from "../src/api";
import { glossary, stitchMeaning } from "../src/views/abbreviations";
import { STITCHES, stitchOf } from "../src/views/stitches";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifySymbols() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: Chart[]; abbreviations: Abbreviation[]; masterclasses: unknown[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const before = { charts: [...store.charts], abbreviations: [...store.abbreviations], masterclasses: [...store.masterclasses] };
  try {
    // Pure: a stitch's meaning is its abbreviation's.
    const all = glossary([]);
    check(results, "every stitch but knit, purl and no stitch is an abbreviation in the glossary", STITCHES.filter((s) => s.glossary && !all.some((e) => e.term.toLowerCase() === s.glossary!.toLowerCase())).length === 0, STITCHES.filter((s) => s.glossary && !all.some((e) => e.term.toLowerCase() === s.glossary!.toLowerCase())).map((s) => s.key).join());
    check(results, "…its meaning said from there", /Knit 2 together: put the right needle/.test(stitchMeaning(stitchOf("k2tog")!, all).meaning));

    // Cheatsheets: the symbols, with one of yours and a video.
    await invoke("save_abbreviation", { input: { id: null, term: "ssk", meaning: "As this designer does it: slip, slip, knit through the back loops." } });
    await invoke("add_masterclass", { input: { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "Yarn over, the easy way" } }).catch(() => {});
    tab("cheatsheets");
    await waitFor(() => !!document.querySelector('.cheatsheets [data-sheet="symbols"]'), "the cheatsheets");
    const sheets = [...document.querySelectorAll<HTMLElement>(".cheatsheets .sheet-item")].map((b) => b.dataset.sheet);
    check(results, "Cheatsheets lists Chart symbols after Abbreviations", sheets[0] === "abbreviations" && sheets[1] === "symbols", sheets.join(","));
    (document.querySelector('.cheatsheets [data-sheet="symbols"]') as HTMLElement).click();
    await waitFor(() => document.querySelectorAll(".cheatsheets .symbol-row").length === STITCHES.length, "the symbols");
    const row = (key: string) => document.querySelector<HTMLElement>(`.cheatsheets .symbol-row[data-stitch="${key}"]`)!;
    check(results, "…each drawn, with its abbreviation and meaning", !!row("k2tog").querySelector("svg.stitch-symbol line") && /k2tog/.test(row("k2tog").textContent ?? "") && /Knit 2 together: put the right needle/.test(row("k2tog").textContent ?? ""));
    check(results, "…what it is worked as on a wrong-side row", /On a wrong-side row, worked as p2tog/.test(row("k2tog").textContent ?? "") && !/wrong-side/.test(row("yo").textContent ?? ""));
    check(results, "…one of yours in place of the glossary's", /As this designer does it/.test(row("ssk").textContent ?? ""));
    check(results, "…and a masterclass video where one covers it", /Yarn over, the easy way/.test(row("yo").querySelector('[data-act="stitch-video"]')?.textContent ?? ""), row("yo").innerHTML.slice(0, 200));

    // On a lace chart, a square pointed at is said.
    const keys = ["knit", "purl", "yo", "k2tog"];
    const chart = await invoke<Chart>("add_chart", {
      input: {
        name: "Said lace",
        data: { kind: "lace", width: 4, height: 2, cells: "03200000", colours: keys.map((k) => ({ name: k, hex: "#ffffff", stitch: k })), flat: true, repeats: 1, topDown: false, sections: [], gauge: { sts: 0, rows: 0 }, symbols: false, floatLimit: 5, notes: "" },
      },
    });
    tab("calculators");
    await waitFor(() => !!document.querySelector(".calculators"), "the calculators");
    document.querySelector(".calculators")!.dispatchEvent(new CustomEvent("open-chart", { bubbles: true, detail: chart.id }));
    await waitFor(() => !!document.querySelector(".chart-page .chart-canvas[data-grid]"), "the chart");
    await wait(400);
    const point = (x: number, y: number) => {
      const canvas = document.querySelector<HTMLCanvasElement>(".chart-page .chart-canvas")!;
      const [gx, gy, cw, ch] = canvas.dataset.grid!.split(",").map(Number);
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, buttons: 0, clientX: r.left + gx + (x + 0.5) * cw, clientY: r.top + gy + (2 - 1 - y + 0.5) * ch }));
    };
    const tip = () => document.querySelector<HTMLElement>(".stitch-tip:not([hidden])");
    point(1, 0);
    await waitFor(() => /k2tog/.test(tip()?.textContent ?? ""), "the k2tog said", 3000).catch(() => {});
    check(results, "on a lace chart, the stitch the pointer rests on is said beside it, symbol and all", /Knit 2 together: put the right needle/.test(tip()?.textContent ?? "") && !!tip()?.querySelector("svg.stitch-symbol") && /On a wrong-side row, worked as p2tog/.test(tip()?.textContent ?? ""), tip()?.textContent ?? "none");
    point(0, 1);
    await waitFor(() => /Knit/.test(tip()?.textContent ?? "") && !/k2tog/.test(tip()?.textContent ?? ""), "the knit said", 3000).catch(() => {});
    check(results, "…on a wrong-side row, what it is worked as on this one", /On this wrong-side row, worked as p/.test(tip()?.textContent ?? ""), tip()?.textContent ?? "none");
    document.querySelector<HTMLCanvasElement>(".chart-page .chart-canvas")!.dispatchEvent(new PointerEvent("pointerleave"));
    await waitFor(() => !tip(), "the label gone", 2000).catch(() => {});
    check(results, "…and gone when the pointer leaves the chart", !tip());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.charts = before.charts;
    store.abbreviations = before.abbreviations;
    store.masterclasses = before.masterclasses;
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__symbolChecks = verifySymbols;
