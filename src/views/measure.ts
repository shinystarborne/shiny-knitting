import { MEASUREMENTS, type MeasureUnit, type MeasurementSet, type Person, type Swatch } from "../api";

/**
 * Lengths for people's measurements: shown and typed in centimetres or
 * inches, always stored in centimetres. No DOM here, so the harness checks it
 * directly.
 */

const CM_PER_INCH = 2.54;

/** "cm" or "in", as written after a figure. */
export function unitLabel(unit: MeasureUnit): string {
  return unit === "in" ? "in" : "cm";
}

/**
 * A length in the chosen unit, to one decimal place without a trailing ".0":
 * 91.44 cm is "91.4" in centimetres and "36" in inches. Empty for nothing.
 */
export function showLength(cm: number | undefined, unit: MeasureUnit): string {
  if (!cm) return "";
  const value = unit === "in" ? cm / CM_PER_INCH : cm;
  return String(Math.round(value * 10) / 10);
}

/** A length with its unit: "91.4 cm", "36 in". */
export function showLengthWithUnit(cm: number | undefined, unit: MeasureUnit): string {
  const v = showLength(cm, unit);
  return v ? `${v} ${unitLabel(unit)}` : "";
}

/**
 * Reads a typed length into centimetres. A unit typed with it wins over the
 * setting ("36 in", "36\"", "91 cm"), and a decimal comma is a decimal
 * point. 0 for an empty field; NaN for something that is not a length.
 */
