import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { unzipSync, strFromU8 } from "fflate";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many pages of a PDF to read before giving up. */
const MAX_PDF_PAGES = 4;
/**
 * How many EPUB chapters to look through for text. A book's first ones are
 * often its cover, title page and copyright page, as pictures: read on past
 * them, as far as this.
 */
const MAX_EPUB_CHAPTERS = 15;

/**
 * Pulls a short, readable excerpt out of a pattern file, for the AI to read.
 *
 * The excerpt is deliberately small. Everything the AI is asked for — gauge,
 * size, materials, needle size — appears on the first page or two of a
 * pattern, and a short excerpt is faster, cheaper, and sends far less of
 * someone's pattern library to a model server.
 *
 * Only the front matter is read. There is no reason to send a pattern's
 * instructions, and not doing so is the point.
 */
export async function extractExcerpt(
  format: "pdf" | "epub",
  bytes: Uint8Array,
  maxChars: number,
): Promise<string> {
  const raw =
    format === "epub" ? excerptFromEpub(bytes, maxChars) : await excerptFromPdf(bytes, maxChars);
  return raw.slice(0, Math.max(200, maxChars));
}

/**
 * How many pages a PDF has, for the model: a book is told apart from a
 * pattern as much by its length as by its contents page. 0 when unknown, and
 * for an EPUB, which has chapters, not pages (and is a book anyway).
 */
export async function pageCount(format: "pdf" | "epub", bytes: Uint8Array): Promise<number> {
  if (format !== "pdf") return 0;
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const n = doc.numPages;
    await doc.destroy().catch(() => {});
    return n;
  } catch {
    return 0;
  }
}

/** How many pages to render when a file has to be read as pictures. */
const VISION_PAGES = 3;
/**
 * How wide to render each page image, in pixels.
 *
 * Wide enough that a gauge line or a needle size is legible in a scan, narrow
 * enough that a handful of pages is a reasonable payload. Going much wider
 * costs a lot of base64 for detail a pattern's front page does not have.
 */
const VISION_PAGE_WIDTH = 1100;
/** JPEG quality for the rendered pages. */
const VISION_QUALITY = 0.72;

/**
 * Renders the first pages of a PDF as JPEG data URLs, for a file with no text
 * layer to send to a vision-capable model.
 *
 * A great many knitting patterns are scans or phone photographs, where the
 * page is an image and text search finds nothing at all. There is no way to
 * read those without looking at them, so the pages themselves become the
 * excerpt.
 *
 * Returns an empty array when the file cannot be rendered, so the caller can
 * fall back to reporting that there was nothing to read.
 */
export async function excerptImages(
  format: "pdf" | "epub",
  bytes: Uint8Array,
): Promise<string[]> {
  try {
    // An EPUB with no text is its pictures: a book made of scanned pages, or
    // a cover and title page before anything else. Those are sent instead.
    return format === "epub" ? await epubImages(bytes) : await pdfPageImages(bytes);
  } catch {
    // A file that will not even open has no pages to show either.
    return [];
  }
}

/** An EPUB's first pictures, as they come in its chapters (its cover first), smaller ones (icons, rules) left out. */
async function epubImages(bytes: Uint8Array): Promise<string[]> {
  const book = readEpub(bytes);
  if (!book) return [];
  const paths: string[] = [];
  const add = (path: string | null | undefined) => {
    if (path && !paths.includes(path) && book.files.has(path)) paths.push(path);
  };
  add(book.cover);
  for (const chapter of book.order.slice(0, MAX_EPUB_CHAPTERS)) {
    const data = book.files.get(normalize(chapter));
    if (!data) continue;
    const doc = new DOMParser().parseFromString(strFromU8(data), "text/html");
    const dir = chapter.includes("/") ? chapter.slice(0, chapter.lastIndexOf("/") + 1) : "";
    doc.querySelectorAll("img[src], image").forEach((el) => {
      const href = el.getAttribute("src") ?? el.getAttribute("xlink:href") ?? el.getAttribute("href");
      if (href && !/^(data|https?):/i.test(href)) add(normalize(resolvePath(dir, decodeHref(href.split("#")[0]))));
    });
    if (paths.length >= VISION_PAGES * 2) break;
  }
  const out: string[] = [];
  for (const path of paths) {
    const url = await pictureForModel(new Blob([book.files.get(path)!.slice()], { type: mimeOf(path) }));
    if (url) out.push(url);
    if (out.length >= VISION_PAGES) break;
  }
  return out;
}

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
}

/** A picture as the model is sent a page: at most VISION_PAGE_WIDTH wide, as JPEG; null when it is too small to be a page, or cannot be read. */
async function pictureForModel(blob: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) < 300) return null;
    const scale = Math.min(1, VISION_PAGE_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", VISION_QUALITY);
  } finally {
    bitmap.close();
  }
}

