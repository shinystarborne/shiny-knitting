/**
 * The knitting arithmetic behind the Calculators tab. No DOM, so the harness
 * checks it directly. Lengths are centimetres and gauges stitches and rows per
 * 10 cm throughout; the page converts to inches for showing.
 */

/** Stitches and rows per 10 cm. */
export interface Gauge {
  sts: number;
  rows: number;
}

/** A count rounded to the nearest even number, as a piece knitted in halves needs. */
export function even(n: number): number {
  return 2 * Math.round(n / 2);
}

/**
 * The count nearest to `exact` that is a multiple of `multiple` plus `plus`,
 * as a stitch pattern needs ("a multiple of 4, plus 2"). Never below one repeat.
 */
export function nearestRepeat(exact: number, multiple = 1, plus = 0): number {
  const m = Math.max(1, Math.round(multiple));
  const k = Math.max(1, Math.round((exact - plus) / m));
  return k * m + plus;
}

/**
 * The count nearest to `n` that a rib of `rib` stitches works out on: in the
 * round a whole number of repeats, so the rib meets itself; flat half a
 * repeat more, so the row begins and ends alike (k2, *p2, k2*). Any count
 * when no rib is given.
 */
export function ribCount(n: number, rib = 0, flat = false): number {
  if (!(rib >= 2)) return n;
  return flat ? nearestRepeat(n, rib, Math.floor(rib / 2)) : nearestRepeat(n, rib);
}

/** A round from one count to another, the stitches gained or lost spread evenly: "from the rib's 104 to 106: *K52, M1* 2 times." */
function evenRound(from: number, to: number, what: string, inRound = true): string {
  const s = spreadEvenly(from, to - from, inRound);
  return `${what}, from ${from} to ${to}: ${"error" in s ? `${to > from ? "increase" : "decrease"} ${Math.abs(to - from)} evenly.` : s.text}`;
}

// ---------- stitches and rows for a size ----------

export interface Sized {
  /** The count the size works out to, unrounded. */
  exact: number;
  /** The count to knit. */
  count: number;
  /** What that count actually measures. */
  cm: number;
}

/** The stitches for a width, fitted to a stitch pattern's repeat. */
export function stitchesFor(widthCm: number, gauge: Gauge, multiple = 1, plus = 0): Sized {
  const exact = (widthCm * gauge.sts) / 10;
  const count = nearestRepeat(exact, multiple, plus);
  return { exact, count, cm: (count * 10) / gauge.sts };
}

/** The rows for a length. */
export function rowsFor(lengthCm: number, gauge: Gauge): Sized {
  const exact = (lengthCm * gauge.rows) / 10;
  const count = Math.max(1, Math.round(exact));
  return { exact, count, cm: (count * 10) / gauge.rows };
}

// ---------- increasing or decreasing evenly ----------

export type Spread = { to: number; text: string; gaps: number[] } | { error: string };

/**
 * Spreads `change` increases (positive) or decreases (negative) as evenly as
 * can be across `stitches`, and writes it out: "*K6, M1* 4 times, *K5, M1* 4
 * times". In the round the shaping divides the stitches into equal parts;
 * worked flat it falls between them, none at the edges, and the slightly
 * longer stretches go at the ends.
 */
export function spreadEvenly(stitches: number, change: number, inRound: boolean): Spread {
  const n = Math.round(stitches);
  const c = Math.round(change);
  if (n < 1) return { error: "Give the stitches you have now." };
  if (!c) return { error: "Give how many stitches to increase (e.g. 8) or decrease (e.g. −8)." };
  const inc = c > 0;
  const count = Math.abs(c);
  // Plain stitches to share out: a decrease uses two stitches (k2tog).
  const plain = inc ? n : n - 2 * count;
  if (plain < 0) return { error: `${count} decreases need ${2 * count} stitches; there are ${n}. Knit 2 together all the way for ${Math.ceil(n / 2)}.` };
  const gapCount = inRound ? count : count + 1;
  if (inc && (inRound ? count > n : count > n - 1)) {
    return { error: `That is more increases than there are stitches to spread them between: knit into the front and back of every stitch for ${2 * n}.` };
  }
  const base = Math.floor(plain / gapCount);
  const extra = plain % gapCount;
  const gaps = new Array(gapCount).fill(base);
  // Worked flat the longer stretches go to the ends first, in the round to the start.
  const order = inRound ? [...gaps.keys()] : [...gaps.keys()].map((_, i) => (i % 2 ? gapCount - 1 - (i >> 1) : i >> 1));
  for (let i = 0; i < extra; i++) gaps[order[i]]++;
  const op = inc ? "M1" : "k2tog";
  const knit = (k: number) => (k ? `K${k}` : "");
  const runs = (list: number[], before: boolean) => {
    const out: string[] = [];
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j < list.length && list[j] === list[i]) j++;
      const unit = (before ? [knit(list[i]), op] : [op, knit(list[i])]).filter(Boolean).join(", ");
      out.push(j - i > 1 ? `*${unit}* ${j - i} times` : unit);
      i = j;
    }
    return out;
  };
  const parts = inRound ? runs(gaps, true) : [knit(gaps[0]), ...runs(gaps.slice(1), false)].filter(Boolean);
  return { to: n + c, text: `${parts.join(", ")}.`, gaps };
}

// ---------- yarns held together ----------

export interface Held {
  /** The strands together, in metres per 100 g. */
  metres: number;
  /** Grams of each strand in 100 g of the yarn held together, in the order given. */
  grams: number[];
}

