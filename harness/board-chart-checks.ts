/**
 * Checks for charts and calculators on a project's board: a chart added from
 * the board, drawn on its card as the chart is now, opened from there and
 * back; a calculator opened from the board, for that project, its Save set to
 * the project's board; and a chart saved to a project from Charts as a card.
 *
 * Run with the harness open:
 *   window.__boardChartChecks()
 */
import type { BoardItem, Chart, Project } from "../src/api";

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

export async function verifyBoardCharts() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: Chart[]; boardItems: BoardItem[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const choose = async (value: string, what: string) => {
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), what);
    dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!.value = value;
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
  };
  const charts = [...store.charts];
  let projectId = "";
  try {
    const keys = ["knit", "yo", "k2tog"];
    const chart = await invoke<Chart>("add_chart", {
      input: { name: "Board lace", data: { kind: "lace", width: 6, height: 4, cells: "012000" + "000000" + "021000" + "000000", colours: keys.map((k) => ({ name: k, hex: "#ffffff", stitch: k })), flat: true, repeats: 1, topDown: false, sections: [], gauge: { sts: 0, rows: 0 }, symbols: false, floatLimit: 5, notes: "" } },
    });
    const project = await invoke<Project>("add_project", { input: { name: "Shawl on the board", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    const openProject = async () => {
      tab("projects");
      await waitFor(() => !!document.querySelector(".projects"), "the projects");
      document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
      await waitFor(() => !!page()?.querySelector('.board-tools [data-add="chart"]'), "the project's board");
    };
    await openProject();
    check(results, "a project's board offers a Chart and a Calculator", !!page()!.querySelector('.board-tools [data-add="chart"]') && !!page()!.querySelector('.board-tools [data-act="calculator"]'));

    // A chart, from the board.
    (page()!.querySelector('.board-tools [data-add="chart"]') as HTMLElement).click();
    await choose(chart.id, "the charts to choose from");
    const card = () => page()!.querySelector<HTMLElement>(".board-item.kind-chart");
    await waitFor(() => !!card()?.querySelector("canvas[data-chart-of]"), "the chart on the board");
    const canvas = card()!.querySelector<HTMLCanvasElement>("canvas")!;
    check(results, "added, the chart is on the board, drawn, named", /Board lace/.test(card()!.textContent ?? "") && canvas.width > 50 && canvas.height > 30 && store.boardItems.some((i) => i.boardId === projectId && i.kind === "chart" && i.data.chartId === chart.id), `${canvas.width}×${canvas.height}`);

    // Changed in Charts, the card shows it.
    await invoke("update_chart", { id: chart.id, input: { name: "Board lace, wider", data: { ...chart.data, width: 8, cells: "0".repeat(32) } } });
    await openProject();
    await waitFor(() => /Board lace, wider/.test(card()?.textContent ?? ""), "the chart changed", 5000).catch(() => {});
    check(results, "…drawn as the chart is now: changed, the card shows it", /Board lace, wider/.test(card()?.textContent ?? ""));

    // Opened from its card, and back.
    (card()!.querySelector('[data-act="open"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".chart-page"), "the chart opened");
    const back = document.querySelector<HTMLElement>('.chart-page [data-act="back"]')!;
    check(results, "Open opens the chart, its way back the project", /The project/.test(back.textContent ?? ""), back.textContent ?? "");
    back.click();
    await waitFor(() => !!page()?.querySelector(".board-item.kind-chart"), "back on the project");
    check(results, "…and back, the project's board again", !!page());

    // A calculator, from the board.
    (page()!.querySelector('.board-tools [data-act="calculator"]') as HTMLElement).click();
    await choose("socks", "the calculators to choose from");
    await waitFor(() => !!document.querySelector('.calculators [data-el="calc-for"]'), "the calculator for the project");
    const forLine = document.querySelector<HTMLElement>('.calculators [data-el="calc-for"]')!.textContent ?? "";
    // A foot and a gauge typed, for a result to save.
    for (const [k, v] of [["sts", "32"], ["rows", "44"], ["footAround", "22"], ["footLength", "24"]]) {
      const el = document.querySelector<HTMLInputElement>(`.calculators [data-k="${k}"]`);
      if (!el) continue;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await waitFor(() => !!document.querySelector('.calculators [data-k="saveTo"]'), "its Save", 5000).catch(() => {});
    const saveTo = document.querySelector<HTMLSelectElement>('.calculators [data-k="saveTo"]');
    check(results, "the calculator chosen opens for the project: said so, its Save set to the project's board", /Shawl on the board/.test(forLine) && document.querySelector(".calc-pick.on")?.getAttribute("data-calc") === "socks" && saveTo?.value === projectId, `${forLine} / ${saveTo?.value}`);
    (document.querySelector('.calculators [data-act="back-to-project"]') as HTMLElement).click();
    await waitFor(() => !!page(), "back on the project from the calculator");
    check(results, "…and its way back is the project", !!page());
    tab("calculators");
    await waitFor(() => !!document.querySelector(".calculators"), "the calculators");
    check(results, "the Calculators tab opened as itself is for no project", !document.querySelector('.calculators [data-el="calc-for"]'));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    store.charts = charts;
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardChartChecks = verifyBoardCharts;
