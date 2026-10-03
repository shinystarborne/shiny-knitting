import { api, type Shop, type ShopInput } from "../api";
import { closestEl } from "../dom";
import { makeCombo } from "./combo";

/** Tags offered on a new shop's form before any shop has any. */
const STARTER_TAGS = ["yarn", "needles", "patterns", "deadstock", "sale", "local", "secondhand"];

/**
 * The add/edit dialog for a shop: its name, its web address, its tags, and
 * what you think of it. Only one of the name and the address is needed; a
 * shop given only its address is named after it.
 */
export class ShopForm {
  private root: HTMLElement;
  private editing: Shop | null;
  private onDone: (shop: Shop) => void;
  private tags: string[];
  /** The tags other shops have, offered as the tag field is typed in. */
  private known: string[];

  constructor(root: HTMLElement, editing: Shop | null, onDone: (shop: Shop) => void, known: string[] = []) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    this.tags = [...(editing?.tags ?? [])];
    this.known = known.length ? known : STARTER_TAGS;
  }

  open(): void {
    const e = this.editing;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal shop-form" role="dialog" aria-modal="true">
        <h2>${e ? "Edit shop" : "Add a shop"}</h2>
        <div class="field-row">
          <label class="field">
            <span>Name</span>
            <input data-f="name" value="${escapeAttr(e?.name ?? "")}" placeholder="e.g. Wolle Rödel" />
          </label>
          <label class="field">
            <span>Web address</span>
            <input data-f="url" value="${escapeAttr(e?.url ?? "")}" placeholder="e.g. drops.com" autocomplete="off" spellcheck="false" />
          </label>
        </div>
        <div class="field">
          <span>Tags</span>
          <div class="tag-editor">
            <div class="tag-list" data-el="tags"></div>
            <input data-el="tag-input" aria-label="Add a tag" placeholder="Add a tag and press Enter: yarn, deadstock, sale…" />
          </div>
        </div>
        <label class="field">
          <span>Comment</span>
          <textarea data-f="comment" rows="5" placeholder="What it is good for: Drops is cheapest here, great prices on deadstock, slow to ship…">${escapeHtml(e?.comment ?? "")}</textarea>
          <span class="hint">The Shops tab's search looks through comments and tags, so a word here finds the shop again.</span>
        </label>
        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">${e ? "Save changes" : "Add"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("keydown", this.onKey);
    const tagInput = this.tagInput();
    makeCombo(tagInput, () => this.known.filter((k) => !this.tags.some((t) => t.toLowerCase() === k.toLowerCase())));
    // A comma ends a tag, and so does picking one from the list.
    tagInput.addEventListener("input", () => {
      if (tagInput.value.includes(",")) this.takeTags();
    });
    tagInput.addEventListener("change", () => this.takeTags());
    this.paintTags();
    this.root.querySelector<HTMLInputElement>('[data-f="name"]')?.focus();
  }

  private tagInput(): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>('[data-el="tag-input"]')!;
  }

  /** Adds what is typed in the tag field; one already there, in any case, is not added twice. */
  private takeTags(): void {
    const input = this.tagInput();
    for (const part of input.value.split(",")) {
      const tag = part.trim().replace(/^#/, "");
      if (tag && !this.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        // A tag another shop has keeps the spelling it has there.
        this.tags.push(this.known.find((k) => k.toLowerCase() === tag.toLowerCase()) ?? tag);
      }
    }
    input.value = "";
    this.paintTags();
  }

  private paintTags(): void {
    this.root.querySelector<HTMLElement>('[data-el="tags"]')!.innerHTML = this.tags
      .map((t, i) => `<span class="tag">${escapeHtml(t)}<button type="button" data-act="remove-tag" data-i="${i}" aria-label="Remove ${escapeAttr(t)}">×</button></span>`)
      .join("");
  }

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) return this.close();
    const btn = closestEl(e.target, "button[data-act]");
    const act = btn?.dataset.act;
    if (act === "cancel") this.close();
    if (act === "save") void this.save();
    if (act === "remove-tag") {
      this.tags.splice(Number(btn!.dataset.i), 1);
      this.paintTags();
      this.tagInput().focus();
    }
  };

  /**
   * Enter in the tag field adds the tag (or saves, when it is empty);
   * Backspace in an empty one takes the last tag off. Enter elsewhere saves.
   */
  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (target.dataset.el === "tag-input") {
      const input = target as HTMLInputElement;
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        this.takeTags();
        return;
      }
      if (e.key === "Backspace" && !input.value && this.tags.length) {
        this.tags.pop();
        this.paintTags();
        return;
      }
    }
    if (e.key === "Enter" && target.tagName === "INPUT" && !e.defaultPrevented) {
      e.preventDefault();
      void this.save();
    }
  };

  private value(name: string): string {
    return this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f="${name}"]`)?.value ?? "";
  }

  private async save(): Promise<void> {
    // A tag typed but not yet added is meant.
    this.takeTags();
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="save"]');
    if (button) button.disabled = true;
    const input: ShopInput = { name: this.value("name"), url: this.value("url"), comment: this.value("comment"), tags: this.tags };
    try {
      const saved = this.editing ? await api.updateShop(this.editing.id, input) : await api.addShop(input);
      this.close();
      this.onDone(saved);
    } catch (err) {
      const el = this.root.querySelector<HTMLElement>('[data-el="error"]');
      if (el) {
        el.textContent = err instanceof Error ? err.message : String(err);
        el.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  private close(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("keydown", this.onKey);
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
