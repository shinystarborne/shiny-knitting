import { api, type Tool, type ToolSet } from "../api";
import { askYesNo } from "../dialogs";
import { clickedOn, closestEl } from "../dom";
import { money, parsePrice } from "./money";
import { describe, kindLabel } from "./tool-filter";

/**
 * The sets needles and hooks came in: each with a name, one price for all of
 * it, and its pieces chosen from what is in the box. A set added from the
 * needle form (several sizes at once) is one already; one bought before that
 * is made here, its pieces ticked.
 *
 * Two views in one dialog: the list of sets, and one set being made or
 * changed.
 */
export class ToolSetsDialog {
  private root: HTMLElement;
  private onDone: () => void;
  private sets: ToolSet[] = [];
  private tools: Tool[] = [];
  private currency = "EUR";
  /** The set being made or changed: null is the list; an empty id a new one. */
  private editing: { id: string; name: string; price: string; picked: Set<string> } | null = null;
  private changed = false;

  constructor(root: HTMLElement, onDone: () => void) {
    this.root = root;
    this.onDone = onDone;
  }

  async open(): Promise<void> {
    await this.load();
    this.root.className = "modal-backdrop";
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("change", this.onChange);
    this.draw();
  }

  private async load(): Promise<void> {
    [this.sets, this.tools, this.currency] = await Promise.all([
      api.listToolSets(),
      api.listTools(),
      api.getCurrency().catch(() => "EUR"),
    ]);
  }

  private draw(): void {
    this.root.innerHTML = `
      <div class="modal modal-wide tool-sets" role="dialog" aria-modal="true">
        ${this.editing ? this.setHtml() : this.listHtml()}
        <p class="form-error" data-el="error" hidden></p>
      </div>`;
    this.root.querySelector<HTMLInputElement>('[data-f="set-name"]')?.focus();
  }

  private listHtml(): string {
    const rows = this.sets
      .map((s) => {
        const pieces = s.toolIds.length;
        return `
          <li class="tool-set-row" data-set="${s.id}">
            <div>
              <b>${esc(s.name)}</b>
              <span class="hint">${pieces ? `${pieces} piece${pieces === 1 ? "" : "s"}` : "No pieces now"}</span>
            </div>
            <span class="tool-set-price">${s.price != null ? money(s.price, this.currency) : `<span class="hint">No price</span>`}</span>
            <button class="ghost" data-act="edit-set" data-id="${s.id}">Change</button>
            <button class="ghost" data-act="remove-set" data-id="${s.id}" title="Removes the set; its pieces stay">Remove</button>
          </li>`;
      })
      .join("");
    return `
      <h2>Sets</h2>
      <p class="modal-intro">Needles and hooks bought together for one price. Each piece is listed in Needles &amp; hooks; the set holds the price. Several sizes added at once already form a set.</p>
      ${this.sets.length ? `<ul class="tool-set-list">${rows}</ul>` : `<p class="hint">No sets yet.</p>`}
      <div class="modal-actions">
        <button class="ghost" data-act="new-set">+ New set</button>
        <button class="primary" data-act="close">Done</button>
      </div>`;
  }

