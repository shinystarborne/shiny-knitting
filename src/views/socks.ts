import type { Gauge } from "./calc";

/**
 * Socks, from a foot and a swatch: the stitches round, the toe, the heel
 * chosen, the foot and the leg, as numbers and as steps, cuff-down or
 * toe-up. Pure arithmetic, so the harness checks it directly.
 *
 * A sock is knitted smaller than the foot -- negative ease -- so it hugs it.
 * The stitches are a multiple of 4: halved for the heel and the instep, and
 * a 1x1 or a 2x2 rib fits either way.
 */

export type HeelKey = "flap" | "gusset-up" | "short-row" | "fish-lips" | "boomerang" | "afterthought";
export type ToeKey = "wedge" | "round";
export type SockDirection = "down" | "up";

/** The heels, which way each is worked, and what it is, for the picker. */
export const HEELS: { key: HeelKey; label: string; ways: SockDirection[]; hint: string }[] = [
  { key: "flap", label: "Heel flap and gusset", ways: ["down"], hint: "A slip-stitch flap, the heel turned, stitches picked up for the gusset: hard-wearing, and roomy over the instep" },
  { key: "gusset-up", label: "Gusset heel, toe-up", ways: ["up"], hint: "The flap heel the other way up: gusset increases on the sole, the heel turned, then a flap that takes the gusset stitches back" },
  { key: "short-row", label: "Short-row heel (German short rows)", ways: ["down", "up"], hint: "Short rows with double stitches, in and out again: no picking up, no gusset" },
  { key: "fish-lips", label: "Fish Lips Kiss heel", ways: ["down", "up"], hint: "Short rows with twin stitches, a round between the halves: Sox Therapist's heel" },
  { key: "boomerang", label: "Boomerang heel", ways: ["down", "up"], hint: "Short rows with double stitches, two rounds between the halves: deeper than a plain short-row heel" },
  { key: "afterthought", label: "Afterthought heel", ways: ["down", "up"], hint: "Waste yarn knitted in at the heel, the heel knitted last from the stitches either side of it, like a toe" },
];

export const TOES: { key: ToeKey; label: string; hint: string }[] = [
  { key: "wedge", label: "Wedge toe", hint: "Decreased at both sides, flat, grafted closed" },
  { key: "round", label: "Round (star) toe", hint: "Decreased at four points round it, drawn closed" },
];

export interface SockInput {
  gauge: Gauge;
  /** Around the ball of the foot, and heel to longest toe, in cm. */
  footAround: number;
  footLength: number;
  /** Negative ease, as a percentage of the foot round: 10 is usual. */
  ease: number;
  /** How much shorter than the foot the sock is, in cm. */
  shorter: number;
  /** The leg, from the top of the heel to the cast-on or bind-off edge, cuff included; and the cuff's rib. In cm. */
  leg: number;
  cuff: number;
  direction: SockDirection;
  heel: HeelKey;
  toe: ToeKey;
  /** The rib's repeat: 2 for 1x1, 4 for 2x2. */
  rib: number;
}

/** A toe's shaping: from the stitches round to the few it ends on, and back for toe-up. */
export interface ToePlan {
  key: ToeKey;
  /** Decrease (or increase) rounds of 4, every other round, then every round. */
  everyOther: number;
  everyRound: number;
  /** Where the every-other-round part ends and the every-round part starts. */
  mid: number;
  /** The stitches it ends (or, toe-up, starts) on. */
  end: number;
  rounds: number;
  cm: number;
}

export interface HeelPlan {
  key: HeelKey;
  /** Its stitches: half of them. */
  sts: number;
  /** For short rows: the double (or twin) stitches made at each side, the middle left, and rounds between the halves. */
  sides: number;
  middle: number;
  between: number;
  /** For a flap heel: its rows, the heel turn's rows and what it leaves, the stitches picked up each side, and the gusset. */
  flapRows: number;
  turnRows: number;
  turnSts: number;
  pickUp: number;
  /** Gusset rounds of 2 decreases (cuff-down) or increases (toe-up), every other round. */
  gusset: number;
  /** For the afterthought heel: the stitches picked up round the waste yarn, and its shaping, as a toe's. */
  pickedUp: number;
  shaping: ToePlan | null;
  /** How long it makes the foot, in cm: counted off the foot before or after it. */
  cm: number;
}

