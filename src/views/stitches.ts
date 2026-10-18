import type { Painter } from "./chart-draw";

/**
 * The stitches of a lace chart, and their symbols: each with what it is
 * written as, worked on a right-side row and on a wrong-side one, how many
 * stitches it takes from the needle and makes, and how it is drawn. The
 * symbols are those most charts use (as the Craft Yarn Council's): a blank
 * square for knit, a dot for purl, a circle for a yarn over, a slash leaning
 * the way a decrease leans. Drawn through a Painter, so the editor, a PDF and
 * a picture show them alike, and as SVG for the glossary.
 */

export interface Stitch {
  key: string;
  /** As a pattern writes it: "k2tog". */
  abbr: string;
  /** In a few words: "Knit 2 together". */
  name: string;
  /** Worked on a wrong-side row, so the right side shows the symbol. */
  ws: string;
  /** Stitches it works off the left needle, and stitches it leaves on the right. */
  takes: number;
  makes: number;
  /** The abbreviation in the glossary it is, for its meaning and a video. */
  glossary?: string;
  draw(p: Painter, cx: number, cy: number, size: number, ink: string): void;
}

/** A square with no stitch: a gap in a row whose stitches have been decreased away, or are yet to be made. */
export const NO_STITCH_KEY = "none";

const circle = (cx: number, cy: number, r: number, n = 20): [number, number][] =>
  Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);

/** The line width, and the arm's reach, for a square of `s`. */
const pen = (s: number) => ({ w: Math.max(0.7, s * 0.085), r: s * 0.3 });

function twisted(p: Painter, cx: number, cy: number, s: number, ink: string): void {
  const { w, r } = pen(s);
  p.poly(circle(cx, cy - r * 0.45, r * 0.42, 14), ink, false, w);
  p.line(cx - r * 0.25, cy - r * 0.1, cx + r * 0.55, cy + r, w, ink);
  p.line(cx + r * 0.25, cy - r * 0.1, cx - r * 0.55, cy + r, w, ink);
}