/**
 * Strands held together as one yarn: a metre of it weighs what a metre of
 * each weighs, added up, so its metres per 100 g is one over the sum of one
 * over each (350, 1066 and 1500 m/100 g come to 214). Each strand's share of
 * the weight is its own weight per metre over theirs together.
 */
export function heldTogether(metresPer100g: number[]): Held | null {
  const strands = metresPer100g.filter((m) => m > 0);
  if (!strands.length) return null;
  const perMetre = strands.reduce((sum, m) => sum + 1 / m, 0);
  return { metres: 1 / perMetre, grams: strands.map((m) => (100 * (1 / m)) / perMetre) };
}

// ---------- re-gauging a pattern ----------

/** A pattern's count at its gauge, worked out at mine: the count for the same size, and the size as written. */
export function regauge(count: number, pattern: number, mine: number): { mine: number; patternCm: number; asWrittenCm: number } {
  return {
    mine: Math.round((count * mine) / pattern),
    patternCm: (count * 10) / pattern,
    asWrittenCm: (count * 10) / mine,
  };
}

// ---------- a top-down raglan, knitted in the round ----------

export interface RaglanInput {
  gauge: Gauge;
  /** Body measurements, in cm. */
  chest: number;
  upperArm: number;
  wrist: number;
  neck: number;
  /** From the top of the shoulder to the underarm. */
  yokeDepth: number;
  /** From the underarm to the wrist, cuff included. */
  armLength: number;
  /** From the underarm to the hem, hem rib included. */
  bodyLength: number;
  /** Ease added to each, in cm. The neck's is what lets it over the head. */
  bodyEase: number;
  sleeveEase: number;
  wristEase: number;
  neckEase: number;
  /** Cast on at each underarm when the sleeves are set aside, in cm. */
  underarm: number;
  /** Rib depths, in cm. */
  neckRib: number;
  hemRib: number;
  cuffRib: number;
  /** How much higher the back of the neck is than the front, by short rows, in cm; 0 or left out for none. */
  backNeck?: number;
  /** The stitches in one repeat of the rib: 2 for 1x1, 4 for 2x2; 0 or left out for any count. */
  rib?: number;
}

export interface RaglanResult {
  /** The neckband's stitches: the cast-on fitted to the rib, made the cast-on after it. */
  neckRibSts: number;
  castOn: number;
  /** Stitches at the cast-on: the back and front each, and each sleeve. */
  front0: number;
  sleeve0: number;
  /** Increase rounds for the body and for the sleeves; the larger is the yoke's. */
  bodyIncreases: number;
  sleeveIncreases: number;
  /** How they are spaced: on every round, then every other round, then plain rounds. */
  everyRound: number;
  everyOther: number;
  plainRounds: number;
  yokeRounds: number;
  /** Stitches when the sleeves are set aside: the back and front each, and each sleeve. */
  front: number;
  sleeve: number;
  underarmSts: number;
  body: number;
  bodyRounds: number;
  hemRounds: number;
  neckRibRounds: number;
  upperArmSts: number;
  wristSts: number;
  /** Sleeve decrease rounds (2 stitches each), every `sleeveEvery` rounds. */
  sleeveDecreases: number;
  sleeveEvery: number;
  sleeveRounds: number;
  cuffRounds: number;
  /** What it measures, knitted, in cm. */
  finished: { chest: number; upperArm: number; wrist: number; neck: number; yokeDepth: number };
  warnings: string[];
}

/**
 * Works out a top-down raglan knitted in the round.
 *
 * The neck is cast on and split four ways at the raglan lines; each increase
 * round adds a stitch each side of each line, 8 in all. The back and front
 * grow to half the body less the underarm cast-on, the sleeves to the upper
 * arm less theirs; when they need different numbers of increase rounds (a
 * small neck on a big body, say) the extra rounds increase on the body or the
 * sleeves only. The increases are spaced to fill the yoke's depth: every other
 * round where there is room, some on every round where there is not.
 */
/**
 * What a sweater knitted from the top down has below its yoke, whatever the
 * yoke: the body, the underarms, and the sleeves from the upper arm to the
 * wrist. Shared by the raglan and the round yoke.
 */
export interface Pieces {
  spc: number;
  rpc: number;
  body: number;
  underarmSts: number;
  upperArmSts: number;
  /** At the underarm: the back and front each, and each sleeve, less the underarm. */
  front: number;
  sleeve: number;
  bodyRounds: number;
  hemRounds: number;
  neckRibRounds: number;
  wristSts: number;
  sleeveDecreases: number;
  sleeveEvery: number;
  sleeveRounds: number;
  cuffRounds: number;
  warnings: string[];
}

