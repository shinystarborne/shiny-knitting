import type { Tool } from "../api";
import { describe, isFree, projectName } from "./tool-filter";

/**
 * Choosing a project's needles and hooks: the ones on it, each with ✕, and a
 * list to add from with a Use button.
 *
 * Shared by the reader's side pane, which saves at once, and the pattern's
 * details form, which saves with the form; the two only differ in what
 * `onAdd` and `onRemove` do.
 *
 * The list offers free tools first, then the ones on another project, since a
 * needle often moves from one project to the next; choosing one of those
 * moves it. Choosing only arms Use, rather than putting the tool on at once:
 * arrowing through a closed list changes it at every step, so each key press
 * would put another needle on the project.
 */
export class ToolPicker {
  private host: HTMLElement;
  private onAdd: (id: string) => void;
  private onRemove: (id: string) => void;

  constructor(host: HTMLElement, onAdd: (id: string) => void, onRemove: (id: string) => void) {
    this.host = host;
    this.onAdd = onAdd;
    this.onRemove = onRemove;
    host.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!btn || !host.contains(btn)) return;
      if (btn.dataset.act === "tool-free") {
        e.preventDefault();
        this.onRemove(btn.dataset.id!);
      }
      if (btn.dataset.act === "tool-use") {
        e.preventDefault();
        const select = host.querySelector<HTMLSelectElement>('[data-el="tool-add"]');
        if (select?.value) this.onAdd(select.value);
      }
    });
    host.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      if (select.dataset.el !== "tool-add") return;
      const use = host.querySelector<HTMLButtonElement>('[data-act="tool-use"]');
      if (use) use.disabled = !select.value;
    });
  }

  /**
   * `chosen` are the tools on this project. The rest are offered as free or as
   * on another project by their own `patternId` and `project`, so a caller
   * that has not saved yet passes copies showing what they will be.
   */
  render(tools: Tool[], chosen: Set<string>, emptyHint: string): void {
    const mine = tools.filter((t) => chosen.has(t.id));
    const rest = tools.filter((t) => !chosen.has(t.id));
    const free = rest.filter(isFree);
    const elsewhere = rest.filter((t) => !isFree(t));
    const option = (t: Tool, note = "") =>
      `<option value="${t.id}">${escapeHtml(describe(t))}${note ? ` — ${escapeHtml(note)}` : ""}</option>`;
    this.host.innerHTML = `
      ${
        mine.length
          ? `<ul class="tool-list">${mine
              .map(
                (t) => `
                <li>
                  <span>${escapeHtml(describe(t))}</span>
                  <button type="button" class="ghost" data-act="tool-free" data-id="${t.id}"
                    title="Take it off this project; it goes back to free">✕</button>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="hint">${emptyHint}</p>`
      }
      ${
        rest.length
          ? `<div class="tool-add">
              <select data-el="tool-add" aria-label="A needle or hook to use on this project">
                <option value="">Choose a needle or hook…</option>
                ${free.length ? `<optgroup label="Free">${free.map((t) => option(t)).join("")}</optgroup>` : ""}
                ${
                  elsewhere.length
                    ? `<optgroup label="On another project — moves it here">${elsewhere
                        .map((t) => option(t, `on ${projectName(t)}`))
                        .join("")}</optgroup>`
                    : ""
                }
              </select>
              <button type="button" class="ghost" data-act="tool-use" disabled title="Use it on this project">Use</button>
            </div>`
          : `<p class="hint">${tools.length ? "Every needle and hook you have is on this project." : "Add your needles and hooks in the Needles &amp; hooks tab."}</p>`
      }
    `;
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
