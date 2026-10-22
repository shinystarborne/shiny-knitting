/**
 * Checks for the round yoke calculator and its chart together: the counts
 * fitted to the chart's repeat (so many repeats round, each narrowing to the
 * neck), the chart fitted to the yoke (its rounds, repeats and increase
 * rounds), what is drawn kept, and the calculator's own part for the chart:
 * picked, fitted, drawn on and back, made new.
 *
 * Run with the harness open:
 *   window.__yokeChartChecks()
 */
import type { Chart, ChartData } from "../src/api";
import { roundYoke, roundYokeSteps, type RaglanInput, type RoundYokeResult } from "../src/views/calc";
import { yokeFitOf } from "../src/views/calculators";
import { decode, encode, fitLoses, fitsYoke, fittedToYoke, newGrid, stitchMask } from "../src/views/chart";

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

/** A lopapeysa at 18 sts and 24 rows: 278 stitches at the split. */
const LOPI: RaglanInput = {
  gauge: { sts: 18, rows: 24 },
  chest: 96,
  upperArm: 31,
  wrist: 17,
  neck: 38,
  yokeDepth: 23,
  armLength: 46,
  bodyLength: 38,
  bodyEase: 10,
  sleeveEase: 5,
  wristEase: 3,
  neckEase: 10,
  underarm: 5,
  neckRib: 3,
  hemRib: 6,
  cuffRib: 6,
};

/** A yoke chart of a 12-stitch repeat, bottom-up as the dialog makes one, a square drawn at the underarm. */
function drawnChart(): ChartData {
  const g = newGrid({ kind: "yoke", width: 12, height: 30, repeats: 18, shaped: true });
  g.cells[0 * g.width + 5] = 1;
  return encode(g);
}

