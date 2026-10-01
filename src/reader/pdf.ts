import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { findTextMatches, pageSearchText, rectsForRanges } from "../annotations";
import { boxToView, normalRotation, type Rotation } from "./rotation";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many screens away from the view a page's bitmap is kept before it is freed. */
const RELEASE_SCREENS = 4;

/**
 * The widest a page renders at fit-width (zoom 1), so a page does not stretch
 * uncomfortably wide on a large monitor. Zooming in is still free to go
 * past it -- this bounds the default, not the maximum.
 */
const FIT_WIDTH_CAP = 1100;

export interface RenderedDoc {
  pageCount: number;
  /** Parses the bytes and prepares content for display. */
  load(bytes: Uint8Array): Promise<void>;
  /** Scroll offset of the reading viewport, for saving position. */
  scrollTop: number;
  /** Jump to a page + offset. */
  goToPage(page: number, offset?: number): void;
  /** Current topmost visible page, for saving position. */
  currentPage(): number;
  /** Renders every page at a width matching the container. */
  render(): Promise<void>;
  /**
   * The element holding a page's real text, for measuring a selection.
   *
   * Null until the page has rendered, and null for a page with no text layer
   * at all, which is an image-only scan.
   */
  textLayerFor(page: number): HTMLElement | null;
  /** The element a page is painted into, for placing a mark. */
  pageElement(page: number): HTMLElement | null;
  /**
   * Called when the document's own layout shifts under the reader: an EPUB
   * chapter growing and pushing everything below it down, or a PDF page
   * being repainted at a different pixel size (a zoom, or the window being
   * resized). Whatever positioned itself against the old geometry -- marks,
   * chiefly -- has to be told to measure again, or it is left sitting where
   * the page used to be rather than where it now is.
   */
  onReflow: (() => void) | null;
  destroy(): void;
  /**
   * The document's own table of contents: a PDF's embedded outline, or an
   * EPUB's chapters. Empty when the document has none.
   */
  outline(): Promise<OutlineItem[]>;

  /**
   * Zoom past (or below) the width the document was opened at.
   *
   * Optional: a PDF page is a fixed image that can be scaled arbitrarily, but
   * an EPUB chapter is reflowing text that already fits the pane by wrapping,
   * so there is nothing here for it to do. Left undefined rather than a no-op
   * method, so the reader can tell whether to show zoom controls at all.
   */
  zoomIn?(): void;
  zoomOut?(): void;
  zoomToFit?(): void;
  /** The current zoom as a percentage of fit-width, for the readout. */
  zoomPercent?(): number;
  /**
   * Paints one region of a page into a canvas at a given on-screen width.
   *
   * PDF only: a pin is drawn live from the document this way rather than from
   * a stored picture, so it is as sharp as the page itself at any size.
   */
  renderRegion?(page: number, rect: RegionRect, cssWidth: number, canvas: HTMLCanvasElement): Promise<void>;
  /** PDF only: every page's text as search counts it (see pageSearchText). */
  searchTexts?(): Promise<string[]>;
  /** PDF only: shows a query's matches, marking one as current; null clears. */
  setSearch?(query: string | null, current?: SearchHit | null): void;
  /**
   * PDF only: how far the reader has turned a page, clockwise. Marks and pins
   * are stored upright and turned by this on the way to the screen.
   */
  rotationOf?(page: number): Rotation;
}

/** One search match: its page, and which match it is on that page (0-based). */
export interface SearchHit {
  page: number;
  occurrence: number;
}

/** One entry of a table of contents. `page` is null when it cannot be resolved. */
export interface OutlineItem {
  title: string;
  page: number | null;
  items: OutlineItem[];
}

/** A region of a page, in 0..1 fractions of the page. */
export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far zoomIn/zoomOut and the fit-width baseline may move, either way. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/**
 * Renders a PDF into a continuous vertical strip of pages.
 *
 * Continuous scroll (rather than one page at a time) is deliberate: chart
 * rows and written instructions often straddle a page break, and a single
 * scroll surface makes the highlight line behave predictably.
 */
