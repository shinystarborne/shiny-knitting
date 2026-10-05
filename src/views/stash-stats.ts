import { api, type Yarn, type YarnUse } from "../api";
import { closestEl } from "../dom";
import { stashModeSwitch } from "./swatches";
import { additions, flowByMonth, flowChartHtml, SERIES, type Flow, type MonthFlow, type Unit } from "./usage-chart";

/** What the view keeps while the app is open: metres or grams. */
const kept: { unit: Unit } = { unit: "m" };

/**
 * The Stash tab's statistics: how much is in the stash now, and yarn added
 * and used month by month, in metres or grams, for the last twelve calendar
 * months. Added comes from the lots (as bought, dated when bought); used from
 * what was recorded as it went: finished projects, weighed before and after,
 * and yarn marked used up.
 */
export class StashStatsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private yarns: Yarn[] = [];
  private months: MonthFlow[] = [];
  /** The month whose yarn is listed: the current one to start with. */
  private chosen = 11;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library stash-stats";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Stash</h1>${stashModeSwitch("stats")}</div>
      </header>
      <main class="stats-body" data-el="stats"></main>
    `;
    this.screen.appendChild(this.root);
    this.wire();
    const [yarns, uses] = await Promise.all([api.listYarns({ used: "all" }), api.listYarnUsage().catch(() => [] as YarnUse[])]);
    this.yarns = yarns;
    this.months = flowByMonth(additions(yarns), uses);
    this.paint();
  }

  private paint(): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="stats"]')!;
    const inStash = this.yarns.filter((y) => !y.usedUpAt);
    const metres = inStash.reduce((n, y) => n + y.metresLeft, 0);
    const grams = inStash.reduce((n, y) => n + y.gramsLeft, 0);
    const m = this.months[this.chosen];
    const unitSwitch = `
      <div class="seg" role="group" aria-label="Counted in">
        ${(["m", "g"] as Unit[]).map((u) => `<button class="${kept.unit === u ? "on" : ""}" data-unit="${u}">${u === "m" ? "Metres" : "Grams"}</button>`).join("")}
      </div>`;
    el.innerHTML = `
      <section class="stats-tiles">
        <div class="stat-tile"><span>In the stash now</span><b>${fmt(metres)} m</b><small>${weight(grams)} in ${inStash.length} yarn${inStash.length === 1 ? "" : "s"}</small></div>
        <div class="stat-tile"><span>Added in the last 12 months</span><b>${fmt(sum(this.months, "added", kept.unit))} ${kept.unit}</b><small>${fmt(sum(this.months, "added", other(kept.unit)))} ${other(kept.unit)}</small></div>
        <div class="stat-tile"><span>Used in the last 12 months</span><b>${fmt(sum(this.months, "used", kept.unit))} ${kept.unit}</b><small>${fmt(sum(this.months, "used", other(kept.unit)))} ${other(kept.unit)}</small></div>
      </section>
      <section class="usage-panel">
        <div class="usage-head">
          <div><h2>Added and used, month by month</h2>
            <p class="hint">Each calendar month, first day to last. Added: the lots as bought, dated when bought (or when the yarn was added). Used: what finished projects took, weighed before and after, and what was left of yarn marked used up; counted from version 0.3.23 on.</p></div>
          ${unitSwitch}
        </div>
        <div class="usage-body">
          ${flowChartHtml(this.months, this.chosen, kept.unit)}
          <div class="usage-detail">
            <h3>${esc(m.label)}</h3>
            ${this.flowHtml("added", m.added)}
            ${this.flowHtml("used", m.used)}
          </div>
        </div>
        <details class="usage-table"><summary>The months as a table</summary>
          <table class="calc-table"><thead><tr><th>Month</th><th>Added, m</th><th>Added, g</th><th>Used, m</th><th>Used, g</th></tr></thead><tbody>
            ${[...this.months]
              .reverse()
              .map((x) => `<tr><td>${esc(x.label)}</td><td>${fmt(x.added.metres)}</td><td>${fmt(x.added.grams)}</td><td>${fmt(x.used.metres)}</td><td>${fmt(x.used.grams)}</td></tr>`)
              .join("")}
          </tbody></table>
        </details>
      </section>`;
  }

  /** One month's yarn added, or used: the figures, then each yarn. */
  private flowHtml(key: "added" | "used", f: Flow<unknown>): string {
    const s = SERIES.find((x) => x.key === key)!;
    const lines =
      key === "added"
        ? (f.items as ReturnType<typeof additions>).map((a) => ({ name: a.yarnName, metres: a.metres, note: [`${fmt(a.grams)} g`, a.what, day(a.at)].filter(Boolean).join(" · ") }))
        : (f.items as YarnUse[]).map((u) => ({ name: u.yarnName, metres: u.metres, note: [`${fmt(u.grams)} g`, u.projectName || "marked used up", day(u.at)].join(" · ") }));
    const without = f.gramsWithoutMetres ? ` · ${fmt(f.gramsWithoutMetres)} g with no metres per ball` : "";
    return `
      <div class="usage-figure"><span class="usage-key"><i style="background:${s.colour}"></i>${s.label}</span>
        <b>${fmt(f.metres)} m</b><small>${fmt(f.grams)} g${without}</small></div>
      ${
        lines.length
          ? `<ul class="usage-list">${lines.map((l) => `<li><span>${esc(l.name)}</span><b>${l.metres ? `${fmt(l.metres)} m` : "–"}</b><em>${esc(l.note)}</em></li>`).join("")}</ul>`
          : `<p class="hint">Nothing ${key} this month.</p>`
      }`;
  }

  /** Choosing a month lists its yarn; pointing at one, or tabbing to it, says its figures; the switch counts in metres or grams. */
  private wire(): void {
    const panel = this.root;
    panel.addEventListener("click", (e) => {
      const mode = closestEl(e.target, '[data-act="stash-mode"]');
      if (mode) return void this.root.dispatchEvent(new CustomEvent("stash-mode", { bubbles: true, detail: mode.dataset.mode }));
      const unit = closestEl(e.target, "[data-unit]");
      if (unit) {
        kept.unit = unit.dataset.unit as Unit;
        return this.paint();
      }
      const col = closestEl(e.target, "[data-month]");
      if (!col) return;
      this.chosen = Number(col.dataset.month);
      this.paint();
      panel.querySelector<HTMLElement>(`[data-month="${this.chosen}"]`)?.focus();
    });
    const show = (e: Event) => {
      const col = closestEl(e.target, "[data-month]");
      const tip = panel.querySelector<HTMLElement>(".usage-tip");
      if (!col || !tip) return;
      tip.textContent = col.dataset.tip ?? "";
      tip.hidden = false;
      const plot = col.closest<HTMLElement>(".usage-plot")!.getBoundingClientRect();
      const r = col.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - plot.left, 120), plot.width - 120)}px`;
    };
    const hide = () => {
      const tip = panel.querySelector<HTMLElement>(".usage-tip");
      if (tip) tip.hidden = true;
    };
    panel.addEventListener("pointerover", show);
    panel.addEventListener("focusin", show);
    panel.addEventListener("pointerout", (e) => {
      if (!closestEl((e as PointerEvent).relatedTarget, "[data-month]")) hide();
    });
    panel.addEventListener("focusout", hide);
  }
}

function sum(months: MonthFlow[], key: "added" | "used", unit: Unit): number {
  return months.reduce((n, m) => n + (unit === "m" ? m[key].metres : m[key].grams), 0);
}

function other(unit: Unit): Unit {
  return unit === "m" ? "g" : "m";
}

const fmt = (n: number) => n.toLocaleString("en-GB");

function day(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Grams as they read best: 850 g, or 2.15 kg. */
function weight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg` : `${grams} g`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
