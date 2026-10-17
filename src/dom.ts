/** Small DOM helpers shared by the views. */

/**
 * `Element.closest` is typed as returning `Element`, but everything we look up
 * in this app is an HTMLElement. This narrows it once instead of casting at
 * every call site.
 */
export function closestEl<T extends HTMLElement = HTMLElement>(
  target: EventTarget | null,
  selector: string,
): T | null {
  if (!(target instanceof Element)) return null;
  return target.closest<T>(selector);
}

/**
 * Builds an element with attributes and children in one call.
 *
 * `class` and `type` are passed through as attributes rather than as properties
 * because that is what reads clearly at the call site, and the alternative —
 * casting every one of them — is how a typo in a property name turns into a
 * silently missing style rather than an error.
 */
export function dom<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/**
 * Where the last press began. A click's target is the nearest element both
 * the press and the release were in, so a press inside a dialog let go on
 * its backdrop -- a list that closed under the pointer as it was picked
 * from, text selected out past the edge -- "clicks" the backdrop, and would
 * close the dialog with what was being done in it.
 */
let pressedAt: EventTarget | null = null;
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => (pressedAt = e.target), true);

/** Whether a click on a backdrop was one: pressed and let go there, not dragged out to it. */
export function clickedOn(e: MouseEvent, backdrop: HTMLElement): boolean {
  return e.target === backdrop && (pressedAt === null || pressedAt === backdrop);
}
