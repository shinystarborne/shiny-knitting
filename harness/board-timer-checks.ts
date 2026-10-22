/**
 * Checks for the knitting timer on a project's board: the card, its big Start
 * and Stop, the side and the tab bar following it; a row counted starting
 * it, and five minutes without one stopping it as at the last row counted;
 * none of that with its box unticked; the tab bar's timer showing the card,
 * and its own Stop.
 *
 * Run with the harness open:
 *   window.__boardTimerChecks()
 */
import type { BoardItem, KnitSession, Pattern, Project } from "../src/api";
import { IDLE_MS, idleEnd } from "../src/auto-timer";
import { sessionMs } from "../src/views/knit-time";

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
  const t0 = 1_000_000_000;
  const min = 60_000;
  check(results, "a timer is left thirty minutes after the last row counted, ending at that row", idleEnd(t0, t0 + 10 * min, t0 + 39 * min) === null && idleEnd(t0, t0 + 10 * min, t0 + 40 * min) === t0 + 10 * min && IDLE_MS === 30 * min);
  check(results, "…with no row counted since it started, thirty minutes after its start", idleEnd(t0, null, t0 + 29 * min) === null && idleEnd(t0, null, t0 + 31 * min) === t0 + 30 * min && idleEnd(t0, t0 - 60 * min, t0 + 31 * min) === t0 + 30 * min);
  const paused = { id: "k", projectId: "p", startedAt: t0, endedAt: null, pausedMs: 10 * min, pausedAt: t0 + 50 * min };
  check(results, "a paused sitting's time stops at its pause, its earlier breaks left out", sessionMs(paused, t0 + 90 * min) === 40 * min && sessionMs({ ...paused, pausedAt: null }, t0 + 90 * min) === 80 * min && sessionMs({ ...paused, pausedAt: null, endedAt: t0 + 60 * min }) === 50 * min);
}

