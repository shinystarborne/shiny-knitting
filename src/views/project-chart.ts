import { api, type Chart, type Project } from "../api";
import { say } from "../dialogs";
import { closestEl } from "../dom";
import { chartPlace, colourLabel, decode, normalize, rowInWords, stitchMask, writeOut, type Grid, type WrittenRow } from "./chart";
import { CanvasPainter, drawChart, margins, PAPER, sizeCanvas } from "./chart-draw";

/**
 * A colourwork chart knitted from on a project's page: the chart, the row to
 * knit next marked on it and written out, moving as the project's rows are
 * counted. The chart's first row is knitted on one of the project's rows
 * (after a rib, say), and a standard chart repeats up the work from there.
 */
export class ProjectChart {
  readonly host: HTMLElement;
  private charts: Chart[] = [];
  private g: Grid | null = null;
  private mask: Uint8Array = new Uint8Array(0);
  private lines: WrittenRow[] = [];
  /** Rows knitted, as the project's counter has them. */
  private total = 0;

  constructor(
    private project: () => Project,
    private saved: (p: Project) => void,
  ) {
    this.host = document.createElement("div");
    this.host.className = "side-section project-chart";
    this.host.addEventListener("change", (e) => void this.onChange(e));
    this.host.addEventListener("click", (e) => this.onClick(e));
  }

  async load(): Promise<void> {
    this.charts = await api.listCharts().catch(() => [] as Chart[]);
    this.useChart();
    this.paint();
  }

  /** The rows knitted, from the counter: the mark moves to the next. */
  setTotal(total: number): void {
    if (total === this.total) return;
    this.total = total;
    this.paintPlace();
  }

  private useChart(): void {
    const chart = this.charts.find((c) => c.id === this.project().chartId);
    this.g = chart ? decode(chart.data) : null;
    if (this.g) {
      normalize(this.g);
      this.mask = stitchMask(this.g);
      this.lines = writeOut(this.g);
    }
  }

  private start(): number {
    return Math.max(1, this.project().chartStart || 1);
  }

  private paint(): void {
    const p = this.project();
    const chosen = this.charts.find((c) => c.id === p.chartId);
    this.host.innerHTML = `
      <h3>Chart</h3>
      ${
        this.charts.length
          ? `<label class="field"><span>Knitted from</span>
          <select data-f="chart">
            <option value="">No chart</option>
            ${this.charts.map((c) => `<option value="${esc(c.id)}" ${c.id === p.chartId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select></label>`
          : `<p class="hint">Draw a colourwork chart under Calculators, to knit from it here: the row to knit marked, as the rows are counted.</p>`
      }
      ${
        chosen
          ? `<div class="project-chart-start">
          <label class="field calc-field" title="The project's row its first row is knitted on: after a rib, say"><span>First row on row</span>
            <input data-f="chart-start" inputmode="numeric" value="${this.start()}" /></label>
          <button class="link" data-act="open-chart" title="Open the chart to change it">Open it ↗</button>
        </div>
        <div class="project-chart-pic" data-el="pic"><canvas></canvas></div>
        <p class="project-chart-where" data-el="where"></p>
        <p class="project-chart-words" data-el="words"></p>`
          : ""
      }`;
    this.paintPlace();
  }

  /** The chart drawn with the row to knit marked, and that row in words. */
  private paintPlace(): void {
    const g = this.g;
    const canvas = this.host.querySelector<HTMLCanvasElement>('[data-el="pic"] canvas');
    if (!g || !canvas) return;
    const place = chartPlace(g, this.total, this.start());
    const current = place.kind === "row" ? place.row - 1 : -1;
    const word = g.flat ? "Row" : "Round";

    // As big as the side allows, the squares no smaller than can be told apart.
    const room = Math.max(200, (this.host.clientWidth || 300) - 8);
    const cell = Math.max(5, Math.min(18, Math.floor((room - 30) / g.width)));
    const m = margins(g, cell, cell);
    const pad = 4;
    const layout = { x: pad + m.left, y: pad, cw: cell, ch: cell };
    const w = pad * 2 + m.left + m.right + cell * g.width;
    const h = pad * 2 + cell * g.height + m.bottom;
    const ctx = sizeCanvas(canvas, w, h);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    drawChart(new CanvasPainter(ctx), g, { ...layout, numbers: true, mask: this.mask });
    const rowTop = (y: number) => layout.y + (g.height - 1 - y) * cell;
    if (current >= 0) {
      // The rows of this repeat knitted already, faded; the next, marked.
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      for (let y = 0; y < current; y++) ctx.fillRect(layout.x, rowTop(y), cell * g.width, cell);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#e5484d";
      ctx.strokeRect(layout.x - 1, rowTop(current) - 1, cell * g.width + 2, cell + 2);
    }
    canvas.dataset.row = String(current + 1);

    const where = this.host.querySelector<HTMLElement>('[data-el="where"]')!;
    const words = this.host.querySelector<HTMLElement>('[data-el="words"]')!;
    if (place.kind === "before") {
      where.textContent = `It starts on row ${this.start()}: ${place.rowsToGo} ${place.rowsToGo === 1 ? "row" : "rows"} to go.`;
      words.textContent = "";
    } else if (place.kind === "done") {
      where.textContent = `The yoke chart is knitted: all ${g.height} rounds.`;
      words.textContent = "";
    } else {
      const side = g.flat ? (place.row % 2 ? " (right side)" : " (wrong side)") : "";
      where.textContent = `${word} ${place.row} of ${g.height}${side}${g.kind !== "yoke" && place.repeat > 1 ? ` · repeat ${place.repeat}` : ""}`;
      const line = rowInWords(g, place.row, this.lines);
      words.textContent = line?.text ?? "";
      words.title = g.colours.map(colourLabel).join(", ");
      // The marked row in view, in a chart taller than the side.
      const pic = this.host.querySelector<HTMLElement>('[data-el="pic"]')!;
      const y = rowTop(current);
      if (y < pic.scrollTop || y + cell > pic.scrollTop + pic.clientHeight) pic.scrollTop = Math.max(0, y - pic.clientHeight / 2);
    }
  }

  private async onChange(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el.dataset.f;
    if (f !== "chart" && f !== "chart-start") return;
    const p = this.project();
    const chartId = f === "chart" ? el.value : p.chartId ?? "";
    const start = f === "chart-start" ? Math.round(Number(el.value)) : this.start();
    if (f === "chart-start" && !(start >= 1)) {
      el.value = String(this.start());
      return void say("The first row is a row of the project: 1, or later.", "Chart");
    }
    try {
      this.saved(await api.setProjectChart(p.id, chartId, start));
    } catch (err) {
      return void say(err instanceof Error ? err.message : String(err), "Chart");
    }
    if (f === "chart") {
      this.useChart();
      this.paint();
    } else {
      this.paintPlace();
    }
  }

  private onClick(e: MouseEvent): void {
    if (closestEl(e.target, '[data-act="open-chart"]') && this.project().chartId) {
      this.host.dispatchEvent(new CustomEvent("open-chart", { bubbles: true, detail: this.project().chartId }));
    }
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
