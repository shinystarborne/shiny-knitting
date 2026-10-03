import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { unzipSync, strFromU8 } from "fflate";
import { api, toBytes, type Pattern } from "./api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Longest edge of a stored cover. Big enough for a card at any zoom. */
const COVER_SIZE = 900;

/**
 * Image handling for pattern covers and yarn photos.
 *
 * All image work happens here in the webview, where a canvas already exists,
 * and the backend only ever stores finished bytes. That keeps a native image
 * library out of the app and means a 12 MB phone photo is downscaled before
 * it ever reaches the disk.
 */

export interface ExtractedCover {
  blob: Blob;
  /** Where it came from, for the UI to explain. */
  source: "pdf-first-page" | "epub-cover" | "chosen-file";
}

/**
 * Reads the cover out of a pattern's own file: the first page of a PDF, or
 * the cover image an EPUB declares.
 */
export async function extractFromDocument(
  pattern: Pattern,
  bytes: Uint8Array,
): Promise<ExtractedCover | null> {
  return pattern.format === "epub" ? extractFromEpub(bytes) : extractFromPdf(bytes);
}

/** Renders page 1 of a PDF to a JPEG. */
async function extractFromPdf(bytes: Uint8Array): Promise<ExtractedCover | null> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Scale straight to the target width rather than rendering a huge page and
    // shrinking it, which is slow and wasteful.
    const scale = Math.min(COVER_SIZE / base.width, 3);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // A PDF page with no background is transparent, which shows as black on a
    // dark card. Paper is white, so paint it.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await toJpeg(canvas, 0.85);
    return blob ? { blob, source: "pdf-first-page" } : null;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/**
 * Finds an EPUB's cover image.
 *
 * Three ways a book can declare one, in the order the specifications suggest:
 * an EPUB 3 manifest item marked `cover-image`, an EPUB 2 `<meta name="cover">`
 * pointing at an id, and finally any image whose filename looks like a cover.
 */
async function extractFromEpub(bytes: Uint8Array): Promise<ExtractedCover | null> {
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    files.set(normalize(name), data);
  }

  const opfPath = findOpf(files);
  if (!opfPath) return null;
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const doc = new DOMParser().parseFromString(strFromU8(files.get(opfPath)!), "application/xml");

  const manifest = [...doc.querySelectorAll("manifest > item")].map((node) => ({
    id: node.getAttribute("id") || "",
    href: node.getAttribute("href") || "",
    type: node.getAttribute("media-type") || "",
    properties: node.getAttribute("properties") || "",
  }));

  let href = manifest.find((i) => i.properties.includes("cover-image"))?.href;

  if (!href) {
    const metaId = doc.querySelector('meta[name="cover"]')?.getAttribute("content");
    href = manifest.find((i) => i.id === metaId)?.href;
  }

  if (!href) {
    // Some books just name the file "cover.jpg".
    const guess = manifest.find(
      (i) => i.type.startsWith("image/") && /cover/i.test(i.href),
    );
    href = guess?.href;
  }

  if (!href) return null;
  const data = files.get(normalize(resolvePath(opfDir, decodeHref(href.split("#")[0]))));
  if (!data) return null;

  const source = dataMime(href);
  // An SVG cannot be used as a CSS background-image, and would silently show
  // as an empty card. Rasterising it here means every cover, whatever its
  // format, is a plain JPEG that renders everywhere.
  if (source === "image/svg+xml") {
    return rasteriseSvg(new Blob([data.slice().buffer], { type: source }));
  }
  return {
    blob: new Blob([data.slice().buffer], { type: source }),
    source: "epub-cover",
  };
}

/**
 * Draws an SVG into a canvas and returns it as a JPEG.
 *
 * Returns null if the SVG will not draw, which leaves the pattern with a
 * placeholder rather than a broken cover.
 */
async function rasteriseSvg(svg: Blob): Promise<ExtractedCover | null> {
  const text = await svg.text();
  // An SVG with no intrinsic size lays out at 300x150 by default, which looks
  // wrong as a cover. Fall back to a sensible portrait shape and let the
  // viewBox decide the rest.
  const withSize = /viewBox\s*=/.test(text) ? text : injectSize(text);
  const url = URL.createObjectURL(new Blob([withSize], { type: "image/svg+xml" }));
  try {
    const image = await loadImage(url);
    const scale = Math.min(COVER_SIZE / image.width, COVER_SIZE / image.height, 4);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas, 0.85);
    return blob ? { blob, source: "epub-cover" } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function injectSize(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/, (match, attrs: string) =>
    /width\s*=/.test(attrs) ? match : `<svg${attrs} width="600" height="800">`,
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the image could not be decoded"));
    image.src = src;
  });
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

/**
 * Preparses a user-chosen image: downscaled, re-encoded as JPEG, and stripped
 * of anything that would bloat it. Returns null for a file that is not an
 * image the browser can decode.
 */
export async function prepareChosenImage(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, COVER_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await toJpeg(canvas, 0.85);
  } finally {
    bitmap.close();
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

// ---------- storing and reading ----------

/** Uploads a prepared cover and records it against the pattern. */
export async function saveCover(patternId: string, blob: Blob): Promise<void> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await api.setCover(patternId, Array.from(buffer));
}

export async function removeCover(patternId: string): Promise<void> {
  await api.removeCover(patternId);
}

/** Uploads a prepared photo and records it against the yarn. */
export async function saveYarnPhoto(yarnId: string, blob: Blob): Promise<void> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await api.setYarnPhoto(yarnId, Array.from(buffer));
}

export async function removeYarnPhoto(yarnId: string): Promise<void> {
  await api.removeYarnPhoto(yarnId);
}