export async function verifyBoardTimer() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { boardItems: BoardItem[]; knitSessions?: KnitSession[]; patterns: Pattern[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const card = () => page()?.querySelector<HTMLElement>(".board-item.kind-timer") ?? null;
  const go = () => card()!.querySelector<HTMLElement>('[data-act="timer-go"]')!;
  const pill = () => document.querySelector<HTMLElement>('.tab-bar [data-act="timer"]')!;
  const pillStop = () => document.querySelector<HTMLElement>('.tab-bar [data-act="timer-stop"]')!;
  let projectId = "";
  const running = () => (store.knitSessions ?? []).find((s) => s.projectId === projectId && s.endedAt === null);
  const lastKey = () => `auto-timer:last-count:${projectId}`;
  try {
    pure(results);
    const pattern = store.patterns.find((p) => p.format === "pdf")!;
    const project = await invoke<Project>("add_project", { input: { name: "Timed by rows", patternId: pattern.id, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!page()?.querySelector('.board-tools [data-add="timer"]'), "the project's board");

    (page()!.querySelector('.board-tools [data-add="timer"]') as HTMLElement).click();
    await waitFor(() => !!card(), "the timer card");
    const auto = card()!.querySelector<HTMLInputElement>('[data-f="timer-auto"]')!;
    check(results, "a timer card on the board: a big clock, Start, and counting rows keeping it, ticked", /0:00:00/.test(card()!.textContent ?? "") && /Start/.test(go().textContent ?? "") && auto.checked && store.boardItems.some((i) => i.boardId === projectId && i.kind === "timer" && i.data.auto === true));
    (page()!.querySelector('.board-tools [data-add="timer"]') as HTMLElement).click();
    await wait(200);
    check(results, "…one on a board: Timer again picks it", page()!.querySelectorAll(".board-item.kind-timer").length === 1);
    // Sized: its clock and button with it.
    const fit = () => card()!.querySelector<HTMLElement>(".board-fit")!;
    card()!.style.width = "140px";
    card()!.style.height = "130px";
    await wait(300);
    const small = Number(fit().style.zoom || 1);
    const fits = fit().getBoundingClientRect().height <= card()!.getBoundingClientRect().height + 1;
    card()!.style.width = "600px";
    card()!.style.height = "560px";
    await wait(300);
    check(results, "a small timer card is all there, smaller; a big one bigger", small < 0.6 && fits && Number(fit().style.zoom) > 1.5, `${small} ${fits} ${fit().style.zoom}`);
    card()!.style.width = "300px";
    card()!.style.height = "280px";
    await wait(200);

    // Its big Start and Stop; the side and the tab bar follow.
    go().click();
    await waitFor(() => !!running() && /Stop/.test(go()?.textContent ?? ""), "started from the card");
    await waitFor(() => !!page()!.querySelector('[data-act="knit-stop"]') && !pill().hidden, "the side and tab bar");
    check(results, "Start on the card times the project: the side and the tab bar say so, with a Stop of its own", !!page()!.querySelector('[data-act="knit-stop"]') && !pill().hidden && !pillStop().hidden);
    await wait(2300);
    check(results, "…its clock running", /^0:00:0[1-9]$/.test(card()!.querySelector('[data-el="timer-clock"]')!.textContent ?? ""), card()!.querySelector('[data-el="timer-clock"]')!.textContent ?? "");
    go().click();
    await waitFor(() => !running() && /Start/.test(go()?.textContent ?? ""), "stopped from the card");
    await waitFor(() => !!page()!.querySelector('[data-act="knit-start"]') && pill().hidden, "the side and tab bar stopped");
    check(results, "Stop on the card stops it, everywhere", !!page()!.querySelector('[data-act="knit-start"]') && pill().hidden && pillStop().hidden);

    // A row counted starts it.
    await waitFor(() => !!page()!.querySelector('[data-act="total-inc"]'), "the counter");
    (page()!.querySelector('[data-act="total-inc"]') as HTMLElement).click();
    await waitFor(() => !!running(), "started by a row", 5000).catch(() => {});
    check(results, "a row counted starts the timer", !!running());
    await waitFor(() => /Stop/.test(go()?.textContent ?? ""), "the card following", 5000).catch(() => {});
    check(results, "…the card showing it", /Stop/.test(go()?.textContent ?? ""));

    // A pause, and on: one sitting, the break left out.
    const sitting = running()!.id;
    go().closest(".board-timer")!.querySelector<HTMLElement>('[data-act="timer-pause"]')!.click();
    await waitFor(() => running()?.pausedAt != null && /Resume/.test(card()?.textContent ?? ""), "paused", 5000).catch(() => {});
    const frozen = card()!.querySelector('[data-el="timer-clock"]')!.textContent;
    await wait(1300);
    check(results, "Pause pauses it: the clock still, said Paused, the side and the tab bar too", running()?.pausedAt != null && card()!.querySelector('[data-el="timer-clock"]')!.textContent === frozen && /Paused/.test(card()!.textContent ?? "") && /Resume/.test(page()!.querySelector('[data-act="knit-pause"]')?.textContent ?? "") && pill().classList.contains("paused") && /^⏸/.test(pill().textContent ?? ""), `${frozen} ${pill().textContent}`);
    // Left paused long: a break, not stopped.
    localStorage.setItem(lastKey(), String(Date.now() - 60 * 60_000));
    running()!.startedAt = Date.now() - 90 * 60_000;
    document.dispatchEvent(new CustomEvent("knit-timer"));
    await wait(500);
    check(results, "…paused, it is not stopped as left", !!running());
    // A row counted goes on with it.
    (page()!.querySelector('[data-act="total-inc"]') as HTMLElement).click();
    await waitFor(() => running()?.pausedAt == null, "going on", 5000).catch(() => {});
    check(results, "a row counted goes on with a paused timer: the same sitting", running()?.id === sitting && running()?.pausedAt == null && (running()?.pausedMs ?? 0) > 0);
    (document.querySelector('.tab-bar [data-act="timer-pause"]') as HTMLElement).click();
    await waitFor(() => running()?.pausedAt != null, "paused from the tab bar", 5000).catch(() => {});
    check(results, "the tab bar pauses it too", running()?.pausedAt != null);
    (document.querySelector('.tab-bar [data-act="timer-pause"]') as HTMLElement).click();
    await waitFor(() => running()?.pausedAt == null, "on from the tab bar", 5000).catch(() => {});
    check(results, "…and goes on with it", !!running() && running()!.pausedAt == null && running()!.id === sitting);

    // Thirty minutes without one: stopped, as at the last row.
    const s = running()!;
    const last = Date.now() - 31 * 60_000;
    s.startedAt = Date.now() - 50 * 60_000;
    s.pausedMs = 0;
    localStorage.setItem(lastKey(), String(last));
    document.dispatchEvent(new CustomEvent("knit-timer"));
    await waitFor(() => !running(), "stopped as left", 5000).catch(() => {});
    const stopped = (store.knitSessions ?? []).find((x) => x.id === s.id);
    check(results, "thirty minutes without a row counted stops it, as at the last row", !running() && stopped?.endedAt === last, JSON.stringify(stopped));
    await waitFor(() => /Start/.test(go()?.textContent ?? "") && pill().hidden, "everywhere stopped", 5000).catch(() => {});
    check(results, "…the card and the tab bar following", /Start/.test(go()?.textContent ?? "") && pill().hidden);

    // Unticked: counting leaves the timer alone.
    card()!.querySelector<HTMLInputElement>('[data-f="timer-auto"]')!.click();
    await waitFor(() => store.boardItems.some((i) => i.boardId === projectId && i.kind === "timer" && i.data.auto === false), "unticked");
    const freshAuto = card()!.querySelector<HTMLInputElement>('[data-f="timer-auto"]')!;
    (page()!.querySelector('[data-act="total-inc"]') as HTMLElement).click();
    await wait(600);
    check(results, "unticked, a row counted does not start it", !running() && !freshAuto.checked);
    go().click();
    await waitFor(() => !!running(), "started by hand");
    const manual = running()!;
    manual.startedAt = Date.now() - 60 * 60_000;
    document.dispatchEvent(new CustomEvent("knit-timer"));
    await wait(600);
    check(results, "…nor stops it, left", !!running());

    // The tab bar's timer: shows the card; its Stop stops it.
    pill().click();
    await waitFor(() => !!card()?.classList.contains("timer-shown"), "the card shown", 3000).catch(() => {});
    check(results, "the tab bar's timer, on its project, shows the timer card", !!card()?.classList.contains("timer-shown") && card()!.classList.contains("selected"));
    pillStop().click();
    await waitFor(() => !running() && pill().hidden, "stopped from the tab bar", 5000).catch(() => {});
    check(results, "…and its ■ stops it", !running() && pill().hidden && /Start/.test(go()?.textContent ?? ""));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    await invoke("stop_knitting").catch(() => {});
    if (projectId) {
      localStorage.removeItem(lastKey());
      await invoke("delete_project", { id: projectId }).catch(() => {});
    }
    document.dispatchEvent(new CustomEvent("knit-timer"));
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardTimerChecks = verifyBoardTimer;
