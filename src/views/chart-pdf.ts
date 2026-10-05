/**
 * A colourwork chart as a PDF, drawn as shapes rather than a picture: every
 * square is a filled rectangle a set size in millimetres, so the print is
 * sharp at any zoom and measures what it says. "As knitted" makes each square
 * the size of a stitch at the chart's gauge, so the printed chart is the
 * knitting's real size.
 *
 * A chart too big for one page goes over several, each with its own stitch
 * and row numbers, from row 1 and stitch 1 (the bottom right) on. The legend
 * follows the chart, then the rows in words.
 *
 * The file is written by hand, as `export.rs` writes the reader's: two
 * standard fonts (Helvetica, which every reader has, so nothing is embedded),
 * and a compressed content stream per page.
 */
import { zlibSync } from "fflate";
import { describe, readingNote, writeOut, type Grid } from "./chart";
import { drawChart, drawLegend, knittedAspect, margins, Measurer, type Painter } from "./chart-draw";

const MM = 72 / 25.4;

export const PAPERS = {
  a4: { label: "A4", w: 210 * MM, h: 297 * MM },
  letter: { label: "Letter", w: 8.5 * 72, h: 11 * 72 },
};
export type Paper = keyof typeof PAPERS;

export interface PdfOptions {
  paper: Paper;
  /** A square's size in mm, "knitted" for a stitch's at the gauge, or "fit" for the whole chart on one page. */
  squares: number | "knitted" | "fit";
  words: boolean;
}

