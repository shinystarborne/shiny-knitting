import { api, isLive, type BoardItem, type BoardKind, type Chart, type Cheatsheet, type KnitSession, type LogEntry, type Pattern, type Project, type Tool, type Yarn } from "../api";
import { decode, describe as describeChart, normalize } from "./chart";
import { SHEET_CARD, drawSheetPages, keepOpen as keepSheetOpen, sheetFrameHtml } from "./cheatsheets";
import { CanvasPainter, drawChart, sizeCanvas } from "./chart-draw";
import { askChoice, askForm, askYesNo, dialogOpen, say, type Choice } from "../dialogs";
import { blobBytes, boardImageUrl, coverUrl, forgetBoardImage, forgetLogPhoto, logPhotoUrl, prepareBoardImage, prepareChosenImage, yarnPhotoUrl } from "../covers";
import { describe, headline, kindLabel } from "./tool-filter";
import { cropImage } from "./crop-dialog";
import { copyPicture } from "../copy-picture";
import { openLightbox } from "../lightbox";
import { logPictures } from "./project-photos";
import { playerHtml } from "./masterclasses";
import { countStep, nowAt, progress, readStepList, tick, type StepList } from "./steps";
import { clock, hoursText, sessionMs, totalMs } from "./knit-time";

/**
 * A board: an endless surface to collect what a project is made of and what
 * it should look like -- notes, pictures, links, the pattern, the yarn and
 * needles, colours -- laid out freely, as on a Miro board. A project has one,
 * by its id; an inspiration board is one of its own.
 *
 * The board moves under a fixed frame: `view` says where board point (0, 0)
 * sits on screen and how large a board unit is. Items are positioned in board
 * units, so panning and zooming are one transform on the layer that holds
 * them, and nothing is re-laid out.
 */

/** Where the board is: screen = board × scale + offset. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;

/** A screen point, relative to the board's frame, as a board point. */
export function toBoard(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

/**
 * Zooms by `factor` keeping the board point under (sx, sy) where it is, as a
 * map does: zooming in on a picture zooms into that picture, not the corner.
 */
export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const at = toBoard(view, sx, sy);
  return { scale, x: sx - at.x * scale, y: sy - at.y * scale };
}

/** The view that shows every item, within a frame, at no more than 100%. */
export function fitView(items: { x: number; y: number; w: number; h: number }[], width: number, height: number, pad = 60): View {
  if (!items.length) return { x: pad, y: pad, scale: 1 };
  const left = Math.min(...items.map((i) => i.x));
  const top = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.w));
  const bottom = Math.max(...items.map((i) => i.y + i.h));
  const scale = Math.min(1, Math.max(MIN_SCALE, Math.min((width - pad * 2) / (right - left || 1), (height - pad * 2) / (bottom - top || 1))));
  return {
    scale,
    x: (width - (right - left) * scale) / 2 - left * scale,
    y: (height - (bottom - top) * scale) / 2 - top * scale,
  };
}

