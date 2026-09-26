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
