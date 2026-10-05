/**
 * Saving some of a pattern as a PDF: a few pages of a PDF, or chapters of an
 * EPUB (one pattern out of a big collection, say).
 *
 * A PDF's pages are copied as they are, so the text stays sharp and
 * selectable and the file stays small. An EPUB has no pages, so its chapters
 * are laid out on A4 at a reading width and drawn as pictures, a page at a
 * time, each page broken between lines of text rather than through them.
 */
import type { PDFDocument as PdfLibDocument } from "pdf-lib";

/** "1-3, 7, 9-8" → [1, 2, 3, 7, 9, 8]: in the order written, each once, within 1 to `max`. */
export function parseRanges(text: string, max: number): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const step = a <= b ? 1 : -1;
    for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
      if (n >= 1 && n <= max && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** [1, 2, 3, 7] → "1–3, 7": runs joined, in the order given. */
export function formatRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  return out.join(", ");
}

async function pdfLib(): Promise<typeof import("pdf-lib")> {
  // Loaded when first needed: most sessions never save pages.
  return import("pdf-lib");
}

/** The chosen pages of a PDF (1-based, in the order given), copied as they are. */
export async function pdfPages(bytes: Uint8Array, pages: number[], title: string): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  finish(out, title);
  return out.save();
}

function finish(doc: PdfLibDocument, title: string): void {
  doc.setTitle(title);
  doc.setProducer("Shiny Knitting");
  doc.setCreator("Shiny Knitting");
}

// ---------- EPUB chapters, laid out on pages ----------

/** A4 at 96 px to the inch, as CSS lays it out. */
const PAGE = { w: 794, h: 1123, margin: 56 };
const CONTENT_W = PAGE.w - 2 * PAGE.margin;
const CONTENT_H = PAGE.h - 2 * PAGE.margin;
/** Drawn at twice the CSS size, for print. */
const SCALE = 2;

/**
 * Where a chapter's pages end, in CSS pixels down it: as near a page's
 * height as can be without cutting a line, a picture or a table row in two
 * (unless one is taller than a page). `spans` are the [top, bottom] of
 * everything that must not be cut.
 */
export function pageBreaks(height: number, spans: [number, number][], pageH = CONTENT_H): number[] {
  const breaks: number[] = [];
  const inside = (y: number) => spans.some(([top, bottom]) => top < y - 0.5 && y + 0.5 < bottom);
  let y = 0;
  while (y < height - 1) {
    let end = Math.min(height, y + pageH);
    if (end < height) {
      // The lowest place at or above the page's foot that cuts nothing, and
      // not so high that the page is half empty.
      const candidates = spans.map(([, bottom]) => bottom).filter((b) => b <= end && b > y + pageH * 0.5).sort((a, b) => b - a);
      const fit = [end, ...candidates].find((c) => !inside(c));
      end = fit ?? end;
    }
    breaks.push(end);
    y = end;
  }
  return breaks;
}

/** Lays one chapter's HTML out at the page's width, off screen; resolves its document, its height and what must not be cut. */
async function layOut(html: string): Promise<{ frame: HTMLIFrameElement; doc: Document; height: number; spans: [number, number][] }> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-${CONTENT_W + 100}px;top:0;width:${CONTENT_W}px;height:200px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  // On paper: black on white, the reader's own padding gone.
  const style = doc.createElement("style");
  style.textContent = `html, body { background: #fff !important; color: #111 !important; }
    body { padding: 0 !important; margin: 0 !important; font-size: 15px; }`;
  doc.head.appendChild(style);
  // Every picture loaded (or failed), so the layout is final before it is measured.
  await Promise.all(
    [...doc.images].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((done) => {
            img.addEventListener("load", () => done(), { once: true });
            img.addEventListener("error", () => done(), { once: true });
          }),
    ),
  );
  await doc.fonts?.ready;
  const height = Math.ceil(doc.documentElement.scrollHeight);
  const spans: [number, number][] = [];
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  for (const r of range.getClientRects()) if (r.height > 0) spans.push([r.top, r.bottom]);
  for (const el of doc.querySelectorAll("img, svg, tr, pre, figure")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) spans.push([r.top, r.bottom]);
  }
  return { frame, doc, height, spans };
}

/** One page of a laid-out chapter, from `top` to `bottom`, drawn on white A4 at print size. */
async function drawPage(doc: Document, height: number, top: number, bottom: number): Promise<Blob> {
  const markup = new XMLSerializer().serializeToString(doc.documentElement);
  const h = bottom - top;
  // The whole chapter in the SVG, its view the page's part of it, at twice the
  // size. Read from a data: address, not a blob: one: from a blob, an SVG
  // holding HTML marks the canvas it is drawn on as unreadable.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTENT_W * SCALE}" height="${h * SCALE}" viewBox="0 ${top} ${CONTENT_W} ${h}">
    <foreignObject x="0" y="0" width="${CONTENT_W}" height="${height}">${markup}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w * SCALE;
  canvas.height = PAGE.h * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, PAGE.margin * SCALE, PAGE.margin * SCALE);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("A page could not be drawn."))), "image/jpeg", 0.9));
}

/** The chosen chapters, each laid out on A4 pages, as one PDF. `progress` says how far it has got. */
export async function epubPages(chapters: string[], title: string, progress: (done: number, total: number) => void = () => {}): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (let c = 0; c < chapters.length; c++) {
    const { frame, doc, height, spans } = await layOut(chapters[c]);
    try {
      let top = 0;
      for (const bottom of pageBreaks(height, spans)) {
        const jpeg = await (await drawPage(doc, height, top, bottom)).arrayBuffer();
        const image = await out.embedJpg(jpeg);
        // A4 in points.
        const page = out.addPage([595.28, 841.89]);
        page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
        top = bottom;
      }
    } finally {
      frame.remove();
    }
    progress(c + 1, chapters.length);
  }
  finish(out, title);
  return out.save();
}
