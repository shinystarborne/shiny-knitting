/**
 * Checks for yarn a finished project used up: its card on the project's
 * board still shows it, and the amount left, said wrong at the finish, is
 * put right from the project's page -- the yarn back in the stash and what
 * the project used made smaller.
 *
 * Run with the harness open:
 *   window.__leftoverChecks()
 */
import type { Project, Yarn, YarnUse } from "../src/api";
import { keep } from "./keep";

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

export async function verifyLeftovers() {
  const results: CheckResult[] = [];
  const restore = keep(["yarnUsage", "yarns", "projects", "projectYarns", "projectTools", "projectLog", "knitSessions", "boardItems"]);
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  let id = "";
  try {
    const y = await invoke<Yarn>("add_yarn", {
      input: { name: "Leftover Lopi", brand: "Istex", colourway: "Lava", yarnWeight: "Aran", metresPerBall: 100, gramsPerBall: 50, notes: "", fibres: [], superwash: false, plans: [], lots: [{ balls: 4, gramsLeft: 0 }] },
    });
    const p = await invoke<Project>("add_project", { input: { name: "Leftover sweater", patternId: null, notes: "", startedAt: Date.now() - 20 * 86400000, toolIds: [], yarns: [{ yarnId: y.id, lotId: null }] } });
    id = p.id;
    await invoke("add_board_item", { boardId: id, input: { kind: "yarn", x: 40, y: 40, w: 220, h: 260, data: { yarnId: y.id } } });
    // All of it said used, by a slip.
    await invoke("finish_project", { id, input: { finishedAt: Date.now(), leftovers: [{ entryId: p.yarns[0].id, grams: 0 }] } });
    const stored = () => (window as unknown as { __store: { yarns: Yarn[] } }).__store.yarns.find((x) => x.id === y.id)!;
    check(results, "all of it said used, the yarn is in the stash's history", !!stored().usedUpAt);

    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
    await waitFor(() => !!page()?.querySelector('[data-act="leftover"]') && !!page()?.querySelector('.board-item[data-kind="yarn"] .board-caption'), "the project's page and board");
    const caption = page()!.querySelector<HTMLElement>('.board-item[data-kind="yarn"] .board-caption')!;
    check(results, "its card on the board still shows the yarn used up", !caption.classList.contains("missing") && caption.textContent!.includes("Leftover Lopi"), caption.textContent ?? "");
    const row = () => page()!.querySelector<HTMLElement>('[data-act="leftover"]')!.closest("li")!.textContent ?? "";
    check(results, "the project's page says it was used up, with Change by it, the yarn named with its colour", /Leftover Lopi · Lava · used up/.test(row()), row());

    // Put right: 120 g left after all.
    page()!.querySelector<HTMLElement>('[data-act="leftover"]')!.click();
    await waitFor(() => !!dialog()?.querySelector("input"), "the question");
    const field = dialog()!.querySelector<HTMLInputElement>("input")!;
    check(results, "Change asks for the grams left of the yarn in its colour, filled in with what was said", field.value === "0" && /Leftover Lopi · Lava/.test(dialog()!.textContent ?? ""), field.value);
    field.value = "120";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => /120 g left/.test(row()), "the page saying 120 g left");
    const uses = await invoke<YarnUse[]>("list_yarn_usage");
    const took = uses.filter((u) => u.projectId === id && u.yarnId === y.id);
    check(results, "the 120 g are back in the stash, out of the history", stored().lots[0].gramsLeft === 120 && !stored().usedUpAt, JSON.stringify(stored().lots));
    check(results, "…and the project used the rest: 80 g, once", took.length === 1 && took[0].grams === 80, JSON.stringify(took));

    // More than it had is refused, and nothing changes.
    page()!.querySelector<HTMLElement>('[data-act="leftover"]')!.click();
    await waitFor(() => !!dialog()?.querySelector("input"), "the question again");
    dialog()!.querySelector<HTMLInputElement>("input")!.value = "500";
    dialog()!.querySelector<HTMLInputElement>("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => /more than the project had \(200 g\)/.test(dialog()?.textContent ?? ""), "the refusal");
    check(results, "more left than the project had is refused", stored().lots[0].gramsLeft === 120);
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await waitFor(() => !dialog(), "the refusal closed");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (id) await invoke("delete_project", { id }).catch(() => {});
    restore();
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__leftoverChecks = verifyLeftovers;
