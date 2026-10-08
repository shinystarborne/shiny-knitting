/**
 * Checks for counting, clicked through: a pattern read from the library has
 * no counter and no line -- it is for reading and marking -- and a project's
 * page counts its own rows, two projects from one pattern each their own, with
 * the pattern shown beside the board by default.
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
  const total = (host: Element | null) => host?.querySelector('[data-el="total"]')?.textContent ?? "";
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const pageCounter = () => document.querySelector<HTMLElement>(".project-page .project-counter");
  const pattern = "p1";
  const made: string[] = [];
  let pinId = "";

  const openPage = async (id: string) => {
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${id}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${id}"]`) as HTMLElement).click();
    await waitFor(() => !!page() && !!pageCounter()?.querySelector('[data-el="total"]'), "the project's page");
  };

  try {
    // The pattern's own count, from before projects counted their own.
    await invoke("set_total_rows", { patternId: pattern, projectId: null, total: 5 });
    const project = async (name: string, startedAt: number) => {
      const p = await invoke<{ id: string }>("add_project", { input: { name, patternId: pattern, notes: "", startedAt, toolIds: [], yarns: [] } });
      made.push(p.id);
      try {
        localStorage.removeItem(`project-pattern:${p.id}`);
      } catch {
        // A fresh project has nothing kept.
      }
      return p.id;
    };
    const first = await project("First sock", Date.now() - 86400000);
    const second = await project("Second sock", Date.now());

    // Read from the library: marks, but no counter and no line.
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.reader [data-mark="highlight"]') && !!document.querySelector(".reader [data-project-panel] h3"), "the pattern");
    await wait(300);
    check(results, "a pattern read from the library has no row counter", !document.querySelector(".reader .counter") && !document.querySelector(".reader .counter-fab"));
    check(results, "…and no highlight line, nor its settings", !document.querySelector(".reader .highlight-line") && !document.querySelector('.reader [data-act="highlight-cfg"]') && !document.querySelector(".reader [data-row-readout]"));
    check(results, "…but its highlighter, pen and the rest stay", !!document.querySelector('.reader [data-mark="highlight"]') && !!document.querySelector('.reader [data-mark="pin"]'));

    // A pin of the pattern, to put on the board from the pattern beside it.
    const pin = await invoke<{ id: string }>("add_pin", {
      patternId: pattern,
      input: { page: 1, geometry: JSON.stringify([{ x: 0.1, y: 0.1, w: 0.6, h: 0.25 }]), quote: "", title: "Gauge", imageBytes: [1, 2, 3], imageMime: "image/jpeg" },
    });
    pinId = pin.id;
    // A pin put on its board from the pattern says where it is from.
    await invoke("add_board_item", { boardId: second, input: { kind: "pin", x: 40, y: 40, w: 420, h: 200, data: { patternId: pattern, page: 3, title: "Lace chart" } } });

    // A project's page counts for it, the pattern beside the board by default.
    await openPage(second);
    await waitFor(() => !!page()!.querySelector(".board-pin-caption"), "the pin on the board");
    const caption = page()!.querySelector(".board-pin-caption")!.textContent ?? "";
    check(results, "a pin on a project's board says which page of which pattern it is from", /📌 p\.3 · Featherweight Lace Sock/.test(caption), caption);
    const toBoard = () => page()!.querySelector<HTMLElement>(`.pin-card[data-id="${pinId}"] button[title="Put it on the project's board"]`);
    await waitFor(() => !!toBoard(), "the pin's ⤴ in the pattern beside the board");
    toBoard()!.click();
    await waitFor(() => page()!.querySelectorAll(".board-pin-caption").length === 2, "the pin on the board", 20000);
    const captions = [...page()!.querySelectorAll(".board-pin-caption")].map((c) => c.textContent).join(" | ");
    check(results, "⤴ on a pin in the pattern beside the board puts it on that board at once", /📌 p\.1 · Featherweight Lace Sock/.test(captions), captions);
    await waitFor(() => !!page()!.querySelector(".project-pattern:not([hidden]) .highlight-line"), "the pattern beside the board, with its line");
    check(results, "a project's page shows its pattern beside the board by default, with the line", true);
    check(results, "the first project on the needles to count takes the pattern's count", total(pageCounter()) === "5", total(pageCounter()));
    for (let i = 0; i < 3; i++) (pageCounter()!.querySelector('[data-act="total-inc"]') as HTMLElement).click();
    await waitFor(() => total(pageCounter()) === "8", "three rows counted");
    check(results, "counting on its page counts for that project", store.progress.get(`${second}|${pattern}`)?.totalRows === 8);

    await openPage(first);
    await waitFor(() => store.progress.has(`${first}|${pattern}`), "the other project's counter");
    check(results, "another project from the pattern counts its own, from nothing", total(pageCounter()) === "0" && store.progress.get(`${second}|${pattern}`)?.totalRows === 8 && store.progress.get(pattern)?.totalRows === 5, total(pageCounter()));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (const id of made) {
      await invoke("delete_project", { id }).catch(() => {});
      try {
        localStorage.removeItem(`project-pattern:${id}`);
      } catch {
        // Nothing kept.
      }
    }
    await invoke("set_total_rows", { patternId: pattern, projectId: null, total: 0 }).catch(() => {});
    if (pinId) await invoke("delete_pin", { id: pinId }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__counterProjectChecks = verifyCounterProjects;
