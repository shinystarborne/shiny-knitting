import type { Yarn, YarnLot } from "../api";

/** One yarn chosen for a project: which yarn, which lot, its saved entry if any, and how much it is expected to take. */
export interface ChosenYarn {
  id?: string | null;
  yarnId: string;
  lotId: string | null;
  /** Grams; null when not said. */
  plannedGrams?: number | null;
}

/**
 * What a lot (or a whole yarn) holds, as it is known: the grams weighed, or
 * the balls when they were never weighed. Never "0 g" for a lot not weighed.
 */
export function holds(grams: number, balls: number): string {
  if (grams > 0) return `${grams} g left`;
  if (balls > 0) return `${balls} ball${balls === 1 ? "" : "s"}, not weighed`;
  return "nothing weighed";
}

/** All of what there is, in grams: what was weighed, else the balls by the ball band. */
export function allOf(yarn: Yarn, lot: YarnLot | null): number {
  const grams = lot ? lot.gramsLeft : yarn.gramsLeft;
  const balls = lot ? lot.balls : yarn.ballsTotal;
  return grams > 0 ? grams : Math.round(balls * yarn.gramsPerBall);
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
  /** The yarns chosen, as the form holds them: the amounts are written into them. */
  private chosen: ChosenYarn[] = [];
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
    host.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="yarn-all"]');
      if (!btn) return;
      e.preventDefault();
      const i = Number(btn.dataset.index);
      const c = this.chosen[i];
      const yarn = this.yarns.find((y) => y.id === c?.yarnId);
      if (!c || !yarn) return;
      c.plannedGrams = allOf(yarn, yarn.lots.find((l) => l.id === c.lotId) ?? null) || null;
      this.paintPlan(i);
    });
    host.addEventListener("change", (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.el === "yarn-add") this.paintLots();
      if (el.dataset.el === "planned" || el.dataset.el === "planned-unit") return this.readPlan(Number(el.dataset.index));
      this.armUse();
    });
  }

  private select(name: string): HTMLSelectElement | null {
    return this.host.querySelector<HTMLSelectElement>(`[data-el="${name}"]`);
  }

  /** `self` is this project's own name, so "also on" does not name it. */
  render(yarns: Yarn[], chosen: ChosenYarn[], self: string): void {
    this.yarns = yarns;
    this.chosen = chosen;
    const name = (c: ChosenYarn) => {
      const y = yarns.find((x) => x.id === c.yarnId);
      if (!y) return "A yarn no longer in the stash";
      const lot = y.lots.find((l) => l.id === c.lotId);
      const colour = y.colourway ? ` · ${y.colourway}` : "";
      const lotText = lot && y.lots.length > 1 ? ` — lot ${lot.dyeLot || "without a dye lot"}` : "";
      const has = lot ? holds(lot.gramsLeft, lot.balls) : holds(y.gramsLeft, y.ballsTotal);
      return `${y.name}${colour}${lotText} (${has})`;
    };
    const others = (y: Yarn) => y.projects.filter((p) => p !== self);
    this.host.innerHTML = `
      ${
        chosen.length
          ? `<ul class="tool-list">${chosen
              .map(
                (c, i) => `
                <li class="yarn-chosen">
                  <span>${escapeHtml(name(c))}</span>
                  <button type="button" class="ghost" data-act="yarn-remove" data-index="${i}" title="Take it off this project">✕</button>
                  ${this.planHtml(c, i)}
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
                    return `<option value="${y.id}">${escapeHtml(`${y.name}${y.colourway ? ` · ${y.colourway}` : ""} (${holds(y.gramsLeft, y.ballsTotal)})${note}`)}</option>`;
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

  /** How much the project will take of a chosen yarn: grams, or balls by its ball band, or all of it. */
  private planHtml(c: ChosenYarn, i: number): string {
    const yarn = this.yarns.find((y) => y.id === c.yarnId);
    const perBall = yarn?.gramsPerBall ?? 0;
    return `
      <div class="yarn-plan">
        <span>Will take</span>
        <input data-el="planned" data-index="${i}" inputmode="decimal" value="${c.plannedGrams ?? ""}" placeholder="how much?" aria-label="How much it will take" />
        <select data-el="planned-unit" data-index="${i}" aria-label="In">
          <option value="g">g</option>
          ${perBall ? `<option value="balls">balls (${perBall} g)</option>` : ""}
        </select>
        ${yarn ? `<button type="button" class="ghost" data-act="yarn-all" data-index="${i}" title="All there is of it">All of it</button>` : ""}
        <em class="hint" data-el="planned-note" data-index="${i}">${this.planNote(c)}</em>
      </div>`;
  }

  private planNote(c: ChosenYarn): string {
    const yarn = this.yarns.find((y) => y.id === c.yarnId);
    if (!c.plannedGrams || !yarn) return "";
    const metres = yarn.metresPerBall && yarn.gramsPerBall ? ` ≈ ${Math.round((c.plannedGrams / yarn.gramsPerBall) * yarn.metresPerBall)} m` : "";
    const balls = yarn.gramsPerBall ? `, ${Math.round((c.plannedGrams / yarn.gramsPerBall) * 10) / 10} balls` : "";
    return `${c.plannedGrams} g${balls}${metres}`;
  }

  /** Reads an amount typed: grams as they are, balls by the ball band. */
  private readPlan(i: number): void {
    const c = this.chosen[i];
    const yarn = this.yarns.find((y) => y.id === c?.yarnId);
    if (!c) return;
    const input = this.host.querySelector<HTMLInputElement>(`[data-el="planned"][data-index="${i}"]`)!;
    const unit = this.host.querySelector<HTMLSelectElement>(`[data-el="planned-unit"][data-index="${i}"]`)!;
    const n = Number(input.value.trim().replace(",", "."));
    const grams = unit.value === "balls" && yarn?.gramsPerBall ? n * yarn.gramsPerBall : n;
    c.plannedGrams = Number.isFinite(grams) && grams > 0 ? Math.round(grams) : null;
    unit.value = "g";
    this.paintPlan(i);
  }

  /** Shows a chosen yarn's amount, in grams, with what that comes to. */
  private paintPlan(i: number): void {
    const c = this.chosen[i];
    const input = this.host.querySelector<HTMLInputElement>(`[data-el="planned"][data-index="${i}"]`);
    const note = this.host.querySelector<HTMLElement>(`[data-el="planned-note"][data-index="${i}"]`);
    if (input) input.value = c?.plannedGrams ? String(c.plannedGrams) : "";
    if (note && c) note.textContent = this.planNote(c);
  }

  /** Asks for the lot when the chosen yarn has more than one. */
  private paintLots(): void {
    const lotSelect = this.select("yarn-lot");
    if (!lotSelect) return;
    const yarn = this.yarns.find((y) => y.id === this.select("yarn-add")?.value);
    const lots = yarn?.lots ?? [];
    lotSelect.hidden = lots.length < 2;
    lotSelect.innerHTML = `<option value="">Which lot?</option>${lots
      .map((l) => `<option value="${l.id}">${escapeHtml(`${l.dyeLot || "No dye lot"} · ${holds(l.gramsLeft, l.balls)}${l.leftover ? " · leftover" : ""}`)}</option>`)
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
