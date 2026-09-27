import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { unzipSync, strFromU8 } from "fflate";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many pages of a PDF to read before giving up. */
const MAX_PDF_PAGES = 4;
/** How many EPUB chapters to read. */
const MAX_EPUB_CHAPTERS = 3;

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
  if (format !== "pdf") {
    // An EPUB's text is HTML, so a missing text layer means an empty or
    // image-only document, and rendering a chapter as a picture would mean
    // screenshotting an iframe. There is nothing useful to hand over.
    return [];
  }
  try {
    return await pdfPageImages(bytes);
  } catch {
    // A PDF that will not even open has no pages to show either.
    return [];
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
      await page.render({ canvasContext: ctx, viewport }).promise;

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

function excerptFromEpub(bytes: Uint8Array, maxChars: number): string {
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    files.set(normalize(name), data);
  }

  const opfPath = findOpf(files);
  if (!opfPath) return "";
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const doc = new DOMParser().parseFromString(strFromU8(files.get(opfPath)!), "application/xml");

  const manifest = new Map<string, string>();
  doc.querySelectorAll("manifest > item").forEach((node) => {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    if (id && href) manifest.set(id, href);
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