export interface SockResult {
  sts: number;
  half: number;
  /** Rounds of the cuff's rib, and of the leg after it. */
  cuffRounds: number;
  legRounds: number;
  toe: ToePlan;
  heel: HeelPlan;
  /** The sock's foot, heel to toe tip, in cm; and what to knit it to, as the steps say it. */
  footCm: number;
  /** Cuff-down: from the back of the heel (or the waste yarn) to the start of the toe. Toe-up: from the toe's tip to the heel's start. */
  footToCm: number;
  footRounds: number;
  finished: { around: number; leg: number };
  warnings: string[];
}

/** A toe's shaping from `sts`: every other round to half, then every round to a quarter (wedge) or 8 (round). */
export function toePlan(sts: number, key: ToeKey, rowsPerCm: number): ToePlan {
  const mid = Math.max(8, 4 * Math.round(sts / 8));
  const end = key === "round" ? 8 : Math.min(mid, Math.max(8, 4 * Math.round(sts / 16)));
  const everyOther = (sts - mid) / 4;
  const everyRound = (mid - end) / 4;
  const rounds = 2 * everyOther + everyRound;
  return { key, everyOther, everyRound, mid, end, rounds, cm: rounds / rowsPerCm };
}

/**
 * The classic round heel turn over `h` stitches: sl1, k(h/2), ssk, k1, turn;
 * sl1, p3, p2tog, p1, turn; then each row to one before the gap, closing it.
 * Its rows, and the stitches left: h/2 + 2, or h/2 + 1 when h/2 is odd.
 */
export function heelTurn(h: number): { rows: number; sts: number } {
  const side = h / 2 - 4;
  return { rows: 2 + 2 * Math.ceil(side / 2), sts: side % 2 === 0 ? h / 2 + 2 : h / 2 + 1 };
}

/** Short rows over a heel's stitches: a third at each side turned, the middle third left. */
function thirds(h: number): { sides: number; middle: number } {
  const sides = Math.floor(h / 3);
  return { sides, middle: h - 2 * sides };
}

