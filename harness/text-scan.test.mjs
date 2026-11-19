// src/text-scan.ts against the regular expressions it replaces, side by
// side: each reader and its expression are given the same made-up texts, and
// any difference fails.
//
//   node --test harness/text-scan.test.mjs
//
// The texts are built from the pieces these readers look for -- digits,
// separators, units, the words of crochet and of shops -- with spaces of
// several kinds and line breaks among them, so the edges get tried, not only
// the patterns' usual shape. Seeded, so a failure comes back the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as scan from "../src/text-scan.ts";

const CASES = 60000;

const PIECES = [
  "0", "1", "2", "5", "9", "10", "100", "1000", "12", "3", "007",
  ".", ",", ";", "-", "–", "—", "/", "%", "*", "(", ")", "[", "]", "+", "_", "'",
  " ", " ", " ", "  ", "\t", "\n", "\r", " ", " ", "　",
  "x", "X", "×", "m", "M", "mm", "MM", "cm", "g", "G", "gr", "e", "a", "s", "t", "o", "T", "O", "to", "TO",
  "in each", "In Each", "in eachs", "in", "each", "times", "time", "sc", "dc", "ch", "sp",
  "per", "Per", "je", "pro", "PRO", "100", "100g", "100 g", " / ",
  "ball", "balls", "skein", "hanks", "cake", "knäuel", "knaeuel", "stück", "stk", "stk.", "STK",
  "m", "metres", "meters", "mtrs", "at", "per",
  "wool", "Wolle", "%", "ä", "é", "İ", "ı", "ſ", "K",
];

