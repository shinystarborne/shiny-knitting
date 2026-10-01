import type { Yarn } from "../api";

/** One yarn chosen for a project: which yarn, which lot, and its saved entry if any. */
export interface ChosenYarn {
  id?: string | null;
  yarnId: string;
  lotId: string | null;
}

/**
 * Choosing a project's yarn from the stash: the ones on it, each with ✕, and
 * a list to add from. A yarn bought more than once has a lot for each dye lot,
 * and the lot asked for is the one the project is knitted from -- dye lots
 * differ, and the leftover goes back to that lot -- so its lot is chosen too.
 *
 * Choosing only arms Use, as with the needle picker, so arrowing through the
 * list does not add a yarn per key press.
 */
export class YarnPicker {
  private host: HTMLElement;
  private yarns: Yarn[] = [];
  private onAdd: (yarn: ChosenYarn) => void;
  private onRemove: (index: number) => void;

  constructor(host: HTMLElement, onAdd: (yarn: ChosenYarn) => void, onRemove: (index: number) => void) {
    this.host = host;
    this.onAdd = onAdd;
    this.onRemove = onRemove;
    host.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!btn || !host.contains(btn)) return;
      if (btn.dataset.act === "yarn-remove") {
        e.preventDefault();
        this.onRemove(Number(btn.dataset.index));
      }
      if (btn.dataset.act === "yarn-use") {
        e.preventDefault();
        const yarnId = this.select("yarn-add")?.value;
        if (!yarnId) return;
        const lots = this.yarns.find((y) => y.id === yarnId)?.lots ?? [];
        const lotId = lots.length > 1 ? this.select("yarn-lot")?.value || null : (lots[0]?.id ?? null);
        this.onAdd({ yarnId, lotId });
      }
    });
    host.addEventListener("change", (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.el === "yarn-add") this.paintLots();
      this.armUse();
    });
  }

  private select(name: string): HTMLSelectElement | null {
    return this.host.querySelector<HTMLSelectElement>(`[data-el="${name}"]`);
  }

  /** `self` is this project's own name, so "also on" does not name it. */
  render(yarns: Yarn[], chosen: ChosenYarn[], self: string): void {
    this.yarns = yarns;
    const name = (c: ChosenYarn) => {
      const y = yarns.find((x) => x.id === c.yarnId);
      if (!y) return "A yarn no longer in the stash";
      const lot = y.lots.find((l) => l.id === c.lotId);
      const colour = y.colourway ? ` · ${y.colourway}` : "";
      const lotText = lot && y.lots.length > 1 ? ` — lot ${lot.dyeLot || "without a dye lot"}` : "";
      const grams = lot ? ` (${lot.gramsLeft} g)` : y.gramsLeft ? ` (${y.gramsLeft} g)` : "";
      return `${y.name}${colour}${lotText}${grams}`;
    };
    const others = (y: Yarn) => y.projects.filter((p) => p !== self);
    this.host.innerHTML = `
      ${
        chosen.length
          ? `<ul class="tool-list">${chosen
              .map(
                (c, i) => `
                <li>
                  <span>${escapeHtml(name(c))}</span>
                  <button type="button" class="ghost" data-act="yarn-remove" data-index="${i}" title="Take it off this project">✕</button>
                </li>`,
              )
              .join("")}</ul>`
          : `<p class="hint">No yarn chosen yet.</p>`
      }
      ${
        yarns.length
          ? `<div class="tool-add">
              <select data-el="yarn-add" aria-label="A yarn from the stash">
                <option value="">Choose a yarn from the stash…</option>
                ${yarns
                  .map((y) => {
                    const also = others(y);
                    const note = also.length ? ` — also on ${also.join(", ")}` : "";
                    return `<option value="${y.id}">${escapeHtml(`${y.name}${y.colourway ? ` · ${y.colourway}` : ""}${note}`)}</option>`;
                  })
                  .join("")}
              </select>
              <select data-el="yarn-lot" aria-label="Which lot" hidden></select>
              <button type="button" class="ghost" data-act="yarn-use" disabled title="Use it on this project">Use</button>
            </div>`
          : `<p class="hint">Add your yarn in the Stash tab.</p>`
      }
    `;
  }

  /** Asks for the lot when the chosen yarn has more than one. */
  private paintLots(): void {
    const lotSelect = this.select("yarn-lot");
    if (!lotSelect) return;
    const yarn = this.yarns.find((y) => y.id === this.select("yarn-add")?.value);
    const lots = yarn?.lots ?? [];
    lotSelect.hidden = lots.length < 2;
    lotSelect.innerHTML = `<option value="">Which lot?</option>${lots
      .map((l) => `<option value="${l.id}">${escapeHtml(`${l.dyeLot || "No dye lot"} · ${l.gramsLeft} g${l.leftover ? " · leftover" : ""}`)}</option>`)
      .join("")}`;
  }

  private armUse(): void {
    const use = this.host.querySelector<HTMLButtonElement>('[data-act="yarn-use"]');
    if (!use) return;
    const yarn = this.yarns.find((y) => y.id === this.select("yarn-add")?.value);
    const needsLot = (yarn?.lots.length ?? 0) > 1;
    use.disabled = !yarn || (needsLot && !this.select("yarn-lot")?.value);
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