function pure(results: CheckResult[]): void {
  const plain = roundYoke(LOPI) as RoundYokeResult;
  check(results, "without a chart the yoke is as it was", plain.chart === null && plain.yokeTotal === 278);

  const r = roundYoke(LOPI, 3, 1, 12) as RoundYokeResult;
  const c = r.chart!;
  check(results, "with a 12-stitch chart: its repeat 23 times round, 276 at the underarm", !!c && c.repeats === 23 && c.perRepeat[0] === 12 && r.yokeEnd === 276, JSON.stringify(c));
  check(results, "…each step a stitch or more narrower in every repeat, to the neck", c.perRepeat.every((n, i) => i === 0 || (n < c.perRepeat[i - 1] && n >= 1)) && c.perRepeat.length === 4, c.perRepeat.join(" "));
  check(results, "…every count the repeats times the stitches each has there", r.castOn === 23 * c.perRepeat[3] && r.rounds.every((x) => x.from % 23 === 0 && x.to % 23 === 0), `${r.castOn} ${r.rounds.map((x) => `${x.from}→${x.to}`).join(" ")}`);
  check(results, "…the neck about as wide as asked", Math.abs(r.finished.neck - (38 + 10)) < 6, `${r.finished.neck}`);
  check(results, "…and one round to the split's count, as with a repeat typed in", !!r.adjust && r.adjust.from === 276 && r.adjust.to === 278);
  check(results, "a neck the repeat cannot come near says how near it comes", r.warnings.some((w) => /^With the chart's repeat 23 times round, the neck comes out at 51\.1 cm \(4 stitches a repeat\), for the 48 cm asked/.test(w)), r.warnings.join(" | "));
  check(results, "a repeat too narrow for the increase rounds says so", /too narrow for 3 increase rounds/.test((roundYoke(LOPI, 3, 1, 3) as { error: string }).error ?? ""));

  const steps = roundYokeSteps(r, LOPI, (cm) => `${Math.round(cm * 10) / 10} cm`, "Snowflake");
  check(results, "the steps knit the yoke from the chart, by name, each repeat's stitches said", steps.some((s) => s.startsWith("Knit the yoke from the chart “Snowflake”, its repeat 23 times round:")) && steps.some((s) => / stitches in each repeat\.$/.test(s)), steps.join(" | "));

  const fit = yokeFitOf(r, LOPI.gauge)!;
  check(results, "what the yoke wants of its chart: a round for each of its rounds, the neck's stitches from the first", fit.height === r.yokeRounds && fit.repeats === 23 && fit.sections[0].row === 0 && fit.sections[0].sts === c.perRepeat[3], JSON.stringify(fit));
  check(results, "…each increase round where the calculator has it, counted from 1 after the neckband", fit.sections.slice(1).every((s, i) => s.row === r.rounds[i].atRound - 1 && s.sts === r.rounds[i].to / 23), JSON.stringify(fit.sections));

  const g = decode(drawnChart());
  check(results, "a chart drawn bottom-up is not the yoke yet", !fitsYoke(g, fit));
  const f = fittedToYoke(g, fit);
  check(results, "fitted: knitted from the neck down, the yoke's rounds and repeats", f.kind === "yoke" && f.topDown && f.height === fit.height && f.repeats === 23 && fitsYoke(f, fit), JSON.stringify({ h: f.height, reps: f.repeats, s: f.sections }));
  check(results, "…the chart's gauge the calculator's", f.gauge.sts === 18 && f.gauge.rows === 24);
  // Turned round, the square drawn at the underarm is still at the underarm: the last of the chart's 30 rounds.
  check(results, "…what was drawn kept, the way up it is worn", f.cells[29 * f.width + 6] === 1, [...f.cells].findIndex((x) => x === 1).toString());
  const mask = stitchMask(f);
  const inRow = (y: number) => [...mask.slice(y * f.width, (y + 1) * f.width)].filter(Boolean).length;
  check(results, "…the neck's stitches at the first round, the whole repeat at the last", inRow(0) === c.perRepeat[3] && inRow(f.height - 1) === 12, `${inRow(0)} … ${inRow(f.height - 1)}`);
  check(results, "fitting a chart taller than the yoke counts the rounds with colourwork it would lose", fitLoses(f, { ...fit, height: 20 }) === 1 && fitLoses(f, fit) === 0);
  const again = fittedToYoke(f, fit);
  check(results, "fitting it again changes nothing", encode(again).cells === encode(f).cells && fitsYoke(again, fit));
}

export async function verifyYokeChart() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: Chart[]; measureUnit?: string } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".calculators");
  const field = (k: string) => view()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-k="${k}"]`) ?? null;
  const type = (k: string, v: string) => {
    const el = field(k)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const results_ = () => view()?.querySelector<HTMLElement>('[data-el="results"]')?.textContent ?? "";
  const act = (name: string) => view()?.querySelector<HTMLElement>(`[data-act="${name}"]`) ?? null;
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const cell = (row: string) =>
    [...(view()?.querySelectorAll<HTMLTableRowElement>(".calc-table tr") ?? [])].find((tr) => tr.querySelector("th")?.textContent === row)?.querySelectorAll("td") ?? [];
  const made: string[] = [];
  const unit = store.measureUnit;
  store.measureUnit = "cm";

  try {
    pure(results);

    const snow = await invoke<Chart>("add_chart", { input: { name: "Snowflake", data: drawnChart() } });
    made.push(snow.id);
    // The tab reads the charts as it opens.
    tab("patterns");
    tab("calculators");
    await waitFor(() => !!view()?.querySelector(".calc-pick"), "the calculators");
    (view()!.querySelector('[data-calc="yoke"]') as HTMLElement).click();
    await waitFor(() => !!field("chart"), "the round yoke");
    type("swatch", "");
    type("sts", "18");
    type("rows", "24");
    for (const [k, v] of [["chest", "96"], ["upperArm", "31"], ["wrist", "17"], ["neck", "38"], ["yokeDepth", "23"], ["armLength", "46"], ["bodyLength", "38"], ["bodyEase", "10"], ["sleeveEase", "5"], ["wristEase", "3"], ["neckEase", "10"], ["underarm", "5"], ["neckRib", "3"], ["hemRib", "6"], ["cuffRib", "6"], ["backNeck", "0"]]) type(k, v);
    type("increases", "3");
    type("rib", "2");
    check(results, "the round yoke offers its charts, none chosen to start with", [...field("chart")!.options].some((o) => o.value === snow.id && /Snowflake: a 12-stitch repeat/.test(o.textContent ?? "")) && !view()!.querySelector(".calc-chart"));

    type("chart", snow.id);
    await waitFor(() => !!view()!.querySelector(".calc-chart"), "the chart in the results");
    check(results, "a chart chosen: its repeat sets the counts, the repeat typed in put away", getComputedStyle(view()!.querySelector('[data-el="repeat-field"]')!).display === "none" && cell("Chart repeat")[0]?.textContent === "23 times round", results_());
    check(results, "…each increase round says the stitches in a repeat", /\d+ → \d+ a repeat/.test(cell("Increase round 1")[1]?.textContent ?? ""), cell("Increase round 1")[1]?.textContent ?? "");
    check(results, "…the steps knit the yoke from it", [...view()!.querySelectorAll(".calc-steps li")].some((li) => /^Knit the yoke from the chart “Snowflake”/.test(li.textContent ?? "")));
    check(results, "…not this yoke's shape yet: it says so, offering to fit it", !!view()!.querySelector('[data-el="chart-unfitted"]') && !!act("fit-chart"));
    const ring = view()!.querySelector<HTMLCanvasElement>('[data-el="yoke-ring"]')!;
    check(results, "…the yoke from above, drawn as it would be fitted", ring.width > 100 && ring.height > 100);

    act("fit-chart")!.click();
    await waitFor(() => !!view()!.querySelector('[data-el="chart-fitted"]'), "the chart fitted");
    const kept = store.charts.find((c) => c.id === snow.id)!.data;
    const rounds = Number((cell("Yoke")[0]?.textContent ?? "").split(" ")[0]);
    check(results, "Fit the chart gives it the yoke's rounds, repeats and increase rounds, from the neck down", kept.kind === "yoke" && kept.topDown && kept.repeats === 23 && kept.height === rounds && kept.sections.length === 4 && !act("fit-chart"), JSON.stringify({ h: kept.height, rounds, reps: kept.repeats, s: kept.sections }));
    check(results, "…what was drawn on it kept", decode(kept).cells.some((x) => x === 1));

    // Drawn on, and back.
    act("open-yoke-chart")!.click();
    await waitFor(() => !!document.querySelector(".chart-page .back"), "the chart");
    check(results, "Draw on the chart opens it, its back button going to the round yoke", document.querySelector(".chart-page .back")!.textContent === "← Round yoke");
    (document.querySelector(".chart-page .back") as HTMLElement).click();
    await waitFor(() => !!view()?.querySelector(".calc-chart"), "the round yoke again");
    check(results, "…and back, the round yoke with its chart, still fitted", !!view()!.querySelector('.calc-pick.on[data-calc="yoke"]') && field("chart")!.value === snow.id && !!view()!.querySelector('[data-el="chart-fitted"]'));

    // A shallower yoke would take colourwork away: asked first, and kept on Cancel.
    type("yokeDepth", "10");
    await waitFor(() => !!act("fit-chart"), "unfitted again");
    act("fit-chart")!.click();
    await waitFor(() => /have colourwork/.test(dialog()?.textContent ?? ""), "the question");
    dialog()!.querySelector<HTMLElement>("button.ghost")!.click();
    await wait(200);
    check(results, "fitting a chart to a shallower yoke asks first, saying the rounds would go; Cancel keeps them", store.charts.find((c) => c.id === snow.id)!.data.height === rounds && !!act("fit-chart"));
    type("yokeDepth", "23");
    await waitFor(() => !!view()!.querySelector('[data-el="chart-fitted"]'), "fitted at 23 cm");

    // A new one, made for this yoke.
    act("new-yoke-chart")!.click();
    await waitFor(() => !!dialog()?.querySelector("input.dialog-input"), "the new chart's questions");
    const inputs = [...dialog()!.querySelectorAll<HTMLInputElement>("input.dialog-input")];
    inputs[0].value = "Lice";
    inputs[1].value = "10";
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => store.charts.some((c) => c.name === "Lice") && !!view()?.querySelector('[data-el="chart-fitted"]'), "the new chart, fitted");
    const lice = store.charts.find((c) => c.name === "Lice")!;
    made.push(lice.id);
    check(results, "+ New yoke chart… makes one of the repeat asked, chosen, and made this yoke's shape", field("chart")!.value === lice.id && lice.data.width === 10 && lice.data.topDown && lice.data.repeats === 28 && lice.data.height === rounds, JSON.stringify({ w: lice.data.width, reps: lice.data.repeats, h: lice.data.height }));

    type("chart", "");
    check(results, "None: the repeat typed in again, no chart", !(view()!.querySelector('[data-el="repeat-field"]') as HTMLElement).hidden && !view()!.querySelector(".calc-chart") && !cell("Chart repeat").length);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (field("chart")) type("chart", "");
    for (const id of made) await invoke("delete_chart", { id }).catch(() => {});
    store.measureUnit = unit;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__yokeChartChecks = verifyYokeChart;
