import { api, type Pattern, type Project, type Tool, type Yarn } from "../api";
import { closestEl } from "../dom";
import { fromDateInput, toDateInput } from "./project-form";
import { describe } from "./tool-filter";

/**
 * Finishing a project: its needles, hooks and cables go back to free, and
 * what is left of each yarn is weighed and goes back into the stash -- as a
 * leftover, or used up at 0 g. Optionally the pattern is marked Finished too.
 */
export class FinishProjectDialog {
  private root: HTMLElement;
  private project: Project;
  private onDone: (project: Project) => void;
  private pattern: Pattern | null = null;

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
    const lotOf = (y: Project["yarns"][number]) => {
      const yarn = yarns.find((x) => x.id === y.yarnId);
      return yarn?.lots.find((l) => l.id === y.lotId) ?? (yarn?.lots.length === 1 ? yarn.lots[0] : undefined);
    };

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
          <span>What is left of the yarn</span>
          ${
            p.yarns.length
              ? `<p class="hint">Weigh what is left. 0 means used up: a yarn with nothing left goes to the stash's History. Leave it empty to keep the stash as it is.</p>
                 <div class="leftover-list">
                   ${p.yarns
                     .map((y) => {
                       const lot = lotOf(y);
                       const lotText = y.dyeLot ? ` — lot ${y.dyeLot}` : "";
                       const had = lot ? `${lot.gramsLeft} g before` : "";
                       return `
                         <label class="leftover-row">
                           <span>${escapeHtml(`${y.yarnName}${lotText}`)}${had ? ` <em>${escapeHtml(had)}</em>` : ""}</span>
                           <input type="number" min="0" step="1" inputmode="numeric" data-entry="${y.id}" placeholder="g left" />
                           <span class="unit">g</span>
                         </label>`;
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
        const raw = input.value.trim();
        if (raw && !/^\d+$/.test(raw)) throw new Error(`“${raw}” is not a number of grams.`);
        return { entryId: input.dataset.entry!, grams: raw ? Number(raw) : null };
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
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