export function pieces(i: RaglanInput, depthName = "armhole depth"): Pieces | { error: string } {
  const spc = i.gauge.sts / 10;
  const rpc = i.gauge.rows / 10;
  if (!(spc > 0) || !(rpc > 0)) return { error: "Give the gauge: stitches and rows." };
  for (const [v, what] of [[i.chest, "chest"], [i.upperArm, "upper arm"], [i.wrist, "wrist"], [i.neck, "neck"], [i.yokeDepth, depthName], [i.armLength, "arm length"], [i.bodyLength, "body length"]] as const) {
    if (!(v > 0)) return { error: `Give the ${what}.` };
  }
  const warnings: string[] = [];
  // A whole number of rib repeats round the hem and the cuff, kept even for the halves.
  const rib = (i.rib ?? 0) >= 2 ? i.rib! : 0;
  const ribEven = rib % 2 ? 2 * rib : rib;
  const body = ribEven ? nearestRepeat(even((i.chest + i.bodyEase) * spc), ribEven) : even((i.chest + i.bodyEase) * spc);
  const underarmSts = Math.max(2, even(i.underarm * spc));
  const upperArmSts = even((i.upperArm + i.sleeveEase) * spc);
  const front = body / 2 - underarmSts;
  const sleeve = upperArmSts - underarmSts;
  if (sleeve < 2 || front < 2) return { error: "The underarm cast-on is wider than the sleeve or body: make it smaller." };
  let wristSts = Math.min(upperArmSts, even((i.wrist + i.wristEase) * spc));
  if (ribEven) {
    wristSts = nearestRepeat(wristSts, ribEven);
    while (wristSts > upperArmSts && wristSts > ribEven) wristSts -= ribEven;
  }
  const sleeveDecreases = (upperArmSts - wristSts) / 2;
  const sleeveRounds = Math.max(0, Math.round((i.armLength - i.cuffRib) * rpc));
  const sleeveEvery = sleeveDecreases ? Math.floor(sleeveRounds / (sleeveDecreases + 1)) : 0;
  if (sleeveDecreases && sleeveEvery < 2) {
    warnings.push(`The sleeve narrows by ${sleeveDecreases * 2} stitches in only ${sleeveRounds} rounds: decrease on every round, or give more wrist ease.`);
  }
  return {
    spc,
    rpc,
    body,
    underarmSts,
    upperArmSts,
    front,
    sleeve,
    bodyRounds: Math.max(0, Math.round((i.bodyLength - i.hemRib) * rpc)),
    hemRounds: Math.max(1, Math.round(i.hemRib * rpc)),
    neckRibRounds: Math.max(1, Math.round(i.neckRib * rpc)),
    wristSts,
    sleeveDecreases,
    sleeveEvery: Math.max(1, sleeveEvery),
    sleeveRounds,
    cuffRounds: Math.max(1, Math.round(i.cuffRib * rpc)),
    warnings,
  };
}

export function raglan(i: RaglanInput): RaglanResult | { error: string } {
  const p = pieces(i);
  if ("error" in p) return p;
  const { spc, rpc, body, front, sleeve, underarmSts, upperArmSts } = p;
  const warnings = [...p.warnings];

  // The cast-on split so both grow by the same number of rounds, if it can be.
  const neckTarget = (i.neck + i.neckEase) * spc;
  const shared = Math.max(0, Math.round((2 * front + 2 * sleeve - neckTarget) / 8));
  let front0 = front - 2 * shared;
  let sleeve0 = sleeve - 2 * shared;
  // A sleeve starts with at least a little: about 2.5 cm, with the body growing more.
  const minSleeve = Math.max(2, Math.round(2.5 * spc));
  if (sleeve0 < minSleeve) {
    sleeve0 = minSleeve + ((sleeve - minSleeve) % 2);
    front0 = Math.round((neckTarget - 2 * sleeve0) / 2);
    if ((front - front0) % 2) front0 += 1;
  }
  if (front0 < 2) return { error: "The neck opening is wider than the yoke needs: give less neck ease, or more body ease." };
  if (front0 > front || sleeve0 > sleeve) return { error: "The neck opening is as wide as the yoke: give less neck ease, or more body ease." };
  const castOn = 2 * front0 + 2 * sleeve0;
  const bodyIncreases = (front - front0) / 2;
  const sleeveIncreases = (sleeve - sleeve0) / 2;
  if (bodyIncreases !== sleeveIncreases) {
    const more = bodyIncreases > sleeveIncreases ? "body" : "sleeves";
    warnings.push(`The ${more} need ${Math.abs(bodyIncreases - sleeveIncreases)} more increase rounds than the ${more === "body" ? "sleeves" : "body"}: on those, increase on the ${more} only.`);
  }

  const most = Math.max(bodyIncreases, sleeveIncreases);
  const depthRounds = Math.round(i.yokeDepth * rpc);
  let everyRound = 0;
  let everyOther = 0;
  let plainRounds = 0;
  if (most > depthRounds) {
    everyRound = most;
    warnings.push(`Even increasing on every round, the yoke needs ${most} rounds, about ${round1(most / rpc)} cm, more than the ${round1(i.yokeDepth)} cm armhole depth. Cast on more at the underarm, or allow a deeper yoke.`);
  } else if (2 * most <= depthRounds) {
    everyOther = most;
    plainRounds = depthRounds - 2 * most;
  } else {
    everyRound = 2 * most - depthRounds;
    everyOther = depthRounds - most;
  }
  const yokeRounds = everyRound + 2 * everyOther + plainRounds;

  return {
    neckRibSts: ribCount(castOn, i.rib),
    castOn,
    front0,
    sleeve0,
    bodyIncreases,
    sleeveIncreases,
    everyRound,
    everyOther,
    plainRounds,
    yokeRounds,
    front,
    sleeve,
    underarmSts,
    body,
    bodyRounds: p.bodyRounds,
    hemRounds: p.hemRounds,
    neckRibRounds: p.neckRibRounds,
    upperArmSts,
    wristSts: p.wristSts,
    sleeveDecreases: p.sleeveDecreases,
    sleeveEvery: p.sleeveEvery,
    sleeveRounds: p.sleeveRounds,
    cuffRounds: p.cuffRounds,
    finished: {
      chest: body / spc,
      upperArm: upperArmSts / spc,
      wrist: p.wristSts / spc,
      neck: castOn / spc,
      yokeDepth: yokeRounds / rpc,
    },
    warnings,
  };
}

