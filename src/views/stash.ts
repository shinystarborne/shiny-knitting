import { api, type Yarn, type YarnFilter, type YarnWeightFacet } from "../api";
import { askYesNo } from "../dialogs";
import { closestEl } from "../dom";
import { forgetYarnPhoto, yarnPhotoUrl } from "../covers";

/**
 * The stash screen: every yarn you own, with what is left of it.
 *
 * Visually it is the library's twin — same header bar, same facet sidebar,
 * same card grid — because the two answer the same kind of question, and the
 * shared `.library` class is what hands the results pane its scrolling height.
 * The differences are the data: quantities are weighed grams, not pages, and
 * the filter is a single group, since weight is the only axis a stash is
 * searched on.
 */
export class StashView {
  /**
   * The screen this view is mounted into.
   *
   * Like the library, the stash renders into a child element rather than
   * writing over the screen. The screen carries the `flex`/`min-height` chain
   * that makes a scrolling pane work; overwriting its class breaks the height
   * and the results list stops scrolling.
   */
  private screen: HTMLElement;
  private root!: HTMLElement;
  private filter: YarnFilter = {};
  private facets: YarnWeightFacet[] = [];
  private yarns: Yarn[] = [];
  /** Ticked availability boxes; filtered here, over what the backend sent. */
  private use = new Set<Use>();
  private results!: HTMLElement;
  private searchBox!: HTMLInputElement;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library stash";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Stash</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search name, brand, colourway..." />
          <button data-act="add" class="primary">+ Add yarn</button>
        </div>
      </header>

      <div class="lib-body">
        <aside class="filters">
          <div class="filter-group" data-slot="use">
            <h4>Availability</h4>
            <div class="facet-list weight-scale"></div>
          </div>
          <div class="filter-group" data-slot="yarn">
            <h4>Yarn weight</h4>
            <div class="facet-list weight-scale"></div>
          </div>
          <button class="ghost clear-filters" data-act="clear">Clear filters</button>
        </aside>

