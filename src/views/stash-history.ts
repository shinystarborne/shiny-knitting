import { api, type Yarn, type YarnUse } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { yarnPhotoUrl } from "../covers";
import { describeFibres } from "./fibres";
import { paintLazily } from "./lazy";
import { longDate } from "./project-form";
import { stashModeSwitch } from "./swatches";
import { usageByMonth, usageChartHtml, type MonthUse } from "./usage-chart";

/**
 * The Stash tab's history: yarn you had, and used up, the most recently used
 * up first, each with what it went into. Marked from a yarn's card, or by
 * finishing a project with nothing of it left. Back in the stash undoes it.
 */
export class StashHistoryView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private yarns: Yarn[] = [];
  private uses: YarnUse[] = [];
  private months: MonthUse[] = [];
  /** The month whose yarn is listed: the current one to start with. */
  private chosen = 11;
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library stash-history";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Stash</h1>${stashModeSwitch("history")}</div>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search name, brand, colourway, project..." />
        </div>
      </header>
      <section class="usage-panel" data-el="usage"></section>
      <main class="results"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    this.wireUsage();
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value.trim().toLowerCase();
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    await this.reload();
  }

  async reload(): Promise<void> {
    const [yarns, uses] = await Promise.all([api.listYarns({ used: "history" }), api.listYarnUsage().catch(() => [] as YarnUse[])]);
    this.yarns = yarns.sort((a, b) => (b.usedUpAt ?? 0) - (a.usedUpAt ?? 0));
    this.uses = uses;
    this.months = usageByMonth(uses);
    this.paintUsage();
    this.paint();
  }

  // ---------- yarn used, month by month ----------

  private paintUsage(): void {
    const panel = this.root.querySelector<HTMLElement>('[data-el="usage"]')!;
    const head = `<div class="usage-head"><h2>Yarn used, month by month</h2>
      <p class="hint">Metres used in each calendar month: what finished projects took (weighed before and after) and what was left of yarn marked used up. Counted from this version on.</p></div>`;
    if (!this.uses.length) {
      panel.innerHTML = `${head}<p class="usage-empty">Nothing counted yet. Finish a project and weigh what is left, or mark a yarn used up, and it shows here.</p>`;
      return;
    }
    const m = this.months[this.chosen];
    const fmt = (n: number) => n.toLocaleString("en-GB");
    const yarnCount = new Set(m.uses.map((u) => u.yarnName)).size;
    const rows = m.uses
      .map((u) => {
        const day = new Date(u.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        return `<li><span>${esc(u.yarnName)}</span><b>${u.metres ? `${fmt(u.metres)} m` : "–"}</b><em>${fmt(u.grams)} g · ${esc(u.projectName || "marked used up")} · ${esc(day)}</em></li>`;
      })
      .join("");
    const extra = [yarnCount ? `${yarnCount} yarn${yarnCount === 1 ? "" : "s"}` : "", m.gramsWithoutMetres ? `${fmt(m.gramsWithoutMetres)} g of it without metres per ball` : ""].filter(Boolean);
    panel.innerHTML = `
      ${head}
      <div class="usage-body">
        ${usageChartHtml(this.months, this.chosen)}
        <div class="usage-detail">
          <div class="usage-figure"><b>${fmt(m.metres)} m</b><span>used in ${esc(m.label)}</span>
            <small>${[`${fmt(m.grams)} g`, ...extra].join(" · ")}</small></div>
          ${rows ? `<ul class="usage-list">${rows}</ul>` : `<p class="hint">Nothing used this month.</p>`}
        </div>
      </div>
      <details class="usage-table"><summary>The months as a table</summary>
        <table class="calc-table"><thead><tr><th>Month</th><th>Metres</th><th>Grams</th></tr></thead><tbody>
          ${[...this.months]
            .reverse()
            .map((x) => `<tr><td>${esc(x.label)}</td><td>${fmt(x.metres)}</td><td>${fmt(x.grams)}</td></tr>`)
            .join("")}
        </tbody></table>
      </details>`;
  }

  /** Choosing a month lists its yarn; pointing at one, or tabbing to it, says its figures. */
  private wireUsage(): void {
    const panel = this.root.querySelector<HTMLElement>('[data-el="usage"]')!;
    panel.addEventListener("click", (e) => {
      const col = closestEl(e.target, "[data-month]");
      if (!col) return;
      this.chosen = Number(col.dataset.month);
      this.paintUsage();
      panel.querySelector<HTMLElement>(`[data-month="${this.chosen}"]`)?.focus();
    });
    const show = (e: Event) => {
      const col = closestEl(e.target, "[data-month]");
      const tip = panel.querySelector<HTMLElement>(".usage-tip");
      if (!col || !tip) return;
      tip.textContent = col.dataset.tip ?? "";
      tip.hidden = false;
      const plot = col.closest<HTMLElement>(".usage-plot")!.getBoundingClientRect();
      const r = col.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - plot.left, 90), plot.width - 90)}px`;
    };
    const hide = () => {
      const tip = panel.querySelector<HTMLElement>(".usage-tip");
      if (tip) tip.hidden = true;
    };
    panel.addEventListener("pointerover", show);
    panel.addEventListener("focusin", show);
    panel.addEventListener("pointerout", (e) => {
      if (!closestEl((e as PointerEvent).relatedTarget, "[data-month]")) hide();
    });
    panel.addEventListener("focusout", hide);
  }

  private paint(): void {
    const words = this.search.split(/\s+/).filter(Boolean);
    const shown = this.yarns.filter((y) => {
      const text = [y.name, y.brand, y.colourway, y.notes, ...y.usedIn].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (!shown.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${this.yarns.length ? "Nothing used up by that name" : "Nothing used up yet"}</h2>
          <p>${
            this.yarns.length
              ? "Try another word."
              : "Yarn you had and used goes here: mark it Used up on its card, or finish a project with 0 g of it left."
          }</p>
        </div>`;
      return;
    }
    paintLazily(this.results, shown, (y) => cardHtml(y), { pictures: ".cover[data-id]", paint: (cover) => this.loadPhoto(cover) });
  }

  private async loadPhoto(cover: HTMLElement): Promise<void> {
    const yarn = this.yarns.find((y) => y.id === cover.dataset.id);
    if (!yarn?.photoPath) return;
    const url = await yarnPhotoUrl(yarn.id);
    const host = cover.querySelector<HTMLElement>('[data-el="photo"]');
    if (!url || !host) return;
    host.style.backgroundImage = `url("${url}")`;
    cover.classList.add("has-cover");
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "stash-mode") return void this.root.dispatchEvent(new CustomEvent("stash-mode", { bubbles: true, detail: btn.dataset.mode }));
      const yarn = this.yarns.find((y) => y.id === btn.dataset.id);
      if (!yarn) return;
      try {
        if (act === "restore") await api.setYarnUsedUp(yarn.id, false);
        if (act === "remove") {
          if (!(await askYesNo(`Remove ${yarn.name} from the history for good? Its photo goes too. This cannot be undone.`, { title: "Remove yarn", okLabel: "Remove", danger: true }))) return;
          await api.deleteYarn(yarn.id);
        }
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "Stash");
      }
      return void (await this.reload());
    }
    const card = closestEl(e.target, "[data-open]");
    const yarn = card && this.yarns.find((y) => y.id === card.dataset.open);
    if (yarn) this.root.dispatchEvent(new CustomEvent("edit-yarn", { bubbles: true, detail: yarn }));
  }
}

