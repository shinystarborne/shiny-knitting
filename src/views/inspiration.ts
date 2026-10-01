import { api, type InspirationBoard } from "../api";
import { askText, askYesNo, say } from "../dialogs";
import { boardImageUrl, coverUrl, yarnPhotoUrl } from "../covers";
import { closestEl } from "../dom";
import { Board } from "./board";
import { longDate } from "./project-form";
import { paintLazily } from "./lazy";

/** What an inspiration board offers: everything but needles, which belong to projects. */
const KINDS = ["note", "text", "link", "image", "pattern", "yarn", "swatch"] as const;

const HINT = `Gather what inspires you: pictures from anywhere (paste them with <kbd>Ctrl</kbd>+<kbd>V</kbd>
  or drop them here), patterns from the library, yarn, links, colours and notes.
  Drag the board to move around; <kbd>Ctrl</kbd>+scroll zooms. Everything saves as you go.`;

/**
 * The Inspiration tab: boards of their own, not tied to a project, for
 * collecting ideas -- a colour scheme, a shape of cardigan, next winter's
 * hats. Each card shows a few of the board's pictures and colours.
 */
export class InspirationView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private boards: InspirationBoard[] = [];
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library inspiration";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Inspiration</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search boards..." />
          <button data-act="add" class="primary">+ New board</button>
        </div>
      </header>
      <main class="results inspo-grid"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value.trim().toLowerCase();
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.boards = await api.listInspirationBoards();
    this.paint();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn?.dataset.act === "add") {
      const name = await askText("What is this board for?", { title: "New board", placeholder: "e.g. Autumn cardigans", okLabel: "Make the board" });
      if (name === null) return;
      try {
        const board = await api.addInspirationBoard(name);
        this.open(board.id);
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "New board");
      }
      return;
    }
    if (btn?.dataset.act === "remove") {
      e.stopPropagation();
      const board = this.boards.find((b) => b.id === btn.dataset.id);
      if (!board) return;
      if (!(await askYesNo(`Remove the board “${board.name}” and everything on it? The patterns and yarn on it stay where they are. This cannot be undone.`, { title: "Remove board", okLabel: "Remove", danger: true }))) return;
      await api.deleteInspirationBoard(board.id).catch((err) => say(err instanceof Error ? err.message : String(err), "Remove board"));
      this.boards = await api.listInspirationBoards();
      this.paint();
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    if (card) this.open(card.dataset.open!);
  }

  private open(id: string): void {
    this.root.dispatchEvent(new CustomEvent("open-inspiration", { bubbles: true, detail: id }));
  }

  private paint(): void {
    const shown = this.boards.filter((b) => !this.search || this.search.split(/\s+/).every((w) => b.name.toLowerCase().includes(w)));
    if (!shown.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${this.boards.length ? "No board by that name" : "No boards yet"}</h2>
          <p>${this.boards.length ? "Try another word." : "Make a board to gather ideas: pictures from anywhere, patterns, yarn, links and colours."}</p>
        </div>`;
      return;
    }
    paintLazily(this.results, shown, cardHtml, { pictures: "[data-pic]", paint: paintPicture });
  }
}

function cardHtml(b: InspirationBoard): string {
  const tiles = b.pictures.length
    ? b.pictures.map((p) => `<div class="inspo-tile" data-pic="${esc(p.kind)}" data-id="${esc(p.id)}"></div>`).join("")
    : `<div class="inspo-tile empty"><span>${esc(b.name.slice(0, 1).toUpperCase())}</span></div>`;
  const things = b.itemCount === 1 ? "1 thing" : `${b.itemCount} things`;
  return `
    <article class="inspo-card" data-open="${esc(b.id)}">
      <div class="inspo-mosaic n${Math.max(1, b.pictures.length)}">${tiles}</div>
      ${b.colours.length ? `<div class="inspo-colours">${b.colours.map((c) => `<span style="background:${/^#[0-9a-f]{6}$/i.test(c) ? c : "transparent"}"></span>`).join("")}</div>` : ""}
      <div class="inspo-body">
        <h3>${esc(b.name)}</h3>
        <p>${esc(`${things} · changed ${longDate(b.updatedAt)}`)}</p>
      </div>
      <button class="card-remove" data-act="remove" data-id="${esc(b.id)}" title="Remove this board">Remove</button>
    </article>`;
}

async function paintPicture(el: HTMLElement): Promise<void> {
  const id = el.dataset.id!;
  const kind = el.dataset.pic;
  const url = kind === "image" ? await boardImageUrl(id) : kind === "pattern" ? await coverUrl(id) : kind === "yarn" ? await yarnPhotoUrl(id) : null;
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("filled");
  }
}

export interface InspirationPageHooks {
  back(): void;
  openPattern(id: string): void;
}

/**
 * One inspiration board, filling the screen under a bar with its name. The
 * name saves as it is typed, and the board saves every change as it is made,
 * so leaving for another tab loses nothing.
 */
export class InspirationPage {
  private screen: HTMLElement;
  private boardId: string;
  private hooks: InspirationPageHooks;
  private root!: HTMLElement;
  private board: Board | null = null;
  private saved = "";
  private nameTimer: number | null = null;

  constructor(screen: HTMLElement, boardId: string, hooks: InspirationPageHooks) {
    this.screen = screen;
    this.boardId = boardId;
    this.hooks = hooks;
  }

  get id(): string {
    return this.boardId;
  }

  async mount(): Promise<void> {
    let info: InspirationBoard;
    try {
      info = await api.getInspirationBoard(this.boardId);
    } catch {
      await say("That board is no longer there.");
      this.hooks.back();
      return;
    }
    this.saved = info.name;
    this.root = document.createElement("div");
    this.root.className = "inspo-page";
    this.root.innerHTML = `
      <header class="inspo-bar">
        <button class="ghost back" data-act="back">← Boards</button>
        <input class="inspo-name" data-f="name" value="${esc(info.name)}" aria-label="Board name" placeholder="Name this board" />
        <span class="hint inspo-saved" data-el="saved">Saved</span>
        <button class="ghost danger-text" data-act="remove">Remove board</button>
      </header>
      <div class="project-board"></div>
    `;
    this.screen.appendChild(this.root);
    const name = this.root.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.addEventListener("input", () => {
      this.mark("Saving…");
      if (this.nameTimer !== null) clearTimeout(this.nameTimer);
      this.nameTimer = window.setTimeout(() => void this.saveName(), 500);
    });
    name.addEventListener("change", () => void this.saveName());
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
    });
    this.root.querySelector(".inspo-bar")!.addEventListener("click", (e) => void this.onClick(e as MouseEvent));

    this.board = new Board(
      this.root.querySelector<HTMLElement>(".project-board")!,
      this.boardId,
      { project: () => null, openPattern: (id) => this.hooks.openPattern(id) },
      { kinds: [...KINDS], emptyHint: HINT },
    );
    await this.board.mount();
  }

  /** Saves a name still being typed, and takes the board down. */
  destroy(): void {
    if (this.nameTimer !== null) {
      clearTimeout(this.nameTimer);
      this.nameTimer = null;
    }
    void this.saveName();
    this.board?.destroy();
    this.root?.remove();
  }

  private async saveName(): Promise<void> {
    if (this.nameTimer !== null) {
      clearTimeout(this.nameTimer);
      this.nameTimer = null;
    }
    const field = this.root?.querySelector<HTMLInputElement>('[data-f="name"]');
    if (!field) return;
    const name = field.value.trim();
    if (!name || name === this.saved) return this.mark("Saved");
    this.saved = name;
    try {
      await api.renameInspirationBoard(this.boardId, name);
      this.mark("Saved");
    } catch (err) {
      this.mark(err instanceof Error ? err.message : String(err));
    }
  }

  private mark(text: string): void {
    const el = this.root?.querySelector<HTMLElement>('[data-el="saved"]');
    if (el) el.textContent = text;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "back") this.hooks.back();
    if (act === "remove") {
      if (!(await askYesNo(`Remove the board “${this.saved}” and everything on it? This cannot be undone.`, { title: "Remove board", okLabel: "Remove", danger: true }))) return;
      try {
        await api.deleteInspirationBoard(this.boardId);
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Remove board"));
      }
      this.saved = "";
      this.root.querySelector<HTMLInputElement>('[data-f="name"]')!.value = "";
      this.hooks.back();
    }
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