// ---------- a round yoke (lopapeysa), top-down in the round ----------

/** One of a round yoke's increase rounds: where it goes, and how. */
export interface YokeRound {
  /** How far below the neckband it is worked. */
  atCm: number;
  atRound: number;
  from: number;
  to: number;
  /** The round written out: "*K3, M1* 32 times." */
  text: string;
}

export interface RoundYokeResult {
  /** The neckband's stitches: the cast-on fitted to the rib, made the cast-on after it. */
  neckRibSts: number;
  castOn: number;
  rounds: YokeRound[];
  /** The stitches the last increase round leaves, and the yoke's at the split; they differ by a little when a pattern repeat rounded the counts. */
  yokeEnd: number;
  yokeTotal: number;
  /** The round that brings the yoke from the repeat's count to the split's, if they differ. */
  adjust: YokeRound | null;
  yokeRounds: number;
  pieces: Pieces;
  finished: { chest: number; upperArm: number; wrist: number; neck: number; yokeDepth: number };
  warnings: string[];
}

/**
 * Works out a round yoke knitted from the neck down, as an Icelandic
 * lopapeysa is when knitted top-down.
 *
 * A few increase rounds (three is the classic) each grow the yoke by the same
 * fraction, so the steps get bigger towards the underarm. They are spaced as
 * in Elizabeth Zimmermann's percentage system: counted from the underarm, the
 * first halfway up, the last near the neck. Counts can be kept to a multiple
 * of the colourwork's repeat. At the
 * underarm it splits as a raglan does: the back and front, the sleeves on
 * hold, a few stitches cast on under each arm.
 */
export function roundYoke(i: RaglanInput, increases = 3, repeat = 1): RoundYokeResult | { error: string } {
  const p = pieces(i, "yoke depth");
  if ("error" in p) return p;
  const warnings = [...p.warnings];
  const yokeTotal = 2 * p.front + 2 * p.sleeve;
  const neckTarget = (i.neck + i.neckEase) * p.spc;
  if (neckTarget >= yokeTotal) return { error: "The neck opening is as wide as the yoke: give less neck ease, or more body ease." };
  const k = Math.max(1, Math.min(8, Math.round(increases)));
  const rep = Math.max(1, Math.round(repeat));
  // Counts from the underarm up: the yoke, each step smaller by the same
  // fraction, the neck last; each kept to the repeat.
  const ratio = (neckTarget / yokeTotal) ** (1 / k);
  // The neck kept to the rib as well, when both fit in a small step; else a round after the neckband makes it so.
  const rib = (i.rib ?? 0) >= 2 ? i.rib! : 1;
  const both = (rep * rib) / gcd(rep, rib);
  const neckRep = both <= Math.max(12, rep) ? both : rep;
  const counts = [nearestRepeat(yokeTotal, rep)];
  for (let s = 1; s <= k; s++) counts.push(s === k ? nearestRepeat(neckTarget, neckRep) : nearestRepeat(yokeTotal * ratio ** s, rep));
  if (ratio < 0.5) return { error: `${k} increase rounds would each more than double the stitches: choose more increase rounds.` };
  const depthRounds = Math.round(i.yokeDepth * p.rpc);
  const yokeEnd = counts[0];
  const castOn = counts[k];
  const rounds: YokeRound[] = [];
  // Listed from the neck down: the smallest count grows first.
  for (let s = k; s >= 1; s--) {
    const wide = counts[s - 1];
    const narrow = counts[s];
    if (wide === narrow) continue;
    // Placed as Elizabeth Zimmermann's percentage system places them: the
    // first (counted from the underarm) halfway up the yoke, the rest evenly
    // from there to nine tenths of the way, since a yoke stays wide over the
    // shoulders and narrows fastest near the neck.
    const fromUnderarm = i.yokeDepth * (k === 1 ? 0.5 : 0.5 + (0.4 * (s - 1)) / (k - 1));
    const atCm = Math.max(0, i.yokeDepth - fromUnderarm);
    const spread = spreadEvenly(narrow, wide - narrow, true);
    if ("error" in spread) return { error: `From ${narrow} to ${wide} is too big a step: choose more increase rounds.` };
    rounds.push({ atCm, atRound: Math.round(atCm * p.rpc), from: narrow, to: wide, text: spread.text });
  }
  let adjust: YokeRound | null = null;
  if (yokeEnd !== yokeTotal) {
    const spread = spreadEvenly(yokeEnd, yokeTotal - yokeEnd, true);
    if ("error" in spread) return { error: "The pattern repeat is too large for this yoke." };
    adjust = { atCm: i.yokeDepth, atRound: depthRounds, from: yokeEnd, to: yokeTotal, text: spread.text };
  }
  return {
    neckRibSts: ribCount(castOn, i.rib),
    castOn,
    rounds,
    yokeEnd,
    yokeTotal,
    adjust,
    yokeRounds: depthRounds,
    pieces: p,
    finished: {
      chest: p.body / p.spc,
      upperArm: p.upperArmSts / p.spc,
      wrist: p.wristSts / p.spc,
      neck: castOn / p.spc,
      yokeDepth: depthRounds / p.rpc,
    },
    warnings,
  };
}