/**
 * Works out an image's type from its first bytes.
 *
 * The backend returns image bytes as a raw payload and does not send a MIME
 * type alongside, because covers are only ever JPEG or PNG and the type is
 * already in the data. This mirrors the backend's own sniffing.
 */
export function imageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return "application/octet-stream";
}

/**
 * Object URLs for stored images, cached per id as the promise that produces
 * them.
 *
 * Reading an image is a round trip to the backend, and a view asks for the
 * same one every time it repaints, so each is fetched once and the URL is
 * reused. Caching the in-flight promise, not just the resolved URL, means two
 * calls for one id share a single read instead of each creating an object URL
 * that only one of them can keep. Revoked by `clear` when the view changes.
 *
 * The fetch-bytes function is the only thing that differs between pattern
 * covers and yarn photos, so both caches are made from this one factory.
 */
function makeImageCache(fetchBytes: (id: string) => Promise<ArrayBuffer | ArrayBufferView>) {
  const urlCache = new Map<string, Promise<string | null>>();

  const url = (id: string): Promise<string | null> => {
    const cached = urlCache.get(id);
    if (cached) return cached;
    // Declared separately: the body below compares the cache entry against
    // the promise itself, and a const cannot be named inside its own
    // initializer.
    let promise!: Promise<string | null>;
    promise = (async () => {
      let objectUrl: string | null = null;
      try {
        const raw = await fetchBytes(id);
        const bytes = toBytes(raw);
        if (bytes.length > 0) {
          const blob = new Blob([bytes], { type: imageMime(bytes) });
          objectUrl = URL.createObjectURL(blob);
        }
      } catch {
        // No image, or the file went missing. Not an error worth surfacing.
      }
      // Only a URL that is still the current entry is kept. One produced
      // after the cache was cleared or replaced belongs to a dead screen:
      // nothing will revoke it, so it is revoked here rather than leaked.
      // Misses are not cached either, so a later call can retry.
      if (urlCache.get(id) !== promise) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return null;
      }
      if (!objectUrl) urlCache.delete(id);
      return objectUrl;
    })();
    urlCache.set(id, promise);
    return promise;
  };

  /** Drops one cached URL so the next read fetches fresh bytes. */
  const forget = (id: string): void => {
    const entry = urlCache.get(id);
    if (!entry) return;
    urlCache.delete(id);
    void entry.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  };

  const clear = (): void => {
    const entries = [...urlCache.values()];
    urlCache.clear();
    for (const entry of entries) {
      void entry.then((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    }
  };

  return { url, forget, clear };
}

const coverCache = makeImageCache((id) => api.getCover(id));
export const coverUrl = coverCache.url;
export const forgetCover = coverCache.forget;
export const clearCoverCache = coverCache.clear;

const yarnPhotoCache = makeImageCache((id) => api.getYarnPhoto(id));
export const yarnPhotoUrl = yarnPhotoCache.url;
export const forgetYarnPhoto = yarnPhotoCache.forget;
export const clearYarnPhotoCache = yarnPhotoCache.clear;

const wishPhotoCache = makeImageCache((id) => api.getWishPhoto(id));
export const wishPhotoUrl = wishPhotoCache.url;
export const forgetWishPhoto = wishPhotoCache.forget;
export const clearWishPhotoCache = wishPhotoCache.clear;

const swatchPhotoCache = makeImageCache((id) => api.getSwatchPhoto(id));
export const swatchPhotoUrl = swatchPhotoCache.url;
export const forgetSwatchPhoto = swatchPhotoCache.forget;
export const clearSwatchPhotoCache = swatchPhotoCache.clear;

const projectCoverCache = makeImageCache((id) => api.getProjectCover(id));
export const projectCoverUrl = projectCoverCache.url;
export const forgetProjectCover = projectCoverCache.forget;

const boardImageCache = makeImageCache((id) => api.getBoardImage(id));
export const boardImageUrl = boardImageCache.url;
export const forgetBoardImage = boardImageCache.forget;
export const clearBoardImageCache = () => {
  boardImageCache.clear();
  projectCoverCache.clear();
};

/** The longest side a picture on a board is kept at: big enough to fill a screen. */
const BOARD_IMAGE_SIZE = 1600;

/**
 * A picture for a board or a project cover, downscaled to `maxSide` and
 * returned with its size, so the board can give it the right shape. PNGs stay
 * PNG, so a screenshot or a chart with transparency is not turned to JPEG.
 */
export async function prepareBoardImage(
  file: Blob,
  maxSide = BOARD_IMAGE_SIZE,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = file.type === "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), png ? "image/png" : "image/jpeg", 0.88),
    );
    return blob ? { blob, width: canvas.width, height: canvas.height } : null;
  } finally {
    bitmap.close();
  }
}

export async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Extracts and stores a cover if the pattern does not already have one.
 * Failures are swallowed: a missing cover is a cosmetic problem, never a
 * reason to refuse to open a pattern.
 */
export async function ensureCover(pattern: Pattern, bytes: Uint8Array): Promise<boolean> {
  if (pattern.coverPath) return false;
  try {
    const found = await extractFromDocument(pattern, bytes);
    if (!found) return false;
    await saveCover(pattern.id, found.blob);
    forgetCover(pattern.id);
    return true;
  } catch {
    return false;
  }
}

// ---------- path helpers, shared with the reader ----------

function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Percent-decodes an EPUB manifest href. Zip entry names are stored decoded,
 * so a href like `cover%20art.jpg` would otherwise never match its entry. A
 * malformed escape makes decodeURIComponent throw; the raw href is kept then,
 * which simply misses rather than breaking the whole read.
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

function dataMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return map[ext] || "image/jpeg";
}