export function sock(input: SockInput): SockResult | { error: string } {
  const { gauge } = input;
  if (!(gauge.sts > 0)) return { error: "Give your gauge: pick a swatch, or type the stitches." };
  if (!(gauge.rows > 0)) return { error: "Give the rows of your gauge too: a foot and a leg are counted in rounds." };
  if (!(input.footAround > 0)) return { error: "Give the measurement around the foot, at its widest part." };
  if (!(input.footLength > 0)) return { error: "Give the foot's length, heel to longest toe." };
  if (!(input.ease >= 0 && input.ease < 40)) return { error: "Negative ease is a percentage of the foot: 10 is usual." };
  const spc = gauge.sts / 10;
  const rpc = gauge.rows / 10;
  const sts = Math.max(24, 4 * Math.round((input.footAround * (1 - input.ease / 100) * spc) / 4));
  const half = sts / 2;
  if (half < 12) return { error: "Too few stitches for a heel: a finer gauge, or a bigger foot." };
  const warnings: string[] = [];
  const up = input.direction === "up";
  const heelWay = HEELS.find((h) => h.key === input.heel);
  if (!heelWay) return { error: "Choose a heel." };
  if (!heelWay.ways.includes(input.direction)) return { error: `The ${heelWay.label.toLowerCase()} is worked ${heelWay.ways[0] === "up" ? "toe-up" : "cuff-down"}.` };

  const toe = toePlan(sts, input.toe, rpc);
  const footCm = input.footLength - Math.max(0, input.shorter);

  // The heel.
  const t = thirds(half);
  const heel: HeelPlan = { key: input.heel, sts: half, sides: 0, middle: 0, between: 0, flapRows: 0, turnRows: 0, turnSts: 0, pickUp: 0, gusset: 0, pickedUp: 0, shaping: null, cm: 0 };
  if (input.heel === "flap") {
    const turn = heelTurn(half);
    heel.flapRows = half;
    heel.turnRows = turn.rows;
    heel.turnSts = turn.sts;
    heel.pickUp = half / 2 + 1;
    heel.gusset = (turn.sts + 2 * heel.pickUp + half - sts) / 2;
  } else if (input.heel === "gusset-up") {
    // The gusset adds a stitch each side every other round; the turn is short
    // rows over the middle, and the flap takes the gusset stitches back.
    heel.gusset = half / 2 - 1;
    heel.sides = t.sides;
    heel.middle = t.middle;
    heel.flapRows = 2 * heel.gusset;
    heel.cm = (2 * heel.gusset + t.sides) / rpc;
  } else if (input.heel === "afterthought") {
    heel.pickedUp = sts + 4;
    heel.shaping = toePlan(sts, "wedge", rpc);
    heel.cm = (1 + heel.shaping.rounds) / rpc;
  } else {
    heel.sides = t.sides;
    heel.middle = t.middle;
    heel.between = input.heel === "boomerang" ? 2 : input.heel === "fish-lips" ? 1 : 0;
    heel.cm = (2 * t.sides) / rpc;
  }

  // The foot: what is left of it once the toe and the heel have theirs.
  // Cuff-down, a flap or short-row heel's foot is measured from the back of
  // the heel, an afterthought heel's from the waste yarn; toe-up, from the
  // toe's tip to where the heel starts.
  let footToCm: number;
  if (up) footToCm = footCm - heel.cm;
  else footToCm = footCm - toe.cm - (input.heel === "afterthought" ? heel.cm : 0);
  if (footToCm <= 0) return { error: "The foot is too short for this toe and heel at this gauge: check the foot length and the rows." };
  // Toe-up the toe is part of the length measured; cuff-down a flap heel's
  // back takes about its turn's depth.
  const counted = up ? footToCm - toe.cm : footToCm - (input.heel === "flap" ? heel.turnRows / 2 / rpc : input.heel === "afterthought" ? 0 : heel.cm / 2);
  const footRounds = Math.max(0, Math.round(counted * rpc));

  const cuffRounds = Math.max(2, Math.round(input.cuff * rpc));
  const legRounds = Math.max(0, Math.round((input.leg - input.cuff) * rpc));
  if (input.leg < input.cuff) warnings.push("The leg is shorter than its cuff: the leg is measured with the cuff in it.");
  if (sts < 40) warnings.push(`${sts} stitches is few for a sock: a child's, or a thick yarn. Check the gauge.`);
  if (sts > 96) warnings.push(`${sts} stitches is many for a sock: a fine yarn, or a big foot. Check the gauge.`);
  if (input.rib === 4 && sts % 4) warnings.push("The stitches are not a multiple of 4, so the 2x2 rib does not come out even.");
  if (input.heel === "flap" && heel.turnSts < 8) warnings.push("The heel has few stitches to turn: the turn will be small.");

  return {
    sts,
    half,
    cuffRounds,
    legRounds,
    toe,
    heel,
    footCm,
    footToCm,
    footRounds,
    finished: { around: sts / spc, leg: input.leg },
    warnings,
  };
}

