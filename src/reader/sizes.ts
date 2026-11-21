/**
 * A pattern's sizes, read from its text: "Sizes: XS (S, M, L)" for their
 * names, and every "100 (110, 120, 130)" for the numbers of each size, so
 * the size knitted can be marked as it is read and the others dimmed. Many
 * sizes run on past the brackets: "84 (84, 84, 88) 96, 96 [100, 100, 100]
 * 104" is ten.
 *
 * Both readings go the same way: a head that can only be sizes (a number or
 * a name, then a bracketed list of more), then a tail of more of them past
 * the brackets, taken as far as it goes, by its own rule (runTail, namesTail).
 *
 * Text comes as search reads it (lower-cased, whitespace collapsed), so the
 * places found here are places in a page's search text. Pure, so the harness
 * checks it directly.
 */

/** A list of `item`s: "a, b; c", a space either side of the separator or none. */
const listOf = (item: string) => String.raw`${item}(?:\s?[,;]\s?${item})*`;
/** What parts a list: a comma or semicolon, a space either side or none. */
const SEPARATOR = /\s?[,;]\s?/;

/** A sticky pattern's match exactly at `at`; null when it does not match there. */
function matchAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

// ---- The numbers of each size ----------------------------------------------

/** A number as patterns write one: 100, 2.5, 2,5, 1½. */
const NUMBER = String.raw`\d+(?:[.,]\d{1,2}(?!\d))?(?:\s?[½¼¾])?|[½¼¾]`;
/** One size's number in a run: a number, or a dash for a size that has none. */
const ITEM = String.raw`(?:${NUMBER}|[-–—])`;
const ITEMS = new RegExp(ITEM, "g");
/**
 * A run's head: the first size's number, the others in brackets after it --
 * "100 (110, 120, 130)", "2 (-, 3, 4)". Not inside a word or another number
 * ("12a (14b)", "100,110 (120)"), and not a stitch pattern ("rib (k2, p2)").
 */
const RUN = new RegExp(String.raw`(?<![\w.,/½¼¾])(?:${NUMBER})\s?\(\s?${listOf(ITEM)}\s?\)`, "g");
/** A part of a run's tail: a bracketed group of its numbers, "[100, 100, 100]" or "(9, 9)". */
const GROUP = new RegExp(String.raw`\s?[\[(]\s?${listOf(ITEM)}\s?[\])]`, "y");
/** A part of a run's tail: one number on its own, after a comma or not, ending there: "96", ", 96" -- not "2nd". */
const BARE = new RegExp(String.raw`\s?[,;]?\s?(?:${NUMBER})(?![\w½¼¾])`, "y");

/** One size's number in a run: where it is in the text. */
export interface SizeItem {
  start: number;
  end: number;
}

/** A run of sizes' numbers, and the counts it could end at: after its first brackets, and after each part after them. */
export type SizeRun = SizeItem[] & { cuts: number[] };

/** The numbers in a piece of a run, placed in the text from `from`. */
function itemsIn(piece: string, from: number): SizeItem[] {
  return [...piece.matchAll(ITEMS)].map((i) => {
    const start = from + (i.index ?? 0);
    return { start, end: start + i[0].length };
  });
}

/** A run's head as its numbers: the first, then each in the brackets. */
function headItems(head: RegExpExecArray): SizeItem[] {
  const open = head[0].indexOf("(");
  const first = head[0].slice(0, open).trimEnd();
  return [{ start: head.index, end: head.index + first.length }, ...itemsIn(head[0].slice(open + 1), head.index + open + 1)];
}

/**
 * The parts of a run's tail, from `at`: groups and bare numbers, one after
 * another, as far as they go. "84 (84, 84, 88) 96, 96 [100, 100, 100] 104"
 * has the tail " 96", ", 96", " [100, 100, 100]", " 104". A bare number may
 * be no size at all ("4 (6, 8, 10) 2 times"), so each part is a place the
 * run may end, and the count of sizes decides (runOf).
 */
function runTail(text: string, at: number): { at: number; text: string }[] {
  const parts: { at: number; text: string }[] = [];
  for (let part = matchAt(GROUP, text, at) ?? matchAt(BARE, text, at); part; part = matchAt(GROUP, text, at) ?? matchAt(BARE, text, at)) {
    parts.push({ at, text: part[0] });
    at += part[0].length;
  }
  return parts;
}

