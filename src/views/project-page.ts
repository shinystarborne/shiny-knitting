import { api, STATUSES, type Pattern, type Project, type ProjectInput, type Tool } from "../api";
import { askYesNo, say } from "../dialogs";
import { blobBytes, forgetProjectCover, prepareBoardImage, projectCoverUrl } from "../covers";
import { Board } from "./board";
import { fromDateInput, toDateInput } from "./project-form";
import { describe } from "./tool-filter";

export interface ProjectPageHooks {
  back(): void;
  openPattern(id: string): void;
  /** Opens the dialog for choosing its needles and yarn. */
  editLinks(project: Project): void;
  finish(project: Project): void;
  /** After the project was removed. */
  removed(): void;
}

/** The longest side a project cover is kept at. */
const COVER_SIDE = 1000;

/**
 * One project's own page: what it is down the side -- a cover, its name and
 * pattern, when it was started and finished, its needles and yarn, notes --
 * and its board filling the rest.
 *
 * Details save as they are changed, as the reader's notes do; there is no
 * Save button to forget.
 */
export class ProjectPage {
  private screen: HTMLElement;
  private projectId: string;
  private hooks: ProjectPageHooks;
  private root!: HTMLElement;
  private project!: Project;
  private patterns: Pattern[] = [];
  private tools: Tool[] = [];
  private board: Board | null = null;
  private teardown: (() => void)[] = [];
  /** The name or notes typed and not yet saved. */
  private typingTimer: number | null = null;

  constructor(screen: HTMLElement, projectId: string, hooks: ProjectPageHooks) {
    this.screen = screen;
    this.projectId = projectId;
    this.hooks = hooks;
  }

  get id(): string {
    return this.projectId;
  }

  async mount(): Promise<void> {
    const projects = await api.listProjects();
    const found = projects.find((p) => p.id === this.projectId);
    if (!found) {
      await say("That project is no longer there.");
      this.hooks.back();
      return;
    }
    this.project = found;
    [this.patterns, this.tools] = await Promise.all([
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listTools().catch(() => [] as Tool[]),
    ]);

    this.root = document.createElement("div");
    this.root.className = "project-page";
    this.root.innerHTML = `<aside class="project-side"></aside><div class="project-board"></div>`;
    this.screen.appendChild(this.root);
    this.renderSide();

    this.board = new Board(this.root.querySelector<HTMLElement>(".project-board")!, this.projectId, {
      project: () => this.project,
      openPattern: (id) => this.hooks.openPattern(id),
    });
    await this.board.mount();

    // A picture pasted while the cover is chosen is the cover.
    const onPaste = (e: ClipboardEvent) => {
      if (!(document.activeElement as HTMLElement | null)?.closest?.("[data-cover]")) return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void this.setCover(file);
    };
    document.addEventListener("paste", onPaste);
    this.teardown.push(() => document.removeEventListener("paste", onPaste));
  }