export class PdfView implements RenderedDoc {
  pageCount = 0;
  /** Fired after a zoom, or a window resize, finishes re-rendering every
   * page at the new size -- see the doc comment on RenderedDoc.onReflow. */
  onReflow: (() => void) | null = null;
  private pages: HTMLDivElement[] = [];
  private rendered = new Set<number>();
  /**
   * The text layer of each page, once built.
   *
   * pdf.js paints a page to a canvas, and canvas text is not text: it cannot
   * be selected, copied, or measured. The text layer is a transparent set of
   * positioned spans over the canvas carrying the same characters, which is
   * what makes a PDF's words selectable and what a highlight is measured
   * against. It is invisible, so it costs nothing visually.
   */
  private textLayers = new Map<number, pdfjs.TextLayer>();
  private task: pdfjs.PDFDocumentProxy | null = null;
  private scroller: HTMLElement;
  private container: HTMLDivElement;
  private observer: IntersectionObserver | null = null;
  /**
   * The zoom, as a multiple of fit-width. 1 is fit-width itself, which is
   * where every pattern opens: the common case is reading, not zooming, so
   * the page should fill the pane without anyone having to ask for that.
   */
  private zoom = 1;
  /**
   * Pages the reader has turned, clockwise. Set before `load` so the first
   * paint is already the right way round; changed with `rotate`.
   */
  rotations = new Map<number, Rotation>();

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.container = document.createElement("div");
    this.container.className = "pdf-pages";
    scroller.appendChild(this.container);

