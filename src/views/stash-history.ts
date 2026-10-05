import { api, type Yarn } from "../api";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { yarnPhotoUrl } from "../covers";
import { describeFibres } from "./fibres";
import { paintLazily } from "./lazy";
import { longDate } from "./project-form";
import { stashModeSwitch } from "./swatches";

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
      <main class="results"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value.trim().toLowerCase();
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    await this.reload();
  }

  async reload(): Promise<void> {
    this.yarns = (await api.listYarns({ used: "history" })).sort((a, b) => (b.usedUpAt ?? 0) - (a.usedUpAt ?? 0));
    this.paint();
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
