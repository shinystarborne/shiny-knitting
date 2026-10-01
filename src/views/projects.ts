import { api, type Project } from "../api";
import { closestEl } from "../dom";
import { longDate } from "./project-form";

type Status = "active" | "finished";

/**
 * The projects screen: everything being knitted, and everything finished.
 *
 * Laid out like the other tabs -- a filter down the side, a grid of cards of
 * one size. A card is the project's name, its pattern, its dates, and what is
 * on it; opening one is where its needles and yarn are chosen.
 */
export class ProjectsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private projects: Project[] = [];
  private status = new Set<Status>();
  private search = "";
  private results!: HTMLElement;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library projects";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Projects</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search name, pattern, notes..." />
          <button data-act="add" class="primary">+ New project</button>
        </div>
      </header>
      <div class="lib-body">
        <aside class="filters">
          <div class="filter-group">
            <h4>Status</h4>
            <div class="facet-list weight-scale" data-el="status"></div>
          </div>
          <button class="ghost clear-filters" data-act="clear">Clear filters</button>
        </aside>
        <main class="results project-grid"></main>
      </div>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;

    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value.trim().toLowerCase();
      this.paint();
    });
    this.root.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.filter !== "status") return;
      if (input.checked) this.status.add(input.value as Status);
      else this.status.delete(input.value as Status);
      this.paint();
    });
    this.root.addEventListener("click", (e) => this.onClick(e));

    this.projects = await api.listProjects();
    this.renderFacets();
    this.paint();
  }

  private onClick(e: MouseEvent): void {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") this.root.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: {} }));
      if (act === "clear") {
        this.status.clear();
        this.search = "";
        this.root.querySelector<HTMLInputElement>(".search")!.value = "";
        this.root.querySelectorAll<HTMLInputElement>("input[data-filter]").forEach((i) => (i.checked = false));
        this.paint();
      }
      if (act === "open-pattern") {
        this.root.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: btn.dataset.pattern }));
      }
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    if (card) this.root.dispatchEvent(new CustomEvent("edit-project", { bubbles: true, detail: card.dataset.open }));
  }

  private renderFacets(): void {
    const count = (s: Status) => this.projects.filter((p) => p.status === s).length;
    this.root.querySelector('[data-el="status"]')!.innerHTML = (["active", "finished"] as Status[])
      .map(
        (s) => `
          <label class="check${count(s) ? "" : " unused"}">
            <input type="checkbox" data-filter="status" value="${s}" ${this.status.has(s) ? "checked" : ""} />
            <span>${s === "active" ? "Active" : "Finished"}</span>
            <em>${count(s)}</em>
          </label>`,
      )
      .join("");
  }

  private paint(): void {
    const shown = this.projects.filter((p) => {
      if (this.status.size && !this.status.has(p.status)) return false;
      if (!this.search) return true;
      const words = [p.name, p.patternTitle, p.notes, ...p.yarns.map((y) => y.yarnName)].join(" ").toLowerCase();
      return this.search.split(/\s+/).every((w) => words.includes(w));
    });
    if (!shown.length) {
      const filtering = this.projects.length > 0;
      this.results.innerHTML = `
        <div class="empty">
          <h2>${filtering ? "Nothing matches those filters" : "No projects yet"}</h2>
          <p>${filtering ? "Try removing a filter." : "Start one here, or from a pattern while reading it. Its needles and yarn are then in use until it is finished."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = shown.map((p) => this.cardHtml(p)).join("");
  }

  private cardHtml(p: Project): string {
    const finished = p.status === "finished";
    const tools = p.toolIds.length;
    const on = [
      tools ? `${tools} ${tools === 1 ? "needle or hook" : "needles & hooks"}` : "",
      p.yarns.length ? `${p.yarns.length} ${p.yarns.length === 1 ? "yarn" : "yarns"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const dates = finished
      ? `Finished ${longDate(p.finishedAt ?? p.startedAt)}`
      : `Started ${longDate(p.startedAt)}`;
    return `
      <article class="project-card${finished ? " finished" : " active"}" data-open="${p.id}">
        <div class="project-head">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="pill ${finished ? "project-finished" : "project-active"}">${finished ? "Finished" : "Active"}</span>
        </div>
        ${
          p.patternId
            ? `<button class="link project-pattern" data-act="open-pattern" data-pattern="${escapeHtml(p.patternId)}" title="Open the pattern">${escapeHtml(p.patternTitle)}</button>`
            : `<p class="project-pattern none">No pattern</p>`
        }
        <p class="project-dates">${escapeHtml(dates)}</p>
        <p class="project-on">${on ? escapeHtml(on) : finished ? "Nothing recorded" : "Nothing on it yet"}</p>
      </article>`;
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
