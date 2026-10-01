/**
 * Long grids, painted a page at a time as they are scrolled, with each card's
 * picture read only once the card comes near the screen.
 *
 * A library of a few thousand patterns painted in one go is thousands of
 * cards in the page and a cover read per card before the last one shows; most
 * of them are never scrolled to. Here only the first page is drawn, more
 * follow as the end of the grid comes into view, and a picture is asked for
 * when its card is about to be seen.
 *
 * Driven by scrolling and resizing as well as by an IntersectionObserver, as
 * the PDF pages are: Chromium throttles the observer while the window is
 * covered, and a scroll handler alone misses a grid that grew by a resize.
 */

/** How many cards are drawn at a time. */
export const PAGE_SIZE = 60;

/** How far past the edge of the pane cards and pictures are got ready, in pixels. */
const AHEAD = 900;

export interface LazyOptions {
  /** The elements in a card that hold a picture to read. */
  pictures?: string;
  /** Reads and paints one picture element. */
  paint?: (el: HTMLElement) => void | Promise<void>;
  pageSize?: number;
}

/** The grids being painted, so painting one again first stops the last. */
const running = new WeakMap<HTMLElement, () => void>();

/**
 * Fills `host` with a card per item, a page at a time. Returns a function that
 * stops it; painting the same host again also stops the one before.
 */
export function paintLazily<T>(host: HTMLElement, items: T[], html: (item: T) => string, options: LazyOptions = {}): () => void {
  running.get(host)?.();
  const size = options.pageSize ?? PAGE_SIZE;
  const scroller = scrollParent(host);
  let shown = 0;
  let pending: HTMLElement[] = [];
  let stopped = false;

  host.innerHTML = "";
  const sentinel = document.createElement("div");
  sentinel.className = "lazy-more";
  sentinel.setAttribute("aria-hidden", "true");

  const frame = (): { top: number; bottom: number } => {
    if (!scroller) return { top: 0, bottom: window.innerHeight };
    const r = scroller.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  };

  const more = (): void => {
    const next = items.slice(shown, shown + size);
    if (!next.length) return;
    const from = host.children.length - (sentinel.isConnected ? 1 : 0);
    sentinel.remove();
    host.insertAdjacentHTML("beforeend", next.map(html).join(""));
    shown += next.length;
    if (shown < items.length) host.appendChild(sentinel);
    if (options.pictures) {
      const cards = [...host.children].slice(from) as HTMLElement[];
      for (const card of cards) {
        if (card.matches(options.pictures)) pending.push(card);
        pending.push(...card.querySelectorAll<HTMLElement>(options.pictures));
      }
    }
  };

  const check = (): void => {
    if (stopped) return;
    const view = frame();
    // A tall window, or a short page, may need several pages at once.
    for (let guard = 0; sentinel.isConnected && guard < 50; guard++) {
      if (sentinel.getBoundingClientRect().top > view.bottom + AHEAD) break;
      more();
    }
    if (!options.paint || !pending.length) return;
    const keep: HTMLElement[] = [];
    for (const el of pending) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      const near = r.bottom > view.top - AHEAD && r.top < view.bottom + AHEAD;
      // An element not laid out (a hidden tab) has no box yet; wait for it.
      if (near && (r.width || r.height)) void options.paint(el);
      else keep.push(el);
    }
    pending = keep;
  };

  let timer: number | null = null;
  const soon = (): void => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      check();
    }, 60);
  };

  more();
  const target: HTMLElement | Window = scroller ?? window;
  target.addEventListener("scroll", soon, { passive: true });
  window.addEventListener("resize", soon);
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(() => soon(), { root: scroller, rootMargin: `${AHEAD}px 0px` })
      : null;
  observer?.observe(sentinel);
  // Once laid out: the first page's pictures, and more pages if it fell short.
  requestAnimationFrame(() => check());

  const stop = (): void => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    target.removeEventListener("scroll", soon);
    window.removeEventListener("resize", soon);
    observer?.disconnect();
    if (running.get(host) === stop) running.delete(host);
  };
  running.set(host, stop);
  return stop;
}

/** The nearest ancestor that scrolls, or null for the window. */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return at;
  }
  return null;
}
