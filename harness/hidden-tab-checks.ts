/**
 * Checks for hiding tabs in Settings: a box for every tab and none for
 * Settings, a tab unticked gone from the tab bar, the board's buttons that
 * bring something from it greyed out and saying why, shown again as they
 * were, the tab on screen giving way when it is hidden, and every tab
 * unticked refused.
 *
 * Run with the harness open:
 *   window.__hiddenTabChecks()
 */
import type { Project } from "../src/api";

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

const settings = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
const boxes = () => [...(settings()?.querySelectorAll<HTMLInputElement>('[data-el="tabs"] input[data-tab]') ?? [])];
const tabButton = (name: string) => document.querySelector<HTMLElement>(`.tab-bar [data-tab="${name}"]`)!;
const shown = (name: string) => !tabButton(name).hidden && tabButton(name).offsetParent !== null;

async function openSettings(): Promise<void> {
  (document.querySelector('.tab-bar [data-act="settings"]') as HTMLElement).click();
  await waitFor(() => boxes().length > 0, "Settings");
  await wait(150); // the boxes as kept
}

/** Settings opened, these tabs unticked and every other ticked, and saved. */
async function hide(tabs: string[]): Promise<void> {
  await openSettings();
  for (const box of boxes()) box.checked = !tabs.includes(box.dataset.tab!);
  (settings()!.querySelector('[data-act="save"]') as HTMLElement).click();
  await waitFor(() => !settings(), "Settings to close");
  await wait(300);
}

export async function verifyHiddenTabs() {
  const results: CheckResult[] = [];
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const tool = (sel: string) => page()?.querySelector<HTMLElement>(`.board-tools ${sel}`) ?? null;
  let projectId = "";
  try {
    await openSettings();
    const names = boxes().map((b) => b.dataset.tab);
    check(results, "Settings has a box for every tab, all ticked, and none for Settings", names.length === 13 && boxes().every((b) => b.checked) && !names.includes("settings"), names.join(","));
    (settings()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !settings(), "Settings to close");

    await hide(["stash", "masterclasses"]);
    check(results, "unticked, Stash and Masterclasses leave the tab bar; the rest stay", !shown("stash") && !shown("masterclasses") && shown("tools") && shown("patterns"));
    check(results, "…and are kept", JSON.stringify(await invoke<string[]>("get_hidden_tabs")) === JSON.stringify(["masterclasses", "stash"]));
    await openSettings();
    check(results, "Settings opened again shows them unticked", boxes().filter((b) => !b.checked).map((b) => b.dataset.tab).join(",") === "masterclasses,stash");
    (settings()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !settings(), "Settings to close");

    const project = await invoke<Project>("add_project", { input: { name: "Hidden tabs", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    tabButton("projects").click();
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!tool('[data-add="yarn"]')?.dataset.title, "the project's board");
    const yarn = tool('[data-add="yarn"]')!;
    check(results, "on a board, Yarn (from the hidden Stash) and Video (Masterclasses) are greyed out", yarn.classList.contains("tab-hidden") && tool('[data-add="video"]')!.classList.contains("tab-hidden") && yarn.getAttribute("aria-disabled") === "true");
    check(results, "…saying why on the button", /Stash is hidden in Settings/.test(yarn.title), yarn.title);
    check(results, "…the others are not: Pattern, Needle, Chart, Cheatsheet, Constructors, Note", ['[data-add="pattern"]', '[data-add="tool"]', '[data-add="chart"]', '[data-add="sheet"]', '[data-act="calculator"]', '[data-add="note"]'].every((s) => !tool(s)!.classList.contains("tab-hidden")));
    yarn.click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "what is said");
    const said = document.querySelector(".dialog-card")!.textContent ?? "";
    check(results, "clicked, it says the tab is hidden and where to show it, and offers no yarn", /hidden/.test(said) && /Settings/.test(said) && !/Choose|choose a yarn/i.test(said), said);
    (document.querySelector(".dialog-card button") as HTMLElement).click();
    await waitFor(() => !document.querySelector(".dialog-card"), "it to close");

    // Shown again with the board open: its toolbar follows.
    await hide(["masterclasses"]);
    check(results, "Stash shown again, the board's Yarn is as it was, its own title back", page() !== null && !tool('[data-add="yarn"]')!.classList.contains("tab-hidden") && tool('[data-add="yarn"]')!.title === "A yarn from the stash", tool('[data-add="yarn"]')?.title);
    check(results, "…and Stash is back in the tab bar", shown("stash"));

    // The tab on screen hidden: the first one shown takes its place.
    tabButton("shops").click();
    await waitFor(() => tabButton("shops").classList.contains("active"), "Shops");
    await hide(["shops", "patterns"]);
    check(results, "the tab on screen hidden, the first tab shown opens: Projects, Patterns being hidden too", tabButton("projects").classList.contains("active") && !!document.querySelector(".projects"));

    await openSettings();
    for (const box of boxes()) box.checked = false;
    (settings()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !(settings()?.querySelector<HTMLElement>('[data-el="error"]')?.hidden ?? true), "the refusal");
    check(results, "every tab unticked is refused, and nothing changes", /at least one tab/.test(settings()!.querySelector('[data-el="error"]')!.textContent ?? "") && JSON.stringify(await invoke<string[]>("get_hidden_tabs")) === JSON.stringify(["patterns", "shops"]));
    (settings()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !settings(), "Settings to close");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (document.querySelector(".dialog-card")) (document.querySelector(".dialog-card button") as HTMLElement)?.click();
    if (settings()) (settings()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await hide([]).catch(() => {});
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tabButton("patterns").click();
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__hiddenTabChecks = verifyHiddenTabs;
