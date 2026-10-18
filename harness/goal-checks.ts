/**
 * Checks for yearly goals: how far along one is (projects finished that year,
 * the stash's grams or metres used that year, or your own count), where it
 * stands against the year, and the panel at the top of Statistics: set,
 * counted, changed and taken away.
 *
 * Run with the harness open:
 *   window.__goalChecks()
 */
import type { Goal, Project, YarnUse } from "../src/api";
import { goalPace, goalProgress, goalTitle } from "../src/views/goals";

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

function pure(results: CheckResult[]): void {
  const goal = (kind: Goal["kind"], target: number, done = 0): Goal => ({ id: "g", year: 2026, kind, label: kind === "own" ? "learn brioche" : "", target, done, addedAt: 0 });
  const at = (m: number, d = 15) => new Date(2026, m, d).getTime();
  const projects = [
    { status: "finished", finishedAt: at(1) },
    { status: "finished", finishedAt: at(9) },
    { status: "finished", finishedAt: new Date(2025, 11, 31, 23).getTime() },
    { status: "active", finishedAt: null },
  ] as unknown as Project[];
  const uses = [
    { at: at(2), grams: 300, metres: 600 },
    { at: at(5), grams: 120, metres: 0 },
    { at: new Date(2027, 0, 1).getTime(), grams: 999, metres: 999 },
  ] as unknown as YarnUse[];
  check(results, "a goal of projects counts those finished that year, not the year before", goalProgress(goal("projects", 4), projects, uses).done === 2 && goalProgress(goal("projects", 4), projects, uses).share === 0.5);
  check(results, "…of grams or metres, the stash used that year", goalProgress(goal("grams", 1000), projects, uses).done === 420 && goalProgress(goal("metres", 1000), projects, uses).done === 600);
  check(results, "…of your own, its count, the bar never past full", goalProgress(goal("own", 3, 5), projects, uses).done === 5 && goalProgress(goal("own", 3, 5), projects, uses).share === 1);
  const midYear = new Date(2026, 6, 2).getTime();
  check(results, "where it stands: ahead or behind the days gone, reached, or a year gone not reached", goalPace(goal("projects", 12), 7, midYear).word === "ahead" && goalPace(goal("projects", 12), 5, midYear).word === "behind" && Math.round(goalPace(goal("projects", 12), 5, midYear).expected) === 6 && goalPace(goal("projects", 12), 12, midYear).word === "reached" && goalPace(goal("projects", 12), 3, new Date(2027, 1, 1).getTime()).word === "missed");
  check(results, "a goal in words", goalTitle(goal("projects", 12)) === "Finish 12 projects" && goalTitle(goal("grams", 2000)) === "Use 2 000 g of the stash" && goalTitle(goal("own", 3)) === "learn brioche", goalTitle(goal("grams", 2000)));
}

export async function verifyGoals() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { goals: Goal[]; projects: Project[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const panel = () => document.querySelector<HTMLElement>(".stash-stats .goals-panel");
  const goals = () => [...(panel()?.querySelectorAll<HTMLElement>(".goal") ?? [])];
  const dialog = () => document.querySelector<HTMLElement>(".goal-dialog");
  const year = new Date().getFullYear();
  const before = [...store.goals];
  const finishedNow = store.projects.filter((p) => p.status === "finished" && p.finishedAt && new Date(p.finishedAt).getFullYear() === year).length;
  const setGoal = async (kind: string, target: string, label = "") => {
    await waitFor(() => !!dialog(), "the goal dialog");
    const d = dialog()!;
    const select = d.querySelector<HTMLSelectElement>('[data-f="kind"]')!;
    select.value = kind;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    d.querySelector<HTMLInputElement>('[data-f="label"]')!.value = label;
    d.querySelector<HTMLInputElement>('[data-f="target"]')!.value = target;
    (d.querySelector('[data-act="save"]') as HTMLElement).click();
  };
  try {
    pure(results);
    store.goals = [];

    tab("stash");
    await waitFor(() => !!document.querySelector('[data-act="stash-mode"][data-mode="stats"]'), "the stash");
    document.querySelector<HTMLElement>('[data-act="stash-mode"][data-mode="stats"]')!.click();
    await waitFor(() => !!panel()?.querySelector('[data-act="goal-add"]'), "the goals");
    check(results, "Statistics start with the year's goals, saying there are none yet", new RegExp(`No goals for ${year} yet`).test(panel()!.textContent ?? "") && document.querySelector(".stats-body")!.firstElementChild === panel());

    (panel()!.querySelector('[data-act="goal-add"]') as HTMLElement).click();
    await setGoal("projects", "12");
    await waitFor(() => goals().length === 1, "the goal set");
    check(results, "a goal set: projects finished this year counted, a bar, where it stands", /Finish 12 projects/.test(goals()[0].textContent ?? "") && new RegExp(`${finishedNow} of 12`).test(goals()[0].textContent ?? "") && !!goals()[0].querySelector(".goal-bar i") && /Ahead|Behind|Reached/.test(goals()[0].querySelector(".goal-pace")!.textContent ?? ""), goals()[0].textContent?.replace(/\s+/g, " ") ?? "");

    (panel()!.querySelector('[data-act="goal-add"]') as HTMLElement).click();
    await setGoal("own", "3", " ");
    await waitFor(() => !!dialog()?.querySelector('[data-el="error"]:not([hidden])'), "the refusal");
    check(results, "your own goal needs its words", /Say what your own goal is/.test(dialog()!.textContent ?? ""));
    await setGoal("own", "3", "learn brioche");
    await waitFor(() => goals().length === 2, "your own goal");
    const own = () => goals()[1];
    check(results, "…said, it is counted by hand, from 0", /learn brioche/.test(own().textContent ?? "") && /0 of 3/.test(own().textContent ?? "") && !!own().querySelector('[data-act="goal-more"]') && !goals()[0].querySelector('[data-act="goal-more"]'));
    for (let i = 0; i < 3; i++) {
      (own().querySelector('[data-act="goal-more"]') as HTMLElement).click();
      await wait(150);
    }
    await waitFor(() => /3 of 3/.test(own().textContent ?? ""), "counted up");
    check(results, "…+ counts it, and at its number it is reached", own().classList.contains("reached") && /Reached/.test(own().textContent ?? "") && store.goals.find((g) => g.kind === "own")!.done === 3);

    (goals()[0].querySelector('[data-act="goal-edit"]') as HTMLElement).click();
    await waitFor(() => dialog()?.querySelector<HTMLInputElement>('[data-f="target"]')?.value === "12", "the goal to change");
    await setGoal("projects", "20");
    await waitFor(() => /Finish 20 projects/.test(goals()[0]?.textContent ?? ""), "the change");
    check(results, "Change: the goal changed, not another set", goals().length === 2 && store.goals.length === 2);

    (own().querySelector('[data-act="goal-remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the question");
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => goals().length === 1, "taken away");
    check(results, "…and one taken away, after asking", store.goals.length === 1);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.goals = before;
    document.querySelector<HTMLElement>('.goal-dialog [data-act="cancel"]')?.click();
    document.querySelector<HTMLElement>('[data-act="stash-mode"][data-mode="yarn"]')?.click();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__goalChecks = verifyGoals;