/** A web address as typed: "ravelry.com/x" is taken to mean https. Null if it is not one. */
export function linkFrom(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(t) ? `https://${t}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The sizes things start at, in board units. */
const SIZES: Record<BoardKind, [number, number]> = {
  note: [200, 180],
  text: [320, 90],
  link: [260, 104],
  image: [300, 220],
  pattern: [200, 300],
  yarn: [200, 260],
  tool: [230, 110],
  swatch: [150, 180],
  log: [340, 440],
  pin: [420, 300],
  // 16:9, and the bar it is moved by.
  video: [480, 302],
  steps: [480, 620],
  chart: [380, 380],
  sheet: SHEET_CARD,
  timer: [300, 280],
  counter: [320, 440],
};

const NOTE_COLOURS = ["yellow", "pink", "blue", "green", "purple"] as const;
const SWATCHES = ["#c94c6d", "#e3a458", "#7aa874", "#4f7cac", "#8e6bb8", "#d8c3a5", "#2f4858"];

export interface BoardHooks {
  /** The project, for its own pattern, needles and yarn to come first in the pickers; null on an inspiration board. */
  project(): Project | null;
  openPattern(id: string): void;
  /** Shows the project's whole log, from its card. */
  openLog?(): void;
  /** Opens a chart, to change it, from its card. */
  openChart?(id: string): void;
  /** Opens a calculator, its result to be saved to this board. */
  openCalculator?(calc: string): void;
  /** The project's row counter, to show on its card; null while it has no pattern to count. */
  counter?(): HTMLElement | null;
  /** Keeps the counter in the page while no card shows it, so it still counts and tells the page. */
  parkCounter?(host: HTMLElement): void;
}

export interface BoardOptions {
  /** What the toolbar offers to add; everything when not given. */
  kinds?: BoardKind[];
  /** What an empty board says, as HTML. */
  emptyHint?: string;
}

const TOOLBAR: { kind: BoardKind; html: string }[] = [
  { kind: "note", html: `<button data-add="note" title="A sticky note">🗒<span>Note</span></button>` },
  { kind: "text", html: `<button data-add="text" title="Words on the board">T<span>Text</span></button>` },
  { kind: "link", html: `<button data-add="link" title="A web address">🔗<span>Link</span></button>` },
  { kind: "image", html: `<button data-add="image" title="A picture: choose one, paste it with Ctrl+V, or drop it on the board">🖼<span>Picture</span></button>` },
  { kind: "pattern", html: `<button data-add="pattern" title="A pattern from the library">📄<span>Pattern</span></button>` },
  { kind: "yarn", html: `<button data-add="yarn" title="A yarn from the stash">🧶<span>Yarn</span></button>` },
  { kind: "tool", html: `<button data-add="tool" title="A needle, hook or cable">🪡<span>Needle</span></button>` },
  { kind: "swatch", html: `<button data-add="swatch" title="A colour">🎨<span>Colour</span></button>` },
  { kind: "log", html: `<button data-add="log" title="The project's log, kept up to date, to read and write in on the board">📓<span>Log</span></button>` },
  { kind: "video", html: `<button data-add="video" title="A video from the Masterclasses, playing on the board">🎬<span>Video</span></button>` },
  { kind: "chart", html: `<button data-add="chart" title="A chart from Calculators, drawn on the board as it is now">▦<span>Chart</span></button>` },
  { kind: "sheet", html: `<button data-add="sheet" title="A page kept in Cheatsheets, shown on the board">📋<span>Cheatsheet</span></button>` },
  { kind: "counter", html: `<button data-add="counter" title="The row counter for the project's pattern, on the board">🔢<span>Counter</span></button>` },
  { kind: "timer", html: `<button data-add="timer" title="The knitting timer, big: started by counting a row, if you like">⏱<span>Timer</span></button>` },
];

/** The calculators a project's board can open, to save their result onto it. */
export const BOARD_CALCULATORS: { key: string; label: string }[] = [
  { key: "raglan", label: "Raglan sweater or cardigan" },
  { key: "yoke", label: "Round yoke" },
  { key: "socks", label: "Socks" },
  { key: "size", label: "Stitches for a size" },
  { key: "evenly", label: "Increase or decrease evenly" },
  { key: "regauge", label: "Re-gauge a pattern" },
  { key: "held", label: "Yarns held together" },
];

const PROJECT_HINT = `Collect what this project is made of: notes, pictures, links, the pattern, yarn,
  needles and colours. Paste a picture or a link with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drop one here.
  Drag the board to move around; <kbd>Ctrl</kbd>+scroll zooms.`;

/** How long after the last keystroke a note's words are saved. */
const TYPING_SAVE_MS = 700;

export class Board {
  private host: HTMLElement;
  private boardId: string;
  private hooks: BoardHooks;
  private options: BoardOptions;
  /** A note's words typed but not yet saved, by item. */
  private typing = new Map<string, number>();
  private root!: HTMLElement;
  private world!: HTMLElement;
  private items: BoardItem[] = [];
  private view: View = { x: 40, y: 40, scale: 1 };
  private selected: string | null = null;
  private editing: string | null = null;
  private patterns: Pattern[] = [];
  private yarns: Yarn[] = [];
  private tools: Tool[] = [];
  /** The charts, for chart cards: drawn from them as they are now. */
  private charts: Chart[] = [];
  private sheets: Cheatsheet[] = [];
  /** The project's spells of knitting, for its timer card. */
  private sessions: KnitSession[] = [];
  /** A cheatsheet's pages as drawn, by card: kept over a redraw of the board while they are the same. */
  private sheetPages = new Map<string, { key: string; node: HTMLElement }>();
  /** The project's log, for a log card; empty on an inspiration board. */
  private logEntries: LogEntry[] = [];
  /**
   * What is being written in the log card, and the photo waiting to go with
   * it (downscaled, shown as a thumbnail): kept here, so the card drawn
   * again loses neither.
   */
  private logDraft = "";
  private logPhoto: Blob | null = null;
  private logPhotoUrl: string | null = null;
  /** A press in progress: panning the board, or moving or sizing an item. */
  private drag:
    | { mode: "pan"; pointer: number; sx: number; sy: number; vx: number; vy: number }
    | { mode: "move" | "size"; pointer: number; sx: number; sy: number; id: string; x: number; y: number; w: number; h: number; moved: boolean }
    | null = null;
  private teardown: (() => void)[] = [];

  constructor(host: HTMLElement, boardId: string, hooks: BoardHooks, options: BoardOptions = {}) {
    this.host = host;
    this.boardId = boardId;
    this.hooks = hooks;
    this.options = options;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "board";
    this.root.tabIndex = 0;
    this.root.innerHTML = `
      <div class="board-world"></div>
      <div class="board-tools" role="toolbar" aria-label="Add to the board">
        ${TOOLBAR.filter((t) => !this.options.kinds || this.options.kinds.includes(t.kind)).map((t) => t.html).join("")}
        ${this.hooks.openCalculator ? `<button data-act="calculator" title="A calculator, its result saved to this board">🧮<span>Calculator</span></button>` : ""}
      </div>
      <div class="board-zoom">
        <button data-act="zoom-out" title="Zoom out">−</button>
        <span data-el="zoom">100%</span>
        <button data-act="zoom-in" title="Zoom in">+</button>
        <button data-act="fit" title="Show everything">Fit</button>
      </div>
      <p class="board-empty" hidden>${this.options.emptyHint ?? PROJECT_HINT}</p>
    `;
    this.host.appendChild(this.root);
    this.world = this.root.querySelector(".board-world")!;
    this.bind();

    [this.items, this.patterns, this.yarns, this.tools, this.logEntries, this.charts] = await Promise.all([
      api.listBoardItems(this.boardId),
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listYarns({}).catch(() => [] as Yarn[]),
      api.listTools().catch(() => [] as Tool[]),
      this.hooks.project() ? api.listProjectLog(this.boardId).catch(() => [] as LogEntry[]) : Promise.resolve([] as LogEntry[]),
      api.listCharts().catch(() => [] as Chart[]),
    ]);
    this.sheets = await api.listCheatsheets().catch(() => [] as Cheatsheet[]);
    if (this.hooks.project()) {
      this.sessions = await api.listKnitSessions(this.boardId).catch(() => [] as KnitSession[]);
      // Started or stopped anywhere -- the page's side, the tab bar, the counter -- the card follows.
      const onTimer = () => void this.reloadSessions();
      document.addEventListener("knit-timer", onTimer);
      this.teardown.push(() => document.removeEventListener("knit-timer", onTimer));
      const ticking = window.setInterval(() => this.tickTimer(), 1000);
      this.teardown.push(() => window.clearInterval(ticking));
    }
    this.view = this.savedView() ?? fitView(this.items, this.root.clientWidth || 900, this.root.clientHeight || 600);
    this.applyView();
    this.render();
  }

  /**
   * Takes the board down, saving first whatever is still being typed: a note
   * being written, or a colour's name, when another page is opened.
   */
  destroy(): void {
    this.flush();
    for (const undo of this.teardown) undo();
    this.teardown = [];
    this.root?.remove();
  }

  /** Saves words typed into an item and not yet saved. */
  private flush(): void {
    for (const timer of this.typing.values()) clearTimeout(timer);
    this.typing.clear();
    if (!this.world) return;
    for (const field of this.world.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[data-f="label"]')) {
      const item = this.items.find((i) => i.id === this.itemEl(field)?.dataset.id);
      if (!item) continue;
      const key = field instanceof HTMLTextAreaElement ? "text" : "label";
      if (field.value !== String(item.data[key] ?? "")) {
        item.data = { ...item.data, [key]: field.value };
        void api.updateBoardItem(item.id, { data: item.data }).catch(() => {});
      }
    }
  }

  /** A note's words are saved a moment after the typing stops, as well as when it is left. */
  private onType(e: Event): void {
    // The log card's words, kept for when the card is drawn again.
    if ((e.target as HTMLElement).dataset?.f === "log-text") this.logDraft = (e.target as HTMLInputElement).value;
    const area = e.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    const id = this.itemEl(area)?.dataset.id;
    if (!id) return;
    clearTimeout(this.typing.get(id));
    this.typing.set(
      id,
      window.setTimeout(() => {
        this.typing.delete(id);
        const item = this.items.find((i) => i.id === id);
        if (item && area.value !== String(item.data.text ?? "")) void this.save(id, { data: { ...item.data, text: area.value } });
      }, TYPING_SAVE_MS),
    );
  }

  /** Re-reads what the cards show: a pattern renamed, a yarn's photo changed, the log written in. */
  /** Re-reads what is on the board, after something was put on it from elsewhere. */
  async reloadItems(): Promise<void> {
    this.items = await api.listBoardItems(this.boardId).catch(() => this.items);
    this.render();
  }

  async refreshLinked(): Promise<void> {
    [this.patterns, this.yarns, this.tools, this.charts] = await Promise.all([
      api.listPatterns({}).catch(() => this.patterns),
      api.listYarns({}).catch(() => this.yarns),
      api.listTools().catch(() => this.tools),
      api.listCharts().catch(() => this.charts),
    ]);
    this.sheets = await api.listCheatsheets().catch(() => this.sheets);
    await this.refreshLog();
  }

  /** Re-reads the project's log, for its card: after it was written in elsewhere. */
  async refreshLog(): Promise<void> {
    if (this.hooks.project()) this.logEntries = await api.listProjectLog(this.boardId).catch(() => this.logEntries);
    this.render();
  }

  /** Adds what is typed in a log card, and the photo waiting, to the project's log, dated now. */
  private async addToLog(id: string): Promise<void> {
    const input = this.world.querySelector<HTMLInputElement>(`.board-item[data-id="${id}"] input[data-f="log-text"]`);
    const text = input?.value.trim() ?? "";
    const photo = this.logPhoto;
    if (!input || (!text && !photo)) return void input?.focus();
    try {
      const entry = await api.addLogEntry(this.boardId, text);
      if (photo) await api.setLogPhoto(entry.id, await blobBytes(photo));
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Log"));
    }
    this.logDraft = "";
    this.setLogPhoto(null);
    await this.refreshLog();
    this.world.querySelector<HTMLInputElement>(`.board-item[data-id="${id}"] input[data-f="log-text"]`)?.focus();
  }

  /** A photo to go with the next entry, or none; shown on the card as it waits. */
  private setLogPhoto(blob: Blob | null): void {
    if (this.logPhotoUrl) URL.revokeObjectURL(this.logPhotoUrl);
    this.logPhoto = blob;
    this.logPhotoUrl = blob ? URL.createObjectURL(blob) : null;
    const slot = this.world.querySelector<HTMLElement>('.board-item[data-kind="log"] [data-el="log-pending"]');
    if (slot) slot.outerHTML = this.logPendingHtml();
  }

  private logPendingHtml(): string {
    return this.logPhotoUrl
      ? `<div class="board-log-pending" data-el="log-pending"><img src="${this.logPhotoUrl}" alt="The photo to add" /><span>Goes with the entry: Add, or Enter</span><button data-act="log-photo-clear" title="Not this photo" aria-label="Not this photo">×</button></div>`
      : `<div data-el="log-pending" hidden></div>`;
  }

  /** A picture for the log card's next entry: downscaled as the log's photos are. */
  private async takeLogPhoto(file: Blob): Promise<void> {
    const blob = await prepareChosenImage(file);
    if (!blob) return void (await say("That could not be read as a picture.", "Log"));
    this.setLogPhoto(blob);
    this.world.querySelector<HTMLInputElement>('.board-item[data-kind="log"] input[data-f="log-text"]')?.focus();
  }

  private chooseLogPhoto(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.takeLogPhoto(file);
    });
    input.click();
  }

  // ---------- the view ----------

  private viewKey(): string {
    return `board-view:${this.boardId}`;
  }

  private savedView(): View | null {
    try {
      const v = JSON.parse(localStorage.getItem(this.viewKey()) ?? "null");
      if (v && [v.x, v.y, v.scale].every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return v;
    } catch {
      // A view that cannot be read is a view not remembered.
    }
    return null;
  }

  private saveView(): void {
    try {
      localStorage.setItem(this.viewKey(), JSON.stringify(this.view));
    } catch {
      // Remembering where the board was looked at is a nicety.
    }
  }

  private applyView(): void {
    const { x, y, scale } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    // The dot grid moves and scales with the board, so it reads as the surface.
    const step = 24 * scale;
    this.root.style.backgroundSize = `${step}px ${step}px`;
    this.root.style.backgroundPosition = `${x}px ${y}px`;
    const readout = this.root.querySelector('[data-el="zoom"]');
    if (readout) readout.textContent = `${Math.round(scale * 100)}%`;
  }

  private setView(next: View): void {
    this.view = next;
    this.applyView();
    this.saveView();
  }

  /**
   * Moves the board, if need be, so an item is wholly in view: clear of the
   * toolbar down the left, the Board | Log switch above and the zoom below.
   * A big one put down near a small one can land half out of sight.
   */
  private reveal(item: BoardItem): void {
    const { scale } = this.view;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const left = 100;
    const top = 60;
    const right = w - 20;
    const bottom = h - 60;
    let { x, y } = this.view;
    const sx = item.x * scale + x;
    const sy = item.y * scale + y;
    const ex = sx + item.w * scale;
    const ey = sy + item.h * scale;
    if (sx < left) x += left - sx;
    else if (ex > right) x -= Math.min(ex - right, sx - left);
    if (sy < top) y += top - sy;
    else if (ey > bottom) y -= Math.min(ey - bottom, sy - top);
    if (x !== this.view.x || y !== this.view.y) this.setView({ ...this.view, x, y });
  }

  /** Where a new item goes: the free space nearest the middle of the view. */
  private placeFor(kind: BoardKind, size: [number, number] = SIZES[kind]): { x: number; y: number } {
    const mid = toBoard(this.view, this.root.clientWidth / 2, this.root.clientHeight / 2);
    return freeSpot(this.items, size[0], size[1], mid.x, mid.y);
  }

  // ---------- events ----------

  private listen<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void): void {
    target.addEventListener(type, fn as EventListener);
    this.teardown.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private bind(): void {
    this.root.addEventListener("pointerdown", (e) => this.onDown(e));
    this.root.addEventListener("pointermove", (e) => this.onMove(e));
    this.root.addEventListener("pointerup", (e) => this.onUp(e));
    this.root.addEventListener("pointercancel", (e) => this.onUp(e));
    this.root.addEventListener("dblclick", (e) => this.onDouble(e));
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.root.addEventListener("keydown", (e) => void this.onKey(e));
    this.root.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.root.classList.add("over");
    });
    this.root.addEventListener("dragleave", () => this.root.classList.remove("over"));
    this.root.addEventListener("drop", (e) => void this.onDrop(e));
    this.root.addEventListener("focusout", (e) => void this.onBlur(e));
    this.root.addEventListener("change", (e) => void this.onChange(e));
    this.root.addEventListener("input", (e) => this.onType(e));
    this.listen(document, "paste", (e) => void this.onPaste(e));
  }

  private itemEl(target: EventTarget | null): HTMLElement | null {
    return (target as HTMLElement | null)?.closest?.<HTMLElement>(".board-item") ?? null;
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest(".board-tools, .board-zoom, button, input, select, a, .board-timer-auto")) return;
    const el = this.itemEl(target);
    // A log card's entries are read, scrolled and selected like a page: the
    // card is picked, not dragged. It moves by its header. So does a
    // checklist's.
    if (el && target.closest(".board-log-list, .board-steps-list, .board-sheet")) {
      this.select(el.dataset.id!);
      return;
    }
    if (el && e.button === 0) {
      const id = el.dataset.id!;
      if (this.editing === id && target.closest("textarea")) return;
      const item = this.items.find((i) => i.id === id)!;
      this.select(id);
      e.preventDefault();
      // The press is not let through to focus anything, so the board takes the
      // keyboard itself: Delete and Enter are for the item just picked.
      if (this.editing !== id) {
        this.stopEditing();
        this.root.focus({ preventScroll: true });
      }
      this.drag = {
        mode: target.closest(".board-grip") ? "size" : "move",
        pointer: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        moved: false,
      };
      // A video's player is not to take the pointer while its card moves.
      this.root.classList.add("dragging");
      this.root.setPointerCapture(e.pointerId);
      return;
    }
    // Empty board: drag it about. The middle button pans from anywhere.
    this.select(null);
    this.stopEditing();
    this.root.focus();
    this.drag = { mode: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
    this.root.classList.add("panning");
    this.root.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "pan") {
      this.view = { ...this.view, x: d.vx + dx, y: d.vy + dy };
      this.applyView();
      return;
    }
    const item = this.items.find((i) => i.id === d.id);
    const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${d.id}"]`);
    if (!item || !el) return;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    const bx = dx / this.view.scale;
    const by = dy / this.view.scale;
    if (d.mode === "move") {
      item.x = Math.round(d.x + bx);
      item.y = Math.round(d.y + by);
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
    } else {
      item.w = Math.max(40, Math.round(d.w + bx));
      // A picture keeps its shape unless Shift is held.
      item.h = (item.kind === "image" || item.kind === "pin") && !e.shiftKey ? Math.max(40, Math.round((item.w * d.h) / d.w)) : Math.max(40, Math.round(d.h + by));
      el.style.width = `${item.w}px`;
      el.style.height = `${item.h}px`;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    this.drag = null;
    this.root.classList.remove("panning", "dragging");
    if (d.mode === "pan") {
      this.saveView();
      return;
    }
    if (!d.moved) return;
    const item = this.items.find((i) => i.id === d.id);
    if (!item) return;
    void this.save(item.id, d.mode === "move" ? { x: item.x, y: item.y } : { w: item.w, h: item.h });
    // A chart drawn again to its card's new size.
    if (d.mode === "size" && item.kind === "chart") {
      const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"]`);
      if (el) this.paintCharts(el);
    }
    // A cheatsheet's pages, drawn again to the card's new width.
    if (d.mode === "size" && item.kind === "sheet") void this.paintSheets();
  }

  private onWheel(e: WheelEvent): void {
    // A note being read, or a log card's entries, scroll themselves.
    if ((e.target as HTMLElement).closest("textarea, .board-log-list, .board-steps-list, .board-sheet, .board-counter-slot") && !e.ctrlKey) return;
    e.preventDefault();
    const box = this.root.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      this.setView(zoomAt(this.view, Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top));
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.setView({ ...this.view, x: this.view.x - dx, y: this.view.y - dy });
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!btn) return;
    const add = btn.dataset.add as BoardKind | undefined;
    if (add) return void (await this.addFromToolbar(add));
    const act = btn.dataset.act;
    const id = this.itemEl(btn)?.dataset.id;
    const box = this.root.getBoundingClientRect();
    if (act === "calculator") return void (await this.pickCalculator());
    if (act === "zoom-in") this.setView(zoomAt(this.view, 1.25, box.width / 2, box.height / 2));
    if (act === "zoom-out") this.setView(zoomAt(this.view, 1 / 1.25, box.width / 2, box.height / 2));
    if (act === "fit") this.setView(fitView(this.items, box.width, box.height));
    if (!id) return;
    if (act === "remove") await this.remove(id);
    if (act === "crop") await this.crop(id);
    if (act === "copy") await copyPicture(boardImageUrl(id));
    if (act === "view") this.view_(id);
    if (act === "log-view" && btn.dataset.entry) {
      const all = logPictures(this.logEntries);
      openLightbox(all.map((x) => x.picture), Math.max(0, all.findIndex((x) => x.id === btn.dataset.entry)), "The photo");
    }
    if (act === "open") this.open(id);
    if (act === "timer-go") {
      const running = this.sessions.some((s) => s.endedAt === null);
      try {
        if (running) await api.stopKnitting();
        else await api.startKnitting(this.boardId);
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Knitting time"));
      }
      await this.reloadSessions();
      this.root.dispatchEvent(new CustomEvent("knit-timer", { bubbles: true }));
    }
    if (act === "sheet-window" || act === "sheet-browser") {
      const s = this.sheets.find((x) => x.id === this.items.find((i) => i.id === id)?.data.sheetId);
      if (s) {
        try {
          if (act === "sheet-window") await api.openCheatsheetWindow(s.id, s.url, s.title);
          else await api.openLink(s.url);
        } catch (err) {
          await say(err instanceof Error ? err.message : String(err), "Cheatsheet");
        }
      }
    }
    if (act === "edit-link") await this.editLink(id);
    if (act === "log-add") await this.addToLog(id);
    if (act === "log-photo") this.chooseLogPhoto();
    if (act === "log-crop" && btn.dataset.entry) await this.cropLogPhoto(btn.dataset.entry);
    if (act === "log-copy" && btn.dataset.entry) await copyPicture(logPhotoUrl(btn.dataset.entry), "The photo");
    if (act === "log-photo-clear") this.setLogPhoto(null);
    if (act === "open-log") this.hooks.openLog?.();
    if (act === "step-tick" || act === "step-more" || act === "step-less") {
      const item = this.items.find((i) => i.id === id)!;
      const i = Number(btn.dataset.step);
      const list = readStepList(item.data);
      const next = act === "step-tick" ? tick(list, i) : countStep(list, i, act === "step-more" ? 1 : -1);
      item.data = { ...item.data, ...next };
      this.repaint(id);
      await this.save(id, { data: item.data });
    }
    if (act === "note-colour") {
      const item = this.items.find((i) => i.id === id)!;
      await this.save(id, { data: { ...item.data, colour: btn.dataset.colour } });
      this.render();
    }
  }

  /**
   * The item under a point. A press captures the pointer to the board, so the
   * click and double-click that follow are aimed at the board itself, not at
   * the item that was pressed; this finds the item again by where it is.
   */
  private itemAt(x: number, y: number): HTMLElement | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const item = this.itemEl(el);
      if (item && this.world.contains(item)) return item;
    }
    return null;
  }

  private onDouble(e: MouseEvent): void {
    const el = this.itemEl(e.target) ?? this.itemAt(e.clientX, e.clientY);
    if (!el) return;
    const item = this.items.find((i) => i.id === el.dataset.id);
    if (!item) return;
    if (item.kind === "note" || item.kind === "text") this.startEditing(item.id);
    else if (item.kind === "image" && item.hasImage) this.view_(item.id);
    else if (item.kind === "swatch") el.querySelector<HTMLInputElement>('input[type="color"]')?.click();
    else if (item.kind === "log") this.hooks.openLog?.();
    else this.open(item.id);
  }

  private async onKey(e: KeyboardEvent): Promise<void> {
    // Enter in a log card's field adds what is typed to the log.
    const field = e.target as HTMLElement;
    if (e.key === "Enter" && field.dataset?.f === "log-text") {
      e.preventDefault();
      const id = this.itemEl(field)?.dataset.id;
      if (id) await this.addToLog(id);
      return;
    }
    if (this.editing) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur();
      }
      return;
    }
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
      e.preventDefault();
      await this.remove(this.selected);
    }
    // Space opens a picture selected big.
    if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && this.selected) {
      const item = this.items.find((i) => i.id === this.selected);
      if (item?.hasImage && (item.kind === "image" || item.kind === "pin")) {
        e.preventDefault();
        this.view_(item.id);
        return;
      }
    }
    // Ctrl+C copies a picture selected, to paste anywhere.
    if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey) && !e.altKey && this.selected) {
      const item = this.items.find((i) => i.id === this.selected);
      if (item?.hasImage && (item.kind === "image" || item.kind === "pin")) {
        e.preventDefault();
        await copyPicture(boardImageUrl(item.id));
      }
      return;
    }
    if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey && this.selected) {
      const item = this.items.find((i) => i.id === this.selected);
      if (item?.hasImage && (item.kind === "image" || item.kind === "pin")) {
        e.preventDefault();
        await this.crop(item.id);
      }
    }
    if (e.key === "Enter" && this.selected) {
      const item = this.items.find((i) => i.id === this.selected);
      if (item && (item.kind === "note" || item.kind === "text")) {
        e.preventDefault();
        this.startEditing(item.id);
      }
    }
  }

  /** A note's or text's words are saved when the field is left. */
  private async onBlur(e: FocusEvent): Promise<void> {
    const area = e.target as HTMLElement;
    if (!(area instanceof HTMLTextAreaElement)) return;
    const id = this.itemEl(area)?.dataset.id;
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    const text = area.value;
    clearTimeout(this.typing.get(item.id));
    this.typing.delete(item.id);
    this.stopEditing();
    if (text !== (item.data.text ?? "")) await this.save(item.id, { data: { ...item.data, text } });
  }

  /**
   * A swatch's colour or label. Only those: a note's text area also fires
   * "change" as it is left, just before its blur, and redrawing the board
   * here then took the field away before its words could be saved.
   */
  private async onChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.dataset.f;
    if (f === "timer-auto") {
      const item = this.items.find((i) => i.id === this.itemEl(input)?.dataset.id);
      if (item) await this.save(item.id, { data: { ...item.data, auto: input.checked } });
      return;
    }
    if (f !== "colour" && f !== "label") return;
    const id = this.itemEl(input)?.dataset.id;
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    await this.save(item.id, { data: { ...item.data, [f]: input.value } });
    if (f === "colour") this.render();
  }

  /**
   * Ctrl+V on the page: a picture becomes a picture, a web address a link,
   * and other words a note. Left alone when the paste is aimed at a field --
   * a note being written, the project's name -- or a dialog, or when the
   * page's cover has asked for it.
   */
  private async onPaste(e: ClipboardEvent): Promise<void> {
    if (dialogOpen() || document.querySelector(".modal-backdrop:not(.hidden) .modal")) return;
    const target = e.target as HTMLElement;
    const focused = document.activeElement as HTMLElement | null;
    // A picture pasted while writing in the log card goes with the entry.
    const logField = [target, focused].find((el) => el?.dataset?.f === "log-text" && this.root.contains(el));
    if (logField) {
      const picture = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (picture) {
        e.preventDefault();
        await this.takeLogPhoto(picture);
      }
      return;
    }
    if (target.closest?.("input, textarea, select, [data-cover]") || focused?.closest?.("input, textarea, select, [data-cover]")) return;
    // Not while the board is hidden behind the project's log.
    if (!this.root.isConnected || this.root.closest("[hidden]")) return;
    const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
    if (file) {
      e.preventDefault();
      await this.addImage(file, null);
      return;
    }
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text) return;
    e.preventDefault();
    const url = linkFrom(text);
    if (url) await this.add("link", this.placeFor("link"), { url, title: hostOf(url) });
    else await this.add("note", this.placeFor("note"), { text, colour: "yellow" });
  }

  private async onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    this.root.classList.remove("over");
    const box = this.root.getBoundingClientRect();
    const at = toBoard(this.view, e.clientX - box.left, e.clientY - box.top);
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    // Pictures dropped on the log card go into the log: one waits for words
    // to go with it; several are an entry each, at once.
    if (files.length && (e.target as HTMLElement | null)?.closest?.('.board-item[data-kind="log"]')) {
      if (files.length === 1) return void (await this.takeLogPhoto(files[0]));
      for (const f of files) {
        const blob = await prepareChosenImage(f);
        if (!blob) continue;
        const entry = await api.addLogEntry(this.boardId, "");
        await api.setLogPhoto(entry.id, await blobBytes(blob));
      }
      return void (await this.refreshLog());
    }
    if (files.length) {
      for (const [i, f] of files.entries()) await this.addImage(f, { x: Math.round(at.x + i * 30), y: Math.round(at.y + i * 30) });
      return;
    }
    const url = linkFrom(e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "");
    if (url) await this.add("link", { x: Math.round(at.x), y: Math.round(at.y) }, { url, title: hostOf(url) });
  }

  // ---------- adding ----------

  private async addFromToolbar(kind: BoardKind): Promise<void> {
    const at = this.placeFor(kind);
    if (kind === "note") {
      const item = await this.add("note", at, { text: "", colour: NOTE_COLOURS[this.items.length % NOTE_COLOURS.length] });
      if (item) this.startEditing(item.id);
    } else if (kind === "text") {
      const item = await this.add("text", at, { text: "" });
      if (item) this.startEditing(item.id);
    } else if (kind === "link") {
      const answer = await askForm([{ label: "Address", placeholder: "e.g. ravelry.com/patterns/…" }, { label: "Title", placeholder: "Optional" }], { title: "Add a link", okLabel: "Add" });
      if (!answer) return;
      const url = linkFrom(answer.Address);
      if (!url) return void (await say("That is not a web address. It should look like ravelry.com/… or https://…", "Add a link"));
      await this.add("link", at, { url, title: answer.Title.trim() || hostOf(url) });
    } else if (kind === "image") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.addEventListener("change", async () => {
        for (const f of [...(input.files ?? [])]) await this.addImage(f, null);
      });
      input.click();
    } else if (kind === "pattern") {
      const own = this.hooks.project()?.patternId ?? null;
      const choices: Choice[] = this.patterns
        .map((p) => ({ value: p.id, label: p.designer ? `${p.title} — ${p.designer}` : p.title, group: p.id === own ? "This project's pattern" : p.status === "want-to-knit" ? "Want to knit" : "Library" }))
        .sort((a, b) => PATTERN_GROUPS.indexOf(a.group) - PATTERN_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label));
      if (!choices.length) return void (await say("There are no patterns in the library yet.", "Add a pattern"));
      const id = await askChoice("Which pattern?", choices, { title: "Add a pattern" });
      if (id) await this.add("pattern", at, { patternId: id });
    } else if (kind === "yarn") {
      const own = new Set(this.hooks.project()?.yarns.map((y) => y.yarnId) ?? []);
      const choices: Choice[] = this.yarns
        .map((y) => ({ value: y.id, label: [y.name, y.colourway, y.brand].filter(Boolean).join(" · "), group: own.has(y.id) ? "On this project" : "Stash" }))
        .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Stash" ? 1 : -1));
      if (!choices.length) return void (await say("There is no yarn in the stash yet.", "Add a yarn"));
      const id = await askChoice("Which yarn?", choices, { title: "Add a yarn" });
      if (id) await this.add("yarn", at, { yarnId: id });
    } else if (kind === "tool") {
      const own = new Set(this.hooks.project()?.toolIds ?? []);
      const group = (t: Tool) => (own.has(t.id) ? "On this project" : t.projectId ? "On another project" : "Free");
      const order = ["On this project", "Free", "On another project"];
      const choices: Choice[] = this.tools
        .map((t) => ({ value: t.id, label: describe(t), group: group(t) }))
        .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
      if (!choices.length) return void (await say("There are no needles or hooks yet.", "Add a needle"));
      const id = await askChoice("Which needle, hook or cable?", choices, { title: "Add a needle" });
      if (id) await this.add("tool", at, { toolId: id });
    } else if (kind === "chart") {
      this.charts = await api.listCharts().catch(() => this.charts);
      const choices: Choice[] = this.charts.map((c) => ({
        value: c.id,
        label: c.name,
        group: c.data.kind === "yoke" ? "Round yokes" : c.data.kind === "lace" ? "Lace" : "Colourwork",
      }));
      if (!choices.length) return void (await say("There are no charts yet: draw one under Calculators → Charts.", "Add a chart"));
      const id = await askChoice("Which chart?", choices, { title: "Add a chart" });
      if (id) await this.add("chart", at, { chartId: id });
    } else if (kind === "sheet") {
      this.sheets = await api.listCheatsheets().catch(() => this.sheets);
      const choices: Choice[] = this.sheets.map((s) => ({ value: s.id, label: s.title, group: s.kind === "web" ? "Web pages" : "From books" }));
      if (!choices.length) return void (await say("There are no cheatsheets yet: keep a web page or a book's pages in the Cheatsheets tab.", "Add a cheatsheet"));
      const id = await askChoice("Which cheatsheet?", choices, { title: "Add a cheatsheet" });
      if (id) await this.add("sheet", at, { sheetId: id });
    } else if (kind === "video") {
      const classes = await api.listMasterclasses().catch(() => []);
      const own = this.hooks.project()?.masterclassId ?? "";
      const choices: Choice[] = classes
        .flatMap((m) => m.parts.map((p, i) => ({ value: p.id, label: m.parts.length > 1 ? `${i + 1}. ${p.title}` : p.title, group: m.id === own ? `This project's: ${m.title}` : m.title, own: m.id === own })))
        .sort((a, b) => Number(b.own) - Number(a.own))
        .map(({ value, label, group }) => ({ value, label, group }));
      if (!choices.length) return void (await say("There are no videos yet: keep them in the Masterclasses tab.", "Add a video"));
      const id = await askChoice("Which video?", choices, { title: "Add a video" });
      const m = classes.find((x) => x.parts.some((p) => p.id === id));
      const part = m?.parts.find((p) => p.id === id);
      if (m && part) await this.addVideo(m.id, part);
    } else if (kind === "counter") {
      if (!this.hooks.counter?.()) return void (await say("The counter counts the rows of the project's pattern: choose its pattern first, on the side.", "Counter"));
      // One counter, as one timer.
      const there = this.items.find((i) => i.kind === "counter");
      if (there) {
        this.reveal(there);
        return this.select(there.id);
      }
      await this.add("counter", at, {});
    } else if (kind === "timer") {
      // One timer is enough, as one log is.
      const there = this.items.find((i) => i.kind === "timer");
      if (there) {
        this.reveal(there);
        return this.select(there.id);
      }
      await this.add("timer", at, { auto: true });
    } else if (kind === "log") {
      // One log is enough: a second card would show the same.
      const there = this.items.find((i) => i.kind === "log");
      if (there) return this.select(there.id);
      const item = await this.add("log", at, {});
      if (item) this.world.querySelector<HTMLInputElement>(`.board-item[data-id="${item.id}"] input[data-f="log-text"]`)?.focus();
    } else if (kind === "swatch") {
      const colour = SWATCHES[this.items.filter((i) => i.kind === "swatch").length % SWATCHES.length];
      const item = await this.add("swatch", at, { colour, label: "" });
      if (item) this.world.querySelector<HTMLInputElement>(`.board-item[data-id="${item.id}"] input[data-f="label"]`)?.focus();
    }
  }

  /**
   * A masterclass's video, playing on the board: the one there already, if
   * it is, picked rather than a second put down.
   */
  async addVideo(masterclassId: string, part: { id: string; videoId: string; title: string; url: string }): Promise<void> {
    const there = this.items.find((i) => i.kind === "video" && i.data.partId === part.id);
    if (there) return this.select(there.id);
    await this.add("video", this.placeFor("video"), { masterclassId, partId: part.id, videoId: part.videoId, title: part.title, url: part.url });
  }

  private async add(kind: BoardKind, at: { x: number; y: number }, data: Record<string, unknown>, size = SIZES[kind]): Promise<BoardItem | null> {
    try {
      const item = await api.addBoardItem(this.boardId, { kind, x: at.x, y: at.y, w: size[0], h: size[1], data });
      this.items.push(item);
      this.render();
      this.select(item.id);
      this.reveal(item);
      return item;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Board");
      return null;
    }
  }

  /** A picture: downscaled, then stored, at the shape it is; placed in free space unless dropped somewhere. */
  private async addImage(file: Blob, at: { x: number; y: number } | null): Promise<void> {
    const prepared = await prepareBoardImage(file);
    if (!prepared) return void (await say("That could not be read as a picture.", "Board"));
    const w = 300;
    const h = Math.max(40, Math.round((w * prepared.height) / prepared.width));
    const item = await this.add("image", at ?? this.placeFor("image", [w, h]), {}, [w, h]);
    if (!item) return;
    try {
      const stored = await api.setBoardImage(item.id, await blobBytes(prepared.blob));
      Object.assign(item, stored);
      forgetBoardImage(item.id);
      this.render();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Board");
    }
  }

  // ---------- changing ----------

  /** Crops a picture on the board: the new one replaces it, and the item takes its shape at the same width. */
  private async crop(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    const url = item && (await boardImageUrl(id));
    if (!item || !url) return;
    const cropped = await cropImage(url);
    if (!cropped) return;
    const prepared = await prepareBoardImage(cropped);
    if (!prepared) return void (await say("The cropped picture could not be made.", "Crop"));
    try {
      const stored = await api.setBoardImage(id, await blobBytes(prepared.blob));
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = stored;
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Crop"));
    }
    forgetBoardImage(id);
    await this.save(id, { h: Math.max(40, Math.round((item.w * prepared.height) / prepared.width)) });
    this.render();
  }

  /** Crops a photo in the log, from the log card; the cropped one replaces it. */
  private async cropLogPhoto(entryId: string): Promise<void> {
    const url = await logPhotoUrl(entryId);
    if (!url) return;
    const cropped = await cropImage(url, "Crop the photo", "image/jpeg");
    if (!cropped) return;
    try {
      await api.setLogPhoto(entryId, await blobBytes(cropped));
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Crop"));
    }
    forgetLogPhoto(entryId);
    await this.refreshLog();
  }

  private async save(id: string, patch: Parameters<typeof api.updateBoardItem>[1]): Promise<void> {
    try {
      const stored = await api.updateBoardItem(id, patch);
      const i = this.items.findIndex((x) => x.id === id);
      if (i >= 0) this.items[i] = stored;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Board");
    }
  }

  /** Selecting an item brings it to the top, so it can be seen whole. */
  private select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    for (const el of this.world.querySelectorAll<HTMLElement>(".board-item")) el.classList.toggle("selected", el.dataset.id === id);
    if (!id) return;
    const item = this.items.find((i) => i.id === id);
    const top = Math.max(...this.items.map((i) => i.z));
    if (item && item.z < top) {
      item.z = top + 1;
      const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${id}"]`);
      if (el) el.style.zIndex = String(item.z);
      void this.save(id, { toFront: true });
    }
  }

  private startEditing(id: string): void {
    this.editing = id;
    const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${id}"]`);
    el?.classList.add("editing");
    const area = el?.querySelector<HTMLTextAreaElement>("textarea");
    if (area) {
      area.readOnly = false;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }

  private stopEditing(): void {
    if (!this.editing) return;
    const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${this.editing}"]`);
    el?.classList.remove("editing");
    const area = el?.querySelector<HTMLTextAreaElement>("textarea");
    if (area) area.readOnly = true;
    this.editing = null;
  }

  private async remove(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    // An empty note is a slip, and goes without asking.
    const empty = (item.kind === "note" || item.kind === "text") && !String(item.data.text ?? "").trim();
    if (!empty && !(await askYesNo(`Remove this ${KIND_NAMES[item.kind]} from the board?`, { okLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteBoardItem(id);
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Board"));
    }
    this.items = this.items.filter((i) => i.id !== id);
    if (this.selected === id) this.selected = null;
    forgetBoardImage(id);
    this.render();
    this.root.focus();
  }

  /** The board's pictures opened big, at this one: the next is the next on the board. */
  private view_(id: string): void {
    const pictures = this.items.filter((i) => i.hasImage && (i.kind === "image" || i.kind === "pin"));
    openLightbox(
      pictures.map((i) => ({ url: () => boardImageUrl(i.id), caption: typeof i.data.title === "string" ? i.data.title : "" })),
      Math.max(0, pictures.findIndex((i) => i.id === id)),
    );
  }

  private open(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if ((item.kind === "pattern" || item.kind === "pin") && typeof item.data.patternId === "string") this.hooks.openPattern(item.data.patternId);
    if (item.kind === "chart" && typeof item.data.chartId === "string" && this.charts.some((c) => c.id === item.data.chartId)) this.hooks.openChart?.(item.data.chartId);
    // A cheatsheet, open in its tab.
    if (item.kind === "sheet" && typeof item.data.sheetId === "string" && this.sheets.some((s) => s.id === item.data.sheetId)) {
      keepSheetOpen(item.data.sheetId);
      this.root.dispatchEvent(new CustomEvent("show-cheatsheets", { bubbles: true }));
    }
    if ((item.kind === "link" || item.kind === "video") && typeof item.data.url === "string") {
      void api.openLink(item.data.url).catch((e) => say(e instanceof Error ? e.message : String(e), "Link"));
    }
  }

  private async editLink(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    const answer = await askForm(
      [{ label: "Address", value: String(item.data.url ?? "") }, { label: "Title", value: String(item.data.title ?? "") }],
      { title: "Edit link" },
    );
    if (!answer) return;
    const url = linkFrom(answer.Address);
    if (!url) return void (await say("That is not a web address.", "Edit link"));
    await this.save(id, { data: { ...item.data, url, title: answer.Title.trim() || hostOf(url) } });
    this.render();
  }

  // ---------- drawing ----------

  private render(): void {
    this.world.innerHTML = this.items.map((i) => this.itemHtml(i)).join("");
    (this.root.querySelector(".board-empty") as HTMLElement).hidden = this.items.length > 0;
    void this.fillPictures();
    this.paintCharts();
    void this.paintSheets();
    this.placeCounter();
  }

  /** The project's counter, in its card; kept in the page when there is none. */
  placeCounter(): void {
    const host = this.hooks.counter?.();
    if (!host) return;
    const slot = this.world.querySelector<HTMLElement>(".board-counter-slot");
    if (slot) {
      if (host.parentElement !== slot) slot.replaceChildren(host);
      // Folded up is for a side panel; on its card the counter is all there.
      host.querySelector(".counter-body")?.removeAttribute("hidden");
    } else {
      this.hooks.parkCounter?.(host);
    }
  }

  /** The counter made again (the pattern changed): its card, if there is one, shows the new one. */
  counterChanged(): void {
    const card = this.items.find((i) => i.kind === "counter");
    if (card) this.repaint(card.id);
    this.placeCounter();
  }

  /** Whether the counter is on the board, to be counted with. */
  hasCounter(): boolean {
    return this.items.some((i) => i.kind === "counter") && !!this.hooks.counter?.();
  }

  /**
   * Each cheatsheet card's book pages, drawn to the card's width, and an
   * EPUB chapter's copy; kept as drawn while the sheet and the width stay.
   */
  private async paintSheets(): Promise<void> {
    for (const box of this.world.querySelectorAll<HTMLElement>(".board-sheet[data-sheet-of]")) {
      const itemId = this.itemEl(box)?.dataset.id ?? "";
      const s = this.sheets.find((x) => x.id === box.dataset.sheetOf);
      if (!s) continue;
      const width = Math.max(120, Math.round(box.clientWidth - 16));
      const key = JSON.stringify([s.id, s.kind, s.patternId, s.pageFrom, s.pageTo, s.region, s.kind === "pages" ? width : 0]);
      const kept = this.sheetPages.get(itemId);
      if (kept?.key === key) {
        box.replaceChildren(kept.node);
        continue;
      }
      const node = document.createElement("div");
      node.className = "board-sheet-pages";
      this.sheetPages.set(itemId, { key, node });
      box.replaceChildren(node);
      if (s.kind === "chapter") {
        const html = await api.readCheatsheetCopy(s.id).catch(() => null);
        if (html === null) {
          node.innerHTML = `<p class="board-caption missing">The chapter's copy could not be read.</p>`;
          continue;
        }
        const frame = document.createElement("iframe");
        frame.className = "board-sheet-chapter";
        frame.setAttribute("sandbox", "");
        frame.title = s.title;
        frame.srcdoc = html;
        node.replaceChildren(frame);
        continue;
      }
      const book = this.patterns.find((p) => p.id === s.patternId);
      if (!book) continue;
      const failed = await drawSheetPages(s, book, width, s.region, (canvas) => node.appendChild(canvas), () => this.sheetPages.get(itemId)?.node === node);
      if (failed) node.innerHTML = `<p class="board-caption missing">${esc(failed)}</p>`;
    }
  }

  /** Each chart card's chart, drawn as the chart is now, as big as the card lets it. */
  private paintCharts(root: ParentNode = this.world): void {
    for (const canvas of root.querySelectorAll<HTMLCanvasElement>("canvas[data-chart-of]")) {
      const chart = this.charts.find((c) => c.id === canvas.dataset.chartOf);
      const box = canvas.parentElement!;
      if (!chart) continue;
      const g = decode(chart.data);
      normalize(g);
      const w = Math.max(20, box.clientWidth - 12);
      const h = Math.max(20, box.clientHeight - 12);
      const side = Math.max(1, Math.min(w / g.width, h / g.height));
      const ctx = sizeCanvas(canvas, side * g.width, side * g.height);
      drawChart(new CanvasPainter(ctx), g, { x: 0, y: 0, cw: side, ch: side, line: side > 6 ? 0.5 : 0.01 });
    }
  }

  private itemHtml(item: BoardItem): string {
    const d = item.data;
    const style = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;z-index:${item.z}`;
    const cls = `board-item kind-${item.kind}${item.id === this.selected ? " selected" : ""}`;
    // A picture, or a pin, can be cropped and copied: labelled buttons as it is pointed at or selected, or C and Ctrl+C.
    const crop =
      item.hasImage && (item.kind === "image" || item.kind === "pin")
        ? `<span class="board-pic-tools"><button class="board-crop" data-act="view" title="See it big (double-click it, or Space with it selected)">⤢ View</button><button class="board-crop" data-act="crop" title="Crop the picture (C, with it selected)">✂ Crop</button><button class="board-crop" data-act="copy" title="Copy the picture, to paste anywhere (Ctrl+C, with it selected)">⧉ Copy</button></span>`
        : "";
    const remove = `${crop}<button class="board-x" data-act="remove" title="Remove from the board">✕</button>`;
    const grip = `<span class="board-grip" title="Drag to resize"></span>`;
    let body = "";
    let extra = "";
    switch (item.kind) {
      case "note": {
        const colour = NOTE_COLOURS.includes(d.colour as (typeof NOTE_COLOURS)[number]) ? d.colour : "yellow";
        extra = `<div class="note-colours">${NOTE_COLOURS.map((c) => `<button data-act="note-colour" data-colour="${c}" class="dot note-${c}" title="${c}"></button>`).join("")}</div>`;
        body = `<textarea readonly placeholder="Double-click to write" class="note-${colour}">${esc(String(d.text ?? ""))}</textarea>`;
        break;
      }
      case "text":
        body = `<textarea readonly placeholder="Double-click to write">${esc(String(d.text ?? ""))}</textarea>`;
        break;
      case "link": {
        const url = String(d.url ?? "");
        body = `
          <div class="link-card">
            <strong>${esc(String(d.title || hostOf(url)))}</strong>
            <span class="link-host">${esc(hostOf(url))}</span>
            <div class="board-actions">
              <button data-act="open" title="${esc(url)}">Open ↗</button>
              <button data-act="edit-link">Edit</button>
            </div>
          </div>`;
        break;
      }
      case "image":
        body = `<div class="board-picture" data-picture="${item.id}"></div>`;
        break;
      case "pin": {
        // A pattern's pin: its picture, and where in which pattern it is from.
        const p = this.patterns.find((x) => x.id === d.patternId);
        const from = [`p.${Number(d.page) || 1}`, p?.title ?? ""].filter(Boolean).join(" · ");
        body = `<div class="board-picture" data-picture="${item.id}"></div>
          <div class="board-pin-caption" title="${esc(String(d.title || ""))}">📌 ${esc(from)}</div>`;
        break;
      }
      case "pattern": {
        const p = this.patterns.find((x) => x.id === d.patternId);
        body = p
          ? `<div class="board-cover" data-cover-of="${p.id}"><span>${esc(p.format.toUpperCase())} pattern</span></div>
             <div class="board-caption"><strong>${esc(p.title)}</strong>${p.designer ? `<span>${esc(p.designer)}</span>` : ""}
               <button data-act="open">Open pattern</button></div>`
          : `<div class="board-caption missing">A pattern no longer in the library</div>`;
        break;
      }
      case "yarn": {
        const y = this.yarns.find((x) => x.id === d.yarnId);
        body = y
          ? `<div class="board-cover yarn" data-yarn-of="${y.id}"><span>${esc(y.yarnWeight || "Yarn")}</span></div>
             <div class="board-caption"><strong>${esc(y.name)}</strong><span>${esc([y.colourway, y.brand].filter(Boolean).join(" · "))}</span></div>`
          : `<div class="board-caption missing">A yarn no longer in the stash</div>`;
        break;
      }
      case "tool": {
        const t = this.tools.find((x) => x.id === d.toolId);
        body = t
          ? `<div class="board-tool"><span class="tool-size">${esc(headline(t))}</span><span>${esc(kindLabel(t.kind))}</span><small>${esc(describe(t))}</small></div>`
          : `<div class="board-caption missing">A needle no longer in the box</div>`;
        break;
      }
      case "log":
        body = this.logHtml();
        break;
      case "video": {
        // Moved by its bar: the player takes the presses on itself.
        const videoId = String(d.videoId ?? "");
        body = `
          <div class="board-video-bar" title="Drag here to move it"><span>🎬 ${esc(String(d.title ?? ""))}</span><button data-act="open" title="Open it in your browser">↗</button></div>
          ${videoId ? playerHtml({ videoId, title: String(d.title ?? "") }, "board-video") : `<div class="board-caption missing">Only YouTube videos play on the board: ↗ opens it.</div>`}`;
        break;
      }
      case "steps":
        body = this.stepsHtml(d);
        break;
      case "timer":
        body = this.timerHtml(d);
        break;
      case "counter":
        // The page's own counter is moved in after: it keeps its state and its keys.
        body = this.hooks.counter?.()
          ? `<div class="board-counter-slot"></div>`
          : `<div class="board-caption missing">The counter counts the rows of the project's pattern: choose one, on the side.</div>`;
        break;
      case "sheet": {
        // Moved by its bar; a web page in a frame, a book's pages drawn after.
        const s = this.sheets.find((x) => x.id === d.sheetId);
        if (!s) {
          body = `<div class="board-caption missing">A cheatsheet no longer kept</div>`;
          break;
        }
        const web = s.kind === "web";
        const book = this.patterns.find((p) => p.id === s.patternId);
        const bar = `<div class="board-chart-bar board-sheet-bar" title="Drag here to move it"><span>📋 ${esc(s.title)}</span>${
          web ? `<button data-act="sheet-window" title="In a window of its own, beside the app">Window ↗</button>` : ""
        }<button data-act="open" title="Open it in Cheatsheets">Open ↗</button></div>`;
        const inner = web
          ? s.framable
            ? sheetFrameHtml(s, "board-sheet-frame")
            : `<div class="board-sheet-refused"><p>${esc(hostOf(s.url))} will not be shown inside another app.</p><button data-act="sheet-window">Open in a window of its own</button><button class="ghost" data-act="sheet-browser">In your browser</button></div>`
          : s.kind === "pages" && !book
            ? `<div class="board-caption missing">The book these pages are from is no longer in the library.</div>`
            : `<div class="board-sheet" data-sheet-of="${esc(s.id)}"></div>`;
        body = bar + inner;
        break;
      }
      case "chart": {
        // Moved by its bar; drawn after, from the chart as it is now.
        const chart = this.charts.find((c) => c.id === d.chartId);
        body = chart
          ? `<div class="board-chart-bar" title="${esc(describeChart(decode(chart.data)))}"><span>▦ ${esc(chart.name)}</span><button data-act="open" title="Open the chart, to change it">Open ↗</button></div>
             <div class="board-chart"><canvas data-chart-of="${esc(chart.id)}"></canvas></div>`
          : `<div class="board-caption missing">A chart no longer in Calculators</div>`;
        break;
      }
      case "swatch": {
        const colour = /^#[0-9a-f]{6}$/i.test(String(d.colour)) ? String(d.colour) : "#c94c6d";
        body = `
          <div class="swatch-colour" style="background:${colour}" title="Double-click to change the colour">
            <input type="color" data-f="colour" value="${colour}" tabindex="-1" />
          </div>
          <input class="swatch-label" data-f="label" value="${esc(String(d.label ?? ""))}" placeholder="${colour}" />`;
        break;
      }
    }
    return `<div class="${cls}" data-id="${item.id}" data-kind="${item.kind}" style="${style}">${body}${extra}${remove}${grip}</div>`;
  }

  /**
   * One item drawn again in place, the others left as they are (a video
   * playing goes on playing), its list scrolled where it was.
   */
  /** The project's time read again, and its timer card drawn again. */
  private async reloadSessions(): Promise<void> {
    if (!this.hooks.project()) return;
    this.sessions = await api.listKnitSessions(this.boardId).catch(() => this.sessions);
    for (const item of this.items) if (item.kind === "timer") this.repaint(item.id);
  }

  /** A second on, on the timer card: its clock and the total. */
  private tickTimer(): void {
    const running = this.sessions.find((s) => s.endedAt === null);
    if (!running) return;
    const clockEl = this.world.querySelector('[data-el="timer-clock"]');
    if (clockEl) clockEl.textContent = clock(sessionMs(running));
    const totalEl = this.world.querySelector('[data-el="timer-total"]');
    if (totalEl) totalEl.textContent = `${hoursText(totalMs(this.sessions))} in all`;
  }

  /** The timer card shown, from the tab bar's timer; false when the board has none. */
  showTimer(): boolean {
    const item = this.items.find((i) => i.kind === "timer");
    if (!item) return false;
    this.reveal(item);
    this.select(item.id);
    const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"]`);
    el?.classList.remove("timer-shown");
    void el?.offsetWidth;
    el?.classList.add("timer-shown");
    return true;
  }

  /**
   * The knitting timer, big: this project's clock while it runs, its time in
   * all, a big Start or Stop, and whether counting a row keeps it.
   */
  private timerHtml(d: Record<string, unknown>): string {
    const running = this.sessions.find((s) => s.endedAt === null);
    const live = isLive(this.hooks.project()?.status ?? "");
    const go = running
      ? `<button class="primary board-timer-go" data-act="timer-go" title="Stop the timer: you have put it down">■ Stop</button>`
      : `<button class="board-timer-go" data-act="timer-go" title="Time your knitting: it runs with the app closed too">▶ Start</button>`;
    return `
      <div class="board-timer-bar" title="Drag here to move it">⏱ Knitting time</div>
      <div class="board-timer">
        <div class="board-timer-clock${running ? " running" : ""}" data-el="timer-clock">${running ? clock(sessionMs(running)) : "0:00:00"}</div>
        <div class="board-timer-total" data-el="timer-total">${this.sessions.length ? `${hoursText(totalMs(this.sessions))} in all` : "Not timed yet"}</div>
        ${live ? go : `<p class="board-timer-total">Finished: its time is added by hand, on the side.</p>`}
        <label class="board-timer-auto" title="Counting a row starts the timer; five minutes without one stops it, as at the last row counted">
          <input type="checkbox" data-f="timer-auto" ${d.auto !== false ? "checked" : ""} />
          <span>Start with a row counted, stop after 5 minutes without one</span>
        </label>
      </div>`;
  }

  private repaint(id: string): void {
    const el = this.world.querySelector<HTMLElement>(`.board-item[data-id="${id}"]`);
    const item = this.items.find((i) => i.id === id);
    if (!el || !item) return;
    const scrolled = el.querySelector(".board-steps-list")?.scrollTop ?? 0;
    const t = document.createElement("template");
    t.innerHTML = this.itemHtml(item).trim();
    const fresh = t.content.firstElementChild as HTMLElement;
    el.replaceWith(fresh);
    const list = fresh.querySelector(".board-steps-list");
    if (list) list.scrollTop = scrolled;
    if (item.kind === "counter") this.placeCounter();
  }

  /**
   * A calculator's steps as a checklist: each ticked when done, the first not
   * done marked as the one being knitted, and a step that repeats counted,
   * ticked by itself at its last time.
   */
  private stepsHtml(data: Record<string, unknown>): string {
    const list: StepList = readStepList(data);
    const now = nowAt(list);
    const { done, total } = progress(list);
    const steps = list.steps
      .map(
        (s, i) => `
        <li class="board-step${s.done ? " done" : ""}${i === now ? " now" : ""}">
          <button class="step-tick" data-act="step-tick" data-step="${i}" title="${s.done ? "Not done after all" : "Done"}" aria-pressed="${s.done}">${s.done ? "✓" : ""}</button>
          <div class="step-body">
            ${i === now ? `<span class="step-now">Knitting now</span>` : ""}
            <p>${esc(s.text)}</p>
            ${
              s.times
                ? `<div class="step-count" title="Times done, of the times it is worked">
                    <button data-act="step-less" data-step="${i}" aria-label="One fewer" ${s.count ? "" : "disabled"}>−</button>
                    <b>${s.count}</b> of ${s.times}
                    <button data-act="step-more" data-step="${i}" aria-label="One more" ${s.count >= s.times ? "disabled" : ""}>+</button>
                  </div>`
                : ""
            }
          </div>
        </li>`,
      )
      .join("");
    return `
      <div class="board-steps">
        <div class="board-steps-head" title="Drag here to move it">
          <strong>${esc(list.title || "Steps")}</strong>
          <span class="board-steps-done">${done === total && total ? "All done" : `${done} of ${total} done`}</span>
        </div>
        <div class="board-steps-list">
          ${list.intro ? `<p class="board-steps-intro">${esc(list.intro)}</p>` : ""}
          <ol class="board-steps-ol">${steps}</ol>
        </div>
      </div>`;
  }

  /** A log card: a field to write in, and the entries, the newest first, with their photos. */
  private logHtml(): string {
    const when = (at: number) =>
      new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const entries = this.logEntries
      .map(
        (e) => `
        <div class="board-log-entry${e.milestone ? " milestone" : ""}">
          <span class="board-log-when">${esc(when(e.at))}</span>
          ${e.text ? (e.milestone ? `<b>${esc(e.text)}</b>` : `<p>${esc(e.text)}</p>`) : ""}
          ${e.photoPath ? `<div class="board-log-photo" data-log-photo="${esc(e.id)}"><span class="board-pic-tools"><button class="board-crop" data-act="log-view" data-entry="${esc(e.id)}" title="See this photo big">⤢ View</button><button class="board-crop" data-act="log-crop" data-entry="${esc(e.id)}" title="Crop this photo">✂ Crop</button><button class="board-crop" data-act="log-copy" data-entry="${esc(e.id)}" title="Copy this photo, to paste anywhere">⧉ Copy</button></span></div>` : ""}
        </div>`,
      )
      .join("");
    return `
      <div class="board-log">
        <div class="board-log-head">
          <strong>📓 Log</strong>
          <button data-act="open-log" title="The whole log, to change or remove entries and add photos">Open ↗</button>
        </div>
        <div class="board-log-compose">
          <input data-f="log-text" value="${esc(this.logDraft)}" placeholder="What happened? Enter adds it" />
          <button data-act="log-photo" title="A photo to go with it: or paste one here with Ctrl+V, or drop one on the card" aria-label="Add a photo">📷</button>
          <button data-act="log-add">Add</button>
        </div>
        ${this.logPendingHtml()}
        <div class="board-log-list">${entries || `<p class="board-log-empty">Nothing in the log yet.</p>`}</div>
      </div>`;
  }

  /** A calculator chosen, opened with this board's project to save its result to. */
  private async pickCalculator(): Promise<void> {
    const calc = await askChoice("Which calculator? Its result is saved to this board.", BOARD_CALCULATORS.map((c) => ({ value: c.key, label: c.label })), { title: "Calculator" });
    if (calc) this.hooks.openCalculator?.(calc);
  }

  /** Pictures, pattern covers and yarn photos, filled in once their bytes arrive. */
  private async fillPictures(): Promise<void> {
    const paint = async (el: HTMLElement, url: Promise<string | null>) => {
      const u = await url;
      if (u) {
        el.style.backgroundImage = `url("${u}")`;
        el.classList.add("filled");
      }
    };
    await Promise.all([
      ...[...this.world.querySelectorAll<HTMLElement>("[data-picture]")].map((el) => paint(el, boardImageUrl(el.dataset.picture!))),
      ...[...this.world.querySelectorAll<HTMLElement>("[data-cover-of]")].map((el) => paint(el, coverUrl(el.dataset.coverOf!))),
      ...[...this.world.querySelectorAll<HTMLElement>("[data-log-photo]")].map((el) => paint(el, logPhotoUrl(el.dataset.logPhoto!))),
      ...[...this.world.querySelectorAll<HTMLElement>("[data-yarn-of]")]
        .filter((el) => this.yarns.find((y) => y.id === el.dataset.yarnOf)?.photoPath)
        .map((el) => paint(el, yarnPhotoUrl(el.dataset.yarnOf!))),
    ]);
  }
}

/** The order the pattern picker lists its groups in. */
const PATTERN_GROUPS = ["This project's pattern", "Want to knit", "Library"];

const KIND_NAMES: Record<BoardKind, string> = {
  note: "note",
  text: "text",
  link: "link",
  image: "picture",
  pattern: "pattern",
  yarn: "yarn",
  tool: "needle",
  swatch: "colour",
  log: "log card",
  pin: "pin",
  video: "video",
  steps: "checklist",
  chart: "chart",
  sheet: "cheatsheet",
  timer: "timer",
  counter: "row counter",
};

/**
 * The nearest place to (cx, cy) where a w × h item overlaps nothing, with a
 * gap: rings of candidate spots, searched outwards. Falls back to the middle
 * when the board is that crowded.
 */
export function freeSpot(items: { x: number; y: number; w: number; h: number }[], w: number, h: number, cx: number, cy: number, gap = 24): { x: number; y: number } {
  const clear = (x: number, y: number) =>
    items.every((i) => x + w + gap <= i.x || i.x + i.w + gap <= x || y + h + gap <= i.y || i.y + i.h + gap <= y);
  const step = 40;
  for (let ring = 0; ring <= 30; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = Math.round(cx - w / 2 + dx * step);
        const y = Math.round(cy - h / 2 + dy * step);
        if (clear(x, y)) return { x, y };
      }
    }
  }
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