async function pdfPageImages(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const out: string[] = [];
    const pages = Math.min(VISION_PAGES, doc.numPages);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (!base.width || !base.height) continue;
      const viewport = page.getViewport({ scale: VISION_PAGE_WIDTH / base.width });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      // A transparent canvas would come out as black-on-black in JPEG, and
      // a scan's white page is what the model needs to read.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Drawn as for printing: not waiting on the screen's frames, which do
      // not come while the app's window is behind another or minimised.
      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;

      const dataUrl = canvas.toDataURL("image/jpeg", VISION_QUALITY);
      // toDataURL on a blank or failed render still returns a valid but
      // useless image; a very small one is not worth sending.
      if (dataUrl.length > 2000) out.push(dataUrl);
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

async function excerptFromPdf(bytes: Uint8Array, maxChars: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const pages = Math.min(MAX_PDF_PAGES, doc.numPages);
    const parts: string[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Text items come back in reading order but split mid-word, so they are
      // joined with a space and tidied afterwards.
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) parts.push(text);
      if (parts.join(" ").length >= maxChars) break;
    }
    return parts.join("\n\n");
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/** An EPUB opened: its files, its chapters in reading order, and its cover picture. */
function readEpub(bytes: Uint8Array): { files: Map<string, Uint8Array>; order: string[]; cover: string | null } | null {
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    files.set(normalize(name), data);
  }

  const opfPath = findOpf(files);
  if (!opfPath) return null;
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const doc = new DOMParser().parseFromString(strFromU8(files.get(opfPath)!), "application/xml");

  const manifest = new Map<string, string>();
  let cover: string | null = null;
  // The cover: an item said to be it (EPUB 3), or the one a <meta name="cover"> names (EPUB 2).
  const coverId = doc.querySelector('metadata > meta[name="cover"]')?.getAttribute("content");
  doc.querySelectorAll("manifest > item").forEach((node) => {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    if (id && href) manifest.set(id, href);
    if (href && /^image\//.test(node.getAttribute("media-type") ?? "") && (/\bcover-image\b/.test(node.getAttribute("properties") ?? "") || id === coverId)) {
      cover = normalize(resolvePath(opfDir, decodeHref(href.split("#")[0])));
    }
  });

  // Follow the spine, which is the reading order.
  const order: string[] = [];
  doc.querySelectorAll("spine > itemref").forEach((node) => {
    const idref = node.getAttribute("idref");
    const href = idref ? manifest.get(idref) : undefined;
    if (href) order.push(resolvePath(opfDir, decodeHref(href.split("#")[0])));
  });
  if (!order.length) {
    for (const href of manifest.values()) {
      if (/\.x?html?$/i.test(href)) order.push(resolvePath(opfDir, decodeHref(href.split("#")[0])));
    }
  }
  return { files, order, cover };
}

function excerptFromEpub(bytes: Uint8Array, maxChars: number): string {
  const book = readEpub(bytes);
  if (!book) return "";
  const { files, order } = book;

  // Chapters until there is enough to read: past a cover, title page or
  // copyright page that are only pictures.
  const parts: string[] = [];
  let budget = maxChars;
  for (const path of order.slice(0, MAX_EPUB_CHAPTERS)) {
    const data = files.get(normalize(path));
    if (!data) continue;
    const chapter = new DOMParser().parseFromString(strFromU8(data), "text/html");
    // Scripts and styles are noise for a language model.
    chapter.querySelectorAll("script, style, nav").forEach((n) => n.remove());
    const text = (chapter.body?.textContent || "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
    budget -= text.length;
    if (budget <= 0) break;
  }
  return parts.join("\n\n");
}

function findOpf(files: Map<string, Uint8Array>): string | null {
  const container = files.get("META-INF/container.xml");
  if (container) {
    const doc = new DOMParser().parseFromString(strFromU8(container), "application/xml");
    const full = doc.querySelector("rootfile")?.getAttribute("full-path");
    if (full && files.has(normalize(full))) return normalize(full);
  }
  for (const name of files.keys()) {
    if (name.toLowerCase().endsWith(".opf")) return name;
  }
  return null;
}

function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Percent-decodes an EPUB manifest href. Zip entry names are stored decoded,
 * so a href like `chapter%20one.xhtml` would otherwise never match its
 * entry. A malformed escape makes decodeURIComponent throw; the raw href is
 * kept then, which simply misses rather than breaking the whole read.
 */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function resolvePath(baseDir: string, href: string): string {
  const parts = baseDir.split("/").filter(Boolean);
  for (const segment of href.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}
