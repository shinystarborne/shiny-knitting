import { api, type Tool } from "../api";
import { say } from "../dialogs";
import { describe, isFree } from "../views/tool-filter";

/**
 * The pattern's needles and hooks, in the reader's side pane.
 *
 * Starting a project is when needles get picked out of the box, and that
 * happens with the pattern open, so this is where a free tool can be put on
 * it -- and taken off again when the needles move to something else.
 */
export class ToolPanel {
  private root: HTMLElement;
  private patternId: string;
  private tools: Tool[] = [];

  constructor(root: HTMLElement, patternId: string) {
    this.root = root;
    this.patternId = patternId;
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
  }

  async refresh(): Promise<void> {
    try {
      this.tools = await api.listTools();
    } catch {
      this.tools = [];
    }
    this.render();
  }

  private render(): void {
    const mine = this.tools.filter((t) => t.patternId === this.patternId);
    const free = this.tools.filter(isFree);
    this.root.innerHTML = `
      <h3>Needles &amp; hooks</h3>
      ${
        mine.length
          ? `<ul class="tool-list">${mine
              .map(
                (t) => `
                <li>
                  <span>${escapeHtml(describe(t))}</span>
                  <button class="ghost" data-act="tool-free" data-id="${t.id}" title="Take it off this pattern; it goes back to free">✕</button>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="hint">None on this pattern yet.</p>`
      }
      ${
        free.length
          ? `<div class="tool-add">
              <select data-el="tool-add" aria-label="A free needle or hook to put on this pattern">
                <option value="">Choose a free needle or hook…</option>
                ${free.map((t) => `<option value="${t.id}">${escapeHtml(describe(t))}</option>`).join("")}
              </select>
              <button class="ghost" data-act="tool-use" disabled title="Put it on this pattern">Use</button>
            </div>`
          : `<p class="hint">${this.tools.length ? "Everything in your box is in use." : "Add your needles and hooks in the Needles &amp; hooks tab."}</p>`
      }
    `;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (btn?.dataset.act === "tool-free") await this.assign(btn.dataset.id!, null);
    if (btn?.dataset.act === "tool-use") {
      const select = this.root.querySelector<HTMLSelectElement>('[data-el="tool-add"]');
      if (select?.value) await this.assign(select.value, this.patternId);
    }
  }

  /**
   * Choosing only arms Use. Putting the tool on at once would misfire from the
   * keyboard: arrowing through a closed list changes it at every step, so each
   * press would put another needle on the pattern.
   */
  private onChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    if (select.dataset.el !== "tool-add") return;
    const use = this.root.querySelector<HTMLButtonElement>('[data-act="tool-use"]');
    if (use) use.disabled = !select.value;
  }

  private async assign(id: string, patternId: string | null): Promise<void> {
    try {
      await api.setToolProject(id, patternId);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Needles & hooks");
    }
    await this.refresh();
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
