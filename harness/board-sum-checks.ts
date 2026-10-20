/**
 * Checks for the plain calculator on a project's board: the sums (× and ÷
 * before + and −, % as a phone has it, the decimal comma, dividing by
 * nothing, ±, ⌫, an operator changed), and the card: added from the toolbar,
 * its keys pressed, the keyboard's with it selected, its tape kept, sized with
 * all in it; and Constructors named so where Calculators were.
 *
 * Run with the harness open:
 *   window.__boardSumChecks()
 */
import type { BoardItem, Project } from "../src/api";
import { display, emptySum, evaluate, press, showNumber, type SumState } from "../src/views/sums";

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

/** Keys pressed in order, with the comma as the decimal sign. */
function keys(seq: string[], from: SumState = emptySum()): SumState {
  return seq.reduce((s, k) => press(s, k, ","), from);
}

function pure(results: CheckResult[]): void {
  const shown = (seq: string[]) => display(keys(seq), ",");
  check(results, "× and ÷ before + and −: 2 + 3 × 4 is 14, 84 ÷ 4 − 1 is 20", shown(["2", "+", "3", "×", "4", "="]) === "14" && shown(["8", "4", "÷", "4", "−", "1", "="]) === "20");
  check(results, "decimals with a comma: 2,5 × 4 is 10, 0,1 + 0,2 is 0,3", shown(["2", ",", "5", "×", "4", "="]) === "10" && shown([",", "1", "+", "0", ",", "2", "="]) === "0,3", shown([",", "1", "+", "0", ",", "2", "="]));
  check(results, "% as a phone has it: 200 + 10 % is 220, 50 × 10 % is 5", shown(["2", "0", "0", "+", "1", "0", "%", "="]) === "220" && shown(["5", "0", "×", "1", "0", "%", "="]) === "5");
  check(results, "dividing by nothing says so, and the next key starts again", shown(["5", "÷", "0", "="]) === "Can't divide by 0" && shown(["5", "÷", "0", "=", "7"]) === "7");
  check(results, "± turns the number, ⌫ takes its last figure, C starts again", shown(["1", "2", "±"]) === "-12" && shown(["1", "2", "3", "⌫"]) === "12" && shown(["9", "+", "1", "C"]) === "0");
  check(results, "an operator pressed again changes it: 6 + × 2 is 12", shown(["6", "+", "×", "2", "="]) === "12");
  check(results, "after =, an operator goes on from the answer, a figure starts anew", shown(["3", "×", "4", "=", "+", "1", "="]) === "13" && shown(["3", "×", "4", "=", "5"]) === "5");
  const tape = keys(["1", "2", "×", "4", "=", "+", "2", "="]).tape;
  check(results, "each sum goes on the tape", JSON.stringify(tape) === JSON.stringify(["12 × 4 = 48", "48 + 2 = 50"]), JSON.stringify(tape));
  check(results, "numbers are tidy: no 0,30000000000000004", showNumber(0.1 + 0.2, ",") === "0,3" && evaluate([1, "÷", 3]) !== null && showNumber(evaluate([1, "÷", 3])!, ",") === "0,333333333333");
}

export async function verifyBoardSums() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { boardItems: BoardItem[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-calc") ?? null;
  const shown = () => card()?.querySelector('[data-el="sum-display"]')?.textContent ?? "";
  const click = (k: string) => card()!.querySelector<HTMLElement>(`[data-act="sum"][data-key="${k}"]`)!.click();
  const type = (key: string) => page()!.querySelector<HTMLElement>(".board")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  let projectId = "";
  try {
    pure(results);
    check(results, "Calculators are Constructors now: the tab", document.querySelector('.tab-bar [data-tab="calculators"]')?.textContent === "Constructors");
    const project = await invoke<Project>("add_project", { input: { name: "Sums on the board", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!page()?.querySelector('.board-tools [data-add="calc"]'), "the project's board");
    check(results, "…and on the board: Constructors, and a Calculator beside", /Constructors/.test(page()!.querySelector('.board-tools [data-act="calculator"]')?.textContent ?? "") && /Calculator/.test(page()!.querySelector('.board-tools [data-add="calc"]')?.textContent ?? ""));

    (page()!.querySelector('.board-tools [data-add="calc"]') as HTMLElement).click();
    await waitFor(() => !!card(), "the calculator card");
    for (const k of ["1", "2", "×", "4", "="]) click(k);
    await wait(100);
    check(results, "its keys pressed: 12 × 4 = 48", shown() === "48", shown());
    // The keyboard, the card selected by its keys.
    for (const k of ["+", "2", "Enter"]) type(k);
    await wait(150);
    check(results, "…the keyboard's too, the card selected: + 2 Enter is 50", shown() === "50", shown());
    type("Backspace");
    type("Delete");
    await wait(300);
    check(results, "…Backspace and Delete are its, not the board's: the card stays", !!card() && !document.querySelector(".dialog-card"));
    await waitFor(() => (store.boardItems.find((i) => i.boardId === projectId && i.kind === "calc")?.data.tape as string[] | undefined)?.length === 2, "the tape kept", 3000).catch(() => {});
    const kept = store.boardItems.find((i) => i.boardId === projectId && i.kind === "calc")!.data.tape as string[];
    check(results, "its tape is kept with the card", JSON.stringify(kept) === JSON.stringify(["12 × 4 = 48", "48 + 2 = 50"]), JSON.stringify(kept));
    check(results, "…and shown on it", /12 × 4 = 48/.test(card()!.querySelector('[data-el="sum-tape"]')!.textContent ?? ""));

    // Sized: keys and figures with it.
    const fit = () => card()!.querySelector<HTMLElement>(".board-fit")!;
    card()!.style.width = "150px";
    card()!.style.height = "220px";
    await wait(300);
    const small = Number(fit().style.zoom || 1);
    const fits = fit().getBoundingClientRect().height <= card()!.getBoundingClientRect().height + 1;
    card()!.style.width = "560px";
    card()!.style.height = "840px";
    await wait(300);
    check(results, "a small calculator card is all there, smaller; a big one bigger", small < 0.6 && fits && Number(fit().style.zoom) > 1.5, `${small} ${fits} ${fit().style.zoom}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardSumChecks = verifyBoardSums;
