/**
 * Checks for the row counter on a project's board, put there if wanted: none
 * by itself, and none on the side; the Counter button putting it there,
 * unfolded; counting there, and kept when the board is drawn again or the
 * page opened again; removed like any card, and the count keys then left
 * alone; and a project with no pattern told to choose one first.
 *
 * Run with the harness open:
 *   window.__boardCounterChecks()
 */
import type { BoardItem, Pattern, Project } from "../src/api";

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

export async function verifyBoardCounter() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { boardItems: BoardItem[]; patterns: Pattern[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-counter") ?? null;
  const total = () => page()?.querySelector('.project-counter [data-el="total"]')?.textContent?.trim() ?? "";
  const addCounter = () => (page()!.querySelector('.board-tools [data-add="counter"]') as HTMLElement).click();
  const ids: string[] = [];
  const open = async (id: string) => {
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
    await waitFor(() => !!page()?.querySelector('.board-tools [data-add="counter"]'), "the project's board");
    await wait(300);
  };
  try {
    const pattern = store.patterns.find((p) => p.format === "pdf")!;
    const knitted = await invoke<Project>("add_project", { input: { name: "Counted if wanted", patternId: pattern.id, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    ids.push(knitted.id);
    await open(knitted.id);
    check(results, "no counter by itself: not on the board, not on the side", !card() && !page()!.querySelector(".project-side .project-counter") && !store.boardItems.some((i) => i.boardId === knitted.id && i.kind === "counter"));

    // Counted with the keys, there is nothing to count: they are left alone.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
    await wait(400);
    check(results, "…and the count keys are left alone", total() === "0" || total() === "", total());

    addCounter();
    await waitFor(() => !!card()?.querySelector(".project-counter"), "the counter card");
    const shown = (sel: string) => {
      const el = card()?.querySelector<HTMLElement>(sel);
      return !!el && getComputedStyle(el).display !== "none";
    };
    check(results, "Counter puts it on the board: the counts and their − and +, the rest under a gear", shown('[data-act="total-inc"]') && shown('[data-act="total-dec"]') && shown('[data-act="settings"]') && !shown(".quick") && !shown('[data-act="sound"]') && !shown('[data-act="add-counter"]') && !shown(".counter-keys") && !card()!.querySelector('[data-act="collapse"]'));
    card()!.querySelector<HTMLElement>('[data-act="settings"]')!.click();
    await wait(100);
    check(results, "…the gear shows the settings", shown(".quick") && shown('[data-act="sound"]') && shown('[data-act="add-counter"]') && shown(".counter-keys"));
    card()!.querySelector<HTMLElement>('[data-act="settings"]')!.click();
    await wait(100);
    check(results, "…and hides them again", !shown(".quick") && !shown(".counter-keys"));

    // Sized: what is in it is sized with it.
    const fit = () => card()!.querySelector<HTMLElement>(".board-fit")!;
    const zoom = () => Number(fit().style.zoom || 1);
    card()!.style.width = "150px";
    card()!.style.height = "160px";
    await wait(300);
    const small = zoom();
    const fits = fit().getBoundingClientRect().height <= card()!.getBoundingClientRect().height + 1 && fit().getBoundingClientRect().width <= card()!.getBoundingClientRect().width + 1;
    card()!.style.width = "560px";
    card()!.style.height = "800px";
    await wait(300);
    check(results, "a small counter card is all there, smaller; a big one bigger", small < 0.6 && fits && zoom() > 1.5, `${small} ${fits} ${zoom()}`);
    card()!.style.width = "320px";
    card()!.style.height = "440px";
    await wait(200);
    addCounter();
    await wait(200);
    check(results, "…one: Counter again picks it", page()!.querySelectorAll(".board-item.kind-counter").length === 1);

    card()!.querySelector<HTMLElement>('[data-act="total-inc"]')!.click();
    card()!.querySelector<HTMLElement>('[data-act="total-inc"]')!.click();
    await waitFor(() => total() === "2", "counted", 5000).catch(() => {});
    check(results, "it counts there", total() === "2", total());

    (page()!.querySelector('.board-tools [data-add="note"]') as HTMLElement).click();
    await waitFor(() => !!page()!.querySelector(".board-item.kind-note"), "the note");
    await wait(200);
    check(results, "…kept in its card when the board is drawn again", !!card()?.querySelector(".project-counter") && total() === "2", total());

    await open(knitted.id);
    await waitFor(() => !!card()?.querySelector(".project-counter") && total() === "2", "the count again", 5000).catch(() => {});
    check(results, "opened again: there, the count kept", !!card()?.querySelector(".project-counter") && total() === "2", total());

    // Removed like any card.
    card()!.querySelector<HTMLElement>('[data-act="remove"]')!.click();
    await waitFor(() => !!dialog(), "the question");
    dialog()!.querySelector<HTMLElement>("button.danger, button.primary")!.click();
    await waitFor(() => !card(), "removed", 5000).catch(() => {});
    check(results, "its ✕ takes it off the board", !card() && !store.boardItems.some((i) => i.boardId === knitted.id && i.kind === "counter"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
    await wait(400);
    check(results, "…the count kept, and the keys left alone again", total() === "2", total());

    // No pattern: it says to choose one.
    const bare = await invoke<Project>("add_project", { input: { name: "Not yet a pattern", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    ids.push(bare.id);
    await open(bare.id);
    addCounter();
    await waitFor(() => !!dialog(), "the word", 3000).catch(() => {});
    check(results, "a project with no pattern is told to choose one first", /Choose a pattern first/.test(dialog()?.textContent ?? "") && !card());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (const id of ids) await invoke("delete_project", { id }).catch(() => {});
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardCounterChecks = verifyBoardCounter;
