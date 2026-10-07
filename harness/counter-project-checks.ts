/**
 * Checks for two projects from one pattern, clicked through: each counts its
 * own rows. The reader counts for the pattern's project, and with two on the
 * needles asks which, and remembers; a project's page counts for that project.
 *
 * Run with the harness open:
 *   window.__counterProjectChecks()
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

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

type Store = { progress: Map<string, { totalRows: number }> };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyCounterProjects() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const counter = () => document.querySelector<HTMLElement>(".reader .counter");
  const forSelect = () => counter()?.querySelector<HTMLSelectElement>('.counter-for select') ?? null;
  const total = (host: HTMLElement | null) => host?.querySelector('[data-el="total"]')?.textContent ?? "";
  const pattern = "p1";
  const made: string[] = [];
  let second = "";

  try {
    // The pattern's own count, from before projects counted their own.
    await invoke("set_total_rows", { patternId: pattern, projectId: null, total: 5 });
    const project = async (name: string, startedAt: number) => {
      const p = await invoke<{ id: string }>("add_project", { input: { name, patternId: pattern, notes: "", startedAt, toolIds: [], yarns: [] } });
      made.push(p.id);
      return p.id;
    };
    const first = await project("First sock", Date.now() - 86400000);
    second = await project("Second sock", Date.now());

    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!forSelect(), "the counter's choice of project");
    const options = [...forSelect()!.options].map((o) => o.textContent).join(", ");
    check(results, "with two projects on the needles, the reader's counter asks which it counts for", /Second sock/.test(options) && /First sock/.test(options), options);
    check(results, "…the one started last first", forSelect()!.value === second, forSelect()!.value);
    check(results, "…the first to count takes the pattern's count", total(counter()) === "5", total(counter()));

    for (let i = 0; i < 3; i++) (counter()!.querySelector('[data-act="total-inc"]') as HTMLElement).click();
    await waitFor(() => total(counter()) === "8", "three rows counted");
    check(results, "counting counts for that project", store.progress.get(`${second}|${pattern}`)?.totalRows === 8);

    forSelect()!.value = first;
    forSelect()!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.progress.has(`${first}|${pattern}`) && total(counter()) === "0", "the other project's count");
    check(results, "chosen, the other project counts its own, from nothing", store.progress.get(`${second}|${pattern}`)?.totalRows === 8 && store.progress.get(pattern)?.totalRows === 5);
    let remembered = "";
    try {
      remembered = localStorage.getItem(`counter-for:${pattern}`) ?? "";
    } catch {
      remembered = first;
    }
    check(results, "…and the choice is remembered for the pattern", remembered === first, remembered);

    // The project's own page counts for it.
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects [data-open="${second}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${second}"]`) as HTMLElement).click();
    const pageCounter = () => document.querySelector<HTMLElement>(".project-page .project-counter");
    await waitFor(() => total(pageCounter()) === "8", "the project page's counter");
    check(results, "a project's page counts its own rows", total(pageCounter()) === "8" && !pageCounter()!.querySelector(".counter-for select"));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (const id of made) await invoke("delete_project", { id }).catch(() => {});
    await invoke("set_total_rows", { patternId: pattern, projectId: null, total: 0 }).catch(() => {});
    try {
      localStorage.removeItem(`counter-for:${pattern}`);
    } catch {
      // Nothing kept.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__counterProjectChecks = verifyCounterProjects;
