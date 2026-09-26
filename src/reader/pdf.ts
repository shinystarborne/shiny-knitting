import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many background pages to render concurrently. */
const BATCH = 4;

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
  destroy(): void;
}

/**
 * Renders a PDF into a continuous vertical strip of pages.
 *
 * Continuous scroll (rather than one page at a time) is deliberate: chart
 * rows and written instructions often straddle a page break, and a single
 * scroll surface makes the highlight line behave predictably.
 */
export class PdfView implements RenderedDoc {
  pageCount = 0;
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

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.container = document.createElement("div");
    this.container.className = "pdf-pages";
    scroller.appendChild(this.container);

    // A resize or column-width change needs a re-layout.
    this.onResize = () => this.handleResize();
    window.addEventListener("resize", this.onResize);
  }

  private onResize: () => void;

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

  /** Width available for a page, minus padding and scrollbar allowance. */
  private targetWidth(): number {
    const styles = getComputedStyle(this.container);
    const padLeft = parseFloat(styles.paddingLeft || "0");
    const padRight = parseFloat(styles.paddingRight || "0");
    return Math.max(320, this.scroller.clientWidth - padLeft - padRight - 2);
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
      await page.render({ canvasContext: ctx, viewport }).promise;
      // The text layer is built after the paint, at the CSS size, because its
      // spans are positioned in CSS pixels and would be wrong at the
      // device-pixel viewport the canvas uses.
      await this.buildTextLayer(page, pageEl, page.getViewport({ scale }));
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
    window.removeEventListener("resize", this.onResize);
    this.observer?.disconnect();
    this.task?.destroy();
    this.container.remove();
    this.pages = [];
    this.rendered.clear();
  }
}
