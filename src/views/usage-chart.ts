import type { YarnUse } from "../api";

/** One calendar month's use: from its first day to its last, in local time. */
export interface MonthUse {
  /** The month's first moment. */
  start: number;
  label: string;
  short: string;
  metres: number;
  grams: number;
  /** Grams used of yarn with no metres per ball: in the weight, not the metres. */
  gramsWithoutMetres: number;
  uses: YarnUse[];
}

/**
 * The last `count` calendar months, the current one last, each with the yarn
 * used in it: a month runs from its 1st to its last day, whatever its length.
 */
export function usageByMonth(uses: YarnUse[], now = Date.now(), count = 12): MonthUse[] {
  const today = new Date(now);
  const months: MonthUse[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    const inIt = uses.filter((u) => u.at >= first.getTime() && u.at < next.getTime());
    months.push({
      start: first.getTime(),
      label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      short: first.toLocaleDateString("en-GB", { month: "short" }),
      metres: inIt.reduce((n, u) => n + u.metres, 0),
      grams: inIt.reduce((n, u) => n + u.grams, 0),
      gramsWithoutMetres: inIt.filter((u) => !u.metres).reduce((n, u) => n + u.grams, 0),
      uses: inIt,
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

const fmt = (n: number) => n.toLocaleString("en-GB");

/**
 * Metres used a month, as columns: one series, so no legend, the title says
 * what it is. The tallest month and the chosen one carry their figure; the
 * rest are in the tooltip, and in the table under the chart.
 */
export function usageChartHtml(months: MonthUse[], chosen: number): string {
  const { top, step } = niceScale(Math.max(...months.map((m) => m.metres)));
  const tallest = months.reduce((best, m, i) => (m.metres > months[best].metres ? i : best), 0);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const yearOf = (m: MonthUse) => new Date(m.start).getFullYear();
  return `
    <div class="usage-chart" role="group" aria-label="Metres of yarn used each month">
      <div class="usage-plot">
        ${ticks.map((v) => `<div class="usage-grid" style="bottom:${(v / top) * 100}%"><span>${fmt(v)}</span></div>`).join("")}
        <div class="usage-cols">
          ${months
            .map((m, i) => {
              const tip = `${m.label}: ${fmt(m.metres)} m · ${fmt(m.grams)} g${m.gramsWithoutMetres ? ` (${fmt(m.gramsWithoutMetres)} g without metres per ball)` : ""}`;
              const label = (i === tallest && m.metres) || (i === chosen && m.metres) ? `<span class="usage-cap">${fmt(m.metres)}</span>` : "";
              return `
                <button class="usage-col${i === chosen ? " chosen" : ""}" data-month="${i}" aria-label="${tip}" data-tip="${tip}">
                  <span class="usage-bar" style="height:${m.metres ? Math.max(1.5, (m.metres / top) * 100) : 0}%">${label}</span>
                </button>`;
            })
            .join("")}
        </div>
        <div class="usage-tip" hidden></div>
      </div>
      <div class="usage-months">
        ${months
          .map((m, i) => {
            // The year under January, and under the first month shown.
            const year = i === 0 || new Date(m.start).getMonth() === 0 ? `<em>${yearOf(m)}</em>` : "";
            return `<span class="${i === chosen ? "chosen" : ""}">${m.short}${year}</span>`;
          })
          .join("")}
      </div>
    </div>`;
}