function cardHtml(y: Yarn): string {
  const where = [y.brand, y.colourway].filter(Boolean).join(" · ");
  return `
    <article class="card used-up" data-open="${esc(y.id)}">
      <div class="cover" data-id="${esc(y.id)}">
        <div class="cover-photo" data-el="photo"></div>
        <div class="cover-fallback format-yarn"><span>${esc(y.yarnWeight || "Yarn")}</span></div>
      </div>
      <div class="card-body">
        <h3>${esc(y.name)}</h3>
        <p class="designer">${where ? esc(where) : "No brand"}</p>
        <p class="card-used-up">Used up ${esc(longDate(y.usedUpAt ?? Date.now()))}</p>
        ${y.usedIn.length ? `<p class="card-went" title="${esc(y.usedIn.join(", "))}">Went into: ${esc(y.usedIn.join(", "))}</p>` : ""}
        ${y.fibres.length ? `<p class="card-fibres">${esc(describeFibres(y.fibres))}</p>` : ""}
        <div class="card-tools-row">
          <button class="card-remove card-colour" data-act="restore" data-id="${esc(y.id)}" title="Not used up after all: back in the stash">Back in the stash</button>
          <button class="card-remove" data-act="remove" data-id="${esc(y.id)}" title="Remove it from the history for good">Remove</button>
        </div>
      </div>
    </article>`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