        <main class="results"></main>
      </div>
    `;

    // Attached last, so the whole view is in place before it goes on screen.
    this.screen.appendChild(this.root);

    this.results = this.root.querySelector(".results")!;
    this.searchBox = this.root.querySelector(".search")!;

    this.searchBox.addEventListener("input", () => {
      this.filter.search = this.searchBox.value || undefined;
      void this.reload();
    });

    this.root.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.filter === "use") {
        if (input.checked) this.use.add(input.value as Use);
        else this.use.delete(input.value as Use);
        this.paint();
        void this.loadPhotos();
        return;
      }
      if (input.dataset.filter !== "yarnWeight") return;
      const checked = this.checkedValues();
      this.filter.yarnWeight = checked.length ? checked : undefined;
      void this.reload();
    });

    this.root.addEventListener("click", (e) => this.onClick(e));

    this.facets = await api.yarnFacets();
    this.renderFacets();
    await this.reload();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") {
        this.root.dispatchEvent(new CustomEvent("add-yarn", { bubbles: true }));
      } else if (act === "clear") {
        this.filter = {};
        this.use.clear();
        this.searchBox.value = "";
        this.root
          .querySelectorAll<HTMLInputElement>("input[data-filter]")
          .forEach((i) => (i.checked = false));
        await this.reload();
      }
      return;
    }

    // Checked before the card itself, because the Remove button lives inside
    // the card: with this the other way round, clicking Remove opens the edit
    // form instead of removing, and the delete handler is never reached.
    const colour = closestEl(e.target, "[data-colour]");
    if (colour) {
      e.stopPropagation();
      const yarn = this.yarns.find((y) => y.id === colour.dataset.colour);
      if (yarn) this.root.dispatchEvent(new CustomEvent("add-yarn", { bubbles: true, detail: yarn }));
      return;
    }

    const del = closestEl(e.target, "[data-delete]");
    if (del) {
      e.stopPropagation();
      await this.confirmRemove(del.dataset.delete!);
      return;
    }

    const card = closestEl(e.target, "[data-open]");
    if (card) {
      const yarn = this.yarns.find((y) => y.id === card.dataset.open);
      if (yarn) {
        this.root.dispatchEvent(new CustomEvent("edit-yarn", { bubbles: true, detail: yarn }));
      }
    }
  }

  // ---------- listing ----------

  private renderFacets(): void {
    // The same weight scale the library filters patterns on, counts included,
    // so "could I knit this in something I have?" reads off one table. An
    // unused family is dimmed rather than hidden.
    this.root.querySelector('[data-slot="yarn"] .facet-list')!.innerHTML = this.facets
      .map(
        (w) => `
          <label class="check${w.count ? "" : " unused"}">
            <input type="checkbox" data-filter="yarnWeight" value="${escapeHtml(w.key)}" />
            <span>${escapeHtml(w.label)}</span>
            <em>${w.count}</em>
          </label>`,
      )
      .join("");

    YARN_LABELS.clear();
    for (const w of this.facets) YARN_LABELS.set(w.key, w.label);
  }

  /** The ticked weight families; the boxes are the source of truth. */
  private checkedValues(): string[] {
    return [...this.root.querySelectorAll<HTMLInputElement>(
      'input[data-filter="yarnWeight"]:checked',
    )].map((i) => i.value);
  }

  /**
   * Incremented on every reload. Listing is async, so two quick changes — a
   * search keystroke while a filter query is still running, say — would
   * otherwise resolve out of order and the older, slower response would
   * paint over the newer one. Each reload captures this value and abandons
   * its result if it is no longer current.
   */
  private listToken = 0;

  private async reload(): Promise<void> {
    const token = ++this.listToken;
    const yarns = await api.listYarns(this.filter);
    if (token !== this.listToken) return;
    this.yarns = yarns;
    this.paint();
    await this.loadPhotos();
  }

  /**
   * The availability boxes. Counted over what the other filters let through,
   * since these narrow that list rather than the whole stash.
   */
  private renderUse(): void {
    const count = (u: Use) => this.yarns.filter((y) => useOf(y).includes(u)).length;
    const labels: Record<Use, string> = { free: "Free", "in-use": "In use", leftover: "Leftover" };
    this.root.querySelector('[data-slot="use"] .facet-list')!.innerHTML = (["free", "in-use", "leftover"] as Use[])
      .map(
        (u) => `
          <label class="check${count(u) ? "" : " unused"}">
            <input type="checkbox" data-filter="use" value="${u}" ${this.use.has(u) ? "checked" : ""} />
            <span>${labels[u]}</span>
            <em>${count(u)}</em>
          </label>`,
      )
      .join("");
  }

  private paint(): void {
    this.renderUse();
    const yarns = this.use.size ? this.yarns.filter((y) => useOf(y).some((u) => this.use.has(u))) : this.yarns;
    if (!yarns.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${
            this.filter.search || this.filter.yarnWeight || this.use.size
              ? "Nothing matches those filters"
              : "No yarn yet"
          }</h2>
          <p>${
            this.filter.search || this.filter.yarnWeight || this.use.size
              ? "Try removing a filter."
              : "Add a yarn to get started."
          }</p>
        </div>`;
      return;
    }

    this.results.innerHTML = yarns.map((y) => this.cardHtml(y)).join("");
  }

  private cardHtml(y: Yarn): string {
    const where = [y.brand, y.colourway].filter(Boolean).join(" · ");
    return `
      <article class="card" data-open="${y.id}">
        <div class="cover" data-id="${y.id}">
          <div class="cover-photo" data-el="photo"></div>
          <div class="cover-fallback format-yarn">
            <span>${escapeHtml(familyLabel(y))}</span>
          </div>
        </div>
        <div class="card-body">
          <h3>${escapeHtml(y.name)}</h3>
          <p class="designer">${where ? escapeHtml(where) : "No brand"}</p>
          <div class="card-meta">
            ${yarnPill(y)}
            ${y.lots.some((l) => l.leftover) ? `<span class="pill yarn-leftover" title="What a finished project left over">Leftover</span>` : ""}
          </div>
          ${
            y.projects.length
              ? `<p class="card-use" title="${escapeHtml(y.projects.join(", "))}">In use: ${escapeHtml(y.projects.join(", "))}</p>`
              : ""
          }
          <p class="card-qty">${escapeHtml(quantityLine(y))}</p>
          <p class="card-lots">${y.lots.length} lot${y.lots.length === 1 ? "" : "s"}</p>
          <div class="card-tools-row">
            <button class="card-remove card-colour" data-colour="${y.id}"
              title="Add another colour of this yarn: brand, weight and ball band filled in">+ Colour</button>
            <button class="card-remove" data-delete="${y.id}"
              title="Remove this yarn from your stash">Remove</button>
          </div>
        </div>
      </article>`;
  }

  /**
   * Fills in photos. Loaded after the cards so the grid appears at once with
   * a placeholder, rather than waiting on a read per yarn.
   */
  private async loadPhotos(): Promise<void> {
    for (const yarn of this.yarns) {
      if (!yarn.photoPath) continue;
      const host = this.results.querySelector(
        `.cover[data-id="${yarn.id}"] [data-el="photo"]`,
      ) as HTMLElement | null;
      if (!host) continue;
      const url = await yarnPhotoUrl(yarn.id);
      if (!url) continue;
      host.style.backgroundImage = `url("${url}")`;
      host.parentElement?.classList.add("has-cover");
    }
  }

  private async confirmRemove(id: string): Promise<void> {
    const yarn = this.yarns.find((y) => y.id === id);
    const name = yarn ? `"${yarn.name}"` : "this yarn";
    if (
      !(await askYesNo(
        `Remove ${name} from your stash?\n\nIts photo will be deleted too. This cannot be undone.`,
        { title: "Remove yarn", okLabel: "Remove", danger: true },
      ))
    ) {
      return;
    }
    await api.deleteYarn(id);
    forgetYarnPhoto(id);
    this.facets = await api.yarnFacets();
    this.renderFacets();
    await this.reload();
  }
}

