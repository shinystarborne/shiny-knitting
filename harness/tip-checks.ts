/**
 * Checks for one tip of a pair of interchangeable tips on a project: a 5 mm
 * right needle and a 4.5 mm left, each tip chosen in the project's form and
 * said wherever its needles are listed; the other tip of the pair free for
 * another project, offered there as such and taken as the other side; the
 * card in Needles & hooks saying where each tip is.
 *
 * Run with the harness open:
 *   window.__tipChecks()
 */
import type { Project, Tool } from "../src/api";
import { isFree, tipLabel, tipsFree } from "../src/views/tool-filter";

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
  const tips = (uses: Tool["uses"]) => ({ kind: "tips", projectId: uses[0]?.projectId ?? null, uses }) as Tool;
  check(results, "a pair on no project has both tips free", tipsFree(tips([])) === 2 && isFree(tips([])));
  check(results, "…one tip on a project leaves one free, and it counts as free", tipsFree(tips([{ projectId: "a", projectName: "A", tip: "right" }])) === 1 && isFree(tips([{ projectId: "a", projectName: "A", tip: "right" }])));
  check(results, "…the pair, or a tip each on two, none", tipsFree(tips([{ projectId: "a", projectName: "A", tip: "" }])) === 0 && tipsFree(tips([{ projectId: "a", projectName: "A", tip: "right" }, { projectId: "b", projectName: "B", tip: "left" }])) === 0);
  check(results, "a tip is said as which hand", tipLabel("right") === "right tip" && tipLabel("left") === "left tip" && tipLabel("") === "");
}

export async function verifyTips() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { projects: Project[]; projectTools: { projectId: string; toolId: string; tip?: string }[] } }).__store;
  /** A project's tips as kept, by tool: what its links say. */
  const tipsOf = (id: string) => JSON.stringify(Object.fromEntries(store.projectTools.filter((l) => l.projectId === id && l.tip).map((l) => [l.toolId, l.tip]).sort()));
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal.project-form");
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const made: string[] = [];
  const projects: string[] = [];

  try {
    pure(results);

    const add = async (input: Partial<Tool>) => {
      const t = await invoke<Tool>("add_tool", { input: { lengthCm: 13, cableCm: 0, cableSize: "small", brand: "ChiaoGoo", material: "metal", notes: "", projectId: null, ...input } });
      made.push(t.id);
      return t;
    };
    const five = await add({ kind: "tips", sizeMm: 5 });
    const four = await add({ kind: "tips", sizeMm: 4.5 });
    const cable = await add({ kind: "cable", sizeMm: 0, lengthCm: 0, cableCm: 80 });
    const project = async (name: string, toolIds: string[]) => {
      const p = await invoke<Project>("add_project", { input: { name, patternId: null, notes: "", startedAt: null, toolIds, yarns: [] } });
      projects.push(p.id);
      return p;
    };
    const brioche = await project("Brioche cowl", [five.id, four.id, cable.id]);
    const edit = async (id: string) => {
      document.querySelector<HTMLElement>(".projects, .project-page, .library")!.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, detail: id }));
      await waitFor(() => !!modal()?.querySelector('[data-el="tool-add"], .tool-list'), "the project's form");
    };
    const tip = (id: string) => modal()!.querySelector<HTMLSelectElement>(`[data-tip="${id}"]`);

    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    await edit(brioche.id);
    check(results, "tips on a project are both tips to start with, and say so; a cable has no such choice", tip(five.id)?.value === "" && /Both tips/.test(tip(five.id)!.selectedOptions[0].textContent ?? "") && !tip(cable.id));
    tip(five.id)!.value = "right";
    tip(five.id)!.dispatchEvent(new Event("change", { bubbles: true }));
    tip(four.id)!.value = "left";
    tip(four.id)!.dispatchEvent(new Event("change", { bubbles: true }));
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !modal() && tipsOf(brioche.id) === JSON.stringify(Object.fromEntries([[five.id, "right"], [four.id, "left"]].sort())), "the tips kept");
    check(results, "a 5 mm right tip and a 4.5 mm left tip are kept on the project", true);

    document.querySelector<HTMLElement>(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: brioche.id }));
    await waitFor(() => !!page()?.querySelector(".tool-list"), "the project's page");
    const listed = page()!.querySelector(".tool-list")!.textContent ?? "";
    check(results, "its page says which tip is which", /5 mm interchangeable tips[^—]*— right tip/.test(listed) && /4\.5 mm interchangeable tips[^—]*— left tip/.test(listed), listed.replace(/\s+/g, " "));

    // The other 5 mm tip is free: another project is offered it, and takes the other side.
    const cowl = await project("Second cowl", []);
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects again");
    await edit(cowl.id);
    const option = modal()!.querySelector<HTMLOptionElement>(`[data-el="tool-add"] option[value="${five.id}"]`)!;
    check(results, "another project is offered the pair as free, one tip of it", option.closest("optgroup")?.label === "Free" && /one tip free, the other on Brioche cowl/.test(option.textContent ?? ""), option.textContent ?? "");
    const pick = modal()!.querySelector<HTMLSelectElement>('[data-el="tool-add"]')!;
    pick.value = five.id;
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    modal()!.querySelector<HTMLElement>('[data-act="tool-use"]')!.click();
    await waitFor(() => !!tip(five.id), "the 5 mm on the second project");
    check(results, "…and taken, it is the other tip: the left", tip(five.id)!.value === "left");
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !modal(), "saved");
    const shared = (await invoke<Tool[]>("list_tools")).find((t) => t.id === five.id)!;
    check(results, "the pair is on both projects now, a tip each", shared.uses.length === 2 && shared.uses.map((u) => `${u.projectId}:${u.tip}`).sort().join(" ") === [`${brioche.id}:right`, `${cowl.id}:left`].sort().join(" "), JSON.stringify(shared.uses));

    // Needles & hooks: where each tip is.
    tab("tools");
    await waitFor(() => !!document.querySelector(`.tool-card[data-open="${four.id}"]`), "the needles");
    const card = (id: string) => document.querySelector<HTMLElement>(`.tool-card[data-open="${id}"]`)!.textContent!.replace(/\s+/g, " ");
    check(results, "a pair with one tip on a project says which, and that one tip is free", /On Brioche cowl left tip/.test(card(four.id)) && /One tip free/.test(card(four.id)), card(four.id));
    check(results, "…a pair on two projects says both, and none free", /On Brioche cowl right tip/.test(card(five.id)) && /On Second cowl left tip/.test(card(five.id)) && !/One tip free/.test(card(five.id)), card(five.id));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>('.modal.project-form [data-act="cancel"]')?.click();
    for (const id of projects) await invoke("delete_project", { id }).catch(() => {});
    for (const id of made) await invoke("delete_tool", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__tipChecks = verifyTips;