/** The body and sleeves, once the yoke is split: the same for every top-down yoke. */
type Below = Pick<Pieces, "front" | "sleeve" | "underarmSts" | "body" | "bodyRounds" | "hemRounds" | "upperArmSts" | "sleeveDecreases" | "sleeveEvery" | "wristSts" | "cuffRounds">;

function belowTheYoke(p: Below, i: RaglanInput, len: (cm: number) => string): string[] {
  const steps: string[] = [];
  steps.push(
    `Separate: knit the back's ${p.front}, put the sleeve's ${p.sleeve} on hold, cast on ${p.underarmSts} for the underarm, knit the front's ${p.front}, put the other sleeve on hold, cast on ${p.underarmSts}. The body has ${p.body} stitches.`,
  );
  steps.push(`Body: knit ${p.bodyRounds} rounds (${len(i.bodyLength - i.hemRib)}), then ${p.hemRounds} rounds of rib (${len(i.hemRib)}). Bind off.`);
  steps.push(
    `Sleeves: pick up ${p.underarmSts} stitches at the underarm and knit the ${p.sleeve} held: ${p.upperArmSts} stitches, the start of the round at the middle of the underarm.`,
  );
  if (p.sleeveDecreases) {
    steps.push(
      `Decrease round: k1, k2tog, knit to 3 stitches before the end, ssk, k1: 2 stitches fewer. Work it every ${p.sleeveEvery} rounds ${p.sleeveDecreases} times, to ${p.wristSts} stitches, and knit until the sleeve measures ${len(i.armLength - i.cuffRib)} from the underarm.`,
    );
  } else {
    steps.push(`Knit until the sleeve measures ${len(i.armLength - i.cuffRib)} from the underarm.`);
  }
  steps.push(`Cuff: ${p.cuffRounds} rounds of rib (${len(i.cuffRib)}). Bind off.`);
  return steps;
}

/** The round yoke as written steps, from the neck down. */
export function roundYokeSteps(r: RoundYokeResult, i: RaglanInput, len: (cm: number) => string): string[] {
  const p = r.pieces;
  const steps: string[] = [];
  steps.push(`Cast on ${r.neckRibSts} stitches. Join to knit in the round, and work ${p.neckRibRounds} rounds of rib (${len(i.neckRib)}) for the neckband.`);
  if (r.neckRibSts !== r.castOn) steps.push(evenRound(r.neckRibSts, r.castOn, "Next round, from the rib's count to the yoke's"));
  // The neck shared as the body and sleeves share the yoke's last round.
  const back = Math.round((r.castOn * p.front) / r.yokeTotal);
  const sleeve = Math.round((r.castOn * p.sleeve) / r.yokeTotal);
  const raised = backNeck(i, sleeve, r.castOn - back - 2 * sleeve);
  if (raised) {
    steps.push(`The round starts at an edge of the back: the next ${back} stitches are the back, then ${sleeve} a shoulder, the front, and ${sleeve} the other shoulder.`);
    steps.push(...backNeckSteps(raised, back, "", false, len));
  }
  steps.push("Knit the yoke in rounds, the colourwork if there is one, with these increase rounds, measured from the neckband:");
  for (const round of r.rounds) {
    steps.push(`At ${len(round.atCm)} (round ${round.atRound}), from ${round.from} to ${round.to}: ${round.text}`);
  }
  steps.push(`Knit until the yoke measures ${len(r.finished.yokeDepth)} from the neckband.`);
  if (r.adjust) steps.push(`Then one round from ${r.adjust.from} to ${r.adjust.to}, to split evenly: ${r.adjust.text}`);
  steps.push(
    `Place markers to divide the ${r.yokeTotal} stitches: ${p.front} for the back, ${p.sleeve} for a sleeve, ${p.front} for the front, ${p.sleeve} for the other sleeve.`,
  );
  steps.push(...belowTheYoke(p, i, len));
  return steps;
}

/**
 * The same raglan worked from the bottom up: the body from the hem and the
 * sleeves from the cuff, joined at the underarms, and the yoke decreased to
 * the neck. Every count is the top-down one, met in the other order: the
 * plain rounds come first, by the underarm, and the decreases close in on the
 * neck where the top-down increases began.
 */
