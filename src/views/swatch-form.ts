import { api, isLive, type MeasureUnit, type Project, type Swatch, type SwatchInput, type Tool, type Yarn } from "../api";
import { forgetSwatchPhoto, swatchPhotoUrl } from "../covers";
import { askYesNo } from "../dialogs";
import { closestEl } from "../dom";
import { makeCombo } from "./combo";
import { describeFibres } from "./fibres";
import { blockingText, gaugeSpan, readGauge, showGauge } from "./measure";
import { PhotoBox } from "./photo-box";
import { fromDateInput, toDateInput } from "./project-form";
import { describe, mostUsedSpellings } from "./tool-filter";

/** The yarn picker's choice for yarn not in the stash, and the needle picker's for a size only. */
const TYPED = "";

/** Stitch patterns offered before any swatch has one. */
const STITCHES = ["Stockinette", "Garter", "Rib 1x1", "Rib 2x2", "Seed", "Cables", "Lace", "Colourwork", "Brioche"];

/** What a new swatch can start with, from wherever it is added. */
export interface SwatchTemplate {
  yarnId?: string;
  projectId?: string;
}

export interface SwatchFormHooks {
  /** Shows the yarn it was knitted in, closing this form. */
  openYarn(yarnId: string): void;
}

/**
 * The add/edit dialog for a gauge swatch: what it was knitted in and on, its
 * stitch pattern, and its stitches and rows over 10 cm (or 4 in), before and
 * after blocking. A yarn not in the stash is typed in; a needle not in
 * Needles & hooks is just a size. Editing one shows the yarn it was knitted
 * in, with a way through to it.
 */
export class SwatchForm {
  private root: HTMLElement;
  private editing: Swatch | null;
  private template: SwatchTemplate;
  private hooks: SwatchFormHooks;
  private onDone: (swatch: Swatch) => void;
  private yarns: Yarn[] = [];
  private tools: Tool[] = [];
  private projects: Project[] = [];
  private stitches: string[] = [];
  private unit: MeasureUnit = "cm";
  private photo: PhotoBox | null = null;

