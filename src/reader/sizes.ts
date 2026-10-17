/**
 * A pattern's sizes, read from its text: "Sizes: XS (S, M, L)" for their
 * names, and every "100 (110, 120, 130)" for the numbers of each size, so
 * the size knitted can be marked as it is read and the others dimmed.
 *
 * Text comes as search reads it (lower-cased, whitespace collapsed), so the
 * places found here are places in a page's search text. Pure, so the harness
 * checks it directly.
 */

/** A number as patterns write one: 100, 2.5, 2,5, 1½. */
const NUMBER = String.raw`\d+(?:[.,]\d{1,2}(?!\d))?(?:\s?[½¼¾])?|[½¼¾]`;
/** One size's number in a run: a number, or a dash for a size that has none. */
const ITEM = String.raw`(?:${NUMBER}|[-–—])`;
/** A run: the first size's number, the others in brackets after it. */
const RUN = new RegExp(String.raw`(?<![\w.,/½¼¾])(?:${NUMBER})\s?\(\s?${ITEM}(?:\s?[,;]\s?${ITEM})*\s?\)`, "g");
const ITEMS = new RegExp(ITEM, "g");

/** One size's number in a run: where it is in the text. */
export interface SizeItem {
  start: number;
  end: number;
}

/** Every run of sizes' numbers in a text, each as its numbers' places in order. */
export function sizeRuns(text: string): SizeItem[][] {
  const runs: SizeItem[][] = [];
  for (const m of text.matchAll(RUN)) {
    const at = m.index ?? 0;
    const items: SizeItem[] = [];
    // The first number, then each in the brackets.
    const open = m[0].indexOf("(");
    const first = m[0].slice(0, open).trimEnd();
    items.push({ start: at, end: at + first.length });
    for (const i of m[0].slice(open + 1).matchAll(ITEMS)) {
      const start = at + open + 1 + (i.index ?? 0);
      items.push({ start, end: start + i[0].length });
    }
    runs.push(items);
  }
  return runs;
}

/** A size's name: XS, 2XL, 86, 6-12m. */
const NAME = String.raw`[a-z0-9]{1,5}(?:[-–/][a-z0-9]{1,5})?`;
const NAMES = new RegExp(String.raw`\bsizes?\b[^a-z0-9(]{0,12}(${NAME})\s?\(\s?(${NAME}(?:\s?[,;]\s?${NAME})*)\s?\)`);

/** The sizes a text names, after "Sizes": "XS (S, M, L)"; null when it names none. */
export function sizeNames(text: string): string[] | null {
  const m = NAMES.exec(text);
  if (!m) return null;
  const names = [m[1], ...m[2].split(/\s?[,;]\s?/)].map((n) => n.trim()).filter(Boolean);
  // Letters as sizes are written: XS, 2XL; numbers as they are.
  return names.length > 1 ? names.map((n) => (/[a-z]/.test(n) && n.length <= 4 ? n.toUpperCase() : n)) : null;
}

/**
 * A pattern's sizes, from its pages' texts: their names where it gives them,
 * and how many there are. Without names, the number of sizes is the commonest
 * length of its runs, met three times at least, so one stray "(see 2)" is not
 * taken for sizes. None found: no names and a count of 0.
 */
export function sizesOf(pages: string[]): { names: string[] | null; count: number } {
  for (const text of pages) {
    const names = sizeNames(text);
    if (names) return { names, count: names.length };
  }
  const lengths = new Map<number, number>();
  for (const text of pages) for (const run of sizeRuns(text)) lengths.set(run.length, (lengths.get(run.length) ?? 0) + 1);
  const [count, seen] = [...lengths].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
  return { names: null, count: seen >= 3 ? count : 0 };
}

/** A size as the picker says it: its name, or its place. */
export function sizeLabel(index: number, names: string[] | null): string {
  if (names?.[index]) return names[index];
  const n = index + 1;
  const th = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${th} size`;
}