  private setHtml(): string {
    const e = this.editing!;
    const owner = (t: Tool) => (t.setId && t.setId !== e.id ? this.sets.find((s) => s.id === t.setId)?.name : undefined);
    // By kind, then size, as a box is sorted.
    const kinds = [...new Set(this.tools.map((t) => t.kind))];
    const groups = kinds
      .map((kind) => {
        const of = this.tools.filter((t) => t.kind === kind);
        return `
          <fieldset class="tool-set-kind">
            <legend>${esc(kindLabel(kind))}</legend>
            ${of
              .map((t) => {
                const other = owner(t);
                return `
                  <label class="check">
                    <input type="checkbox" data-piece="${t.id}" ${e.picked.has(t.id) ? "checked" : ""} />
                    <span>${esc(describe(t))}</span>
                    ${other ? `<em class="hint">in ${esc(other)}</em>` : t.price != null ? `<em class="hint">${money(t.price, this.currency)} alone</em>` : ""}
                  </label>`;
              })
              .join("")}
          </fieldset>`;
      })
      .join("");
    return `
      <h2>${e.id ? "Edit set" : "New set"}</h2>
      <div class="field-row">
        <label class="field"><span>Name</span><input data-f="set-name" value="${esc(e.name)}" placeholder="e.g. ChiaoGoo Twist Lace Complete" maxlength="120" /></label>
        <label class="field tool-price"><span>Price of the set</span><input data-f="set-price" inputmode="decimal" value="${esc(e.price)}" placeholder="e.g. 120" /></label>
      </div>
      <div class="field">
        <span>Its pieces <em class="hint" data-el="picked">${this.pickedText()}</em></span>
        <p class="hint">A piece moved from another set leaves that set. While in a set, a piece's own price is not counted.</p>
        <div class="tool-set-pieces">${this.tools.length ? groups : `<p class="hint">Nothing in Needles &amp; hooks yet.</p>`}</div>
      </div>
      <div class="modal-actions">
        <button class="ghost" data-act="back">Back</button>
        <button class="primary" data-act="save-set">${e.id ? "Save the set" : "Add the set"}</button>
      </div>`;
  }

  private pickedText(): string {
    const n = this.editing?.picked.size ?? 0;
    return n ? `${n} chosen` : "none chosen";
  }

  private onChange = (ev: Event): void => {
    const box = ev.target as HTMLInputElement;
    const id = box.dataset.piece;
    if (!id || !this.editing) return;
    if (box.checked) this.editing.picked.add(id);
    else this.editing.picked.delete(id);
    const said = this.root.querySelector('[data-el="picked"]');
    if (said) said.textContent = this.pickedText();
  };

  private onClick = (ev: MouseEvent): void => {
    if (clickedOn(ev, this.root)) return void this.close();
    const btn = closestEl(ev.target, "button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") this.close();
    if (act === "new-set") this.edit(null);
    if (act === "edit-set") this.edit(this.sets.find((s) => s.id === btn.dataset.id) ?? null);
    if (act === "back") {
      this.editing = null;
      this.draw();
    }
    if (act === "save-set") void this.save();
    if (act === "remove-set") void this.remove(btn.dataset.id!);
  };

  private edit(set: ToolSet | null): void {
    this.editing = set
      ? { id: set.id, name: set.name, price: set.price != null ? String(set.price) : "", picked: new Set(set.toolIds) }
      : { id: "", name: "", price: "", picked: new Set() };
    this.draw();
  }

  private async save(): Promise<void> {
    const e = this.editing!;
    const typed = this.root.querySelector<HTMLInputElement>('[data-f="set-price"]')!.value.trim();
    const price = typed ? parsePrice(typed) : null;
    try {
      if (typed && price === null) throw new Error("Price must be a number, like 120 or 119,90.");
      await api.saveToolSet({ id: e.id || null, name: this.root.querySelector<HTMLInputElement>('[data-f="set-name"]')!.value, price, toolIds: [...e.picked] });
      this.changed = true;
      this.editing = null;
      await this.load();
      this.draw();
    } catch (err) {
      this.showError(err);
    }
  }

  private async remove(id: string): Promise<void> {
    const set = this.sets.find((s) => s.id === id);
    if (!set) return;
    const ok = await askYesNo(`Remove the set “${set.name}”?\n\nIts pieces stay in Needles & hooks, without a set, and the set price is removed.`, {
      title: "Remove a set",
      okLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteToolSet(id);
      this.changed = true;
      await this.load();
      this.draw();
    } catch (err) {
      this.showError(err);
    }
  }

  private showError(err: unknown): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="error"]');
    if (!el) return;
    el.textContent = err instanceof Error ? err.message : String(err);
    el.hidden = false;
  }

  private close(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
    if (this.changed) this.onDone();
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
