/**
 * Small readers of typed text, in place of regular expressions that could
 * take time growing with the square of the input on text made to trip them
 * (SonarCloud's S8786: a run of digits or spaces tried from every point in
 * it).
 *
 * Each one gives exactly what the expression it replaces gave -- the same
 * matches, the same groups, line breaks and all -- and walks the text once.
 * The expression each stands for is written above it, and
 * harness/text-scan.test.mjs runs the two side by side on a few hundred
 * thousand made-up inputs and fails at the first difference. A change here
 * should be checked there.
 *
 * What the expressions meant, character by character:
 * - `\s` is JavaScript's whitespace (isSpace), `\d` is 0-9, `\w` and `\b`
 *   are ASCII letters, digits and _.
 * - `.` is any character but a line break (\n, \r, U+2028, U+2029), and `$`
 *   with no `m` flag is the end of the text.
 * - Indices are UTF-16 code units, as the expressions (with no `u` flag) read.
 */

const SPACE = /\s/;

export function isSpace(c: string | undefined): boolean {
  return c !== undefined && SPACE.test(c);
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isWord(c: string | undefined): boolean {
  return c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || isDigit(c) || c === "_");
}

function isAsciiLetter(c: string | undefined): boolean {
  return c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
}

function isLowerAscii(c: string | undefined): boolean {
  return c !== undefined && c >= "a" && c <= "z";
}

function isLineBreak(c: string | undefined): boolean {
  return c === "\n" || c === "\r" || c === " " || c === " ";
}

function firstLineBreak(s: string): number {
  for (let i = 0; i < s.length; i++) if (isLineBreak(s[i])) return i;
  return s.length;
}

function lastLineBreak(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (isLineBreak(s[i])) return i;
  return -1;
}

function hasLineBreak(s: string): boolean {
  return firstLineBreak(s) < s.length;
}

/** Where the spaces from `i` end. */
function skipSpace(s: string, i: number): number {
  while (i < s.length && isSpace(s[i])) i++;
  return i;
}

/** Where the digits from `i` end. */
function digitsEnd(s: string, i: number): number {
  while (isDigit(s[i])) i++;
  return i;
}

/** Where the spaces just before `i` begin. */
function spaceStart(s: string, i: number): number {
  while (i > 0 && isSpace(s[i - 1])) i--;
  return i;
}

/** `s` with every character at its end that `drop` says off: `.replace(/[…]+$/, "")`. */
export function trimEndWhere(s: string, drop: (c: string) => boolean): string {
  let end = s.length;
  while (end > 0 && drop(s[end - 1])) end--;
  return s.slice(0, end);
}

/** `.replace(/\/+$/, "")` */
export function trimTrailingSlashes(s: string): string {
  return trimEndWhere(s, (c) => c === "/");
}

/**
 * `/^\*(.*)\*\s*(.*)$/` with `opens` = `closes` = "*", and
 * `/^[([](.*)[)\]]\s*(.*)$/` with `opens` "([" and `closes` ")]": an
 * opening mark, then everything up to the last closing one, then what
 * follows it with its leading spaces off.
 */
export function matchWrapped(s: string, opens: string, closes: string): [string, string, string] | null {
  if (!s.length || !opens.includes(s[0])) return null;
  // What follows the closing mark, its leading spaces off, has no line
  // break: so every character from just after it through the last line
  // break is a space.
  let from = 1;
  const lastBreak = lastLineBreak(s);
  if (lastBreak >= 0) {
    let q = lastBreak;
    while (q >= 0 && isSpace(s[q])) q--;
    from = Math.max(from, q);
  }
  // And what is inside has none.
  for (let k = Math.min(firstLineBreak(s), s.length - 1); k >= from; k--) {
    if (closes.includes(s[k])) return [s, s.slice(1, k), s.slice(skipSpace(s, k + 1))];
  }
  return null;
}

/** `/^(.*?)\s+in each\b(.*)$/i`: what comes before the first " in each", and what after. */
export function matchInEach(s: string): [string, string, string] | null {
  const firstBreak = firstLineBreak(s);
  const lastBreak = lastLineBreak(s);
  let a = 0;
  while (a <= Math.min(firstBreak, s.length - 1)) {
    if (!isSpace(s[a])) {
      a++;
      continue;
    }
    const j = skipSpace(s, a);
    const end = j + 7;
    if (s.slice(j, end).toLowerCase() === "in each" && !isWord(s[end]) && lastBreak < end) return [s, s.slice(0, a), s.slice(end)];
    a = j;
  }
  return null;
}

/** `.replace(/\s+(?:x|×)\s*\d+$|\s+\d+\s*times$/, "")`: " x 6" or " 6 times" off the end. */
export function stripTrailingTimes(t: string): string {
  let cut = -1;
  let digits = t.length;
  while (digits > 0 && isDigit(t[digits - 1])) digits--;
  if (digits < t.length) {
    const x = spaceStart(t, digits);
    if (x > 0 && (t[x - 1] === "x" || t[x - 1] === "×")) {
      const a = spaceStart(t, x - 1);
      if (a < x - 1) cut = a;
    }
  }
  if (cut < 0 && t.endsWith("times")) {
    const x = spaceStart(t, t.length - 5);
    let d = x;
    while (d > 0 && isDigit(t[d - 1])) d--;
    if (d < x) {
      const a = spaceStart(t, d);
      if (a < d) cut = a;
    }
  }
  return cut < 0 ? t : t.slice(0, cut);
}

