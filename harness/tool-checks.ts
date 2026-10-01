/**
 * Checks for the needles and hooks tab.
 *
 * Two halves: the filter and naming functions, checked directly against the
 * seed, and the wiring -- the tab, the cards, the form that shows only the
 * measurements a kind has, Free it, Remove, and the reader's side pane --
 * clicked through on the live, stubbed app.
 *
 * Run with the harness open:
 *   window.__toolChecks()
 */
import type { Tool } from "../src/api";
import { canonical, describe, filterTools, headline, isFree, knownBrands, knownMaterials, materialValue, measurements, parseSizes, toolFacets, connectorFor, connectorSummary } from "../src/views/tool-filter";

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

type Store = {
  tools: Tool[];
  patterns: { id: string; title: string }[];
  projects: { id: string; name: string; status: string }[];
  projectTools: { projectId: string; toolId: string }[];
};

/** The active project a stored tool is on, as the backend works it out. */
function projectOf(store: Store, toolId: string): string | null {
  const link = store.projectTools.find((l) => l.toolId === toolId && store.projects.find((p) => p.id === l.projectId)?.status === "active");
  return link ? link.projectId : null;
}

function pure(results: CheckResult[], tools: Tool[]): void {
  const ids = (list: Tool[]) => list.map((t) => t.id).sort().join(",");
  check(results, "a tool on a project from a pattern is in use", !isFree(tools.find((t) => t.id === "t1")!));
  check(results, "a tool on a project without one is in use", !isFree(tools.find((t) => t.id === "t2")!));
  check(results, "Free shows only the free ones", ids(filterTools(tools, { use: ["free"] })) === "t3,t4,t5,t6", ids(filterTools(tools, { use: ["free"] })));
  check(results, "Free and In use together show everything", filterTools(tools, { use: ["free", "in-use"] }).length === tools.length);
  check(results, "groups combine: free circulars", ids(filterTools(tools, { use: ["free"], kind: ["circular"] })) === "t3");
  check(results, "a size box is the size in mm", ids(filterTools(tools, { size: ["4"] })) === "t2,t3");
  check(results, "a search for 4mm finds the 4 mm needles", ids(filterTools(tools, { search: "4mm" })) === "t2,t3", ids(filterTools(tools, { search: "4mm" })));
  check(results, "a search finds a project by its name", ids(filterTools(tools, { search: "gift" })) === "t2");
  check(results, "a search finds the project a tool is on", ids(filterTools(tools, { search: "featherweight" })) === "t1");
  const facets = toolFacets(tools);
  check(results, "counts: 4 free, 2 in use", facets.use[0].count === 4 && facets.use[1].count === 2, JSON.stringify(facets.use));
  check(results, "sizes are listed smallest first, cables left out", facets.size.map((f) => f.label).join("|") === "2.5 mm|3.5 mm|4 mm|5 mm", facets.size.map((f) => f.label).join("|"));
  check(results, "a brand typed two ways is suggested once, as most often written", knownBrands(tools).join("|") === "Addi|ChiaoGoo|Clover|HiyaHiya", knownBrands(tools).join("|"));
  check(results, "typing a known brand in another case files it under that one", canonical(" chiaogoo ", knownBrands(tools)) === "ChiaoGoo");
  check(results, "a known material is stored by its key, in any case", materialValue("Carbon") === "carbon" && materialValue("BAMBOO") === "bamboo");
  check(results, "any other material is kept as typed", materialValue(" Casein ") === "Casein");
  const typedTools = [...tools, { ...tools[0], id: "x", material: "Casein" }, { ...tools[0], id: "y", material: "casein" }];
  check(results, "a typed material becomes a suggestion, once", knownMaterials(typedTools).filter((m) => m.toLowerCase() === "casein").length === 1 && knownMaterials(tools).includes("Carbon"));
  const casein = toolFacets(typedTools).material.find((f) => f.key === "casein");
  check(results, "…and a filter box of its own, counting both spellings", casein?.count === 2, JSON.stringify(casein));
  check(results, "Other is not offered unless something uses it", !toolFacets(tools).material.some((f) => f.key === "other"));
  const ps = (t: string) => JSON.stringify(parseSizes(t));
  check(results, "one size is one size", ps("4") === '{"sizes":[4],"bad":[]}', ps("4"));
  check(results, "a set can be typed with commas and spaces", ps("2.5, 3, 3.5,4") === '{"sizes":[2.5,3,3.5,4],"bad":[]}', ps("2.5, 3, 3.5,4"));
  check(results, "3,5 is a decimal comma", ps("3,5") === '{"sizes":[3.5],"bad":[]}', ps("3,5"));
  check(results, "3,5 among others is still 3.5", ps("3 3,5 4") === '{"sizes":[3,3.5,4],"bad":[]}', ps("3 3,5 4"));
  check(results, "3,4,5 is three sizes", ps("3,4,5") === '{"sizes":[3,4,5],"bad":[]}', ps("3,4,5"));
  check(results, "a set is sorted, without repeats", ps("5; 4; 4; 3.75") === '{"sizes":[3.75,4,5],"bad":[]}', ps("5; 4; 4; 3.75"));
  check(results, "something that is not a size is named", ps("4, 4mm, x").includes('"bad":["4mm","x"]'), ps("4, 4mm, x"));
  const chiaoSet = [{ from: 2.75, size: "small" }, { from: 5.5, size: "large" }];
  check(results, "up to 5 mm takes the small connector", connectorFor(2.75, chiaoSet) === "small" && connectorFor(5, chiaoSet) === "small");
  check(results, "from 5.5 mm the large", connectorFor(5.5, chiaoSet) === "large" && connectorFor(10, chiaoSet) === "large");
  const sum = connectorSummary([2.75, 3, 3.5, 4, 5, 5.5, 6, 8, 10], chiaoSet);
  check(results, "a set's connectors read as ranges", sum === "2.75–5 mm small, 5.5–10 mm large", sum);
  const three = connectorSummary([2, 2.5, 2.75, 5, 5.5], [{ from: 2, size: "mini" }, { from: 2.75, size: "small" }, { from: 5.5, size: "large" }]);
  check(results, "three connectors in one set", three === "2–2.5 mm mini, 2.75–5 mm small, 5.5 mm large", three);
  const chiao = facets.brand.find((f) => f.key === "chiaogoo");
  check(results, "a brand typed two ways is one box", facets.brand.length === 4 && chiao?.count === 3, JSON.stringify(facets.brand));
  check(results, "cable sizes count tips and cables", facets.cableSize.find((f) => f.key === "small")?.count === 2);
  const cable = tools.find((t) => t.id === "t6")!;
  check(results, "a cable is headed by its length", headline(cable) === "60 cm", headline(cable));
  check(results, "a cable says its connector", measurements(cable) === "Small connector", measurements(cable));
  const circ = tools.find((t) => t.id === "t2")!;
  check(results, "a circular says its cable length", measurements(circ) === "80 cm cable", measurements(circ));
  check(results, "a tool has a one-line name", describe(circ) === "4 mm circular needle, 80 cm (ChiaoGoo)", describe(circ));
}