  constructor(root: HTMLElement, editing: Swatch | null, onDone: (swatch: Swatch) => void, template: SwatchTemplate, hooks: SwatchFormHooks) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    this.template = template;
    this.hooks = hooks;
  }

  async open(): Promise<void> {
    const [yarns, tools, projects, swatches, unit] = await Promise.all([
      api.listYarns({}).catch(() => [] as Yarn[]),
      api.listTools().catch(() => [] as Tool[]),
      api.listProjects().catch(() => [] as Project[]),
      api.listSwatches().catch(() => [] as Swatch[]),
      api.getMeasureUnit().catch(() => "cm" as const),
    ]);
    const e = this.editing;
    this.yarns = [...yarns].sort((a, b) => yarnLabel(a).localeCompare(yarnLabel(b)));
    // A cable has no size to knit a swatch on.
    this.tools = tools.filter((t) => t.kind !== "cable");
    this.projects = projects.filter((p) => isLive(p.status) || p.id === e?.projectId || p.id === this.template.projectId);
    this.stitches = mostUsedSpellings([...swatches.map((s) => s.stitch).filter(Boolean), ...STITCHES]);
    this.unit = unit;

    const yarnId = e ? (e.yarnId ?? TYPED) : (this.template.yarnId ?? TYPED);
    const toolId = e?.toolId ?? TYPED;
    const projectId = e?.projectId ?? this.template.projectId ?? "";
    const span = gaugeSpan(unit);
    const g = (v: number | undefined) => esc(showGauge(v ?? 0, unit));
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal swatch-form" role="dialog" aria-modal="true">
        <h2>${e ? "Swatch" : "Add a swatch"}</h2>

        <div class="swatch-main-row">
          <div class="field">
            <span>Photo</span>
            <div class="wish-photo-box swatch-photo-box" data-el="photobox" title="Paste a picture with Ctrl+V, drop one here, or choose one"></div>
            <div class="wish-photo-actions">
              <button class="ghost" data-act="photo-file" type="button">Choose…</button>
              <button class="ghost" data-act="photo-remove" type="button">Remove</button>
            </div>
          </div>
          <div class="swatch-fields">
            <label class="field">
              <span>Yarn</span>
              <select data-f="yarn">
                <option value="${TYPED}" ${yarnId === TYPED ? "selected" : ""}>Not in the stash: type it</option>
                ${this.yarns.map((y) => `<option value="${esc(y.id)}" ${y.id === yarnId ? "selected" : ""}>${esc(yarnLabel(y))}</option>`).join("")}
              </select>
            </label>
            <label class="field" data-el="yarn-text-field">
              <span>Which yarn</span>
              <input data-f="yarnText" value="${esc(e?.yarnText ?? "")}" placeholder="As on the ball band: Drops Air, off white" />
            </label>
            <div class="swatch-yarn-info" data-el="yarn-info" hidden></div>
            <div class="field-row swatch-needle">
              <label class="field">
                <span>Needle</span>
                <select data-f="tool">
                  <option value="${TYPED}" ${toolId === TYPED ? "selected" : ""}>Just a size</option>
                  ${this.tools.map((t) => `<option value="${esc(t.id)}" ${t.id === toolId ? "selected" : ""}>${esc(describe(t))}</option>`).join("")}
                </select>
              </label>
              <label class="field" data-el="size-field">
                <span>Size (mm)</span>
                <input data-f="needleMm" inputmode="decimal" value="${e?.needleMm ? e.needleMm : ""}" placeholder="e.g. 4" />
              </label>
            </div>
            <div class="field">
              <span>Stitch pattern</span>
              <input data-f="stitch" aria-label="Stitch pattern" value="${esc(e?.stitch ?? "")}" placeholder="Stockinette, garter, rib…" />
            </div>
          </div>
        </div>

        <div class="field">
          <span>Gauge, counted over ${span} in the middle of the swatch</span>
          <table class="gauge-table">
            <thead><tr><th></th><th>Stitches</th><th>Rows</th></tr></thead>
            <tbody>
              <tr><th>After blocking</th>
                <td><input data-f="stsBlocked" inputmode="decimal" value="${g(e?.stsBlocked)}" aria-label="Stitches after blocking" /></td>
                <td><input data-f="rowsBlocked" inputmode="decimal" value="${g(e?.rowsBlocked)}" aria-label="Rows after blocking" /></td></tr>
              <tr><th>Before blocking <span class="hint">(optional)</span></th>
                <td><input data-f="sts" inputmode="decimal" value="${g(e?.sts)}" aria-label="Stitches before blocking" /></td>
                <td><input data-f="rows" inputmode="decimal" value="${g(e?.rows)}" aria-label="Rows before blocking" /></td></tr>
            </tbody>
          </table>
          <p class="swatch-blocking" data-el="blocking" hidden></p>
          <span class="hint">Per ${span}${unit === "in" ? " (kept as per 10 cm)" : ""}. Half stitches count: 22.5. Counted before blocking too, it shows what washing did, which some yarns (deadstock, cones) do a lot of. Calculators use the blocked gauge.</span>
        </div>

        <div class="field-row swatch-when">
          <label class="field">
            <span>Knitted on</span>
            <input type="date" data-f="madeAt" value="${toDateInput(e?.madeAt ?? Date.now())}" />
          </label>
          <label class="field">
            <span>For</span>
            <select data-f="project">
              <option value="">No project</option>
              ${this.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === projectId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
            </select>
          </label>
        </div>

        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="How it felt, how it washed, what you would change…">${esc(e?.notes ?? "")}</textarea>
        </label>

        <div class="modal-actions">
          ${e ? `<button class="ghost danger-text" data-act="remove">Remove swatch</button><span class="spacer"></span>` : ""}
          <button class="ghost" data-act="cancel">Cancel</button>
          ${e ? "" : `<button class="ghost" data-act="save-another" title="Save this one and start the next, in the same yarn">Save and add another</button>`}
          <button class="primary" data-act="save">${e ? "Save changes" : "Add"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
        <p class="form-saved" data-el="saved" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("change", this.onChange);
    makeCombo(this.field("stitch"), () => this.stitches);
    this.photo = new PhotoBox(
      this.root.querySelector<HTMLElement>('[data-el="photobox"]')!,
      async () => (e?.photoPath ? swatchPhotoUrl(e.id) : null),
      (message) => this.showError(message),
    );
    this.applyChoices();
    this.showBlocking();
    this.root.addEventListener("input", (ev) => {
      if (["sts", "rows", "stsBlocked", "rowsBlocked"].includes((ev.target as HTMLElement).dataset.f ?? "")) this.showBlocking();
    });
    (e ? this.field("stsBlocked") : this.field("yarn")).focus();
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.root.querySelector<T>(`[data-f="${name}"]`)!;
  }

  /** Shows the typed yarn or the stash yarn's details, and the size or the needle. */
  private applyChoices(): void {
    const yarn = this.yarns.find((y) => y.id === this.field<HTMLSelectElement>("yarn").value);
    this.root.querySelector<HTMLElement>('[data-el="yarn-text-field"]')!.hidden = !!yarn;
    const info = this.root.querySelector<HTMLElement>('[data-el="yarn-info"]')!;
    info.hidden = !yarn;
    if (yarn) {
      const facts = [yarn.yarnWeight, yarn.fibres.length ? describeFibres(yarn.fibres) : "", yarn.metresPerBall && yarn.gramsPerBall ? `${yarn.metresPerBall} m / ${yarn.gramsPerBall} g` : ""].filter(Boolean);
      info.innerHTML = `
        <span>${esc(facts.join(" · ") || "No details recorded for this yarn.")}</span>
        <button class="link" type="button" data-act="open-yarn">Open the yarn ↗</button>`;
    }
    const tool = this.tools.find((t) => t.id === this.field<HTMLSelectElement>("tool").value);
    this.root.querySelector<HTMLElement>('[data-el="size-field"]')!.hidden = !!tool;
  }

  /** Says what blocking did, as the counts are typed: "7% wider and 5% longer". */
  private showBlocking(): void {
    const read = (f: string) => readGauge(this.field(f).value, this.unit) || 0;
    const text = blockingText({ sts: read("sts"), rows: read("rows"), stsBlocked: read("stsBlocked"), rowsBlocked: read("rowsBlocked") });
    const el = this.root.querySelector<HTMLElement>('[data-el="blocking"]')!;
    el.textContent = text ? `Blocking made it ${text.replace(", ", " and ")}.` : "";
    el.hidden = !text;
  }

  private onChange = (e: Event): void => {
    const f = (e.target as HTMLElement).dataset.f;
    if (f === "yarn" || f === "tool") this.applyChoices();
  };

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) return this.close();
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "cancel") this.close();
    if (act === "save") void this.save(false);
    if (act === "save-another") void this.save(true);
    if (act === "photo-file") this.photo?.choose();
    if (act === "photo-remove") this.photo?.remove();
    if (act === "remove") void this.remove();
    if (act === "open-yarn") {
      const yarnId = this.field<HTMLSelectElement>("yarn").value;
      this.close();
      this.hooks.openYarn(yarnId);
    }
  };

  /** The form as an input, or an error message for a count that is not a number. */
  private input(): SwatchInput {
    const value = (name: string) => this.field<HTMLInputElement>(name).value;
    const counts: Record<string, number> = {};
    for (const [f, what] of [["sts", "stitches"], ["rows", "rows"], ["stsBlocked", "stitches"], ["rowsBlocked", "rows"]] as const) {
      const n = readGauge(value(f), this.unit);
      if (Number.isNaN(n)) throw new Error(`“${value(f)}” is not a number of ${what}. Count over ${gaugeSpan(this.unit)}: 22, or 22.5.`);
      counts[f] = n;
    }
    const size = Number(value("needleMm").replace(",", ".") || 0);
    if (Number.isNaN(size)) throw new Error("Give the needle size in millimetres, e.g. 4 or 3.75.");
    const yarnId = value("yarn") || null;
    const toolId = value("tool") || null;
    const made = value("madeAt");
    return {
      yarnId,
      yarnText: yarnId ? "" : value("yarnText"),
      toolId,
      needleMm: toolId ? (this.tools.find((t) => t.id === toolId)?.sizeMm ?? size) : size,
      stitch: value("stitch"),
      sts: counts.sts,
      rows: counts.rows,
      stsBlocked: counts.stsBlocked,
      rowsBlocked: counts.rowsBlocked,
      projectId: value("project") || null,
      notes: value("notes"),
      madeAt: made ? fromDateInput(made) : null,
    };
  }

  private async save(another: boolean): Promise<void> {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".modal-actions button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const input = this.input();
      const saved = this.editing ? await api.updateSwatch(this.editing.id, input) : await api.addSwatch(input);
      // The photo goes up after the save: a new swatch has no id until then.
      if (this.photo?.pending) {
        await api.setSwatchPhoto(saved.id, Array.from(new Uint8Array(await this.photo.pending.arrayBuffer())));
        forgetSwatchPhoto(saved.id);
      } else if (this.photo?.removed && this.editing?.photoPath) {
        await api.removeSwatchPhoto(saved.id);
        forgetSwatchPhoto(saved.id);
      }
      if (another) {
        // The yarn, needle and date stay: a run of swatches is usually one
        // yarn on several needles, or one needle in several stitches.
        for (const f of ["sts", "rows", "stsBlocked", "rowsBlocked", "notes"]) this.field(f).value = "";
        this.showBlocking();
        this.photo?.reset();
        this.showSaved("Added. Change what differs and add the next.");
        this.field("stsBlocked").focus();
        this.onDone(saved);
      } else {
        this.close();
        this.onDone(saved);
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  private async remove(): Promise<void> {
    const swatch = this.editing;
    if (!swatch) return;
    const ok = await askYesNo("Remove this swatch, and its photo?\n\nThis cannot be undone.", { title: "Remove swatch", okLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.deleteSwatch(swatch.id);
      forgetSwatchPhoto(swatch.id);
    } catch (err) {
      return this.showError(err instanceof Error ? err.message : String(err));
    }
    this.close();
    this.onDone(swatch);
  }

  private showError(message: string): void {
    this.root.querySelector<HTMLElement>('[data-el="saved"]')!.hidden = true;
    const el = this.root.querySelector<HTMLElement>('[data-el="error"]')!;
    el.textContent = message;
    el.hidden = false;
  }

  private showSaved(message: string): void {
    this.root.querySelector<HTMLElement>('[data-el="error"]')!.hidden = true;
    const el = this.root.querySelector<HTMLElement>('[data-el="saved"]')!;
    el.textContent = message;
    el.hidden = false;
  }

  private close(): void {
    this.photo?.destroy();
    this.photo = null;
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

/** A stash yarn as the picker lists it: "Drops Alpaca, Light grey". */
export function yarnLabel(y: Yarn): string {
  return `${[y.brand, y.name].filter(Boolean).join(" ")}${y.colourway ? `, ${y.colourway}` : ""}`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