/** `/^(\d+)\s*(.*)$/`: a count at the start, and the rest. */
export function matchLeadingCount(t: string): [string, string, string] | null {
  const d = digitsEnd(t, 0);
  if (d === 0) return null;
  const rest = t.slice(skipSpace(t, d));
  return hasLineBreak(rest) ? null : [t, t.slice(0, d), rest];
}

/** `/^-?(\d+)\b\s*(.*)$/`: a count right after a stitch ("ch-3", "ch 3"), and the rest. */
export function matchTailCount(s: string): [string, string, string] | null {
  const start = s[0] === "-" ? 1 : 0;
  const d = digitsEnd(s, start);
  if (d === start || isWord(s[d])) return null;
  const rest = s.slice(skipSpace(s, d));
  return hasLineBreak(rest) ? null : [s, s.slice(start, d), rest];
}

/** A number as `\d+(?:[.,]\d+)?` reads it from `i` (`seps` the marks allowed), or -1. */
function numberEnd(s: string, i: number, seps = ".,"): number {
  const d = digitsEnd(s, i);
  if (d === i) return -1;
  return seps.includes(s[d] ?? "\0") && isDigit(s[d + 1]) ? digitsEnd(s, d + 1) : d;
}

/** `/^(\d+(?:[.,]\d+)?)\s*%\s*(.+)$/`: "80% wool". */
export function matchPercentFirst(p: string): [string, string, string] | null {
  const e = numberEnd(p, 0);
  if (e < 0) return null;
  const pc = skipSpace(p, e);
  if (p[pc] !== "%") return null;
  const rest = p.slice(pc + 1);
  const w = skipSpace(rest, 0);
  if (w < rest.length) {
    const name = rest.slice(w);
    return hasLineBreak(name) ? null : [p, p.slice(0, e), name];
  }
  // Only spaces after the %: (.+) takes the last of them.
  if (!rest.length || isLineBreak(rest[rest.length - 1])) return null;
  return [p, p.slice(0, e), rest[rest.length - 1]];
}

/** `/^(.+?)\s*(\d+(?:[.,]\d+)?)\s*%$/`: "wool 80%". */
export function matchPercentLast(p: string): [string, string, string] | null {
  const n = p.length;
  if (!n || p[n - 1] !== "%") return null;
  const u = spaceStart(p, n - 1);
  if (!isDigit(p[u - 1])) return null;
  let d2 = u;
  while (d2 > 0 && isDigit(p[d2 - 1])) d2--;
  let start = d2;
  let sep = -1;
  if (d2 >= 2 && (p[d2 - 1] === "." || p[d2 - 1] === ",") && isDigit(p[d2 - 2])) {
    sep = d2 - 1;
    start = sep;
    while (start > 0 && isDigit(p[start - 1])) start--;
  }
  // The name takes at least one character, and as few as it can.
  let i = Math.max(spaceStart(p, start), 1);
  if (i === sep) i++;
  if (i > u - 1 || firstLineBreak(p) < i) return null;
  const j = skipSpace(p, i);
  return [p, p.slice(0, i), p.slice(j, numberEnd(p, j))];
}

/**
 * Every number (`\d+(?:[.,]\d+)?`, or with `seps` the marks allowed) that
 * `follows` accepts what comes after: `follows(text, end)` gives where the
 * match ends, or -1. As a global expression `number…` finds them, left to
 * right; `first` stops at one.
 */
function numbersFollowedBy(text: string, follows: (text: string, end: number) => number, seps = ".,", first = false): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isDigit(text[i])) {
      i++;
      continue;
    }
    const e = numberEnd(text, i, seps);
    const end = follows(text, e);
    if (end >= 0) {
      out.push(text.slice(i, e));
      if (first) break;
      i = end;
    } else {
      // From anywhere else in these digits the same follows, so the same fails.
      i = digitsEnd(text, i);
    }
  }
  return out;
}

/** Where `word` (lower case) ends at `j`, its case ignored, or -1. */
function wordAt(text: string, j: number, word: string): number {
  return text.slice(j, j + word.length).toLowerCase() === word ? j + word.length : -1;
}

/** Millimetres: every `/(\d+(?:[.,]\d+)?)\s*mm/gi`. */
export function millimetres(text: string): string[] {
  return numbersFollowedBy(text, (t, e) => wordAt(t, skipSpace(t, e), "mm"));
}

