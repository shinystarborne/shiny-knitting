/**
 * Checks for knitting from a chart on a project's page: where the next row
 * is (the arithmetic), and the page clicked through -- a chart chosen, the
 * row to knit marked and written out, moving as the counter counts, a
 * repeat begun, a chart started later in the project, and a chart removed.
 *
 * Run with the harness open:
 *   window.__projectChartChecks()
 */
import { chartPlace, newGrid, rowInWords } from "../src/views/chart";

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

function pure(results: CheckResult[]): void {
  const g = newGrid({ kind: "standard", width: 4, height: 3 });
  const at = (done: number, start = 1) => JSON.stringify(chartPlace(g, done, start));
  check(results, "nothing knitted: the chart's first row is next", at(0) === JSON.stringify({ kind: "row", row: 1, repeat: 1 }));
  check(results, "…three rows knitted of a 3-row chart: its first row again, the second repeat", at(3) === JSON.stringify({ kind: "row", row: 1, repeat: 2 }) && at(5) === JSON.stringify({ kind: "row", row: 3, repeat: 2 }));
  check(results, "…started on row 10, with 4 knitted: 5 rows to go", at(4, 10) === JSON.stringify({ kind: "before", rowsToGo: 5 }) && at(9, 10) === JSON.stringify({ kind: "row", row: 1, repeat: 1 }));
  const yoke = newGrid({ kind: "yoke", width: 6, height: 4, repeats: 10 });
  check(results, "a yoke's chart is knitted once, not repeated", JSON.stringify(chartPlace(yoke, 4, 1)) === JSON.stringify({ kind: "done" }) && JSON.stringify(chartPlace(yoke, 3, 1)) === JSON.stringify({ kind: "row", row: 4, repeat: 1 }));
  check(results, "a row's words, from the lines written out", rowInWords(g, 2)?.text === "knit all in Natural white.");
}

export async function verifyProjectChart() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { projects: { id: string; chartId?: string }[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const section = () => document.querySelector<HTMLElement>(".project-page .project-chart");
  const row = () => section()?.querySelector<HTMLCanvasElement>('[data-el="pic"] canvas')?.dataset.row ?? "";
  const where = () => section()?.querySelector('[data-el="where"]')?.textContent ?? "";
  const words = () => section()?.querySelector('[data-el="words"]')?.textContent ?? "";
  const inc = () => document.querySelector<HTMLElement>('.project-page .project-counter [data-act="total-inc"]')!.click();
  const field = (f: string) => section()!.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`)!;
  const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  let projectId = "";
  let chartId = "";

  try {
    pure(results);
    // Three rounds: plain, a dot in the middle, plain.
    const chart = await invoke<{ id: string }>("add_chart", {
      input: { name: "Dots", data: { kind: "standard", width: 4, height: 3, cells: "000001100000", colours: [{ name: "Natural white", hex: "#efe8da" }, { name: "Black sheep", hex: "#2f2a26" }], flat: false, repeats: 1, topDown: false, sections: [], gauge: { sts: 0, rows: 0 }, symbols: false, floatLimit: 5, notes: "" } },
    });
    chartId = chart.id;
    projectId = (await invoke<{ id: string }>("add_project", { input: { name: "Dotted hat", patternId: "p1", notes: "", startedAt: null, toolIds: [], yarns: [] } })).id;
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${projectId}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${projectId}"]`) as HTMLElement).click();
    await waitFor(() => !!section()?.querySelector('[data-f="chart"]') && !!document.querySelector(".project-page .project-counter"), "the chart section");
    check(results, "a project's page asks which chart it is knitted from", !section()!.querySelector("canvas"));

    set(field("chart"), chartId);
    await waitFor(() => row() === "1", "the chart drawn");
    check(results, "chosen, it is kept with the project and drawn, its first row marked", store.projects.find((p) => p.id === projectId)!.chartId === chartId && /^Round 1 of 3/.test(where()), where());

    inc();
    await waitFor(() => row() === "2", "the mark to move");
    check(results, "counting a row moves the mark to the next, and writes it out", /^Round 2 of 3/.test(where()) && words() === "k1 Natural white, k2 Black sheep, k1 Natural white.", `${where()} / ${words()}`);
    inc();
    inc();
    await waitFor(() => /repeat 2/.test(where()), "the second repeat");
    check(results, "…past its last row, the chart begins again: repeat 2", row() === "1" && /^Round 1 of 3 · repeat 2/.test(where()), where());

    set(field("chart-start"), "10");
    await waitFor(() => /starts on row 10/.test(where()), "the later start");
    check(results, "begun later in the project, it says how many rows to go", /6 rows to go/.test(where()) && row() === "0", where());

    await invoke("delete_chart", { id: chartId });
    chartId = "";
    check(results, "a chart removed is knitted from no more", store.projects.find((p) => p.id === projectId)!.chartId === "");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (chartId) await invoke("delete_chart", { id: chartId }).catch(() => {});
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__projectChartChecks = verifyProjectChart;
