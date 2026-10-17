import type { KnitSession } from "../api";

/**
 * Knitting time: how long a spell of knitting was, a project's total, and
 * the time said as a clock or in hours and minutes. Pure, so the harness
 * checks it directly.
 */

/** A spell's length in ms: to now while its timer runs. */
export function sessionMs(s: KnitSession, now = Date.now()): number {
  return Math.max(0, (s.endedAt ?? now) - s.startedAt);
}

/** All the spells' time, in ms. */
export function totalMs(sessions: KnitSession[], now = Date.now()): number {
  return sessions.reduce((n, s) => n + sessionMs(s, now), 0);
}

/** The time knitted from a moment on: spells started since then. */
export function knittedSince(sessions: KnitSession[], from: number, now = Date.now()): number {
  return totalMs(
    sessions.filter((s) => s.startedAt >= from),
    now,
  );
}

/** A running timer's clock: 0:23:05, 12:00:41. */
export function clock(ms: number): string {
  const all = Math.floor(ms / 1000);
  const h = Math.floor(all / 3600);
  const m = Math.floor((all % 3600) / 60);
  const s = all % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Time knitted, to the minute: 12 h 35 min, 3 h, 40 min. */
export function hoursText(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** What a project came to an hour of knitting; null with no time or no cost. */
export function perHour(cost: number, ms: number): number | null {
  if (!(cost > 0) || ms < 60000) return null;
  return Math.round((cost / (ms / 3600000)) * 100) / 100;
}

/** What a project really costs: what it cost, and its knitting time at what an hour is worth. */
export function trueCost(cost: number, ms: number, hourRate: number): number {
  return Math.round((cost + (ms / 3600000) * hourRate) * 100) / 100;
}

/**
 * When a spell typed in started: noon on the day given, or, for today, as
 * long before now as it lasted -- a spell is never in the future.
 */
export function typedStart(day: string, seconds: number, now = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const noon = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  return Math.min(noon, now - seconds * 1000);
}
