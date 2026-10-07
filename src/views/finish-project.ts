import { api, type Pattern, type Project, type Tool, type Yarn } from "../api";
import { closestEl } from "../dom";
import { fromDateInput, toDateInput } from "./project-form";
import { describe } from "./tool-filter";
import { allOf } from "./yarn-picker";

/**
 * Finishing a project: its needles, hooks and cables go back to free, and
 * each yarn's use is said -- in grams or balls used, or the grams left -- so
 * what is left goes back into the stash, as a leftover, or used up at 0 g.
 * Optionally the pattern is marked Finished too.
 */
export class FinishProjectDialog {
  private root: HTMLElement;
  private project: Project;
  private onDone: (project: Project) => void;
  private pattern: Pattern | null = null;
  /** Per yarn on the project: what it held before, when known, and its grams per ball. */
  private held = new Map<string, { before: number | null; text: string; perBall: number }>();

  constructor(root: HTMLElement, project: Project, onDone: (project: Project) => void) {
    this.root = root;
    this.project = project;
    this.onDone = onDone;
  }

  async open(): Promise<void> {
    const p = this.project;
    const [tools, yarns, pattern] = await Promise.all([
      api.listTools().catch(() => [] as Tool[]),
      api.listYarns({}).catch(() => [] as Yarn[]),
      p.patternId ? api.getPattern(p.patternId).catch(() => null) : Promise.resolve(null),
    ]);
    this.pattern = pattern;
    const onIt = p.toolIds.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
    // What the lot held before: weighed, or its balls by the ball band when it
    // never was. Unknown for a yarn of several lots with none chosen.
    const before = (y: Project["yarns"][number]) => {
      const yarn = yarns.find((x) => x.id === y.yarnId);
      const lot = yarn?.lots.find((l) => l.id === y.lotId) ?? (yarn?.lots.length === 1 ? yarn.lots[0] : undefined);
      if (!yarn || !lot) return null;
      const grams = allOf(yarn, lot);
      const balls = lot.weighed ? "" : ` (${lot.balls} whole ball${lot.balls === 1 ? "" : "s"})`;
      return grams > 0 ? { grams, text: `${grams} g before${balls}` } : null;
    };
    // Each yarn's row, filled in with what the project was to take: in balls
    // when that is whole balls, else in grams.
    const rows = p.yarns.map((y) => {
      const had = before(y);
      const yarn = yarns.find((x) => x.id === y.yarnId);
      const perBall = yarn?.gramsPerBall ?? 0;
      this.held.set(y.id, { before: had?.grams ?? null, text: had?.text ?? "", perBall });
      const planned = y.plannedGrams ?? null;
      const inBalls = planned != null && perBall > 0 && planned % perBall === 0;
      return {
        y,
        // Its colour too: five colours of one yarn are otherwise five of the same line.
        colourway: yarn?.colourway,
        perBall,
        value: planned == null ? "" : inBalls ? String(planned / perBall) : String(planned),
        unit: inBalls ? "used-balls" : "used-g",
      };
    });
    const guessed = rows.some((r) => r.value !== "");

    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal finish-form" role="dialog" aria-modal="true">
        <h2>Finish “${escapeHtml(p.name)}”</h2>

        <div class="field">
          <span>Needles, hooks &amp; cables</span>
          ${
            onIt.length
              ? `<p class="hint">These go back to free.</p>
                 <ul class="tool-list record">${onIt.map((t) => `<li><span>${escapeHtml(describe(t))}</span></li>`).join("")}</ul>`
              : `<p class="hint">None on this project.</p>`
          }
        </div>

        <div class="field">
          <span>The yarn it used</span>
          ${
            p.yarns.length
              ? `<p class="hint">How much of each it used, in grams or balls (a ball is its weight per ball), or what is left of it.${guessed ? " Filled in from what the project was to take." : ""} A yarn with nothing left goes to the stash's History. Leave it empty to keep the stash as it is.</p>
                 <div class="leftover-list">
                   ${rows
                     .map(({ y, colourway, perBall, value, unit }) => {
                       const lotText = y.dyeLot ? ` — lot ${y.dyeLot}` : "";
                       const option = (v: string, label: string) => `<option value="${v}" ${v === unit ? "selected" : ""}>${label}</option>`;
                       return `
                         <div class="leftover-row">
                           <span>${escapeHtml(`${y.yarnName}${colourway ? ` · ${colourway}` : ""}${lotText}`)} <em data-note="${y.id}"></em></span>
                           <input type="number" min="0" step="any" inputmode="decimal" data-entry="${y.id}" value="${value}" aria-label="How much" />
                           <select data-unit="${y.id}" aria-label="Used or left">
                             ${option("used-g", "g used")}${perBall > 0 ? option("used-balls", "balls used") : ""}${option("left", "g left")}
                           </select>
                         </div>`;
                     })
                     .join("")}
                 </div>`
              : `<p class="hint">No yarn on this project.</p>`
          }
        </div>

        <div class="field-row">
          <label class="field">
            <span>Finished</span>
            <input data-f="finished" type="date" value="${toDateInput(Date.now())}" />
          </label>
        </div>
        ${
          pattern && pattern.status !== "finished"
            ? `<label class="check finish-pattern">
                 <input type="checkbox" data-f="mark-pattern" checked />
                 <span>Mark the pattern “${escapeHtml(pattern.title)}” as Finished</span>
               </label>`
            : ""
        }

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="finish">Finish project</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("input", this.onInput);
    this.root.addEventListener("change", this.onInput);
    for (const y of p.yarns) this.note(y.id);
  }

