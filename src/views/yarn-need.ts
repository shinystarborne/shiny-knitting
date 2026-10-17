import type { Yarn } from "../api";
import type { Gauge } from "./calc";
import type { SockInput, SockResult } from "./socks";

/**
 * How much yarn a garment takes, from its shape and the gauge, and what in
 * the stash would do. Pure, so the harness checks it directly.
 *
 * A stitch's yarn comes from the gauge by Munden's constants for plain
 * knitting: stitches per cm times the loop's length is about 3.8, rows per
 * cm times it about 5.0. Fabric's stitches are its area times both counts.
 * A tenth is added to spare, for swatching, seaming and the odd dropped ball.
 */

/** What is added to spare. */
export const SPARE = 0.1;

/** The yarn in one stitch, in cm, from the gauge both ways. */
export function cmPerStitch(g: Gauge): number {
  return (3.8 / (g.sts / 10) + 5.0 / (g.rows / 10)) / 2;
}

/** The metres of yarn in an area of fabric, in cm², with the spare. */
export function metresForArea(area: number, g: Gauge): number {
  const stitches = area * (g.sts / 10) * (g.rows / 10);
  return ((stitches * cmPerStitch(g)) / 100) * (1 + SPARE);
}

/**
 * A sweater's fabric, in cm²: the body below the arms, the sleeves (tapering
 * from the upper arm to the wrist), the yoke (from the round at the arms to
 * the neck), the neckband, and a cardigan's front bands.
 */
export function sweaterArea(
  finished: { chest: number; upperArm: number; wrist: number; neck: number; yokeDepth: number },
  lengths: { bodyLength: number; armLength: number; neckRib: number; bandWidth?: number },
): number {
  const body = finished.chest * lengths.bodyLength;
  const sleeves = 2 * ((finished.upperArm + finished.wrist) / 2) * lengths.armLength;
  const yoke = ((finished.chest + 2 * finished.upperArm + finished.neck) / 2) * finished.yokeDepth;
  const neckband = finished.neck * lengths.neckRib;
  const bands = 2 * (lengths.bandWidth ?? 0) * (lengths.bodyLength + finished.yokeDepth);
  return body + sleeves + yoke + neckband + bands;
}

/**
 * A pair of socks' fabric, in cm²: the leg and the foot round, the toe as
 * half its length (it narrows), and the heel's own: a flap and its gusset,
 * or a short-row or afterthought heel's cup.
 */
export function socksArea(r: SockResult, input: SockInput): number {
  const spc = input.gauge.sts / 10;
  const rpc = input.gauge.rows / 10;
  const around = r.finished.around;
  const tube = around * (input.leg + r.footCm - r.toe.cm / 2);
  const h = r.heel;
  const width = h.sts / spc;
  const heel =
    h.key === "flap" || h.key === "gusset-up"
      ? width * (h.flapRows / rpc) + ((2 * h.gusset) / spc) * ((2 * h.gusset) / rpc) / 2
      : width * h.cm;
  return 2 * (tube + heel);
}

/** The weight a gauge is usually knitted at, by stitches per 10 cm in stocking stitch. */
export function familyByGauge(stsPer10: number): string {
  const steps: [number, string][] = [
    [33, "lace"],
    [27, "fingering"],
    [23, "sport"],
    [21, "dk"],
    [18, "worsted"],
    [16, "aran"],
    [12, "bulky"],
    [9, "chunky"],
    [6, "super-chunky"],
  ];
  return steps.find(([from]) => stsPer10 >= from)?.[1] ?? "jumbo";
}

/** The metres, rounded up to the ten; and in a yarn, its grams and whole balls. */
export function inYarn(metres: number, yarn: Yarn | null): { metres: number; grams: number | null; balls: number | null } {
  const m = Math.ceil(metres / 10) * 10;
  if (!yarn || !(yarn.metresPerBall > 0)) return { metres: m, grams: null, balls: null };
  const grams = yarn.gramsPerBall > 0 ? Math.ceil((m / yarn.metresPerBall) * yarn.gramsPerBall) : null;
  return { metres: m, grams, balls: Math.ceil(m / yarn.metresPerBall) };
}

/** One stash yarn against what is needed: what it has, and if not enough, how many balls short. */
export interface StashFit {
  yarn: Yarn;
  metres: number;
  enough: boolean;
  /** Whole balls more to buy; null when its ball's metres are not known. */
  ballsShort: number | null;
  metresShort: number;
}

/**
 * The stash's yarns of a weight against the metres needed: those with
 * enough first, the nearest to enough first among them; then the others,
 * the least short first. Used up yarn and yarn with no metres are left out.
 */
export function stashFor(metres: number, yarns: Yarn[], family: string): StashFit[] {
  const fits = yarns
    .filter((y) => !y.usedUpAt && y.yarnWeightFamily === family && y.metresLeft > 0)
    .map((y) => {
      const short = Math.max(0, metres - y.metresLeft);
      return {
        yarn: y,
        metres: y.metresLeft,
        enough: short === 0,
        metresShort: Math.ceil(short),
        ballsShort: short === 0 ? 0 : y.metresPerBall > 0 ? Math.ceil(short / y.metresPerBall) : null,
      };
    });
  return [...fits.filter((f) => f.enough).sort((a, b) => a.metres - b.metres), ...fits.filter((f) => !f.enough).sort((a, b) => a.metresShort - b.metresShort)];
}
