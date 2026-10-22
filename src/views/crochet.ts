/**
 * Crochet diagrams: rounds or rows written as a pattern writes them --
 * "ch 3, 11 dc in ring, sl st to join", "*sk 1, 5 dc in next* around" --
 * read, worked out stitch by stitch into the stitches of the round or row
 * before, and drawn in the standard symbols, each round or row numbered and
 * the start marked.
 *
 * Pure: reading, laying out and drawing as SVG are functions of the
 * diagram, so the page, a board's card and the checks all draw the same.
 *
 * The shapes:
 *  - rounds: worked into a ring, each round into the stitches of the one
 *    before, round and round;
 *  - rows: back and forth, each row into the one before, turned;
 *  - spiral: a strip whose first row lies along a spiral, the rows after
 *    worked back along it, as a crochet rose is.
 */

export type Shape = "rounds" | "rows" | "spiral";
export type Terms = "us" | "uk";

export interface CrochetData {
  shape: Shape;
  terms: Terms;
  /** Each round or row as written. */
  rows: string[];
}

/** A stitch the diagram draws, by its US name. */
export type Stitch = "ch" | "sl" | "sc" | "hdc" | "dc" | "tr" | "dtr" | "picot";

/**
 * What a stitch is called in each terms, what it is, for someone learning,
 * and how tall it stands, in stitch heights.
 */
export const STITCHES: Record<Stitch, { us: string; uk: string; usName: string; ukName: string; what: string; height: number }> = {
  ch: { us: "ch", uk: "ch", usName: "chain", ukName: "chain", height: 0, what: "Yarn over and pull it through the loop on the hook. The first row is usually chains, and chains make the gaps in lace." },
  sl: { us: "sl st", uk: "ss", usName: "slip stitch", ukName: "slip stitch", height: 0.4, what: "Hook into the stitch, yarn over, and pull it through the stitch and the loop on the hook in one go. Adds no height: it joins a round, or moves along." },
  sc: { us: "sc", uk: "dc", usName: "single crochet", ukName: "double crochet", height: 1, what: "Hook into the stitch, yarn over and pull up a loop (2 loops on the hook), yarn over and pull through both. The shortest stitch, firm and dense." },
  hdc: { us: "hdc", uk: "htr", usName: "half double crochet", ukName: "half treble", height: 1.5, what: "Yarn over, hook into the stitch, yarn over and pull up a loop (3 on the hook), yarn over and pull through all 3. A little taller than the one before." },
  dc: { us: "dc", uk: "tr", usName: "double crochet", ukName: "treble", height: 2.1, what: "Yarn over, hook into the stitch, pull up a loop (3 on the hook), then twice: yarn over, pull through 2. About twice as tall as the shortest; drawn with one line across." },
  tr: { us: "tr", uk: "dtr", usName: "treble", ukName: "double treble", height: 2.8, what: "Yarn over twice, hook into the stitch, pull up a loop (4 on the hook), then three times: yarn over, pull through 2. Drawn with two lines across." },
  dtr: { us: "dtr", uk: "ttr", usName: "double treble", ukName: "triple treble", height: 3.5, what: "Yarn over three times, hook into the stitch, pull up a loop (5 on the hook), then four times: yarn over, pull through 2. Drawn with three lines across." },
  picot: { us: "picot", uk: "picot", usName: "picot", ukName: "picot", height: 0.6, what: "Chain 3, then slip stitch into the first of those chains: a little bump, for a pretty edge." },
};

/** Each terms' words for the stitches, longest first so "sl st" is read before "st". */
const WORDS: Record<Terms, [string, Stitch][]> = {
  us: [["sl st", "sl"], ["slst", "sl"], ["ss", "sl"], ["sl", "sl"], ["picot", "picot"], ["ch", "ch"], ["sc", "sc"], ["hdc", "hdc"], ["dc", "dc"], ["tr", "tr"], ["dtr", "dtr"]],
  uk: [["sl st", "sl"], ["slst", "sl"], ["ss", "sl"], ["sl", "sl"], ["picot", "picot"], ["ch", "ch"], ["dc", "sc"], ["htr", "hdc"], ["tr", "dc"], ["dtr", "tr"], ["ttr", "dtr"], ["trtr", "dtr"]],
};

// ---------- reading ----------

/** One thing worked, in the order worked. */
export type Step =
  /** Stitches into one place: one stitch, or a fan or shell of several. */
  | { kind: "place"; stitches: Stitch[]; same: boolean; space: boolean }
  /** A run of chains, arching over. */
  | { kind: "chain"; n: number }
  /** Stitches of the round or row before left unworked. */
  | { kind: "skip"; n: number }
  /** A slip stitch closing the round. */
  | { kind: "join" };

/** A part read, before repeats are worked out: "around" repeats it to the end of the round or row before. */
type Part = { kind: "step"; step: Step } | { kind: "repeat"; parts: Part[]; times: number | "around" };

export interface ReadRow {
  parts: Part[];
  /** What could not be read, said; the rest is drawn. */
  errors: string[];
}

/** A stitch's word in these terms, or null. */
function stitchWord(text: string, terms: Terms): { stitch: Stitch; rest: string } | null {
  const t = text.trim().toLowerCase();
  for (const [word, stitch] of WORDS[terms]) {
    if (t === word || t.startsWith(`${word} `) || t.startsWith(`${word}-`)) return { stitch, rest: t.slice(word.length).trim() };
  }
  return null;
}

