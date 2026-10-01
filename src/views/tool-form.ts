import {
  api,
  CABLE_SIZES,
  TOOL_KINDS,
  type Project,
  type Tool,
  type ToolInput,
  type ToolKind,
} from "../api";
import { closestEl } from "../dom";
import { makeCombo } from "./combo";
import {
  canonical,
  connectorFor,
  connectorSummary,
  knownBrands,
  knownMaterials,
  materialLabel,
  materialValue,
  parseSizes,
  type ConnectorStep,
} from "./tool-filter";

/** Lengths offered as suggestions; any other can still be typed. */
const COMMON_LENGTHS = [10, 13, 15, 20, 23, 25, 30, 35, 40];
const COMMON_CABLES = [23, 30, 40, 60, 80, 100, 120, 150];

/** Which measurements each kind has. Matches `tools::clean` on the backend. */
const HAS = {
  size: (k: string) => k !== "cable",
  length: (k: string) => ["straight", "dpn", "tips", "hook"].includes(k),
  cable: (k: string) => k === "circular" || k === "cable",
  connector: (k: string) => k === "tips" || k === "cable",
};

/** What the length field is called for each kind. */
const LENGTH_LABEL: Record<string, string> = {
  straight: "Needle length (cm)",
  dpn: "Needle length (cm)",
  tips: "Tip length (cm)",
  hook: "Needle length (cm)",
};

/** The cable size choice that opens the per-size steps; only offered for a set. */
const SPLIT = "__split__";

/** The project picker's "free" choice. */
const FREE = "";

/**
 * The add/edit dialog for a needle or hook.
 *
 * Only the measurements a kind has are shown: switching from a circular to a
 * hook swaps the cable length for a hook length rather than leaving a field
 * that means nothing. "Save and add another" keeps everything filled in, since
 * a box is usually entered a run of sizes at a time.
 */
export class ToolForm {
  private root: HTMLElement;
  private editing: Tool | null;
  private onDone: (tool: Tool) => void;
  /** The active projects, which are what a tool can be put on. */
  private projects: Project[] = [];
  private brands: string[] = [];
  private materials: string[] = [];
  /** A set's connector changes, while "Changes with size…" is chosen. */
  private steps: ConnectorStep[] = [];

