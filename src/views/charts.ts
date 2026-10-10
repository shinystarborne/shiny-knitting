import { api, isLive, type Chart, type MeasureUnit, type Project, type Swatch, type Yarn } from "../api";
import { askForm, askYesNo, customDialog, dialogOpen, say } from "../dialogs";
import { blobBytes, prepareBoardImage } from "../covers";
import { closestEl } from "../dom";
import {
  clearRect,
  clone,
  colourLabel,
  copyBlock,
  decode,
  describe,
  encode,
  fillArea,
  flipped,
  flippedBlock,
  knittedSize,
  linePoints,
  longFloats,
  MAX_COLOURS,
  MAX_SIDE,
  mirrorX,
  newGrid,
  nextColour,
  normalize,
  PALETTE,
  pasteBlock,
  readingNote,
  rectBetween,
  rectPoints,
  removeColour,
  resized,
  shifted,
  stitchMask,
  totalInRow,
  turnedRound,
  usage,
  usualShaping,
  writeOut,
  writtenText,
  type Block,
  type Float,
  type Grid,
  type Rect,
} from "./chart";
import { CanvasPainter, chartPng, drawChart, drawRing, drawThumbnail, drawTiles, knittedAspect, margins, PAPER, sizeCanvas } from "./chart-draw";
import { chartPdf, PAPERS, type Paper } from "./chart-pdf";
import { gaugeOf, gaugeSpan, readGauge, showGauge, showLength, unitLabel } from "./measure";
import { longDate } from "./project-form";

// ---------- the list, in the Calculators tab ----------

/**
 * The colourwork charts, in the Calculators tab: a card each, drawn from the
 * chart itself, and a new one, standard or a round yoke. A chart opens on a
 * page of its own.
 */
export class ChartList {
  private root: HTMLElement;
  private charts: Chart[] = [];

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "chart-list";
    host.appendChild(this.root);
    this.root.addEventListener("click", (e) => void this.onClick(e));
  }

  async mount(): Promise<void> {
    this.root.innerHTML = `<p class="calc-wait">Loading charts…</p>`;
    this.charts = await api.listCharts().catch(() => [] as Chart[]);
    this.paint();
  }

  private paint(): void {
    this.root.innerHTML = `
      <header class="chart-list-head">
        <div>
          <h2>Colourwork charts</h2>
          <p class="hint">A grid where a square is a stitch: a standard chart, worked flat or in the round, or a round yoke's repeat, with its shaping, as a lopapeysa's.</p>
        </div>
        <button class="primary" data-act="new-chart">+ New chart</button>
      </header>
      ${
        this.charts.length
          ? `<div class="chart-cards">${this.charts.map(cardHtml).join("")}</div>`
          : `<div class="empty"><h2>No charts yet</h2><p>Draw a motif, a border, or a yoke: name its colours, see it knitted up, and print it at the real size.</p></div>`
      }`;
    for (const canvas of this.root.querySelectorAll<HTMLCanvasElement>("canvas[data-id]")) {
      const chart = this.charts.find((c) => c.id === canvas.dataset.id);
      if (chart) drawThumbnail(canvas, decode(chart.data), 228, 150);
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const act = closestEl(e.target, "button[data-act]");
    if (act?.dataset.act === "new-chart") return void (await this.create());
    if (act?.dataset.act === "remove-chart") {
      e.stopPropagation();
      const chart = this.charts.find((c) => c.id === act.dataset.id);
      if (!chart) return;
      if (!(await askYesNo(`Remove the chart “${chart.name}”? This cannot be undone.`, { title: "Remove chart", okLabel: "Remove", danger: true }))) return;
      await api.deleteChart(chart.id).catch((err) => say(err instanceof Error ? err.message : String(err), "Remove chart"));
      return void (await this.mount());
    }
    if (act?.dataset.act === "copy-chart") {
      e.stopPropagation();
      const chart = this.charts.find((c) => c.id === act.dataset.id);
      if (!chart) return;
      try {
        await api.addChart(`${chart.name} (copy)`, chart.data);
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "Copy chart");
      }
      return void (await this.mount());
    }
    const card = closestEl(e.target, "[data-open-chart]");
    if (card) open(this.root, card.dataset.openChart!);
  }

  private async create(): Promise<void> {
    const made = await newChartDialog();
    if (!made) return;
    try {
      const chart = await api.addChart(made.name, encode(made.grid));
      open(this.root, chart.id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "New chart");
    }
  }
}

function open(from: HTMLElement, id: string): void {
  from.dispatchEvent(new CustomEvent("open-chart", { bubbles: true, detail: id }));
}

function cardHtml(c: Chart): string {
  const kind = c.data.kind === "yoke" ? "Round yoke" : c.data.flat ? "Flat" : "In the round";
  const size = c.data.kind === "yoke" ? `${c.data.width}-st repeat × ${c.data.repeats}, ${c.data.height} rounds` : `${c.data.width} × ${c.data.height}`;
  return `
    <article class="chart-card" data-open-chart="${esc(c.id)}">
      <div class="chart-card-pic"><canvas data-id="${esc(c.id)}"></canvas></div>
      <div class="chart-card-body">
        <h3>${esc(c.name)}</h3>
        <p>${esc(`${kind} · ${size}`)}</p>
        <p>${esc(`${c.data.colours.length} colours · changed ${longDate(c.updatedAt)}`)}</p>
      </div>
      <div class="chart-card-actions">
        <button class="ghost" data-act="copy-chart" data-id="${esc(c.id)}" title="Make a copy to change">Copy</button>
        <button class="card-remove" data-act="remove-chart" data-id="${esc(c.id)}" title="Remove this chart">Remove</button>
      </div>
    </article>`;
}

