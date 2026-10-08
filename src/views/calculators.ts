import { api, isLive, type MeasureUnit, type Person, type Project, type Swatch } from "../api";
import { say } from "../dialogs";
import { closestEl } from "../dom";
import { cardigan, cardiganSteps, raglan, raglanBottomUpSteps, raglanSteps, regauge, roundYoke, roundYokeSteps, rowsFor, spreadEvenly, stitchesFor, type Gauge, type RaglanInput, type RaglanResult } from "./calc";
import { gaugeOf, gaugeSpan, latestValue, readGauge, readLength, showGauge, showLength, unitLabel } from "./measure";
import { longDate } from "./project-form";
import { ChartList } from "./charts";

type Calc = "raglan" | "yoke" | "size" | "evenly" | "regauge" | "charts";

const CALCS: { key: Calc; label: string; hint: string }[] = [
  { key: "raglan", label: "Raglan sweater", hint: "Top-down, bottom-up, or a cardigan" },
  { key: "yoke", label: "Round yoke (lopapeysa)", hint: "Top-down, in the round" },
  { key: "size", label: "Stitches for a size", hint: "Cast on for a width, rows for a length" },
  { key: "evenly", label: "Increase or decrease evenly", hint: "Spread across a row or round" },
  { key: "regauge", label: "Re-gauge a pattern", hint: "Its gauge, and yours" },
  { key: "charts", label: "Colourwork charts", hint: "Standard, or a round yoke's" },
];

/** A round yoke's depth over the armhole's, in cm: it covers the shoulders too. */
const YOKE_OVER_ARMHOLE = 2;
const YOKE_DEPTH_HINT = "Underarm up to the neck, at the front: a little more than the armhole depth (filled in as that + 2 cm)";

/** How loose the body is, in cm over the chest. */
const FITS = [
  { key: "fitted", label: "Fitted (no ease)", ease: 0 },
  { key: "classic", label: "Classic (+5 cm)", ease: 5 },
  { key: "relaxed", label: "Relaxed (+10 cm)", ease: 10 },
  { key: "oversized", label: "Oversized (+20 cm)", ease: 20 },
];

/** The raglan's fields: what each is, in cm, and where a person's measurements fill it from. */
const RAGLAN_FIELDS: { key: keyof RaglanInput; label: string; hint?: string; from?: string; start?: number }[] = [
  { key: "chest", label: "Chest", from: "chest" },
  { key: "upperArm", label: "Upper arm", from: "upper_arm" },
  { key: "wrist", label: "Wrist", from: "wrist" },
  { key: "neck", label: "Neck", from: "neck" },
  { key: "yokeDepth", label: "Armhole depth", hint: "Top of the shoulder to the underarm: the yoke's depth", from: "armhole_depth" },
  { key: "armLength", label: "Arm length", hint: "Underarm to wrist, cuff included", from: "arm_length" },
  { key: "bodyLength", label: "Body length", hint: "Underarm to hem, hem rib included", start: 35 },
];
/** The ribs a garment's counts are fitted to, by the stitches in a repeat. */
const RIBS = [
  { sts: 2, label: "1x1 (k1, p1)" },
  { sts: 4, label: "2x2 (k2, p2)" },
  { sts: 0, label: "Any count" },
];

const EASE_FIELDS: { key: keyof RaglanInput; label: string; hint: string; start: number }[] = [
  { key: "bodyEase", label: "Body ease", hint: "Added to the chest; the fit sets it", start: 5 },
  { key: "sleeveEase", label: "Sleeve ease", hint: "Added to the upper arm", start: 4 },
  { key: "wristEase", label: "Wrist ease", hint: "Added to the wrist", start: 2 },
  { key: "neckEase", label: "Neck ease", hint: "Added to the neck, so it goes over the head", start: 10 },
  { key: "underarm", label: "Underarm cast-on", hint: "Cast on at each underarm when the sleeves are set aside", start: 5 },
  { key: "neckRib", label: "Neckband", hint: "Rib depth", start: 2.5 },
  { key: "hemRib", label: "Hem rib", hint: "Rib depth", start: 5 },
  { key: "cuffRib", label: "Cuff", hint: "Rib depth", start: 5 },
  { key: "backNeck", label: "Back neck raised by", hint: "Short rows across the back, so the neck sits higher behind than in front: 0 for none, about 2 is usual", start: 0 },
];

/**
 * What was typed, kept while the app is open, so going to another tab and
 * back, or between calculators, loses nothing. Lengths are kept in cm and
 * gauges per 10 cm, as typed into the page's own fields.
 */
const kept: { calc: Calc; values: Record<string, string>; unit: MeasureUnit | null } = { calc: "raglan", values: {}, unit: null };