  /** Saves the name or notes still being typed, and takes the page down. */
  destroy(): void {
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
      void this.saveDetails();
    }
    for (const undo of this.teardown) undo();
    this.board?.destroy();
    this.root?.remove();
  }

  /** Re-reads the project after a dialog changed it: needles, yarn, finishing. */
  async refresh(): Promise<void> {
    const found = (await api.listProjects().catch(() => [] as Project[])).find((p) => p.id === this.projectId);
    if (!found) return this.hooks.removed();
    this.project = found;
    this.tools = await api.listTools().catch(() => this.tools);
    this.renderSide();
    await this.board?.refreshLinked();
  }

  private renderSide(): void {
    const p = this.project;
    const side = this.root.querySelector<HTMLElement>(".project-side")!;
    const finished = p.status === "finished";
    const tools = p.toolIds.map((id) => this.tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
    side.innerHTML = `
      <button class="ghost back" data-act="back">← Projects</button>

      <div class="project-cover" data-cover tabindex="0" title="Paste a picture here with Ctrl+V, drop one, or choose one">
        <span class="project-cover-empty">Cover — click here and paste, drop a picture, or choose one</span>
      </div>
      <div class="project-cover-actions">
        <button class="ghost" data-act="cover-file">Choose…</button>
        <button class="ghost" data-act="cover-remove" ${p.coverPath ? "" : "hidden"}>Remove</button>
      </div>

      <input class="project-title" data-f="name" value="${esc(p.name)}" aria-label="Project name" />
      <span class="pill ${finished ? "project-finished" : "project-active"}">${finished ? "Finished" : "Active"}</span>

      <label class="field">
        <span>Pattern</span>
        <select data-f="pattern">
          <option value="">No pattern</option>
          ${this.patternOptions(p.patternId)}
        </select>
      </label>
      ${p.patternId ? `<button class="link" data-act="open-pattern">Open the pattern</button>` : ""}

      <div class="project-side-dates">
        <label class="field"><span>Started</span><input type="date" data-f="started" value="${toDateInput(p.startedAt)}" /></label>
        <label class="field"><span>Finished</span>${
          finished
            ? `<input type="date" data-f="finished" value="${toDateInput(p.finishedAt ?? Date.now())}" />`
            : `<button class="ghost" data-act="finish" title="Release the needles and record the leftover yarn">Finish…</button>`
        }</label>
      </div>

      <div class="side-section">
        <h3>Needles, hooks &amp; cables</h3>
        ${tools.length ? `<ul class="tool-list record">${tools.map((t) => `<li><span>${esc(describe(t))}</span></li>`).join("")}</ul>` : `<p class="hint">None${finished ? " recorded" : " yet"}.</p>`}
        <h3>Yarn</h3>
        ${
          p.yarns.length
            ? `<ul class="tool-list record">${p.yarns
                .map((y) => {
                  const left = y.leftoverGrams === null ? "" : y.leftoverGrams === 0 ? " · used up" : ` · ${y.leftoverGrams} g left`;
                  return `<li><span>${esc(`${y.yarnName}${y.dyeLot ? ` — lot ${y.dyeLot}` : ""}${left}`)}</span></li>`;
                })
                .join("")}</ul>`
            : `<p class="hint">None${finished ? " recorded" : " yet"}.</p>`
        }
        ${finished ? "" : `<button class="ghost" data-act="edit-links">Choose needles &amp; yarn…</button>`}
      </div>

      <label class="field">
        <span>Notes</span>
        <textarea data-f="notes" placeholder="Size made, changes to the pattern, who it is for…">${esc(p.notes)}</textarea>
      </label>

      <button class="ghost danger-text" data-act="remove">Remove project</button>
    `;
    side.onclick = (e) => void this.onClick(e);
    side.onchange = (e) => void this.onChange(e);
    // The name and notes save a moment after typing stops, too, so nothing
    // typed is lost to opening another page before the field is left.
    side.oninput = (e) => {
      const f = (e.target as HTMLElement).dataset.f;
      if (f !== "name" && f !== "notes") return;
      if (this.typingTimer !== null) clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => {
        this.typingTimer = null;
        void this.saveDetails();
      }, 800);
    };
    const cover = side.querySelector<HTMLElement>("[data-cover]")!;
    cover.ondragover = (e) => {
      e.preventDefault();
      cover.classList.add("over");
    };
    cover.ondragleave = () => cover.classList.remove("over");
    cover.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      cover.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void this.setCover(file);
    };
    void this.paintCover();
  }

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
      .map(([label, list]) => `<optgroup label="${esc(label)}">${list.map((p) => `<option value="${esc(p.id)}" ${p.id === chosen ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</optgroup>`)
      .join("");
  }

  private async paintCover(): Promise<void> {
    const box = this.root.querySelector<HTMLElement>("[data-cover]");
    if (!box) return;
    const url = this.project.coverPath ? await projectCoverUrl(this.projectId) : null;
    box.style.backgroundImage = url ? `url("${url}")` : "";
    box.classList.toggle("filled", !!url);
  }

  private async setCover(file: Blob): Promise<void> {
    const prepared = await prepareBoardImage(file, COVER_SIDE);
    if (!prepared) return void (await say("That could not be read as a picture.", "Cover"));
    try {
      await api.setProjectCover(this.projectId, await blobBytes(prepared.blob));
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Cover"));
    }
    forgetProjectCover(this.projectId);
    this.project.coverPath = "set";
    this.root.querySelector<HTMLElement>('[data-act="cover-remove"]')!.hidden = false;
    await this.paintCover();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "back") this.hooks.back();
    if (act === "open-pattern" && this.project.patternId) this.hooks.openPattern(this.project.patternId);
    if (act === "edit-links") this.hooks.editLinks(this.project);
    if (act === "finish") this.hooks.finish(this.project);
    if (act === "cover-file") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void this.setCover(file);
      });
      input.click();
    }
    if (act === "cover-remove") {
      await api.removeProjectCover(this.projectId).catch(() => {});
      forgetProjectCover(this.projectId);
      this.project.coverPath = "";
      btn.hidden = true;
      await this.paintCover();
    }
    if (act === "remove") {
      const what = this.project.status === "active" ? " Its needles and yarn go back to free; they are not removed." : "";
      if (!(await askYesNo(`Remove the project “${this.project.name}” and its board?${what} This cannot be undone.`, { title: "Remove project", okLabel: "Remove", danger: true }))) return;
      try {
        await api.deleteProject(this.projectId);
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Remove project"));
      }
      this.hooks.removed();
    }
  }

  /** Every detail saves as soon as it is changed. */
  private async onChange(e: Event): Promise<void> {
    const f = (e.target as HTMLElement).dataset.f;
    if (!f) return;
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (!(await this.saveDetails())) return;
    // The pattern decides the Open link; the rest is already as typed.
    if (f === "pattern" || f === "name") this.renderSide();
  }

  /** Saves the details as they stand on the page; false if that failed. */
  private async saveDetails(): Promise<boolean> {
    const value = (name: string) => this.root.querySelector<HTMLInputElement>(`.project-side [data-f="${name}"]`)?.value ?? "";
    const started = value("started");
    const finishedAt = value("finished");
    const input: ProjectInput = {
      name: value("name").trim(),
      patternId: value("pattern") || null,
      notes: value("notes"),
      startedAt: started ? fromDateInput(started) : null,
      finishedAt: finishedAt ? fromDateInput(finishedAt) : null,
      toolIds: this.project.toolIds,
      yarns: this.project.yarns.map((y) => ({ id: y.id, yarnId: y.yarnId, lotId: y.lotId })),
    };
    if (!input.name) return false;
    try {
      this.project = await api.updateProject(this.projectId, input);
      return true;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Project");
      return false;
    }
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
