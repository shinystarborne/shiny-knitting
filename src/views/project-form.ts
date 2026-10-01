import { api, STATUSES, type Pattern, type Project, type ProjectInput, type Tool, type Yarn } from "../api";
import { askYesNo } from "../dialogs";
import { closestEl } from "../dom";
import { describe } from "./tool-filter";
import { ToolPicker } from "./tool-picker";
import { YarnPicker, type ChosenYarn } from "./yarn-picker";

export interface ProjectFormHooks {
  /** After a save or a removal; null when the project was removed. */
  onDone: (project: Project | null) => void;
  /** Finish… was pressed: the caller opens the finish dialog for it. */
  onFinish: (project: Project) => void;
}

/**
 * The add/edit dialog for a project.
 *
 * Its needles, hooks, cables and yarn are chosen here and saved with the
 * form, as one set: what is on an active project is what is in use. A
 * finished project shows what it used and what was left instead, as a record;
 * its name, pattern, dates and notes can still be corrected.
 */
export class ProjectForm {
  private root: HTMLElement;
  private editing: Project | null;
  private preset: { patternId?: string | null };
  private hooks: ProjectFormHooks;
  private patterns: Pattern[] = [];
  private tools: Tool[] = [];
  private yarns: Yarn[] = [];
  private chosenTools = new Set<string>();
  private chosenYarns: ChosenYarn[] = [];
  private toolPicker: ToolPicker | null = null;
  private yarnPicker: YarnPicker | null = null;

  constructor(root: HTMLElement, editing: Project | null, preset: { patternId?: string | null }, hooks: ProjectFormHooks) {
    this.root = root;
    this.editing = editing;
    this.preset = preset;
    this.hooks = hooks;
  }

