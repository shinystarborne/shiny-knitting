import { api, type KnitSession } from "./api";

/**
 * The knitting timer kept by the row counter, for a project whose board has a
 * timer card with it ticked: a row counted starts the timer (or goes on with
 * it, paused), and thirty minutes without one stops it, as at the last row
 * counted -- long rows are long. Paused, it is left alone: a break is not
 * leaving. Wherever the app is -- the timer runs with the app closed too, so a
 * timer left is stopped when the app opens again.
 */

/** How long without a row counted before the timer is taken as left. */
export const IDLE_MS = 30 * 60 * 1000;

/** Says a row was counted on a project, for the timer to hear. */
export function rowsCounted(projectId: string, delta: number): void {
  document.dispatchEvent(new CustomEvent("rows-counted", { detail: { projectId, delta } }));
}

function key(projectId: string): string {
  return `auto-timer:last-count:${projectId}`;
}

/** When a row was last counted on a project, here; null when not known. */
export function lastCount(projectId: string): number | null {
  try {
    const v = Number(localStorage.getItem(key(projectId)));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Knitting going on, as a row counted is: going on after a pause starts the wait again. */
export function noteActivity(projectId: string, at = Date.now()): void {
  noteCount(projectId, at);
}

function noteCount(projectId: string, at: number): void {
  try {
    localStorage.setItem(key(projectId), String(at));
  } catch {
    // Known for this run only: the timer then stops as at its start.
  }
}

/**
 * When a sitting left is to end: at the last row counted in it, or, with none
 * counted, thirty minutes after it was started -- null while it is not left.
 */
export function idleEnd(startedAt: number, last: number | null, now = Date.now()): number | null {
  const counted = last !== null && last >= startedAt;
  const since = counted ? last : startedAt;
  if (now - since < IDLE_MS) return null;
  return counted ? last : startedAt + IDLE_MS;
}

/** Whether a project's board has a timer card that keeps the timer by the counter. */
async function keptByCounter(projectId: string): Promise<boolean> {
  const items = await api.listBoardItems(projectId).catch(() => []);
  return items.some((i) => i.kind === "timer" && i.data.auto !== false);
}

function changed(): void {
  document.dispatchEvent(new CustomEvent("knit-timer"));
}

/** A row counted: noted, and the timer started on that project when its card says so. */
async function onCount(projectId: string, delta: number): Promise<void> {
  noteCount(projectId, Date.now());
  if (delta <= 0 || !(await keptByCounter(projectId))) return;
  const running = await api.runningKnitSession().catch(() => null);
  if (running?.projectId === projectId) {
    // Paused: a row counted is knitting again.
    if (running.pausedAt != null) {
      await api.resumeKnitting().catch(() => null);
      changed();
    }
    return;
  }
  // Counting here is knitting here: another project's timer stops.
  await api.startKnitting(projectId).catch(() => null);
  changed();
}

/** The running timer stopped when it has been left, its project's card saying so. */
export async function stopIfLeft(running: KnitSession | null, now = Date.now()): Promise<boolean> {
  // Paused is a break, not leaving it.
  if (!running || running.pausedAt != null) return false;
  const end = idleEnd(running.startedAt, lastCount(running.projectId), now);
  if (end === null || !(await keptByCounter(running.projectId))) return false;
  await api.stopKnittingAt(end).catch(() => null);
  changed();
  return true;
}

/** Listens for rows counted, from the start. */
export function installAutoTimer(): void {
  document.addEventListener("rows-counted", (e) => {
    const { projectId, delta } = (e as CustomEvent<{ projectId: string; delta: number }>).detail;
    void onCount(projectId, delta);
  });
}