/** The steps, in the order knitted, with lengths in the unit shown. */
export function sockSteps(r: SockResult, input: SockInput, len: (cm: number) => string): string[] {
  const rib = input.rib === 4 ? "k2, p2" : "k1, p1";
  const up = input.direction === "up";
  const h = r.heel;
  const instep = r.half;
  const steps: string[] = [];
  const toeDown = (t: ToePlan): string[] =>
    t.key === "round"
      ? [
          `Round toe: mark 4 points evenly round, ${r.sts / 4} stitches apart. Decrease at each (k2tog before every marker), 4 stitches a round, every other round ${t.everyOther} times, to ${t.mid}.`,
          `Then decrease 4 every round ${t.everyRound} times, to ${t.end}. Break the yarn, thread it through the ${t.end} stitches and draw them closed.`,
        ]
      : [
          `Wedge toe: with the instep on one needle and the sole on the other, decrease at both ends of each (k1, ssk … k2tog, k1), 4 stitches a round, every other round ${t.everyOther} times, to ${t.mid}.`,
          `Then decrease 4 every round ${t.everyRound} times, to ${t.end}. Graft the ${t.end / 2} and ${t.end / 2} stitches together (Kitchener stitch).`,
        ];
  const toeUp = (t: ToePlan): string[] =>
    t.key === "round"
      ? [
          `Round toe: cast on ${t.end} with a circular cast-on and join in the round. Increase 4 every round, at 4 points evenly round (m1 after every marker), ${t.everyRound} times, to ${t.mid}.`,
          `Then increase 4 every other round ${t.everyOther} times, to ${r.sts}.`,
        ]
      : [
          `Wedge toe: cast on ${t.end} with Judy's magic cast-on, ${t.end / 2} on each needle. Increase at both ends of each needle (k1, m1 … m1, k1), 4 stitches a round, every round ${t.everyRound} times, to ${t.mid}.`,
          `Then increase 4 every other round ${t.everyOther} times, to ${r.sts}: ${instep} on the instep, ${instep} on the sole.`,
        ];
  const shortRows = (word: "double" | "twin"): string[] => {
    const make = `make a ${word} stitch`;
    return [
      `First half${word === "double" ? ", in German short rows" : ""}, over the ${h.sts} heel stitches only, back and forth: knit to the end, turn, ${make}, purl back to the end, turn, ${make}. Then knit (or purl) to the ${word} stitch before, turn, ${make}, again and again, until ${h.sides} ${word} stitches are at each side and ${h.middle} plain ones between: ${2 * h.sides} rows.`,
      ...(h.between
        ? [`Knit ${h.between === 1 ? "1 round" : `${h.between} rounds`} over all ${r.sts} stitches, working each ${word} stitch as one.`]
        : []),
      `Second half: knit across the ${h.middle} middle stitches${h.between ? "" : " and the first " + word + " stitch, working it as one"}, turn, ${make}; purl back across them${h.between ? "" : " and the " + word + " stitch at that side"}, turn, ${make}. Each row works one stitch more, until every stitch of the heel is worked again: ${2 * h.sides} rows.`,
    ];
  };

  if (!up) {
    steps.push(`Cast on ${r.sts} stitches, stretchy (a long-tail or a German twisted cast-on), and join in the round.`);
    steps.push(`Cuff: ${rib} rib for ${r.cuffRounds} rounds (${len(input.cuff)}).`);
    steps.push(`Leg: knit ${r.legRounds} rounds, until it measures ${len(input.leg)} from the cast-on.`);
    if (h.key === "flap") {
      steps.push(`Heel flap, over ${h.sts} stitches, back and forth (the other ${instep} wait for the instep): row 1 (RS) *sl1, k1* to the end; row 2 (WS) sl1, purl to the end. ${h.flapRows} rows.`);
      steps.push(`Turn the heel: sl1, k${h.sts / 2}, ssk, k1, turn; sl1, p3, p2tog, p1, turn. Then sl1, knit to 1 before the gap, ssk, k1, turn; sl1, purl to 1 before the gap, p2tog, p1, turn; until every stitch is worked (the last rows may end with the ssk or p2tog): ${h.turnRows} rows, ${h.turnSts} stitches left.`);
      steps.push(`Gusset: knit across the heel, pick up and knit ${h.pickUp} stitches along the flap's side, knit the ${instep} instep stitches, pick up ${h.pickUp} along the other side: ${h.turnSts + 2 * h.pickUp + instep} stitches.`);
      steps.push(`Decrease 2 on the sole every other round (k2tog at the end of the first gusset, ssk at the start of the other) ${h.gusset} times, back to ${r.sts}: ${2 * h.gusset} rounds.`);
      steps.push(`Foot: knit until it measures ${len(r.footToCm)} from the back of the heel (about ${r.footRounds} rounds from the round the gusset was picked up on, its decreases included), ${len(r.toe.cm)} short of the sock's foot of ${len(r.footCm)}.`);
    } else if (h.key === "afterthought") {
      steps.push(`Heel place: knit the first ${h.sts} stitches with a waste yarn, slip them back and knit them again with the sock yarn. The heel is knitted there at the end.`);
      steps.push(`Foot: knit until it measures ${len(r.footToCm)} from the waste yarn (about ${r.footRounds} rounds), leaving ${len(r.toe.cm)} for the toe and ${len(h.cm)} for the heel.`);
    } else {
      steps.push(...shortRows(h.key === "fish-lips" ? "twin" : "double"));
      steps.push(`Foot: knit in the round until it measures ${len(r.footToCm)} from the back of the heel (about ${r.footRounds} rounds), ${len(r.toe.cm)} short of the sock's foot of ${len(r.footCm)}.`);
    }
    steps.push(...toeDown(r.toe));
    if (h.key === "afterthought") {
      steps.push(`Heel: pick up ${h.sts} stitches below the waste yarn and ${h.sts} above it, take the waste yarn out, and pick up 2 at each corner: ${h.pickedUp} stitches. Knit a round, decreasing 1 at each corner's 2, to ${r.sts}.`);
      steps.push(...toeDown(h.shaping!).map((s) => s.replace(/^Wedge toe/, "Then shape it as a wedge toe")));
    }
  } else {
    steps.push(...toeUp(r.toe));
    if (h.key === "gusset-up") {
      steps.push(`Foot: knit until it measures ${len(r.footToCm)} from the tip of the toe (about ${r.footRounds} rounds after the toe), ${len(h.cm)} short of the sock's foot of ${len(r.footCm)}.`);
      steps.push(`Gusset: on the sole, increase 1 after its first stitch and 1 before its last every other round ${h.gusset} times: ${r.half + 2 * h.gusset} sole stitches, ${2 * h.gusset} rounds.`);
      steps.push(`Turn the heel over the middle ${h.sts} sole stitches, leaving ${h.gusset} gusset stitches at each side: short rows with double stitches, until ${h.sides} are at each side and ${h.middle} between; then work across all ${h.sts}, working each double stitch as one.`);
      steps.push(`Heel flap, back and forth, taking the gusset back: RS sl1, knit to the last heel stitch, ssk (it and a gusset stitch), turn; WS sl1, purl to the last heel stitch, p2tog, turn. ${h.flapRows} rows, until the gusset stitches are gone: ${r.sts} stitches again.`);
    } else if (h.key === "afterthought") {
      steps.push(`Foot: knit until it measures ${len(r.footToCm)} from the tip of the toe (about ${r.footRounds} rounds after the toe), ${len(h.cm)} short of the sock's foot of ${len(r.footCm)}.`);
      steps.push(`Heel place: knit the ${h.sts} sole stitches with a waste yarn, slip them back and knit them again with the sock yarn. The heel is knitted there at the end.`);
    } else {
      steps.push(`Foot: knit until it measures ${len(r.footToCm)} from the tip of the toe (about ${r.footRounds} rounds after the toe), ${len(h.cm)} short of the sock's foot of ${len(r.footCm)}.`);
      steps.push(...shortRows(h.key === "fish-lips" ? "twin" : "double").map((s) => s.replace("heel stitches only", "sole stitches only")));
    }
    steps.push(`Leg: knit ${r.legRounds} rounds, then ${rib} rib for ${r.cuffRounds} rounds (${len(input.cuff)}): the leg ${len(input.leg)} from the top of the heel.`);
    steps.push(`Bind off stretchy (Jeny's surprisingly stretchy bind-off, or a sewn bind-off), so it goes over the heel.`);
    if (h.key === "afterthought") {
      steps.push(`Heel: pick up ${h.sts} stitches below the waste yarn and ${h.sts} above it, take the waste yarn out, and pick up 2 at each corner: ${h.pickedUp} stitches. Knit a round, decreasing 1 at each corner's 2, to ${r.sts}.`);
      steps.push(...toeDown(h.shaping!).map((s) => s.replace(/^Wedge toe/, "Then shape it as a wedge toe")));
    }
  }
  steps.push("Knit the second sock the same.");
  return steps;
}