export function raglanBottomUpSteps(r: RaglanResult, i: RaglanInput, len: (cm: number) => string): string[] {
  const steps: string[] = [];
  const half = r.underarmSts / 2;
  steps.push(
    `Sleeves (two the same): cast on ${r.wristSts} stitches, join to knit in the round, and work ${r.cuffRounds} rounds of rib (${len(i.cuffRib)}) for the cuff.`,
  );
  if (r.sleeveDecreases) {
    steps.push(
      `Increase round: k1, make 1 left, knit to the last stitch, make 1 right, k1: 2 stitches more. Work it every ${r.sleeveEvery} rounds ${r.sleeveDecreases} times, to ${r.upperArmSts} stitches, and knit until the sleeve measures ${len(i.armLength)} from the cast-on.`,
    );
  } else {
    steps.push(`Knit until the sleeve measures ${len(i.armLength)} from the cast-on.`);
  }
  steps.push(
    `Put the underarm on hold: the last ${Math.floor(half)} and the first ${Math.ceil(half)} stitches of the round, ${r.underarmSts} in all. ${r.sleeve} stay for the yoke. Keep each sleeve aside.`,
  );
  steps.push(
    `Body: cast on ${r.body} stitches, join to knit in the round, work ${r.hemRounds} rounds of rib (${len(i.hemRib)}), then knit ${r.bodyRounds} rounds, until it measures ${len(i.bodyLength)} from the cast-on.`,
  );
  steps.push(
    `Put the underarms on hold: the last ${Math.floor(half)} and the first ${Math.ceil(half)} stitches of the round, and the ${r.underarmSts} halfway round. ${r.front} stay each for the back and front.`,
  );
  steps.push(
    `Join: knit the back's ${r.front}, place a marker, a sleeve's ${r.sleeve}, place a marker, the front's ${r.front}, place a marker, the other sleeve's ${r.sleeve}, and place the marker for the start of the round: ${2 * r.front + 2 * r.sleeve} stitches.`,
  );
  if (r.plainRounds) steps.push(`Knit ${r.plainRounds} rounds plain.`);
  steps.push("Decrease round: *knit to 3 stitches before the marker, ssk, k1, slip the marker, k1, k2tog*, 4 times, knit to the end: 8 stitches fewer.");
  const both = Math.min(r.bodyIncreases, r.sleeveIncreases);
  const only = Math.abs(r.bodyIncreases - r.sleeveIncreases);
  const where = r.bodyIncreases > r.sleeveIncreases ? "the back and front" : "the sleeves";
  const spacing = [
    r.everyOther ? `on every other round ${r.everyOther} times` : "",
    r.everyRound ? `${r.everyOther ? "then " : ""}on every round ${r.everyRound} times` : "",
  ].filter(Boolean);
  steps.push(
    `Work ${Math.max(r.bodyIncreases, r.sleeveIncreases)} decrease rounds: ${spacing.join(", ")}.${
      only ? ` ${both} of them decrease at all 8 places; on the other ${only}, decrease only on ${where} (4 stitches fewer), spread among the rest.` : ""
    } The yoke measures ${len(r.finished.yokeDepth)}.`,
  );
  steps.push(`You have ${r.front0} stitches each for the back and front, and ${r.sleeve0} for each sleeve: ${r.castOn} in all.`);
  const raised = backNeck(i, r.sleeve0, r.front0);
  if (raised) steps.push(...backNeckSteps(raised, r.front0, "", false, len));
  if (r.neckRibSts !== r.castOn) steps.push(evenRound(r.castOn, r.neckRibSts, "Next round, to a count the rib fits"));
  steps.push(`Neckband: ${r.neckRibRounds} rounds of rib (${len(i.neckRib)}). Bind off loosely, so it goes over the head.`);
  steps.push(`Graft the ${r.underarmSts} held stitches of each underarm, sleeve to body, with Kitchener stitch.`);
  return steps;
}

// ---------- the raglan worked flat, as a cardigan ----------

export interface CardiganResult {
  r: RaglanResult;
  /** The front band's width in stitches: what the two fronts are short of the back, together. */
  bandSts: number;
  /** Each front at the cast-on and at the split. */
  front0: number;
  front: number;
  /** Stitches cast on: the two fronts, the back and the sleeves, without the bands. */
  castOn: number;
  /** The body below the split, without the bands. */
  body: number;
  /** Stitches picked up along each front edge, rows for the bands, and where the buttonholes go. */
  bandPickUp: number;
  bandRows: number;
  buttons: number;
  /** Stitches before the first buttonhole, and between each and the next. */
  firstHole: number;
  holeEvery: number;
  /** The neckband, picked up round the neck and the tops of the bands. */
  neckPickUp: number;
  /** The hem's rib, the body made it on the last row before it. */
  hemRibSts: number;
  warnings: string[];
}

/**
 * The top-down raglan worked flat, open at the front as a cardigan: the same
 * yoke, its fronts each half the front less half a band, the bands picked up
 * along the front edges at the end -- one with the buttonholes, spaced evenly
 * -- and a neckband round the top. Increases on the right-side rows; where the
 * yoke is too shallow for that, on wrong-side rows too.
 */
export function cardigan(i: RaglanInput, bandWidth: number, buttons: number): CardiganResult | { error: string } {
  const r = raglan(i);
  if ("error" in r) return r;
  if (!(bandWidth > 0)) return { error: "Give the front band's width." };
  const spc = i.gauge.sts / 10;
  const rpc = i.gauge.rows / 10;
  const bandSts = Math.max(2, even(bandWidth * spc));
  const front0 = (r.front0 - bandSts) / 2;
  if (front0 < 1) return { error: "The front band is wider than the front of the neck: make it narrower." };
  const warnings = [...r.warnings];
  // Odd halves are rounded down: the fronts are then a stitch narrower than the
  // back, which the band's width covers.
  const f0 = Math.floor(front0);
  if (f0 !== front0) warnings.push("The front band takes an odd number of stitches from the neck: each front is a stitch narrower, which the bands cover.");
  const front = f0 + r.bodyIncreases;
  const castOn = 2 * f0 + r.front0 + 2 * r.sleeve0;
  const body = 2 * front + r.front + 2 * r.underarmSts;
  // Along a front edge: the yoke and the body, picked up 3 stitches in every 4 rows.
  const edgeRows = r.yokeRounds + r.bodyRounds + r.hemRounds + r.neckRibRounds;
  const bandPickUp = ribCount(Math.max(4, Math.round((edgeRows * 3) / 4)), i.rib, true);
  const bandRows = Math.max(2, Math.round(bandWidth * rpc));
  const holes = Math.max(0, Math.round(buttons));
  // Evenly spaced along the band, the top and bottom ones near the ends.
  const holeEvery = holes > 1 ? Math.floor((bandPickUp - 6) / (holes - 1)) : 0;
  const firstHole = holes ? Math.max(2, Math.floor((bandPickUp - (holes - 1) * holeEvery) / 2)) : 0;
  if (holes > 1 && holeEvery < 4) warnings.push(`${holes} buttons are too many for a ${bandPickUp}-stitch band: give fewer.`);
  const neckPickUp = ribCount(castOn + 2 * Math.max(2, Math.round((bandRows * 3) / 4)), i.rib, true);
  const hemRibSts = ribCount(body, i.rib, true);
  return { r, bandSts, front0: f0, front, castOn, body, bandPickUp, bandRows, buttons: holes, firstHole, holeEvery, neckPickUp, hemRibSts, warnings };
}