/** Helvetica's widths, in thousandths of the size, for the printable ASCII from the space on. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** WinAnsi codes for what is outside Latin-1 but common in text. */
const WIN_ANSI: Record<string, number> = { "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85 };

/** The text as WinAnsi bytes, one character each: what Helvetica in a PDF can show. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/→/g, "->").replace(/×/g, "x")) {
    const code = ch.codePointAt(0)!;
    if (WIN_ANSI[ch]) out.push(WIN_ANSI[ch]);
    else if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(0x3f);
  }
  return out;
}

function width(text: string, size: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const code of winAnsi(text)) w += code >= 32 && code < 127 ? table[code - 32] : bold ? 611 : 556;
  return (w * size) / 1000;
}

/** A PDF string literal, every byte outside printable ASCII escaped. */
function literal(text: string): string {
  let s = "(";
  for (const b of winAnsi(text)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) s += `\\${b.toString(8).padStart(3, "0")}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function rgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n(c / 255)).join(" ");
}

/** One page being drawn: the painter's top-left coordinates turned into the PDF's bottom-left. */
class PdfPage implements Painter {
  ops: string[] = [];
  constructor(readonly w: number, readonly h: number) {}

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.ops.push(`${rgb(fill)} rg ${n(x)} ${n(this.h - y - h)} ${n(w)} ${n(h)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.ops.push(`${rgb(colour)} RG ${n(lw)} w ${n(x1)} ${n(this.h - y1)} m ${n(x2)} ${n(this.h - y2)} l S`);
  }

  poly(points: [number, number][], colour: string, fill: boolean, lw = 1): void {
    const path = points.map(([x, y], i) => `${n(x)} ${n(this.h - y)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(fill ? `${rgb(colour)} rg ${path} h f` : `${rgb(colour)} RG ${n(lw)} w ${path} h S`);
  }

  text(x: number, y: number, text: string, size: number, colour: string, align: "left" | "center" | "right" = "left", bold = false): void {
    const w = width(text, size, bold);
    const left = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
    // Centred on y: the baseline sits about a third of the size below the middle.
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${rgb(colour)} rg ${n(left)} ${n(this.h - y - size * 0.35)} Td ${literal(text)} Tj ET`);
  }

  measure(text: string, size: number, bold = false): number {
    return width(text, size, bold);
  }
}

/** Assembles the pages into a file. */
function pdfFile(title: string, pages: PdfPage[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    at += b.length;
  };
  const ascii = (s: string) => push(enc.encode(s));
  const object = (num: number, body: string, stream?: Uint8Array) => {
    offsets[num] = at;
    ascii(`${num} 0 obj\n${body}\n`);
    if (stream) {
      ascii("stream\n");
      push(stream);
      ascii("\nendstream\n");
    }
    ascii("endobj\n");
  };
  // 1 catalog, 2 page tree, 3 and 4 the fonts, 5 information; then a page and its content each.
  const pageObj = (i: number) => 6 + i * 2;
  ascii("%PDF-1.4\n");
  // A comment of bytes past ASCII marks the file as binary, which some tools otherwise mangle.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  object(5, `<< /Title ${literal(title)} /Producer (Shiny Knitting) >>`);
  pages.forEach((p, i) => {
    object(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    const content = zlibSync(enc.encode(p.ops.join("\n")));
    object(pageObj(i) + 1, `<< /Length ${content.length} /Filter /FlateDecode >>`, content);
  });
  const count = 6 + pages.length * 2;
  const xref = at;
  ascii(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) ascii(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  ascii(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(at);
  let k = 0;
  for (const part of parts) {
    out.set(part, k);
    k += part.length;
  }
  return out;
}

/** Splits `total` into `parts` near-equal runs. */
function split(total: number, per: number): [number, number][] {
  const parts = Math.max(1, Math.ceil(total / per));
  const size = Math.ceil(total / parts);
  const out: [number, number][] = [];
  for (let a = 0; a < total; a += size) out.push([a, Math.min(total, a + size)]);
  return out;
}

/** The square size, in points, for the options; and whether that was what was asked. */
export function squareSize(g: Grid, o: PdfOptions): { cw: number; ch: number } {
  if (o.squares === "knitted" && g.gauge.sts > 0 && g.gauge.rows > 0) return { cw: (100 / g.gauge.sts) * MM, ch: (100 / g.gauge.rows) * MM };
  if (typeof o.squares === "number") return { cw: o.squares * MM, ch: o.squares * MM };
  // Fit: the largest square, up to 8 mm, with the chart on one page.
  const paper = PAPERS[o.paper];
  const aspect = o.squares === "knitted" ? knittedAspect(g) : 1;
  const usableW = paper.w - 2 * MARGIN - 30;
  const usableH = paper.h - 2 * MARGIN - 70 - 70;
  const ch = Math.max(1.5 * MM, Math.min(8 * MM, usableH / g.height, usableW / (g.width * aspect)));
  return { cw: ch * aspect, ch };
}

const MARGIN = 12 * MM;

/**
 * The chart as a PDF: its pages of squares, the legend, and the rows in
 * words if asked for.
 */
export function chartPdf(name: string, g: Grid, o: PdfOptions): Uint8Array<ArrayBuffer> {
  const paper = PAPERS[o.paper];
  const { cw, ch } = squareSize(g, o);
  const m = margins(g, cw, ch);
  const pages: PdfPage[] = [];
  const headerFirst = 44;
  const headerNext = 26;
  const availW = paper.w - 2 * MARGIN - m.left - m.right;
  const availH = paper.h - 2 * MARGIN - headerFirst - m.bottom - 6;
  // Rows from the bottom first, and stitches from the right: where knitting starts.
  const rowParts = split(g.height, Math.max(1, Math.floor(availH / ch)));
  const colParts = split(g.width, Math.max(1, Math.floor(availW / cw))).reverse();
  const total = rowParts.length * colParts.length;
  const sizeNote =
    o.squares === "knitted" && g.gauge.sts > 0
      ? `Squares as knitted at ${g.gauge.sts} sts and ${g.gauge.rows} rows in 10 cm: the real size`
      : `Squares ${n(cw / MM)} mm`;
  let last: { page: PdfPage; bottom: number } | null = null;
  for (const rows of rowParts) {
    for (const cols of colParts) {
      const page = new PdfPage(paper.w, paper.h);
      pages.push(page);
      let y = MARGIN;
      if (pages.length === 1) {
        page.text(MARGIN, y + 7, name, 15, "#1a1a1a", "left", true);
        page.text(MARGIN, y + 23, `${describe(g)}.`, 8.5, "#444444");
        page.text(MARGIN, y + 34, `${sizeNote}.${total > 1 ? ` On ${total} pages.` : ""}`, 8.5, "#444444");
        y += headerFirst;
      } else {
        page.text(MARGIN, y + 7, `${name}, continued`, 11, "#1a1a1a", "left", true);
        y += headerNext;
      }
      const tileW = (cols[1] - cols[0]) * cw;
      if (total > 1) {
        page.text(paper.w - MARGIN, MARGIN + 7, `Page ${pages.length} of ${total}: stitches ${g.width - cols[1] + 1}–${g.width - cols[0]}, rows ${rows[0] + 1}–${rows[1]}`, 8.5, "#444444", "right");
      }
      const x = MARGIN + m.left + Math.max(0, (availW - tileW) / 2);
      drawChart(page, g, { x, y, cw, ch, cols, rows, numbers: true, line: 0.35 });
      last = { page, bottom: y + (rows[1] - rows[0]) * ch + m.bottom };
    }
  }

  // The legend, under the last of the chart if it fits there.
  const legendSize = 9;
  const legendW = paper.w - 2 * MARGIN;
  const legendH = drawLegend(new Measurer(last!.page), g, 0, 0, legendW, legendSize) + 20;
  let page = last!.page;
  let y = last!.bottom + 14;
  if (y + legendH > paper.h - MARGIN) {
    page = new PdfPage(paper.w, paper.h);
    pages.push(page);
    y = MARGIN;
  }
  page.text(MARGIN, y + 5, "Colours", 10, "#1a1a1a", "left", true);
  y += 16;
  y += drawLegend(page, g, MARGIN, y, legendW, legendSize);
  y = writeParagraphs(pages, page, y + 8, [readingNote(g), ...(g.notes.trim() ? g.notes.trim().split(/\n+/) : [])], 8.5, paper);

  if (o.words) {
    const words = new PdfPage(paper.w, paper.h);
    pages.push(words);
    words.text(MARGIN, MARGIN + 7, `${name}: in words`, 13, "#1a1a1a", "left", true);
    writeParagraphs(pages, words, MARGIN + 24, writeOut(g).map((r) => `${r.label}: ${r.text}`), 9, paper, true);
  }
  return pdfFile(name, pages);
}

/**
 * Writes paragraphs down the page, wrapped, going on to new pages as they
 * fill; `hang` indents the lines after a paragraph's first. Returns where
 * the writing ended on the last page.
 */
function writeParagraphs(pages: PdfPage[], page: PdfPage, y: number, paragraphs: string[], size: number, paper: { w: number; h: number }, hang = false): number {
  const lineH = size * 1.4;
  const full = paper.w - 2 * MARGIN;
  for (const para of paragraphs) {
    const lines = wrap(para, size, full, hang ? full - size * 2 : full);
    lines.forEach((text, i) => {
      if (y + lineH > paper.h - MARGIN) {
        page = new PdfPage(paper.w, paper.h);
        pages.push(page);
        y = MARGIN;
      }
      page.text(MARGIN + (hang && i ? size * 2 : 0), y + lineH / 2, text, size, "#1a1a1a");
      y += lineH;
    });
    y += size * 0.5;
  }
  return y;
}

/** Breaks text into lines no wider than given, at spaces (or anywhere, for a word wider than a line). */
function wrap(text: string, size: number, first: number, rest: number): string[] {
  const lines: string[] = [];
  let line = "";
  const limit = () => (lines.length ? rest : first);
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (width(tryLine, size) <= limit()) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (width(line, size) > limit()) {
      let cut = line.length - 1;
      while (cut > 1 && width(line.slice(0, cut), size) > limit()) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}