/** A range with one unit, its first number: every `/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?\s*mm/gi`. */
export function rangeStartsInMm(text: string): string[] {
  return numbersFollowedBy(text, (t, e) => {
    const j = skipSpace(t, e);
    const k = "-–—".includes(t[j] ?? "\0") ? j + 1 : wordAt(t, j, "to");
    if (k < 0) return -1;
    const n = skipSpace(t, k);
    const ne = numberEnd(t, n);
    return ne < 0 ? -1 : wordAt(t, skipSpace(t, ne), "mm");
  });
}

/** The first number before `unit` and not more word: `/(\d+(?:[.,]\d+)?)\s*unit\b/`, case as written. */
export function numberBefore(text: string, unit: string): string | null {
  return numbersFollowedBy(text, (t, e) => {
    const j = skipSpace(t, e);
    return t.startsWith(unit, j) && !isWord(t[j + unit.length]) ? j + unit.length : -1;
  }, ".,", true)[0] ?? null;
}

const COUNTED = ["balls", "ball", "skeins", "skein", "hanks", "hank", "cakes", "cake", "knäuel", "knaeuel", "stück", "stk.", "stk"];

/** A count of balls: `/(\d+(?:[.,]\d+)?)\s*(?:balls?|skeins?|hanks?|cakes?|knäuel|knaeuel|stück|stk\.?)(?![a-z])/`. */
export function ballCount(text: string): string | null {
  return numbersFollowedBy(text, (t, e) => {
    const j = skipSpace(t, e);
    const unit = COUNTED.find((u) => t.startsWith(u, j) && !isLowerAscii(t[j + u.length]));
    return unit ? j + unit.length : -1;
  }, ".,", true)[0] ?? null;
}

/** Balls times grams, the balls: `/(\d+)\s*[x×]\s*\d+\s*g\b/`. */
export function ballsTimesGrams(text: string): string | null {
  return numbersFollowedBy(text, (t, e) => {
    const j = skipSpace(t, e);
    if (t[j] !== "x" && t[j] !== "×") return -1;
    const k = skipSpace(t, j + 1);
    const d = digitsEnd(t, k);
    if (d === k) return -1;
    const g = skipSpace(t, d);
    return t[g] === "g" && !isWord(t[g + 1]) ? g + 1 : -1;
  }, "", true)[0] ?? null;
}

/** Metres per 100 g, in lower case: `/(\d+(?:\.\d+)?)\s*m(?:etres|eters|trs)?\s*(?:\/|per|at)\s*100\s*g/`. */
export function metresPer100gIn(text: string): string | null {
  return numbersFollowedBy(text, (t, e) => {
    let k = skipSpace(t, e);
    if (t[k] !== "m") return -1;
    k++;
    for (const suffix of ["etres", "eters", "trs"]) {
      if (t.startsWith(suffix, k)) {
        k += suffix.length;
        break;
      }
    }
    k = skipSpace(t, k);
    const sep = ["/", "per", "at"].find((w) => t.startsWith(w, k));
    if (!sep) return -1;
    k = skipSpace(t, k + sep.length);
    if (!t.startsWith("100", k)) return -1;
    k = skipSpace(t, k + 3);
    return t[k] === "g" ? k + 1 : -1;
  }, ".", true)[0] ?? null;
}

/**
 * A price per 100 g said, taken out: `.replace(/\/?\s*(?:per\s+|je\s+|pro\s+)?100\s*g(?![a-z])/i, "")`.
 */
export function withoutPer100g(s: string): string {
  for (let c = s.indexOf("100"); c >= 0; c = s.indexOf("100", c + 1)) {
    const g = skipSpace(s, c + 3);
    if ((s[g] !== "g" && s[g] !== "G") || isAsciiLetter(s[g + 1])) continue;
    // As far back as it reaches: "/ per 100 g", "per 100g", "/100 g".
    const spaced = spaceStart(s, c);
    let start = spaced;
    if (spaced < c) {
      const word = ["per", "je", "pro"].find((w) => spaced >= w.length && s.slice(spaced - w.length, spaced).toLowerCase() === w);
      if (word) start = spaceStart(s, spaced - word.length);
    }
    if (s[start - 1] === "/") start--;
    return s.slice(0, start) + s.slice(g + 1);
  }
  return s;
}

/** `/^\d*\.?\d+$/.test(part)`: digits, or digits with one point before at least one more. */
export function isPlainNumber(part: string): boolean {
  const dot = part.indexOf(".");
  const digits = (from: number, to: number) => digitsEnd(part, from) >= to;
  if (dot < 0) return part.length > 0 && digits(0, part.length);
  return dot === part.lastIndexOf(".") && digits(0, dot) && dot < part.length - 1 && digits(dot + 1, part.length);
}

/** A space between each three digits from the right: `.replace(/\B(?=(\d{3})+(?!\d))/g, " ")`. */
export function groupThousands(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (!isDigit(s[i])) {
      out += s[i];
      i++;
      continue;
    }
    const end = digitsEnd(s, i);
    for (let p = i; p < end; p++) {
      if ((end - p) % 3 === 0 && (p > i || isWord(s[p - 1]))) out += " ";
      out += s[p];
    }
    i = end;
  }
  return out;
}
