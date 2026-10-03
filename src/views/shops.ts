import { api, type Shop } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { filterShops, namedAfterAddress, shopTagFacets, siteOf, type Facet } from "./shopping";

/**
 * The Shops tab: the shops you buy from, with your own tags and comments.
 *
 * The search looks through the comments and tags as well as the names and
 * addresses, so "deadstock" or "Drops" finds the shops you said that about;
 * the tags down the side narrow to the shops that have every one ticked, and
 * a tag on a card ticks it. A card opens the shop in the browser from its
 * address, and its wishlist count goes to the Wishlist filtered to that shop.
 * Shops still named after their address can have their own names looked up,
 * all at once.
 */
export class ShopsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private shops: Shop[] = [];
  private search = "";
  /** The ticked tags, lower case. */
  private tags: string[] = [];
  private results!: HTMLElement;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library shops";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Shops</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search shops, tags, comments..." />
          <button data-act="lookup-names" class="ghost" hidden title="Name the shops still named after their address, from their own pages">Look up names</button>
          <button data-act="add" class="primary">+ Add a shop</button>
        </div>
      </header>
      <div class="lib-body">
        <aside class="filters">
          <div class="filter-group" data-group="tags">
            <h4>Tags</h4>
            <div class="facet-list weight-scale"></div>
          </div>
          <button class="ghost clear-filters" data-act="clear">Clear filters</button>
        </aside>
        <main class="results shop-grid"></main>
      </div>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value;
      this.paint();
    });
    this.root.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.filter !== "tag") return;
      this.setTag(input.value, input.checked);
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    await this.reload();
  }

  /** Reads the shops again, keeping the search and tags; after a form saved over it. */
  async reload(): Promise<void> {
    this.shops = await api.listShops();
    this.renderFacets();
    this.paint();
    const lookup = this.root.querySelector<HTMLButtonElement>('[data-act="lookup-names"]')!;
    if (!lookup.disabled) lookup.hidden = !this.shops.some(namedAfterAddress);
  }

  /**
   * Names every shop still named after its address from its own home page,
   * one at a time, the button counting. A shop whose page does not say, or
   * will not be read, keeps its name; anything can still be renamed by hand.
   */
  private async lookUpNames(button: HTMLButtonElement): Promise<void> {
    const todo = this.shops.filter(namedAfterAddress);
    if (!todo.length) return;
    button.disabled = true;
    let named = 0;
    const kept: string[] = [];
    for (const [i, shop] of todo.entries()) {
      button.textContent = `Looking up ${i + 1} of ${todo.length}…`;
      const name = await api.fetchShopName(shop.url).catch(() => "");
      if (!name || name.toLowerCase() === shop.name.trim().toLowerCase()) {
        kept.push(shop.name);
        continue;
      }
      try {
        await api.updateShop(shop.id, { name, url: shop.url, comment: shop.comment, tags: shop.tags });
        named++;
      } catch {
        kept.push(shop.name);
      }
    }
    button.disabled = false;
    button.textContent = "Look up names";
    await this.reload();
    const message = [
      named ? `Named ${named === 1 ? "1 shop" : `${named} shops`} from their own pages.` : "No shop could be named from its page.",
      kept.length ? `${kept.length === 1 ? "This one keeps its address" : "These keep their addresses"} as the name: ${kept.join(", ")}. Some shops do not say their name, or will not let apps read their pages; rename them by hand.` : "",
    ];
    await say(message.filter(Boolean).join("\n\n"), "Look up names");
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") this.emit("add-shop", undefined);
      if (act === "lookup-names") await this.lookUpNames(btn as HTMLButtonElement);
      if (act === "clear") {
        this.search = "";
        this.root.querySelector<HTMLInputElement>(".search")!.value = "";
        this.tags = [];
        this.renderFacets();
        this.paint();
      }
      if (act === "tag") this.setTag(btn.dataset.tag ?? "", !this.tags.includes(btn.dataset.tag ?? ""));
      if (act === "visit") {
        await api.openLink(btn.dataset.url ?? "").catch((err) => say(err instanceof Error ? err.message : String(err), "Open shop"));
      }
      if (act === "wishlist") this.emit("open-wishlist", { shop: [btn.dataset.id] });
      if (act === "remove") await this.remove(btn.dataset.id ?? "");
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    const shop = card && this.shops.find((s) => s.id === card.dataset.open);
    if (shop) this.emit("edit-shop", shop);
  }

  private emit(name: string, detail: unknown): void {
    this.root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  private setTag(key: string, on: boolean): void {
    if (!key) return;
    this.tags = on ? [...new Set([...this.tags, key])] : this.tags.filter((t) => t !== key);
    this.renderFacets();
    this.paint();
  }

  private renderFacets(): void {
    const facets = shopTagFacets(this.shops);
    // A tag no shop has any more is no longer a filter.
    this.tags = this.tags.filter((t) => facets.some((f) => f.key === t));
    this.root.querySelector(".facet-list")!.innerHTML = facets.length
      ? facets.map((f) => facetHtml(f, this.tags.includes(f.key))).join("")
      : `<p class="hint">Give a shop tags — yarn, needles, deadstock, sale — and they are here to filter by.</p>`;
  }

  private paint(): void {
    const shown = filterShops(this.shops, this.search, this.tags);
    if (!shown.length) {
      const searching = (!!this.search.trim() || this.tags.length > 0) && this.shops.length > 0;
      this.results.innerHTML = `
        <div class="empty">
          <h2>${searching ? "No shop matches that" : "No shops yet"}</h2>
          <p>${searching ? "The search looks through names, addresses, tags and your comments." : "Add the shops you buy from, with a comment on each: what is cheap there, what they are good for."}</p>
        </div>`;
      return;
    }
    this.results.innerHTML = shown.map((s) => cardHtml(s, this.tags)).join("");
    fitTags(this.results);
  }

  private async remove(id: string): Promise<void> {
    const shop = this.shops.find((s) => s.id === id);
    if (!shop) return;
    const items = shop.wanted ? `\n\nThe ${shop.wanted === 1 ? "thing" : `${shop.wanted} things`} on the wishlist from here stay on it, with no shop.` : "";
    const ok = await askYesNo(`Remove ${shop.name}?${items}`, { title: "Remove shop", okLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.deleteShop(id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Remove shop");
    }
    await this.reload();
  }
}

function facetHtml(f: Facet, checked: boolean): string {
  return `
    <label class="check">
      <input type="checkbox" data-filter="tag" value="${escapeHtml(f.key)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(f.label)}</span>
      <em>${f.count}</em>
    </label>`;
}

function cardHtml(s: Shop, ticked: string[]): string {
  const site = siteOf(s.url);
  const wanted = s.wanted === 1 ? "1 thing on your wishlist" : `${s.wanted} things on your wishlist`;
  // Ticked tags first, so the ones filtered by are never folded away.
  const tags = [...s.tags]
    .sort((a, b) => Number(ticked.includes(b.toLowerCase())) - Number(ticked.includes(a.toLowerCase())))
    .map((t) => {
      const key = t.toLowerCase();
      const on = ticked.includes(key);
      return `<button class="tag shop-tag${on ? " on" : ""}" data-act="tag" data-tag="${escapeHtml(key)}" title="${on ? "Stop filtering by" : "Show only shops tagged"} ${escapeHtml(t)}">${escapeHtml(t)}</button>`;
    })
    .join("");
  return `
    <article class="shop-card" data-open="${escapeHtml(s.id)}">
      <h3 class="shop-name">${escapeHtml(s.name)}</h3>
      ${
        s.url
          ? `<button class="link shop-site" data-act="visit" data-url="${escapeHtml(s.url)}" title="Open ${escapeHtml(s.url)}">${escapeHtml(site || s.url)} ↗</button>`
          : `<span class="shop-site none">No web address</span>`
      }
      ${tags ? `<div class="shop-tags">${tags}</div>` : ""}
      <p class="shop-comment">${s.comment ? escapeHtml(s.comment) : `<span class="hint">No comment yet.</span>`}</p>
      <div class="card-tools-row">
        ${s.wanted ? `<button class="card-remove shop-wanted" data-act="wishlist" data-id="${escapeHtml(s.id)}" title="See them on the Wishlist">${wanted}</button>` : ""}
        <span class="spacer"></span>
        <button class="card-remove" data-act="remove" data-id="${escapeHtml(s.id)}" title="Remove this shop">Remove</button>
      </div>
    </article>`;
}

/**
 * Two rows of tags fit on a card; the rest fold into a "+N" that names them
 * when pointed at, and the card itself opens them all. Measured once the
 * cards are painted, since how many fit depends on the words.
 */
function fitTags(host: HTMLElement): void {
  for (const box of host.querySelectorAll<HTMLElement>(".shop-tags")) {
    const chips = [...box.querySelectorAll<HTMLElement>(".shop-tag")];
    // Against the box's limit, not its height: once chips are hidden the box
    // shrinks to what is left, and then nothing at its bottom edge "fits".
    // Exact positions, too: a chip is 22.5 px, which offsetHeight rounds up.
    const limit = parseFloat(getComputedStyle(box).maxHeight) || box.clientHeight;
    const fits = (el: HTMLElement) => el.getBoundingClientRect().bottom - box.getBoundingClientRect().top <= limit + 0.5;
    const hidden = chips.filter((c) => !fits(c));
    if (!hidden.length) continue;
    hidden.forEach((c) => (c.hidden = true));
    const more = document.createElement("span");
    more.className = "tag shop-tag-more";
    box.appendChild(more);
    const label = () => {
      more.textContent = `+${hidden.length}`;
      more.title = hidden.map((c) => c.textContent).join(", ");
    };
    label();
    // The count needs room of its own: give it the last tag's place until it fits.
    const shown = chips.filter((c) => !c.hidden);
    while (!fits(more) && shown.length) {
      const last = shown.pop()!;
      last.hidden = true;
      hidden.unshift(last);
      label();
    }
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