  constructor(root: HTMLElement, editing: Tool | null, onDone: (tool: Tool) => void) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
  }

  async open(): Promise<void> {
    const [projects, tools] = await Promise.all([
      api.listProjects().catch(() => [] as Project[]),
      api.listTools().catch(() => [] as Tool[]),
    ]);
    this.projects = projects.filter((p) => p.status === "active");
    this.brands = knownBrands(tools);
    this.materials = knownMaterials(tools);

    const e = this.editing;
    const kind: ToolKind = e?.kind ?? "circular";
    const projectChoice = e?.projectId ?? FREE;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal tool-form" role="dialog" aria-modal="true">
        <h2>${e ? "Edit needle or hook" : "Add a needle or hook"}</h2>

        <div class="field-row">
          <label class="field">
            <span>Kind</span>
            <select data-f="kind">
              ${TOOL_KINDS.map((k) => `<option value="${k.key}" ${k.key === kind ? "selected" : ""}>${k.label}</option>`).join("")}
            </select>
          </label>
          <label class="field" data-show="size">
            <span>Size (mm)</span>
            <input data-f="sizeMm" inputmode="decimal" autocomplete="off"
              title="${e ? "" : "One size, or several for a set: 2.5, 3, 3.5"}"
              value="${e && e.sizeMm ? e.sizeMm : ""}" placeholder="${e ? "e.g. 4 or 3.75" : "4, or a set: 3, 3.5, 4"}" />
          </label>
          <label class="field" data-show="length">
            <span data-el="length-label">${LENGTH_LABEL[kind] ?? "Length (cm)"}</span>
            <input data-f="lengthCm" type="number" min="0" step="0.5" list="tool-lengths"
              value="${e && e.lengthCm ? e.lengthCm : ""}" placeholder="e.g. 20" />
          </label>
          <label class="field" data-show="cable">
            <span>Cable length (cm)</span>
            <input data-f="cableCm" type="number" min="0" step="1" list="tool-cables"
              value="${e && e.cableCm ? e.cableCm : ""}" placeholder="e.g. 80" />
          </label>
          <label class="field" data-show="connector">
            <span>Cable size</span>
            <select data-f="cableSize">
              <option value="">Not sure</option>
              ${CABLE_SIZES.map((c) => `<option value="${c.key}" ${e?.cableSize === c.key ? "selected" : ""}>${c.label}</option>`).join("")}
              <option value="${SPLIT}" data-el="split-option" hidden>Changes with size…</option>
            </select>
          </label>
        </div>
        <p class="hint" data-el="kind-hint"></p>
        <div class="connector-steps" data-el="connector-steps" hidden></div>
        <p class="hint set-preview" data-el="set-preview" hidden></p>

        <div class="field-row">
          <div class="field">
            <span>Brand</span>
            <input data-f="brand" aria-label="Brand" value="${escapeAttr(e?.brand ?? "")}" placeholder="Type, or pick one you have" />
          </div>
          <div class="field">
            <span>Material</span>
            <input data-f="material" aria-label="Material" value="${escapeAttr(e?.material ? materialLabel(e.material) : "")}"
              placeholder="Type, or pick: metal, bamboo…" />
          </div>
        </div>

        <div class="field-row" data-el="project-row">
          <label class="field">
            <span>In use for</span>
            <select data-f="project">
              <option value="${FREE}" ${projectChoice === FREE ? "selected" : ""}>Nothing — it's free</option>
              ${this.projects
                .map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === projectChoice ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
                .join("")}
            </select>
            ${this.projects.length ? "" : `<span class="hint">Start a project in the Projects tab to put needles on it.</span>`}
          </label>
        </div>

        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="Anything worth remembering: a bent tip, part of a set…">${escapeHtml(e?.notes ?? "")}</textarea>
        </label>

        <datalist id="tool-lengths">${COMMON_LENGTHS.map((n) => `<option value="${n}"></option>`).join("")}</datalist>
        <datalist id="tool-cables">${COMMON_CABLES.map((n) => `<option value="${n}"></option>`).join("")}</datalist>

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          ${e ? "" : `<button class="ghost" data-act="save-another" title="Save this one and keep the form filled in for the next">Save and add another</button>`}
          <button class="primary" data-act="save">${e ? "Save changes" : "Add"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
        <p class="form-saved" data-el="saved" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("change", this.onChange);
    this.root.querySelector('[data-f="sizeMm"]')?.addEventListener("input", () => this.previewSet());
    // Both take anything typed, and offer what is already in the box.
    makeCombo(this.root.querySelector<HTMLInputElement>('[data-f="brand"]')!, () => this.brands);
    makeCombo(this.root.querySelector<HTMLInputElement>('[data-f="material"]')!, () => this.materials);
    this.applyKind();
    (this.root.querySelector('[data-f="sizeMm"]') as HTMLInputElement | null)?.focus();
  }

  private onChange = (e: Event): void => {
    const target = e.target as HTMLSelectElement;
    const f = target.dataset.f;
    if (f === "kind" || f === "project") this.applyKind();
    if (f === "cableSize") this.previewSet();
    const step = target.dataset.step;
    if (step !== undefined) {
      const s = this.steps[Number(step)];
      if (target.dataset.part === "from") s.from = Number(target.value);
      if (target.dataset.part === "size") s.size = target.value;
      this.renderSteps();
      this.previewSet();
    }
  };

  // ---------- a set's connector changes ----------

  /** Whether "Changes with size…" applies: chosen, for a set of tips or cables. */
  private splitting(): boolean {
    return this.isSet() && HAS.connector(this.value("kind")) && this.value("cableSize") === SPLIT;
  }

  /**
   * Keeps the steps on sizes the set has: the first starts at the smallest,
   * and a later one whose size was removed moves to the next size up, or goes.
   * Started, when first needed, as small then large from the middle size:
   * the commonest set there is, and a starting point to correct.
   */
  private fitSteps(sizes: number[]): void {
    if (!sizes.length) return;
    if (!this.steps.length) {
      this.steps = [
        { from: sizes[0], size: "small" },
        { from: sizes[Math.ceil(sizes.length / 2)] ?? sizes[sizes.length - 1], size: "large" },
      ];
    }
    const fitted: ConnectorStep[] = [];
    this.steps.forEach((step, i) => {
      const from = i === 0 ? sizes[0] : sizes.find((mm) => mm >= step.from);
      if (from === undefined || (i > 0 && from === sizes[0])) return;
      if (fitted.some((f) => f.from === from)) return;
      fitted.push({ from, size: step.size });
    });
    this.steps = fitted.sort((a, b) => a.from - b.from);
  }

  /** One row per change: "From [5.5] mm: [Large]", and a way to add another. */
  private renderSteps(): void {
    const box = this.root.querySelector<HTMLElement>('[data-el="connector-steps"]');
    if (!box) return;
    const on = this.splitting();
    box.hidden = !on;
    if (!on) return;
    const { sizes } = parseSizes(this.value("sizeMm"));
    this.fitSteps(sizes);
    const connector = (i: number, chosen: string) => `
      <select data-step="${i}" data-part="size" aria-label="Cable size">
        <option value="" ${chosen ? "" : "selected"}>Not sure</option>
        ${CABLE_SIZES.map((c) => `<option value="${c.key}" ${c.key === chosen ? "selected" : ""}>${c.label}</option>`).join("")}
      </select>`;
    const free = sizes.slice(1).filter((mm) => !this.steps.some((s) => s.from === mm));
    box.innerHTML = `
      ${this.steps
        .map((step, i) =>
          i === 0
            ? `<div class="connector-step"><span>From ${step.from} mm</span>${connector(i, step.size)}</div>`
            : `<div class="connector-step">
                <span>From</span>
                <select data-step="${i}" data-part="from" aria-label="From size">
                  ${sizes
                    .slice(1)
                    .filter((mm) => mm === step.from || !this.steps.some((s) => s.from === mm))
                    .map((mm) => `<option value="${mm}" ${mm === step.from ? "selected" : ""}>${mm} mm</option>`)
                    .join("")}
                </select>
                ${connector(i, step.size)}
                <button type="button" class="ghost" data-act="step-remove" data-step="${i}" title="Remove this change">✕</button>
              </div>`,
        )
        .join("")}
      ${free.length ? `<button type="button" class="ghost" data-act="step-add">+ Add a change</button>` : ""}
    `;
  }

  /** Shows the fields the chosen kind has, and the project name when asked for. */
  private applyKind(): void {
    const kind = this.value("kind");
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-show]")) {
      const what = el.dataset.show!;
      el.hidden = !HAS[what as keyof typeof HAS](kind);
    }
    const label = this.root.querySelector('[data-el="length-label"]');
    if (label) label.textContent = LENGTH_LABEL[kind] ?? "Length (cm)";
    const hint = this.root.querySelector('[data-el="kind-hint"]') as HTMLElement;
    hint.textContent =
      kind === "circular"
        ? "Cable length as sold: an 80 cm circular is 80 cm from tip to tip."
        : kind === "tips" || kind === "cable"
          ? "Cable size is the connector, which decides which tips fit which cables."
          : kind === "dpn"
            ? "One entry for the needles of one size together."
            : "";
    hint.hidden = !hint.textContent;
    this.previewSet();
  }

  /**
   * Says what Add will do when several sizes are typed -- a set, as an
   * interchangeable set comes: one entry per size, sharing what the set has in
   * common -- and puts the count on the button, so a set is never added by
   * surprise.
   *
   * What a set does not share is a project: each size goes to whatever it is
   * knitted with. So a set is added free, and "In use for" is hidden while
   * one is typed rather than offering to put every size on one project.
   */
  private previewSet(): void {
    const preview = this.root.querySelector<HTMLElement>('[data-el="set-preview"]');
    const add = this.root.querySelector<HTMLButtonElement>('[data-act="save"]');
    if (!preview || !add) return;
    const { sizes } = parseSizes(this.value("sizeMm"));
    const set = this.isSet();
    preview.hidden = !set;
    // "Changes with size…" is only for a set: one size has one connector.
    const split = this.root.querySelector<HTMLOptionElement>('[data-el="split-option"]');
    if (split) split.hidden = !set;
    const cableSize = this.root.querySelector<HTMLSelectElement>('[data-f="cableSize"]');
    if (!set && cableSize?.value === SPLIT) cableSize.value = "";
    this.renderSteps();
    if (set) {
      const connectors = this.splitting() ? ` Cable size: ${connectorSummary(sizes, this.steps)}.` : "";
      preview.textContent = `A set: ${sizes.length} entries, ${sizes.join(", ")} mm, sharing the kind, length, brand, material and notes.${connectors} Each is added free; put one on a project from its card, or from the pattern.`;
    }
    const projectRow = this.root.querySelector<HTMLElement>('[data-el="project-row"]');
    if (projectRow) projectRow.hidden = set;
    if (!this.editing) add.textContent = set ? `Add ${sizes.length}` : "Add";
  }

  /** Whether several sizes are typed for a new tool, which makes it a set. */
  private isSet(): boolean {
    return !this.editing && HAS.size(this.value("kind")) && parseSizes(this.value("sizeMm")).sizes.length > 1;
  }

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) {
      this.close();
      return;
    }
    const btn = closestEl(e.target, "button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "cancel") this.close();
    if (btn.dataset.act === "save") void this.save(false);
    if (btn.dataset.act === "save-another") void this.save(true);
    if (btn.dataset.act === "step-remove") {
      this.steps.splice(Number(btn.dataset.step), 1);
      this.renderSteps();
      this.previewSet();
    }
    if (btn.dataset.act === "step-add") {
      const { sizes } = parseSizes(this.value("sizeMm"));
      const last = this.steps[this.steps.length - 1];
      const from = sizes.find((mm) => mm > last.from) ?? sizes.slice(1).find((mm) => !this.steps.some((s) => s.from === mm));
      if (from !== undefined) {
        // The next connector up from the last one, as sets grow.
        const keys = CABLE_SIZES.map((c) => c.key as string);
        const next = keys[Math.min(keys.indexOf(last.size) + 1, keys.length - 1)] ?? "";
        this.steps.push({ from, size: next });
        this.renderSteps();
        this.previewSet();
      }
    }
  };

  private value(name: string): string {
    return (this.root.querySelector(`[data-f="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  }

  private input(): ToolInput {
    const kind = this.value("kind") as ToolKind;
    const choice = this.value("project");
    return {
      kind,
      // The first size; a set's others are added by save() from the same input.
      sizeMm: HAS.size(kind) ? (parseSizes(this.value("sizeMm")).sizes[0] ?? 0) : 0,
      lengthCm: HAS.length(kind) ? num(this.value("lengthCm")) : 0,
      cableCm: HAS.cable(kind) ? num(this.value("cableCm")) : 0,
      // "Changes with size…" is not a size; save() gives each size its own.
      cableSize: HAS.connector(kind) && this.value("cableSize") !== SPLIT ? this.value("cableSize") : "",
      // The same word in another case files under the spelling already used.
      brand: canonical(this.value("brand"), this.brands),
      material: materialValue(canonical(this.value("material"), this.materials)),
      projectId: choice || null,
      notes: this.value("notes"),
    };
  }

  private async save(another: boolean): Promise<void> {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".modal-actions button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const set = this.isSet();
      // A set is added free: its sizes do not share a project (see previewSet).
      const input = set ? { ...this.input(), projectId: null } : this.input();
      const { sizes, bad } = HAS.size(input.kind) ? parseSizes(this.value("sizeMm")) : { sizes: [0], bad: [] };
      if (bad.length) throw new Error(`“${bad[0]}” is not a size. Give sizes in millimetres, e.g. 4, or 2.5, 3, 3.5 for a set.`);
      if (!sizes.length) throw new Error("Give the size in millimetres, e.g. 4 or 3.75.");
      if (this.editing && sizes.length > 1) throw new Error("This changes one needle or hook, so give it one size. Add a set with + Add.");
      let saved: Tool;
      if (this.editing) {
        saved = await api.updateTool(this.editing.id, input);
      } else {
        // A set is one entry per size, sharing the rest but no project. Added
        // one at a time, in order, so a refusal partway names the size it
        // stopped at.
        const steps = this.splitting() ? this.steps : null;
        const one = (mm: number) => ({ ...input, sizeMm: mm, cableSize: steps ? connectorFor(mm, steps) : input.cableSize });
        saved = await api.addTool(one(sizes[0]));
        for (const size of sizes.slice(1)) {
          try {
            saved = await api.addTool(one(size));
          } catch (err) {
            this.onDone(saved);
            throw new Error(`Added up to ${saved.sizeMm} mm, then stopped at ${size} mm: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      const what = saved.kind === "cable" ? "the cable" : sizes.length > 1 ? `${sizes.length}: ${sizes.join(", ")} mm` : `the ${saved.sizeMm} mm`;
      if (another) {
        // Everything stays filled in for the next one; the size is what
        // usually changes, so it is selected ready to be typed over.
        this.showSaved(`Added ${what}. Change what differs and add the next.`);
        const size = this.root.querySelector('[data-f="sizeMm"]') as HTMLInputElement | null;
        if (size && !size.closest<HTMLElement>("[data-show]")?.hidden) size.select();
        // A brand or material typed for the first time is a choice for the next.
        this.brands = withChoice(this.brands, saved.brand);
        this.materials = withChoice(this.materials, materialLabel(saved.material));
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

  private showError(message: string): void {
    (this.root.querySelector('[data-el="saved"]') as HTMLElement).hidden = true;
    const el = this.root.querySelector('[data-el="error"]') as HTMLElement;
    el.textContent = message;
    el.hidden = false;
  }

  private showSaved(message: string): void {
    (this.root.querySelector('[data-el="error"]') as HTMLElement).hidden = true;
    const el = this.root.querySelector('[data-el="saved"]') as HTMLElement;
    el.textContent = message;
    el.hidden = false;
  }

  private close(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

/** The choices with one more, unless it is empty or already there in any case. */
function withChoice(choices: string[], value: string): string[] {
  const v = value.trim();
  if (!v || choices.some((c) => c.toLowerCase() === v.toLowerCase())) return choices;
  return [...choices, v];
}

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
