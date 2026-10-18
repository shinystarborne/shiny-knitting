import { api, type Goal, type Project, type YarnUse } from "../api";
import { customDialog, say, askYesNo } from "../dialogs";
import { closestEl } from "../dom";

/**
 * Goals for a year, in Statistics: projects finished, grams or metres of the
 * stash used, or your own, counted by hand. How far along each is, and for
 * this year whether that is ahead of the days gone or behind them.
 */

export const GOAL_KINDS: { kind: Goal["kind"]; label: string; unit: string }[] = [
  { kind: "projects", label: "Projects finished", unit: "projects" },
  { kind: "grams", label: "Grams of the stash used", unit: "g" },
  { kind: "metres", label: "Metres of the stash used", unit: "m" },
  { kind: "own", label: "Your own", unit: "" },
];

/** The first and last moments of a year, here. */
function yearSpan(year: number): [number, number] {
  return [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()];
}

/** How far a goal has got: done of its target, and its share (up to 1). */
export function goalProgress(goal: Goal, projects: Project[], uses: YarnUse[]): { done: number; share: number } {
  const [from, to] = yearSpan(goal.year);
  const within = (at: number | null | undefined) => at != null && at >= from && at < to;
  let done = goal.done;
  if (goal.kind === "projects") done = projects.filter((p) => p.status === "finished" && within(p.finishedAt)).length;
  if (goal.kind === "grams") done = uses.filter((u) => within(u.at)).reduce((n, u) => n + u.grams, 0);
  if (goal.kind === "metres") done = uses.filter((u) => within(u.at)).reduce((n, u) => n + u.metres, 0);
  return { done, share: goal.target > 0 ? Math.min(1, done / goal.target) : 0 };
}

/**
 * Where a goal stands against the year: reached; or, this year, ahead of or
 * behind where the days gone would have it; or, a year gone, not reached.
 */
export function goalPace(goal: Goal, done: number, now = Date.now()): { word: "reached" | "ahead" | "behind" | "missed" | "to come"; expected: number } {
  const [from, to] = yearSpan(goal.year);
  const gone = Math.max(0, Math.min(1, (now - from) / (to - from)));
  const expected = goal.target * gone;
  if (done >= goal.target) return { word: "reached", expected };
  if (now >= to) return { word: "missed", expected };
  if (now < from) return { word: "to come", expected };
  return { word: done >= expected ? "ahead" : "behind", expected };
}

/** What a goal is, in words: "Finish 12 projects", "Use 2 000 g of the stash". */
export function goalTitle(goal: Goal): string {
  const n = fmt(goal.target);
  if (goal.kind === "projects") return `Finish ${n} project${goal.target === 1 ? "" : "s"}`;
  if (goal.kind === "grams") return `Use ${n} g of the stash`;
  if (goal.kind === "metres") return `Use ${n} m of the stash`;
  return goal.label;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString(undefined).replace(/,/g, " ");
}

/**
 * The goals panel: the year's goals with their bars, a year to look back on,
 * and a goal set, changed, counted (your own) or taken away.
 */
export class GoalsPanel {
  private host: HTMLElement;
  private goals: Goal[] = [];
  private projects: Project[];
  private uses: YarnUse[];
  private year = new Date().getFullYear();

  constructor(host: HTMLElement, projects: Project[], uses: YarnUse[]) {
    this.host = host;
    this.projects = projects;
    this.uses = uses;
    host.addEventListener("click", (e) => void this.onClick(e));
    host.addEventListener("change", (e) => {
      const el = e.target as HTMLSelectElement;
      if (el.dataset.el === "goal-year") {
        this.year = Number(el.value);
        this.paint();
      }
    });
  }

  async load(): Promise<void> {
    this.goals = await api.listGoals().catch(() => []);
    this.paint();
  }

  private paint(): void {
    const now = new Date().getFullYear();
    const years = [...new Set([now, ...this.goals.map((g) => g.year)])].sort((a, b) => b - a);
    const goals = this.goals.filter((g) => g.year === this.year);
    this.host.innerHTML = `
      <div class="usage-head">
        <div><h2>Goals for ${years.length > 1 ? `<select data-el="goal-year" aria-label="The year">${years.map((y) => `<option value="${y}" ${y === this.year ? "selected" : ""}>${y}</option>`).join("")}</select>` : this.year}</h2>
          <p class="hint">Projects finished, yarn from the stash used (finished projects and yarn marked used up), or your own.</p></div>
        <button class="ghost" data-act="goal-add">+ A goal</button>
      </div>
      ${
        goals.length
          ? `<div class="goals-list">${goals.map((g) => this.goalHtml(g)).join("")}</div>`
          : `<p class="hint goals-none">No goals for ${this.year} yet. Set one: how many projects to finish, how much of the stash to knit up, or one of your own.</p>`
      }`;
  }

