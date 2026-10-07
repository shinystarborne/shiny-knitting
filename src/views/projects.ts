import { api, isRecord, PROJECT_STATUSES, projectStatusLabel, type GalleryPhoto, type Project, type ProjectStatus } from "../api";
import { say } from "../dialogs";
import { coverUrl, projectCoverUrl } from "../covers";
import { closestEl } from "../dom";
import { longDate } from "./project-form";
import { paintLazily } from "./lazy";
import { openGalleryProject, photosOf, tileHtml, tilePicture } from "./gallery";

type Status = ProjectStatus;

type Mode = "projects" | "plans" | "gallery";

/** What the tab shows, kept while the app is open: the projects, the plans, or the gallery; and whether the gallery shows the hidden. */
const kept: { mode: Mode; hidden: boolean } = { mode: "projects", hidden: false };

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
  /** Every finished project's log photos, for the gallery. */
  private logged: GalleryPhoto[] = [];

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library projects";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Projects</h1>
          <div class="seg" role="tablist" aria-label="Show">
            <button data-act="mode" data-mode="projects" role="tab">Projects</button>
            <button data-act="mode" data-mode="plans" role="tab" title="What to knit next: projects not started yet">Plans</button>
            <button data-act="mode" data-mode="gallery" role="tab" title="Every finished project, with its photos">Gallery</button>
          </div>
        </div>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search name, pattern, notes..." />
          <button data-act="sort-plans" class="ghost" title="Plans with a date first, the soonest first; the rest as they are">Sort by date</button>
          <button data-act="show-hidden" class="ghost" title="Projects hidden from the gallery, to show again"></button>
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
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.wireDrag();

    [this.projects, this.logged] = await Promise.all([api.listProjects(), api.listGalleryPhotos().catch(() => [] as GalleryPhoto[])]);
    this.renderFacets();
    this.paint();
  }

  private plans(): Project[] {
    return this.projects.filter((p) => p.status === "planned").sort((a, b) => a.planOrder - b.planOrder || a.createdAt - b.createdAt);
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "mode") {
        const mode = btn.dataset.mode;
        kept.mode = mode === "plans" || mode === "gallery" ? mode : "projects";
        return this.paint();
      }
      if (act === "show-hidden") {
        kept.hidden = !kept.hidden;
        return this.paint();
      }
      if (act === "add") this.root.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: kept.mode === "plans" ? { planned: true } : {} }));
      if (act === "start-plan") return void (await this.startPlan(btn.dataset.id!));
      if (act === "sort-plans") return void (await this.sortPlans());
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
    const tile = closestEl(e.target, "[data-gallery]");
    if (tile) return void (await this.openTile(tile.dataset.gallery!));
    const card = closestEl(e.target, "[data-open]");
    if (card) this.root.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: card.dataset.open }));
  }

  /** A finished project, big, over the gallery. */
  private async openTile(id: string): Promise<void> {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    await openGalleryProject(p, photosOf(p, this.logged), {
      changed: (next) => {
        this.projects = this.projects.map((x) => (x.id === next.id ? next : x));
        this.paint();
      },
      openPage: (pid) => this.root.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: pid })),
      openPattern: (pid) => this.root.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: pid })),
    });
  }

  /** Every finished project, the newest first; the hidden ones only when asked for. */
  private paintGallery(): void {
    const words = this.search.split(/\s+/).filter(Boolean);
    const finished = this.projects.filter((p) => p.status === "finished").sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    const hiddenCount = finished.filter((p) => p.galleryHidden).length;
    const toggle = this.root.querySelector<HTMLElement>('[data-act="show-hidden"]')!;
    toggle.hidden = !hiddenCount && !kept.hidden;
    toggle.textContent = kept.hidden ? "Hide the hidden" : `Show hidden (${hiddenCount})`;
    const shown = finished.filter((p) => {
      if (p.galleryHidden && !kept.hidden) return false;
      const text = [p.name, p.patternTitle, p.notes, ...p.yarns.map((y) => y.yarnName)].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (!shown.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${finished.length ? (words.length ? "Nothing by that name" : "Every finished project is hidden") : "Nothing finished yet"}</h2>
          <p>${finished.length ? (words.length ? "Try another word." : "Show hidden brings them back.") : "A project goes into the gallery by itself when it is finished, with its cover and the photos in its log."}</p>
        </div>`;
      return;
    }
    paintLazily(this.results, shown, (p) => tileHtml(p, photosOf(p, this.logged)), {
      pictures: ".gallery-tile",
      paint: (tile) => this.paintTile(tile),
    });
  }

  private async paintTile(tile: HTMLElement): Promise<void> {
    const p = this.projects.find((x) => x.id === tile.dataset.gallery);
    const box = tile.querySelector<HTMLElement>(".gallery-pic");
    if (!p || !box) return;
    const url = await tilePicture(p, photosOf(p, this.logged));
    if (url) {
      box.style.backgroundImage = `url("${url}")`;
      box.classList.add("filled");
    }
  }

  private renderFacets(): void {
    const count = (s: Status) => this.projects.filter((p) => p.status === s).length;
    // Plans have their own list.
    this.root.querySelector('[data-el="status"]')!.innerHTML = PROJECT_STATUSES.map((x) => x.value)
      .filter((s) => s !== "planned")
      .map(
        (s) => `
          <label class="check${count(s) ? "" : " unused"}">
            <input type="checkbox" data-filter="status" value="${s}" ${this.status.has(s) ? "checked" : ""} />
            <span>${projectStatusLabel(s)}</span>
            <em>${count(s)}</em>
          </label>`,
      )
      .join("");
  }

  private paint(): void {
    const plans = kept.mode === "plans";
    const gallery = kept.mode === "gallery";
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="mode"]')) b.classList.toggle("on", b.dataset.mode === kept.mode);
    this.root.classList.toggle("plans-mode", plans);
    this.root.classList.toggle("gallery-mode", gallery);
    this.root.querySelector('[data-act="add"]')!.textContent = plans ? "+ New plan" : "+ New project";
    (this.root.querySelector('[data-act="add"]') as HTMLElement).hidden = gallery;
    (this.root.querySelector('[data-act="sort-plans"]') as HTMLElement).hidden = !plans;
    (this.root.querySelector('[data-act="show-hidden"]') as HTMLElement).hidden = !gallery;
    if (plans) return this.paintPlans();
    if (gallery) return this.paintGallery();
    const shown = this.projects.filter((p) => {
      if (p.status === "planned") return false;
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
    paintLazily(this.results, shown, (p) => this.cardHtml(p), {
      pictures: ".project-card",
      paint: (card) => this.paintCover(card),
    });
  }

  /** The plans, in their order, to drag into another; each started with a click. */
  private paintPlans(): void {
    const words = this.search.split(/\s+/).filter(Boolean);
    const plans = this.plans().filter((p) => {
      const text = [p.name, p.patternTitle, p.notes, p.planWhen, ...p.yarns.map((y) => y.yarnName)].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (!plans.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${this.plans().length ? "No plan by that name" : "No plans yet"}</h2>
          <p>${this.plans().length ? "Try another word." : "What to knit next: a pattern (or just an idea), yarn from the stash, and when. Make one here, from a pattern's ⋯ menu (Plan it), or from a yarn planned for something."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = `
      <p class="hint plan-hint">Drag a plan by its handle into the order you mean to knit them. Its yarn is meant for it, not in use, until you start it.</p>
      <ol class="plan-list">${plans
        .map((p) => {
          const yarn = p.yarns.map((y) => `${y.yarnName}${y.plannedGrams ? ` (${y.plannedGrams} g)` : ""}`).join(", ");
          const when = planTime(p);
          return `
          <li class="plan-row" draggable="${words.length ? "false" : "true"}" data-plan="${p.id}" data-open="${p.id}">
            <span class="plan-grip" title="Drag to move it" aria-hidden="true">⋮⋮</span>
            <div class="plan-main">
              <h3>${escapeHtml(p.name)}</h3>
              <p>${p.patternId ? escapeHtml(p.patternTitle) : `<em>No pattern yet</em>`}${yarn ? ` · ${escapeHtml(yarn)}` : ""}</p>
            </div>
            <span class="plan-when${when ? "" : " none"}">${when ? escapeHtml(when) : "Some time"}</span>
            <button class="ghost" data-act="start-plan" data-id="${p.id}" title="Start knitting it: from today, its pattern in progress, its yarn in use">Start knitting</button>
          </li>`;
        })
        .join("")}</ol>`;
  }

  /** Dragging a plan by its handle moves it; dropped, the order is kept. */
  private wireDrag(): void {
    let dragged: HTMLElement | null = null;
    this.root.addEventListener("dragstart", (e) => {
      dragged = closestEl(e.target, ".plan-row");
      if (!dragged) return;
      dragged.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", dragged.dataset.plan ?? "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    this.root.addEventListener("dragover", (e) => {
      const over = closestEl(e.target, ".plan-row");
      if (!dragged || !over || over === dragged) return;
      e.preventDefault();
      const r = over.getBoundingClientRect();
      over.parentElement!.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    });
    this.root.addEventListener("dragend", () => void this.dropped());
    this.root.addEventListener("drop", (e) => {
      if (dragged) e.preventDefault();
    });
    const done = () => {
      dragged?.classList.remove("dragging");
      dragged = null;
    };
    this.dropped = async () => {
      if (!dragged) return;
      done();
      await this.saveOrder([...this.root.querySelectorAll<HTMLElement>(".plan-row")].map((r) => r.dataset.plan!));
    };
  }

  private dropped: () => Promise<void> = async () => {};

  /** Keeps the plans in this order. */
  private async saveOrder(ids: string[]): Promise<void> {
    try {
      await api.setPlanOrder(ids);
      ids.forEach((id, i) => {
        const p = this.projects.find((x) => x.id === id);
        if (p) p.planOrder = i + 1;
      });
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Plans");
    }
    this.paint();
  }

  /** Plans with an exact date first, the soonest first; the rest keep their order after them. */
  private async sortPlans(): Promise<void> {
    const plans = this.plans();
    const dated = plans.filter((p) => p.planDate).sort((a, b) => a.planDate! - b.planDate!);
    await this.saveOrder([...dated, ...plans.filter((p) => !p.planDate)].map((p) => p.id));
  }

  /** A plan started: knitted from today; its page opens, to choose its needles. */
  private async startPlan(id: string): Promise<void> {
    try {
      await api.setProjectStatus(id, "active");
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Start knitting"));
    }
    this.root.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
  }

  /** A card's picture: the project's own cover, else its pattern's. */
  private async paintCover(card: HTMLElement): Promise<void> {
    const p = this.projects.find((x) => x.id === card.dataset.open);
    const box = card.querySelector<HTMLElement>(".project-card-cover");
    if (!p || !box) return;
    const url = p.coverPath ? await projectCoverUrl(p.id) : p.patternId ? await coverUrl(p.patternId) : null;
    if (url) {
      box.style.backgroundImage = `url("${url}")`;
      box.classList.add("filled");
    }
  }

  private cardHtml(p: Project): string {
    const finished = isRecord(p.status);
    const tools = p.toolIds.length;
    const on = [
      tools ? `${tools} ${tools === 1 ? "needle or hook" : "needles & hooks"}` : "",
      p.yarns.length ? `${p.yarns.length} ${p.yarns.length === 1 ? "yarn" : "yarns"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const dates = finished
      ? `${projectStatusLabel(p.status)} ${longDate(p.finishedAt ?? p.startedAt)}`
      : `Started ${longDate(p.startedAt)}`;
    return `
      <article class="project-card ${p.status}" data-open="${p.id}">
        <div class="project-card-cover"><span>${escapeHtml(p.name.slice(0, 1).toUpperCase())}</span></div>
        <div class="project-head">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="pill project-${p.status}">${projectStatusLabel(p.status)}</span>
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

/** "autumn · 12 November 2026": a plan's time as said, and its date. */
function planTime(p: Project): string {
  return [p.planWhen, p.planDate ? longDate(p.planDate) : ""].filter(Boolean).join(" · ");
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