/** Every run of sizes' numbers in a text, each as its numbers' places in order. */
export function sizeRuns(text: string): SizeRun[] {
  const runs: SizeRun[] = [];
  RUN.lastIndex = 0;
  for (let head = RUN.exec(text); head; head = RUN.exec(text)) {
    const items = headItems(head);
    const cuts = [items.length];
    let end = head.index + head[0].length;
    for (const part of runTail(text, end)) {
      items.push(...itemsIn(part.text, part.at));
      cuts.push(items.length);
      end = part.at + part.text.length;
    }
    // The next run starts after this one's tail, not inside it.
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

// ---- The sizes' names --------------------------------------------------------

/** The word that brings the names: "size", "sizes". */
const SIZES_WORD = /\bsizes?\b/;
/** A size's name: XS, 2XL, 86, 6-12m. */
const NAME = String.raw`[a-z0-9]{1,5}(?:[-–/][a-z0-9]{1,5})?`;
/**
 * The names' head, at the word: a name, then a bracketed list of more --
 * "sizes: xs (s, m, l)", "size 1 (2, 3)", "finished sizes: s (m, l, 2xl)".
 * Up to 12 characters that are no name may come between ("sizes: ", "size –").
 */
const NAMES = new RegExp(String.raw`\bsizes?\b[^a-z0-9(]{0,12}(${NAME})\s?\(\s?(${listOf(NAME)})\s?\)`, "y");
/** A part of the names' tail: a bracketed group of them, "[3xl, 4xl, 5xl]". */
const NAME_GROUP = new RegExp(String.raw`\s?[\[(]\s?(${listOf(NAME)})\s?[\])]`, "y");
/** A size's name on its own, between brackets: one that can only be a size (XL, 2XL, 86, 6-12m), not a word. */
const SIZE_WORD = String.raw`(?:\d*x{0,4}[sml]|\d+(?:[-–/]\d+)?[a-z]{0,2})`;
/** A part of the names' tail: one name on its own, after a comma or not. */
const NAME_BARE = new RegExp(String.raw`\s?[,;]?\s?(${SIZE_WORD})(?![a-z0-9])`, "y");

/** The first head of names at any "size" or "sizes" in the text; null when there is none. */
function namesHead(text: string): RegExpExecArray | null {
  for (let at = text.search(SIZES_WORD); at >= 0; ) {
    const head = matchAt(NAMES, text, at);
    if (head) return head;
    const next = text.slice(at + 1).search(SIZES_WORD);
    at = next < 0 ? -1 : at + 1 + next;
  }
  return null;
}

/**
 * The names in the tail, from `at`: groups and bare names, as far as they
 * go, kept up to the last group and one bare name after it -- patterns put
 * one size between groups, or one at the end:
 * "xs (s, m, l) xl, 2xl [3xl, 4xl, 5xl] 6xl to fit" has the tail XL, 2XL,
 * [3XL, 4XL, 5XL], 6XL; a second bare name after the last group ("6xl 7xl")
 * is more likely text than a size, so it and what follows are not kept.
 */
function namesTail(text: string, at: number): string[] {
  const found: string[] = [];
  let kept = 0;
  let sinceGroup = 0;
  for (;;) {
    const group = matchAt(NAME_GROUP, text, at);
    if (group) {
      found.push(...group[1].split(SEPARATOR));
      at += group[0].length;
      kept = found.length;
      sinceGroup = 0;
      continue;
    }
    const bare = matchAt(NAME_BARE, text, at);
    if (!bare) break;
    found.push(bare[1]);
    at += bare[0].length;
    if (++sinceGroup === 1) kept = found.length;
  }
  return found.slice(0, kept);
}

/**
 * A name as sizes are written: a letter size in capitals (XS, M, 2XL), any
 * other as it is -- numbers, and ages, "6-12m" and "2-3y" alike.
 */
function sizeCase(name: string): string {
  return /^\d*x{0,4}[sml]$/.test(name) ? name.toUpperCase() : name;
}

/**
 * The sizes a text names, after "Sizes": "XS (S, M, L)", and on past the
 * brackets, "XS (S, M, L) XL, 2XL [3XL, 4XL]"; null when it names none.
 */
export function sizeNames(text: string): string[] | null {
  const head = namesHead(text);
  if (!head) return null;
  const found = [head[1], ...head[2].split(SEPARATOR), ...namesTail(text, head.index + head[0].length)];
  const names = found.map((n) => n.trim()).filter(Boolean);
  return names.length > 1 ? names.map(sizeCase) : null;
}

// ---- A pattern's sizes ---------------------------------------------------------

/**
 * The commonest number of sizes the runs could be, met three times at least,
 * so one stray "(see 2)" is not taken for sizes; 0 when none is. A run counts
 * for each count it could end at; on a tie the larger count wins.
 */
function commonestRunLength(pages: string[]): number {
  const lengths = new Map<number, number>();
  for (const text of pages) for (const run of sizeRuns(text)) for (const n of new Set([run.length, ...run.cuts])) lengths.set(n, (lengths.get(n) ?? 0) + 1);
  const [count, seen] = [...lengths].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
  return seen >= 3 ? count : 0;
}

/**
 * A pattern's sizes, from its pages' texts: their names where it gives them,
 * and how many there are; without names, as many as its runs most often
 * have. None found: no names and a count of 0.
 */
export function sizesOf(pages: string[]): { names: string[] | null; count: number } {
  for (const text of pages) {
    const names = sizeNames(text);
    if (names) return { names, count: names.length };
  }
  return { names: null, count: commonestRunLength(pages) };
}

/** A size as the picker says it: its name, or its place. */
export function sizeLabel(index: number, names: string[] | null): string {
  if (names?.[index]) return names[index];
  const n = index + 1;
  const th = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${th} size`;
}
