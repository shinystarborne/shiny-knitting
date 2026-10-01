/**
 * Yarn weights in the frontend: the cheat sheet, and the hints in the yarn
 * form that say which weight a ball band's figures or a cone's count make.
 *
 * The backend decides the family that is stored and filtered on
 * (`src-tauri/src/yarn.rs`); this mirrors its table and its reading of a
 * weight, so what the form says is what the filter will do. The harness
 * checks the two against the same cases.
 */

export interface Weight {
  key: string;
  label: string;
  /** Metres per 100 g: from `min`, up to but not including `max`. */
  min: number;
  max: number;
  /** Other names for it, as written on ball bands and patterns. */
  aka: string;
  /** The needle sizes it is usually knitted on. */
  needles: string;
}

/** Lightest first, as `FAMILIES` in yarn.rs. */
export const WEIGHTS: Weight[] = [
  { key: "lace", label: "Lace", min: 460, max: Infinity, aka: "Cobweb, thread, 1–2 ply", needles: "1.5–2.25 mm" },
  { key: "fingering", label: "Fingering", min: 360, max: 460, aka: "Sock, baby, 3–4 ply", needles: "2.25–3.25 mm" },
  { key: "sport", label: "Sport", min: 300, max: 360, aka: "5 ply", needles: "3.25–3.75 mm" },
  { key: "dk", label: "DK", min: 220, max: 300, aka: "Double knit, 8 ply", needles: "3.75–4.5 mm" },
  { key: "worsted", label: "Worsted", min: 190, max: 220, aka: "Afghan, 10 ply", needles: "4.5–5 mm" },
  { key: "aran", label: "Aran", min: 160, max: 190, aka: "Heavy worsted", needles: "5–5.5 mm" },
  { key: "bulky", label: "Bulky", min: 100, max: 160, aka: "12 ply", needles: "5.5–8 mm" },
  { key: "chunky", label: "Chunky", min: 70, max: 100, aka: "14 ply", needles: "8–9 mm" },
  { key: "super-chunky", label: "Super chunky", min: 40, max: 70, aka: "Super bulky, roving", needles: "9–15 mm" },
  { key: "jumbo", label: "Jumbo", min: 0, max: 40, aka: "Arm knitting", needles: "15 mm and up" },
];

/** As `KEYWORDS` in yarn.rs: specific names first, family names before ply counts. */
const KEYWORDS: [string, string][] = [
  ["super chunky", "super-chunky"],
  ["super-chunky", "super-chunky"],
  ["super bulky", "super-chunky"],
  ["double knit", "dk"],
  ["sock weight", "fingering"],
  ["afghan", "worsted"],
  ["fingering", "fingering"],
  ["finger", "fingering"],
  ["worsted", "worsted"],
  ["chunky", "chunky"],
  ["bulky", "bulky"],
  ["sport", "sport"],
  ["jumbo", "jumbo"],
  ["thread", "lace"],
  ["cobweb", "lace"],
  ["lace", "lace"],
  ["aran", "aran"],
  ["dk", "dk"],
  ["1-ply", "lace"],
  ["1 ply", "lace"],
  ["2-ply", "lace"],
  ["2 ply", "lace"],
  ["3-ply", "fingering"],
  ["3 ply", "fingering"],
  ["4-ply", "fingering"],
  ["4 ply", "fingering"],
  ["5-ply", "sport"],
  ["5 ply", "sport"],
  ["8-ply", "dk"],
  ["8 ply", "dk"],
  ["10-ply", "worsted"],
  ["10 ply", "worsted"],
  ["12-ply", "bulky"],
  ["12 ply", "bulky"],
  ["14-ply", "chunky"],
  ["14 ply", "chunky"],
];

export function familyByMetres(m: number): Weight {
  return WEIGHTS.find((w) => m >= w.min && m < w.max) ?? WEIGHTS[WEIGHTS.length - 1];
}

/** A name in the text, as a whole word. */
function familyByName(text: string): string {
  const lower = text.toLowerCase();
  for (const [word, family] of KEYWORDS) {
    const escaped = word.replace(/[-]/g, "\\-");
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower)) return family;
  }
  return "";
}

/** "230 m/100g", "400 m per 100 g": a metre figure with its unit. */
export function metresPer100g(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*m(?:etres|eters|trs)?\s*(?:\/|per|at)\s*100\s*g/);
  return m ? Math.round(parseFloat(m[1])) : null;
}

/**
 * A cone's count as metres per 100 g: "2/28" is two strands of 28 m to the
 * gram, so 1400 m/100 g; "2/2800" gives the single strand per 100 g and is
 * the same yarn. As `cone_count` in yarn.rs.
 */
export function coneCount(text: string): number | null {
  const re = /(^|[^\d.,])(\d+)\s*\/\s*(\d+)(?![\d.,])\s*([a-z]*)/gi;
  for (const m of text.toLowerCase().matchAll(re)) {
    const strands = Number(m[2]);
    const count = Number(m[3]);
    const unit = m[4];
    if (["m", "g", "kg", "gr", "mtr", "mtrs", "metres", "meters", "gram", "grams", "yd", "yds"].includes(unit)) continue;
    if (strands < 1 || strands > 12) continue;
    const per100g = count >= 100 ? count : count >= 5 ? count * 100 : null;
    if (per100g === null) continue;
    return Math.round(per100g / strands);
  }
  return null;
}

/** The family a weight as written falls in, as the backend will file it; "" when none. */
export function familyOf(text: string): string {
  const named = familyByName(text);
  if (named) return named;
  const m = metresPer100g(text) ?? coneCount(text);
  return m === null ? "" : familyByMetres(m).key;
}

export function weightLabel(key: string): string {
  return WEIGHTS.find((w) => w.key === key)?.label ?? "";
}

/** "1 400" for 1400: a figure read at a glance. */
export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