  private onInput = (e: Event): void => {
    const el = e.target as HTMLElement;
    const id = el.dataset?.entry ?? el.dataset?.unit;
    if (id) this.note(id);
  };

  /** What a yarn's row says it held, and what will be left of it. */
  private note(id: string): void {
    const el = this.root.querySelector<HTMLElement>(`[data-note="${id}"]`);
    const held = this.held.get(id);
    if (!el || !held) return;
    const said = this.said(id);
    let left: number | null = null;
    if (said && "grams" in said) left = said.grams;
    else if (said && held.before != null) {
      const used = "usedGrams" in said ? said.usedGrams : Math.round(said.usedBalls * held.perBall);
      left = Math.max(0, held.before - used);
    }
    const after = left == null ? "" : left === 0 ? "used up" : `${left} g left`;
    el.textContent = [held.text, after].filter(Boolean).join(" → ");
  }

  /** What a yarn's row says, as the backend takes it; null when empty or not a number. */
  private said(id: string): { grams: number } | { usedGrams: number } | { usedBalls: number } | null {
    const raw = this.root.querySelector<HTMLInputElement>(`[data-entry="${id}"]`)?.value.trim().replace(",", ".") ?? "";
    const unit = this.root.querySelector<HTMLSelectElement>(`[data-unit="${id}"]`)?.value;
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
    const n = Number(raw);
    if (unit === "used-balls") return { usedBalls: n };
    return unit === "left" ? { grams: Math.round(n) } : { usedGrams: Math.round(n) };
  }

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) {
      this.close();
      return;
    }
    const btn = closestEl(e.target, "button[data-act]");
    if (btn?.dataset.act === "cancel") this.close();
    if (btn?.dataset.act === "finish") void this.finish();
  };

  private async finish(): Promise<void> {
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="finish"]')!;
    button.disabled = true;
    try {
      const leftovers = [...this.root.querySelectorAll<HTMLInputElement>("input[data-entry]")].map((input) => {
        const id = input.dataset.entry!;
        const raw = input.value.trim();
        const said = this.said(id);
        if (raw && !said) throw new Error(`“${raw}” is not a number.`);
        return { entryId: id, grams: null, ...said };
      });
      const date = (this.root.querySelector('[data-f="finished"]') as HTMLInputElement).value;
      const done = await api.finishProject(this.project.id, leftovers, date ? fromDateInput(date) : null);
      const mark = this.root.querySelector<HTMLInputElement>('[data-f="mark-pattern"]');
      if (mark?.checked && this.pattern) {
        await api.updatePattern({ ...this.pattern, status: "finished" });
      }
      this.close();
      this.onDone(done);
    } catch (err) {
      const el = this.root.querySelector('[data-el="error"]') as HTMLElement;
      el.textContent = err instanceof Error ? err.message : String(err);
      el.hidden = false;
      button.disabled = false;
    }
  }

  private close(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("change", this.onInput);
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
