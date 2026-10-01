import {
  api,
  CABLE_SIZES,
  STATUSES,
  TOOL_KINDS,
  type Pattern,
  type Tool,
  type ToolInput,
  type ToolKind,
} from "../api";
import { closestEl } from "../dom";
import { makeCombo } from "./combo";
import { canonical, knownBrands, knownMaterials, materialLabel, materialValue, parseSizes } from "./tool-filter";

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

/** The pattern picker's special values. */
const FREE = "";
const OTHER = "__other__";

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
  private patterns: Pattern[] = [];
  private brands: string[] = [];
  private materials: string[] = [];

  constructor(root: HTMLElement, editing: Tool | null, onDone: (tool: Tool) => void) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
  }

  async open(): Promise<void> {
    const [patterns, tools] = await Promise.all([
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listTools().catch(() => [] as Tool[]),
    ]);
    this.patterns = patterns;
    this.brands = knownBrands(tools);
    this.materials = knownMaterials(tools);

    const e = this.editing;
    const kind: ToolKind = e?.kind ?? "circular";
    const projectChoice = e?.patternId ?? (e?.project ? OTHER : FREE);
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
            </select>
          </label>
        </div>
        <p class="hint" data-el="kind-hint"></p>
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
              ${this.patternOptions(projectChoice)}
              <option value="${OTHER}" ${projectChoice === OTHER ? "selected" : ""}>Something not in the library…</option>
            </select>
          </label>
          <label class="field" data-show="other-project">
            <span>Project</span>
            <input data-f="projectName" value="${escapeAttr(e?.project ?? "")}" placeholder="e.g. Gift hat for Sam" />
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

  /**
   * The library's patterns, ones being knitted first: those are the ones a
   * needle is about to go onto.
   */
  private patternOptions(chosen: string): string {
    const order = (p: Pattern) => {
      const i = ["in-progress", "want-to-knit"].indexOf(p.status);
      return i < 0 ? 2 : i;
    };
    const groups = new Map<string, Pattern[]>();
    for (const p of [...this.patterns].sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title))) {
      const label = STATUSES.find((s) => s.value === p.status)?.label ?? "Other";
      groups.set(label, [...(groups.get(label) ?? []), p]);
    }
    return [...groups.entries()]
      .map(
        ([label, list]) => `
          <optgroup label="${escapeAttr(label)}">
            ${list.map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === chosen ? "selected" : ""}>${escapeHtml(p.title)}</option>`).join("")}
          </optgroup>`,
      )
      .join("");
  }

  private onChange = (e: Event): void => {
    const f = (e.target as HTMLElement).dataset.f;
    if (f === "kind" || f === "project") this.applyKind();
  };

  /** Shows the fields the chosen kind has, and the project name when asked for. */
  private applyKind(): void {
    const kind = this.value("kind");
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-show]")) {
      const what = el.dataset.show!;
      el.hidden = what === "other-project" ? this.value("project") !== OTHER : !HAS[what as keyof typeof HAS](kind);
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
    if (set) {
      preview.textContent = `A set: ${sizes.length} entries, ${sizes.join(", ")} mm, sharing the kind, length, brand, material and notes. Each is added free; put one on a project from its card, or from the pattern.`;
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
      cableSize: HAS.connector(kind) ? this.value("cableSize") : "",
      // The same word in another case files under the spelling already used.
      brand: canonical(this.value("brand"), this.brands),
      material: materialValue(canonical(this.value("material"), this.materials)),
      patternId: choice && choice !== OTHER ? choice : null,
      project: choice === OTHER ? this.value("projectName").trim() : "",
      notes: this.value("notes"),
    };
  }

  private async save(another: boolean): Promise<void> {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".modal-actions button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const set = this.isSet();
      // A set is added free: its sizes do not share a project (see previewSet).
      const input = set ? { ...this.input(), patternId: null, project: "" } : this.input();
      const { sizes, bad } = HAS.size(input.kind) ? parseSizes(this.value("sizeMm")) : { sizes: [0], bad: [] };
      if (bad.length) throw new Error(`“${bad[0]}” is not a size. Give sizes in millimetres, e.g. 4, or 2.5, 3, 3.5 for a set.`);
      if (!sizes.length) throw new Error("Give the size in millimetres, e.g. 4 or 3.75.");
      if (this.editing && sizes.length > 1) throw new Error("This changes one needle or hook, so give it one size. Add a set with + Add.");
      if (!set && choiceNeedsName(this.value("project"), input.project)) throw new Error("Name the project, or choose a pattern.");
      let saved: Tool;
      if (this.editing) {
        saved = await api.updateTool(this.editing.id, input);
      } else {
        // A set is one entry per size, sharing the rest but no project. Added
        // one at a time, in order, so a refusal partway names the size it
        // stopped at.
        saved = await api.addTool({ ...input, sizeMm: sizes[0] });
        for (const size of sizes.slice(1)) {
          try {
            saved = await api.addTool({ ...input, sizeMm: size });
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

const choiceNeedsName = (choice: string, name: string): boolean => choice === OTHER && !name;

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
