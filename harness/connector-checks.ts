/**
 * Checks for needles and cables that fit each other: a tip's and a cable's
 * system (ChiaoGoo / Lotus Yarns, KnitPro…) as said or as the brand says,
 * what fits what, a project offered only the cables its tips take, the form
 * choosing the system from the brand, and the tab's System filter.
 *
 * Run with the harness open:
 *   window.__connectorChecks()
 */
import type { Tool } from "../src/api";
import { connectorFit, connectorOfBrand, fitsOnProject, measurements } from "../src/views/tool-filter";

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

const t = (kind: string, connector: string, cableSize: string): Tool => ({ id: kind + connector + cableSize, kind, connector, cableSize } as Tool);

function pure(results: CheckResult[]): void {
  check(results, "a brand says its system: Lotus Yarns is ChiaoGoo's, Knitter's Pride is KnitPro", connectorOfBrand("Lotus Yarns") === "chiaogoo" && connectorOfBrand("ChiaoGoo") === "chiaogoo" && connectorOfBrand("Knitter's Pride") === "knitpro" && connectorOfBrand("addi") === "addi" && connectorOfBrand("Clover") === "");
  check(results, "tips and a cable of one system and size fit", connectorFit(t("tips", "chiaogoo", "small"), t("cable", "chiaogoo", "small")) === "yes");
  check(results, "…of another system do not", connectorFit(t("tips", "chiaogoo", "small"), t("cable", "knitpro", "")) === "no");
  check(results, "…nor of another size", connectorFit(t("tips", "chiaogoo", "small"), t("cable", "chiaogoo", "large")) === "no");
  check(results, "…and one whose system is not said may", connectorFit(t("tips", "chiaogoo", "small"), t("cable", "", "")) === "unknown" && connectorFit(t("tips", "knitpro", ""), t("cable", "knitpro", "")) === "yes");
  const onIt = [t("tips", "chiaogoo", "small"), t("tips", "chiaogoo", "large"), t("circular", "", "")];
  check(results, "a project with tips is offered a cable that fits one of them", fitsOnProject(t("cable", "chiaogoo", "large"), onIt) && !fitsOnProject(t("cable", "knitpro", ""), onIt));
  check(results, "…and anything else, and anything while nothing to fit is on it", fitsOnProject(t("hook", "", ""), onIt) && fitsOnProject(t("cable", "knitpro", ""), [t("circular", "", "")]));
  const said = measurements({ ...t("cable", "chiaogoo", "small"), cableCm: 0, lengthCm: 0 });
  check(results, "a card says the connector: its system and size", said === "ChiaoGoo / Lotus Yarns small connector", said);
  check(results, "…or only its size, the system not said", measurements({ ...t("tips", "", "large"), cableCm: 0, lengthCm: 0 }) === "Large connector");
}