export const STITCHES: Stitch[] = [
  { key: "knit", abbr: "k", name: "Knit", ws: "p", takes: 1, makes: 1, glossary: "k", draw: () => {} },
  {
    key: "purl", abbr: "p", name: "Purl", ws: "k", takes: 1, makes: 1, glossary: "p",
    draw: (p, cx, cy, s, ink) => p.poly(circle(cx, cy, s * 0.11, 12), ink, true),
  },
  { key: NO_STITCH_KEY, abbr: "no stitch", name: "No stitch", ws: "no stitch", takes: 0, makes: 0, draw: () => {} },
  {
    key: "yo", abbr: "yo", name: "Yarn over", ws: "yo", takes: 0, makes: 1, glossary: "yo",
    draw: (p, cx, cy, s, ink) => p.poly(circle(cx, cy, s * 0.27), ink, false, pen(s).w),
  },
  {
    key: "k2tog", abbr: "k2tog", name: "Knit 2 together", ws: "p2tog", takes: 2, makes: 1, glossary: "k2tog",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy + r, cx + r, cy - r, w, ink);
    },
  },
  {
    key: "ssk", abbr: "ssk", name: "Slip, slip, knit", ws: "ssp", takes: 2, makes: 1, glossary: "ssk",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy - r, cx + r, cy + r, w, ink);
    },
  },
  {
    key: "sk2p", abbr: "sk2p", name: "Slip 1, knit 2 together, pass over", ws: "p3tog tbl", takes: 3, makes: 1, glossary: "sk2p",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy + r, cx, cy - r, w, ink);
      p.line(cx, cy - r, cx + r, cy + r, w, ink);
    },
  },
  {
    key: "cdd", abbr: "cdd", name: "Centred double decrease", ws: "s2pp", takes: 3, makes: 1, glossary: "cdd",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy + r, cx, cy - r, w, ink);
      p.line(cx, cy - r, cx + r, cy + r, w, ink);
      p.line(cx, cy - r, cx, cy + r, w, ink);
    },
  },
  {
    key: "k3tog", abbr: "k3tog", name: "Knit 3 together", ws: "p3tog", takes: 3, makes: 1, glossary: "k3tog",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy + r, cx + r, cy - r, w, ink);
      p.line(cx + r * 0.1, cy + r, cx + r, cy - r, w, ink);
    },
  },
  {
    key: "sssk", abbr: "sssk", name: "Slip, slip, slip, knit", ws: "sssp", takes: 3, makes: 1, glossary: "sssk",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy - r, cx + r, cy + r, w, ink);
      p.line(cx - r, cy - r, cx - r * 0.1, cy + r, w, ink);
    },
  },
  {
    key: "p2tog", abbr: "p2tog", name: "Purl 2 together", ws: "k2tog", takes: 2, makes: 1, glossary: "p2tog",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy + r, cx + r, cy - r, w, ink);
      p.poly(circle(cx + r * 0.55, cy + r * 0.55, s * 0.08, 10), ink, true);
    },
  },
  { key: "ktbl", abbr: "k1tbl", name: "Knit 1 through the back loop", ws: "p1tbl", takes: 1, makes: 1, glossary: "ktbl", draw: twisted },
  {
    key: "ptbl", abbr: "p1tbl", name: "Purl 1 through the back loop", ws: "k1tbl", takes: 1, makes: 1, glossary: "ptbl",
    draw: (p, cx, cy, s, ink) => {
      twisted(p, cx, cy - s * 0.06, s * 0.85, ink);
      p.poly(circle(cx, cy + s * 0.33, s * 0.07, 10), ink, true);
    },
  },
  {
    key: "m1l", abbr: "m1l", name: "Make 1 left", ws: "m1lp", takes: 0, makes: 1, glossary: "m1l",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx, cy + r, cx, cy, w, ink);
      p.line(cx, cy, cx - r, cy - r, w, ink);
    },
  },
  {
    key: "m1r", abbr: "m1r", name: "Make 1 right", ws: "m1rp", takes: 0, makes: 1, glossary: "m1r",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx, cy + r, cx, cy, w, ink);
      p.line(cx, cy, cx + r, cy - r, w, ink);
    },
  },
  {
    key: "kfb", abbr: "kfb", name: "Knit front and back", ws: "pfb", takes: 1, makes: 2, glossary: "kfb",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx, cy + r, cx, cy, w, ink);
      p.line(cx, cy, cx - r, cy - r, w, ink);
      p.line(cx, cy, cx + r, cy - r, w, ink);
    },
  },
  {
    key: "sl1", abbr: "sl1", name: "Slip 1 purlwise", ws: "sl1", takes: 1, makes: 1, glossary: "sl",
    draw: (p, cx, cy, s, ink) => {
      const { w, r } = pen(s);
      p.line(cx - r, cy - r, cx, cy + r, w, ink);
      p.line(cx, cy + r, cx + r, cy - r, w, ink);
    },
  },
  {
    key: "bobble", abbr: "MB", name: "Make bobble", ws: "MB", takes: 1, makes: 1, glossary: "MB",
    draw: (p, cx, cy, s, ink) => p.poly(circle(cx, cy, s * 0.27, 6), ink, true),
  },
];

const BY_KEY = new Map(STITCHES.map((s) => [s.key, s]));

export function stitchOf(key: string | undefined): Stitch | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/**
 * The stitches a new lace chart starts with: knit, its background. The
 * others are all shown to draw with, and taken in as they are chosen.
 */
export const LACE_START = ["knit"];

// ---------- as SVG ----------

/** Draws into an SVG's markup: for a symbol beside its name, in a list or the glossary. */
export class SvgPainter implements Painter {
  parts: string[] = [];
  rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): void {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`);
  }
  poly(points: [number, number][], colour: string, fill: boolean, width = 1): void {
    const d = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    this.parts.push(fill ? `<polygon points="${d}" fill="${colour}"/>` : `<polygon points="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round"/>`);
  }
  text(): void {}
  measure(): number {
    return 0;
  }
}

/** A stitch's symbol in its square, as SVG markup, `size` px each way. */
export function symbolSvg(key: string, size = 22, paper = "#ffffff", grey = "#c4c4c4"): string {
  const s = stitchOf(key);
  const p = new SvgPainter();
  p.rect(0, 0, 24, 24, key === NO_STITCH_KEY ? grey : paper);
  s?.draw(p, 12, 12, 24, "#1a1a1a");
  return `<svg class="stitch-symbol" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${s?.name ?? key}">${p.parts.join("")}<rect x="0.5" y="0.5" width="23" height="23" fill="none" stroke="#3b3b3b" stroke-width="1"/></svg>`;
}