export function readLength(text: string, unit: MeasureUnit): number {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return 0;
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*(cm|in|inch|inches|"|”|″)?$/.exec(t);
  if (!m) return NaN;
  const value = Number(m[1]);
  const typed = m[2] === "cm" ? "cm" : m[2] ? "in" : unit;
  // Stored to two places: enough that inches read back as typed.
  return Math.round((typed === "in" ? value * CM_PER_INCH : value) * 100) / 100;
}

/** A measurement's name: a standard one's label, or one of the person's own. */
export function measurementLabel(key: string): string {
  if (key.startsWith("x:")) return key.slice(2);
  return MEASUREMENTS.find((m) => m.key === key)?.label ?? key;
}

/** Every row a person's table has: the standard measurements, then their own. */
export function measurementKeys(person: Person): string[] {
  return [...MEASUREMENTS.map((m) => m.key as string), ...person.extra.map((e) => `x:${e}`)];
}

/** The newest value of a measurement, and when it was taken; null when never. */
export function latestValue(person: Person, key: string): { cm: number; at: number } | null {
  const set = person.sets.find((s) => s.values[key]);
  return set ? { cm: set.values[key], at: set.measuredAt } : null;
}

/** The newest shoe size given, or "". */
export function latestShoeSize(person: Person): string {
  return person.sets.find((s) => s.shoeSize)?.shoeSize ?? "";
}

/**
 * How a measurement changed since the set before this one with it, in the
 * chosen unit: "+4", "−1.5", or "" when it did not change or has nothing to
 * compare with.
 */
export function change(sets: MeasurementSet[], index: number, key: string, unit: MeasureUnit): string {
  const now = sets[index]?.values[key];
  const before = sets.slice(index + 1).find((s) => s.values[key])?.values[key];
  if (!now || !before) return "";
  const diff = Math.round(((now - before) / (unit === "in" ? CM_PER_INCH : 1)) * 10) / 10;
  if (!diff) return "";
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

// ---------- gauge ----------

/** 4 inches is 10.16 cm, so a count over 4 in is the count over 10 cm times this. */
const PER_4_IN = 10.16 / 10;

/** What a gauge is counted over: "10 cm", or "4 in" with inches chosen. */
export function gaugeSpan(unit: MeasureUnit): string {
  return unit === "in" ? "4 in" : "10 cm";
}

/** A count stored per 10 cm, in the chosen span, to a tenth: "22", "22.5". Empty for not counted. */
export function showGauge(per10cm: number, unit: MeasureUnit): string {
  if (!per10cm) return "";
  return String(Math.round((unit === "in" ? per10cm * PER_4_IN : per10cm) * 10) / 10);
}

/** Needles in mm, one size or a range: "4 mm", "3.5–4 mm". Empty when not said. */
export function needleRange(from: number, to: number): string {
  if (!from) return "";
  return to && to !== from ? `${from}–${to} mm` : `${from} mm`;
}

/**
 * What a yarn's ball band says of knitting it, in one line: "18 sts × 24 rows /
 * 10 cm · needles 5–5.5 mm". Empty when it says nothing.
 */
export function detailsLine(d: YarnDetailsLike | undefined, unit: MeasureUnit): string {
  return detailsParts(d, unit).join(" · ");
}

type YarnDetailsLike = { gaugeSts: number; gaugeRows: number; needleFrom: number; needleTo: number };

/** The line's parts, the gauge and the needles, each to be kept whole when the line wraps. */
export function detailsParts(d: YarnDetailsLike | undefined, unit: MeasureUnit): string[] {
  if (!d) return [];
  const counts = [d.gaugeSts ? `${showGauge(d.gaugeSts, unit)} sts` : "", d.gaugeRows ? `${showGauge(d.gaugeRows, unit)} rows` : ""].filter(Boolean);
  const gauge = counts.length ? `${counts.join(" × ")} / ${gaugeSpan(unit)}` : "";
  const needles = needleRange(d.needleFrom, d.needleTo);
  return [gauge, needles ? `needles ${needles}` : ""].filter(Boolean);
}

/** A typed count, over the chosen span, as a count per 10 cm. 0 for empty, NaN for not a number. */
export function readGauge(text: string, unit: MeasureUnit): number {
  const t = text.trim().replace(",", ".");
  if (!t) return 0;
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return NaN;
  const value = Number(t);
  // Not rounded here: the backend keeps a tenth, and rounding twice can land
  // on the wrong side (21.6535 to 21.65 to 21.6, not 21.7).
  return unit === "in" ? value / PER_4_IN : value;
}

/** The counts a swatch is known by: after blocking when it was counted then, else before. */
export function gaugeOf(s: Swatch): { sts: number; rows: number; blocked: boolean } {
  const blocked = s.stsBlocked > 0 || s.rowsBlocked > 0;
  return blocked ? { sts: s.stsBlocked, rows: s.rowsBlocked, blocked } : { sts: s.sts, rows: s.rows, blocked };
}

/** "22 sts × 30 rows", or as much of it as was counted; "" for nothing. */
export function gaugeText(s: Swatch, unit: MeasureUnit): string {
  const g = gaugeOf(s);
  return [g.sts ? `${showGauge(g.sts, unit)} sts` : "", g.rows ? `${showGauge(g.rows, unit)} rows` : ""].filter(Boolean).join(" × ");
}

/**
 * What blocking did to a swatch, in percent: wider or narrower from the
 * stitches (fewer per 10 cm after is wider fabric), longer or shorter from the
 * rows. null for a direction without both counts.
 */
export function blockingChange(s: Pick<Swatch, "sts" | "rows" | "stsBlocked" | "rowsBlocked">): { wide: number | null; long: number | null } {
  const grew = (before: number, after: number) => (before && after ? Math.round((before / after - 1) * 100) : null);
  return { wide: grew(s.sts, s.stsBlocked), long: grew(s.rows, s.rowsBlocked) };
}

/** "7% wider, 5% longer", "3% narrower, same length"; "" when it cannot be said. */
export function blockingText(s: Pick<Swatch, "sts" | "rows" | "stsBlocked" | "rowsBlocked">): string {
  const { wide, long } = blockingChange(s);
  const say = (n: number | null, more: string, less: string, same: string) =>
    n === null ? "" : n > 0 ? `${n}% ${more}` : n < 0 ? `${-n}% ${less}` : same;
  return [say(wide, "wider", "narrower", "same width"), say(long, "longer", "shorter", "same length")].filter(Boolean).join(", ");
}

/** A needle size as the stash says it: "4 mm", "3.75 mm"; "" for none. */
export function needleText(mm: number): string {
  return mm ? `${Math.round(mm * 100) / 100} mm` : "";
}

/** One line for a swatch: "22 sts × 30 rows on 4 mm". */
export function swatchLine(s: Swatch, unit: MeasureUnit): string {
  const gauge = gaugeText(s, unit);
  const needle = needleText(s.needleMm);
  return [gauge, needle ? `on ${needle}` : ""].filter(Boolean).join(" ") || "Not counted yet";
}

/** The measurements a card shows first, when they are known. */
export const CARD_MEASUREMENTS = ["chest", "waist", "hips", "head", "foot_length"];