// A small seeded generator (mulberry32), so a failing text can be found again.
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `focus` are the pieces of what is being read, chosen more often than the
// rest, so the texts take its shape often enough to try it.
function* texts(seed, extra = [], focus = PIECES) {
  const r = random(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  for (const t of extra) yield t;
  for (let n = 0; n < CASES; n++) {
    const length = Math.floor(r() * 14);
    let s = "";
    for (let i = 0; i < length; i++) s += pick(r() < 0.75 ? focus : PIECES);
    yield s;
  }
}

// Texts in the shape of `slots` -- one choice from each, in order -- each
// slot now and then left out or swapped for any piece, with pieces around:
// near-misses as well as matches.
function* shaped(seed, slots) {
  const r = random(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const noise = () => {
    let s = "";
    for (let i = Math.floor(r() * 3); i > 0; i--) s += pick(PIECES);
    return s;
  };
  for (let n = 0; n < CASES; n++) {
    let s = noise();
    for (const slot of slots) {
      const roll = r();
      s += roll < 0.08 ? "" : roll < 0.16 ? pick(PIECES) : pick(slot);
    }
    yield s + noise();
  }
}

const plain = (m) => (m ? [...m] : null);

// How often each found something, so a reader the texts never reach does
// not pass for want of trying.
const found = new Map();
const isHit = (v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== false);

function same(name, expected, actual, input, changedFrom) {
  assert.deepEqual(actual, expected, `${name} differs on ${JSON.stringify(input)}`);
  const hit = changedFrom !== undefined ? expected !== changedFrom : isHit(expected);
  if (hit) found.set(name, (found.get(name) ?? 0) + 1);
  else if (!found.has(name)) found.set(name, 0);
}

test.after(() => {
  const thin = [...found].filter(([, n]) => n < 100).map(([name, n]) => `${name} (${n})`);
  assert.deepEqual(thin, [], `found something fewer than 100 times, so the texts do not try them: ${thin.join(", ")}`);
});

test("matchWrapped is /^\\*(.*)\\*\\s*(.*)$/ and /^[([](.*)[)\\]]\\s*(.*)$/", () => {
  for (const s of texts(1, ["*", "**", "*sc*", "* sc, dc * x 6", "*a*\n", "*a\n*", "*a* \n ", "*a*b\n*", "(sc, ch 2) x 3", "[dc]", "(a]"], ["*", "*", "(", ")", "[", "]", " ", " ", "\n", " ", "sc", ", ", "x 6", "a"])) {
    same("star", plain(/^\*(.*)\*\s*(.*)$/.exec(s)), scan.matchWrapped(s, "*", "*"), s);
    same("group", plain(/^[([](.*)[)\]]\s*(.*)$/.exec(s)), scan.matchWrapped(s, "([", ")]"), s);
    const t = `*${s}`;
    same("star*", plain(/^\*(.*)\*\s*(.*)$/.exec(t)), scan.matchWrapped(t, "*", "*"), t);
    const g = `(${s}`;
    same("group(", plain(/^[([](.*)[)\]]\s*(.*)$/.exec(g)), scan.matchWrapped(g, "([", ")]"), g);
  }
});

test("matchInEach is /^(.*?)\\s+in each\\b(.*)$/i", () => {
  for (const s of texts(2, ["2 sc in each st around", "sc in eachst", "sc\nin each", "sc in each\n", "in each", " in each", "a  IN EACH x 6"], [" in each", " IN EACH", " in each ", "in each", " ", "  ", "\n", "\t", "sc", "x", "_", "st", "2"])) {
    same("in each", plain(/^(.*?)\s+in each\b(.*)$/i.exec(s)), scan.matchInEach(s), s);
  }
});

test("stripTrailingTimes is .replace(/\\s+(?:x|×)\\s*\\d+$|\\s+\\d+\\s*times$/, \"\")", () => {
  for (const s of texts(3, ["3 dc x 4", "dc x4", "dc 3 times", "dc3 times", "x 4", " x 4", "dc  ×  12", "dc x"], [" x ", " × ", "x", "×", "3", "12", " times", "times", " ", "\t", "\n", "dc", "a"])) {
    same("times", s.replace(/\s+(?:x|×)\s*\d+$|\s+\d+\s*times$/, ""), scan.stripTrailingTimes(s), s, s);
  }
});

test("matchLeadingCount is /^(\\d+)\\s*(.*)$/ and matchTailCount /^-?(\\d+)\\b\\s*(.*)$/", () => {
  for (const s of texts(4, ["3 dc", "12", "3\ndc", "3 dc\n", "-3 sp", "-3a", "3_", "-", "-x"], ["1", "23", "-", " ", "\n", " ", "dc", "_", "a", "st"])) {
    same("lead", plain(/^(\d+)\s*(.*)$/.exec(s)), scan.matchLeadingCount(s), s);
    same("tail", plain(/^-?(\d+)\b\s*(.*)$/.exec(s)), scan.matchTailCount(s), s);
  }
});

test("matchPercentFirst and matchPercentLast are the fibre expressions", () => {
  for (const s of texts(5, ["80% wool", "80 %wool", "80%", "80% ", "80%  ", "80%\n", "80% \n", "4,5 % silk", "wool 80%", "wool80%", "5%", "55%", "5,5%", " 5%", "1.2.3%", "a\n5%", "a 5\n%", ",5%"], ["1", "5", "80", ",", ".", "%", " ", "  ", "\n", "wool", "a"])) {
    same("first", plain(/^(\d+(?:[.,]\d+)?)\s*%\s*(.+)$/.exec(s)), scan.matchPercentFirst(s), s);
    same("last", plain(/^(.+?)\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(s)), scan.matchPercentLast(s), s);
    const t = `${s}%`;
    same("last%", plain(/^(.+?)\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(t)), scan.matchPercentLast(t), t);
  }
});

test("the number readers are their expressions", () => {
  const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
  const first = (re, s) => re.exec(s)?.[1] ?? null;
  for (const s of texts(6, ["3.5mm", "3,5 MM", "1.5.5mm", "3.5–4 mm", "3.5 to 4mm", "3 TO 4 Mm", "4 mm circular, 60 cm", "6 balls", "6 stk.x", "6 stk.", "6 Knäuel", "6 x 50 g", "6×50g", "230 m/100g", "400 metres per 100 g", "400 mtrs at 100g", "12mmm", "3cmx"], ["1", "3", "45", ".", ",", " ", "mm", "MM", "cm", "-", "–", "—", "to", "TO", "x", "×", "g", "balls", "ball", "stk.", "stk", "Knäuel", "knäuel", "m", "metres", "mtrs", "/", "per", "at", "100", "a", "e"])) {
    same("mm", all(/(\d+(?:[.,]\d+)?)\s*mm/gi, s), scan.millimetres(s), s);
    same("mm\\b", first(/(\d+(?:[.,]\d+)?)\s*mm\b/, s), scan.numberBefore(s, "mm"), s);
    same("cm\\b", first(/(\d+(?:[.,]\d+)?)\s*cm\b/, s), scan.numberBefore(s, "cm"), s);
    same("balls", first(/(\d+(?:[.,]\d+)?)\s*(?:balls?|skeins?|hanks?|cakes?|knäuel|knaeuel|stück|stk\.?)(?![a-z])/, s), scan.ballCount(s), s);
  }
});

test("the range, balls-times-grams and metres-per-100-g readers are their expressions", () => {
  const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
  const first = (re, s) => re.exec(s)?.[1] ?? null;
  const range = [["3", "3.5", "4,5"], ["", " "], ["-", "–", "—", "to", "TO"], ["", " "], ["4", "4.5", "5,5"], ["", " "], ["mm", "MM", "Mm"]];
  for (const s of [...texts(9, [], ["1", "3", "4,5", "0.5", " ", "-", "–", "—", "to", "TO", "mm", "MM", "a", "."]), ...shaped(14, range)]) {
    same("range", all(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?\s*mm/gi, s), scan.rangeStartsInMm(s), s);
  }
  const grams = [["6", "12"], ["", " "], ["x", "×"], ["", " "], ["50", "25"], ["", " "], ["g"], ["", "r", " ", "."]];
  for (const s of [...texts(10, [], ["6", "50", "1", "x", "×", " ", "g", "gr", "G", ".", "a"]), ...shaped(13, grams)]) {
    same("x g", first(/(\d+)\s*[x×]\s*\d+\s*g\b/, s), scan.ballsTimesGrams(s), s);
  }
  const metres = [["230", "4", "1.5", "12"], ["", " ", "  "], ["m"], ["", "etres", "eters", "trs"], ["", " "], ["/", "per", "at"], ["", " "], ["100"], ["", " "], ["g"]];
  for (const s of [...texts(11, [], ["230", "4", ".5", " ", "m", "metres", "eters", "trs", "/", "per", "at", "100", "g", "e", "1"]), ...shaped(12, metres)]) {
    same("m/100g", first(/(\d+(?:\.\d+)?)\s*m(?:etres|eters|trs)?\s*(?:\/|per|at)\s*100\s*g/, s), scan.metresPer100gIn(s), s);
  }
});

test("withoutPer100g is .replace(/\\/?\\s*(?:per\\s+|je\\s+|pro\\s+)?100\\s*g(?![a-z])/i, \"\")", () => {
  for (const s of texts(7, ["€8,50 / 100 g", "12.90 per 100g", "9 € je 100 g", "xpro 100g", "1000g", "100 gr", "100 G.", "//per 100g", "per100g", "a / 100g / 100g"], ["/", " ", "  ", "per", "je", "pro", "PRO", "Per", "100", "1", "0", "g", "G", "r", ".", "x", "€", "\n"])) {
    same("per 100 g", s.replace(/\/?\s*(?:per\s+|je\s+|pro\s+)?100\s*g(?![a-z])/i, ""), scan.withoutPer100g(s), s, s);
  }
});

test("the small ones: trailing marks, plain numbers, thousands", () => {
  const nums = ["0", "1", "12", "123", "1234", "-1234567", "1e+21", "Infinity", "NaN", "e123", "_1234", "a1234b5678"];
  for (const s of texts(8, nums, ["/", ",", ";", " ", "\t", "0", "1", "2", "3", ".", "-", "e", "_", "a", "+"])) {
    same("slashes", s.replace(/\/+$/, ""), scan.trimTrailingSlashes(s), s, s);
    same("strands", s.replace(/[,;\s]+$/, ""), scan.trimEndWhere(s, (c) => c === "," || c === ";" || scan.isSpace(c)), s, s);
    same("zeros", s.replace(/0+$/, ""), scan.trimEndWhere(s, (c) => c === "0"), s, s);
    same("plain", /^\d*\.?\d+$/.test(s), scan.isPlainNumber(s), s);
    same("thousands", s.replace(/\B(?=(\d{3})+(?!\d))/g, " "), scan.groupThousands(s), s, s);
  }
});
