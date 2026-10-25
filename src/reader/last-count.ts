/**
 * When the counter last counted, for the line under the total that answers
 * "did that press count?" -- "Last counted 30 seconds ago", going up from the
 * press. Kept per pattern and project, so it is still right after the app is
 * closed and opened again.
 */

function key(patternId: string, projectId: string | null): string {
  return `counter:last-count:${patternId}:${projectId ?? ""}`;
}

/** When a count last landed on this counter; null when never, or not known. */
export function lastCounted(patternId: string, projectId: string | null): number | null {
  try {
    const v = Number(localStorage.getItem(key(patternId, projectId)));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function noteCounted(patternId: string, projectId: string | null, at = Date.now()): void {
  try {
    localStorage.setItem(key(patternId, projectId), String(at));
  } catch {
    // Not kept: the line still shows it until the page is left.
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** How long ago, in words: "just now", "30 seconds ago", "2 minutes ago", "3 hours ago", "yesterday", "4 days ago". */
export function sinceLabel(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 1) return "just now";
  if (s < 60) return `${plural(s, "second")} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${plural(m, "minute")} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${plural(h, "hour")} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${plural(d, "day")} ago`;
}
