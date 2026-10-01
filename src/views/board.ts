import { api, type BoardItem, type BoardKind, type Pattern, type Project, type Tool, type Yarn } from "../api";
import { askChoice, askForm, askYesNo, dialogOpen, say, type Choice } from "../dialogs";
import { blobBytes, boardImageUrl, coverUrl, forgetBoardImage, prepareBoardImage, yarnPhotoUrl } from "../covers";
import { describe, headline, kindLabel } from "./tool-filter";

/**
 * A project's board: an endless surface to collect what the project is made
 * of and what it should look like -- notes, pictures, links, the pattern, the
 * yarn and needles, colours -- laid out freely, as on a Miro board.
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
};

const NOTE_COLOURS = ["yellow", "pink", "blue", "green", "purple"] as const;
const SWATCHES = ["#c94c6d", "#e3a458", "#7aa874", "#4f7cac", "#8e6bb8", "#d8c3a5", "#2f4858"];

export interface BoardHooks {
  /** The project, for its own pattern, needles and yarn to come first in the pickers. */
  project(): Project;
  openPattern(id: string): void;
}

export class Board {
  private host: HTMLElement;
  private projectId: string;
  private hooks: BoardHooks;
  private root!: HTMLElement;
  private world!: HTMLElement;
  private items: BoardItem[] = [];
  private view: View = { x: 40, y: 40, scale: 1 };
  private selected: string | null = null;
  private editing: string | null = null;
  private patterns: Pattern[] = [];
  private yarns: Yarn[] = [];
  private tools: Tool[] = [];
  /** A press in progress: panning the board, or moving or sizing an item. */
  private drag:
    | { mode: "pan"; pointer: number; sx: number; sy: number; vx: number; vy: number }
    | { mode: "move" | "size"; pointer: number; sx: number; sy: number; id: string; x: number; y: number; w: number; h: number; moved: boolean }
    | null = null;
  private teardown: (() => void)[] = [];

  constructor(host: HTMLElement, projectId: string, hooks: BoardHooks) {
    this.host = host;
    this.projectId = projectId;
    this.hooks = hooks;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "board";
    this.root.tabIndex = 0;
    this.root.innerHTML = `
      <div class="board-world"></div>
      <div class="board-tools" role="toolbar" aria-label="Add to the board">
        <button data-add="note" title="A sticky note">🗒<span>Note</span></button>
        <button data-add="text" title="Words on the board">T<span>Text</span></button>
        <button data-add="link" title="A web address">🔗<span>Link</span></button>
        <button data-add="image" title="A picture: choose one, paste it with Ctrl+V, or drop it on the board">🖼<span>Picture</span></button>
        <button data-add="pattern" title="A pattern from the library">📄<span>Pattern</span></button>
        <button data-add="yarn" title="A yarn from the stash">🧶<span>Yarn</span></button>
        <button data-add="tool" title="A needle, hook or cable">🪡<span>Needle</span></button>
        <button data-add="swatch" title="A colour">🎨<span>Colour</span></button>
      </div>
      <div class="board-zoom">
        <button data-act="zoom-out" title="Zoom out">−</button>
        <span data-el="zoom">100%</span>
        <button data-act="zoom-in" title="Zoom in">+</button>
        <button data-act="fit" title="Show everything">Fit</button>
      </div>
      <p class="board-empty" hidden>
        Collect what this project is made of: notes, pictures, links, the pattern, yarn,
        needles and colours. Paste a picture or a link with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drop one here.
        Drag the board to move around; <kbd>Ctrl</kbd>+scroll zooms.
      </p>
    `;
    this.host.appendChild(this.root);
    this.world = this.root.querySelector(".board-world")!;
    this.bind();

    [this.items, this.patterns, this.yarns, this.tools] = await Promise.all([
      api.listBoardItems(this.projectId),
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listYarns({}).catch(() => [] as Yarn[]),
      api.listTools().catch(() => [] as Tool[]),
    ]);
    this.view = this.savedView() ?? fitView(this.items, this.root.clientWidth || 900, this.root.clientHeight || 600);
    this.applyView();
    this.render();
  }

  destroy(): void {
    for (const undo of this.teardown) undo();
    this.teardown = [];
    this.root?.remove();
  }

  /** Re-reads what the cards show: a pattern renamed, a yarn's photo changed. */
  async refreshLinked(): Promise<void> {
    [this.patterns, this.yarns, this.tools] = await Promise.all([
      api.listPatterns({}).catch(() => this.patterns),
      api.listYarns({}).catch(() => this.yarns),
      api.listTools().catch(() => this.tools),
    ]);
    this.render();
  }

  // ---------- the view ----------

  private viewKey(): string {
    return `board-view:${this.projectId}`;
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
    this.listen(document, "paste", (e) => void this.onPaste(e));
  }