export async function verifyTools() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const cards = () => [...document.querySelectorAll<HTMLElement>(".tools .tool-card")];
  const card = (id: string) => document.querySelector<HTMLElement>(`.tools .tool-card[data-open="${id}"]`);
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .tool-form");
  const field = (f: string) => modal()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`) ?? null;
  const shown = (f: string) => {
    const el = field(f)?.closest<HTMLElement>(".field");
    return !!el && !el.hidden;
  };
  const set = (f: string, v: string) => {
    const el = field(f)!;
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const act = (name: string) => (modal()?.querySelector(`[data-act="${name}"]`) as HTMLElement).click();
  const tick = (group: string, value: string, on = true) => {
    const box = document.querySelector<HTMLInputElement>(`.tools input[data-filter="${group}"][value="${value}"]`)!;
    box.checked = on;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };

  try {
    pure(results, (await (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<Tool[]> } }).__TAURI_INTERNALS__.invoke("list_tools")));

    tab("tools");
    await waitFor(() => cards().length === store.tools.length, "the tool cards");
    check(results, "the Needles & hooks tab lists every tool", cards().length === 6, `${cards().length}`);
    check(results, "cards run smallest first", cards()[0]?.dataset.open === "t6" && cards()[1]?.dataset.open === "t1", cards().map((c) => c.dataset.open).join(","));
    const t1 = card("t1")!;
    check(results, "a card shows the size, kind and length", t1.querySelector(".tool-size")?.textContent === "2.5 mm" && /Double-pointed/.test(t1.textContent ?? "") && /20 cm long/.test(t1.textContent ?? ""));
    check(results, "…the brand and material", t1.querySelector(".tool-make")?.textContent === "HiyaHiya · Metal");
    check(results, "…and the project it is on, as a link", t1.querySelector("button.tool-project")?.textContent === "Featherweight Lace Sock");
    check(results, "a project without a pattern shows by name", card("t2")?.querySelector(".tool-project")?.textContent === "Gift hat");
    check(results, "a free tool says Free", !!card("t3")?.querySelector(".tool-free") && card("t3")!.classList.contains("free"));
    const sizes = cards().map((c) => c.getBoundingClientRect()).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`);
    check(results, "every card is the same size", new Set(sizes).size === 1, sizes.join(" "));

    tick("use", "free");
    check(results, "ticking Free shows only free tools", cards().map((c) => c.dataset.open).join(",") === "t6,t5,t3,t4", cards().map((c) => c.dataset.open).join(","));
    tick("kind", "circular");
    check(results, "with Circular as well, only the free circular", cards().map((c) => c.dataset.open).join(",") === "t3");
    (document.querySelector('.tools [data-act="clear"]') as HTMLElement).click();
    check(results, "Clear filters shows everything again", cards().length === 6);

    // Add a hook, onto a pattern.
    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the form");
    check(results, "a new tool starts as a circular, with a cable length", field("kind")?.value === "circular" && shown("cableCm") && !shown("lengthCm") && !shown("cableSize"));
    set("kind", "cable");
    check(results, "a cable has no size, but a length and a connector", !shown("sizeMm") && shown("cableCm") && shown("cableSize"));
    set("kind", "hook");
    check(results, "a hook has a size and a length, no cable", shown("sizeMm") && shown("lengthCm") && !shown("cableCm") && !shown("cableSize"));
    act("save");
    await waitFor(() => !modal()?.querySelector<HTMLElement>('[data-el="error"]')?.hidden, "the size error");
    check(results, "saving without a size says what is missing", /size in millimetres/.test(modal()?.querySelector('[data-el="error"]')?.textContent ?? ""));
    set("sizeMm", "6");
    set("lengthCm", "14");
    field("brand")!.value = "Tulip";
    // Brand: open the list with ▾ and pick from it.
    const brandToggle = field("brand")!.parentElement!.querySelector<HTMLButtonElement>(".combo-toggle")!;
    brandToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const brandList = () => [...(field("brand")!.parentElement!.querySelectorAll<HTMLElement>(".combo-list:not([hidden]) li") ?? [])];
    check(results, "▾ lists the brands already in the box", brandList().map((li) => li.textContent).join("|") === "Addi|ChiaoGoo|Clover|HiyaHiya", brandList().map((li) => li.textContent).join("|"));
    brandList().find((li) => li.textContent === "Clover")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    check(results, "picking one fills the field", field("brand")!.value === "Clover");
    field("brand")!.value = "tul";
    field("brand")!.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "typing narrows the list, and a new brand is fine", !brandList().some((li) => li.textContent === "Clover"));
    field("brand")!.value = "chi";
    field("brand")!.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…to the brands containing what is typed", brandList().map((li) => li.textContent).join("|") === "ChiaoGoo", brandList().map((li) => li.textContent).join("|"));
    set("material", "wood");
    const projectOptions = [...field("project")!.options].map((o) => o.textContent);
    check(results, "In use for offers the active projects", projectOptions.includes("Featherweight Lace Sock") && projectOptions.includes("Gift hat"), projectOptions.join("|"));
    set("project", "pr2");
    const before = store.tools.length;
    act("save");
    await waitFor(() => !modal() && store.tools.length === before + 1, "the save");
    const added = store.tools[store.tools.length - 1];
    check(results, "the hook is stored, on its project", added.kind === "hook" && added.sizeMm === 6 && added.lengthCm === 14 && added.cableCm === 0 && projectOf(store, added.id) === "pr2" && added.material === "wood", JSON.stringify(added));
    await waitFor(() => !!card(added.id), "its card");
    check(results, "its card shows the project", card(added.id)?.querySelector(".tool-project")?.textContent === "Gift hat");

    // Save and add another keeps the form open and filled in.
    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the form again");
    set("kind", "straight");
    set("sizeMm", "3");
    set("lengthCm", "35");
    act("save-another");
    const ready = () => !modal()?.querySelector<HTMLElement>('[data-el="saved"]')?.hidden && !modal()?.querySelector<HTMLButtonElement>('[data-act="save-another"]')?.disabled;
    await waitFor(() => store.tools.length === before + 2 && ready(), "the first of a run");
    check(results, "Save and add another keeps the form open", !!modal() && field("lengthCm")?.value === "35");
    set("sizeMm", "3.5");
    act("save-another");
    await waitFor(() => store.tools.length === before + 3 && ready(), "the second of a run");
    check(results, "…and adds the next with what changed", store.tools[store.tools.length - 1].sizeMm === 3.5 && store.tools[store.tools.length - 1].lengthCm === 35);
    act("cancel");
    await waitFor(() => !modal(), "the form to close");

    // A set: several sizes at once, sharing everything but a project.
    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the form for a set");
    set("project", "pr1");
    set("kind", "tips");
    field("sizeMm")!.value = "3, 3.5, 4, 4.5";
    field("sizeMm")!.dispatchEvent(new Event("input", { bubbles: true }));
    set("lengthCm", "13");
    set("cableSize", "small");
    field("brand")!.value = "ChiaoGoo";
    field("material")!.value = "Metal";
    const preview = modal()!.querySelector<HTMLElement>('[data-el="set-preview"]')!;
    check(results, "several sizes say they make a set, added free", !preview.hidden && /4 entries, 3, 3\.5, 4, 4\.5 mm/.test(preview.textContent ?? "") && /added free/.test(preview.textContent ?? ""), preview.textContent ?? "");
    check(results, "…and the button says how many", modal()!.querySelector('[data-act="save"]')?.textContent === "Add 4");
    const projectRow = modal()!.querySelector<HTMLElement>('[data-el="project-row"]')!;
    check(results, "a set hides In use for: its sizes do not share a project", projectRow.hidden && getComputedStyle(projectRow).display === "none");
    const beforeSet = store.tools.length;
    act("save");
    await waitFor(() => !modal() && store.tools.length === beforeSet + 4, "the set to be added");
    const setTools = store.tools.slice(-4);
    check(results, "a set adds one entry per size", setTools.map((t) => t.sizeMm).join(",") === "3,3.5,4,4.5", setTools.map((t) => t.sizeMm).join(","));
    check(results, "…all with the same details", setTools.every((t) => t.kind === "tips" && t.lengthCm === 13 && t.cableSize === "small" && t.brand === "ChiaoGoo" && t.material === "metal"), JSON.stringify(setTools[0]));
    check(results, "…and all free, though a project had been chosen first", setTools.every((t) => !projectOf(store, t.id)), JSON.stringify(setTools.map((t) => projectOf(store, t.id))));
    // A set whose connector changes partway: small up to 5 mm, large from 5.5.
    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the form for a split set");
    set("kind", "tips");
    const splitOption = () => modal()!.querySelector<HTMLOptionElement>('[data-el="split-option"]')!;
    field("sizeMm")!.value = "4";
    field("sizeMm")!.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "one size is not offered a change of connector", splitOption().hidden);
    field("sizeMm")!.value = "2.75, 3, 4, 5, 5.5, 6, 8";
    field("sizeMm")!.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "a set is offered Changes with size", !splitOption().hidden);
    set("cableSize", "__split__");
    const stepsBox = () => modal()!.querySelector<HTMLElement>('[data-el="connector-steps"]')!;
    check(results, "choosing it shows a row per connector", !stepsBox().hidden && stepsBox().querySelectorAll(".connector-step").length === 2);
    const fromSel = stepsBox().querySelector<HTMLSelectElement>('select[data-step="1"][data-part="from"]')!;
    fromSel.value = "5.5";
    fromSel.dispatchEvent(new Event("change", { bubbles: true }));
    const previewText = modal()!.querySelector('[data-el="set-preview"]')?.textContent ?? "";
    check(results, "the preview says which sizes get which", /Cable size: 2\.75–5 mm small, 5\.5–8 mm large/.test(previewText), previewText);
    const n1 = store.tools.length;
    act("save");
    await waitFor(() => !modal() && store.tools.length === n1 + 7, "the split set to be added");
    const split = store.tools.slice(-7).map((t) => `${t.sizeMm}:${t.cableSize}`).join(" ");
    check(results, "each size is stored with its own connector", split === "2.75:small 3:small 4:small 5:small 5.5:large 6:large 8:large", split);

    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the form again");
    field("sizeMm")!.value = "4, four";
    field("sizeMm")!.dispatchEvent(new Event("input", { bubbles: true }));
    const n0 = store.tools.length;
    act("save");
    await waitFor(() => !modal()?.querySelector<HTMLElement>('[data-el="error"]')?.hidden, "the bad size error");
    check(results, "a size that is not a number is refused, by name, adding nothing", /“four” is not a size/.test(modal()?.querySelector('[data-el="error"]')?.textContent ?? "") && store.tools.length === n0);
    act("cancel");
    await waitFor(() => !modal(), "the form to close");
    (card(setTools[0].id) as HTMLElement).click();
    await waitFor(() => !!modal(), "editing one of the set");
    field("sizeMm")!.value = "3, 3.25";
    act("save");
    await waitFor(() => !modal()?.querySelector<HTMLElement>('[data-el="error"]')?.hidden, "the one-size error");
    check(results, "editing takes one size", /give it one size/.test(modal()?.querySelector('[data-el="error"]')?.textContent ?? ""));
    act("cancel");
    await waitFor(() => !modal(), "the edit form to close");

    // Editing puts a tool on a project.
    (card("t3") as HTMLElement).click();
    await waitFor(() => !!modal(), "the edit form");
    check(results, "editing keeps the measurements", field("sizeMm")?.value === "4" && field("cableCm")?.value === "40");
    set("project", "pr2");
    act("save");
    await waitFor(() => !modal(), "the edit save");
    await waitFor(() => card("t3")?.querySelector(".tool-project")?.textContent === "Gift hat", "the card to update");
    check(results, "the card shows the project it was put on", projectOf(store, "t3") === "pr2");

    // Free it from the card.
    (card("t3")!.querySelector('[data-act="free"]') as HTMLElement).click();
    await waitFor(() => !!card("t3")?.querySelector(".tool-free"), "the tool to be freed");
    check(results, "Free it frees the tool", !projectOf(store, "t3"));

    // Remove, after asking.
    (card("t4")!.querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm");
    check(results, "removing asks first, naming the tool", /5 mm crochet hook/.test(document.querySelector(".dialog-card .dialog-message")?.textContent ?? ""));
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => !card("t4"), "the removal");
    check(results, "the tool is gone", !store.tools.some((t) => t.id === "t4"));

    // The project link on a card opens that project's page.
    (card("t1")!.querySelector('[data-act="open-project"]') as HTMLElement).click();
    const side = () => document.querySelector<HTMLElement>(".project-page .project-side");
    await waitFor(() => !!side()?.querySelector(".tool-list"), "the project page");
    check(results, "the card's project link opens the project's page", side()!.querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Featherweight Lace Sock");
    check(results, "…listing the needle on it", /2\.5 mm double-pointed needles, 20 cm \(HiyaHiya\)/.test(side()!.textContent ?? ""));

    // Forms opened after others leave nothing listening for the next one.
    tab("tools");
    await waitFor(() => cards().length > 0, "the tools again");
    (document.querySelector('.tools [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal(), "the needle form");
    set("sizeMm", "7");
    const n = store.tools.length;
    act("save");
    await waitFor(() => store.tools.length === n + 1 && !modal(), "the needle to save");
    check(results, "an earlier form's Save does not also run", !document.querySelector(".form-error:not([hidden])") && store.projects.length === 2);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) [data-act=\"cancel\"]")?.click();
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.tools):not(.projects)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__toolChecks = verifyTools;
