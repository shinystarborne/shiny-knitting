/**
 * Checks for the row counter on a project's board: there by itself for a
 * project with a pattern, and no longer on the side; counting there; kept,
 * one card, when the board is drawn again or the page opened again; not
 * removable; and put there when a pattern is chosen for a project without.
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
  const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-counter") ?? null;
  const total = () => card()?.querySelector('[data-el="total"]')?.textContent?.trim() ?? "";
  const ids: string[] = [];
  const open = async (id: string, what: (p: HTMLElement) => boolean) => {
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
    await waitFor(() => !!page() && what(page()!), "the project's page");
  };
  try {
    const pattern = store.patterns.find((p) => p.format === "pdf")!;
    const knitted = await invoke<Project>("add_project", { input: { name: "Counted on the board", patternId: pattern.id, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    ids.push(knitted.id);
    await open(knitted.id, () => !!card()?.querySelector(".project-counter"));
    check(results, "a project with a pattern has its row counter on the board, by itself", !!card()?.querySelector('.project-counter [data-act="total-inc"]') && store.boardItems.filter((i) => i.boardId === knitted.id && i.kind === "counter").length === 1);
    check(results, "…and no longer on the side", !page()!.querySelector(".project-side .project-counter"));

    card()!.querySelector<HTMLElement>('[data-act="total-inc"]')!.click();
    card()!.querySelector<HTMLElement>('[data-act="total-inc"]')!.click();
    await waitFor(() => total() === "2", "counted", 5000).catch(() => {});
    check(results, "it counts there", total() === "2", total());

    // The board drawn again, a note added: the counter stays in its card, its count with it.
    (page()!.querySelector('.board-tools [data-add="note"]') as HTMLElement).click();
    await waitFor(() => !!page()!.querySelector(".board-item.kind-note"), "the note");
    await wait(200);
    check(results, "…kept in its card when the board is drawn again", !!card()?.querySelector(".project-counter") && total() === "2", total());

    // Not removable: no ✕, and Delete leaves it.
    check(results, "it has no ✕: it is moved and sized, not removed", !card()!.querySelector('[data-act="remove"]'));
    const cardItem = store.boardItems.find((i) => i.boardId === knitted.id && i.kind === "counter")!;
    const r = card()!.getBoundingClientRect();
    const board = page()!.querySelector<HTMLElement>(".board")!;
    // Picked by a press on its edge, then Delete.
    const at = { clientX: r.left + 4, clientY: r.bottom - 4, bubbles: true, pointerId: 9, button: 0, isPrimary: true };
    card()!.dispatchEvent(new PointerEvent("pointerdown", at));
    card()!.dispatchEvent(new PointerEvent("pointerup", at));
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await wait(400);
    check(results, "…and Delete leaves it", !document.querySelector(".dialog-card") && store.boardItems.some((i) => i.id === cardItem.id));
    for (let i = 0; i < 2 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Opened again: the one card, the count kept.
    await open(knitted.id, () => !!card()?.querySelector(".project-counter"));
    await waitFor(() => total() === "2", "the count again", 5000).catch(() => {});
    check(results, "opened again, the one card, the count kept", store.boardItems.filter((i) => i.boardId === knitted.id && i.kind === "counter").length === 1 && total() === "2", total());

    // A project with no pattern: none; a pattern chosen, the card comes.
    const bare = await invoke<Project>("add_project", { input: { name: "Not yet a pattern", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    ids.push(bare.id);
    await open(bare.id, (p) => !!p.querySelector(".board-tools"));
    await wait(300);
    check(results, "a project with no pattern has no counter card", !card());
    const picked = page()!.querySelector<HTMLInputElement>('.project-side [data-f="pattern"]');
    if (picked) {
      picked.value = pattern.id;
      picked.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await waitFor(() => !!card()?.querySelector(".project-counter"), "the counter card", 5000).catch(() => {});
    check(results, "…its pattern chosen, the counter's card is put on the board", !!card()?.querySelector(".project-counter") && store.boardItems.filter((i) => i.boardId === bare.id && i.kind === "counter").length === 1, picked ? "" : "no pattern field");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (const id of ids) await invoke("delete_project", { id }).catch(() => {});
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardCounterChecks = verifyBoardCounter;
