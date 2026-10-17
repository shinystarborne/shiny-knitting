import { api, type RavelryAccount, type RavelryPattern, type RavelryPatternDetail, type RavelryQuery } from "../api";
import { askYesNo, customDialog, say } from "../dialogs";
import { closestEl } from "../dom";

/** Where a personal API key is made, signed in to Ravelry. */
const DEVELOPER = "https://www.ravelry.com/pro/developer";

/** The search last made, kept while the app is open. */
const kept: { query: RavelryQuery } = { query: { query: "", craft: "knitting", free: false, sort: "" } };

/**
 * The Ravelry tab: Ravelry searched through its API, the patterns found
 * shown as the app's own cards, with their photos; one opened shows what
 * Ravelry says of it, to put on the wishlist or buy on Ravelry, in the
 * browser. Ravelry's site itself will not be shown inside another app.
 *
 * The API needs the knitter's own personal key, made on Ravelry's
 * developer page and pasted here once.
 */
export class RavelryView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private account: RavelryAccount = { connected: false, username: "" };
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
      if (form.dataset.el === "connect") void this.connect();
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
          <span class="hint">Connected as <b>${esc(this.account.username || "you")}</b></span>
          <button class="ghost" data-act="disconnect" title="Forget the key: the tab asks for one again">Disconnect</button>
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
    if (!this.found.length) return `<div class="empty"><h2>Search Ravelry's patterns</h2><p>What you find shows here, with its photos. Open one to see what Ravelry says of it, put it on your wishlist, or buy it on Ravelry.</p></div>`;
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

  /** Not connected yet: how to make a key, and where to paste it. */
  private paintConnect(): void {
    this.root.innerHTML = `
      <header class="lib-bar"><h1>Ravelry</h1></header>
      <div class="rav-connect">
        <section class="rav-card">
          <h2>Connect your Ravelry account</h2>
          <p>Ravelry is searched through its API, which wants a key of your own. It is made once, in a minute:</p>
          <ol>
            <li>Open Ravelry's developer page, signed in: <button class="link" data-act="developer">ravelry.com/pro/developer ↗</button></li>
            <li>Make a new app there, of the <b>personal</b> kind (basic authentication), read-only.</li>
            <li>Ravelry shows its key in two parts: an access key (a username) and a personal key (a password). Paste both below.</li>
          </ol>
          <form class="rav-keys" data-el="connect">
            <label class="field"><span>Access key <em class="hint">the username part</em></span><input data-f="access" autocomplete="off" spellcheck="false" /></label>
            <label class="field"><span>Personal key <em class="hint">the password part</em></span><input data-f="personal" type="password" autocomplete="off" spellcheck="false" /></label>
            <p class="form-error" data-el="error" hidden></p>
            <div><button class="primary" type="submit">Connect</button></div>
          </form>
          <p class="hint">The key is kept in your library on this computer, never in the app. It is read-only: the app can search Ravelry with it, and nothing more.</p>
        </section>
      </div>`;
  }

  private async connect(): Promise<void> {
    const value = (f: string) => this.root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!.value;
    const error = this.root.querySelector<HTMLElement>('[data-el="error"]')!;
    const button = this.root.querySelector<HTMLButtonElement>('[data-el="connect"] button[type="submit"]')!;
    button.disabled = true;
    button.textContent = "Asking Ravelry…";
    try {
      this.account = await api.connectRavelry(value("access"), value("personal"));
      this.paint();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Connect";
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
    if (act === "developer") await api.openLink(DEVELOPER).catch(() => {});
    if (act === "more") await this.search(this.page + 1);
    if (act === "disconnect") {
      if (!(await askYesNo("Forget the Ravelry key? The tab asks for one again; Ravelry keeps it until you delete it there.", { title: "Disconnect Ravelry", okLabel: "Disconnect" }))) return;
      await api.disconnectRavelry().catch(() => {});
      this.account = { connected: false, username: "" };
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
        <button class="ghost" data-act="ravelry" ${p.url ? "" : "disabled"} title="Its page on Ravelry, in your browser: to buy it, or read more">Ravelry page ↗</button>
        <button class="primary" data-act="wish" ${p.url ? "" : "disabled"} title="On the wishlist, its name, designer, price and picture filled in">To the wishlist</button>
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