  private goalHtml(g: Goal): string {
    const { done, share } = goalProgress(g, this.projects, this.uses);
    const pace = goalPace(g, done);
    const unit = GOAL_KINDS.find((k) => k.kind === g.kind)!.unit;
    const said =
      pace.word === "reached"
        ? "Reached"
        : pace.word === "ahead"
          ? `Ahead: by now it would be ${fmt(pace.expected)}`
          : pace.word === "behind"
            ? `Behind: by now it would be ${fmt(pace.expected)}`
            : pace.word === "missed"
              ? "Not reached"
              : "The year has not begun";
    return `
      <div class="goal ${pace.word}" data-goal="${esc(g.id)}">
        <div class="goal-head">
          <b>${esc(goalTitle(g))}</b>
          <span class="goal-figures">${fmt(done)} of ${fmt(g.target)}${unit ? ` ${unit}` : ""} · ${Math.round(share * 100)}%</span>
          <span class="goal-tools">
            ${g.kind === "own" ? `<button class="ghost" data-act="goal-less" aria-label="One fewer" ${g.done > 0 ? "" : "disabled"}>−</button><button class="ghost" data-act="goal-more" aria-label="One more">+</button>` : ""}
            <button class="ghost" data-act="goal-edit">Change</button>
            <button class="ghost danger-text" data-act="goal-remove" aria-label="Remove" title="Remove">✕</button>
          </span>
        </div>
        <div class="goal-bar" role="progressbar" aria-valuenow="${Math.round(share * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
        <small class="goal-pace">${said}</small>
      </div>`;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    const act = btn?.dataset.act;
    if (!btn || !act?.startsWith("goal-")) return;
    if (act === "goal-add") return this.edit(null);
    const goal = this.goals.find((g) => g.id === closestEl(btn, "[data-goal]")?.dataset.goal);
    if (!goal) return;
    try {
      if (act === "goal-edit") return await this.edit(goal);
      if (act === "goal-remove") {
        if (!(await askYesNo(`Take away the goal “${goalTitle(goal)}”?`, { okLabel: "Remove", danger: true }))) return;
        await api.removeGoal(goal.id);
        this.goals = this.goals.filter((g) => g.id !== goal.id);
      }
      if (act === "goal-more" || act === "goal-less") {
        const saved = await api.setGoalDone(goal.id, Math.max(0, goal.done + (act === "goal-more" ? 1 : -1)));
        this.goals = this.goals.map((g) => (g.id === saved.id ? saved : g));
      }
      this.paint();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Goals");
    }
  }

  /** Sets a goal, or changes one: what it counts, how much, and for your own, what it is. */
  private edit(goal: Goal | null): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        dialog.close();
        resolve();
      };
      const dialog = customDialog(goal ? "Change the goal" : `A goal for ${this.year}`, finish, "goal-dialog");
      const kind = goal?.kind ?? "projects";
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <label class="dialog-field"><span class="dialog-label">What it counts</span>
          <select class="dialog-input" data-f="kind">${GOAL_KINDS.map((k) => `<option value="${k.kind}" ${k.kind === kind ? "selected" : ""}>${k.label}</option>`).join("")}</select></label>
        <label class="dialog-field" data-el="label-field" ${kind === "own" ? "" : "hidden"}><span class="dialog-label">Your goal</span>
          <input class="dialog-input" data-f="label" maxlength="120" value="${esc(goal?.label ?? "")}" placeholder="e.g. knit a hat a month, learn brioche" /></label>
        <label class="dialog-field"><span class="dialog-label" data-el="target-label">${targetLabel(kind)}</span>
          <input class="dialog-input" data-f="target" inputmode="decimal" value="${goal ? goal.target : ""}" placeholder="${placeholder(kind)}" /></label>
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">${goal ? "Save" : "Set the goal"}</button>
        </div>`,
      );
      const card = dialog.card;
      const field = <T extends HTMLElement>(f: string) => card.querySelector<T>(`[data-f="${f}"]`)!;
      field<HTMLSelectElement>("kind").addEventListener("change", () => {
        const k = field<HTMLSelectElement>("kind").value as Goal["kind"];
        card.querySelector<HTMLElement>('[data-el="label-field"]')!.hidden = k !== "own";
        card.querySelector<HTMLElement>('[data-el="target-label"]')!.textContent = targetLabel(k);
        field<HTMLInputElement>("target").placeholder = placeholder(k);
      });
      const save = async () => {
        const target = Number(field<HTMLInputElement>("target").value.trim().replace(/\s/g, "").replace(",", "."));
        try {
          const saved = await api.saveGoal({ id: goal?.id ?? null, year: goal?.year ?? this.year, kind: field<HTMLSelectElement>("kind").value as Goal["kind"], label: field<HTMLInputElement>("label").value, target });
          this.goals = goal ? this.goals.map((g) => (g.id === saved.id ? saved : g)) : [...this.goals, saved];
          this.paint();
          finish();
        } catch (err) {
          const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
          error.textContent = err instanceof Error ? err.message : String(err);
          error.hidden = false;
        }
      };
      card.addEventListener("click", (e) => {
        const act = closestEl(e.target, "button[data-act]")?.dataset.act;
        if (act === "cancel") finish();
        if (act === "save") void save();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void save();
        }
      });
      dialog.show(field<HTMLInputElement>("target"));
    });
  }
}

function targetLabel(kind: Goal["kind"]): string {
  return kind === "projects" ? "How many projects" : kind === "grams" ? "How many grams" : kind === "metres" ? "How many metres" : "How many times";
}

function placeholder(kind: Goal["kind"]): string {
  return kind === "projects" ? "e.g. 12" : kind === "grams" ? "e.g. 2000" : kind === "metres" ? "e.g. 5000" : "e.g. 12";
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
