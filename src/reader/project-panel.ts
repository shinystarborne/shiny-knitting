import { api, type Project, type Tool } from "../api";
import { describe } from "../views/tool-filter";

/**
 * The pattern's project, in the reader's side pane: what is being knitted from
 * it, and with what, or a way to start.
 *
 * Kept to a few lines -- the counter below is the working part of the pane --
 * with the project's own dialog for choosing needles and yarn, which is the
 * same dialog the Projects tab opens.
 */
export class ProjectPanel {
  private root: HTMLElement;
  private patternId: string;

  constructor(root: HTMLElement, patternId: string) {
    this.root = root;
    this.patternId = patternId;
    root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "project-start") {
        root.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: { patternId: this.patternId } }));
      }
      if (btn.dataset.act === "project-open") {
        root.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, detail: btn.dataset.id }));
      }
    });
  }

  async refresh(): Promise<void> {
    let projects: Project[] = [];
    let tools: Tool[] = [];
    try {
      [projects, tools] = await Promise.all([api.listProjects(), api.listTools()]);
    } catch {
      // A pane that cannot read its projects still reads the pattern.
    }
    const mine = projects.filter((p) => p.patternId === this.patternId);
    const active = mine.filter((p) => p.status === "active");
    const finished = mine.length - active.length;
    const before = finished ? `<p class="hint">Finished ${finished === 1 ? "once" : `${finished} times`} before.</p>` : "";

    if (!active.length) {
      this.root.innerHTML = `
        <h3>Project</h3>
        <p class="hint">Not being knitted right now.</p>
        ${before}
        <button class="ghost" data-act="project-start" title="Start a project from this pattern, and choose its needles and yarn">+ Start a project</button>`;
      return;
    }
    this.root.innerHTML = `
      <h3>${active.length === 1 ? "Project" : "Projects"}</h3>
      ${active
        .map((p) => {
          const onIt = p.toolIds.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
          const lines = [
            ...onIt.map((t) => describe(t)),
            ...p.yarns.map((y) => `${y.yarnName}${y.dyeLot ? ` — lot ${y.dyeLot}` : ""}`),
          ];
          return `
            <div class="project-panel-item">
              <button class="link project-panel-name" data-act="project-open" data-id="${p.id}" title="Open the project: needles, yarn, finishing">${escapeHtml(p.name)}</button>
              ${
                lines.length
                  ? `<ul class="tool-list">${lines.map((l) => `<li><span>${escapeHtml(l)}</span></li>`).join("")}</ul>`
                  : `<p class="hint">No needles or yarn on it yet.</p>`
              }
              <button class="ghost" data-act="project-open" data-id="${p.id}">Needles, yarn, finish…</button>
            </div>`;
        })
        .join("")}
      ${before}`;
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
