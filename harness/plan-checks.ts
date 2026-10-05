/**
 * Checks for plans: projects not started yet, in the Projects tab's Plans
 * list. Made from the tab, a pattern or a stash yarn; given a rough time or a
 * date; put in order by date or by dragging; kept out of the projects being
 * knitted; and started.
 *
 * Run with the harness open, after the other suites:
 *   window.__planChecks()
 */

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

type Proj = { id: string; name: string; status: string; patternId: string | null; planWhen?: string; planDate?: number | null; planOrder?: number };
type Store = {
  projects: Proj[];
  projectTools: { projectId: string; toolId: string }[];
  projectYarns: { projectId: string; yarnId: string; plannedGrams?: number | null }[];
  patterns: { id: string; title: string; status: string }[];
  yarns: { id: string; name: string; plans?: { patternId: string | null; title: string }[] }[];
};

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyPlans() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".projects");
  const form = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .project-form");
  const f = (name: string) => form()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${name}"]`) ?? null;
  const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const rows = () => [...document.querySelectorAll<HTMLElement>(".plan-row")];
  const made: string[] = [];

  try {
    tab("projects");
    await waitFor(() => !!view()?.querySelector('[data-act="mode"]'), "the projects");
    (view()!.querySelector('[data-mode="plans"]') as HTMLElement).click();
    check(results, "the Projects tab switches to Plans, with its own button", view()!.classList.contains("plans-mode") && view()!.querySelector('[data-act="add"]')!.textContent === "+ New plan");

    // ---------- a new plan ----------
    (view()!.querySelector('[data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!form()?.querySelector('[data-el="yarns"] .tool-add'), "the plan form");
    check(results, "the form plans a project: a time instead of Started, no needles yet", /Plan a project/.test(form()!.textContent ?? "") && !!f("plan-when") && !!f("plan-date") && !f("started") && !form()!.querySelector('[data-el="tools"]'));
    f("name")!.value = "Yoke for Mum";
    f("plan-when")!.value = "  before   winter ";
    f("plan-date")!.value = "2027-01-20";
    // Whichever yarn the stash offers: another suite may have used one up.
    const yarnSelect = form()!.querySelector<HTMLSelectElement>('[data-el="yarn-add"]')!;
    const yarnId = [...yarnSelect.options].map((o) => o.value).find((v) => v && (store.yarns.find((y) => y.id === v) as unknown as { lots: unknown[] })?.lots.length <= 1)!;
    const yarnName = store.yarns.find((y) => y.id === yarnId)!.name;
    set(yarnSelect, yarnId);
    (form()!.querySelector('[data-act="yarn-use"]') as HTMLElement).click();
    set(form()!.querySelector<HTMLInputElement>('[data-el="planned"][data-index="0"]')!, "80");
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !form() && rows().length > 0, "the plan in the list");
    const plan = store.projects.find((p) => p.name === "Yoke for Mum")!;
    made.push(plan.id);
    check(results, "saved as a plan, its time and date, its yarn and how much", plan.status === "planned" && plan.planWhen === "before winter" && new Date(plan.planDate!).getDate() === 20 && store.projectYarns.some((e) => e.projectId === plan.id && e.yarnId === yarnId && e.plannedGrams === 80), JSON.stringify(plan));
    const row = rows().find((r) => r.dataset.plan === plan.id)!;
    check(results, "…listed with when, and its yarn", /before winter · January 20, 2027/.test(row.textContent ?? "") && row.textContent!.includes(`${yarnName} (80 g)`), row.textContent ?? "");

    // ---------- the order ----------
    const sooner = await invoke<Proj>("add_project", { input: { name: "Spring hat", planned: true, planDate: new Date(2026, 11, 1).getTime(), yarns: [], toolIds: [] } });
    const someday = await invoke<Proj>("add_project", { input: { name: "Someday shawl", planned: true, planWhen: "one day", yarns: [], toolIds: [] } });
    made.push(sooner.id, someday.id);
    tab("patterns");
    await waitFor(() => !view(), "the library");
    tab("projects");
    await waitFor(() => rows().length === 3, "three plans");
    const order = () => rows().map((r) => r.dataset.plan).join();
    check(results, "the plans are in the order made, a Plans view kept while the app is open", order() === [plan.id, sooner.id, someday.id].join(), order());
    (view()!.querySelector('[data-act="sort-plans"]') as HTMLElement).click();
    await waitFor(() => order() === [sooner.id, plan.id, someday.id].join(), "the sort");
    check(results, "Sort by date: the soonest first, the undated after", (store.projects.find((p) => p.id === sooner.id)!.planOrder ?? 0) < (store.projects.find((p) => p.id === plan.id)!.planOrder ?? 0));
    // Dragged: the shawl to the top.
    const data = new DataTransfer();
    const shawl = rows().find((r) => r.dataset.plan === someday.id)!;
    shawl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    const first = rows()[0];
    const r = first.getBoundingClientRect();
    first.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientY: r.top + 2 }));
    shawl.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
    await waitFor(() => (store.projects.find((p) => p.id === someday.id)!.planOrder ?? 9) === 1, "the drag to be kept");
    check(results, "a plan dragged to the top stays there", order().startsWith(someday.id), order());

    // ---------- plans are not projects being knitted ----------
    (view()!.querySelector('[data-mode="projects"]') as HTMLElement).click();
    const cards = [...view()!.querySelectorAll<HTMLElement>(".project-card")].map((c) => c.dataset.open);
    check(results, "the projects being knitted leave the plans out, and the status filter has no Planned", !cards.some((id) => made.includes(id!)) && !view()!.querySelector('input[value="planned"]'));
    const handspun = await invoke<{ projects: string[]; plannedIn: string[] }>("get_yarn", { id: yarnId });
    check(results, "a plan's yarn is meant for it, not in use", !handspun.projects.includes("Yoke for Mum") && handspun.plannedIn.includes("Yoke for Mum"), JSON.stringify(handspun.plannedIn));

    // ---------- started ----------
    (view()!.querySelector('[data-mode="plans"]') as HTMLElement).click();
    (rows().find((x) => x.dataset.plan === plan.id)!.querySelector('[data-act="start-plan"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".project-page .board"), "its page");
    const started = store.projects.find((p) => p.id === plan.id)!;
    check(results, "Start knitting makes it a project, on its page", started.status === "active" && /Active/.test(document.querySelector(".project-side")!.textContent ?? ""));

    // ---------- from a pattern, and from a stash yarn ----------
    document.querySelector(".screen")!.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: { patternId: "p3", planned: true } }));
    await waitFor(() => !!form(), "the form from a pattern");
    check(results, "Plan it, from a pattern: a plan with the pattern chosen", /Plan a project/.test(form()!.textContent ?? "") && f("pattern")!.value === "p3");
    (form()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
    const yarn = store.yarns.find((y) => y.id === "y2")!;
    yarn.plans = [{ patternId: null, title: "Mystery cowl" }];
    tab("stash");
    await waitFor(() => !!document.querySelector('.stash [data-make-plan="y2"]'), "the yarn's Make a plan");
    (document.querySelector('.stash [data-make-plan="y2"]') as HTMLElement).click();
    await waitFor(() => !!form(), "the form from a yarn");
    check(results, "Make a plan, from a stash yarn planned for something: its name, and the yarn on it", f("name")!.value === "Mystery cowl" && /Merino DK/.test(form()!.querySelector('[data-el="yarns"] .tool-list')?.textContent ?? ""), f("name")!.value);
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !form(), "the plan");
    const cowl = store.projects.find((p) => p.name === "Mystery cowl");
    if (cowl) made.push(cowl.id);
    await waitFor(() => /Planned for: Mystery cowl/.test(document.querySelector('.stash .card[data-open="y2"]')?.textContent ?? "") && !document.querySelector('.stash [data-make-plan="y2"]'), "the card again");
    check(results, "…the card says what it is planned for, with no second Make a plan", cowl?.status === "planned");
    yarn.plans = [];
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) [data-act='cancel']")?.click();
    store.projects = store.projects.filter((p) => !made.includes(p.id));
    store.projectYarns = store.projectYarns.filter((e) => !made.includes(e.projectId));
    tab("patterns");
    await waitFor(() => !document.querySelector(".projects, .stash"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__planChecks = verifyPlans;
