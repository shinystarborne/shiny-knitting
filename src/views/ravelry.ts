import { api, type RavelryAccount, type RavelryPattern, type RavelryPatternDetail, type RavelryQuery } from "../api";
import { askYesNo, customDialog, say } from "../dialogs";
import { closestEl } from "../dom";

/** The search last made, kept while the app is open. */
const kept: { query: RavelryQuery } = { query: { query: "", craft: "knitting", free: false, sort: "" } };

/**
 * The Ravelry tab: Ravelry searched through its API, the patterns found
 * shown as the app's own cards, with their photos; one opened shows what
 * Ravelry says of it, to put on the wishlist or buy on Ravelry, in the
 * browser. Ravelry's site itself will not be shown inside another app.
 *
 * The knitter signs in with Ravelry once, in the browser (OAuth): an
 * ordinary Ravelry account is all it takes.
 */
export class RavelryView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private account: RavelryAccount = { available: false, connected: false, username: "" };
  private found: RavelryPattern[] = [];
  private page = 1;
  private pages = 1;
  private results = 0;
  /** A search on its way: one started after it wins. */
  private token = 0;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library ravelry";
    this.screen.appendChild(this.root);
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      if (form.dataset.el === "search") void this.search(1);
    });
    this.account = await api.ravelryAccount().catch(() => this.account);
    this.paint();
  }

  destroy(): void {
    this.token++;
    this.root?.remove();
  }

  private paint(): void {
    if (!this.account.connected) return this.paintConnect();
    const q = kept.query;
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Ravelry</h1>
        <div class="lib-actions">
          <span class="hint">Connected as <b>${esc(this.account.username || "unknown")}</b></span>
          <button class="ghost" data-act="disconnect" title="Remove the sign-in">Disconnect</button>
        </div>
      </header>
      <form class="rav-search" data-el="search">
        <input type="search" data-f="query" value="${esc(q.query)}" placeholder="Search Ravelry's patterns: lopapeysa, a designer, raglan cardigan…" aria-label="Search words" />
        <select data-f="craft" aria-label="Craft">
          <option value="knitting" ${q.craft === "knitting" ? "selected" : ""}>Knitting</option>
          <option value="crochet" ${q.craft === "crochet" ? "selected" : ""}>Crochet</option>
          <option value="" ${!q.craft ? "selected" : ""}>Any craft</option>
        </select>
        <select data-f="sort" aria-label="Order">
          <option value="" ${!q.sort ? "selected" : ""}>Best match</option>
          <option value="popular" ${q.sort === "popular" ? "selected" : ""}>Most popular</option>
          <option value="date" ${q.sort === "date" ? "selected" : ""}>Newest</option>
        </select>
        <label class="rav-free"><input type="checkbox" data-f="free" ${q.free ? "checked" : ""} /> Free only</label>
        <button class="primary" type="submit">Search</button>
      </form>
      <div class="rav-results" data-el="results">${this.resultsHtml()}</div>`;
  }

  private resultsHtml(): string {
    if (!this.found.length) return `<div class="empty"><h2>Search Ravelry's patterns</h2><p>Results show here with their photos. Open one for Ravelry's details, add it to the wishlist, or buy it on Ravelry.</p></div>`;
    return `
      <p class="hint rav-count">${this.results.toLocaleString()} pattern${this.results === 1 ? "" : "s"}</p>
      <div class="rav-grid">${this.found
        .map(
          (p) => `
        <button class="rav-card-pattern" data-pattern="${p.id}" title="${esc(p.name)}">
          <span class="rav-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : "🧶"}</span>
          <b>${esc(p.name)}</b>
          <span>${esc(p.designer)}</span>
          ${p.free ? `<i class="pill rav-free-pill">Free</i>` : ""}
        </button>`,
        )
        .join("")}</div>
      ${this.page < this.pages ? `<div class="rav-more"><button class="ghost" data-act="more">More</button></div>` : ""}`;
  }

  /** Not signed in yet: a button to, in the browser. */
  private paintConnect(): void {
    this.root.innerHTML = `
      <header class="lib-bar"><h1>Ravelry</h1></header>
      <div class="rav-connect">
        <section class="rav-card">
          <h2>Sign in with Ravelry</h2>
          ${
            this.account.available
              ? `<p>Search Ravelry's patterns with their photos, and add any to the wishlist. Signing in once with a Ravelry account is needed: Ravelry asks in the browser to allow the app.</p>
                 <div><button class="primary" data-act="sign-in">Sign in with Ravelry</button></div>
                 <p class="hint" data-el="waiting" hidden>Waiting for Ravelry in the browser: allow the app there, then return.</p>
                 <p class="form-error" data-el="error" hidden></p>
                 <p class="hint">Read only: the app searches Ravelry and changes nothing there. Disconnect removes the sign-in.</p>`
              : `<p>This build has no Ravelry sign-in, so Ravelry can't be searched.</p>`
          }
        </section>
      </div>`;
  }

  private async signIn(): Promise<void> {
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="sign-in"]')!;
    const waiting = this.root.querySelector<HTMLElement>('[data-el="waiting"]')!;
    const error = this.root.querySelector<HTMLElement>('[data-el="error"]')!;
    button.disabled = true;
    waiting.hidden = false;
    error.hidden = true;
    try {
      this.account = await api.signInRavelry();
      this.paint();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
      waiting.hidden = true;
      button.disabled = false;
    }
  }

  private async search(page: number): Promise<void> {
    const field = (f: string) => this.root.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`)!;
    kept.query = { query: field("query").value, craft: field("craft").value, sort: field("sort").value, free: field("free").checked };
    const token = ++this.token;
    const out = this.root.querySelector<HTMLElement>('[data-el="results"]')!;
    if (page === 1) out.innerHTML = `<p class="calc-wait">Searching Ravelry…</p>`;
    try {
      const found = await api.searchRavelry({ ...kept.query, page });
      if (token !== this.token) return;
      this.found = page === 1 ? found.patterns : [...this.found, ...found.patterns];
      this.page = found.page;
      this.pages = found.pages;
      this.results = found.results;
      out.innerHTML = this.resultsHtml();
    } catch (err) {
      if (token !== this.token) return;
      out.innerHTML = `<p class="calc-wait">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const card = closestEl(e.target, "[data-pattern]");
    if (card) return this.openPattern(Number(card.dataset.pattern));
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "sign-in") await this.signIn();
    if (act === "more") await this.search(this.page + 1);
    if (act === "disconnect") {
      if (!(await askYesNo("Sign out of Ravelry? Signing in again is needed to search.", { title: "Disconnect Ravelry", okLabel: "Disconnect" }))) return;
      await api.disconnectRavelry().catch(() => {});
      this.account = { ...this.account, connected: false, username: "" };
      this.found = [];
      this.paint();
    }
  }

  /** One pattern, as Ravelry says it: to the wishlist, or to Ravelry to buy. */
  private async openPattern(id: number): Promise<void> {
    let p: RavelryPatternDetail;
    try {
      p = await api.ravelryPattern(id);
    } catch (err) {
      return say(err instanceof Error ? err.message : String(err), "Ravelry");
    }
    const dialog = customDialog(p.name, () => dialog.close(), "rav-pattern-dialog");
    const facts = [
      ["By", p.designer],
      ["Price", p.free ? "Free" : p.price],
      ["Craft", p.craft],
      ["Yarn weight", p.yarnWeight],
      ["Yardage", p.yardage],
      ["Needles", p.needles],
      ["Gauge", p.gauge],
      ["Kind", p.categories.join(", ")],
    ].filter(([, v]) => v);
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <div class="rav-pattern">
        <div class="rav-photos">${p.photos.length ? p.photos.slice(0, 6).map((src) => `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" />`).join("") : `<p class="hint">No photos.</p>`}</div>
        <div class="rav-facts">
          <table class="calc-table"><tbody>${facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
          ${p.notes ? `<p class="rav-notes">${esc(p.notes.length > 900 ? `${p.notes.slice(0, 900)}…` : p.notes)}</p>` : ""}
        </div>
      </div>
      <div class="dialog-actions">
        <button class="ghost" data-act="close">Close</button>
        <button class="ghost" data-act="ravelry" ${p.url ? "" : "disabled"} title="Its Ravelry page in the browser, to buy it or read more">Ravelry page ↗</button>
        <button class="primary" data-act="wish" ${p.url ? "" : "disabled"} title="Add to the wishlist with its name, designer, price and picture">To the wishlist</button>
      </div>`,
    );
    dialog.card.addEventListener("click", (e) => {
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "close") dialog.close();
      if (act === "ravelry") void api.openLink(p.url).catch((err) => say(err instanceof Error ? err.message : String(err), "Ravelry"));
      if (act === "wish") {
        dialog.close();
        // What Ravelry said goes in as it is; the page is read for its picture.
        this.root.dispatchEvent(new CustomEvent("add-wish", { bubbles: true, detail: { kind: "pattern", url: p.url, name: p.name, brand: p.designer, price: p.free ? "Free" : p.price } }));
      }
    });
    dialog.show(dialog.card.querySelector<HTMLElement>('[data-act="wish"]')!);
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