/** Asks what kind of chart, and how big: resolves the new chart, or null. */
function newChartDialog(): Promise<{ name: string; grid: Grid } | null> {
  return new Promise((resolve) => {
    const finish = (out: { name: string; grid: Grid } | null) => {
      dialog.close();
      resolve(out);
    };
    const dialog = customDialog("New chart", () => finish(null), "chart-new-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <label class="dialog-field"><span class="dialog-label">Name</span>
        <input class="dialog-input" data-f="name" placeholder="e.g. Snowflake border" /></label>
      <div class="chart-kinds" role="radiogroup">
        <label class="chart-kind"><input type="radio" name="kind" value="standard" checked />
          <span><b>Standard</b><em>Any motif or allover pattern, worked flat or in the round</em></span></label>
        <label class="chart-kind"><input type="radio" name="kind" value="yoke" />
          <span><b>Round yoke (lopapeysa)</b><em>One repeat, knitted round the yoke, narrowing towards the neck</em></span></label>
      </div>
      <div class="chart-new-fields" data-for="standard">
        <label class="dialog-field"><span class="dialog-label">Stitches wide</span><input class="dialog-input" data-f="w" inputmode="numeric" value="24" /></label>
        <label class="dialog-field"><span class="dialog-label">Rows high</span><input class="dialog-input" data-f="h" inputmode="numeric" value="24" /></label>
        <label class="dialog-field"><span class="dialog-label">Worked</span>
          <select class="dialog-input" data-f="flat"><option value="round">In the round</option><option value="flat">Flat, in rows</option></select></label>
      </div>
      <div class="chart-new-fields" data-for="yoke" hidden>
        <label class="dialog-field"><span class="dialog-label">Stitches in the repeat</span><input class="dialog-input" data-f="rw" inputmode="numeric" value="12" /></label>
        <label class="dialog-field"><span class="dialog-label">Rounds</span><input class="dialog-input" data-f="rh" inputmode="numeric" value="45" /></label>
        <label class="dialog-field"><span class="dialog-label">Repeats around</span><input class="dialog-input" data-f="reps" inputmode="numeric" value="18" /></label>
        <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="shaped" checked />
          <span><span class="dialog-label">Start with the usual shaping</span><span class="dialog-hint">Three decrease rounds, to about two fifths of the repeat at the neck. Change them as you like.</span></span></label>
      </div>
      <p class="form-error" data-el="error" hidden></p>
      <div class="dialog-actions">
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="make">Make the chart</button>
      </div>`,
    );
    const card = dialog.card;
    const field = (f: string) => card.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
    const kind = () => card.querySelector<HTMLInputElement>('input[name="kind"]:checked')!.value as "standard" | "yoke";
    card.addEventListener("change", () => {
      for (const el of card.querySelectorAll<HTMLElement>("[data-for]")) el.hidden = el.dataset.for !== kind();
    });
    const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
    const make = () => {
      const yoke = kind() === "yoke";
      const num = (f: string) => Number(field(f).value.trim());
      const [w, h] = yoke ? [num("rw"), num("rh")] : [num("w"), num("h")];
      const bad = [w, h].some((v) => !Number.isInteger(v) || v < 1 || v > MAX_SIDE);
      if (bad) {
        error.textContent = `A chart is 1 to ${MAX_SIDE} squares each way.`;
        error.hidden = false;
        return;
      }
      if (yoke && !(Number.isInteger(num("reps")) && num("reps") >= 1 && num("reps") <= 300)) {
        error.textContent = "Say how many times the repeat goes round the yoke, e.g. 18.";
        error.hidden = false;
        return;
      }
      const grid = newGrid({ kind: kind(), width: w, height: h, repeats: num("reps"), shaped: field("shaped").checked, flat: field("flat").value === "flat" });
      finish({ name: field("name").value.trim() || (yoke ? "Yoke" : "Chart"), grid });
    };
    card.addEventListener("click", (e) => {
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "cancel") finish(null);
      if (act === "make") make();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
        e.preventDefault();
        make();
      }
    });
    dialog.show(field("name"));
  });
}

// ---------- one chart ----------

type Tool = "draw" | "fill" | "line" | "rect" | "pick" | "select";
type Side = "preview" | "chart" | "words";

const TOOLS: { key: Tool; label: string; key1: string; hint: string }[] = [
  { key: "draw", label: "Draw", key1: "D", hint: "Draw square by square; right-click draws in the background colour" },
  { key: "fill", label: "Fill", key1: "F", hint: "Fill the squares joined to this one, in its colour" },
  { key: "line", label: "Line", key1: "L", hint: "A straight line: drag from end to end" },
  { key: "rect", label: "Box", key1: "B", hint: "A box: drag from corner to corner; with Shift, filled" },
  { key: "pick", label: "Pick", key1: "I", hint: "Pick up a square's colour (or Alt+click with any tool)" },
  { key: "select", label: "Select", key1: "S", hint: "Select a block of squares, to copy, cut, paste or clear: drag from corner to corner" },
];

/**
 * What the page keeps while the app is open: the tool, the side panel,
 * squares as knitted, and the block copied last, which pastes into any chart.
 */
const kept: { tool: Tool; side: Side; knitted: boolean; clip: Block | null } = { tool: "draw", side: "preview", knitted: false, clip: null };

const UNDO_LIMIT = 100;

export interface ChartPageHooks {
  back(): void;
}

/**
 * One chart, filling the screen: the grid to draw on in the middle, the
 * colours above it, and beside it the chart knitted up (tiled, or a yoke
 * from above), its settings, and the rows in words. Every change saves as it
 * is made; Ctrl+Z takes it back.
 */
export class ChartPage {
  private screen: HTMLElement;
  private chartId: string;
  private hooks: ChartPageHooks;
  private root!: HTMLElement;
  private g!: Grid;
  private name = "";
  private savedName = "";
  private savedData = "";
  private saveTimer: number | null = null;
  private colour = 1;
  /** A square's height on screen; the chart is fitted to the window when it opens. */
  private zoomPx = 18;
  private mirror = false;
  private undoStack: Grid[] = [];
  private redoStack: Grid[] = [];
  private mask: Uint8Array = new Uint8Array(0);
  private floats: Float[] = [];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private layout = { x: 0, y: 0, cw: 18, ch: 18 };
  private drag: { tool: Tool; colour: number; start: [number, number]; last: [number, number]; before: Uint8Array; filled: boolean } | null = null;
  /** The block selected, with the Select tool. */
  private selection: Rect | null = null;
  /** A block being pasted: it follows the pointer, and each click puts it down; `at` is its top-left square. */
  private pasting: { block: Block; at: [number, number] } | null = null;
  /** The square under the pointer, for where a paste starts. */
  private hover: [number, number] | null = null;
  private swatches: Swatch[] = [];
  private projects: Project[] = [];
  /** The stash's yarns, to say which a colour is knitted in. */
  private yarns: Yarn[] = [];
  private unit: MeasureUnit = "cm";
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** Removed: there is nothing to save any more. */
  private removed = false;

  constructor(screen: HTMLElement, chartId: string, hooks: ChartPageHooks) {
    this.screen = screen;
    this.chartId = chartId;
    this.hooks = hooks;
  }

  get id(): string {
    return this.chartId;
  }

  async mount(): Promise<void> {
    let chart: Chart;
    try {
      [chart, this.swatches, this.projects, this.unit, this.yarns] = await Promise.all([
        api.getChart(this.chartId),
        api.listSwatches().catch(() => [] as Swatch[]),
        api.listProjects().catch(() => [] as Project[]),
        api.getMeasureUnit().catch(() => "cm" as const),
        api.listYarns().catch(() => [] as Yarn[]),
      ]);
    } catch {
      await say("That chart is no longer there.");
      this.hooks.back();
      return;
    }
    this.g = decode(chart.data);
    normalize(this.g);
    this.name = this.savedName = chart.name;
    this.savedData = JSON.stringify(encode(this.g));
    this.colour = this.g.colours.length > 1 ? 1 : 0;
    this.root = document.createElement("div");
    this.root.className = "chart-page";
    this.root.innerHTML = `
      <header class="inspo-bar chart-bar">
        <button class="ghost back" data-act="back">← Charts</button>
        <input class="inspo-name" data-f="name" value="${esc(chart.name)}" aria-label="Chart name" placeholder="Name this chart" />
        <span class="hint" data-el="saved">Saved</span>
        <span class="hint chart-note" data-el="note"></span>
        <button class="ghost" data-act="export" title="Save it as a PDF to print, or a picture">Export…</button>
        <button class="ghost" data-act="to-board" title="Put it on a project's board">Save to a project…</button>
        <button class="ghost danger-text" data-act="remove">Remove chart</button>
      </header>
      <div class="chart-toolbar">
        <div class="seg" role="group" aria-label="Tools">
          ${TOOLS.map((t) => `<button class="ghost" data-tool="${t.key}" title="${esc(`${t.hint} (${t.key1})`)}">${t.label}</button>`).join("")}
        </div>
        <button class="ghost toggle" data-act="mirror" title="Draw both halves at once, mirrored across the middle (M)">Mirror</button>
        <span class="chart-sep"></span>
        <button class="ghost" data-act="copy" title="Copy the squares selected (Ctrl+C)">Copy</button>
        <button class="ghost" data-act="cut" title="Copy them, and fill them with the background (Ctrl+X)">Cut</button>
        <button class="ghost" data-act="paste" title="Put the squares copied down, as many times as you click; Esc when done (Ctrl+V)">Paste</button>
        <span class="chart-paste-tools" data-el="paste-tools" hidden>
          <button class="ghost" data-act="block-flip-x" title="Mirror the block left to right">Flip ↔</button>
          <button class="ghost" data-act="block-flip-y" title="Mirror the block top to bottom">Flip ↕</button>
          <button class="ghost" data-act="paste-done" title="Stop pasting (Esc)">Done</button>
        </span>
        <span class="chart-sep"></span>
        <button class="ghost" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button class="ghost" data-act="redo" title="Redo (Ctrl+Y)">Redo</button>
        <span class="chart-sep"></span>
        <button class="ghost" data-act="zoom-out" title="Smaller squares (−)">−</button>
        <button class="ghost" data-act="zoom-in" title="Bigger squares (+)">+</button>
        <button class="ghost toggle" data-act="knitted" title="Squares the shape stitches are: wider than tall, at the chart's gauge">As knitted</button>
        <span class="chart-status hint" data-el="status"></span>
      </div>
      <div class="chart-palette" data-el="palette"></div>
      <div class="chart-work">
        <div class="chart-scroll" data-el="scroll"><canvas class="chart-canvas"></canvas></div>
        <aside class="chart-side">
          <div class="seg chart-tabs" role="tablist">
            <button class="ghost" data-side="preview">Knitted up</button>
            <button class="ghost" data-side="chart">Chart</button>
            <button class="ghost" data-side="words">In words</button>
          </div>
          <div class="chart-side-body" data-el="side"></div>
        </aside>
      </div>
    `;
    this.screen.appendChild(this.root);
    this.canvas = this.root.querySelector<HTMLCanvasElement>(".chart-canvas")!;
    this.wire();
    this.zoomPx = this.fitZoom();
    this.refresh();
    document.addEventListener("keydown", this.onKey);
  }

  /** Saves what is not saved yet, and takes the page down. */
  destroy(): void {
    document.removeEventListener("keydown", this.onKey);
    if (this.root && this.g && !this.removed) void this.save();
    this.root?.remove();
  }

  // ---------- wiring ----------

  private wire(): void {
    const name = this.root.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.addEventListener("input", () => {
      this.name = name.value;
      this.scheduleSave();
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
    this.root.addEventListener("input", (e) => this.onInput(e));
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", (e) => this.up(e));
    this.canvas.addEventListener("pointerleave", () => this.status());
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.root.querySelector('[data-el="scroll"]')!.addEventListener(
      "wheel",
      (e) => {
        const w = e as WheelEvent;
        if (!w.ctrlKey) return;
        w.preventDefault();
        this.zoom(w.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const tool = closestEl(e.target, "[data-tool]")?.dataset.tool as Tool | undefined;
    if (tool) return this.setTool(tool);
    const blockAct = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (blockAct === "copy") return this.copySelection(false);
    if (blockAct === "cut") return this.copySelection(true);
    if (blockAct === "paste") return this.startPaste();
    if (blockAct === "paste-done") return this.stopPaste();
    if (blockAct === "block-flip-x" || blockAct === "block-flip-y") return this.flipPaste(blockAct === "block-flip-x" ? "x" : "y");
    const side = closestEl(e.target, "[data-side]")?.dataset.side as Side | undefined;
    if (side) {
      kept.side = side;
      return this.paintSide();
    }
    const chip = closestEl(e.target, "[data-colour]");
    if (chip) {
      this.colour = Number(chip.dataset.colour);
      return this.paintPalette();
    }
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "back") return this.hooks.back();
    if (act === "mirror") return this.toggleMirror();
    if (act === "undo") return this.undo();
    if (act === "redo") return this.redo();
    if (act === "zoom-in") return this.zoom(1);
    if (act === "zoom-out") return this.zoom(-1);
    if (act === "knitted") {
      kept.knitted = !kept.knitted;
      return this.refresh();
    }
    if (act === "add-colour") return this.addColour();
    if (act === "remove-colour") return void (await this.removeColour());
    if (act === "remove") return void (await this.remove());
    if (act === "export") return void (await this.exportDialog());
    if (act === "to-board") return void (await this.boardDialog());
    if (act === "copy-words") return void (await this.copyWords());
    if (act === "resize") return this.applyResize();
    if (act === "shift") return this.change(() => shifted(this.g, Number(closestEl(e.target, "[data-dx]")!.dataset.dx), Number(closestEl(e.target, "[data-dx]")!.dataset.dy)));
    if (act === "flip-x") return this.change(() => flipped(this.g, "x"));
    if (act === "flip-y") return this.change(() => flipped(this.g, "y"));
    if (act === "clear") {
      if (!(await askYesNo(`Fill the whole chart with ${this.g.colours[0].name}? Undo brings it back.`, { title: "Clear the chart", okLabel: "Clear" }))) return;
      return this.change(() => this.g.cells.fill(0));
    }
    if (act === "add-shaping") return void (await this.addShaping());
    if (act === "remove-shaping") {
      const i = Number(closestEl(e.target, "[data-section]")!.dataset.section);
      return this.change(() => {
        this.g.sections.splice(i, 1);
        normalize(this.g);
      }, true);
    }
    if (act === "auto-cols") {
      const i = Number(closestEl(e.target, "[data-section]")!.dataset.section);
      return this.change(() => {
        this.g.sections[i].cols = [];
        normalize(this.g);
      }, true);
    }
    if (act === "usual-shaping") {
      if (this.g.sections.length > 1 && !(await askYesNo("Put the usual three decrease rounds in place of the shaping there is?", { title: "Usual shaping", okLabel: "Put them in" }))) return;
      return this.change(() => usualShaping(this.g), true);
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el.dataset.f;
    if (!f || f === "name") return;
    const value = el.value.trim();
    const num = Number(value.replace(",", "."));
    switch (f) {
      case "colour-hex":
        return this.change(() => (this.g.colours[this.colour].hex = value.toLowerCase()));
      case "colour-name":
        return this.change(() => (this.g.colours[this.colour].name = value || `Colour ${this.colour + 1}`));
      case "colour-yarn":
        return this.change(() => this.linkYarn(this.colour, value));
      case "flat":
        return this.change(() => (this.g.flat = value === "flat"), true);
      case "repeats":
        if (!Number.isInteger(num) || num < 1 || num > 300) return void say("A yoke's repeat goes round 1 to 300 times.", "Repeats");
        return this.change(() => (this.g.repeats = num), true);
      case "direction":
        if ((value === "down") === this.g.topDown) return;
        return this.change(() => turnedRound(this.g), true);
      case "symbols":
        return this.change(() => (this.g.symbols = (el as HTMLInputElement).checked), true);
      case "floats":
        if (!Number.isInteger(num) || num < 0) return void say("Floats are counted in stitches: 5, say, or 0 for none pointed out.", "Floats");
        return this.change(() => (this.g.floatLimit = Math.min(99, num)), true);
      case "swatch": {
        const s = this.swatches.find((x) => x.id === value);
        if (!s) return;
        const gauge = gaugeOf(s);
        return this.change(() => (this.g.gauge = { sts: gauge.sts, rows: gauge.rows }), true);
      }
      case "gauge-sts":
      case "gauge-rows": {
        const per10 = value ? readGauge(value, this.unit) : 0;
        if (Number.isNaN(per10) || per10 < 0 || per10 > 150) return void say(`Give the ${f === "gauge-sts" ? "stitches" : "rows"} per ${gaugeSpan(this.unit)}.`, "Gauge");
        return this.change(() => (this.g.gauge[f === "gauge-sts" ? "sts" : "rows"] = Math.round(per10 * 10) / 10), true);
      }
      case "section-row":
      case "section-sts":
      case "section-cols": {
        const i = Number(closestEl(el, "[data-section]")!.dataset.section);
        return this.change(() => {
          const s = this.g.sections[i];
          if (f === "section-row" && Number.isInteger(num)) s.row = num - 1;
          if (f === "section-sts" && Number.isInteger(num)) s.sts = num;
          // Typed as stitch numbers, counted from the right as on the chart.
          if (f === "section-cols") s.cols = value.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= this.g.width).map((n) => this.g.width - n);
          normalize(this.g);
        }, true);
      }
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    if (el.dataset.f === "notes") {
      this.g.notes = el.value;
      this.scheduleSave();
    }
  }

  // ---------- changing, undoing, saving ----------

  private pushUndo(): void {
    this.undoStack.push(clone(this.g));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Makes a change that can be undone, then draws and saves; `side` repaints the settings too. */
  private change(fn: () => void, side = false): void {
    this.pushUndo();
    fn();
    this.refresh(side);
  }

  private undo(): void {
    const last = this.undoStack.pop();
    if (!last) return;
    this.redoStack.push(clone(this.g));
    this.g = last;
    this.colour = Math.min(this.colour, this.g.colours.length - 1);
    this.refresh(true);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.g));
    this.g = next;
    this.colour = Math.min(this.colour, this.g.colours.length - 1);
    this.refresh(true);
  }

  private scheduleSave(): void {
    this.mark("Saving…");
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 600);
  }

  private async save(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.removed) return;
    const data = encode(this.g);
    const json = JSON.stringify(data);
    const name = this.name.trim() || this.savedName;
    if (json === this.savedData && name === this.savedName) return this.mark("Saved");
    try {
      const stored = await api.updateChart(this.chartId, name, data);
      this.savedData = json;
      this.savedName = stored.name;
      this.mark("Saved");
    } catch (err) {
      this.mark(err instanceof Error ? err.message : String(err));
    }
  }

  private mark(text: string): void {
    const el = this.root?.querySelector<HTMLElement>('[data-el="saved"]');
    if (el) el.textContent = text;
  }

  /** Where an export or a board item went, beside the saving state, until the next. */
  private note(text: string): void {
    const el = this.root?.querySelector<HTMLElement>('[data-el="note"]');
    if (el) {
      el.textContent = text;
      el.title = text;
    }
  }

  // ---------- drawing on the grid ----------

  private fitZoom(): number {
    const scroll = this.root.querySelector<HTMLElement>('[data-el="scroll"]')!;
    const w = Math.max(300, scroll.clientWidth - 80);
    const h = Math.max(240, scroll.clientHeight - 60);
    return Math.max(6, Math.min(28, Math.floor(Math.min(w / this.g.width, h / this.g.height))));
  }

  private zoom(by: number): void {
    const steps = [6, 8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 40];
    const at = steps.findIndex((s) => s >= this.zoomPx);
    const i = Math.max(0, Math.min(steps.length - 1, (at < 0 ? steps.length - 1 : at) + by));
    this.zoomPx = steps[i];
    this.paintGrid();
  }

  /** Draws everything again after a change, and saves. */
  private refresh(side = true): void {
    normalize(this.g);
    // A selection the chart no longer reaches (made smaller, or undone) goes.
    if (this.selection && (this.selection.x1 >= this.g.width || this.selection.y1 >= this.g.height)) this.selection = null;
    this.mask = stitchMask(this.g);
    this.floats = longFloats(this.g, this.g.floatLimit, this.mask);
    this.paintGrid();
    this.paintPalette();
    this.paintToolbar();
    if (side) this.paintSide();
    else this.paintSideLive();
    this.status();
    this.scheduleSave();
  }

  private paintGrid(): void {
    const ch = this.zoomPx;
    const cw = kept.knitted ? ch * knittedAspect(this.g) : ch;
    const m = margins(this.g, cw, ch);
    const pad = 12;
    this.layout = { x: pad + m.left, y: pad, cw, ch };
    // Where the squares are, for anything driving the page from outside (the harness).
    this.canvas.dataset.grid = [this.layout.x, this.layout.y, cw, ch].join(",");
    const w = pad * 2 + m.left + m.right + cw * this.g.width;
    const h = pad * 2 + ch * this.g.height + m.bottom;
    this.ctx = sizeCanvas(this.canvas, w, h);
    this.ctx.fillStyle = PAPER;
    this.ctx.fillRect(0, 0, w, h);
    drawChart(new CanvasPainter(this.ctx), this.g, { ...this.layout, numbers: true, mask: this.mask, floats: this.floats });
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="knitted"]')) b.classList.toggle("on", kept.knitted);
    this.paintOverlay();
  }

  /** Where a box of squares is on the canvas. */
  private boxOf(r: Rect): { x: number; y: number; w: number; h: number } {
    const { x, y, cw, ch } = this.layout;
    return { x: x + r.x0 * cw, y: y + (this.g.height - 1 - r.y1) * ch, w: (r.x1 - r.x0 + 1) * cw, h: (r.y1 - r.y0 + 1) * ch };
  }

  /** The selection's dashed box, and a block being pasted where it would go. */
  private paintOverlay(): void {
    const ctx = this.ctx;
    // Where they are, for anything driving the page from outside (the harness).
    this.canvas.dataset.selection = this.selection ? [this.selection.x0, this.selection.y0, this.selection.x1, this.selection.y1].join(",") : "";
    this.canvas.dataset.pasting = this.pasting ? this.pasting.at.join(",") : "";
    if (this.pasting) {
      const { block, at } = this.pasting;
      const { cw, ch } = this.layout;
      ctx.save();
      ctx.globalAlpha = 0.8;
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width; x++) {
          const c = block.cells[y * block.width + x];
          const gx = at[0] + x;
          const gy = at[1] - block.height + 1 + y;
          if (c < 0 || gx < 0 || gx >= this.g.width || gy < 0 || gy >= this.g.height) continue;
          ctx.fillStyle = block.colours[c]?.hex ?? "#888888";
          ctx.fillRect(this.layout.x + gx * cw, this.layout.y + (this.g.height - 1 - gy) * ch, cw, ch);
        }
      }
      ctx.restore();
      this.dashedBox(this.boxOf({ x0: at[0], x1: at[0] + block.width - 1, y0: at[1] - block.height + 1, y1: at[1] }));
    } else if (this.selection) {
      this.dashedBox(this.boxOf(this.selection));
    }
  }

  /** A box in black and white dashes, to be seen on any colour. */
  private dashedBox(b: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.lineDashOffset = 4.5;
    ctx.strokeStyle = "#111111";
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.restore();
  }

  // ---------- a block: selected, copied, pasted ----------

  private copySelection(cut: boolean): void {
    if (!this.selection) return void this.note("Select some squares first: the Select tool (S), then drag across them.");
    kept.clip = copyBlock(this.g, this.mask, this.selection);
    const { width, height } = kept.clip;
    if (cut) this.change(() => clearRect(this.g, this.mask, this.selection!));
    else this.paintToolbar();
    this.note(`${cut ? "Cut" : "Copied"}: ${width} × ${height} squares. Paste (Ctrl+V) puts them down, here or in another chart.`);
  }

  private startPaste(): void {
    if (!kept.clip) return void this.note("Nothing copied yet: select some squares and Copy them first.");
    const b = kept.clip;
    // Where the pointer is, else where the selection was, else the top left.
    const at: [number, number] = this.hover ?? (this.selection ? [this.selection.x0, this.selection.y1] : [0, Math.min(this.g.height - 1, b.height - 1)]);
    this.pasting = { block: b, at };
    this.paintToolbar();
    this.paintGrid();
    this.status();
  }

  private stopPaste(): void {
    if (!this.pasting) return;
    this.pasting = null;
    this.paintToolbar();
    this.paintGrid();
    this.status();
  }

  private flipPaste(across: "x" | "y"): void {
    if (!this.pasting) return;
    this.pasting.block = flippedBlock(this.pasting.block, across);
    this.paintGrid();
  }

  private selectAll(): void {
    kept.tool = "select";
    this.selection = { x0: 0, y0: 0, x1: this.g.width - 1, y1: this.g.height - 1 };
    this.paintToolbar();
    this.paintGrid();
    this.status();
  }

  /** Redraws a few squares as they are drawn, quicker than the whole chart. */
  private paintSquares(points: Iterable<number>): void {
    const p = new CanvasPainter(this.ctx);
    for (const i of points) {
      const x = i % this.g.width;
      const y = Math.floor(i / this.g.width);
      const yTop = this.layout.y + (this.g.height - 1 - y) * this.layout.ch;
      drawChart(p, this.g, { x: this.layout.x + x * this.layout.cw, y: yTop, cw: this.layout.cw, ch: this.layout.ch, cols: [x, x + 1], rows: [y, y + 1], mask: this.mask, frame: false, line: Math.max(0.5, Math.min(this.layout.cw, this.layout.ch) / 22) });
    }
  }

  /** The square under the pointer, or null. */
  private squareAt(e: PointerEvent): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - this.layout.x) / this.layout.cw);
    const fromTop = Math.floor((e.clientY - r.top - this.layout.y) / this.layout.ch);
    const y = this.g.height - 1 - fromTop;
    return x >= 0 && x < this.g.width && y >= 0 && y < this.g.height ? [x, y] : null;
  }

  /** Paints squares (and their mirror images), stitches only; returns the squares changed. */
  private paint(points: [number, number][], colour: number): number[] {
    const changed: number[] = [];
    for (const [x, y] of points) {
      for (const cx of this.mirror ? [x, mirrorX(this.g, x)] : [x]) {
        const i = y * this.g.width + cx;
        if (!this.mask[i] || this.g.cells[i] === colour) continue;
        this.g.cells[i] = colour;
        changed.push(i);
      }
    }
    return changed;
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    const at = this.squareAt(e);
    if (!at) return;
    const i = at[1] * this.g.width + at[0];
    // A block being pasted goes down where it is shown; it stays to go down again.
    if (this.pasting && e.button === 0) {
      this.pasting.at = at;
      const block = this.pasting.block;
      this.change(() => pasteBlock(this.g, this.mask, block, at[0], at[1]));
      return;
    }
    if (this.pasting) return this.stopPaste();
    const tool: Tool = e.altKey ? "pick" : kept.tool;
    if (tool === "select") {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // See below: selecting still works.
      }
      this.selection = rectBetween(this.g, at, at);
      this.drag = { tool, colour: 0, start: at, last: at, before: this.g.cells, filled: false };
      this.paintGrid();
      this.status();
      return;
    }
    if (tool === "pick") {
      if (this.mask[i]) {
        this.colour = this.g.cells[i];
        this.paintPalette();
      }
      return;
    }
    const colour = e.button === 2 ? 0 : this.colour;
    // Captured on the canvas pressed, so a stroke dragged off it still ends here.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer counts as down: the stroke still works.
    }
    this.pushUndo();
    this.drag = { tool, colour, start: at, last: at, before: this.g.cells.slice(), filled: e.shiftKey };
    if (tool === "fill") {
      const area = fillArea(this.g, this.mask, at[0], at[1]);
      const mirrored = this.mirror ? fillArea(this.g, this.mask, mirrorX(this.g, at[0]), at[1]) : [];
      for (const k of [...area, ...mirrored]) this.g.cells[k] = colour;
      this.paintGrid();
      return;
    }
    if (tool === "draw") this.paintSquares(this.paint([at], colour));
    else this.paintShape(at);
  }

  private move(e: PointerEvent): void {
    const at = this.squareAt(e);
    if (at) this.hover = at;
    if (this.pasting && at && (at[0] !== this.pasting.at[0] || at[1] !== this.pasting.at[1])) {
      this.pasting.at = at;
      this.paintGrid();
    }
    this.status(at);
    const d = this.drag;
    if (!d || !at || (at[0] === d.last[0] && at[1] === d.last[1])) return;
    if (d.tool === "draw") this.paintSquares(this.paint(linePoints(d.last[0], d.last[1], at[0], at[1]), d.colour));
    else if (d.tool === "line" || d.tool === "rect") this.paintShape(at);
    else if (d.tool === "select") {
      this.selection = rectBetween(this.g, d.start, at);
      this.paintGrid();
    }
    d.last = at;
  }

  /** A line or a box being dragged: drawn afresh from where the drag began. */
  private paintShape(to: [number, number]): void {
    const d = this.drag!;
    this.g.cells.set(d.before);
    const [x0, y0] = d.start;
    const points = d.tool === "line" ? linePoints(x0, y0, to[0], to[1]) : rectPoints(x0, y0, to[0], to[1], d.filled);
    this.paint(points, d.colour);
    this.paintGrid();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.tool === "select") {
      this.paintToolbar();
      return this.status();
    }
    const same = d.before.every((v, i) => v === this.g.cells[i]);
    if (same) {
      this.undoStack.pop();
      return;
    }
    this.refresh(false);
  }

  private setTool(tool: Tool): void {
    kept.tool = tool;
    this.pasting = null;
    if (tool !== "select") this.selection = null;
    this.paintToolbar();
    this.paintGrid();
    this.status();
  }

  private toggleMirror(): void {
    this.mirror = !this.mirror;
    this.paintToolbar();
  }

  private key(e: KeyboardEvent): void {
    if (dialogOpen() || !this.root.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      return this.redo();
    }
    if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "x" || k === "v" || k === "a")) {
      e.preventDefault();
      if (k === "a") return this.selectAll();
      return k === "v" ? this.startPaste() : this.copySelection(k === "x");
    }
    if (e.key === "Escape" && (this.pasting || this.selection)) {
      e.preventDefault();
      if (this.pasting) return this.stopPaste();
      this.selection = null;
      this.paintGrid();
      return this.status();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selection && !this.pasting) {
      e.preventDefault();
      const r = this.selection;
      return this.change(() => clearRect(this.g, this.mask, r));
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((x) => x.key1.toLowerCase() === k);
    if (tool) return this.setTool(tool.key);
    if (k === "m") return this.toggleMirror();
    if (k === "+" || k === "=") return this.zoom(1);
    if (k === "-") return this.zoom(-1);
    // 1 to 9 pick a colour; 0 the tenth.
    if (/^[0-9]$/.test(k)) {
      const i = k === "0" ? 9 : Number(k) - 1;
      if (i < this.g.colours.length) {
        this.colour = i;
        this.paintPalette();
      }
    }
  }

  // ---------- the toolbar, colours and status ----------

  private paintToolbar(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-tool]")) b.classList.toggle("on", b.dataset.tool === kept.tool);
    this.root.querySelector('[data-act="mirror"]')?.classList.toggle("on", this.mirror);
    this.root.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled = !this.undoStack.length;
    this.root.querySelector<HTMLButtonElement>('[data-act="redo"]')!.disabled = !this.redoStack.length;
    this.root.querySelector<HTMLButtonElement>('[data-act="copy"]')!.disabled = !this.selection;
    this.root.querySelector<HTMLButtonElement>('[data-act="cut"]')!.disabled = !this.selection;
    this.root.querySelector<HTMLButtonElement>('[data-act="paste"]')!.disabled = !kept.clip;
    this.root.querySelector<HTMLButtonElement>('[data-act="paste"]')!.classList.toggle("on", !!this.pasting);
    this.root.querySelector<HTMLElement>('[data-el="paste-tools"]')!.hidden = !this.pasting;
    this.canvas.dataset.tool = this.pasting ? "paste" : kept.tool;
  }

  private paintPalette(): void {
    const counts = usage(this.g, this.mask);
    const c = this.g.colours[this.colour];
    const el = this.root.querySelector<HTMLElement>('[data-el="palette"]')!;
    el.innerHTML = `
      <div class="chart-chips">
        ${this.g.colours
          .map(
            (col, i) => `<button class="chart-chip${i === this.colour ? " on" : ""}" data-colour="${i}" title="${esc(`${colourLabel(col)}: ${counts[i]} sts${i < 10 ? ` (key ${i === 9 ? 0 : i + 1})` : ""}${i ? "" : ". The background: right-click draws in it"}`)}">
              <span class="chart-chip-sw" style="background:${esc(col.hex)}"></span><span class="chart-chip-name">${esc(col.name)}</span></button>`,
          )
          .join("")}
        ${this.g.colours.length < MAX_COLOURS ? `<button class="ghost chart-add-colour" data-act="add-colour" title="Another colour">+ Colour</button>` : ""}
      </div>
      <div class="chart-colour-edit">
        <input type="color" data-f="colour-hex" value="${esc(c.hex)}" aria-label="The colour" />
        <input data-f="colour-name" value="${esc(c.name)}" aria-label="Its name" maxlength="40" />
        ${
          this.yarns.length || c.yarnId
            ? `<select data-f="colour-yarn" class="chart-colour-yarn" aria-label="The yarn knitted in it" title="The stash yarn knitted in this colour: the legend names it">
            <option value="">No yarn chosen</option>
            ${c.yarnId && !this.yarns.some((y) => y.id === c.yarnId) ? `<option value="${esc(c.yarnId)}" selected>${esc(c.yarn ?? "")} (no longer in the stash)</option>` : ""}
            ${this.yarns.map((y) => `<option value="${esc(y.id)}" ${y.id === c.yarnId ? "selected" : ""}>${esc(yarnLabel(y))}</option>`).join("")}
          </select>`
            : ""
        }
        ${this.colour ? `<button class="ghost danger-text" data-act="remove-colour" title="Its squares go to the background colour">Remove</button>` : `<span class="hint">Background</span>`}
      </div>`;
  }

  /**
   * Says which stash yarn a colour is knitted in, or none. A colour still
   * called as the palette or "Colour 3" calls it takes the yarn's colourway
   * for its name; one named already keeps its name.
   */
  private linkYarn(i: number, yarnId: string): void {
    const c = this.g.colours[i];
    const yarn = this.yarns.find((y) => y.id === yarnId);
    if (!yarn) {
      delete c.yarnId;
      delete c.yarn;
      return;
    }
    c.yarnId = yarn.id;
    c.yarn = yarnLabel(yarn);
    const unnamed = PALETTE.some((p) => p.name === c.name) || /^Colour \d+$/.test(c.name);
    if (unnamed && (yarn.colourway || yarn.name)) c.name = (yarn.colourway || yarn.name).slice(0, 40);
  }

  private addColour(): void {
    if (this.g.colours.length >= MAX_COLOURS) return;
    this.change(() => this.g.colours.push(nextColour(this.g)));
    this.colour = this.g.colours.length - 1;
    this.paintPalette();
  }

  private async removeColour(): Promise<void> {
    const i = this.colour;
    if (!i) return;
    const count = usage(this.g, this.mask)[i];
    if (count && !(await askYesNo(`Remove ${this.g.colours[i].name}? Its squares go to ${this.g.colours[0].name}. Undo brings it back.`, { title: "Remove colour", okLabel: "Remove" }))) return;
    this.change(() => removeColour(this.g, i));
    this.colour = Math.min(i, this.g.colours.length - 1);
    this.paintPalette();
  }

  private status(at: [number, number] | null = null): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="status"]');
    if (!el) return;
    const word = this.g.flat ? "row" : "round";
    if (this.pasting) {
      el.title = el.textContent = `Pasting ${this.pasting.block.width} × ${this.pasting.block.height}: click to put it down, as often as you like; Esc when done`;
      return;
    }
    if (this.selection && !at) {
      const r = this.selection;
      el.title = el.textContent = `Selected ${r.x1 - r.x0 + 1} × ${r.y1 - r.y0 + 1}: Copy or Cut it (Ctrl+C, Ctrl+X), Delete clears it`;
      return;
    }
    if (at) {
      const i = at[1] * this.g.width + at[0];
      const what = this.mask[i] ? this.g.colours[this.g.cells[i]].name : "no stitch";
      el.title = el.textContent = `Stitch ${this.g.width - at[0]}, ${word} ${at[1] + 1}: ${what}`;
      return;
    }
    el.title = el.textContent = this.floats.length
      ? `${this.floats.length} float${this.floats.length === 1 ? "" : "s"} over ${this.g.floatLimit} stitches, underlined`
      : describe(this.g);
  }

  // ---------- beside the grid ----------

  private paintSide(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-side]")) b.classList.toggle("on", b.dataset.side === kept.side);
    const el = this.root.querySelector<HTMLElement>('[data-el="side"]')!;
    if (kept.side === "preview") el.innerHTML = this.previewHtml();
    if (kept.side === "chart") el.innerHTML = this.settingsHtml();
    if (kept.side === "words") el.innerHTML = this.wordsHtml();
    this.paintSideLive();
  }

  /** What changes as squares are drawn: the picture knitted up, and the words. Leaves the settings' fields alone. */
  private paintSideLive(): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="side"]')!;
    if (kept.side === "preview") {
      const canvas = el.querySelector<HTMLCanvasElement>("canvas.chart-preview");
      // The panel's width inside its padding.
      const pad = parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight);
      const width = Math.max(200, Math.floor(el.clientWidth - pad - 2));
      if (canvas && this.g.kind === "yoke") drawRing(canvas, this.g, Math.min(width, 340));
      else if (canvas) drawTiles(canvas, this.g, width, Math.round(width * 0.8));
      const counts = el.querySelector<HTMLElement>('[data-el="counts"]');
      if (counts) counts.innerHTML = this.countsHtml();
    }
    if (kept.side === "words") {
      const list = el.querySelector<HTMLElement>('[data-el="words"]');
      if (list) list.innerHTML = this.rowsHtml();
    }
  }

  private previewHtml(): string {
    const yoke = this.g.kind === "yoke";
    return `
      <p class="hint">${yoke ? "The yoke from above, the neck in the middle, its stitches the shape they knit up." : "The chart repeated, as an allover pattern knits up, its stitches the shape they knit up."}${this.g.gauge.sts ? "" : " Give a gauge (under Chart) for the shape your stitches have."}</p>
      <canvas class="chart-preview"></canvas>
      <div data-el="counts"></div>`;
  }

  private countsHtml(): string {
    const g = this.g;
    const counts = usage(g, this.mask);
    const len = (cm: number) => `${showLength(Math.round(cm * 10) / 10, this.unit)} ${unitLabel(this.unit)}`;
    const size = knittedSize(g);
    const rows: string[][] = [];
    if (g.kind === "yoke") {
      g.sections.forEach((s, i) => {
        const end = i + 1 < g.sections.length ? g.sections[i + 1].row : g.height;
        rows.push([`Rounds ${s.row + 1}–${end}`, `${s.sts} × ${g.repeats} = ${totalInRow(g, s.row)} sts`]);
      });
      if (size) rows.push(["At the gauge", `${len(size.widest)} round at the widest, ${len(size.neck)} at the neck, ${len(size.height)} deep`]);
    } else if (size) {
      rows.push(["At the gauge", `${len(size.width)} wide, ${len(size.height)} long`]);
    }
    return `
      ${rows.length ? `<table class="calc-table">${rows.map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join("")}</table>` : ""}
      <h3>Stitches in each colour</h3>
      <ul class="chart-usage">${g.colours.map((c, i) => `<li><span class="chart-chip-sw" style="background:${esc(c.hex)}"></span>${esc(colourLabel(c))}<b>${counts[i]}</b></li>`).join("")}</ul>
      ${
        this.floats.length
          ? `<p class="calc-warnings-p">Long floats on ${this.g.flat ? "rows" : "rounds"} ${esc(listRows(this.floats.map((f) => f.row + 1)))}: catch them every few stitches, or break the run up.</p>`
          : ""
      }`;
  }

  private settingsHtml(): string {
    const g = this.g;
    const yoke = g.kind === "yoke";
    const span = gaugeSpan(this.unit);
    const usable = this.swatches.filter((s) => gaugeOf(s).sts);
    const word = yoke ? "Rounds" : "Rows";
    return `
      <section class="chart-set">
        <h3>Size</h3>
        <div class="calc-fields chart-size">
          <label class="field calc-field"><span>${yoke ? "Repeat (sts)" : "Stitches"}</span><input data-k="w" inputmode="numeric" value="${g.width}" /></label>
          <label class="field calc-field"><span>${word}</span><input data-k="h" inputmode="numeric" value="${g.height}" /></label>
          <label class="field calc-field"><span>Columns at</span><select data-k="at-x"><option value="left">the left edge</option><option value="right">the right edge</option></select></label>
          <label class="field calc-field"><span>${word} at</span><select data-k="at-y"><option value="top">the top</option><option value="bottom">the bottom</option></select></label>
        </div>
        <button class="ghost" data-act="resize">Change the size</button>
        ${
          yoke
            ? `<div class="calc-fields">
                <label class="field calc-field"><span>Repeats around</span><input data-f="repeats" inputmode="numeric" value="${g.repeats}" /></label>
                <label class="field calc-field"><span>Knitted</span><select data-f="direction">
                  <option value="up" ${g.topDown ? "" : "selected"}>From the hem up</option>
                  <option value="down" ${g.topDown ? "selected" : ""}>From the neck down</option></select></label>
              </div>
              <p class="hint">Turning it round keeps the yoke as it looks worn: the chart turns upside down, as a top-down chart is.</p>`
            : `<label class="field calc-field"><span>Worked</span><select data-f="flat">
                <option value="round" ${g.flat ? "" : "selected"}>In the round: every round from the right</option>
                <option value="flat" ${g.flat ? "selected" : ""}>Flat: right-side rows from the right, wrong-side from the left</option></select></label>`
        }
      </section>
      ${yoke ? this.shapingHtml() : ""}
      <section class="chart-set">
        <h3>Gauge</h3>
        <label class="field"><span>From a swatch</span><select data-f="swatch">
          <option value="">Typed in</option>
          ${usable.map((s) => `<option value="${esc(s.id)}">${esc(`${showGauge(gaugeOf(s).sts, this.unit)} × ${showGauge(gaugeOf(s).rows, this.unit) || "?"} on ${s.needleMm} mm · ${s.yarnName || "yarn"}`)}</option>`).join("")}
        </select></label>
        <div class="field-row calc-pair">
          <label class="field"><span>Stitches <em class="hint">per ${span}</em></span><input data-f="gauge-sts" inputmode="decimal" value="${g.gauge.sts ? showGauge(g.gauge.sts, this.unit) : ""}" placeholder="e.g. 18" /></label>
          <label class="field"><span>Rows <em class="hint">per ${span}</em></span><input data-f="gauge-rows" inputmode="decimal" value="${g.gauge.rows ? showGauge(g.gauge.rows, this.unit) : ""}" placeholder="e.g. 24" /></label>
        </div>
        <p class="hint">For squares the shape of your stitches, the size it comes out, and a PDF printed at the real size.</p>
      </section>
      <section class="chart-set">
        <h3>Picture</h3>
        <div class="chart-buttons">
          <button class="ghost" data-act="shift" data-dx="-1" data-dy="0" title="Move everything a stitch left; the left column comes round to the right">← Move</button>
          <button class="ghost" data-act="shift" data-dx="1" data-dy="0" title="Move everything a stitch right">Move →</button>
          <button class="ghost" data-act="shift" data-dx="0" data-dy="1" title="Move everything a row up">↑ Move</button>
          <button class="ghost" data-act="shift" data-dx="0" data-dy="-1" title="Move everything a row down">Move ↓</button>
          <button class="ghost" data-act="flip-x" title="Mirror it left to right">Flip ↔</button>
          <button class="ghost" data-act="flip-y" title="Mirror it top to bottom">Flip ↕</button>
          <button class="ghost danger-text" data-act="clear">Clear</button>
        </div>
        <label class="dialog-checkfield chart-check"><input type="checkbox" data-f="symbols" ${g.symbols ? "checked" : ""} />
          <span>Symbols on the squares, for printing without colour</span></label>
        <label class="field calc-field chart-floats"><span>Underline floats longer than</span>
          <span class="chart-inline"><input data-f="floats" inputmode="numeric" value="${g.floatLimit}" /> stitches (0 for never)</span></label>
      </section>
      <section class="chart-set">
        <h3>Notes</h3>
        <textarea data-f="notes" rows="4" placeholder="Yarn, needles, where the chart goes…">${esc(g.notes)}</textarea>
      </section>`;
  }

  private shapingHtml(): string {
    const g = this.g;
    const stitchNumbers = (cols: number[]) => cols.map((c) => g.width - c).sort((a, b) => a - b).join(", ");
    return `
      <section class="chart-set">
        <h3>Shaping</h3>
        <p class="hint">${g.topDown ? "From the neck down, each repeat grows at these rounds" : "From the hem up, each repeat gets smaller at these rounds"}: the squares that ${g.topDown ? "are not there yet" : "go"} are grey. Columns are stitch numbers, counted from the right.</p>
        <table class="chart-shaping">
          <thead><tr><th>From round</th><th>Sts each repeat</th><th>${g.topDown ? "New" : "Gone"} at</th><th></th></tr></thead>
          <tbody>
          ${g.sections
            .map((s, i) => {
              const widest = s.sts === g.width;
              return `<tr data-section="${i}">
                <td>${i === 0 ? "1" : `<input data-f="section-row" inputmode="numeric" value="${s.row + 1}" />`}</td>
                <td>${widest ? `${s.sts}` : `<input data-f="section-sts" inputmode="numeric" value="${s.sts}" />`}</td>
                <td>${widest ? `<span class="hint">the whole repeat</span>` : `<input data-f="section-cols" value="${esc(stitchNumbers(s.cols))}" title="The stitch numbers, or empty to spread them evenly" />`}</td>
                <td>${widest ? "" : `<button class="ghost" data-act="auto-cols" title="Spread them evenly">Even</button><button class="ghost danger-text" data-act="remove-shaping" title="No shaping here">×</button>`}</td>
              </tr>`;
            })
            .join("")}
          </tbody>
        </table>
        <div class="chart-buttons">
          <button class="ghost" data-act="add-shaping">+ Shaping round</button>
          <button class="ghost" data-act="usual-shaping" title="Three rounds, to about two fifths of the repeat at the neck">Usual shaping</button>
        </div>
      </section>`;
  }

  private wordsHtml(): string {
    return `
      <p class="hint">${esc(readingNote(this.g))}</p>
      <ol class="chart-words" data-el="words"></ol>
      <div class="calc-actions"><button class="ghost" data-act="copy-words">Copy</button><span class="hint" data-el="copied"></span></div>`;
  }

  private rowsHtml(): string {
    return writeOut(this.g)
      .map((r) => `<li><b>${esc(r.label)}:</b> ${esc(r.text)}</li>`)
      .join("");
  }

  // ---------- settings that need asking ----------

  private applyResize(): void {
    const val = (k: string) => this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${k}"]`)!.value;
    const w = Number(val("w"));
    const h = Number(val("h"));
    if (![w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_SIDE)) return void say(`A chart is 1 to ${MAX_SIDE} squares each way.`, "Size");
    if (w === this.g.width && h === this.g.height) return;
    const atLeft = val("at-x") === "left";
    const atBottom = val("at-y") === "bottom";
    this.pushUndo();
    this.g = resized(this.g, { width: w, height: h, atLeft, atBottom });
    this.refresh(true);
  }

  private async addShaping(): Promise<void> {
    const g = this.g;
    const answer = await askForm(
      [
        { label: "From round", placeholder: `2 to ${g.height}` },
        { label: "Stitches each repeat", placeholder: `fewer than ${g.width}` },
      ],
      { title: g.topDown ? "An increase round" : "A decrease round", okLabel: "Add" },
    );
    if (!answer) return;
    const row = Number(answer["From round"]) - 1;
    const sts = Number(answer["Stitches each repeat"]);
    if (!Number.isInteger(row) || row < 1 || row >= g.height) return void say(`Give a round from 2 to ${g.height}.`, "Shaping");
    if (!Number.isInteger(sts) || sts < 1 || sts >= g.width) return void say(`Give the stitches each repeat has from that round: 1 to ${g.width - 1}.`, "Shaping");
    this.change(() => {
      g.sections = g.sections.filter((s) => s.row !== row).concat({ row, sts, cols: [] });
      normalize(g);
    }, true);
    // A count out of order is dropped by normalize: take the change back and say why.
    if (!this.g.sections.some((s) => s.row === row && s.sts === sts)) {
      this.undo();
      this.redoStack = [];
      this.paintToolbar();
      await say(
        g.topDown
          ? "That does not fit: from the neck down, each shaping round has more stitches than the one before and fewer than the one after."
          : "That does not fit: from the hem up, each shaping round has fewer stitches than the one before and more than the one after.",
        "Shaping",
      );
    }
  }

  private async remove(): Promise<void> {
    if (!(await askYesNo(`Remove the chart “${this.savedName}”? This cannot be undone.`, { title: "Remove chart", okLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteChart(this.chartId);
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Remove chart"));
    }
    // Nothing left to save.
    this.removed = true;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.hooks.back();
  }

  private async copyWords(): Promise<void> {
    const note = this.root.querySelector<HTMLElement>('[data-el="copied"]');
    try {
      await navigator.clipboard.writeText(writtenText(this.savedName, this.g));
      if (note) note.textContent = "Copied.";
    } catch {
      await say("The text could not be copied.", "Copy");
    }
  }

  private subtitle(): string {
    return `${describe(this.g)}.`;
  }

  // ---------- exporting ----------

  private exportDialog(): Promise<void> {
    const g = this.g;
    const hasGauge = g.gauge.sts > 0 && g.gauge.rows > 0;
    const paper: Paper = this.unit === "in" ? "letter" : "a4";
    return new Promise((resolve) => {
      const finish = () => {
        dialog.close();
        resolve();
      };
      const dialog = customDialog("Export the chart", finish, "chart-export-dialog");
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <div class="chart-kinds" role="radiogroup">
          <label class="chart-kind"><input type="radio" name="as" value="pdf" checked />
            <span><b>PDF, to print</b><em>Sharp at any size, with the colours and, if you like, the rows in words</em></span></label>
          <label class="chart-kind"><input type="radio" name="as" value="png" />
            <span><b>Picture (PNG)</b><em>To share, or keep with a pattern</em></span></label>
        </div>
        <div data-for="pdf">
          <label class="dialog-field"><span class="dialog-label">Squares</span>
            <select class="dialog-input" data-f="squares">
              <option value="knitted" ${hasGauge ? "selected" : "disabled"}>As knitted: the real size${hasGauge ? "" : " (give a gauge first)"}</option>
              <option value="fit" ${hasGauge ? "" : "selected"}>As big as fits one page</option>
              <option value="5">5 mm</option>
              <option value="7">7 mm</option>
            </select></label>
          <label class="dialog-field"><span class="dialog-label">Paper</span>
            <select class="dialog-input" data-f="paper">${Object.entries(PAPERS).map(([k, p]) => `<option value="${k}" ${k === paper ? "selected" : ""}>${p.label}</option>`).join("")}</select></label>
          <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="words" checked />
            <span><span class="dialog-label">The rows in words, after the chart</span></span></label>
          <p class="dialog-hint">Print at “Actual size” (not “Fit to page”) for the squares to measure what they say.</p>
        </div>
        <div data-for="png" hidden>
          <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="knitted" ${kept.knitted ? "checked" : ""} />
            <span><span class="dialog-label">Squares the shape of stitches</span></span></label>
        </div>
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">Save…</button>
        </div>`,
      );
      const card = dialog.card;
      const as = () => card.querySelector<HTMLInputElement>('input[name="as"]:checked')!.value as "pdf" | "png";
      const field = <T extends HTMLElement>(f: string) => card.querySelector<T>(`[data-f="${f}"]`)!;
      card.addEventListener("change", () => {
        for (const el of card.querySelectorAll<HTMLElement>("[data-for]")) el.hidden = el.dataset.for !== as();
      });
      card.addEventListener("click", async (e) => {
        const act = closestEl(e.target, "button[data-act]");
        if (act?.dataset.act === "cancel") return finish();
        if (act?.dataset.act !== "save") return;
        const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
        (act as HTMLButtonElement).disabled = true;
        try {
          const name = this.savedName;
          let bytes: Uint8Array;
          if (as() === "pdf") {
            const sq = field<HTMLSelectElement>("squares").value;
            bytes = chartPdf(name, g, {
              paper: field<HTMLSelectElement>("paper").value as Paper,
              squares: sq === "knitted" || sq === "fit" ? sq : Number(sq),
              words: field<HTMLInputElement>("words").checked,
            });
          } else {
            const blob = await chartPng(name, g, { asKnitted: field<HTMLInputElement>("knitted").checked, subtitle: this.subtitle() });
            bytes = new Uint8Array(await blob.arrayBuffer());
          }
          const path = await api.saveFile(as(), name, bytes);
          if (path === null) {
            (act as HTMLButtonElement).disabled = false;
            return;
          }
          finish();
          this.note(`Saved to ${path}`);
        } catch (err) {
          error.textContent = err instanceof Error ? err.message : String(err);
          error.hidden = false;
          (act as HTMLButtonElement).disabled = false;
        }
      });
      dialog.show(card.querySelector<HTMLElement>('[data-act="save"]')!);
    });
  }

  /** Puts the chart, as a picture, and its rows in words, on a project's board, below what is there. */
  private boardDialog(): Promise<void> {
    const live = this.projects.filter((p) => isLive(p.status));
    if (!live.length) return say("There are no projects being knitted to put it on.", "Save to a project");
    return new Promise((resolve) => {
      const finish = () => {
        dialog.close();
        resolve();
      };
      const dialog = customDialog("Save to a project's board", finish, "chart-export-dialog");
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <label class="dialog-field"><span class="dialog-label">Project</span>
          <select class="dialog-input" data-f="project">${live.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="picture" checked />
          <span><span class="dialog-label">The chart, as a picture</span></span></label>
        <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="words" />
          <span><span class="dialog-label">The rows in words</span></span></label>
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">Save</button>
        </div>`,
      );
      const card = dialog.card;
      const field = <T extends HTMLElement>(f: string) => card.querySelector<T>(`[data-f="${f}"]`)!;
      card.addEventListener("click", async (e) => {
        const act = closestEl(e.target, "button[data-act]");
        if (act?.dataset.act === "cancel") return finish();
        if (act?.dataset.act !== "save") return;
        const projectId = field<HTMLSelectElement>("project").value;
        const picture = field<HTMLInputElement>("picture").checked;
        const words = field<HTMLInputElement>("words").checked;
        if (!picture && !words) return finish();
        (act as HTMLButtonElement).disabled = true;
        try {
          const items = await api.listBoardItems(projectId).catch(() => []);
          let y = items.reduce((max, it) => Math.max(max, it.y + it.h), 0) + 40;
          if (picture) {
            const png = await chartPng(this.savedName, this.g, { maxSide: 1400, asKnitted: kept.knitted, subtitle: this.subtitle() });
            const prepared = await prepareBoardImage(png);
            if (!prepared) throw new Error("The picture could not be made.");
            const w = 420;
            const h = Math.max(40, Math.round((w * prepared.height) / prepared.width));
            const item = await api.addBoardItem(projectId, { kind: "image", x: 40, y, w, h, data: {} });
            await api.setBoardImage(item.id, await blobBytes(prepared.blob));
            y += h + 30;
          }
          if (words) await api.addBoardItem(projectId, { kind: "text", x: 40, y, w: 460, h: 560, data: { text: writtenText(this.savedName, this.g) } });
          finish();
          this.note(`Put on ${live.find((p) => p.id === projectId)?.name ?? "the project"}'s board`);
        } catch (err) {
          const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
          error.textContent = err instanceof Error ? err.message : String(err);
          error.hidden = false;
          (act as HTMLButtonElement).disabled = false;
        }
      });
      dialog.show(field("project"));
    });
  }
}

/** A stash yarn, as a colour's legend names it: "Jamieson's Spindrift, Peat". */
function yarnLabel(y: Yarn): string {
  const name = [y.brand, y.name].filter(Boolean).join(" ");
  return [name, y.colourway].filter(Boolean).join(", ") || "A yarn";
}

/** "3, 5–7, 12": row numbers, runs joined. */
function listRows(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(", ");
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