/** The cardigan as written steps, from the neck down. */
export function cardiganSteps(c: CardiganResult, i: RaglanInput, len: (cm: number) => string): string[] {
  const r = c.r;
  const steps: string[] = [];
  steps.push(`Cast on ${c.castOn} stitches. Work flat, in rows.`);
  steps.push(
    `Set-up row (wrong side): purl ${c.front0} for the right front, place a marker, ${r.sleeve0} for a sleeve, place a marker, ${r.front0} for the back, place a marker, ${r.sleeve0} for the other sleeve, place a marker, ${c.front0} for the left front.`,
  );
  const raised = backNeck(i, r.sleeve0, 2 * c.front0);
  if (raised) steps.push(...backNeckSteps(raised, r.front0, `knit the left front's ${c.front0} and the sleeve's ${r.sleeve0}, then `, true, len));
  steps.push("Increase row (right side): *knit to 1 stitch before the marker, make 1 right, k1, slip the marker, k1, make 1 left*, 4 times, knit to the end: 8 stitches more.");
  const both = Math.min(r.bodyIncreases, r.sleeveIncreases);
  const only = Math.abs(r.bodyIncreases - r.sleeveIncreases);
  const where = r.bodyIncreases > r.sleeveIncreases ? "the back and fronts" : "the sleeves";
  const spacing = [
    r.everyRound ? `on the right side and the wrong side, every row, ${r.everyRound} times (on a wrong-side row, make 1 purlwise)` : "",
    r.everyOther ? `${r.everyRound ? "then " : ""}on every right-side row ${r.everyOther} times` : "",
  ].filter(Boolean);
  steps.push(
    `Work ${Math.max(r.bodyIncreases, r.sleeveIncreases)} increase rows: ${spacing.join(", ")}.${
      only ? ` ${both} of them increase at all 8 places; on the other ${only}, increase only on ${where}.` : ""
    }`,
  );
  if (r.plainRounds) steps.push(`Work ${r.plainRounds} rows plain, until the yoke measures ${len(r.finished.yokeDepth)} from the cast-on.`);
  steps.push(`You have ${c.front} stitches for each front, ${r.front} for the back, and ${r.sleeve} for each sleeve.`);
  steps.push(
    `Separate (right side): knit the left front's ${c.front}, put the sleeve's ${r.sleeve} on hold, cast on ${r.underarmSts} for the underarm, knit the back's ${r.front}, put the other sleeve on hold, cast on ${r.underarmSts}, knit the right front's ${c.front}. The body has ${c.body} stitches.`,
  );
  if (c.hemRibSts !== c.body) {
    steps.push(`Body: work ${r.bodyRounds} rows (${len(i.bodyLength - i.hemRib)}).`);
    steps.push(evenRound(c.body, c.hemRibSts, "Next row (right side), to a count the rib fits", false));
    steps.push(`Hem: ${r.hemRounds} rows of rib (${len(i.hemRib)}). Bind off.`);
  } else {
    steps.push(`Body: work ${r.bodyRounds} rows (${len(i.bodyLength - i.hemRib)}), then ${r.hemRounds} rows of rib (${len(i.hemRib)}). Bind off.`);
  }
  steps.push(
    `Sleeves, in the round: pick up ${r.underarmSts} stitches at the underarm and knit the ${r.sleeve} held: ${r.upperArmSts} stitches, the start of the round at the middle of the underarm.`,
  );
  if (r.sleeveDecreases) {
    steps.push(
      `Decrease round: k1, k2tog, knit to 3 stitches before the end, ssk, k1: 2 stitches fewer. Work it every ${r.sleeveEvery} rounds ${r.sleeveDecreases} times, to ${r.wristSts} stitches, and knit until the sleeve measures ${len(i.armLength - i.cuffRib)} from the underarm.`,
    );
  } else {
    steps.push(`Knit until the sleeve measures ${len(i.armLength - i.cuffRib)} from the underarm.`);
  }
  steps.push(`Cuff: ${r.cuffRounds} rounds of rib (${len(i.cuffRib)}). Bind off.`);
  steps.push(`Button band: along the left front edge, from the neck down, pick up ${c.bandPickUp} stitches (3 in every 4 rows). Work ${c.bandRows} rows of rib (${len(c.bandSts / (i.gauge.sts / 10))}). Bind off in rib.`);
  if (c.buttons) {
    const holes = c.buttons > 1 ? `, then every ${c.holeEvery} stitches after it, ${c.buttons} buttonholes in all` : "";
    steps.push(
      `Buttonhole band: along the right front edge, from the hem up, pick up ${c.bandPickUp} stitches. Halfway through its ${c.bandRows} rows, make the buttonholes: the first ${c.firstHole} stitches from the hem${holes} -- for each, bind off 2 and cast them on again on the next row. Finish the rows and bind off in rib.`,
    );
  } else {
    steps.push(`Other band: along the right front edge, from the hem up, pick up ${c.bandPickUp} stitches, work ${c.bandRows} rows of rib, and bind off in rib.`);
  }
  steps.push(`Neckband: pick up ${c.neckPickUp} stitches round the neck and the tops of the bands, work ${r.neckRibRounds} rows of rib (${len(i.neckRib)}), and bind off loosely.`);
  return steps;
}

