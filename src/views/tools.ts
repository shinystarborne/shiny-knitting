import { api, type Tool } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import {
  describe,
  filterTools,
  headline,
  isFiltering,
  isFree,
  kindLabel,
  materialLabel,
  measurements,
  projectName,
  toolFacets,
  type Facet,
  type ToolFilter,
} from "./tool-filter";

type Group = "use" | "kind" | "size" | "material" | "cableSize" | "brand";

/** The filter groups down the side, in the order they are shown. */
const GROUPS: { key: Group; title: string }[] = [
  { key: "use", title: "Availability" },
  { key: "kind", title: "Kind" },
  { key: "size", title: "Size" },
  { key: "material", title: "Material" },
  { key: "cableSize", title: "Cable size" },
  { key: "brand", title: "Brand" },
];

/**
 * The needles and hooks screen: everything in the box, what each one is on,
 * and which are free.
 *
 * Laid out as the library and the stash are -- header, filters down the side,
 * a grid of cards -- with smaller cards, since a needle has no cover to show.
 */
export class ToolsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private tools: Tool[] = [];
  private filter: ToolFilter = {};
  private results!: HTMLElement;
  private searchBox!: HTMLInputElement;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library tools";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Needles &amp; hooks</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search size, brand, project..." />
          <button data-act="add" class="primary">+ Add needle or hook</button>
        </div>
      </header>

      <div class="lib-body">
        <aside class="filters">
          ${GROUPS.map(
            (g) => `
              <div class="filter-group" data-group="${g.key}">
                <h4>${g.title}</h4>
                <div class="facet-list weight-scale"></div>
              </div>`,
          ).join("")}
          <button class="ghost clear-filters" data-act="clear">Clear filters</button>
        </aside>

        <main class="results tool-grid"></main>
      </div>
    `;
    this.screen.appendChild(this.root);

    this.results = this.root.querySelector(".results")!;
    this.searchBox = this.root.querySelector(".search")!;

    this.searchBox.addEventListener("input", () => {
      this.filter.search = this.searchBox.value || undefined;
      this.paint();
    });
    this.root.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const group = input.dataset.filter as Group | undefined;
      if (!group) return;
      const ticked = [...this.root.querySelectorAll<HTMLInputElement>(`input[data-filter="${group}"]:checked`)].map(
        (i) => i.value,
      );
      (this.filter as Record<string, unknown>)[group] = ticked.length ? ticked : undefined;
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));

    await this.reload();
  }

  private async reload(): Promise<void> {
    this.tools = await api.listTools();
    this.renderFacets();
    this.paint();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") this.root.dispatchEvent(new CustomEvent("add-tool", { bubbles: true }));
      if (act === "clear") {
        this.filter = {};
        this.searchBox.value = "";
        this.root.querySelectorAll<HTMLInputElement>("input[data-filter]").forEach((i) => (i.checked = false));
        this.paint();
      }
      if (act === "free") await this.free(btn.dataset.id!);
      if (act === "remove") await this.remove(btn.dataset.id!);
      if (act === "open-pattern") {
        this.root.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: btn.dataset.pattern }));
      }
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    if (card) {
      const tool = this.tools.find((t) => t.id === card.dataset.open);
      if (tool) this.root.dispatchEvent(new CustomEvent("edit-tool", { bubbles: true, detail: tool }));
    }
  }

  // ---------- filters ----------

  private renderFacets(): void {
    const facets = toolFacets(this.tools);
    for (const g of GROUPS) {
      const holder = this.root.querySelector(`[data-group="${g.key}"]`) as HTMLElement;
      const list = facets[g.key];
      // Sizes and brands only exist once something is owned in them.
      holder.hidden = !list.length;
      const ticked = new Set((this.filter[g.key] as string[] | undefined) ?? []);
      holder.querySelector(".facet-list")!.innerHTML = list.map((f) => facetHtml(g.key, f, ticked.has(f.key))).join("");
    }
  }

  // ---------- cards ----------

  private paint(): void {
    const shown = filterTools(this.tools, this.filter);
    if (!shown.length) {
      const filtering = isFiltering(this.filter) && this.tools.length > 0;
      this.results.innerHTML = `
        <div class="empty">
          <h2>${filtering ? "Nothing matches those filters" : "No needles or hooks yet"}</h2>
          <p>${filtering ? "Try removing a filter." : "Add what is in your box, and you will always know what is free."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = shown.map(cardHtml).join("");
  }

  /** Frees a tool from its project, from the card, without opening the form. */
  private async free(id: string): Promise<void> {
    try {
      const updated = await api.setToolProject(id, null);
      this.tools = this.tools.map((t) => (t.id === id ? updated : t));
    } catch (e) {
      await say(e instanceof Error ? e.message : String(e), "Needles & hooks");
      return;
    }
    this.renderFacets();
    this.paint();
  }

  private async remove(id: string): Promise<void> {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) return;
    if (
      !(await askYesNo(`Remove the ${describe(tool)}?\n\nThis cannot be undone.`, {
        title: "Remove needle or hook",
        okLabel: "Remove",
        danger: true,
      }))
    ) {
      return;
    }
    await api.deleteTool(id);
    await this.reload();
  }
}

function facetHtml(group: Group, f: Facet, checked: boolean): string {
  return `
    <label class="check${f.count ? "" : " unused"}">
      <input type="checkbox" data-filter="${group}" value="${escapeHtml(f.key)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(f.label)}</span>
      <em>${f.count}</em>
    </label>`;
}

function cardHtml(t: Tool): string {
  const free = isFree(t);
  const dims = measurements(t);
  const make = [t.brand, t.material ? materialLabel(t.material) : ""].filter(Boolean).join(" · ");
  const project = projectName(t);
  const use = free
    ? `<span class="pill tool-free">Free</span>`
    : t.patternId
      ? `<span class="tool-use-label">On</span>
         <button class="link tool-project" data-act="open-pattern" data-pattern="${escapeHtml(t.patternId)}"
           title="Open this pattern">${escapeHtml(project)}</button>`
      : `<span class="tool-use-label">On</span> <span class="tool-project">${escapeHtml(project)}</span>`;
  return `
    <article class="tool-card${free ? " free" : " in-use"}" data-open="${t.id}" title="${escapeHtml(t.notes)}">
      <div class="tool-head">
        <span class="tool-size">${escapeHtml(headline(t))}</span>
        <span class="tool-kind">${escapeHtml(kindLabel(t.kind))}</span>
      </div>
      <p class="tool-dims">${dims ? escapeHtml(dims) : "&nbsp;"}</p>
      <p class="tool-make">${make ? escapeHtml(make) : "No brand"}</p>
      <div class="tool-use">${use}</div>
      <div class="card-tools-row">
        ${free ? "" : `<button class="card-remove tool-free-btn" data-act="free" data-id="${t.id}" title="Take it off this project">Free it</button>`}
        <button class="card-remove" data-act="remove" data-id="${t.id}" title="Remove this from your box">Remove</button>
      </div>
    </article>`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