  private itemEl(target: EventTarget | null): HTMLElement | null {
    return (target as HTMLElement | null)?.closest?.<HTMLElement>(".board-item") ?? null;
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest(".board-tools, .board-zoom, button, input, select, a")) return;
    const el = this.itemEl(target);
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
      item.h = item.kind === "image" && !e.shiftKey ? Math.max(40, Math.round((item.w * d.h) / d.w)) : Math.max(40, Math.round(d.h + by));
      el.style.width = `${item.w}px`;
      el.style.height = `${item.h}px`;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    this.drag = null;
    this.root.classList.remove("panning");
    if (d.mode === "pan") {
      this.saveView();
      return;
    }
    if (!d.moved) return;
    const item = this.items.find((i) => i.id === d.id);
    if (!item) return;
    void this.save(item.id, d.mode === "move" ? { x: item.x, y: item.y } : { w: item.w, h: item.h });
  }

  private onWheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest("textarea") && !e.ctrlKey) return;
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
    if (act === "zoom-in") this.setView(zoomAt(this.view, 1.25, box.width / 2, box.height / 2));
    if (act === "zoom-out") this.setView(zoomAt(this.view, 1 / 1.25, box.width / 2, box.height / 2));
    if (act === "fit") this.setView(fitView(this.items, box.width, box.height));
    if (!id) return;
    if (act === "remove") await this.remove(id);
    if (act === "open") this.open(id);
    if (act === "edit-link") await this.editLink(id);
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
    else if (item.kind === "swatch") el.querySelector<HTMLInputElement>('input[type="color"]')?.click();
    else this.open(item.id);
  }

  private async onKey(e: KeyboardEvent): Promise<void> {
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
    if (target.closest?.("input, textarea, select, [data-cover]") || focused?.closest?.("input, textarea, select, [data-cover]")) return;
    if (!this.root.isConnected) return;
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
      const own = this.hooks.project().patternId;
      const choices: Choice[] = this.patterns
        .map((p) => ({ value: p.id, label: p.designer ? `${p.title} — ${p.designer}` : p.title, group: p.id === own ? "This project's pattern" : "Library" }))
        .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Library" ? 1 : -1));
      if (!choices.length) return void (await say("There are no patterns in the library yet.", "Add a pattern"));
      const id = await askChoice("Which pattern?", choices, { title: "Add a pattern" });
      if (id) await this.add("pattern", at, { patternId: id });
    } else if (kind === "yarn") {
      const own = new Set(this.hooks.project().yarns.map((y) => y.yarnId));
      const choices: Choice[] = this.yarns
        .map((y) => ({ value: y.id, label: [y.name, y.colourway, y.brand].filter(Boolean).join(" · "), group: own.has(y.id) ? "On this project" : "Stash" }))
        .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Stash" ? 1 : -1));
      if (!choices.length) return void (await say("There is no yarn in the stash yet.", "Add a yarn"));
      const id = await askChoice("Which yarn?", choices, { title: "Add a yarn" });
      if (id) await this.add("yarn", at, { yarnId: id });
    } else if (kind === "tool") {
      const own = new Set(this.hooks.project().toolIds);
      const group = (t: Tool) => (own.has(t.id) ? "On this project" : t.projectId ? "On another project" : "Free");
      const order = ["On this project", "Free", "On another project"];
      const choices: Choice[] = this.tools
        .map((t) => ({ value: t.id, label: describe(t), group: group(t) }))
        .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
      if (!choices.length) return void (await say("There are no needles or hooks yet.", "Add a needle"));
      const id = await askChoice("Which needle, hook or cable?", choices, { title: "Add a needle" });
      if (id) await this.add("tool", at, { toolId: id });
    } else if (kind === "swatch") {
      const colour = SWATCHES[this.items.filter((i) => i.kind === "swatch").length % SWATCHES.length];
      const item = await this.add("swatch", at, { colour, label: "" });
      if (item) this.world.querySelector<HTMLInputElement>(`.board-item[data-id="${item.id}"] input[data-f="label"]`)?.focus();
    }
  }

  private async add(kind: BoardKind, at: { x: number; y: number }, data: Record<string, unknown>, size = SIZES[kind]): Promise<BoardItem | null> {
    try {
      const item = await api.addBoardItem(this.projectId, { kind, x: at.x, y: at.y, w: size[0], h: size[1], data });
      this.items.push(item);
      this.render();
      this.select(item.id);
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

  private open(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.kind === "pattern" && typeof item.data.patternId === "string") this.hooks.openPattern(item.data.patternId);
    if (item.kind === "link" && typeof item.data.url === "string") {
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
  }

  private itemHtml(item: BoardItem): string {
    const d = item.data;
    const style = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;z-index:${item.z}`;
    const cls = `board-item kind-${item.kind}${item.id === this.selected ? " selected" : ""}`;
    const remove = `<button class="board-x" data-act="remove" title="Remove from the board">✕</button>`;
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
      ...[...this.world.querySelectorAll<HTMLElement>("[data-yarn-of]")]
        .filter((el) => this.yarns.find((y) => y.id === el.dataset.yarnOf)?.photoPath)
        .map((el) => paint(el, yarnPhotoUrl(el.dataset.yarnOf!))),
    ]);
  }
}

const KIND_NAMES: Record<BoardKind, string> = {
  note: "note",
  text: "text",
  link: "link",
  image: "picture",
  pattern: "pattern",
  yarn: "yarn",
  tool: "needle",
  swatch: "colour",
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
