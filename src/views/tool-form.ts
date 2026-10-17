import {
  api,
  isLive,
  CABLE_SIZES,
  CONNECTORS,
  TOOL_KINDS,
  type Project,
  type Tool,
  type ToolInput,
  type ToolKind,
} from "../api";
import { clickedOn, closestEl } from "../dom";
import { makeCombo } from "./combo";
import { parsePrice } from "./money";
import {
  canonical,
  connectorFor,
  connectorOfBrand,
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
  size: (k: string) => k !== "cable" && k !== "adapter",
  length: (k: string) => ["straight", "dpn", "tips", "hook"].includes(k),
  cable: (k: string) => k === "circular" || k === "cable",
  connector: (k: string) => k === "tips" || k === "cable" || k === "adapter",
  adapter: (k: string) => k === "adapter",
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

/** A set of each kind, as its name says it: "ChiaoGoo interchangeable tips, 2.75–5 mm". */
const SET_WORDS: Record<string, string> = {
  straight: "straight needles",
  circular: "circular needles",
  dpn: "double-pointed needles",
  tips: "interchangeable tips",
  cable: "cables",
  hook: "crochet hooks",
  adapter: "adapters",
};

/** The name a set added from the form starts with: its brand, kind and sizes. */
export function setName(brand: string, kind: string, sizes: number[]): string {
  const what = `${brand.trim() ? `${brand.trim()} ` : ""}${SET_WORDS[kind] ?? kind}`;
  const span = sizes.length ? `, ${Math.min(...sizes)}–${Math.max(...sizes)} mm` : "";
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${span}`;
}

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
  /** Everything in the box, for a price the same brand and kind already has. */
  private tools: Tool[] = [];
  /** A set's connector changes, while "Changes with size…" is chosen. */
  private steps: ConnectorStep[] = [];

  /** What a new tool got from the wishlist starts with. */
  private start: Partial<ToolInput> | null;

  constructor(root: HTMLElement, editing: Tool | null, onDone: (tool: Tool) => void, start: Partial<ToolInput> | null = null) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    this.start = editing ? null : start;
  }

  async open(): Promise<void> {
    const [projects, tools] = await Promise.all([
      api.listProjects().catch(() => [] as Project[]),
      api.listTools().catch(() => [] as Tool[]),
    ]);
    this.projects = projects.filter((p) => isLive(p.status));
    this.tools = tools;
    this.brands = knownBrands(tools);
    this.materials = knownMaterials(tools);

    const e = this.editing;
    // What the fields show: the tool being edited, or what the wishlist said.
    const v: Partial<ToolInput> | null = e ?? this.start;
    const kind: ToolKind = v?.kind ?? "circular";
    const projectChoice = e?.projectId ?? FREE;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal tool-form" role="dialog" aria-modal="true">
        <h2>${e ? "Edit needle or hook" : this.start ? "Add a needle or hook, from the wishlist" : "Add a needle or hook"}</h2>

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
              value="${v?.sizeMm ? v.sizeMm : ""}" placeholder="${e ? "e.g. 4 or 3.75" : "4, or a set: 3, 3.5, 4"}" />
          </label>
          <label class="field" data-show="length">
            <span data-el="length-label">${LENGTH_LABEL[kind] ?? "Length (cm)"}</span>
            <input data-f="lengthCm" type="number" min="0" step="0.5" list="tool-lengths"
              value="${v?.lengthCm ? v.lengthCm : ""}" placeholder="e.g. 20" />
          </label>
          <label class="field" data-show="cable">
            <span>Cable length (cm)</span>
            <input data-f="cableCm" type="number" min="0" step="1" list="tool-cables"
              value="${v?.cableCm ? v.cableCm : ""}" placeholder="e.g. 80" />
          </label>
          <label class="field" data-show="connector">
            <span data-el="size-label">Cable size</span>
            <select data-f="cableSize">
              <option value="">Not sure</option>
              ${CABLE_SIZES.map((c) => `<option value="${c.key}" ${v?.cableSize === c.key ? "selected" : ""}>${c.label}</option>`).join("")}
              <option value="${SPLIT}" data-el="split-option" hidden>Changes with size…</option>
            </select>
          </label>
          <label class="field" data-show="adapter" title="The size of cable the tips go on, through the adapter">
            <span>Cable end</span>
            <select data-f="adapterTo">
              <option value="">Not sure</option>
              ${CABLE_SIZES.map((c) => `<option value="${c.key}" ${v?.adapterTo === c.key ? "selected" : ""}>${c.label}</option>`).join("")}
            </select>
          </label>
          <label class="field" data-show="connector" title="The maker whose tips and cables these fit: ChiaoGoo's fit Lotus Yarns', not KnitPro's">
            <span>System</span>
            <select data-f="connector">
              <option value="">Not sure</option>
              ${CONNECTORS.map((c) => `<option value="${c.key}" ${(v?.connector || connectorOfBrand(v?.brand ?? "")) === c.key ? "selected" : ""}>${c.label}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="hint" data-el="kind-hint"></p>
        <div class="connector-steps" data-el="connector-steps" hidden></div>
        <p class="hint set-preview" data-el="set-preview" hidden></p>

        <div class="field-row">
          <div class="field">
            <span>Brand</span>
            <input data-f="brand" aria-label="Brand" value="${escapeAttr(v?.brand ?? "")}" placeholder="Type, or pick one you have" />
          </div>
          <div class="field">
            <span>Material</span>
            <input data-f="material" aria-label="Material" value="${escapeAttr(v?.material ? materialLabel(v.material) : "")}"
              placeholder="Type, or pick: metal, bamboo…" />
          </div>
        </div>

        ${
          e?.setId
            ? `<p class="hint tool-in-set" data-el="in-set">Part of the set <b>${escapeHtml(e.setName ?? "")}</b>: the set has the price, under <em>Sets</em>.</p>`
            : `<div class="field-row">
          <label class="field tool-price">
            <span data-el="price-label">Price</span>
            <input data-f="price" inputmode="decimal" value="${v?.price != null ? escapeAttr(String(v.price)) : ""}" placeholder="e.g. 12,50" />
            <em class="hint" data-el="price-hint" hidden></em>
          </label>
        </div>`
        }

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
          <textarea data-f="notes" placeholder="Anything worth remembering: a bent tip, part of a set…">${escapeHtml(v?.notes ?? "")}</textarea>
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
    // A price typed is the one: no other tool's replaces it.
    this.root.querySelector<HTMLElement>('[data-f="price"]')?.addEventListener("input", (ev) => {
      delete (ev.target as HTMLElement).dataset.kin;
      this.root.querySelector<HTMLElement>('[data-el="price-hint"]')!.hidden = true;
    });
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
    // The brand says the system, until one is chosen.
    if (f === "brand") {
      const system = this.root.querySelector<HTMLSelectElement>('[data-f="connector"]');
      const said = connectorOfBrand(this.value("brand"));
      if (system && !system.value && said) system.value = said;
    }
    if (f === "brand" || f === "kind") this.priceFromKin();
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
    // An adapter's connector size is the end its tips go in.
    const sizeLabel = this.root.querySelector('[data-el="size-label"]');
    if (sizeLabel) sizeLabel.textContent = kind === "adapter" ? "Tip end" : "Cable size";
    const hint = this.root.querySelector('[data-el="kind-hint"]') as HTMLElement;
    hint.textContent =
      kind === "circular"
        ? "Cable length as sold: an 80 cm circular is 80 cm from tip to tip."
        : kind === "tips" || kind === "cable"
          ? "The system and the cable size are the connector: tips and a cable fit when both are the same."
          : kind === "adapter"
            ? "Tips of the tip end's size go on a cable of the cable end's: large tips on a small cable, for a bigger needle on one end."
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
      preview.textContent = `A set: ${sizes.length} entries, ${sizes.join(", ")} mm, sharing the kind, length, brand, material and notes, kept together as a set with one price.${connectors} Each is added free; put one on a project from its card, or from the pattern.`;
    }
    const projectRow = this.root.querySelector<HTMLElement>('[data-el="project-row"]');
    if (projectRow) projectRow.hidden = set;
    // A set has one price, for all of it.
    const priceLabel = this.root.querySelector<HTMLElement>('[data-el="price-label"]');
    if (priceLabel) priceLabel.textContent = set ? `Price of the set of ${sizes.length}` : "Price";
    // One needle's price, from another like it, is not a set's.
    const priceInput = this.root.querySelector<HTMLInputElement>('[data-f="price"]');
    if (set && priceInput?.dataset.kin) {
      priceInput.value = "";
      delete priceInput.dataset.kin;
      this.root.querySelector<HTMLElement>('[data-el="price-hint"]')!.hidden = true;
    }
    if (!this.editing) add.textContent = set ? `Add ${sizes.length}` : "Add";
  }

  /**
   * A price, while none is typed, from another of the same brand and kind
   * bought alone: the same brand's tips cost the same, whatever the size.
   */
  private priceFromKin(): void {
    const input = this.root.querySelector<HTMLInputElement>('[data-f="price"]');
    const hint = this.root.querySelector<HTMLElement>('[data-el="price-hint"]');
    if (!input || !hint || this.editing || this.isSet() || (input.value.trim() && !input.dataset.kin)) return;
    const brand = this.value("brand").trim().toLowerCase();
    const kind = this.value("kind");
    const kin = brand
      ? this.tools.filter((t) => t.price != null && !t.setId && t.kind === kind && t.brand.trim().toLowerCase() === brand).sort((a, b) => b.addedAt - a.addedAt)[0]
      : undefined;
    input.value = kin ? String(kin.price) : "";
    if (kin) input.dataset.kin = "1";
    else delete input.dataset.kin;
    hint.textContent = kin ? `As your other ${kin.brand} ${(SET_WORDS[kind] ?? kind)} cost.` : "";
    hint.hidden = !kin;
  }

  /** Whether several sizes are typed for a new tool, which makes it a set. */
  private isSet(): boolean {
    return !this.editing && HAS.size(this.value("kind")) && parseSizes(this.value("sizeMm")).sizes.length > 1;
  }

  private onClick = (e: MouseEvent): void => {
    if (clickedOn(e, this.root)) {
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
    const typed = this.value("price").trim();
    const price = typed ? parsePrice(typed) : null;
    if (typed && price === null) throw new Error("The price is a number: 12,50 or 12.50.");
    return {
      kind,
      // A piece of a set keeps what it had: the set has the price.
      price: this.editing?.setId ? (this.editing.price ?? null) : price,
      // The first size; a set's others are added by save() from the same input.
      sizeMm: HAS.size(kind) ? (parseSizes(this.value("sizeMm")).sizes[0] ?? 0) : 0,
      lengthCm: HAS.length(kind) ? num(this.value("lengthCm")) : 0,
      cableCm: HAS.cable(kind) ? num(this.value("cableCm")) : 0,
      // "Changes with size…" is not a size; save() gives each size its own.
      cableSize: HAS.connector(kind) && this.value("cableSize") !== SPLIT ? this.value("cableSize") : "",
      connector: HAS.connector(kind) ? this.value("connector") : "",
      adapterTo: HAS.adapter(kind) ? this.value("adapterTo") : "",
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
      // Its price is the set's, not each piece's.
      const typed = this.input();
      const input = set ? { ...typed, projectId: null, price: null } : typed;
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
        const added = [saved.id];
        for (const size of sizes.slice(1)) {
          try {
            saved = await api.addTool(one(size));
            added.push(saved.id);
          } catch (err) {
            this.onDone(saved);
            throw new Error(`Added up to ${saved.sizeMm} mm, then stopped at ${size} mm: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Kept together, as bought: one set, its price the one typed.
        if (set) await api.saveToolSet({ name: setName(input.brand, input.kind, sizes), price: typed.price ?? null, toolIds: added });
      }
      const what = saved.kind === "cable" ? "the cable" : saved.kind === "adapter" ? "the adapter" : sizes.length > 1 ? `${sizes.length}: ${sizes.join(", ")} mm` : `the ${saved.sizeMm} mm`;
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
