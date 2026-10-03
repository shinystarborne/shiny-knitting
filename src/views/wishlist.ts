import { api, type Wish } from "../api";
import { askYesNo, say } from "../dialogs";
import { wishPhotoUrl } from "../covers";
import { closestEl } from "../dom";
import { longDate } from "./project-form";
import { filterWishes, isFiltering, kindLabel, siteOf, wishFacets, type Facet, type WishFilter } from "./shopping";

type Group = "kind" | "shop" | "project";

/** The filter groups down the side, in the order they are shown. */
const GROUPS: { key: Group; title: string }[] = [
  { key: "kind", title: "Kind" },
  { key: "shop", title: "Shop" },
  { key: "project", title: "For" },
];

/** Whether what was got is shown, kept for the session across tabs. */
let showGot = true;

/**
 * The Wishlist tab: what you want to get, and where from.
 *
 * Laid out as the needles and hooks are: filters down the side and a grid of
 * small cards. What is still wanted comes first; ticking "Got it" moves a
 * card down to the Got section, dated, where it stays until it is removed,
 * as a record of what was bought.
 */
export class WishlistView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private wishes: Wish[] = [];
  private filter: WishFilter;
  private results!: HTMLElement;
  private searchBox!: HTMLInputElement;

  constructor(screen: HTMLElement, filter: WishFilter = {}) {
    this.screen = screen;
    this.filter = filter;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library wishlist";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Wishlist</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search name, shop, notes..." />
          <button data-act="add" class="primary">+ Add to wishlist</button>
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

        <main class="results wish-grid"></main>
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
      const group = (e.target as HTMLInputElement).dataset.filter as Group | undefined;
      if (!group) return;
      const ticked = [...this.root.querySelectorAll<HTMLInputElement>(`input[data-filter="${group}"]:checked`)].map((i) => i.value);
      this.filter[group] = ticked.length ? ticked : undefined;
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));

    await this.reload();
  }

  /** Reads the list again, keeping the filters; after a form saved over it. */
  async reload(): Promise<void> {
    this.wishes = await api.listWishes();
    this.renderFacets();
    this.paint();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      const id = btn.dataset.id ?? "";
      if (act === "add") this.emit("add-wish", this.startingPoint());
      if (act === "clear") {
        this.filter = {};
        this.searchBox.value = "";
        this.root.querySelectorAll<HTMLInputElement>("input[data-filter]").forEach((i) => (i.checked = false));
        this.paint();
      }
      if (act === "got") await this.setGot(id, true);
      if (act === "want") await this.setGot(id, false);
      if (act === "remove") await this.remove(id);
      if (act === "stash") {
        const wish = this.wishes.find((w) => w.id === id);
        if (wish) this.emit("stash-wish", wish);
      }
      if (act === "toggle-got") {
        showGot = !showGot;
        this.paint();
      }
      if (act === "open-link" || act === "open-shop") {
        await api.openLink(btn.dataset.url ?? "").catch((err) => say(err instanceof Error ? err.message : String(err), "Open link"));
      }
      if (act === "open-project") this.emit("open-project-page", btn.dataset.project);
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    const wish = card && this.wishes.find((w) => w.id === card.dataset.open);
    if (wish) this.emit("edit-wish", wish);
  }

  private emit(name: string, detail: unknown): void {
    this.root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  /**
   * What a new item starts with: whatever one kind, shop or project is
   * filtered to, since that is what is being looked at.
   */
  private startingPoint(): Record<string, string> {
    const only = (list: string[] | undefined) => (list?.length === 1 && list[0] ? list[0] : undefined);
    const start: Record<string, string> = {};
    const kind = only(this.filter.kind);
    const shop = only(this.filter.shop);
    const project = only(this.filter.project);
    if (kind) start.kind = kind;
    if (shop) start.shopId = shop;
    if (project) start.projectId = project;
    return start;
  }

  // ---------- filters ----------

  private renderFacets(): void {
    const facets = wishFacets(this.wishes);
    for (const g of GROUPS) {
      const holder = this.root.querySelector<HTMLElement>(`[data-group="${g.key}"]`)!;
      const list = facets[g.key];
      holder.hidden = !list.length;
      // A filter on something no longer listed (its last item removed) is dropped.
      const keys = new Set(list.map((f) => f.key));
      const kept = this.filter[g.key]?.filter((k) => keys.has(k));
      this.filter[g.key] = kept?.length ? kept : undefined;
      const ticked = new Set(this.filter[g.key] ?? []);
      holder.querySelector(".facet-list")!.innerHTML = list.map((f) => facetHtml(g.key, f, ticked.has(f.key))).join("");
    }
  }

  // ---------- cards ----------

  private paint(): void {
    const shown = filterWishes(this.wishes, this.filter);
    const wanted = shown.filter((w) => w.gotAt === null);
    const got = shown.filter((w) => w.gotAt !== null);
    if (!shown.length) {
      const filtering = isFiltering(this.filter) && this.wishes.length > 0;
      this.results.innerHTML = `
        <div class="empty">
          <h2>${filtering ? "Nothing matches those filters" : "Nothing on the wishlist yet"}</h2>
          <p>${filtering ? "Try removing a filter." : "Save the yarn, needles and patterns you want to get, with where to get them."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = `
      ${wanted.length ? wanted.map(cardHtml).join("") : `<p class="wish-none">Nothing still wanted${isFiltering(this.filter) ? " that matches" : ""}: it is all got.</p>`}
      ${
        got.length
          ? `<div class="wish-section">
              <h3>Got <em>${got.length}</em></h3>
              <button class="ghost" data-act="toggle-got">${showGot ? "Hide" : "Show"}</button>
            </div>
            ${showGot ? got.map(cardHtml).join("") : ""}`
          : ""
      }`;
    this.results.querySelectorAll<HTMLElement>("[data-pic]").forEach((el) => void paintThumb(el));
  }

  private async setGot(id: string, got: boolean): Promise<void> {
    try {
      const updated = await api.setWishGot(id, got);
      // Wanted ones first, then got ones most recent first, as listed.
      this.wishes = this.wishes.filter((w) => w.id !== id);
      if (got) {
        const firstGot = this.wishes.findIndex((w) => w.gotAt !== null);
        this.wishes.splice(firstGot < 0 ? this.wishes.length : firstGot, 0, updated);
      } else {
        this.wishes.unshift(updated);
      }
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Wishlist");
      return;
    }
    this.renderFacets();
    this.paint();
  }

  private async remove(id: string): Promise<void> {
    const wish = this.wishes.find((w) => w.id === id);
    if (!wish) return;
    const ok = await askYesNo(`Take “${wish.name}” off the wishlist?\n\nThis cannot be undone.`, {
      title: "Remove from wishlist",
      okLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWish(id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Wishlist");
    }
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

function cardHtml(w: Wish): string {
  const got = w.gotAt !== null;
  const meta = [w.amount, w.price].filter(Boolean).join(" · ");
  const shop = w.shopId
    ? w.shopUrl
      ? `<button class="link" data-act="open-shop" data-url="${escapeHtml(w.shopUrl)}" title="Open ${escapeHtml(siteOf(w.shopUrl))}">${escapeHtml(w.shopName)}</button>`
      : `<span>${escapeHtml(w.shopName)}</span>`
    : "";
  const project = w.projectId
    ? `<button class="link" data-act="open-project" data-project="${escapeHtml(w.projectId)}" title="Open this project">${escapeHtml(w.projectName)}</button>`
    : "";
  // Yarn and needles that were got can go straight on into where they live.
  const into = w.kind === "yarn" ? "the stash" : w.kind === "tool" ? "Needles & hooks" : "";
  const stash = got && into && !w.stashedAt
    ? `<button class="card-remove wish-stash-btn" data-act="stash" data-id="${escapeHtml(w.id)}" title="Add it to ${into}, filled in from here">+ ${w.kind === "yarn" ? "Add to stash" : "Add to needles"}</button>`
    : "";
  const name = [w.brand, w.name].filter(Boolean).join(" ");
  return `
    <article class="wish-card kind-${escapeHtml(w.kind)}${got ? " got" : ""}" data-open="${escapeHtml(w.id)}" title="${escapeHtml(w.notes)}">
      <div class="wish-top">
        <span class="wish-kind">${escapeHtml(kindLabel(w.kind))}</span>
        ${got ? `<span class="pill wish-got-pill">Got ${escapeHtml(shortDate(w.gotAt!))}</span>` : ""}
      </div>
      <div class="wish-main">
        <div class="wish-text">
          <h3 class="wish-name">${escapeHtml(name)}</h3>
          <p class="wish-meta">${meta ? escapeHtml(meta) : "&nbsp;"}</p>
          ${shop ? `<p class="wish-line"><span class="wish-label">At</span>${shop}</p>` : ""}
          ${project ? `<p class="wish-line"><span class="wish-label">For</span>${project}</p>` : ""}
          ${w.stashedAt && into ? `<p class="wish-line wish-stashed">✓ In ${into}</p>` : w.notes ? `<p class="wish-notes">${escapeHtml(w.notes)}</p>` : ""}
        </div>
        ${w.photoPath ? `<div class="wish-thumb" data-pic data-id="${escapeHtml(w.id)}"></div>` : ""}
      </div>
      <div class="card-tools-row">
        ${!got && w.url ? `<button class="card-remove wish-open" data-act="open-link" data-url="${escapeHtml(w.url)}" title="${escapeHtml(w.url)}">Open link ↗</button>` : ""}
        ${stash}
        <span class="spacer"></span>
        ${
          got
            ? `<button class="card-remove" data-act="want" data-id="${escapeHtml(w.id)}" title="Put it back as still wanted">Want again</button>`
            : `<button class="card-remove wish-got-btn" data-act="got" data-id="${escapeHtml(w.id)}" title="Got it: move it to Got">✓ Got it</button>`
        }
        <button class="card-remove" data-act="remove" data-id="${escapeHtml(w.id)}" title="Take it off the wishlist">Remove</button>
      </div>
    </article>`;
}

/** Shows a card's picture once it is read. */
async function paintThumb(el: HTMLElement): Promise<void> {
  const url = await wishPhotoUrl(el.dataset.id!);
  if (url && el.isConnected) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("filled");
  }
}

/** "3 Oct", or "3 Oct 2025" when it is not this year. */
function shortDate(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : longDate(ts);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
