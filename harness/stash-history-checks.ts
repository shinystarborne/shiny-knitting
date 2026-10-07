/**
 * Checks for the stash's history and statistics, clicked through: a yarn
 * marked used up leaves the stash for the History and comes back; finishing
 * a project with nothing left of a yarn sends it there too.
 *
 * Run with the harness open, after the other suites:
 *   window.__stashHistoryChecks()
 */

import { additions, flowByMonth, niceScale } from "../src/views/usage-chart";
import type { Yarn, YarnUse } from "../src/api";

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

type StoredYarn = { id: string; name: string; usedUpAt?: number | null };
type Store = {
  yarnUsage: unknown[];
  yarns: StoredYarn[];
  projects: { id: string }[];
  projectYarns: { yarnId: string }[];
};

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** The month arithmetic: calendar months, first day to last, in local time. */
function pure(results: CheckResult[]): void {
  const use = (at: Date, metres: number, grams = 10): YarnUse => ({ id: String(+at), yarnId: null, yarnName: "Y", projectId: null, projectName: "", at: +at, grams, metres, source: "finished" });
  // 15 March 2028, a leap year.
  const now = new Date(2028, 2, 15, 12).getTime();
  const uses = [
    use(new Date(2028, 1, 1, 0, 0, 0), 100), // the first moment of February
    use(new Date(2028, 1, 29, 23, 59, 59), 50), // the last of February: a leap day
    use(new Date(2028, 2, 1, 0, 0, 0), 7), // the first of March
    use(new Date(2027, 2, 31, 23, 0), 999), // a year and more ago: not shown
    use(new Date(2027, 3, 1, 9), 3, 40), // April last year: the first month shown
    use(new Date(2028, 2, 2), 0, 25), // no metres per ball
  ];
  const months = flowByMonth([], uses, now);
  check(results, "twelve calendar months, the current one last", months.length === 12 && months[11].label === "March 2028" && months[0].label === "April 2027", `${months[0].label} … ${months[11].label}`);
  check(results, "a month runs from its first moment to its last, a leap day too", months[10].used.metres === 150 && months[10].used.items.length === 2, String(months[10].used.metres));
  check(results, "…the next starts at midnight on the 1st", months[11].used.metres === 7 && months[11].used.grams === 35 && months[11].used.gramsWithoutMetres === 25, JSON.stringify([months[11].used.metres, months[11].used.grams]));
  check(results, "…and what is older than the twelve is left out", months[0].used.metres === 3 && months.reduce((n, m) => n + m.used.metres, 0) === 160);

  // Added: each lot as bought.
  const lot = (balls: number, gramsLeft: number, boughtAt: number | null, leftover = false) => ({ id: "l", yarnId: "y", dyeLot: "", balls, gramsLeft, location: "", boughtAt, leftover });
  const yarn = { brand: "Drops", name: "Air", colourway: "01", metresPerBall: 150, gramsPerBall: 50, addedAt: new Date(2028, 0, 20).getTime(),
    lots: [lot(3, 60, new Date(2028, 2, 3).getTime()), lot(0, 40, null), lot(0, 25, null, true)] } as unknown as Yarn;
  const adds = additions([yarn]);
  check(results, "added: a lot as bought, its balls by the ball band, in metres too", adds[0].grams === 150 && adds[0].metres === 450 && adds[0].what === "3 balls" && adds[0].yarnName === "Drops Air (01)", JSON.stringify(adds[0]));
  check(results, "…a lot only weighed by its grams, dated when the yarn was added", adds[1]?.grams === 40 && new Date(adds[1].at).getMonth() === 0, JSON.stringify(adds[1]));
  check(results, "…and what a finished project left is not counted as added again", adds.length === 2);
  const both = flowByMonth(adds, uses, now);
  check(results, "added and used side by side, each month", both[11].added.metres === 450 && both[11].used.metres === 7 && both[9].added.grams === 40, JSON.stringify([both[11].added.metres, both[9].added.grams]));
  const scale = (max: number) => JSON.stringify(niceScale(max));
  check(results, "the axis goes up in round steps", scale(437) === JSON.stringify({ top: 600, step: 200 }) && scale(1240) === JSON.stringify({ top: 1500, step: 500 }) && niceScale(0).top > 0, `${scale(437)} ${scale(1240)}`);
}