  async open(): Promise<void> {
    const [patterns, tools, yarns] = await Promise.all([
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listTools().catch(() => [] as Tool[]),
      api.listYarns({}).catch(() => [] as Yarn[]),
    ]);
    this.patterns = patterns;
    this.tools = tools;
    this.yarns = yarns;
    const e = this.editing;
    this.chosenTools = new Set(e?.toolIds ?? []);
    this.chosenYarns = (e?.yarns ?? []).map((y) => ({ id: y.id, yarnId: y.yarnId, lotId: y.lotId }));
    const finished = e?.status === "finished";
    const patternId = e ? e.patternId : (this.preset.patternId ?? null);
    const started = toDateInput(e?.startedAt ?? Date.now());

    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal project-form" role="dialog" aria-modal="true">
        <h2>${e ? (finished ? "Finished project" : "Edit project") : "Start a project"}</h2>
        ${finished ? `<p class="hint">Finished ${escapeHtml(longDate(e!.finishedAt ?? Date.now()))}. What it used stays listed here.</p>` : ""}

        <div class="field-row">
          <label class="field">
            <span>Pattern</span>
            <select data-f="pattern">
              <option value="">No pattern</option>
              ${this.patternOptions(patternId)}
            </select>
          </label>
          <label class="field">
            <span>Name</span>
            <input data-f="name" value="${escapeAttr(e?.name ?? "")}" placeholder="${escapeAttr(this.namePlaceholder(patternId))}" />
          </label>
          <label class="field">
            <span>Started</span>
            <input data-f="started" type="date" value="${started}" />
          </label>
        </div>

        <div class="field">
          <span>Needles, hooks &amp; cables</span>
          <div class="form-tools" data-el="tools"></div>
        </div>
        <div class="field">
          <span>Yarn</span>
          <div class="form-tools" data-el="yarns"></div>
        </div>

        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="Size made, changes to the pattern, who it is for…">${escapeHtml(e?.notes ?? "")}</textarea>
        </label>

        <div class="modal-actions">
          ${e ? `<button class="ghost danger-text" data-act="remove" title="Remove this project">Remove</button>` : ""}
          <span class="spacer"></span>
          <button class="ghost" data-act="cancel">Cancel</button>
          ${e && !finished ? `<button class="ghost" data-act="finish" title="Release the needles and record the leftover yarn">Finish project…</button>` : ""}
          <button class="primary" data-act="save">${e ? "Save" : "Start project"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("change", this.onChange);

    if (finished) {
      this.renderRecord();
    } else {
      this.toolPicker = new ToolPicker(
        this.root.querySelector<HTMLElement>('[data-el="tools"]')!,
        (id) => {
          this.chosenTools.add(id);
          this.renderTools();
        },
        (id) => {
          this.chosenTools.delete(id);
          this.renderTools();
        },
      );
      this.yarnPicker = new YarnPicker(
        this.root.querySelector<HTMLElement>('[data-el="yarns"]')!,
        (y) => {
          if (!this.chosenYarns.some((c) => c.yarnId === y.yarnId && c.lotId === y.lotId)) this.chosenYarns.push(y);
          this.renderYarns();
        },
        (i) => {
          this.chosenYarns.splice(i, 1);
          this.renderYarns();
        },
      );
      this.renderTools();
      this.renderYarns();
    }
  }

  /** The library's patterns, the ones being knitted first. */
  private patternOptions(chosen: string | null): string {
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

  private namePlaceholder(patternId: string | null): string {
    const title = this.patterns.find((p) => p.id === patternId)?.title;
    return title ? `${title} — or a name of its own` : "e.g. Gift hat for Sam";
  }

  /**
   * The needles as they will be once saved: one taken off here shows as free,
   * not as on this project.
   */
  private renderTools(): void {
    const id = this.editing?.id;
    const view = this.tools.map((t) =>
      id && t.projectId === id && !this.chosenTools.has(t.id) ? { ...t, projectId: null, projectName: "" } : t,
    );
    this.toolPicker?.render(view, this.chosenTools, "None chosen yet.");
  }

  private renderYarns(): void {
    this.yarnPicker?.render(this.yarns, this.chosenYarns, this.editing?.name ?? "");
  }

  /** A finished project's record: what it used, and what was left. */
  private renderRecord(): void {
    const e = this.editing!;
    const tools = e.toolIds.map((id) => this.tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
    this.root.querySelector('[data-el="tools"]')!.innerHTML = tools.length
      ? `<ul class="tool-list record">${tools.map((t) => `<li><span>${escapeHtml(describe(t))}</span></li>`).join("")}</ul>`
      : `<p class="hint">None recorded.</p>`;
    this.root.querySelector('[data-el="yarns"]')!.innerHTML = e.yarns.length
      ? `<ul class="tool-list record">${e.yarns
          .map((y) => {
            const lot = y.dyeLot ? ` — lot ${y.dyeLot}` : "";
            const left = y.leftoverGrams === null ? "" : y.leftoverGrams === 0 ? " · used up" : ` · ${y.leftoverGrams} g left`;
            return `<li><span>${escapeHtml(`${y.yarnName}${lot}${left}`)}</span></li>`;
          })
          .join("")}</ul>`
      : `<p class="hint">None recorded.</p>`;
  }

  private onChange = (e: Event): void => {
    const el = e.target as HTMLElement;
    if (el.dataset.f === "pattern") {
      const name = this.root.querySelector<HTMLInputElement>('[data-f="name"]');
      if (name) name.placeholder = this.namePlaceholder(this.value("pattern") || null);
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) {
      this.close();
      return;
    }
    const btn = closestEl(e.target, "button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "cancel") this.close();
    if (btn.dataset.act === "save") void this.save();
    if (btn.dataset.act === "remove") void this.remove();
    if (btn.dataset.act === "finish") void this.finish();
  };

  private value(name: string): string {
    return (this.root.querySelector(`[data-f="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  }

  private input(): ProjectInput {
    const started = this.value("started");
    return {
      name: this.value("name").trim(),
      patternId: this.value("pattern") || null,
      notes: this.value("notes"),
      startedAt: started ? fromDateInput(started) : null,
      toolIds: [...this.chosenTools],
      yarns: this.chosenYarns.map((y) => ({ id: y.id ?? null, yarnId: y.yarnId, lotId: y.lotId })),
    };
  }

  private async save(): Promise<Project | null> {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".modal-actions button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const saved = this.editing
        ? await api.updateProject(this.editing.id, this.input())
        : await api.addProject(this.input());
      this.close();
      this.hooks.onDone(saved);
      return saved;
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
      buttons.forEach((b) => (b.disabled = false));
      return null;
    }
  }

  /** Saves first, so what was just chosen is what finishing releases. */
  private async finish(): Promise<void> {
    const saved = await this.save();
    if (saved) this.hooks.onFinish(saved);
  }

  private async remove(): Promise<void> {
    const e = this.editing;
    if (!e) return;
    const what = e.status === "active" ? " Its needles and yarn go back to free; they are not removed." : "";
    if (!(await askYesNo(`Remove the project “${e.name}”?${what} This cannot be undone.`, { title: "Remove project", okLabel: "Remove", danger: true }))) {
      return;
    }
    try {
      await api.deleteProject(e.id);
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
      return;
    }
    this.close();
    this.hooks.onDone(null);
  }

  private showError(message: string): void {
    const el = this.root.querySelector('[data-el="error"]') as HTMLElement;
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

/** A stored timestamp as the `YYYY-MM-DD` a date input wants. */
export function toDateInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A date input's `YYYY-MM-DD` as local midnight. Date.parse reads it as UTC,
 * which west of Greenwich shows as the day before.
 */
export function fromDateInput(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function longDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