/** Whether a yarn is free, on an active project, and holds a leftover. */
type Use = "free" | "in-use" | "leftover";

function useOf(y: Yarn): Use[] {
  const out: Use[] = [y.projects.length ? "in-use" : "free"];
  if (y.lots.some((l) => l.leftover)) out.push("leftover");
  return out;
}

/**
 * Family key to label, filled in from the facets the backend sends.
 *
 * The labels live in the standard weight table on the Rust side and travel out
 * with the facets, so "DK" and "Super chunky" are spelled in exactly one
 * place rather than duplicated here.
 */
const YARN_LABELS = new Map<string, string>();

/** What the photo placeholder shows when there is no photo. */
function familyLabel(y: Yarn): string {
  return YARN_LABELS.get(y.yarnWeightFamily ?? "") ?? (y.yarnWeight || "Yarn");
}

/**
 * The yarn weight pill. Mirrors the library's: the family label is preferred,
 * because that is how a knitter thinks about it and it lines up with the
 * filter; a weight the table does not recognise is shown as written.
 */
function yarnPill(y: Yarn): string {
  const stated = (y.yarnWeight ?? "").trim();
  if (!stated) return "";
  const family = y.yarnWeightFamily ?? "";
  const label = YARN_LABELS.get(family) ?? stated;
  if (!label) return "";
  const saysMore = stated.toLowerCase() !== label.toLowerCase();
  const title = saysMore ? ` title="${escapeHtml(stated)}"` : "";
  return `<span class="pill weight"${title}>${escapeHtml(label)}</span>`;
}

/**
 * The quantity line: "3 × 100 g · 240 g left · ~530 m".
 *
 * The figures come from the backend already summed and derived — grams left
 * is weighed, so a partial ball counts as what is left of it, and the metres
 * are what those grams work out to, not what the balls once held.
 */
function quantityLine(y: Yarn): string {
  const parts: string[] = [];
  if (y.ballsTotal > 0) {
    parts.push(
      y.gramsPerBall > 0
        ? `${fmt(y.ballsTotal)} × ${fmt(y.gramsPerBall)} g`
        : `${fmt(y.ballsTotal)} ball${y.ballsTotal === 1 ? "" : "s"}`,
    );
  }
  if (y.gramsLeft > 0) parts.push(`${fmt(y.gramsLeft)} g left`);
  if (y.metresLeft > 0) parts.push(`~${fmt(y.metresLeft)} m`);
  return parts.join(" · ") || "No quantities yet";
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
