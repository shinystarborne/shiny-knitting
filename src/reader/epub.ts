import { unzipSync, strFromU8 } from "fflate";
import type { OutlineItem, RenderedDoc } from "./pdf";

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

/**
 * Renders an EPUB as one continuous scroll.
 *
 * An EPUB is a zip of XHTML chapters listed in a spine. Each chapter is
 * rendered into a sandboxed iframe so the book's own CSS and scripts cannot
 * reach the app around it, and so stylesheets are scoped to that chapter only.
 * Images are inlined as data URIs and stylesheets as text, because a sandboxed
 * iframe cannot fetch app-relative paths.
 */
export class EpubView implements RenderedDoc {
  pageCount = 0;
  private scroller: HTMLElement;
  private container: HTMLDivElement;
  private frames: HTMLIFrameElement[] = [];
  private chapterHrefs: string[] = [];
  private files: Map<string, Uint8Array> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  /** Watches each chapter's own content, so a frame is re-fitted when it grows. */
  private contentObserver: MutationObserver | null = null;
  /** Watches a chapter's box for purely geometric changes. */
  private sizeObserver: ResizeObserver | null = null;
  /** Frames already being watched, so none is watched twice. */
  private watched = new WeakSet<HTMLIFrameElement>();

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.container = document.createElement("div");
    this.container.className = "epub-chapters";
    scroller.appendChild(this.container);
  }

  async load(bytes: Uint8Array): Promise<void> {
    const entries = unzipSync(bytes);
    for (const [name, data] of Object.entries(entries)) {
      this.files.set(normalize(name), data);
    }

    const opfPath = await this.findOpf();
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    const opfText = this.readText(opfPath);
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfText, "application/xml");

    // Reading order comes from the spine, not the manifest.
    const manifest = new Map<string, ManifestItem>();
    doc.querySelectorAll("manifest > item").forEach((node) => {
      const item: ManifestItem = {
        id: node.getAttribute("id") || "",
        href: node.getAttribute("href") || "",
        mediaType: node.getAttribute("media-type") || "",
        properties: node.getAttribute("properties") || "",
      };
      manifest.set(item.id, item);
    });

    const linear: ManifestItem[] = [];
    doc.querySelectorAll("spine > itemref").forEach((node) => {
      const idref = node.getAttribute("idref") || "";
      const item = manifest.get(idref);
      // Skip anything marked non-linear (prefaces, ads) unless it is all
      // there is.
      if (item && node.getAttribute("linear") !== "no") {
        linear.push(item);
      }
    });

    const spine = linear.length
      ? linear
      : [...manifest.values()].filter((i) => i.mediaType.includes("html"));
    this.chapterHrefs = spine.map((i) => resolvePath(opfDir, i.href));
    this.pageCount = this.chapterHrefs.length;

    for (const href of this.chapterHrefs) {
      const frame = document.createElement("iframe");
      frame.className = "epub-frame";
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.setAttribute("title", "Chapter");
      frame.dataset.href = href;
      this.container.appendChild(frame);
      this.frames.push(frame);
    }

    await this.render();
    this.watchWidth();
  }

  /** EPUB containers declare the OPF location in META-INF/container.xml. */
  private async findOpf(): Promise<string> {
    const containerPath = "META-INF/container.xml";
    if (this.files.has(containerPath)) {
      const doc = new DOMParser().parseFromString(
        this.readText(containerPath),
        "application/xml",
      );
      const rootfile = doc.querySelector("rootfile");
      const full = rootfile?.getAttribute("full-path");
      if (full) return normalize(full);
    }
    // Fall back to scanning for any .opf in the archive.
    for (const name of this.files.keys()) {
      if (name.toLowerCase().endsWith(".opf")) return name;
    }
    throw new Error("This EPUB does not look valid: no content document found.");
  }

  private readText(path: string): string {
    const data = this.files.get(normalize(path));
    if (!data) return "";
    return strFromU8(data);
  }

  /** Base64 data URI, for inlining images and CSS. */
  private dataUri(path: string, fallbackType = "application/octet-stream"): string | null {
    const data = this.files.get(normalize(path));
    if (!data) return null;
    let binary = "";
    // Chunked to stay well under the argument limit of String.fromCharCode.
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
      binary += String.fromCharCode(...data.subarray(i, i + chunk));
    }
    const type = guessMime(path) || fallbackType;
    return `data:${type};base64,${btoa(binary)}`;
  }

  /** Rewrites one chapter's markup so it can live in a sandboxed iframe. */
  private prepareChapter(href: string): string {
    let html = this.readText(href);
    if (!html) return "<p>This chapter could not be read.</p>";
    const dir = href.includes("/") ? href.slice(0, href.lastIndexOf("/") + 1) : "";
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Inline stylesheets, since the iframe has no access to app-relative URLs.
    doc.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
      const target = link.getAttribute("href");
      if (!target || target.startsWith("data:")) {
        link.remove();
        return;
      }
      const data = this.files.get(normalize(resolvePath(dir, target.split("#")[0])));
      if (data) {
        const style = doc.createElement("style");
        // Decode the bytes as UTF-8 text. Routing through the base64 data URI
        // and atob() produces a byte string, which mangles any multibyte
        // character in the CSS into mojibake.
        style.textContent = strFromU8(data);
        link.replaceWith(style);
      } else {
        link.remove();
      }
    });

    // Inline images.
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      const uri = this.dataUri(resolvePath(dir, src.split("#")[0]));
      if (uri) img.setAttribute("src", uri);
      else img.remove();
    });

    // Strip scripts and any inline event handlers. A pattern book has no need
    // to run code, and this keeps the iframe from doing anything unexpected.
    doc.querySelectorAll("script").forEach((s) => s.remove());
    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
      }
    });

    // Book styles can assume a fixed page width, which fights a scrolling
    // layout. Constrain the body and let images shrink to fit.
    const style = doc.createElement("style");
    style.textContent = `
      html, body { margin: 0 auto !important; padding: 0 !important; max-width: 100% !important;
        background: transparent !important; color: inherit !important; }
      body { font-family: inherit; line-height: 1.6; padding: 24px 32px !important;
        box-sizing: border-box; overflow-wrap: break-word; }
      img, svg { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
      pre, code { white-space: pre-wrap !important; }
    `;
    doc.head?.appendChild(style);
    const head = doc.head?.innerHTML ?? "";
    return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${doc.body.innerHTML}</body></html>`;
  }

  async render(): Promise<void> {
    for (let i = 0; i < this.chapterHrefs.length; i++) {
      const href = this.chapterHrefs[i];
      const frame = this.frames[i];
      const prepared = this.prepareChapter(href);

      await new Promise<void>((resolve) => {
        const write = () => resolve();
        frame.addEventListener("load", write, { once: true });
        const targetDoc = frame.contentDocument;
        if (!targetDoc) {
          resolve();
          return;
        }
        targetDoc.open();
        targetDoc.write(prepared);
        targetDoc.close();
        // about:blank with no load event in some cases; do not hang on it.
        setTimeout(write, 120);
      });

      // Images and fonts can settle after the markup does, which changes the
      // height, so re-fit once things have had a moment to load. (A `load`
      // listener on the document never fires -- load targets the window --
      // so the timeout is the mechanism, not a fallback.)
      this.fitHeight(frame);
      window.setTimeout(() => this.fitHeight(frame), 150);
    }
  }

  /** Iframes do not reflow on their own, so match them to the column width. */
  private watchWidth(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.applyWidth());
    this.resizeObserver.observe(this.container);
    this.applyWidth();
  }

  private applyWidth(): void {
    const width = this.container.clientWidth;
    for (const frame of this.frames) {
      frame.style.width = `${width}px`;
      const inner = frame.contentDocument?.documentElement;
      if (inner) inner.style.width = `${width}px`;
      this.fitHeight(frame);
    }
  }

  /**
   * Shrinks each frame to its content height. A fixed height would leave a
   * band of blank page under short chapters, and the highlight line is
   * measured against the document, so the extra space would also throw off
   * scrolling and page-position restore.
   */
  private fitHeight(frame: HTMLIFrameElement): void {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    this.observeBody(frame);
    const height = doc.body.scrollHeight;
    if (height <= 0) return;
    // Only write when the height has genuinely changed. `fitHeight` runs from a
    // ResizeObserver, and setting the frame's height resizes the frame, so
    // writing unconditionally would re-trigger the observer for ever.
    const current = Math.round(frame.getBoundingClientRect().height);
    if (Math.abs(current - height) <= 1) return;
    frame.style.height = `${height}px`;
    // Everything below this frame has just moved, including any mark drawn
    // over it, so the reader has to redraw rather than wait for a scroll.
    this.onReflow?.();
  }

  /**
   * Called after a chapter changes height.
   *
   * Repainting on scroll alone is not enough: a chapter that grows when a
   * webfont settles pushes everything below it down without the reader moving
   * at all, which would leave every mark under that point drawn where its text
   * used to be.
   */
  onReflow: (() => void) | null = null;

  /**
   * Watches a frame's own content, so the frame is re-fitted when it grows.
   *
   * Watching only the container is not enough: a chapter can get taller after
   * it has loaded — a late webfont settling, an image decoding — without the
   * container moving at all. A frame left at its old height clips the text,
   * and a mark on clipped text has nowhere to be drawn, so the mark silently
   * disappears rather than being placed wrongly.
   *
   * Done here rather than once up front because a chapter's document does not
   * exist yet when the frames are created: the markup is written into them a
   * moment later. `fitHeight` runs at each of those moments, so asking it to
   * make sure the body is watched catches every one of them.
   */
  private observeBody(frame: HTMLIFrameElement): void {
    const doc = frame.contentDocument;
    if (!doc?.body || this.watched.has(frame)) return;
    // Keyed on the frame rather than the body, because writing the document
    // replaces the body element and the frame would then be watched twice.
    this.watched.add(frame);

    // Both observers are built from the chapter's own window: an observer only
    // watches elements in its own document, and a chapter's body lives in the
    // iframe's, not this one.
    const view = frame.contentWindow as (Window & typeof globalThis) | null;
    if (!view) return;
    // A mutation's target is a node inside the chapter's document, which is
    // how it finds its way back to the frame that owns it above. Content
    // changing is the common case -- an image decoding, a stylesheet
    // applying, a late webfont -- and a mutation is the only way to hear
    // about most of them, since a chapter can grow while the container sits
    // still. A ResizeObserver is kept alongside it for the purely geometric
    // case, and `fitHeight` only writes a height that has really changed, so
    // neither can set the other off in a loop.
    const MutationCtor = view.MutationObserver ?? MutationObserver;
    // The observer is shared by every chapter, so a mutation cannot be assumed
    // to belong to the frame that happened to create the observer. Route each
    // one back through its node's document to the frame that owns it.
    this.contentObserver ??= new MutationCtor((mutations: MutationRecord[]) => {
      for (const mutation of mutations) {
        const owner = mutation.target.ownerDocument?.defaultView?.frameElement;
        if (owner instanceof HTMLIFrameElement) this.fitHeight(owner);
      }
    });
    // The whole document rather than the body, because the change that
    // resizes a chapter as often comes from its head: a stylesheet arriving or
    // a webfont rule applying changes every line below it without touching the
    // body itself.
    this.contentObserver.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    if (!this.sizeObserver) {
      const SizeCtor = view.ResizeObserver ?? ResizeObserver;
      if (SizeCtor) {
        this.sizeObserver = new SizeCtor((entries: ResizeObserverEntry[]) => {
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const owner = target.ownerDocument?.defaultView?.frameElement;
            if (owner instanceof HTMLIFrameElement) this.fitHeight(owner);
          }
        });
      }
    }
    this.sizeObserver?.observe(doc.body);
  }

  get scrollTop(): number {
    return this.scroller.scrollTop;
  }

  set scrollTop(v: number) {
    this.scroller.scrollTop = v;
  }

  goToPage(page: number, offset = 0): void {
    const idx = Math.min(Math.max(page, 1), this.frames.length) - 1;
    const frame = this.frames[idx];
    if (frame) {
      this.scroller.scrollTop = frame.offsetTop + offset;
    }
  }

  currentPage(): number {
    const top = this.scroller.scrollTop;
    let best = 1;
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i].offsetTop <= top + 8) best = i + 1;
      else break;
    }
    return best;
  }

  /**
   * The element a chapter is rendered into, for placing a mark.
   *
   * The iframe itself, because a mark's coordinates are stored relative to the
   * chapter as the reader sees it.
   */
  pageElement(page: number): HTMLElement | null {
    return this.frames[page - 1] ?? null;
  }

  /**
   * A chapter's body, for measuring a selection.
   *
   * EPUB text is already DOM, so unlike a PDF there is nothing to synthesise.
   * The frame is same-origin because it is sandboxed with
   * `allow-same-origin`, which is what lets the parent reach into it. A chapter
   * that has not finished loading has no document yet, and a selection cannot
   * be made in one either.
   */
  textLayerFor(page: number): HTMLElement | null {
    const frame = this.frames[page - 1];
    if (!frame) return null;
    try {
      return frame.contentDocument?.body ?? null;
    } catch {
      // A frame the browser refuses to reach is a frame we cannot mark.
      return null;
    }
  }

  /**
   * The chapters, as a table of contents: each named after its own first
   * heading, or its title, or its place in the book when it has neither.
   */
  async outline(): Promise<OutlineItem[]> {
    return this.frames.map((frame, i) => {
      let title = "";
      try {
        const doc = frame.contentDocument;
        title = (doc?.querySelector("h1, h2, h3")?.textContent || doc?.title || "").replace(/\s+/g, " ").trim();
      } catch {
        // An unreachable frame is still a chapter; it just gets a plain name.
      }
      return { title: title || `Chapter ${i + 1}`, page: i + 1, items: [] };
    });
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.contentObserver?.disconnect();
    this.sizeObserver?.disconnect();
    this.container.remove();
    this.frames = [];
    this.chapterHrefs = [];
    this.files.clear();
  }
}

function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

function guessMime(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    css: "text/css",
    js: "application/javascript",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    xhtml: "application/xhtml+xml",
    html: "text/html",
  };
  return map[ext] || null;
}

/** Resolves a relative href against a directory, honouring ../ segments. */
function resolvePath(baseDir: string, href: string): string {
  const parts = baseDir.split("/").filter(Boolean);
  for (const segment of href.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}