export async function verifyConnectors() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
  const made: string[] = [];
  let projectId = "";

  try {
    pure(results);

    const add = async (input: Partial<Tool>) => {
      const tool = await invoke<Tool>("add_tool", { input: { sizeMm: input.kind === "cable" ? 0 : 4, lengthCm: 0, cableCm: input.kind === "cable" ? 60 : 0, cableSize: "", material: "", notes: "", projectId: null, ...input } });
      made.push(tool.id);
      return tool;
    };
    const tips = await add({ kind: "tips", brand: "ChiaoGoo", cableSize: "small" });
    check(results, "added with a brand that says it, tips take its system", tips.connector === "chiaogoo");
    const lotus = await add({ kind: "cable", brand: "Lotus Yarns", cableSize: "small", cableCm: 61 });
    const knitpro = await add({ kind: "cable", brand: "KnitPro", cableCm: 81 });
    const large = await add({ kind: "cable", brand: "ChiaoGoo", cableSize: "large", cableCm: 101 });
    const unsure = await add({ kind: "cable", brand: "From a swap", cableCm: 41 });
    check(results, "…and cables theirs: Lotus Yarns ChiaoGoo's, KnitPro its own, an unknown brand none", lotus.connector === "chiaogoo" && knitpro.connector === "knitpro" && unsure.connector === "");

    // A project with the tips on it: what it is offered.
    projectId = (await invoke<{ id: string }>("add_project", { input: { name: "Connector cowl", patternId: null, notes: "", startedAt: null, toolIds: [tips.id], yarns: [] } })).id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, detail: projectId }));
    await waitFor(() => !!modal()?.querySelector('[data-el="tool-add"]'), "the project's needles");
    const offered = [...modal()!.querySelectorAll<HTMLOptionElement>('[data-el="tool-add"] option')].map((o) => o.value);
    check(results, "a project with ChiaoGoo small tips is offered the Lotus Yarns small cable, and one not said", offered.includes(lotus.id) && offered.includes(unsure.id), offered.join());
    check(results, "…not the KnitPro cable, nor a large one", !offered.includes(knitpro.id) && !offered.includes(large.id));
    const hint = modal()!.querySelector('[data-el="tool-unfit"]')?.textContent ?? "";
    check(results, "…and says what it leaves out, and why", /^2 that do not fit what is on it are not offered: /.test(hint) && /KnitPro/.test(hint), hint);
    // The tips taken off: every cable is offered again.
    modal()!.querySelector<HTMLElement>(`[data-act="tool-free"][data-id="${tips.id}"]`)!.click();
    await waitFor(() => !modal()!.querySelector('[data-el="tool-unfit"]'), "everything offered");
    const all = [...modal()!.querySelectorAll<HTMLOptionElement>('[data-el="tool-add"] option')].map((o) => o.value);
    check(results, "without the tips on it, every cable is offered", [lotus.id, knitpro.id, large.id, unsure.id].every((id) => all.includes(id)));
    // A KnitPro cable on it: the ChiaoGoo tips are not offered.
    const select = modal()!.querySelector<HTMLSelectElement>('[data-el="tool-add"]')!;
    select.value = knitpro.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    modal()!.querySelector<HTMLElement>('[data-act="tool-use"]')!.click();
    await waitFor(() => !!modal()!.querySelector('[data-el="tool-unfit"]'), "the tips left out");
    const now = [...modal()!.querySelectorAll<HTMLOptionElement>('[data-el="tool-add"] option')].map((o) => o.value);
    check(results, "…and the other way round: a KnitPro cable on it, the ChiaoGoo tips are not offered", !now.includes(tips.id) && now.includes(lotus.id) && now.includes(unsure.id), now.join());
    modal()!.querySelector<HTMLElement>('[data-act="cancel"]')?.click();
    await waitFor(() => !modal(), "the form closed");

    // The form: the system from the brand, until one is chosen.
    tab("tools");
    await waitFor(() => !!document.querySelector('input[data-filter="connector"]'), "the needles");
    document.querySelector<HTMLElement>('[data-act="add"]')!.click();
    await waitFor(() => !!modal()?.querySelector('[data-f="connector"]'), "the tool form");
    const field = (f: string) => modal()!.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`)!;
    field("kind").value = "tips";
    field("kind").dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "the form asks tips their system, beside the cable size", !field("connector").closest<HTMLElement>("[data-show]")!.hidden);
    field("sizeMm").value = "5";
    field("brand").value = "Knitter's Pride";
    field("brand").dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "…and a brand that says it chooses it", field("connector").value === "knitpro", field("connector").value);
    field("brand").value = "ChiaoGoo";
    field("brand").dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "…but not over one already chosen", field("connector").value === "knitpro");
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !modal(), "saved");
    const tools = await invoke<Tool[]>("list_tools");
    const saved = tools.find((x) => x.kind === "tips" && x.sizeMm === 5 && x.brand === "ChiaoGoo" && x.connector === "knitpro");
    if (saved) made.push(saved.id);
    check(results, "…and the system chosen is kept", !!saved);

    // The tab's System filter.
    tab("projects");
    tab("tools");
    await waitFor(() => !!document.querySelector('input[data-filter="connector"]'), "the System filter");
    const box = document.querySelector<HTMLInputElement>('input[data-filter="connector"][value="knitpro"]')!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(200);
    const shown = [...document.querySelectorAll<HTMLElement>("[data-open]")].map((c) => c.dataset.open);
    check(results, "the Needles & hooks tab filters by system", shown.includes(knitpro.id) && !shown.includes(lotus.id) && !shown.includes(tips.id), shown.join());
    const card = document.querySelector<HTMLElement>(`[data-open="${knitpro.id}"]`)!.textContent ?? "";
    check(results, "…a card saying its system", /KnitPro \/ Knitter's Pride connector/.test(card), card.replace(/\s+/g, " "));
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    modal()?.querySelector<HTMLElement>('[data-act="cancel"]')?.click();
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    for (const id of made) await invoke("delete_tool", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__connectorChecks = verifyConnectors;