export async function verifyStashHistory() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const mode = (m: string) => (document.querySelector(`.lib-title [data-mode="${m}"]`) as HTMLElement).click();
  const cardFor = (id: string) => document.querySelector<HTMLElement>(`.card[data-open="${id}"]`);
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const added: string[] = [];

  try {
    pure(results);
    store.yarnUsage = [];
    const yarn = async (name: string, brand: string, colourway: string) => {
      const y = await invoke<StoredYarn>("add_yarn", {
        input: { name, brand, colourway, yarnWeight: "Lace", metresPerBall: 150, gramsPerBall: 50, notes: "", fibres: [{ name: "alpaca", percent: 70 }], superwash: false, plans: [], lots: [{ balls: 2, gramsLeft: 100 }] },
      });
      added.push(y.id);
      return y;
    };
    const air = await yarn("Air", "Drops", "01 Off white");
    const kid = await yarn("Kid-Silk", "Drops", "03 Pink");

    // ---------- used up, from a card ----------
    tab("patterns");
    await waitFor(() => !document.querySelector(".stash"), "the library");
    tab("stash");
    await waitFor(() => !!document.querySelector('.lib-title [data-mode="yarn"]') && !!cardFor(air.id), "the stash");
    const total = document.querySelector<HTMLElement>('[data-el="total"]')?.textContent ?? "";
    check(results, "the stash says its metres and weight in all", /^In the stash: [\d,]+ m · [\d.,]+ k?g in \d+ yarns/.test(total), total);
    check(results, "the Stash switches between Yarn, Swatches, History and Statistics: no Ball bands", [...document.querySelectorAll<HTMLElement>(".lib-title [data-mode]")].map((b) => b.dataset.mode).join() === "yarn,swatches,history,stats");
    (cardFor(air.id)!.querySelector("[data-used-up]") as HTMLElement).click();
    await waitFor(() => !!dialog(), "the question");
    check(results, "Used up asks first, saying where it goes", /moves to the stash's History/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Used up")!.click();
    await waitFor(() => !cardFor(air.id), "the card to go");
    check(results, "a yarn used up leaves the stash", !!store.yarns.find((y) => y.id === air.id)!.usedUpAt && !!cardFor(kid.id));

    mode("history");
    await waitFor(() => !!document.querySelector(".stash-history") && !!cardFor(air.id), "the history");
    check(results, "…and is in the History, saying when", /Used up \d+ \w+ \d{4}/.test(cardFor(air.id)!.textContent ?? "") && !cardFor(kid.id), cardFor(air.id)!.textContent ?? "");
    (cardFor(air.id)!.querySelector('[data-act="restore"]') as HTMLElement).click();
    await waitFor(() => !cardFor(air.id), "it to leave the history");
    check(results, "Back in the stash undoes it", !store.yarns.find((y) => y.id === air.id)!.usedUpAt);

    // ---------- used up, by finishing ----------
    const project = await invoke<{ id: string; yarns: { id: string; yarnId: string }[] }>("add_project", {
      input: { name: "Lace shawl", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [{ id: null, yarnId: kid.id, lotId: null }] },
    });
    await invoke("finish_project", { id: project.id, input: { finishedAt: Date.now(), leftovers: [{ entryId: project.yarns[0].id, grams: 0 }] } });
    mode("yarn");
    await waitFor(() => !!document.querySelector(".stash") && !!cardFor(air.id), "the stash");
    mode("stats");
    await waitFor(() => !!document.querySelector(".stash-stats .usage-col"), "the statistics");
    const thisMonth = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const figures = [...document.querySelectorAll<HTMLElement>(".usage-figure")].map((f) => f.textContent?.replace(/\s+/g, " ").trim() ?? "");
    check(results, "Statistics: this month's yarn used, the 100 g the shawl took, by its ball band", document.querySelector(".usage-detail h3")?.textContent === thisMonth && /^Used\s*300 m\s*100 g/.test(figures[1] ?? ""), figures.join(" | "));
    check(results, "…and added, the lots bought this month among them", /^Added\s*[\d,]+ m\s*[\d,]+ g/.test(figures[0] ?? "") && /Drops Air \(01 Off white\)\s*300 m\s*100 g · 2 balls/.test(document.querySelector(".usage-detail")?.textContent ?? ""), figures[0]);
    check(results, "…a pair of columns a month for twelve months, this one chosen, with a legend", document.querySelectorAll(".usage-col").length === 12 && document.querySelectorAll(".usage-col .usage-bar").length === 24 && !!document.querySelector('.usage-col.chosen[data-month="11"]') && /Added\s*Used/.test(document.querySelector(".usage-legend")?.textContent ?? ""));
    const listed = [...document.querySelectorAll(".usage-list li")].map((li) => li.textContent ?? "").join(" | ");
    check(results, "…with what took it", /Drops Kid-Silk \(03 Pink\)\s*300 m\s*100 g · Lace shawl/.test(listed), listed);
    (document.querySelector('[data-unit="g"]') as HTMLElement).click();
    check(results, "Grams counts the chart in grams", /^Grams/.test(document.querySelector(".usage-chart")?.getAttribute("aria-label") ?? "") && /g$/.test(document.querySelectorAll(".stat-tile b")[1]?.textContent ?? ""), document.querySelectorAll(".stat-tile b")[1]?.textContent ?? "");
    (document.querySelector('[data-unit="m"]') as HTMLElement).click();
    mode("history");
    await waitFor(() => !!cardFor(kid.id), "the finished project's yarn in the history");
    check(results, "Back in the stash took back what marking it used up counted", store.yarnUsage.length === 1);
    check(results, "finishing a project with nothing left of a yarn puts it in the History, with what it went into", /Went into: Lace shawl/.test(cardFor(kid.id)!.textContent ?? ""), cardFor(kid.id)!.textContent ?? "");

  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    store.yarns = store.yarns.filter((y) => !added.includes(y.id));
    document.querySelector<HTMLElement>('.lib-title [data-mode="yarn"]')?.click();
    tab("patterns");
    await waitFor(() => !document.querySelector(".stash"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__stashHistoryChecks = verifyStashHistory;
