import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many background pages to render concurrently. */
const BATCH = 4;

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
  private renderToken = 0;
  private observer: IntersectionObserver | null = null;
  /**
   * The zoom, as a multiple of fit-width. 1 is fit-width itself, which is
   * where every pattern opens: the common case is reading, not zooming, so
   * the page should fill the pane without anyone having to ask for that.
   */
  private zoom = 1;

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

    this.observePages();
    await this.reserveHeights();
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
      const estimated = Math.round((this.targetWidth() * base.height) / base.width);
      for (const page of this.pages) {
        page.style.height = `${estimated}px`;
      }
    } catch {
      // If the first page cannot be read, leave heights unset; render() will
      // still paint the first page and the reader stays usable.
    }
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
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale: scale * dpr });
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
      const text = this.buildTextLayer(page, pageEl, page.getViewport({ scale }));
      await page.render({ canvasContext: ctx, viewport }).promise;
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
  async render(): Promise<void> {
    if (!this.task) return;
    const token = ++this.renderToken;
    const width = this.targetWidth();

    const visible = this.visiblePages();
    await Promise.all(visible.map((n) => this.renderPage(n, width).catch(() => {})));
    if (token !== this.renderToken) return;

    // Fill in the rest quietly so fast scrolling always has something ready.
    // A few at a time: a long pattern would otherwise queue every page at
    // once and hold dozens of large canvases in memory.
    const pending: number[] = [];
    for (let n = 1; n <= this.pageCount; n++) {
      if (!visible.includes(n) && !this.rendered.has(n)) pending.push(n);
    }
    for (let i = 0; i < pending.length; i += BATCH) {
      if (token !== this.renderToken) return;
      await Promise.all(
        pending.slice(i, i + BATCH).map((n) => this.renderPage(n, width).catch(() => {})),
      );
    }
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

  /** Renders pages as they come into view, so scrolling stays smooth. */
  private observePages(): void {
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
    this.renderToken++;
    clearTimeout(this.resizeTimer ?? undefined);
    window.removeEventListener("resize", this.onResize);
    this.observer?.disconnect();
    this.task?.destroy();
    this.container.remove();
    this.pages = [];
    this.rendered.clear();
  }
}
