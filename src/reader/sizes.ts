/**
 * A pattern's sizes, read from its text: "Sizes: XS (S, M, L)" for their
 * names, and every "100 (110, 120, 130)" for the numbers of each size, so
 * the size knitted can be marked as it is read and the others dimmed. Many
 * sizes run on past the brackets: "84 (84, 84, 88) 96, 96 [100, 100, 100]
 * 104" is ten.
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

/** What may follow a run's brackets: a bracketed group of its numbers, or one more on its own. */
const GROUP = new RegExp(String.raw`\s?[\[(]\s?${ITEM}(?:\s?[,;]\s?${ITEM})*\s?[\])]`, "y");
const BARE = new RegExp(String.raw`\s?[,;]?\s?(?:${NUMBER})(?![\w½¼¾])`, "y");

/** One size's number in a run: where it is in the text. */
export interface SizeItem {
  start: number;
  end: number;
}

/** A run of sizes' numbers, and the counts it could end at: after its first brackets, and after each part after them. */
export type SizeRun = SizeItem[] & { cuts: number[] };

/** Every run of sizes' numbers in a text, each as its numbers' places in order. */
export function sizeRuns(text: string): SizeRun[] {
  const runs: SizeRun[] = [];
  RUN.lastIndex = 0;
  for (let m = RUN.exec(text); m; m = RUN.exec(text)) {
    const at = m.index;
    const items: SizeItem[] = [];
    const take = (from: number, part: string) => {
      for (const i of part.matchAll(ITEMS)) {
        const start = from + (i.index ?? 0);
        items.push({ start, end: start + i[0].length });
      }
    };
    // The first number, then each in the brackets.
    const open = m[0].indexOf("(");
    const first = m[0].slice(0, open).trimEnd();
    items.push({ start: at, end: at + first.length });
    take(at + open + 1, m[0].slice(open + 1));
    const cuts = [items.length];
    // Then more: bracketed groups, and numbers between them, as far as they go.
    let end = at + m[0].length;
    for (;;) {
      let part: RegExpExecArray | null = null;
      for (const re of [GROUP, BARE]) {
        re.lastIndex = end;
        part = re.exec(text);
        if (part) break;
      }
      if (!part) break;
      take(end, part[0]);
      end += part[0].length;
      cuts.push(items.length);
    }
    RUN.lastIndex = end;
    runs.push(Object.assign(items, { cuts }));
  }
  return runs;
}

/**
 * A run as one of `count` sizes: the whole of it, or as far as it can end
 * at that count (a "2 times" after "100 (110, 120, 130)" is not a fifth
 * size). Null when it is not one.
 */
export function runOf(run: SizeRun, count: number): SizeItem[] | null {
  if (run.length === count) return run;
  return run.cuts.includes(count) ? run.slice(0, count) : null;
}

/** A size's name: XS, 2XL, 86, 6-12m. */
const NAME = String.raw`[a-z0-9]{1,5}(?:[-–/][a-z0-9]{1,5})?`;
const NAMES = new RegExp(String.raw`\bsizes?\b[^a-z0-9(]{0,12}(${NAME})\s?\(\s?(${NAME}(?:\s?[,;]\s?${NAME})*)\s?\)`, "y");
/** A size's name on its own, between brackets: one that can only be a size (XL, 2XL, 86, 6-12m), not a word. */
const SIZE_WORD = String.raw`(?:\d*x{0,4}[sml]|\d+(?:[-–/]\d+)?[a-z]{0,2})`;
const NAME_GROUP = new RegExp(String.raw`\s?[\[(]\s?(${NAME}(?:\s?[,;]\s?${NAME})*)\s?[\])]`, "y");
const NAME_BARE = new RegExp(String.raw`\s?[,;]?\s?(${SIZE_WORD})(?![a-z0-9])`, "y");

/**
 * The sizes a text names, after "Sizes": "XS (S, M, L)", and on past the
 * brackets, "XS (S, M, L) XL, 2XL [3XL, 4XL]"; null when it names none.
 */
export function sizeNames(text: string): string[] | null {
  let m: RegExpExecArray | null = null;
  for (let at = text.search(/\bsizes?\b/); at >= 0 && !m; ) {
    NAMES.lastIndex = at;
    m = NAMES.exec(text);
    if (m) break;
    const next = text.slice(at + 1).search(/\bsizes?\b/);
    at = next < 0 ? -1 : at + 1 + next;
  }
  if (!m) return null;
  const found = [m[1], ...m[2].split(/\s?[,;]\s?/)];
  // On past the brackets: kept up to the last group, and one size after it.
  let end = m.index + m[0].length;
  let kept = found.length;
  let afterGroup = 0;
  for (;;) {
    NAME_GROUP.lastIndex = end;
    const group = NAME_GROUP.exec(text);
    if (group) {
      found.push(...group[1].split(/\s?[,;]\s?/));
      end += group[0].length;
      kept = found.length;
      afterGroup = 0;
      continue;
    }
    NAME_BARE.lastIndex = end;
    const bare = NAME_BARE.exec(text);
    if (!bare) break;
    found.push(bare[1]);
    end += bare[0].length;
    if (++afterGroup === 1) kept = found.length;
  }
  const names = found.slice(0, kept).map((n) => n.trim()).filter(Boolean);
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
  for (const text of pages) for (const run of sizeRuns(text)) for (const n of new Set([run.length, ...run.cuts])) lengths.set(n, (lengths.get(n) ?? 0) + 1);
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
