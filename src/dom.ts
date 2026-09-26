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