/** Which calculator the tab opens on next: the charts, coming back from one. */
export function openCalculatorsOn(calc: Calc): void {
  kept.calc = calc;
}

/**
 * The Calculators tab: a top-down raglan from someone's measurements and a
 * swatch, and the small sums of every day -- stitches for a size, increasing
 * evenly, a pattern at another gauge. Results come as numbers and as written
 * steps, which copy, or go onto a project's board. The colourwork charts are
 * listed here too (see charts.ts).
 */
export class CalculatorsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private main!: HTMLElement;
  private people: Person[] = [];
  private swatches: Swatch[] = [];
  private projects: Project[] = [];
  private unit: MeasureUnit = "cm";
  /** The latest result as text, for Copy and Save. */
  private plan: { title: string; text: string } | null = null;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    [this.people, this.swatches, this.projects, this.unit] = await Promise.all([
      api.listPeople().catch(() => [] as Person[]),
      api.listSwatches().catch(() => [] as Swatch[]),
      api.listProjects().catch(() => [] as Project[]),
      api.getMeasureUnit().catch(() => "cm" as const),
    ]);
    // Remembered lengths and gauges are as typed, in the unit of the time:
    // read in another they would be wrong, so a change of unit starts afresh.
    if (kept.unit && kept.unit !== this.unit) kept.values = {};
    kept.unit = this.unit;
    this.root = document.createElement("div");
    this.root.className = "library calculators";
    this.root.innerHTML = `
      <header class="lib-bar"><h1>Calculators</h1></header>
      <div class="lib-body">
        <aside class="filters calc-nav">
          ${CALCS.map((c) => `<button class="calc-pick" data-calc="${c.key}"><b>${c.label}</b><span>${c.hint}</span></button>`).join("")}
        </aside>
        <main class="calc-main"></main>
      </div>
    `;
    this.screen.appendChild(this.root);
    this.main = this.root.querySelector(".calc-main")!;
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("input", (e) => this.onInput(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
    this.show(kept.calc);
  }

  // ---------- fields ----------

  /** A remembered value, else the start value: a length in the chosen unit, as shown. */
  private lengthValue(key: string, start?: number): string {
    const v = kept.values[key];
    if (v !== undefined) return v;
    return start !== undefined ? showLength(start, this.unit) : "";
  }

  private lengthField(key: string, label: string, hint = "", start?: number): string {
    return `
      <label class="field calc-field" title="${esc(hint)}">
        <span>${esc(label)} <em class="hint">${unitLabel(this.unit)}</em></span>
        <input data-k="${key}" data-kind="length" inputmode="decimal" value="${esc(this.lengthValue(key, start))}" />
      </label>`;
  }

  /** Reads a field: a length into cm, a gauge into per 10 cm, else a number. NaN when it is not one. */
  private num(key: string): number {
    const el = this.main.querySelector<HTMLInputElement>(`[data-k="${key}"]`);
    if (!el) return NaN;
    if (el.dataset.kind === "length") return readLength(el.value, this.unit);
    if (el.dataset.kind === "gauge") return readGauge(el.value, this.unit);
    const t = el.value.trim().replace(",", ".").replace("−", "-");
    return t ? Number(t) : 0;
  }

  /** The gauge picker: one of your swatches, or typed in. */
  private gaugeBlock(prefix = "", title = "Your gauge"): string {
    const chosen = kept.values[`${prefix}swatch`] ?? "";
    const usable = this.swatches.filter((s) => gaugeOf(s).sts);
    const span = gaugeSpan(this.unit);
    return `
      <div class="calc-gauge">
        <label class="field">
          <span>${esc(title)}</span>
          <select data-k="${prefix}swatch">
            <option value="">Typed in</option>
            ${usable
              .map((s) => {
                const g = gaugeOf(s);
                const label = `${showGauge(g.sts, this.unit)} × ${showGauge(g.rows, this.unit) || "?"} on ${s.needleMm} mm · ${s.yarnName || "yarn"}${s.stitch ? ` · ${s.stitch}` : ""}`;
                return `<option value="${esc(s.id)}" ${s.id === chosen ? "selected" : ""}>${esc(label)}</option>`;
              })
              .join("")}
          </select>
        </label>
        <div class="field-row calc-pair">
          <label class="field"><span>Stitches <em class="hint">per ${span}</em></span>
            <input data-k="${prefix}sts" data-kind="gauge" inputmode="decimal" value="${esc(kept.values[`${prefix}sts`] ?? "")}" placeholder="e.g. 22" /></label>
          <label class="field"><span>Rows <em class="hint">per ${span}</em></span>
            <input data-k="${prefix}rows" data-kind="gauge" inputmode="decimal" value="${esc(kept.values[`${prefix}rows`] ?? "")}" placeholder="e.g. 30" /></label>
        </div>
        ${usable.length ? "" : `<p class="hint">Log your swatches in the Stash to pick their gauge here.</p>`}
      </div>`;
  }

  private gauge(prefix = ""): Gauge {
    return { sts: this.num(`${prefix}sts`), rows: this.num(`${prefix}rows`) };
  }

  // ---------- the calculators ----------

  private show(calc: Calc): void {
    kept.calc = calc;
    for (const b of this.root.querySelectorAll<HTMLElement>(".calc-pick")) b.classList.toggle("on", b.dataset.calc === calc);
    if (calc === "raglan" || calc === "yoke") this.main.innerHTML = this.garmentForm(calc);
    if (calc === "size") this.main.innerHTML = this.sizeForm();
    if (calc === "evenly") this.main.innerHTML = this.evenlyForm();
    if (calc === "regauge") this.main.innerHTML = this.regaugeForm();
    if (calc === "charts") {
      this.main.innerHTML = "";
      void new ChartList(this.main).mount();
    }
    this.calculate();
  }

  /** The raglan's and the round yoke's form: the same measurements and fit, the yoke's own choices besides. */
  private garmentForm(kind: "raglan" | "yoke"): string {
    const fit = kept.values.fit ?? "classic";
    const yoke = kind === "yoke";
    const fields = RAGLAN_FIELDS.map((f) => (yoke && f.key === "yokeDepth" ? { ...f, label: "Yoke depth", hint: YOKE_DEPTH_HINT } : f));
    const increases = kept.values.increases ?? "3";
    return `
      <div class="calc-grid">
        <section class="calc-inputs">
          <h2>${yoke ? "Round yoke" : "Raglan sweater"} <span class="hint">${yoke ? "lopapeysa, top-down, in the round" : workedHint(kept.values.direction)}</span></h2>
          ${
            yoke
              ? ""
              : `<label class="field">
            <span>Worked</span>
            <select data-k="direction">
              <option value="down" ${kept.values.direction !== "up" ? "selected" : ""}>Top-down: from the neck</option>
              <option value="up" ${kept.values.direction === "up" ? "selected" : ""}>Bottom-up: body and sleeves first, joined for the yoke</option>
              <option value="flat" ${kept.values.direction === "flat" ? "selected" : ""}>Flat, as a cardigan: open at the front, with bands</option>
            </select>
          </label>
          <div class="calc-fields" data-el="cardigan" ${kept.values.direction === "flat" ? "" : "hidden"}>
            ${this.lengthField("bandWidth", "Front band width", "How wide each front band is, picked up along the front edge", 2.5)}
            <label class="field calc-field" title="Buttonholes on the right band; 0 for none"><span>Buttons</span>
              <input data-k="buttons" inputmode="numeric" value="${esc(kept.values.buttons ?? "6")}" /></label>
          </div>`
          }
          <label class="field">
            <span>For</span>
            <select data-k="person">
              <option value="">Measurements typed in</option>
              ${this.people.map((p) => `<option value="${esc(p.id)}" ${kept.values.person === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
            </select>
          </label>
          ${this.gaugeBlock()}
          <h3>Measurements</h3>
          <div class="calc-fields">${fields.map((f) => this.lengthField(f.key, f.label, f.hint, f.start)).join("")}</div>
          ${
            yoke
              ? `<h3>Yoke</h3>
          <div class="calc-fields">
            <label class="field calc-field" title="Three is the classic; more makes a rounder yoke"><span>Increase rounds</span>
              <select data-k="increases">${[3, 4, 5, 6].map((n) => `<option value="${n}" ${String(n) === increases ? "selected" : ""}>${n}</option>`).join("")}</select></label>
            <label class="field calc-field" title="The colourwork's repeat, so every count fits it: 1 for none"><span>Pattern repeat</span>
              <input data-k="repeat" inputmode="numeric" value="${esc(kept.values.repeat ?? "1")}" /></label>
          </div>`
              : ""
          }
          <h3>Fit</h3>
          <label class="field">
            <span>How loose</span>
            <select data-k="fit">${FITS.map((f) => `<option value="${f.key}" ${f.key === fit ? "selected" : ""}>${f.label}</option>`).join("")}</select>
          </label>
          <label class="field" title="The counts at the neck, hem and cuffs are fitted to it, so the rib comes out even">
            <span>Rib</span>
            <select data-k="rib">${RIBS.map((r) => `<option value="${r.sts}" ${String(r.sts) === (kept.values.rib ?? "2") ? "selected" : ""}>${r.label}</option>`).join("")}</select>
          </label>
          <div class="calc-fields">${EASE_FIELDS.map((f) => this.lengthField(f.key, f.label, f.hint, f.start)).join("")}</div>
        </section>
        <section class="calc-results" data-el="results"></section>
      </div>`;
  }

  private sizeForm(): string {
    return `
      <div class="calc-grid">
        <section class="calc-inputs">
          <h2>Stitches for a size</h2>
          ${this.gaugeBlock()}
          <div class="calc-fields">
            ${this.lengthField("width", "Width", "How wide the piece is to be")}
            ${this.lengthField("length", "Length", "How long, for the rows (optional)")}
            <label class="field calc-field" title="The stitch pattern's repeat: 2x2 rib is a multiple of 4"><span>A multiple of</span>
              <input data-k="multiple" inputmode="numeric" value="${esc(kept.values.multiple ?? "1")}" /></label>
            <label class="field calc-field" title="Stitches added to the repeats, e.g. 2 for edge stitches"><span>plus</span>
              <input data-k="plus" inputmode="numeric" value="${esc(kept.values.plus ?? "0")}" /></label>
          </div>
        </section>
        <section class="calc-results" data-el="results"></section>
      </div>`;
  }

  private evenlyForm(): string {
    const round = (kept.values.round ?? "round") === "round";
    return `
      <div class="calc-grid">
        <section class="calc-inputs">
          <h2>Increase or decrease evenly</h2>
          <div class="calc-fields">
            <label class="field calc-field"><span>Stitches now</span>
              <input data-k="now" inputmode="numeric" value="${esc(kept.values.now ?? "")}" placeholder="e.g. 96" /></label>
            <label class="field calc-field" title="More, or fewer with a minus: 8, or −8"><span>Change by</span>
              <input data-k="change" inputmode="numeric" value="${esc(kept.values.change ?? "")}" placeholder="8, or −8" /></label>
            <label class="field calc-field"><span>Worked</span>
              <select data-k="round">
                <option value="round" ${round ? "selected" : ""}>In the round</option>
                <option value="flat" ${round ? "" : "selected"}>Flat</option>
              </select></label>
          </div>
        </section>
        <section class="calc-results" data-el="results"></section>
      </div>`;
  }

  private regaugeForm(): string {
    const span = gaugeSpan(this.unit);
    return `
      <div class="calc-grid">
        <section class="calc-inputs">
          <h2>Re-gauge a pattern</h2>
          <div class="calc-gauge">
            <span class="field-label">The pattern's gauge</span>
            <div class="field-row calc-pair">
              <label class="field"><span>Stitches <em class="hint">per ${span}</em></span>
                <input data-k="psts" data-kind="gauge" inputmode="decimal" value="${esc(kept.values.psts ?? "")}" placeholder="e.g. 20" /></label>
              <label class="field"><span>Rows <em class="hint">per ${span}</em></span>
                <input data-k="prows" data-kind="gauge" inputmode="decimal" value="${esc(kept.values.prows ?? "")}" placeholder="e.g. 28" /></label>
            </div>
          </div>
          ${this.gaugeBlock()}
          <label class="field">
            <span>The pattern's counts</span>
            <input data-k="counts" value="${esc(kept.values.counts ?? "")}" placeholder="Stitches or rows, e.g. 96, 104, 112" />
          </label>
          <label class="field calc-field"><span>They are</span>
            <select data-k="countsAre">
              <option value="sts" ${(kept.values.countsAre ?? "sts") === "sts" ? "selected" : ""}>Stitches</option>
              <option value="rows" ${kept.values.countsAre === "rows" ? "selected" : ""}>Rows</option>
            </select></label>
        </section>
        <section class="calc-results" data-el="results"></section>
      </div>`;
  }

  // ---------- working it out ----------

  private len = (cm: number): string => `${showLength(Math.round(cm * 10) / 10, this.unit)} ${unitLabel(this.unit)}`;

  private calculate(): void {
    const out = this.main.querySelector<HTMLElement>('[data-el="results"]');
    if (!out) return;
    this.plan = null;
    const calc = kept.calc;
    try {
      if (calc === "raglan") out.innerHTML = this.raglanResult();
      if (calc === "yoke") out.innerHTML = this.yokeResult();
      if (calc === "size") out.innerHTML = this.sizeResult();
      if (calc === "evenly") out.innerHTML = this.evenlyResult();
      if (calc === "regauge") out.innerHTML = this.regaugeResult();
    } catch (err) {
      out.innerHTML = `<p class="calc-wait">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  /** Stops a calculation that is missing something, saying what. */
  private need(ok: boolean, what: string): void {
    if (!ok) throw new Error(what);
  }

  private needGauge(g: Gauge, rows = true): void {
    this.need(g.sts > 0, `Give your gauge: pick a swatch, or type the stitches per ${gaugeSpan(this.unit)}.`);
    if (rows) this.need(g.rows > 0, `Give the rows per ${gaugeSpan(this.unit)} too: lengths are counted in rows.`);
  }

  /** The raglan's or round yoke's input, as typed; a field that is not a length stops it. */
  private garmentInput(): RaglanInput {
    const g = this.gauge();
    this.needGauge(g);
    const input = { gauge: g } as RaglanInput;
    for (const f of [...RAGLAN_FIELDS, ...EASE_FIELDS]) {
      const v = this.num(f.key);
      this.need(!Number.isNaN(v), `The ${f.label.toLowerCase()} is not a length.`);
      (input as unknown as Record<string, number>)[f.key] = v;
    }
    input.rib = Number(kept.values.rib ?? "2");
    return input;
  }

  /** Keeps a garment's steps as text, for Copy and Save, under a heading saying what and for whom. */
  private keepPlan(what: string, input: RaglanInput, finished: { chest: number; upperArm: number; neck: number }, steps: string[]): void {
    const person = this.people.find((p) => p.id === kept.values.person);
    const title = `${what}${person ? ` for ${person.name}` : ""}, ${longDate(Date.now())}`;
    const g = input.gauge;
    this.plan = {
      title,
      text: [
        title,
        `Gauge ${showGauge(g.sts, this.unit)} sts × ${showGauge(g.rows, this.unit)} rows per ${gaugeSpan(this.unit)}. Finished chest ${this.len(finished.chest)}, upper arm ${this.len(finished.upperArm)}, neck ${this.len(finished.neck)}.`,
        "",
        ...steps.map((s, i) => `${i + 1}. ${s}`),
      ].join("\n"),
    };
  }

  private yokeResult(): string {
    const input = this.garmentInput();
    const repeat = this.num("repeat");
    this.need(!Number.isNaN(repeat), "The pattern repeat is a number of stitches: 1 for none.");
    const r = roundYoke(input, Number(kept.values.increases ?? 3), repeat || 1);
    if ("error" in r) throw new Error(r.error);
    const p = r.pieces;
    const steps = roundYokeSteps(r, input, this.len);
    this.keepPlan("Round yoke", input, r.finished, steps);
    return `
      ${this.resultHead("The numbers")}
      ${table([
        ["Cast on", `${r.neckRibSts}`, `neck ${this.len(r.finished.neck)}`],
        ...(r.neckRibSts !== r.castOn ? [["After the neckband", `${r.neckRibSts} → ${r.castOn}`, "for the yoke"]] : []),
        ...r.rounds.map((y, n) => [`Increase round ${n + 1}`, `${y.from} → ${y.to}`, `at ${this.len(y.atCm)}`]),
        ...(r.adjust ? [["To split evenly", `${r.adjust.from} → ${r.adjust.to}`, "at the underarm"]] : []),
        ["Yoke", `${r.yokeRounds} rounds`, this.len(r.finished.yokeDepth)],
        ["At the split", `${p.front} back, ${p.front} front`, `${p.sleeve} each sleeve`],
        ["Underarm cast-on", `${p.underarmSts}`, "at each side"],
        ["Body", `${p.body}`, `chest ${this.len(r.finished.chest)}`],
        ["Sleeve", `${p.upperArmSts} → ${p.wristSts}`, `${this.len(r.finished.upperArm)} → ${this.len(r.finished.wrist)}`],
      ])}
      ${r.warnings.length ? `<ul class="calc-warnings">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <h3>Steps</h3>
      <ol class="calc-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      ${this.actions()}`;
  }

  private raglanResult(): string {
    const input = this.garmentInput();
    const r = raglan(input);
    if ("error" in r) throw new Error(r.error);
    if (kept.values.direction === "flat") return this.cardiganResult(input);
    const up = kept.values.direction === "up";
    const steps = up ? raglanBottomUpSteps(r, input, this.len) : raglanSteps(r, input, this.len);
    this.keepPlan(up ? "Raglan, bottom-up" : "Raglan", input, r.finished, steps);
    const numbers = up
      ? table([
          ["Body cast on", `${r.body}`, `chest ${this.len(r.finished.chest)}`],
          ["Sleeve cast on", `${r.wristSts} → ${r.upperArmSts}`, `${this.len(r.finished.wrist)} → ${this.len(r.finished.upperArm)}`],
          ["Underarm on hold", `${r.underarmSts}`, "at each side, body and sleeve"],
          ["At the join", `${r.front} back, ${r.front} front`, `${r.sleeve} each sleeve`],
          ["Decrease rounds", `${Math.max(r.bodyIncreases, r.sleeveIncreases)}`, scheduleUp(r)],
          ["Yoke", `${r.yokeRounds} rounds`, this.len(r.finished.yokeDepth)],
          ["At the neck", `${r.castOn}`, `${r.front0} back and front, ${r.sleeve0} each sleeve; neck ${this.len(r.finished.neck)}`],
          ...(r.neckRibSts !== r.castOn ? [["Neckband", `${r.castOn} → ${r.neckRibSts}`, "for the rib"]] : []),
        ])
      : "";
    return `
      ${this.resultHead("The numbers")}
      ${numbers || table([
        ["Cast on", `${r.neckRibSts}`, `neck ${this.len(r.finished.neck)}`],
        ...(r.neckRibSts !== r.castOn ? [["After the neckband", `${r.neckRibSts} → ${r.castOn}`, "for the yoke"]] : []),
        ["At the start", `${r.front0} back, ${r.front0} front`, `${r.sleeve0} each sleeve`],
        ["Increase rounds", `${Math.max(r.bodyIncreases, r.sleeveIncreases)}`, schedule(r)],
        ["Yoke", `${r.yokeRounds} rounds`, this.len(r.finished.yokeDepth)],
        ["At the split", `${r.front} back, ${r.front} front`, `${r.sleeve} each sleeve`],
        ["Underarm cast-on", `${r.underarmSts}`, "at each side"],
        ["Body", `${r.body}`, `chest ${this.len(r.finished.chest)}`],
        ["Sleeve", `${r.upperArmSts} → ${r.wristSts}`, `${this.len(r.finished.upperArm)} → ${this.len(r.finished.wrist)}`],
      ])}
      ${r.warnings.length ? `<ul class="calc-warnings">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <h3>Steps</h3>
      <ol class="calc-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      ${this.actions()}`;
  }

  /** The raglan worked flat, as a cardigan: its own numbers and steps. */
  private cardiganResult(input: RaglanInput): string {
    const band = this.num("bandWidth");
    const c = cardigan(input, band, Math.max(0, Math.round(this.num("buttons"))));
    if ("error" in c) throw new Error(c.error);
    const r = c.r;
    const steps = cardiganSteps(c, input, this.len);
    this.keepPlan("Raglan cardigan", input, r.finished, steps);
    return `
      ${this.resultHead("The numbers")}
      ${table([
        ["Cast on", `${c.castOn}`, `${c.front0} each front, ${r.front0} back, ${r.sleeve0} each sleeve`],
        ["Increase rows", `${Math.max(r.bodyIncreases, r.sleeveIncreases)}`, scheduleFlat(r)],
        ["Yoke", `${r.yokeRounds} rows`, this.len(r.finished.yokeDepth)],
        ["At the split", `${c.front} each front, ${r.front} back`, `${r.sleeve} each sleeve`],
        ["Underarm cast-on", `${r.underarmSts}`, "at each side"],
        ["Body", `${c.body}`, `chest ${this.len(r.finished.chest)}, with the bands`],
        ...(c.hemRibSts !== c.body ? [["Hem rib", `${c.body} → ${c.hemRibSts}`, "on the row before it"]] : []),
        ["Sleeve", `${r.upperArmSts} → ${r.wristSts}`, `${this.len(r.finished.upperArm)} → ${this.len(r.finished.wrist)}`],
        ["Front bands", `${c.bandPickUp} each`, `${c.bandRows} rows; ${c.buttons ? `${c.buttons} buttonholes` : "no buttonholes"}`],
        ["Neckband", `${c.neckPickUp}`, `${r.neckRibRounds} rows`],
      ])}
      ${c.warnings.length ? `<ul class="calc-warnings">${c.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <h3>Steps</h3>
      <ol class="calc-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      ${this.actions()}`;
  }

  private sizeResult(): string {
    const g = this.gauge();
    const width = this.num("width");
    const length = this.num("length");
    const multiple = this.num("multiple") || 1;
    const plus = this.num("plus") || 0;
    this.need(width > 0 || length > 0, "Give a width, a length, or both.");
    this.needGauge(g, length > 0);
    const rows: [string, string, string][] = [];
    const lines: string[] = [];
    if (width > 0) {
      const s = stitchesFor(width, g, multiple, plus);
      const repeat = multiple > 1 || plus ? ` (a multiple of ${multiple}${plus ? ` plus ${plus}` : ""})` : "";
      rows.push(["Stitches", `${s.count}`, `${this.len(s.cm)} wide${repeat}`]);
      lines.push(`Cast on ${s.count} stitches for ${this.len(width)}${repeat}: it measures ${this.len(s.cm)}.`);
    }
    if (length > 0) {
      const r = rowsFor(length, g);
      rows.push(["Rows", `${r.count}`, `${this.len(r.cm)} long`]);
      lines.push(`Knit ${r.count} rows for ${this.len(length)}: they measure ${this.len(r.cm)}.`);
    }
    this.plan = { title: "Stitches for a size", text: lines.join("\n") };
    return `${this.resultHead("The numbers")}${table(rows)}<p class="calc-say">${lines.map(esc).join("<br />")}</p>${this.actions()}`;
  }

  private evenlyResult(): string {
    const now = this.num("now");
    const change = this.num("change");
    this.need(now > 0, "Give the stitches you have now.");
    this.need(!!change && !Number.isNaN(change), "Give how many to increase (8) or decrease (−8).");
    const round = (kept.values.round ?? "round") === "round";
    const s = spreadEvenly(now, change, round);
    if ("error" in s) throw new Error(s.error);
    const what = change > 0 ? `Increase ${change}` : `Decrease ${-change}`;
    const text = `${what} evenly ${round ? "in the round" : "across the row"}: ${s.text} ${s.to} stitches.`;
    this.plan = { title: what, text };
    return `${this.resultHead(`${what}, ${now} → ${s.to}`)}
      <p class="calc-big">${esc(s.text)}</p>
      <p class="hint">${round ? "Repeat between the stars as many times as it says; the round ends with the last." : "The row starts and ends with plain knitting, so no shaping falls at the edge."} M1 is make one; k2tog is knit two together.</p>
      ${this.actions()}`;
  }

  private regaugeResult(): string {
    const pattern = { sts: this.num("psts"), rows: this.num("prows") };
    const mine = this.gauge();
    const rowsMode = kept.values.countsAre === "rows";
    const key = rowsMode ? "rows" : "sts";
    this.need(pattern[key] > 0, `Give the pattern's ${rowsMode ? "rows" : "stitches"} per ${gaugeSpan(this.unit)}.`);
    this.need(mine[key] > 0, `Give your ${rowsMode ? "rows" : "stitches"} per ${gaugeSpan(this.unit)}: pick a swatch, or type it.`);
    const counts = (kept.values.counts ?? "").split(/[,;\s]+/).map(Number).filter((n) => n > 0);
    this.need(counts.length > 0, `Give the pattern's ${rowsMode ? "row" : "stitch"} counts: 96, 104, 112.`);
    const lines = counts.map((c) => ({ c, ...regauge(c, pattern[key], mine[key]) }));
    const unit = rowsMode ? "rows" : "sts";
    this.plan = {
      title: "Pattern at my gauge",
      text: lines.map((l) => `${l.c} ${unit} → ${l.mine} ${unit} (${this.len(l.patternCm)}; as written it would be ${this.len(l.asWrittenCm)})`).join("\n"),
    };
    return `${this.resultHead("At your gauge")}
      ${table(
        lines.map((l) => [`${l.c} ${unit}`, `${l.mine} ${unit}`, `${this.len(l.patternCm)}; as written ${this.len(l.asWrittenCm)}`]),
        ["Pattern", "Yours", rowsMode ? "Long" : "Wide"],
      )}
      <p class="hint">Knit your count for the pattern's size. Knitted as written at your gauge, it comes out the size in the last column.</p>
      ${this.actions()}`;
  }

  private resultHead(title: string): string {
    return `<h2>${esc(title)}</h2>`;
  }

  private actions(): string {
    const live = this.projects.filter((p) => isLive(p.status));
    return `
      <div class="calc-actions">
        <button class="ghost" data-act="copy">Copy</button>
        <select data-k="saveTo" aria-label="Project to save to">
          <option value="">Save to a project's board…</option>
          ${live.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
        </select>
        <button class="ghost" data-act="save">Save</button>
        <span class="hint" data-el="saved"></span>
      </div>`;
  }

  // ---------- events ----------

  private async onClick(e: MouseEvent): Promise<void> {
    const pick = closestEl(e.target, "[data-calc]");
    if (pick) return this.show(pick.dataset.calc as Calc);
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "copy" && this.plan) {
      try {
        await navigator.clipboard.writeText(this.plan.text);
        this.mark("Copied.");
      } catch {
        await say("The text could not be copied.", "Copy");
      }
    }
    if (act === "save" && this.plan) await this.saveToBoard();
  }

  private mark(text: string): void {
    const el = this.main.querySelector<HTMLElement>('[data-el="saved"]');
    if (el) el.textContent = text;
  }

  /** Puts the result on a project's board, as a text, below what is there. */
  private async saveToBoard(): Promise<void> {
    const projectId = this.main.querySelector<HTMLSelectElement>('[data-k="saveTo"]')?.value;
    if (!projectId || !this.plan) return this.mark("Choose a project first.");
    try {
      const items = await api.listBoardItems(projectId).catch(() => []);
      const y = items.reduce((max, it) => Math.max(max, it.y + it.h), 0) + 40;
      await api.addBoardItem(projectId, { kind: "text", x: 40, y, w: 460, h: 560, data: { text: this.plan.text } });
      this.mark(`Saved to ${this.projects.find((p) => p.id === projectId)?.name ?? "the project"}'s board.`);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Save");
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.k;
    if (!key || key === "saveTo") return;
    kept.values[key] = el.value;
    // Typing a gauge is no longer the swatch's.
    if (key === "sts" || key === "rows") {
      const pick = this.main.querySelector<HTMLSelectElement>('[data-k="swatch"]');
      const swatch = this.swatches.find((s) => s.id === pick?.value);
      if (pick && swatch && showGauge(gaugeOf(swatch)[key], this.unit) !== el.value) {
        pick.value = "";
        kept.values.swatch = "";
      }
    }
    // The body ease is the fit's until it is typed.
    if (key === "bodyEase") {
      const fit = this.main.querySelector<HTMLSelectElement>('[data-k="fit"]');
      const match = FITS.find((f) => showLength(f.ease, this.unit) === el.value.trim() || (f.ease === 0 && el.value.trim() === "0"));
      if (fit && match) fit.value = match.key;
    }
    this.calculate();
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLSelectElement;
    const key = el.dataset.k;
    if (!key || key === "saveTo") return;
    kept.values[key] = el.value;
    if (key === "swatch") {
      const swatch = this.swatches.find((s) => s.id === el.value);
      if (swatch) this.setField("sts", showGauge(gaugeOf(swatch).sts, this.unit)).setField("rows", showGauge(gaugeOf(swatch).rows, this.unit));
    }
    if (key === "person") {
      const person = this.people.find((p) => p.id === el.value);
      for (const f of RAGLAN_FIELDS) {
        const v = person && f.from ? latestValue(person, f.from) : null;
        // A round yoke reaches a little higher than the armhole: it covers the shoulders.
        const extra = kept.calc === "yoke" && f.key === "yokeDepth" ? YOKE_OVER_ARMHOLE : 0;
        if (v) this.setField(f.key, showLength(v.cm + extra, this.unit));
      }
    }
    if (key === "fit") {
      const fit = FITS.find((f) => f.key === el.value);
      if (fit) this.setField("bodyEase", fit.ease ? showLength(fit.ease, this.unit) : "0");
    }
    if (key === "round" || key === "countsAre") kept.values[key] = el.value;
    if (key === "direction") {
      const hint = this.main.querySelector<HTMLElement>(".calc-inputs h2 .hint");
      if (hint) hint.textContent = workedHint(el.value);
      const extra = this.main.querySelector<HTMLElement>('[data-el="cardigan"]');
      if (extra) extra.hidden = el.value !== "flat";
    }
    this.calculate();
  }

  /** Fills a field, and remembers it, as if typed. */
  private setField(key: string, value: string): this {
    const el = this.main.querySelector<HTMLInputElement>(`[data-k="${key}"]`);
    if (el) el.value = value;
    kept.values[key] = value;
    return this;
  }
}

/** How the raglan is worked, under its heading. */
function workedHint(direction: string | undefined): string {
  return direction === "up" ? "bottom-up, in the round" : direction === "flat" ? "a cardigan, worked flat from the neck" : "top-down, in the round";
}

/** A cardigan's increase rows: on every row where the yoke is shallow, then on right-side rows. */
function scheduleFlat(r: RaglanResult): string {
  return [r.everyRound ? `every row ×${r.everyRound}` : "", r.everyOther ? `every right-side row ×${r.everyOther}` : ""].filter(Boolean).join(", then ");
}

/** The bottom-up order: every other round first, by the underarm, every round last, by the neck. */
function scheduleUp(r: RaglanResult): string {
  return [r.everyOther ? `every other round ×${r.everyOther}` : "", r.everyRound ? `every round ×${r.everyRound}` : ""].filter(Boolean).join(", then ");
}

/** "every other round 28 times", or "every round 4 times, then every other round 20 times". */
function schedule(r: RaglanResult): string {
  return [r.everyRound ? `every round ×${r.everyRound}` : "", r.everyOther ? `every other round ×${r.everyOther}` : ""].filter(Boolean).join(", then ");
}

function table(rows: (string | number)[][], head?: string[]): string {
  return `<table class="calc-table">
    ${head ? `<thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 && !head ? `<th>${esc(String(c))}</th>` : `<td>${esc(String(c))}</td>`)).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