// ---------- a raised back neck, by short rows ----------

export interface BackNeck {
  /** Short-row pairs, each two rows more across the back than the front. */
  pairs: number;
  /** Turned this many stitches past each edge of the back the first time, and this many further each time after. */
  first: number;
  step: number;
  /** What it raises the back by, knitted. */
  cm: number;
}

/**
 * Short rows across the back of a raglan's neck, so the back is higher than
 * the front and the neck sits where a neck does. Each pair turns a little
 * further from the back, into the sleeves and on towards the front, stopping
 * short of the front's middle. None when nothing is asked.
 */
export function backNeck(i: RaglanInput, sleeve: number, front: number): BackNeck | null {
  const want = i.backNeck ?? 0;
  if (!(want > 0)) return null;
  const rpc = i.gauge.rows / 10;
  const asked = Math.max(1, Math.round((want * rpc) / 2));
  // From each edge of the back, through a sleeve and up to a little short of the front's middle.
  const room = Math.max(1, sleeve + Math.floor(front / 2) - 3);
  const first = Math.min(room, Math.max(2, Math.round(sleeve / 2)));
  const pairs = Math.min(asked, room - first + 1);
  const step = pairs > 1 ? Math.max(1, Math.floor((room - first) / (pairs - 1))) : 0;
  return { pairs, first, step, cm: (pairs * 2) / rpc };
}

/**
 * The short rows in words, begun on the right side at the back's first
 * stitch (`lead` says how to get there); flat, the rows then go on to the
 * ends, in the round to the end of the round and once all round.
 */
function backNeckSteps(b: BackNeck, back: number, lead: string, flat: boolean, len: (cm: number) => string): string[] {
  const steps = [
    `Raise the back of the neck by ${len(b.cm)} with ${b.pairs} pairs of German short rows across the back. Row 1 (right side): ${lead}knit the back's ${back} and ${b.first} more, turn. Row 2: make a double stitch, purl across the back and ${b.first} past its other edge, turn.`,
  ];
  if (b.pairs > 1) {
    steps.push(
      `Then ${b.pairs - 1} more pairs, each turning ${b.step} further: make a double stitch, knit to the double stitch, knit it as one, knit ${b.step} more, turn; make a double stitch, purl to the double stitch, purl it as one, purl ${b.step} more, turn.`,
    );
  }
  steps.push(
    flat
      ? "Make a double stitch and knit to the end of the row, knitting the double stitch you come to as one. Next row (wrong side): purl to the end, purling the other as one."
      : "Make a double stitch and knit to the end of the round. Next round: knit all round, knitting both double stitches each as one.",
  );
  return steps;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The raglan as written steps, with lengths written by `len` (so in the unit
 * chosen): what to cast on, how the increases go, where to split, the body
 * and the sleeves.
 */
export function raglanSteps(r: RaglanResult, i: RaglanInput, len: (cm: number) => string): string[] {
  const steps: string[] = [];
  steps.push(`Cast on ${r.neckRibSts} stitches. Join to knit in the round, and work ${r.neckRibRounds} rounds of rib (${len(i.neckRib)}) for the neckband.`);
  if (r.neckRibSts !== r.castOn) steps.push(evenRound(r.neckRibSts, r.castOn, "Next round, from the rib's count to the yoke's"));
  steps.push(
    `Set up: knit ${r.front0} for the back, place a marker, ${r.sleeve0} for a sleeve, place a marker, ${r.front0} for the front, place a marker, ${r.sleeve0} for the other sleeve, place the marker for the start of the round.`,
  );
  const raised = backNeck(i, r.sleeve0, r.front0);
  if (raised) steps.push(...backNeckSteps(raised, r.front0, "", false, len));
  const both = Math.min(r.bodyIncreases, r.sleeveIncreases);
  const only = Math.abs(r.bodyIncreases - r.sleeveIncreases);
  const where = r.bodyIncreases > r.sleeveIncreases ? "the back and front" : "the sleeves";
  steps.push(
    "Increase round: *knit to 1 stitch before the marker, make 1 right, k1, slip the marker, k1, make 1 left*, 4 times, knit to the end: 8 stitches more.",
  );
  const spacing = [
    r.everyRound ? `on every round ${r.everyRound} times` : "",
    r.everyOther ? `${r.everyRound ? "then " : ""}on every other round ${r.everyOther} times` : "",
  ].filter(Boolean);
  steps.push(
    `Work ${Math.max(r.bodyIncreases, r.sleeveIncreases)} increase rounds: ${spacing.join(", ")}.${
      only ? ` ${both} of them increase at all 8 places; on the other ${only}, increase only on ${where} (4 stitches more), spread among the rest.` : ""
    }`,
  );
  if (r.plainRounds) steps.push(`Knit ${r.plainRounds} rounds plain, until the yoke measures ${len(r.finished.yokeDepth)} from the neckband.`);
  steps.push(`You have ${r.front} stitches each for the back and front, and ${r.sleeve} for each sleeve: ${2 * r.front + 2 * r.sleeve} in all.`);
  steps.push(...belowTheYoke(r, i, len));
  return steps;
}
