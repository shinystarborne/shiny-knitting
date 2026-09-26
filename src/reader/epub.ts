import { unzipSync, strFromU8 } from "fflate";
import type { RenderedDoc } from "./pdf";

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
 * Images and stylesheets are inlined as data URIs, because a sandboxed iframe
 * cannot fetch app-relative paths.
 */
export class EpubView implements RenderedDoc {
  pageCount = 0;
  private scroller: HTMLElement;
  private container: HTMLDivElement;
  private frames: HTMLIFrameElement[] = [];
  private chapterHrefs: string[] = [];
  private files: Map<string, Uint8Array> = new Map();
  private resizeObserver: ResizeObserver | null = null;

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
      const uri = this.dataUri(resolvePath(dir, target.split("#")[0]));
      if (uri) {
        const style = doc.createElement("style");
        style.textContent = atob(uri.split(",")[1] || "");
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
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${doc.body.innerHTML}</body></html>`;
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
      // height, so re-fit once things have had a moment to load.
      this.fitHeight(frame);
      frame.contentDocument?.addEventListener("load", () => this.fitHeight(frame));
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
    const height = doc.body.scrollHeight;
    if (height > 0) frame.style.height = `${height}px`;
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

  destroy(): void {
    this.resizeObserver?.disconnect();
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
