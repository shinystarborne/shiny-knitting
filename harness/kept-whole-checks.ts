/**
 * Checks that what is typed, scrolled or added is kept whole: a project's
 * notes saved with its name cleared, a pattern's place kept when it is left
 * at once, a picture that cannot be stored taken off the board again, and
 * numbers the app would refuse refused by the stub as well.
 *
 * Run with the harness open:
 *   window.__keptWholeChecks()
 */
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

type Internals = { invoke(c: string, a: unknown, o?: unknown): Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) => internals().invoke(cmd, args) as Promise<T>;

type Store = {
  projects: { id: string; name: string; notes: string }[];
  projectYarns: { projectId: string; plannedGrams: number | null }[];
  yarns: { id: string }[];
  patterns: { id: string; lastScroll: number }[];
  boardItems: { boardId: string; kind: string }[];
};

async function png(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 60;
  canvas.height = 40;
  canvas.getContext("2d")!.fillRect(0, 0, 60, 40);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "swatch.png", { type: "image/png" });
}

export async function verifyKeptWhole() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const restore = keep(["projects", "projectYarns", "boardItems", "patterns", "progress", "projectLog"]);
  const realInvoke = internals().invoke;

  try {
    // ---- the stub refuses what the app's whole numbers would ----
    const p = await invoke<{ id: string; name: string }>("add_project", { input: { name: "Kept cowl", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    const refused = await invoke("set_total_rows", { patternId: "p1", projectId: p.id, total: Number.NaN }).then(() => "", (e) => String(e));
    check(results, "a row total that is no number is refused, as the app refuses it", /whole number/.test(refused), refused || "accepted");
    const details = (grams: number) => ({ name: "Kept cowl", patternId: null, notes: "", startedAt: null, finishedAt: null, toolIds: [], yarns: [{ yarnId: store.yarns[0].id, lotId: null, plannedGrams: grams }] });
    await invoke("update_project", { id: p.id, input: details(Number.NaN) });
    const planned = store.projectYarns.find((e) => e.projectId === p.id)?.plannedGrams;
    check(results, "grams planned that are no number are kept as none, not as NaN", planned === null, String(planned));
    const fraction = await invoke("update_project", { id: p.id, input: details(12.5) }).then(() => "", (e) => String(e));
    check(results, "…and a fraction of a gram is refused", /number of grams/.test(fraction), fraction || "accepted");

    // ---- a project's notes saved with its name cleared ----
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${p.id}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${p.id}"]`) as HTMLElement).click();
    await waitFor(() => !!page()?.querySelector('.project-side [data-f="notes"]'), "the project's page");
    const field = (f: string) => page()!.querySelector<HTMLInputElement | HTMLTextAreaElement>(`.project-side [data-f="${f}"]`)!;
    field("name").value = "";
    field("name").dispatchEvent(new Event("input", { bubbles: true }));
    field("notes").value = "Cast on 120";
    field("notes").dispatchEvent(new Event("input", { bubbles: true }));
    const saved = () => store.projects.find((x) => x.id === p.id)!;
    await waitFor(() => saved().notes === "Cast on 120", "the notes to be saved", 3000).catch(() => {});
    check(results, "notes typed with the name cleared are saved", saved().notes === "Cast on 120", JSON.stringify(saved().notes));
    check(results, "…keeping the name it had", saved().name === "Kept cowl", saved().name);
    field("name").dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => field("name").value === "Kept cowl", "the name back in its field", 3000).catch(() => {});
    check(results, "…which is back in its field once it is left", field("name").value === "Kept cowl", field("name").value);

    // ---- a picture that cannot be stored taken off the board again ----
    const board = () => page()?.querySelector<HTMLElement>(".board");
    await waitFor(() => !!board(), "the board");
    const images = () => store.boardItems.filter((i) => i.boardId === p.id && i.kind === "image").length;
    internals().invoke = (cmd, args, o) => (cmd === "set_board_image" ? Promise.reject(new Error("The disk is full.")) : realInvoke.call(internals(), cmd, args, o));
    const dt = new DataTransfer();
    dt.items.add(await png());
    const box = board()!.getBoundingClientRect();
    board()!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 60, clientY: box.top + 60 }));
    await waitFor(() => /disk is full/.test(document.querySelector(".dialog-card")?.textContent ?? ""), "the error", 5000).catch(() => {});
    internals().invoke = realInvoke;
    check(results, "a dropped picture that cannot be stored says why", /disk is full/.test(document.querySelector(".dialog-card")?.textContent ?? ""));
    check(results, "…and leaves no empty frame on the board", images() === 0 && !board()!.querySelector('.board-item[data-kind="image"]'), `${images()} kept`);
    document.querySelector<HTMLElement>(".dialog-card button")?.click();
    await wait(100);

    // ---- a pattern's place kept when it is left at once ----
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-open="p1"]'), "the library");
    (document.querySelector('.library [data-open="p1"]') as HTMLElement).click();
    const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller");
    await waitFor(() => !!scroller() && scroller()!.scrollHeight > scroller()!.clientHeight + 300, "the pattern's pages");
    await wait(500);
    const before = store.patterns.find((x) => x.id === "p1")!.lastScroll;
    scroller()!.scrollTop = before + 240;
    scroller()!.dispatchEvent(new Event("scroll"));
    tab("projects");
    const after = store.patterns.find((x) => x.id === "p1")!.lastScroll;
    check(results, "a pattern left straight after scrolling keeps the place scrolled to", after !== before, `${before} → ${after}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    internals().invoke = realInvoke;
    document.querySelector<HTMLElement>(".dialog-card button")?.click();
    restore();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__keptWholeChecks = verifyKeptWhole;