/** Splits at commas and semicolons outside brackets and stars. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let star = false;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "*") star = !star;
    if ((ch === "," || ch === ";") && depth === 0 && !star) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** "x 6", "× 6", "6 times", "around", "round", "across", anywhere in what follows: how often what is before it is worked. */
function timesIn(text: string): number | "around" | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/\b(around|round|rnd|across|to end|to the end)\b/.test(t)) return "around";
  const m = /(?:^|\s)(?:x|×)\s*(\d+)\b|\b(\d+)\s*times\b/.exec(t);
  if (m) return Math.max(1, Math.min(500, Number(m[1] ?? m[2])));
  return null;
}

/** Reads a round or row. */
export function readRow(text: string, terms: Terms): ReadRow {
  const errors: string[] = [];
  // A repeat or a bracket straight after a stitch, the comma left out: "ch 2 *hdc in next* around".
  const tidy = text
    .replace(/\.\s*$/, "")
    .replace(/([^,;*\s])\s+\*(?=[^*]*\*)/g, "$1, *")
    .replace(/([^,;(\[\s])\s+([([])(?!\s*counts)/gi, "$1, $2");
  const parts = readParts(tidy, terms, errors);
  return { parts, errors };
}

const repeated = (steps: Step[], times: number | "around" | null): Part[] =>
  times ? [{ kind: "repeat", parts: steps.map((step) => ({ kind: "step", step })), times }] : steps.map((step) => ({ kind: "step", step }));

/**
 * What to say about a word that is not a stitch: one from the other terms
 * named as that, else plainly that it is not in the list.
 */
function notAStitch(text: string, terms: Terms): string {
  const t = text.trim().toLowerCase().replace(/^\d+\s*/, "");
  const word = t.split(/[\s(]/)[0];
  const other: Terms = terms === "us" ? "uk" : "us";
  const there = WORDS[other].find(([w]) => w === word);
  if (there && !WORDS[terms].some(([w]) => w === word)) {
    const s = STITCHES[there[1]];
    return `“${word}” is ${other.toUpperCase()} for ${other === "us" ? s.usName : s.ukName}. In ${terms.toUpperCase()} terms, which this diagram uses, write ${s[terms]}. Or switch the terms at the top.`;
  }
  return `“${text.trim()}” isn't one of the stitches listed under Stitches, so it's left out of the drawing.`;
}

function readParts(text: string, terms: Terms, errors: string[]): Part[] {
  const parts: Part[] = [];
  for (const piece of splitTop(text)) {
    // *…* x 6, *…* around
    const star = /^\*(.*)\*\s*(.*)$/.exec(piece);
    if (star) {
      const times = timesIn(star[2]);
      if (star[2].trim() && !times) errors.push(`After the repeat, “${star[2].trim()}” is not a number of times. Write x 6 for six times, or around to go to the end.`);
      parts.push({ kind: "repeat", parts: readParts(star[1], terms, errors), times: times ?? 1 });
      continue;
    }
    // (…) or […]: all worked into one place, maybe repeated.
    const group = /^[([](.*)[)\]]\s*(.*)$/.exec(piece);
    if (group) {
      const stitches: Stitch[] = [];
      for (const bit of splitTop(group[1])) {
        const steps = readSimple(bit, terms, true, errors);
        if (!steps) errors.push(notAStitch(bit, terms));
        else for (const s of steps) {
          if (s.kind === "place") stitches.push(...s.stitches);
          if (s.kind === "chain") for (let i = 0; i < s.n; i++) stitches.push("ch");
        }
      }
      const rest = group[2].toLowerCase();
      if (stitches.length) parts.push(...repeated([{ kind: "place", stitches, same: /\bsame\b/.test(rest), space: SPACE.test(rest) }], timesIn(rest)));
      continue;
    }
    // "2 sc in each st around", "dc in each ch across", "sc in each st x 6"
    const each = /^(.*?)\s+in each\b(.*)$/i.exec(piece);
    if (each) {
      const steps = readSimple(each[1], terms, true, errors);
      if (!steps) errors.push(notAStitch(each[1], terms));
      else parts.push(...repeated(steps, timesIn(each[2]) ?? "around"));
      continue;
    }
    const steps = readSimple(piece, terms, false, errors);
    if (steps) {
      // "3 dc x 4": what it says, again.
      const trailing = /(?:\s(?:x|×)\s*\d+|\s\d+\s*times)$/i.exec(piece);
      parts.push(...repeated(steps, trailing ? timesIn(trailing[0]) : null));
    } else if (/^join\b/i.test(piece)) parts.push({ kind: "step", step: { kind: "join" } });
    else if (!/^(turn|fasten off|fo)\b/i.test(piece)) errors.push(notAStitch(piece, terms));
  }
  return parts;
}

/** Into the space under a run of chains. */
const SPACE = /\b(sp|space|loop)\b/;
/** Worked into one place: a fan or shell, not one stitch in each. */
const ONE_PLACE = /\b(next|same|this|following|sp|space|loop|top)\b|\bin (?:the )?(?:st|stitch|ch)\b/;
/** Words that say where a stitch goes, read or passed over; anything else is said not to be understood. */
const WHERE = new Set(
  "in into the next same this following first last ring magic st sts stitch stitches ch chain chains sp sps space spaces loop loops top of to join from hook beginning beg turning each around round rnd across row previous it here base remaining 2nd 3rd 4th second third on at end all turn work worked and then as counts".split(" "),
);

/**
 * One stitch or run: "ch 3", "3 ch", "5 dc", "dc in same st", "sk 2",
 * "sl st to join", "5 dc in next ch-sp", "11 dc in ring", "picot". Several
 * of a stitch go one in each place -- "3 dc", "11 dc in ring" -- unless
 * they say into one ("5 dc in next") or `together` says so (a group's, or
 * "2 sc in each"). Null for words it is not; words after the stitch it
 * cannot read are said in `errors`.
 */
function readSimple(raw: string, terms: Terms, together: boolean, errors: string[]): Step[] | null {
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\((?:counts as [^)]*)\)/g, "").trim();
  t = t.replace(/\s+(?:x|×)\s*\d+$|\s+\d+\s*times$/, "");
  const skip = /^(?:sk|skip|miss)\b\s*(\d+)?/.exec(t);
  if (skip) return [{ kind: "skip", n: Math.min(200, Number(skip[1] ?? 1)) }];
  let count = 1;
  const lead = /^(\d+)\s*(.*)$/.exec(t);
  if (lead) {
    count = Math.min(200, Math.max(1, Number(lead[1])));
    t = lead[2];
  }
  const word = stitchWord(t, terms);
  if (!word) return null;
  let rest = word.rest;
  const tail = /^-?(\d+)\b\s*(.*)$/.exec(rest);
  if (tail) {
    count = Math.min(200, Math.max(1, Number(tail[1])));
    rest = tail[2];
  }
  // Words after it that say nothing it knows: said, not passed over.
  const unread = rest.split(/[\s\-–,]+/).filter((w) => w && !/^\d+$/.test(w) && !WHERE.has(w) && !stitchWord(w, terms));
  if (unread.length) errors.push(`In “${raw.trim()}”, “${unread.join(" ")}” couldn't be read. Put a comma between stitches, and see How to write them below.`);
  if (word.stitch === "ch") return [{ kind: "chain", n: count }];
  if (word.stitch === "sl" && /\b(join|to the|in top|in first|into top|into first)\b/.test(rest)) return [{ kind: "join" }];
  const same = /\bsame\b/.test(rest);
  const space = SPACE.test(rest);
  if (count === 1 || together || ONE_PLACE.test(rest)) return [{ kind: "place", stitches: Array.from({ length: count }, () => word.stitch), same, space }];
  return Array.from({ length: count }, (_, i) => ({ kind: "place" as const, stitches: [word.stitch], same: same && i === 0, space: false }));
}

/**
 * The steps of a row, its repeats worked out. `around` is how many stitches
 * the row before has, for "around" to stop at: a repeat goes on while it
 * still fits.
 */
export function stepsOf(row: ReadRow, around: number, spaces = around): Step[] {
  const out: Step[] = [];
  const used = { n: 0, spaces: 0 };
  const consumes = (s: Step): number => (s.kind === "place" ? (s.same && used.n > 0 ? 0 : 1) : s.kind === "skip" ? s.n : 0);
  const walk = (parts: Part[]) => {
    for (const p of parts) {
      if (p.kind === "step") {
        out.push(p.step);
        used.n += consumes(p.step);
        if (p.step.kind === "place" && p.step.space) used.spaces++;
        continue;
      }
      const once: Step[] = [];
      const flat = (ps: Part[]) => {
        for (const q of ps) {
          if (q.kind === "step") once.push(q.step);
          else for (let i = 0; i < (q.times === "around" ? 1 : q.times); i++) flat(q.parts);
        }
      };
      flat(p.parts);
      const each = once.reduce((n, s) => n + consumes(s), 0);
      // Into chain spaces, around: as many times as there are spaces.
      const inSpaces = once.filter((s) => s.kind === "place" && s.space).length;
      let times = p.times !== "around" ? p.times : inSpaces ? Math.max(1, Math.floor((spaces - used.spaces) / inSpaces)) : each > 0 ? Math.max(1, Math.floor((around - used.n) / each)) : 1;
      times = Math.min(times, 500);
      for (let i = 0; i < times; i++) {
        out.push(...once);
        used.n += each;
        used.spaces += inSpaces;
      }
    }
  };
  walk(row.parts);
  return out;
}

// ---------- laying out ----------

export interface Pt {
  x: number;
  y: number;
}

type StitchMark = { kind: "stitch"; stitch: Exclude<Stitch, "ch">; base: Pt; top: Pt; row: number };
type ChainMark = { kind: "chain"; at: Pt; dir: Pt; row: number };

/** One thing to draw. */
export type Mark =
  | StitchMark
  | ChainMark
  | { kind: "ring"; centre: Pt; r: number }
  | { kind: "label"; at: Pt; text: string; first: boolean; dir: Pt };

export interface RowSummary {
  /** Stitches made, chains apart. */
  stitches: number;
  chains: number;
  /** Stitches of the row before worked into, and how many it had; null for the first. */
  into: number | null;
  of: number | null;
  errors: string[];
}

export interface Layout {
  marks: Mark[];
  rows: RowSummary[];
  box: { x: number; y: number; w: number; h: number };
  used: Set<Stitch>;
}

/** One stitch height, in drawing units. */
export const U = 14;
/** How far along its row a chain takes. */
const CHAIN_STEP = 0.8 * U;

/** What a row made, in order: a stitch and how tall, a chain, or its starting chain's column. */
type Made = { kind: "stitch"; mark: StitchMark; top: Top; h: number } | { kind: "chain"; mark: ChainMark; top: Top } | { kind: "column"; marks: ChainMark[]; top: Top; base: Pt };

/** A place the next row can work into: where it is, and which way is up from it. */
interface Top {
  at: Pt;
  up: Pt;
  chain: boolean;
  /** Chains of one run share a number, for "in ch-sp". */
  run: number;
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const rotate = (a: Pt, angle: number): Pt => ({ x: a.x * Math.cos(angle) - a.y * Math.sin(angle), y: a.x * Math.sin(angle) + a.y * Math.cos(angle) });

/** Points along the first row's line: the ring, a straight line, or a spiral. */
function basePath(shape: Shape, n: number, pitch: number): Top[] {
  const tops: Top[] = [];
  if (shape === "rounds") {
    const r = Math.max(0.9 * U, (n * 0.95 * U) / (2 * Math.PI));
    for (let i = 0; i < n; i++) {
      // From the top, anticlockwise as a right-hander works a round.
      const a = -Math.PI / 2 - (2 * Math.PI * i) / n;
      const up = { x: Math.cos(a), y: Math.sin(a) };
      tops.push({ at: scale(up, r), up, chain: false, run: -1 });
    }
  } else if (shape === "rows") {
    for (let i = 0; i < n; i++) tops.push({ at: { x: i * CHAIN_STEP, y: 0 }, up: { x: 0, y: -1 }, chain: false, run: -1 });
  } else {
    // An Archimedean spiral from the middle, a chain's length apart along it.
    let theta = 0;
    const r0 = 1.2 * U;
    const k = pitch / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const r = r0 + k * theta;
      const a = -Math.PI / 2 - theta;
      const up = { x: Math.cos(a), y: Math.sin(a) };
      tops.push({ at: scale(up, r), up, chain: false, run: -1 });
      theta += CHAIN_STEP / Math.hypot(r, k);
    }
  }
  return tops;
}

/** The first round's ring, for rounds worked into one. */
function ringRadius(n: number): number {
  return Math.max(0.9 * U, (n * 0.95 * U) / (2 * Math.PI));
}

/**
 * Lays the diagram out: each row's steps worked into the row before's tops
 * (the first into the ring or along the line), stitches standing up from
 * where they are worked, fans spread, chains arching between.
 */
export function layout(data: CrochetData): Layout {
  const marks: Mark[] = [];
  const rows: RowSummary[] = [];
  const used = new Set<Stitch>();
  const read = data.rows.map((r) => readRow(r, data.terms));
  // The spiral's turns far enough apart for every row after the first.
  const pitch = data.shape === "spiral" ? U * (2.4 + read.slice(1).reduce((h, r) => h + rowHeight(stepsOf(r, 1000)), 0)) : 0;

  let prev: Top[] | null = null;
  let run = 0;
  read.forEach((row, ri) => {
    const first = ri === 0;
    // Rows and the spiral's strip turn: worked back along the row before.
    const before: Top[] | null = prev && data.shape !== "rounds" ? [...prev].reverse() : prev;
    const steps = stepsOf(row, before?.length ?? 0, before ? new Set(before.filter((t) => t.chain).map((t) => t.run)).size : 0);
    const summary: RowSummary = { stitches: 0, chains: 0, into: null, of: null, errors: row.errors };
    const tops: Top[] = [];

    // Chains before the first stitch stand as a column where the row starts:
    // a turning chain, or one that counts as the first stitch.
    // Not a repeat's first chains: "*ch 5, sk 1, sc* around" is loops, from the start.
    const leadAt = steps.findIndex((s) => s.kind !== "chain");
    const lead = leadAt > 0 && row.parts[0]?.kind !== "repeat" && steps.slice(leadAt).some((s) => s.kind === "place") ? steps.slice(0, leadAt).reduce((k, s) => k + (s.kind === "chain" ? s.n : 0), 0) : 0;
    const body = lead ? steps.slice(leadAt) : steps;

    // The places this row works into: the row before's tops, else the first line.
    let places: Top[];
    if (before) places = before;
    else {
      const chainsOnly = steps.every((s) => s.kind === "chain" || s.kind === "join");
      if (chainsOnly) {
        // A foundation chain, or a chain ring: along the line itself.
        places = basePath(data.shape, Math.max(1, steps.reduce((k, s) => k + (s.kind === "chain" ? s.n : 0), 0)), pitch);
        places.forEach((t, i) => {
          const next = places[i + 1] ?? places[i - 1];
          const dir = next && next !== t ? unit({ x: (next.at.x - t.at.x) * (places[i + 1] ? 1 : -1), y: (next.at.y - t.at.y) * (places[i + 1] ? 1 : -1) }) : rotate(t.up, Math.PI / 2);
          marks.push({ kind: "chain", at: t.at, dir, row: ri + 1 });
          tops.push({ ...t, chain: true, run });
        });
        run++;
        summary.chains = places.length;
        used.add("ch");
        if (steps.some((s) => s.kind === "join")) used.add("sl");
        marks.push(labelFor(places[0], places[1] ? unit({ x: places[1].at.x - places[0].at.x, y: places[1].at.y - places[0].at.y }) : rotate(places[0].up, Math.PI / 2), ri + 1, first));
        rows.push(summary);
        prev = tops;
        return;
      }
      // Into the ring, or along the line: a place for each stitch, and the starting chain's.
      const n = (lead ? 1 : 0) + body.reduce((k, s) => k + (s.kind === "place" && !s.same ? 1 : s.kind === "skip" ? s.n : 0), 0);
      places = basePath(data.shape, Math.max(1, n), pitch);
      if (data.shape === "rounds") marks.push({ kind: "ring", centre: { x: 0, y: 0 }, r: ringRadius(Math.max(1, n)) });
    }

    // Worked into: a cursor over the places, -1 before the first. More
    // worked into than there are, and they are spread over what there is.
    const consumed = (lead && !before ? 1 : 0) + countInto(body);
    const crowd = before && consumed > places.length ? places.length / consumed : 1;
    const w = { cursor: -1, usedTo: -1, pending: 0, last: null as Top | null, first: null as Top | null };
    /** What was made, in order, for a round to be laid round its circle after. */
    const made: Made[] = [];
    const placeAt = (i: number): Top => {
      if (!before) return places[Math.min(places.length - 1, Math.max(0, Math.round(i)))];
      const t = Math.min(places.length - 1, Math.max(0, i * crowd));
      const a = places[Math.floor(t)];
      const b = places[Math.ceil(t)];
      const k = t - Math.floor(t);
      return { at: add(scale(a.at, 1 - k), scale(b.at, k)), up: unit(add(scale(a.up, 1 - k), scale(b.up, k))), chain: a.chain, run: a.run };
    };
    /** The way the work goes at a place: towards the next. */
    const alongAt = (i: number): Pt => {
      const a = placeAt(i);
      const d = { x: placeAt(i + 1).at.x - placeAt(i - 1).at.x, y: placeAt(i + 1).at.y - placeAt(i - 1).at.y };
      return len(d) > 1e-6 ? unit(d) : rotate(a.up, data.shape === "rounds" ? -Math.PI / 2 : Math.PI / 2);
    };
    /** Chains waiting, drawn arching from where the work is to `to`, or on along the row. */
    const flushChains = (to: Top | null) => {
      if (!w.pending) return;
      const from = w.last ?? placeAt(Math.max(0, w.cursor));
      const n = w.pending;
      w.pending = 0;
      const end = to ? to.at : add(from.at, scale(alongAt(Math.max(0, w.cursor)), n * CHAIN_STEP));
      const up = unit(add(from.up, to?.up ?? from.up));
      const mid = add(scale(add(from.at, end), 0.5), scale(up, Math.min(n, 6) * 0.3 * U));
      const curve = (k: number) => add(add(scale(from.at, (1 - k) * (1 - k)), scale(mid, 2 * k * (1 - k))), scale(end, k * k));
      for (let i = 1; i <= n; i++) {
        const k = i / (n + 1);
        const p = curve(k);
        const q = curve(k + 0.01);
        const mark: ChainMark = { kind: "chain", at: p, dir: unit({ x: q.x - p.x, y: q.y - p.y }), row: ri + 1 };
        const top: Top = { at: p, up, chain: true, run };
        marks.push(mark);
        tops.push(top);
        made.push({ kind: "chain", mark, top });
      }
      run++;
      summary.chains += n;
      used.add("ch");
    };
    /** Stitches into one place: one standing up from it, or a fan leaning back to front along the row. */
    const workPlace = (stitches: Stitch[], i: number, at: Top) => {
      const tall = stitches.filter((st) => st !== "ch");
      const along = alongAt(i);
      const spread = tall.length > 1 ? Math.min(1.0, 0.24 * (tall.length - 1)) : 0;
      tall.forEach((st, k) => {
        const angle = tall.length > 1 ? -spread + (2 * spread * k) / (tall.length - 1) : 0;
        const up = unit(add(scale(at.up, Math.cos(angle)), scale(along, Math.sin(angle))));
        const h = Math.max(STITCHES[st].height, 0.5);
        const top: Top = { at: add(at.at, scale(up, h * U)), up, chain: false, run: -1 };
        flushChains(top);
        const mark: StitchMark = { kind: "stitch", stitch: st as Exclude<Stitch, "ch">, base: at.at, top: st === "sl" ? add(at.at, scale(up, 0.4 * U)) : top.at, row: ri + 1 };
        marks.push(mark);
        used.add(st);
        summary.stitches++;
        tops.push(top);
        made.push({ kind: "stitch", mark, top, h: st === "sl" ? 0.4 : h });
        w.last = top;
        w.first ??= top;
      });
      const chs = stitches.length - tall.length;
      if (chs) {
        // A shell's chains, across its top.
        const top = add(at.at, scale(at.up, (Math.max(1, ...tall.map((st) => STITCHES[st].height)) + 0.4) * U));
        for (let c = 0; c < chs; c++) {
          const mark: ChainMark = { kind: "chain", at: add(top, scale(along, (c - (chs - 1) / 2) * CHAIN_STEP)), dir: along, row: ri + 1 };
          const t: Top = { at: mark.at, up: at.up, chain: true, run };
          marks.push(mark);
          tops.push(t);
          made.push({ kind: "chain", mark, top: t });
          summary.chains++;
        }
        run++;
        used.add("ch");
      }
    };

    if (lead) {
      // The starting chain's column, from the first place up.
      const at = placeAt(0);
      if (!before) w.cursor = w.usedTo = 0;
      const column: ChainMark[] = [];
      for (let i = 0; i < lead; i++) column.push({ kind: "chain", at: add(at.at, scale(at.up, (i + 0.55) * 0.72 * U)), dir: at.up, row: ri + 1 });
      marks.push(...column);
      // Long enough to hold stitches (ch 5, counting as dc and ch 2), it is a space too.
      const top: Top = { at: add(at.at, scale(at.up, lead * 0.72 * U)), up: at.up, chain: lead >= 5, run: run++ };
      tops.push(top);
      made.push({ kind: "column", marks: column, top, base: at.at });
      w.last = w.first = top;
      summary.chains += lead;
      used.add("ch");
    }

    let join: StitchMark | null = null;
    for (const s of body) {
      if (s.kind === "chain") {
        w.pending += s.n;
        continue;
      }
      if (s.kind === "skip") {
        w.cursor += s.n;
        continue;
      }
      if (s.kind === "join") {
        // Back to the round's first stitch, with a slip stitch.
        flushChains(w.first);
        if (w.first) {
          join = { kind: "stitch", stitch: "sl", base: w.first.at, top: add(w.first.at, scale(w.first.up, 0.4 * U)), row: ri + 1 };
          marks.push(join);
          used.add("sl");
        }
        continue;
      }
      // Into a chain space: over the next run of chains, into its middle.
      if (s.space && before) {
        let i = Math.max(0, Math.ceil((w.cursor + 1) * crowd));
        while (i < places.length && !places[i].chain) i++;
        if (i < places.length) {
          let j = i;
          while (j + 1 < places.length && places[j + 1].chain && places[j + 1].run === places[i].run) j++;
          const middle = (i + j) / 2 / crowd;
          w.cursor = Math.max(w.cursor, Math.round(j / crowd));
          w.usedTo = Math.max(w.usedTo, w.cursor);
          workPlace(s.stitches, middle, placeAt(middle));
          continue;
        }
      }
      if (!s.same || w.cursor < 0) w.cursor++;
      w.usedTo = Math.max(w.usedTo, w.cursor);
      workPlace(s.stitches, w.cursor, placeAt(w.cursor));
    }
    flushChains(null);

    // A round goes round its own circle: what was made spaced evenly round
    // it from where the round starts, each stitch from where it is worked.
    let along = alongAt(0);
    if (data.shape === "rounds" && made.length) {
      const inner = Math.max(...places.map((p) => len(p.at)));
      const weight = (m: Made) => (m.kind === "chain" ? 0.75 : 1);
      const total = made.reduce((k, m) => k + weight(m), 0);
      const tallest = Math.max(0.9, ...made.map((m) => (m.kind === "stitch" ? m.h : 0)));
      const r = Math.max(inner + tallest * U, (total * 0.95 * U) / (2 * Math.PI));
      const polar = (radius: number, a: number): Pt => ({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
      // Each one's share of the way round, and the turn that sets them best over where they are worked.
      const shares: number[] = [];
      let c = 0;
      for (const m of made) {
        shares.push((-2 * Math.PI * c) / total);
        c += weight(m);
      }
      let sin = 0;
      let cos = 0;
      made.forEach((m, i) => {
        if (m.kind === "chain") return;
        const base = m.kind === "stitch" ? m.mark.base : m.base;
        const off = Math.atan2(base.y, base.x) - shares[i];
        sin += Math.sin(off);
        cos += Math.cos(off);
      });
      const start = sin || cos ? Math.atan2(sin, cos) : Math.atan2(placeAt(0).at.y, placeAt(0).at.x);
      // Each chain's run of chains, and where in it it is.
      const runs: { n: number; k: number }[] = [];
      for (let i = 0; i < made.length; ) {
        let j = i;
        while (j < made.length && made[j].kind === "chain") j++;
        if (j === i) {
          runs[i] = { n: 0, k: 0 };
          i++;
          continue;
        }
        for (let k = i; k < j; k++) runs[k] = { n: j - i, k: k - i };
        i = j;
      }
      made.forEach((m, i) => {
        const a = start + shares[i];
        const out = { x: Math.cos(a), y: Math.sin(a) };
        if (m.kind === "stitch") {
          const reach = Math.max(len(m.mark.base) + m.h * U, m.h < 1 ? 0 : r - (tallest - m.h) * U);
          m.top.at = polar(reach, a);
          m.top.up = out;
          m.mark.top = m.mark.stitch === "sl" ? add(m.mark.base, scale(unit({ x: m.top.at.x - m.mark.base.x, y: m.top.at.y - m.mark.base.y }), 0.4 * U)) : m.top.at;
        } else if (m.kind === "chain") {
          // A loop of chains arches out, the more the longer it is.
          const loop = runs[i];
          const lift = loop.n >= 3 ? Math.min(loop.n, 7) * 0.22 * U * Math.sin((Math.PI * (loop.k + 1)) / (loop.n + 1)) : 0;
          m.top.at = m.mark.at = polar(r - 0.25 * U + lift, a);
          m.top.up = out;
          m.mark.dir = rotate(out, -Math.PI / 2);
        } else {
          m.top.at = polar(r, a);
          m.top.up = out;
          const d = { x: m.top.at.x - m.base.x, y: m.top.at.y - m.base.y };
          m.marks.forEach((mk, i) => {
            mk.at = add(m.base, scale(d, (i + 0.5) / m.marks.length));
            mk.dir = unit(d);
          });
        }
      });
      if (join && w.first) {
        join.base = w.first.at;
        join.top = add(w.first.at, scale(w.first.up, 0.4 * U));
      }
      along = rotate({ x: Math.cos(start), y: Math.sin(start) }, -Math.PI / 2);
    }

    if (before) {
      summary.into = Math.min(before.length, Math.max(0, Math.round((w.usedTo + 1) * crowd)));
      summary.of = before.length;
    }
    // Its number by where it starts, the first's marked as the start.
    const startTop = tops[0] ?? places[0];
    if (startTop) marks.push(labelFor(startTop, along, ri + 1, first));
    rows.push(summary);
    prev = tops.length ? tops : prev;
  });

  return { marks, rows, box: boxOf(marks), used };
}

/** How many of the row before's stitches these are worked into: "in same" before any is the first. */
function countInto(steps: Step[]): number {
  let n = 0;
  for (const s of steps) n += s.kind === "place" ? (s.same && n > 0 ? 0 : 1) : s.kind === "skip" ? s.n : 0;
  return n;
}

/** The tallest stitch of a row, in stitch heights; a row of chains is a chain's. */
function rowHeight(steps: Step[]): number {
  let h = 0.6;
  for (const s of steps) if (s.kind === "place") for (const st of s.stitches) h = Math.max(h, STITCHES[st].height);
  return h;
}

/** A row's number, a little before where it starts and out from it. */
function labelFor(start: Top, along: Pt, n: number, first: boolean): Mark {
  const at = add(add(start.at, scale(along, -1.5 * U)), scale(start.up, 0.2 * U));
  return { kind: "label", at, text: String(n), first, dir: along };
}

function boxOf(marks: Mark[]): Layout["box"] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (p: Pt, pad = 0) => {
    x0 = Math.min(x0, p.x - pad);
    y0 = Math.min(y0, p.y - pad);
    x1 = Math.max(x1, p.x + pad);
    y1 = Math.max(y1, p.y + pad);
  };
  for (const m of marks) {
    if (m.kind === "stitch") {
      take(m.base, 4);
      take(m.top, 6);
    } else if (m.kind === "chain") take(m.at, 6);
    else if (m.kind === "ring") take(m.centre, m.r + 2);
    else take(m.at, 10);
  }
  if (!Number.isFinite(x0)) return { x: -50, y: -50, w: 100, h: 100 };
  const pad = U;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

// ---------- drawing ----------

const f = (n: number) => Math.round(n * 10) / 10;

/** One stitch's symbol, from where it is worked to its top. */
function stitchSvg(st: Exclude<Stitch, "ch">, base: Pt, top: Pt): string {
  const d = unit({ x: top.x - base.x, y: top.y - base.y });
  const p = { x: -d.y, y: d.x };
  const line = (a: Pt, b: Pt) => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`;
  if (st === "sl") {
    const at = add(base, scale(d, 0.2 * U));
    return `<ellipse cx="${f(at.x)}" cy="${f(at.y)}" rx="${f(0.22 * U)}" ry="${f(0.15 * U)}" transform="rotate(${f((Math.atan2(p.y, p.x) * 180) / Math.PI)} ${f(at.x)} ${f(at.y)})" class="fill"/>`;
  }
  if (st === "sc") {
    const c = add(base, scale(d, 0.5 * U));
    const a = 0.3 * U;
    return line(add(c, add(scale(d, a), scale(p, a))), add(c, add(scale(d, -a), scale(p, -a)))) + line(add(c, add(scale(d, a), scale(p, -a))), add(c, add(scale(d, -a), scale(p, a))));
  }
  if (st === "picot") {
    const c = add(base, scale(d, 0.35 * U));
    return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(0.3 * U)}"/>${line(base, add(base, scale(d, 0.05 * U)))}`;
  }
  // A stem with a bar across the top, and a slash across it for each yarn over.
  const bar = 0.3 * U;
  let out = line(base, top) + line(add(top, scale(p, -bar)), add(top, scale(p, bar)));
  const slashes = st === "dc" ? 1 : st === "tr" ? 2 : st === "dtr" ? 3 : 0;
  const stem = len({ x: top.x - base.x, y: top.y - base.y });
  for (let i = 0; i < slashes; i++) {
    const at = add(base, scale(d, stem * (0.5 + (i - (slashes - 1) / 2) * 0.18)));
    out += line(add(at, add(scale(p, -0.22 * U), scale(d, -0.12 * U))), add(at, add(scale(p, 0.22 * U), scale(d, 0.12 * U))));
  }
  return out;
}

function chainSvg(at: Pt, dir: Pt): string {
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  return `<ellipse cx="${f(at.x)}" cy="${f(at.y)}" rx="${f(0.36 * U)}" ry="${f(0.2 * U)}" transform="rotate(${f(angle)} ${f(at.x)} ${f(at.y)})"/>`;
}

/**
 * The diagram as an SVG: black on white, as a chart is printed, its rows
 * alternately darker and lighter, so where one ends and the next starts
 * shows. `title` names it for a screen reader.
 */
export function diagramSvg(data: CrochetData, title = "Crochet diagram", lay: Layout = layout(data)): string {
  const b = lay.box;
  const body: string[] = [];
  for (const m of lay.marks) {
    const tone = "row" in m && m.row % 2 === 0 ? ' class="even"' : "";
    if (m.kind === "ring") body.push(`<circle cx="${f(m.centre.x)}" cy="${f(m.centre.y)}" r="${f(m.r)}" class="ring"/>`);
    else if (m.kind === "chain") body.push(`<g${tone}>${chainSvg(m.at, m.dir)}</g>`);
    else if (m.kind === "stitch") body.push(`<g${tone}>${stitchSvg(m.stitch, m.base, m.top)}</g>`);
  }
  for (const m of lay.marks) {
    if (m.kind !== "label") continue;
    // The start: its number in a ring, an arrow the way it goes.
    if (m.first) {
      const tip = add(m.at, scale(m.dir, 0.95 * U));
      const back = add(m.at, scale(m.dir, 0.55 * U));
      const side = scale({ x: -m.dir.y, y: m.dir.x }, 0.22 * U);
      body.push(`<circle cx="${f(m.at.x)}" cy="${f(m.at.y)}" r="${f(0.5 * U)}" class="start"/><text x="${f(m.at.x)}" y="${f(m.at.y)}" class="num">${m.text}</text><path d="M${f(tip.x)} ${f(tip.y)} L${f(add(back, side).x)} ${f(add(back, side).y)} L${f(add(back, scale(side, -1)).x)} ${f(add(back, scale(side, -1)).y)}Z" class="fill"/>`);
    } else body.push(`<text x="${f(m.at.x)}" y="${f(m.at.y)}" class="num">${m.text}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x)} ${f(b.y)} ${f(b.w)} ${f(b.h)}" role="img" aria-label="${title.replace(/[<>&"]/g, "")}" class="crochet-svg">
<style>.crochet-svg{background:#fff}.crochet-svg line,.crochet-svg ellipse,.crochet-svg circle,.crochet-svg path{stroke:#222;stroke-width:1.3;fill:none;stroke-linecap:round}.crochet-svg .even line,.crochet-svg .even ellipse,.crochet-svg .even circle{stroke:#5a6b8c}.crochet-svg .fill{fill:#222;stroke:none}.crochet-svg .even .fill{fill:#5a6b8c}.crochet-svg .ring{stroke-dasharray:3 2}.crochet-svg .start{fill:#fff;stroke:#c0392b;stroke-width:1.4}.crochet-svg text.num{font:600 ${f(0.75 * U)}px system-ui,sans-serif;fill:#c0392b;text-anchor:middle;dominant-baseline:central}.crochet-svg path.fill{fill:#c0392b}</style>
<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="#fff"/>
${body.join("\n")}
</svg>`;
}

/** The stitches in the order they grow, shortest first. */
export const STITCH_ORDER: Stitch[] = ["ch", "sl", "sc", "hdc", "dc", "tr", "dtr", "picot"];

/** A stitch's symbol on its own, small, as an SVG coloured by `currentColor`. */
export function symbolOf(s: Stitch): string {
  const info = STITCHES[s];
  const base = { x: 0, y: 0.9 * U };
  const top = { x: 0, y: (0.9 - Math.max(info.height, 0.6)) * U };
  const symbol = s === "ch" ? chainSvg({ x: 0, y: 0 }, { x: 1, y: 0 }) : stitchSvg(s, base, top);
  const box = s === "ch" ? "-10 -10 20 20" : `-10 ${f(top.y - 6)} 20 ${f(base.y - top.y + 12)}`;
  return `<svg viewBox="${box}" aria-hidden="true">${symbol}</svg>`;
}

/** Each stitch used, its symbol drawn small, with its name in these terms. */
export function legendHtml(used: Set<Stitch>, terms: Terms): string {
  return STITCH_ORDER.filter((s) => used.has(s))
    .map((s) => `<span class="crochet-key">${symbolOf(s)}<b>${STITCHES[s][terms]}</b> ${terms === "us" ? STITCHES[s].usName : STITCHES[s].ukName}</span>`)
    .join("");
}

/** What a new diagram of each shape starts with: something to change, that shows how it is written. */
export const EXAMPLES: Record<Shape, { name: string; rows: string[]; terms: Terms }> = {
  rounds: {
    name: "A flat circle",
    terms: "us",
    rows: ["ch 3, 11 dc in ring, sl st to join", "ch 3, dc in same st, 2 dc in each st around, sl st to join", "ch 1, *sc, ch 3, sk 1* around, sl st to join"],
  },
  rows: {
    name: "Rows of shells",
    terms: "us",
    rows: ["ch 19", "sk 1, sc in each ch across", "ch 3, *sk 2, 5 dc in next, sk 2, sc* x 3"],
  },
  spiral: {
    name: "Spiral rose",
    terms: "us",
    rows: ["ch 40", "*sk 2, (5 dc) in next* around"],
  },
};

/** A round's, a row's name. */
export function rowWord(shape: Shape): string {
  return shape === "rounds" ? "Round" : "Row";
}
