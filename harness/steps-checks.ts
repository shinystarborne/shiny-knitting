/**
 * Checks for a calculator's steps as a checklist: how many times a step is
 * worked read from its words; ticking, and counting a step that repeats; and
 * the card on a project's board, the one knitted now marked.
 *
 * Run with the harness open:
 *   window.__stepsChecks()
 */
import type { BoardItem, Project } from "../src/api";
import { countStep, nowAt, repeatsIn, stepList, tick } from "../src/views/steps";

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

const STEPS = [
  "Cast on 104 stitches and join in the round.",
  "Decrease round: k1, k2tog, knit to 3 stitches before the end, ssk, k1: 2 stitches fewer. Work it every 6 rounds 3 times, to 72 stitches.",
  "Increase on every other round 2 times, then on every round 1 times.",
  "Bind off loosely.",
];

function pure(results: CheckResult[]): void {
  check(results, "a step's times read from its words: every 6 rounds 8 times is 8", repeatsIn(STEPS[1]) === 3 && repeatsIn("Work it every 6 rounds 8 times, to 40 stitches.") === 8);
  check(results, "…both parts added: every other round 5 times, then every round 3 times, is 8", repeatsIn("Increase on every other round 5 times, then on every round 3 times.") === 8);
  check(results, "…not a repeat across a round, nor a chart's round", repeatsIn("Increase round: *K6, M1* 4 times.") === 0 && repeatsIn("Knit the yoke from the chart, its repeat 8 times round.") === 0 && repeatsIn(STEPS[0]) === 0);
  check(results, "…a sock's gusset, its words in brackets between", repeatsIn("Decrease 2 on the sole every other round (k2tog at the end of the first gusset, ssk at the start of the other) 8 times, back to 64.") === 8);

  let list = stepList("Raglan", "Gauge 22 × 30", STEPS);
  check(results, "a checklist starts with nothing done, the first knitted now", nowAt(list) === 0 && list.steps.every((s) => !s.done && s.count === 0) && list.steps[1].times === 3);
  list = tick(list, 0);
  check(results, "…ticked, the next is knitted now", list.steps[0].done && nowAt(list) === 1);
  list = countStep(countStep(list, 1, 1), 1, 1);
  check(results, "…a repeating step counted, not done until its last", list.steps[1].count === 2 && !list.steps[1].done);
  list = countStep(list, 1, 1);
  check(results, "…and done at its last, by itself", list.steps[1].count === 3 && list.steps[1].done && nowAt(list) === 2);
  list = countStep(list, 1, 1);
  check(results, "…never counted past its times", list.steps[1].count === 3);
  list = countStep(list, 1, -1);
  check(results, "…one back, not done again", list.steps[1].count === 2 && !list.steps[1].done && nowAt(list) === 1);
  list = tick(tick(list, 1), 1);
  check(results, "…ticked by hand it is counted to the end; unticked, one short", list.steps[1].count === 2 && !list.steps[1].done);
}

export async function verifySteps() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { boardItems: BoardItem[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-steps");
  const stepEls = () => [...(card()?.querySelectorAll<HTMLElement>(".board-step") ?? [])];
  const stored = () => store.boardItems.find((i) => i.kind === "steps" && i.boardId === projectId)!;
  let projectId = "";
  try {
    pure(results);

    const project = await invoke<Project>("add_project", { input: { name: "Checklist sweater", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    await invoke("add_board_item", { boardId: projectId, input: { kind: "steps", x: 40, y: 40, w: 480, h: 620, data: { ...stepList("Raglan for Mo", "Gauge 22 sts × 30 rows per 10 cm.", STEPS) } } });
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector<HTMLElement>(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => stepEls().length === 4, "the checklist on the board");
    check(results, "on the board, a checklist: its title, how far along, the gauge, the steps", /Raglan for Mo/.test(card()!.textContent ?? "") && /0 of 4 done/.test(card()!.textContent ?? "") && /Gauge 22/.test(card()!.textContent ?? ""));
    check(results, "…the first marked as knitted now", stepEls()[0].classList.contains("now") && /Knitting now/.test(stepEls()[0].textContent ?? "") && stepEls().filter((s) => s.classList.contains("now")).length === 1);
    check(results, "…a repeating step with its counter, a step done once without", !!stepEls()[1].querySelector(".step-count") && /0 of 3/.test(stepEls()[1].querySelector(".step-count")!.textContent ?? "") && !stepEls()[0].querySelector(".step-count"));

    stepEls()[0].querySelector<HTMLElement>('[data-act="step-tick"]')!.click();
    await waitFor(() => stepEls()[0].classList.contains("done"), "ticked");
    check(results, "ticked, it is crossed off, the next knitted now, and it is kept", stepEls()[1].classList.contains("now") && /1 of 4 done/.test(card()!.textContent ?? ""));
    await waitFor(() => (stored().data.steps as { done: boolean }[])[0].done, "kept", 3000).catch(() => {});
    check(results, "…kept on the board", (stored().data.steps as { done: boolean }[])[0].done === true);

    for (let i = 0; i < 3; i++) {
      stepEls()[1].querySelector<HTMLElement>('[data-act="step-more"]')!.click();
      await wait(120);
    }
    await waitFor(() => stepEls()[1].classList.contains("done"), "counted to the end");
    check(results, "+ counts a repeating step, which is done at its last time", /3 of 3/.test(stepEls()[1].querySelector(".step-count")?.textContent ?? "") && stepEls()[2].classList.contains("now"));
    stepEls()[1].querySelector<HTMLElement>('[data-act="step-less"]')!.click();
    await waitFor(() => !stepEls()[1].classList.contains("done"), "one back");
    check(results, "…− takes one back, and it is knitted now again", stepEls()[1].classList.contains("now") && /2 of 3/.test(stepEls()[1].textContent ?? ""));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    store.boardItems = store.boardItems.filter((i) => i.kind !== "steps" || i.boardId !== projectId);
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__stepsChecks = verifySteps;
