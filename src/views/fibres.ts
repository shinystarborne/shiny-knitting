import type { Fibre } from "../api";

/**
 * What yarn is made of: the fibres offered in the yarn form, what kind each
 * one is, and how a fibre content reads on a card.
 *
 * The kinds are for the stash's filter -- "only animal fibres", "no animal
 * fibres" for someone who cannot wear wool, "no synthetics". A fibre typed in
 * that is not on the list has no kind, and counts as neither.
 */
export type FibreKind = "animal" | "plant" | "synthetic";

export const FIBRES: { name: string; kind: FibreKind }[] = [
  { name: "wool", kind: "animal" },
  { name: "merino", kind: "animal" },
  { name: "alpaca", kind: "animal" },
  { name: "mohair", kind: "animal" },
  { name: "kid mohair", kind: "animal" },
  { name: "silk", kind: "animal" },
  { name: "cashmere", kind: "animal" },
  { name: "yak", kind: "animal" },
  { name: "camel", kind: "animal" },
  { name: "llama", kind: "animal" },
  { name: "angora", kind: "animal" },
  { name: "possum", kind: "animal" },
  { name: "qiviut", kind: "animal" },
  { name: "cotton", kind: "plant" },
  { name: "linen", kind: "plant" },
  { name: "hemp", kind: "plant" },
  { name: "bamboo", kind: "plant" },
  { name: "viscose", kind: "plant" },
  { name: "lyocell", kind: "plant" },
  { name: "modal", kind: "plant" },
  { name: "acrylic", kind: "synthetic" },
  { name: "polyamide", kind: "synthetic" },
  { name: "nylon", kind: "synthetic" },
  { name: "polyester", kind: "synthetic" },
  { name: "elastane", kind: "synthetic" },
  { name: "metallic", kind: "synthetic" },
];

/** Other names for the same fibre, as ball bands print them. */
const ALIASES: Record<string, string> = {
  "virgin wool": "wool",
  "new wool": "wool",
  "lambswool": "wool",
  "merino wool": "merino",
  "superfine alpaca": "alpaca",
  "baby alpaca": "alpaca",
  "mulberry silk": "silk",
  "tussah silk": "silk",
  "polyamid": "polyamide",
  "pa": "polyamide",
  "tencel": "lyocell",
  "rayon": "viscose",
  "spandex": "elastane",
  "lurex": "metallic",
};

/** The kind of a fibre, by its name in any case; undefined for one not on the list. */
export function fibreKind(name: string): FibreKind | undefined {
  const key = name.trim().toLowerCase();
  const known = ALIASES[key] ?? key;
  return FIBRES.find((f) => f.name === known)?.kind ?? (/wool|merino|alpaca|mohair|silk|cashmere/.test(key) ? "animal" : undefined);
}

/** "75% wool · 25% polyamide", the biggest share first; empty when nothing is recorded. */
export function describeFibres(fibres: Fibre[]): string {
  return [...fibres]
    .sort((a, b) => b.percent - a.percent)
    .map((f) => (f.percent ? `${trimNumber(f.percent)}% ${f.name}` : f.name))
    .join(" · ");
}

/** What the shares add up to. */
export function fibreTotal(fibres: Fibre[]): number {
  return Math.round(fibres.reduce((n, f) => n + (f.percent || 0), 0) * 10) / 10;
}

/**
 * A fibre content as a ball band writes it -- "75% wool, 25% polyamide",
 * "Wolle 80 %, Polyamid 20 %", "100% merino" -- as fibres. Parts without a
 * share are kept with none.
 */
export function parseFibres(text: string): Fibre[] {
  const out: Fibre[] = [];
  for (const part of text.split(/[,;/+·]|\band\b/i)) {
    const p = part.trim();
    if (!p) continue;
    const before = /^(\d+(?:[.,]\d+)?)\s*%\s*(.+)$/.exec(p);
    const after = /^(.+?)\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(p);
    const [percent, name] = before ? [before[1], before[2]] : after ? [after[2], after[1]] : ["", p];
    const clean = name.trim().toLowerCase();
    if (!clean) continue;
    out.push({ name: ALIASES[clean] ?? clean, percent: percent ? Number(percent.replace(",", ".")) : 0 });
  }
  return out;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
