/**
 * Needle sizes in the frontend: the table the sidebar's labels come from,
 * and the reading of a pattern's free-text size into canonical mm keys.
 *
 * The backend decides the sizes that are stored and filtered on
 * (src-tauri/src/needle_size.rs); this mirrors its table and its reading of a
 * size, so what the sidebar shows is what the filter will do. The harness
 * checks the two against the same cases.
 */

/** Millimetres to the US needle number, as `MM_TO_US` in needle_size.rs. */
export const MM_TO_US: [number, string][] = [
  [1.5, "000"],
  [1.75, "00"],
  [2, "0"],
  [2.25, "1"],
  [2.75, "2"],
  [3.25, "3"],
  [3.5, "4"],
  [3.75, "5"],
  [4, "6"],
  [4.5, "7"],
  [5, "8"],
  [5.5, "9"],
  [6, "10"],
  [6.5, "10.5"],
  [7, "10.75"],
  [8, "11"],
  [9, "13"],
  [10, "15"],
  [12.75, "17"],
  [16, "19"],
  [19, "35"],
  [25, "50"],
];

/** US crochet hook letters to millimetres, as `US_HOOK_TO_MM` in needle_size.rs. */
export const US_HOOK_TO_MM: Record<string, number> = {
  B: 2.25,
  C: 2.75,
  D: 3.25,
  E: 3.5,
  F: 3.75,
  G: 4,
  H: 5,
  I: 5.5,
  J: 6,
  K: 6.5,
  L: 8,
  M: 9,
  N: 9,
  P: 10,
  Q: 16,
  S: 19,
};

/** US needle number to millimetres: `MM_TO_US` the other way round. */
const US_NUMBER_TO_MM = new Map(MM_TO_US.map(([mm, us]) => [us, mm]));

export type NeedleSizeFormat = "metric" | "us" | "both";

function number(text: string): number {
  return parseFloat(text.replace(",", "."));
}

/** A number as the US table spells it: "6.0" and "10.50" are "6" and "10.5". */
function tableForm(text: string): string {
  const t = text.replace(",", ".");
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}

/**
 * The canonical mm keys a size as written means, smallest first, each once.
 *
 * As `sizes_of` in needle_size.rs: stated millimetres first; then US needle
 * numbers and hook letters through the tables; bare numbers only when nothing
 * else was found and the text is not about cable lengths or UK sizes. A
 * range with one unit ("3.5–4 mm") is both sizes, and "US size 8" is US 8. Where a stated mm
 * and a US number disagree ("3.5mm / US 5", a common mismatch between the
 * conventions) the stated mm is kept; where a hook letter and a stated mm
 * disagree ("5mm / US I") the letter wins, because hooks are bought by letter.
 */
export function sizesOf(text: string): string[] {
  const mm: number[] = [];
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*mm/gi)) mm.push(number(m[1]));
  // A range shares one unit: "3.5–4 mm" and "3.5 to 4mm" are both sizes.
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?\s*mm/gi)) mm.push(number(m[1]));

  const hooks: number[] = [];
  // A letter needs something between it and the US -- "US H", "US-H" -- or
  // the "us" of "use" would read as hook E.
  for (const m of text.matchAll(/\bus[\s.-]+([a-z])(?:\s*[-/]\s*\d+)?(?![a-z0-9])/gi)) {
    const v = US_HOOK_TO_MM[m[1].toUpperCase()];
    if (v !== undefined) hooks.push(v);
  }

  const numbers: number[] = [];
  // "US 8", "US8" and "US size 8" alike.
  for (const m of text.matchAll(/\bus\s*(?:size\s*)?(\d+(?:[.,]\d+)?)/gi)) {
    const v = US_NUMBER_TO_MM.get(tableForm(m[1]));
    if (v !== undefined) numbers.push(v);
  }

  const bare: number[] = [];
  // Not for UK sizes either: they run the other way (UK 10 is 3.25 mm), and
  // no reading is better than a wrong one.
  if (!mm.length && !hooks.length && !numbers.length && !/cm/i.test(text) && !/\buk\b/i.test(text)) {
    for (const m of text.matchAll(/(?<![\w.,])\d+(?:[.,]\d+)?(?![\w.,])/g)) {
      const v = number(m[0]);
      if (v > 0 && v <= 30) bare.push(v);
    }
  }

  // Two sizes within half a millimetre of each other are the same needle in
  // two conventions, not two needles; the winner depends on where each came
  // from, as above.
  const keptMm = mm.filter((m) => !hooks.some((h) => h !== m && Math.abs(h - m) <= 0.5));
  const keptNumbers = numbers.filter(
    (n) => !mm.some((m) => Math.abs(m - n) <= 0.5) && !hooks.some((h) => Math.abs(h - n) <= 0.5),
  );

  // The table sizes are all exact in binary floating point, so `String` is
  // the canonical form: trailing zeros are already gone ("4.0" reads as 4).
  const seen = new Set<string>();
  const values: number[] = [];
  for (const v of [...keptMm, ...hooks, ...keptNumbers, ...bare]) {
    const key = String(v);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(v);
    }
  }
  return values.sort((a, b) => a - b).map(String);
}

/** The US needle number for a canonical mm key, or "" when there is none. */
export function usLabel(key: string): string {
  const mm = parseFloat(key);
  return MM_TO_US.find(([m]) => m === mm)?.[1] ?? "";
}

/** "4 mm" for the canonical key "4". */
export function mmLabel(key: string): string {
  return `${key} mm`;
}

/**
 * One size in the sidebar, as the display setting asks for it: metric as
 * "4 mm", US as "US 6" (the mm label when a size has no US number), both as
 * "4 mm / US 6".
 */
export function sizeLabel(mm: string, us: string, format: NeedleSizeFormat): string {
  if (format === "metric") return mm;
  if (format === "us") return us ? `US ${us}` : mm;
  return us ? `${mm} / US ${us}` : mm;
}