    // A resize or column-width change needs a re-layout. Debounced: dragging
    // the window border fires a resize per mouse step, and each one is a full
    // re-render of every page.
    this.onResize = () => {
      clearTimeout(this.resizeTimer ?? undefined);
      this.resizeTimer = window.setTimeout(() => void this.handleResize(), 200);
    };
    window.addEventListener("resize", this.onResize);
  }

  private onResize: () => void;
  private onScroll: (() => void) | null = null;
  /** Throttles scroll-driven renders. */
  private scrollTimer: number | null = null;
  /** Debounces resize re-renders, so dragging the window border is cheap. */
  private resizeTimer: number | null = null;

  async load(bytes: Uint8Array): Promise<void> {
    // pdf.js takes ownership of a copy of the buffer.
    this.task = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    this.pageCount = this.task.numPages;

    for (let n = 1; n <= this.pageCount; n++) {
      const page = document.createElement("div");
      page.className = "pdf-page";
      page.dataset.page = String(n);

      // A canvas sized to the container width, at the PDF's natural aspect
      // ratio, so text stays crisp instead of being scaled oddly.
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      page.appendChild(canvas);
      this.container.appendChild(page);
      this.pages.push(page);
    }

    // Heights first, then the observer. The other way round, the observer's
    // first look happens while every page is still zero tall and stacked at
    // the top, so every page counts as visible and the whole book is painted
    // at once -- 274 pages of it, for the one book this was caught on.
    await this.reserveHeights();
    this.observePages();
    // The first paint is deliberately not awaited.
    //
    // pdf.js yields between chunks of a page paint on requestAnimationFrame,
    // and rAF is paused whenever the window is hidden or minimised. Awaiting
    // the paint here meant that opening a pattern while the window was in the
    // background left `load()` pending forever, so the reader never built its
    // counter or highlight line — and nothing retried once the window came
    // back. Painting is progressive anyway: the observer above starts the
    // visible pages, and the rest follow as they scroll into view.
    void this.render();
  }

  /**
   * Gives every page a placeholder height before any of them are painted.
   *
   * Two things depend on page heights being non-zero from the start: the
   * scrollbar has to represent the whole document, and the IntersectionObserver
   * that triggers rendering on scroll can only fire for an element that
   * occupies space. Without this, a 200-page pattern would collapse to a
   * single screen and only the first page would ever render.
   *
   * Page 1 supplies the real aspect ratio; the rest use it as an estimate and
   * are corrected to the exact size when they render.
   */
  private async reserveHeights(): Promise<void> {
    if (!this.task) return;
    try {
      const first = await this.task.getPage(1);
      const base = first.getViewport({ scale: 1 });
      const width = this.targetWidth();
      const upright = Math.round((width * base.height) / base.width);
      // A page turned a quarter is as tall as it was wide.
      const turned = Math.round((width * base.width) / base.height);
      this.pages.forEach((page, i) => {
        const r = this.rotationOf(i + 1);
        page.style.height = `${r === 90 || r === 270 ? turned : upright}px`;
      });
    } catch {
      // If the first page cannot be read, leave heights unset; render() will
      // still paint the first page and the reader stays usable.
    }
  }

  rotationOf(page: number): Rotation {
    return this.rotations.get(page) ?? 0;
  }

  /**
   * A page's viewport the way the reader is shown it: its own built-in
   * rotation, which pdf.js applies by default, plus the reader's turn.
   */
  private viewportOf(page: pdfjs.PDFPageProxy, scale: number): pdfjs.PageViewport {
    const turn = this.rotationOf(page.pageNumber);
    if (!turn) return page.getViewport({ scale });
    return page.getViewport({ scale, rotation: (page.rotate + turn) % 360 });
  }

  /**
   * Turns a page to a rotation and paints it again, keeping the reader where
   * they were. Whatever is drawn over the page re-measures through onReflow.
   */
  async rotate(n: number, degrees: number): Promise<void> {
    const pageEl = this.pages[n - 1];
    if (!pageEl) return;
    const r = normalRotation(degrees);
    if (r) this.rotations.set(n, r);
    else this.rotations.delete(n);
    // Held against the turned page's top, so the pages below it moving up or
    // down with its new height does not carry the view off somewhere else.
    const anchor = pageEl.offsetTop - this.scroller.scrollTop;
    this.rendered.delete(n);
    await this.renderPage(n, this.targetWidth()).catch(() => {});
    if (pageEl.offsetTop - this.scroller.scrollTop !== anchor) {
      this.scroller.scrollTop = pageEl.offsetTop - anchor;
    }
    await this.render();
    this.onReflow?.();
  }

  /**
   * The page taking up most of the pane: the one a reader means by "this
   * page" when two are partly on screen, unlike currentPage, which is just
   * whichever is at the top.
   */
  pageInView(): number {
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    let best = 1;
    let most = -1;
    for (let n = 1; n <= this.pages.length; n++) {
      const el = this.pages[n - 1];
      if (el.offsetTop > bottom) break;
      const shown = Math.min(bottom, el.offsetTop + el.offsetHeight) - Math.max(top, el.offsetTop);
      if (shown > most) {
        most = shown;
        best = n;
      }
    }
    return best;
  }

  /** The element a page is painted into, for placing a mark. */
  pageElement(page: number): HTMLElement | null {
    return this.pages[page - 1] ?? null;
  }

  /**
   * Width available for a page at the current zoom.
   *
   * Fit-width (zoom 1) is the pane's own width, minus padding and scrollbar
   * allowance; zooming multiplies that, so 200% is twice as wide as the pane
   * and scrolls sideways as well as down, the same as any other PDF viewer.
   */
  private targetWidth(): number {
    const styles = getComputedStyle(this.container);
    const padLeft = parseFloat(styles.paddingLeft || "0");
    const padRight = parseFloat(styles.paddingRight || "0");
    const available = Math.max(320, this.scroller.clientWidth - padLeft - padRight - 2);
    // Capped before zoom is applied: the cap is what "fit-width" fits to, not
    // a ceiling on how far zooming in can go. Without the cap here, the CSS
    // side would have to repeat the same number to avoid stretching a page
    // too wide on a large monitor, and the two would only agree by luck --
    // this was exactly that bug: the container's own max-width shrank the
    // canvas on screen to less than the width pdf.js had just measured and
    // built the text layer against, so a selection landed on the wrong words
    // by however far the two disagreed.
    const fit = Math.min(available, FIT_WIDTH_CAP);
    return fit * this.zoom;
  }

  zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  /**
   * The PDF's embedded outline, with each destination resolved to a page.
   *
   * Taken from Shelfmind's contents panel. A destination that cannot be
   * resolved still shows -- it just cannot be jumped to.
   */
  async outline(): Promise<OutlineItem[]> {
    const doc = this.task;
    if (!doc) return [];
    const raw = await doc.getOutline().catch(() => null);
    if (!raw?.length) return [];
    type Raw = { title: string; dest: string | unknown[] | null; items: Raw[] };
    // Resolved all at once rather than one after another: each is a trip to
    // the PDF worker, and a book's outline can have hundreds.
    const resolve = (items: Raw[]): Promise<OutlineItem[]> =>
      Promise.all(
        items.map(async (it) => {
          let page: number | null = null;
          try {
            const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
            if (Array.isArray(dest) && dest[0]) {
              page = (await doc.getPageIndex(dest[0] as Parameters<typeof doc.getPageIndex>[0])) + 1;
            }
          } catch {
            // Unresolvable destination: shown, just not clickable.
          }
          return { title: it.title || "(untitled)", page, items: it.items?.length ? await resolve(it.items) : [] };
        }),
      );
    return resolve(raw as Raw[]);
  }

  // ---------- search ----------

  /** Each page's search text, read once. */
  private pageTexts = new Map<number, string>();
  /** The query being shown, and which match is the current one. */
  private search: { query: string; current: SearchHit | null } | null = null;

  /**
   * Every page's text, as search counts it.
   *
   * Read from the PDF itself rather than the text layers, since only the
   * pages near the view have one. A few pages at a time, so a long book does
   * not queue hundreds of requests at the worker at once.
   */
  async searchTexts(): Promise<string[]> {
    const doc = this.task;
    if (!doc) return [];
    const missing: number[] = [];
    for (let n = 1; n <= this.pageCount; n++) if (!this.pageTexts.has(n)) missing.push(n);
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(
        missing.slice(i, i + 8).map(async (n) => {
          try {
            const content = await (await doc.getPage(n)).getTextContent();
            const runs = content.items.map((it) => ("str" in it ? it.str : ""));
            this.pageTexts.set(n, pageSearchText(runs));
          } catch {
            this.pageTexts.set(n, "");
          }
        }),
      );
    }
    return Array.from({ length: this.pageCount }, (_, i) => this.pageTexts.get(i + 1) ?? "");
  }

  /** Shows a query's matches on the painted pages, or clears them with null. */
  setSearch(query: string | null, current: SearchHit | null = null): void {
    this.search = query ? { query, current } : null;
    for (let n = 1; n <= this.pages.length; n++) this.paintSearch(n);
  }

  /** Draws one page's matches over its text, as a layer of its own. */
  private paintSearch(n: number): void {
    const page = this.pages[n - 1];
    if (!page) return;
    page.querySelector(".page-search")?.remove();
    const search = this.search;
    const text = this.textLayerFor(n);
    if (!search || !text) return;
    const matches = findTextMatches(text, search.query);
    if (!matches.length) return;
    const layer = document.createElement("div");
    layer.className = "page-search";
    matches.forEach((ranges, i) => {
      const current = search.current?.page === n && search.current.occurrence === i;
      for (const r of rectsForRanges(ranges, page)) {
        const hit = document.createElement("div");
        hit.className = current ? "search-hit current" : "search-hit";
        hit.style.left = `${r.x * 100}%`;
        hit.style.top = `${r.y * 100}%`;
        hit.style.width = `${r.w * 100}%`;
        hit.style.height = `${r.h * 100}%`;
        layer.appendChild(hit);
      }
    });
    page.appendChild(layer);
  }

  /** In-flight region paints by canvas, so a newer paint cancels an older one. */
  private regionTasks = new WeakMap<HTMLCanvasElement, pdfjs.RenderTask>();

  async renderRegion(n: number, rect: RegionRect, cssWidth: number, canvas: HTMLCanvasElement): Promise<void> {
    if (!this.task || rect.w <= 0 || rect.h <= 0) return;
    const page = await this.task.getPage(n);
    // The region is stored upright and painted the way the page is shown, so
    // a pin of a turned chart reads the same way round as the chart does.
    const shown = boxToView(rect, this.rotationOf(n));
    const base = this.viewportOf(page, 1);
    const regionW = shown.w * base.width;
    const regionH = shown.h * base.height;
    const scale = cssWidth / regionW;
    // Capped at 2, as Shelfmind does: past that the bitmap only costs memory.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = scale * dpr;
    // Only the region's own pixels are allocated -- the page is shifted so the
    // region lands at the canvas origin -- rather than painting the whole page
    // at this scale, which for a small crop blown up large would be enormous.
    canvas.width = Math.max(1, Math.round(regionW * s));
    canvas.height = Math.max(1, Math.round(regionH * s));
    canvas.style.width = `${Math.round(regionW * scale)}px`;
    canvas.style.height = `${Math.round(regionH * scale)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.regionTasks.get(canvas)?.cancel();
    const task = page.render({
      canvasContext: ctx,
      viewport: this.viewportOf(page, s),
      transform: [1, 0, 0, 1, -shown.x * base.width * s, -shown.y * base.height * s],
    });
    this.regionTasks.set(canvas, task);
    try {
      await task.promise;
    } catch {
      // Cancelled by a newer paint of the same canvas, or the document went.
    }
  }

  zoomIn(): void {
    void this.setZoom(this.zoom * 1.2);
  }

  zoomOut(): void {
    void this.setZoom(this.zoom / 1.2);
  }

  zoomToFit(): void {
    void this.setZoom(1);
  }

  /**
   * Applies a new zoom, keeping the same spot on the page under the pointer
   * -- or the middle of the pane, lacking one -- rather than resetting to the
   * top. Re-rendering at a new scale is the same work as a resize: every page
   * is repainted, so this reuses that path rather than a second one.
   */
  private async setZoom(next: number): Promise<void> {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (Math.abs(clamped - this.zoom) < 0.001) return;
    const ratio = clamped / this.zoom;
    this.zoom = clamped;

    const prevTop = this.scroller.scrollTop;
    const prevLeft = this.scroller.scrollLeft;
    const prevHeight = this.scroller.clientHeight;
    const prevWidth = this.scroller.clientWidth;

    this.rendered.clear();
    for (const page of this.pages) page.style.height = "";
    await this.reserveHeights();
    await this.render();

    // Scaled around the centre of the pane, so zooming in does not fling the
    // reader off to whatever was at the top-left corner.
    this.scroller.scrollTop = (prevTop + prevHeight / 2) * ratio - prevHeight / 2;
    this.scroller.scrollLeft = (prevLeft + prevWidth / 2) * ratio - prevWidth / 2;
    this.onReflow?.();
  }

  /** Each page's paint in progress, so a newer one can cancel it. */
  private pageTasks = new Map<number, pdfjs.RenderTask>();

  private async renderPage(n: number, width: number): Promise<void> {
    if (!this.task || this.rendered.has(n)) return;
    this.rendered.add(n);
    try {
      const page = await this.task.getPage(n);
      const pageEl = this.pages[n - 1];
      const canvas = pageEl.querySelector("canvas") as HTMLCanvasElement;
      if (!canvas) return;

      // devicePixelRatio keeps charts and text sharp on high-DPI screens.
      const dpr = window.devicePixelRatio || 1;
      const base = this.viewportOf(page, 1);
      const scale = width / base.width;
      const viewport = this.viewportOf(page, scale * dpr);
      const cssWidth = Math.floor(viewport.width / dpr);
      const cssHeight = Math.floor(viewport.height / dpr);

      // pdf.js styles text-layer spans with calc(var(--scale-factor) * Npx);
      // left unset, the spans inherit the document font size and every
      // selection rectangle and text measurement on the page is wrong.
      pageEl.style.setProperty("--scale-factor", String(scale));

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // CSS size stays in device-independent pixels.
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      // Reserve the exact height BEFORE painting. An unpainted page still has
      // to occupy the right amount of space, otherwise the scroll height
      // changes as pages finish and the view jumps under the reader (and
      // offsetTop, used to restore your place, stops being meaningful).
      pageEl.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // The text layer is built alongside the paint rather than after it. It is
      // independent of the canvas -- invisible, and positioned in CSS pixels at
      // the CSS scale, since its spans would be wrong at the device-pixel
      // viewport the canvas uses -- and a large page can take a while to paint.
      // Waiting for the picture to finish means waiting to be able to select
      // the words in it, for no benefit, and it ties the text to a paint that
      // does not always settle.
      const text = this.buildTextLayer(page, pageEl, this.viewportOf(page, scale));
      // Links likewise do not wait for the picture.
      void this.buildLinkLayer(page, pageEl, this.viewportOf(page, scale));
      // A page asked to paint again while still painting -- turned straight
      // after it came into view, or a zoom mid-paint -- cancels the older
      // paint: pdf.js refuses two paints into one canvas at once.
      this.pageTasks.get(n)?.cancel();
      const task = page.render({ canvasContext: ctx, viewport });
      this.pageTasks.set(n, task);
      try {
        await task.promise;
      } catch (e) {
        if (e instanceof Error && e.name === "RenderingCancelledException") return;
        throw e;
      } finally {
        if (this.pageTasks.get(n) === task) this.pageTasks.delete(n);
      }
      await text;
    } catch (e) {
      // Allow a later pass to retry this page rather than leaving a permanent
      // blank in the document.
      this.rendered.delete(n);
      throw e;
    }
  }

  /**
   * Builds the invisible text layer for a page.
   *
   * Failure here is not worth failing the page over: the picture is already
   * painted, and a page without selectable text is still readable, just not
   * highlightable.
   */
  /** Each page's link annotations, read once. */
  private linkCache = new Map<number, unknown[]>();

  /** Called with an outside link's address when it is clicked. */
  onExternalLink: ((url: string) => void) | null = null;

  /**
   * What pdf.js calls when a link is followed. Taken from Shelfmind's: a link
   * inside the document jumps to its page here, and a link out of it is
   * handed to `onExternalLink` rather than followed by the webview itself,
   * which would replace the app with the web page.
   */
  private linkService = {
    externalLinkEnabled: true,
    addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
      link.href = url;
      link.rel = "noopener noreferrer nofollow";
      link.title = url;
      link.onclick = (e) => {
        e.preventDefault();
        this.onExternalLink?.(url);
        return false;
      };
    },
    getDestinationHash: (dest: unknown) => `#${typeof dest === "string" ? dest : ""}`,
    getAnchorUrl: (anchor: string) => anchor || "#",
    goToDestination: async (dest: unknown) => {
      const doc = this.task;
      if (!doc) return;
      let target = dest;
      if (typeof dest === "string") {
        try {
          target = await doc.getDestination(dest);
        } catch {
          return;
        }
      }
      if (!Array.isArray(target)) return;
      const ref = target[0];
      let page: number | null = null;
      if (typeof ref === "number") page = ref + 1;
      else if (ref) {
        try {
          page = (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1;
        } catch {
          // An unresolvable reference goes nowhere.
        }
      }
      if (page) this.goToPage(page);
    },
    executeNamedAction: (action: string) => {
      const current = this.currentPage();
      if (action === "NextPage") this.goToPage(current + 1);
      else if (action === "PrevPage") this.goToPage(current - 1);
      else if (action === "FirstPage") this.goToPage(1);
      else if (action === "LastPage") this.goToPage(this.pageCount);
    },
    executeSetOCGState: () => {},
  };

  /**
   * Makes the page's links clickable: pdf.js's own annotation layer, for the
   * Link kind only -- no forms or popups.
   */
  private async buildLinkLayer(page: pdfjs.PDFPageProxy, pageEl: HTMLElement, viewport: pdfjs.PageViewport): Promise<void> {
    try {
      let links = this.linkCache.get(page.pageNumber);
      if (!links) {
        links = (await page.getAnnotations({ intent: "display" })).filter(
          (a: { subtype?: string }) => a.subtype === "Link",
        );
        this.linkCache.set(page.pageNumber, links);
      }
      pageEl.querySelector(".link-layer")?.remove();
      if (!links.length) return;
      const div = document.createElement("div");
      div.className = "link-layer annotationLayer";
      pageEl.appendChild(div);
      const layer = new pdfjs.AnnotationLayer({
        div,
        page,
        viewport,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
      });
      await layer.render({
        annotations: links,
        linkService: this.linkService,
        renderForms: false,
        div,
        page,
        viewport,
      } as unknown as Parameters<typeof layer.render>[0]);
    } catch {
      // A page whose links cannot be read is still a page; it just has none.
    }
  }

  private async buildTextLayer(
    page: pdfjs.PDFPageProxy,
    pageEl: HTMLElement,
    viewport: pdfjs.PageViewport,
  ): Promise<void> {
    let container = pageEl.querySelector<HTMLElement>(".text-layer");
    if (!container) {
      container = document.createElement("div");
      container.className = "text-layer";
      pageEl.appendChild(container);
    }
    // TextLayer.render() only appends spans, and a re-render after a resize
    // reuses this container, so the previous layer has to be cancelled and its
    // spans removed first -- otherwise every span doubles with each resize.
    this.textLayers.get(page.pageNumber)?.cancel();
    container.replaceChildren();
    const layer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    this.textLayers.set(page.pageNumber, layer);
    await layer.render();
    // A page painted after a search started, by scrolling to it, shows its
    // matches too.
    if (this.search) this.paintSearch(page.pageNumber);
  }

  /**
   * The element a page's text lives in, for measuring a selection.
   *
   * Public because the mark layer needs it: a highlight is the rectangle
   * around real text, so the text has to be in the DOM to be measured.
   */
  textLayerFor(page: number): HTMLElement | null {
    return this.pages[page - 1]?.querySelector<HTMLElement>(".text-layer") ?? null;
  }

  /** Renders visible pages first, then the rest in the background. */
  /**
   * Paints the pages near the view, and lets go of the ones far from it.
   *
   * Only near pages, as Shelfmind does. This used to go on to paint every
   * other page in the background, which on a 274-page book meant holding
   * hundreds of page-sized bitmaps at once and keeping the PDF worker busy
   * for long enough that anything else asking it a question -- the outline,
   * a pin -- waited seconds for an answer.
   */
  async render(): Promise<void> {
    if (!this.task) return;
    const width = this.targetWidth();
    this.releaseFarPages();
    await Promise.all(this.visiblePages().map((n) => this.renderPage(n, width).catch(() => {})));
  }

  /**
   * Frees the bitmaps of pages well away from the view.
   *
   * The page keeps its size, so the scroll does not move; it is simply
   * painted again if the reader comes back to it.
   */
  private releaseFarPages(): void {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    // Every page is looked at, not just the ones recorded as rendered: a paint
    // that failed partway is taken off that record but has already sized its
    // canvas, and would otherwise hold its memory for good.
    this.pages.forEach((el, i) => {
      if (el.offsetTop + el.offsetHeight >= top - height * RELEASE_SCREENS && el.offsetTop <= top + height * (RELEASE_SCREENS + 1)) return;
      const canvas = el.querySelector("canvas");
      if (canvas && canvas.width > 0) {
        canvas.width = 0;
        canvas.height = 0;
      }
      this.rendered.delete(i + 1);
    });
  }

  private visiblePages(): number[] {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    const out: number[] = [];
    for (let n = 1; n <= this.pages.length; n++) {
      const el = this.pages[n - 1];
      const offsetTop = el.offsetTop;
      if (offsetTop + el.offsetHeight > top - height && offsetTop < top + height * 2) {
        out.push(n);
      }
    }
    return out;
  }

  /**
   * Renders pages as they come into view, so scrolling stays smooth.
   *
   * Driven by scroll as well as by an IntersectionObserver: Chromium throttles
   * the observer while the window is covered (Shelfmind found it left pages
   * blank), and a scroll handler on its own would miss pages that come into
   * view by a resize rather than a scroll.
   */
  private observePages(): void {
    this.onScroll = () => {
      if (this.scrollTimer !== null) return;
      this.scrollTimer = window.setTimeout(() => {
        this.scrollTimer = null;
        void this.render();
      }, 60);
    };
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.render().catch(() => {});
        }
      },
      { root: this.scroller, rootMargin: "600px 0px" },
    );
    this.pages.forEach((p) => this.observer?.observe(p));
  }

  private async handleResize(): Promise<void> {
    if (!this.task) return;
    // Canvas CSS sizes and page heights both depend on width, so a resize
    // means discarding the rendered bitmaps and starting over.
    this.rendered.clear();
    for (const page of this.pages) {
      page.style.height = "";
    }
    // Re-establish placeholders at the new width before painting, so the
    // scroll height stays roughly right throughout the re-render.
    await this.reserveHeights();
    await this.render();
    // Every page just repainted at a different pixel size -- a window
    // resize is a fit-width zoom in every way that matters to a mark's
    // position, it just was not asked for. Without this, a mark stays
    // exactly where it was drawn before the resize while the page itself
    // moves out from under it: found by actually maximizing the window with
    // a mark already on screen, where the mark was left sitting over blank
    // pane while the page reflowed to a completely different spot.
    this.onReflow?.();
  }

  get scrollTop(): number {
    return this.scroller.scrollTop;
  }

  set scrollTop(v: number) {
    this.scroller.scrollTop = v;
  }

  goToPage(page: number, offset = 0): void {
    const clamped = Math.min(Math.max(page, 1), this.pageCount);
    const el = this.pages[clamped - 1];
    if (el) {
      this.scroller.scrollTop = el.offsetTop + offset;
    }
    this.render().catch(() => {});
  }

  currentPage(): number {
    const top = this.scroller.scrollTop;
    let best = 1;
    for (let n = 1; n <= this.pages.length; n++) {
      if (this.pages[n - 1].offsetTop <= top + 8) best = n;
      else break;
    }
    return best;
  }

  destroy(): void {
    clearTimeout(this.resizeTimer ?? undefined);
    clearTimeout(this.scrollTimer ?? undefined);
    window.removeEventListener("resize", this.onResize);
    if (this.onScroll) this.scroller.removeEventListener("scroll", this.onScroll);
    this.observer?.disconnect();
    this.task?.destroy();
    this.container.remove();
    this.pages = [];
    this.rendered.clear();
  }
}
