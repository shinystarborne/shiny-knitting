import type { Yarn, YarnUse } from "../api";

/** Yarn come into the stash: one lot, as bought. */
export interface StashAdd {
  at: number;
  yarnName: string;
  /** "3 balls", or "" when only weighed. */
  what: string;
  grams: number;
  /** By the ball band; 0 when it gives no metres per ball. */
  metres: number;
}

/**
 * Every lot in the stash as it came in, the used up ones' too: the balls
 * bought (or the grams weighed, for a lot with no balls counted), dated when
 * bought, or when the yarn was added if no date was given. A lot made by
 * finishing a project, to hold what was left, came from the stash already,
 * and is not counted again.
 */
export function additions(yarns: Yarn[]): StashAdd[] {
  const out: StashAdd[] = [];
  for (const y of yarns) {
    const name = [y.brand, y.name].filter(Boolean).join(" ") + (y.colourway ? ` (${y.colourway})` : "");
    for (const lot of y.lots) {
      if (!lot.balls && lot.leftover) continue;
      const grams = lot.balls && y.gramsPerBall ? Math.round(lot.balls * y.gramsPerBall) : lot.gramsLeft;
      if (!grams && !lot.balls) continue;
      const metres = y.metresPerBall && y.gramsPerBall ? Math.round((grams / y.gramsPerBall) * y.metresPerBall) : 0;
      const balls = lot.balls ? `${lot.balls} ball${lot.balls === 1 ? "" : "s"}` : "";
      out.push({ at: lot.boughtAt ?? y.addedAt, yarnName: name, what: [balls, lot.dyeLot ? `lot ${lot.dyeLot}` : ""].filter(Boolean).join(", "), grams, metres });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** What came in, or went out, in one month. */
export interface Flow<T> {
  metres: number;
  grams: number;
  /** Grams of yarn with no metres per ball: in the weight, not the metres. */
  gramsWithoutMetres: number;
  items: T[];
}

/** One calendar month: from its first day to its last, in local time. */
export interface MonthFlow {
  /** The month's first moment. */
  start: number;
  label: string;
  short: string;
  added: Flow<StashAdd>;
  used: Flow<YarnUse>;
}

function flow<T extends { at: number; grams: number; metres: number }>(items: T[], from: number, to: number): Flow<T> {
  const inIt = items.filter((x) => x.at >= from && x.at < to);
  return {
    metres: inIt.reduce((n, x) => n + x.metres, 0),
    grams: inIt.reduce((n, x) => n + x.grams, 0),
    gramsWithoutMetres: inIt.filter((x) => !x.metres).reduce((n, x) => n + x.grams, 0),
    items: inIt,
  };
}

/**
 * The last `count` calendar months, the current one last, each with the yarn
 * added and used in it: a month runs from its 1st to its last day, whatever
 * its length.
 */
export function flowByMonth(adds: StashAdd[], uses: YarnUse[], now = Date.now(), count = 12): MonthFlow[] {
  const today = new Date(now);
  const months: MonthFlow[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    months.push({
      start: first.getTime(),
      label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      short: first.toLocaleDateString("en-GB", { month: "short" }),
      added: flow(adds, first.getTime(), next.getTime()),
      used: flow(uses, first.getTime(), next.getTime()),
    });
  }
  return months;
}

/** A round top for the axis, and its step: 0 / 500 / 1,000, not 0 / 437 / 874. */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 100, step: 50 };
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

export type Unit = "m" | "g";

const fmt = (n: number) => n.toLocaleString("en-GB");

/** The two series: what came in, and what went out. */
export const SERIES = [
  { key: "added" as const, label: "Added", colour: "#3987e5" },
  { key: "used" as const, label: "Used", colour: "#d95926" },
];

/**
 * Metres (or grams) added and used a month, as pairs of columns, added first.
 * Two series, so a legend; the tallest column carries its figure, the rest are
 * in the tooltip and in the table under the chart.
 */
export function flowChartHtml(months: MonthFlow[], chosen: number, unit: Unit): string {
  const value = (f: Flow<unknown>) => (unit === "m" ? f.metres : f.grams);
  const { top, step } = niceScale(Math.max(...months.flatMap((m) => [value(m.added), value(m.used)])));
  let tallest = { i: -1, key: "added", v: 0 };
  months.forEach((m, i) => SERIES.forEach((s) => value(m[s.key]) > tallest.v && (tallest = { i, key: s.key, v: value(m[s.key]) })));
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const word = unit === "m" ? "m" : "g";
  return `
    <div class="usage-chart" role="group" aria-label="${unit === "m" ? "Metres" : "Grams"} of yarn added and used each month">
      <div class="usage-legend">${SERIES.map((s) => `<span><i style="background:${s.colour}"></i>${s.label}</span>`).join("")}</div>
      <div class="usage-plot">
        ${ticks.map((v) => `<div class="usage-grid" style="bottom:${(v / top) * 100}%"><span>${fmt(v)}</span></div>`).join("")}
        <div class="usage-cols">
          ${months
            .map((m, i) => {
              const tip = `${m.label}: added ${fmt(value(m.added))} ${word}, used ${fmt(value(m.used))} ${word}`;
              const bars = SERIES.map((s) => {
                const v = value(m[s.key]);
                const cap = tallest.i === i && tallest.key === s.key ? `<span class="usage-cap">${fmt(v)}</span>` : "";
                return `<span class="usage-bar" style="background:${s.colour};height:${v ? Math.max(1.5, (v / top) * 100) : 0}%">${cap}</span>`;
              }).join("");
              return `<button class="usage-col${i === chosen ? " chosen" : ""}" data-month="${i}" aria-label="${tip}" data-tip="${tip}">${bars}</button>`;
            })
            .join("")}
        </div>
        <div class="usage-tip" hidden></div>
      </div>
      <div class="usage-months">
        ${months
          .map((m, i) => {
            // The year under January, and under the first month shown.
            const year = i === 0 || new Date(m.start).getMonth() === 0 ? `<em>${new Date(m.start).getFullYear()}</em>` : "";
            return `<span class="${i === chosen ? "chosen" : ""}">${m.short}${year}</span>`;
          })
          .join("")}
      </div>
    </div>`;
}
