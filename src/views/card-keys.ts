/**
 * Cards that open on a click open from the keyboard too: each is a tab stop
 * (tabindex="0" in its markup), and Enter or Space on it is the click. Only
 * on the card itself -- a button inside it keeps its own keys.
 */
export const OPENING_CARD = "[data-open], [data-open-chart]";

/** Whether a key on this element opens it as a click would. */
export function opensFromKey(e: Pick<KeyboardEvent, "key" | "target" | "altKey" | "ctrlKey" | "metaKey" | "repeat">): boolean {
  if ((e.key !== "Enter" && e.key !== " ") || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return false;
  const el = e.target;
  return el instanceof HTMLElement && el.matches(OPENING_CARD) && el.tabIndex >= 0;
}

/** Listens once, for the whole app. */
export function installCardKeys(): void {
  document.addEventListener("keydown", (e) => {
    if (!opensFromKey(e)) return;
    e.preventDefault();
    (e.target as HTMLElement).click();
  });
}
