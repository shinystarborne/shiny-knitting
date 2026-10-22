/**
 * A picture opened big, over everything: as big as the window allows, zoomed
 * in and out (the wheel, + and −, a double-click), dragged about when it is
 * bigger than the window, the one before and the next by the arrows when
 * there are several, Copy, and Esc or a click beside it to close.
 *
 * One for every picture of a project: its cover, the board's pictures, the
 * log's photos, the gallery's.
 */
import { copyPicture } from "./copy-picture";

/** One picture to show: found when shown, as covers are. */
export interface LightboxPicture {
  url: () => Promise<string | null>;
  caption?: string;
}

/** The furthest in, as a multiple of the picture's own size. */
const MOST = 8;

/** The lightbox open now, closed by the next one opened. */
let open: Lightbox | null = null;

/** Opens the pictures, at the one given; `what` names them in Copy's notice. */
export function openLightbox(pictures: LightboxPicture[], start = 0, what = "The picture"): void {
  if (!pictures.length) return;
  open?.close();
  open = new Lightbox(pictures, Math.min(Math.max(start, 0), pictures.length - 1), what);
}

/** Whether a lightbox is up: keys meant for it go nowhere else. */
export function lightboxOpen(): boolean {
  return !!open;
}

class Lightbox {
  private root: HTMLElement;
  private stage: HTMLElement;
  private img: HTMLImageElement;
  private at: number;
  private url: string | null = null;
  /** The picture's own size, and how it is shown: its scale, and how far from the middle. */
  private natural = { w: 0, h: 0 };
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private fitted = true;
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean; id: number } | null = null;
  private returnTo: HTMLElement | null;
  /** Which picture is being found, so a slow one does not replace the next. */
  private shown = 0;

  constructor(
    private pictures: LightboxPicture[],
    start: number,
    private what: string,
  ) {
    this.at = start;
    this.returnTo = document.activeElement as HTMLElement | null;
    const several = pictures.length > 1;
    this.root = document.createElement("div");
    this.root.className = "lightbox";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Enlarged picture");
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="lightbox-stage" data-el="stage"><img data-el="img" alt="" draggable="false" /><p class="lightbox-note" data-el="note" hidden></p></div>
      ${several ? `<button type="button" class="lightbox-nav prev" data-act="prev" title="Previous (←)" aria-label="Previous">‹</button><button type="button" class="lightbox-nav next" data-act="next" title="Next (→)" aria-label="Next">›</button>` : ""}
      <div class="lightbox-bar">
        ${several ? `<span class="lightbox-count" data-el="count"></span>` : ""}
        <span class="lightbox-caption" data-el="caption"></span>
        <span class="lightbox-tools">
          <button type="button" data-act="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
          <button type="button" class="lightbox-zoom" data-act="fit" data-el="zoom" title="Fit to window (0)">Fit</button>
          <button type="button" data-act="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button type="button" data-act="copy" title="Copy (Ctrl+C)">Copy</button>
          <button type="button" data-act="close" title="Close (Esc)" aria-label="Close">✕</button>
        </span>
      </div>`;
    document.body.append(this.root);
    this.stage = this.root.querySelector('[data-el="stage"]')!;
    this.img = this.root.querySelector('[data-el="img"]')!;
    this.root.addEventListener("click", this.onClick);
    this.stage.addEventListener("wheel", this.onWheel, { passive: false });
    this.stage.addEventListener("pointerdown", this.onDown);
    this.stage.addEventListener("pointermove", this.onMove);
    this.stage.addEventListener("pointerup", this.onUp);
    this.stage.addEventListener("pointercancel", this.onUp);
    this.stage.addEventListener("dblclick", this.onDouble);
    // Before anything else hears them: Esc here closes this, not what is under it.
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.root.focus();
    void this.show();
  }

  // ---------- which picture ----------

  private async show(): Promise<void> {
    const which = ++this.shown;
    const picture = this.pictures[this.at];
    const count = this.root.querySelector('[data-el="count"]');
    if (count) count.textContent = `${this.at + 1} / ${this.pictures.length}`;
    this.root.querySelector('[data-el="caption"]')!.textContent = picture.caption ?? "";
    this.note("");
    this.img.hidden = true;
    const url = await picture.url().catch(() => null);
    if (which !== this.shown) return;
    this.url = url;
    if (!url) return this.note("This picture no longer exists.");
    this.img.src = url;
    try {
      await this.img.decode();
    } catch {
      if (which === this.shown) this.note("This picture could not be shown.");
      return;
    }
    if (which !== this.shown) return;
    this.natural = { w: this.img.naturalWidth, h: this.img.naturalHeight };
    this.img.hidden = false;
    this.fit();
  }

  private step(by: number): void {
    if (this.pictures.length < 2) return;
    this.at = (this.at + by + this.pictures.length) % this.pictures.length;
    void this.show();
  }

  private note(text: string): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="note"]')!;
    el.textContent = text;
    el.hidden = !text;
  }

  // ---------- zoom and pan ----------

  /** The scale that shows all of it, as big as the stage allows. */
  private fitScale(): number {
    const { width, height } = this.stage.getBoundingClientRect();
    if (!this.natural.w || !this.natural.h) return 1;
    return Math.min(width / this.natural.w, height / this.natural.h);
  }

  private fit(): void {
    this.scale = this.fitScale();
    this.tx = 0;
    this.ty = 0;
    this.fitted = true;
    this.paint();
  }

  /** Zooms by a factor, keeping the point under (x, y) -- from the stage's middle -- where it is. */
  private zoomBy(factor: number, x = 0, y = 0): void {
    if (!this.natural.w) return;
    const fit = this.fitScale();
    const next = Math.min(Math.max(this.scale * factor, Math.min(fit, 1) / 2), Math.max(fit, 1) * MOST);
    const k = next / this.scale;
    this.tx = x - (x - this.tx) * k;
    this.ty = y - (y - this.ty) * k;
    this.scale = next;
    this.fitted = Math.abs(next - fit) < 1e-3;
    this.paint();
  }

  /** Keeps it in view: a side bigger than the stage cannot leave a gap, a smaller one sits in the middle. */
  private clamp(): void {
    const { width, height } = this.stage.getBoundingClientRect();
    const w = this.natural.w * this.scale;
    const h = this.natural.h * this.scale;
    const room = (size: number, space: number) => Math.max(0, (size - space) / 2);
    this.tx = Math.min(Math.max(this.tx, -room(w, width)), room(w, width));
    this.ty = Math.min(Math.max(this.ty, -room(h, height)), room(h, height));
  }

  private paint(): void {
    this.clamp();
    const { width, height } = this.stage.getBoundingClientRect();
    const w = this.natural.w * this.scale;
    const h = this.natural.h * this.scale;
    this.img.style.width = `${w}px`;
    this.img.style.height = `${h}px`;
    this.img.style.transform = `translate(${(width - w) / 2 + this.tx}px, ${(height - h) / 2 + this.ty}px)`;
    this.stage.classList.toggle("can-drag", w > width + 1 || h > height + 1);
    const zoom = this.root.querySelector<HTMLElement>('[data-el="zoom"]')!;
    zoom.textContent = this.fitted ? "Fit" : `${Math.round(this.scale * 100)}%`;
  }

  /** A point on the screen, from the stage's middle. */
  private fromMiddle(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }

  // ---------- input ----------

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x, y } = this.fromMiddle(e.clientX, e.clientY);
    this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
  };

  private onDouble = (e: MouseEvent): void => {
    if (e.target !== this.img) return;
    if (!this.fitted) return this.fit();
    const { x, y } = this.fromMiddle(e.clientX, e.clientY);
    // In to its own size, or twice the fit when that is already bigger.
    this.zoomBy(Math.max(1, this.scale * 2) / this.scale, x, y);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false, id: e.pointerId };
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      try {
        this.stage.setPointerCapture(e.pointerId);
      } catch {
        // A pointer already gone: the drag still follows it while it moves.
      }
    }
    this.tx = d.tx + dx;
    this.ty = d.ty + dy;
    this.fitted = false;
    this.paint();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== e.pointerId) return;
    // A click beside the picture, not the end of a drag, closes it.
    if (!d.moved && e.target === this.stage) this.close();
  };

  private onClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") this.close();
    if (act === "prev") this.step(-1);
    if (act === "next") this.step(1);
    if (act === "in") this.zoomBy(1.25);
    if (act === "out") this.zoomBy(1 / 1.25);
    if (act === "fit") this.fit();
    if (act === "copy") void this.copy();
  };

  private onKey = (e: KeyboardEvent): void => {
    // A dialog over it (Copy's message) has its own keys.
    if ((e.target as HTMLElement | null)?.closest?.(".dialog-backdrop")) return;
    e.stopPropagation();
    const k = e.key;
    if (k === "Escape") this.close();
    else if (k === "ArrowLeft") this.step(-1);
    else if (k === "ArrowRight") this.step(1);
    else if (k === "+" || k === "=") this.zoomBy(1.25);
    else if (k === "-" || k === "_") this.zoomBy(1 / 1.25);
    else if (k === "0") this.fit();
    else if ((k === "c" || k === "C") && (e.ctrlKey || e.metaKey)) void this.copy();
    else if (k === "Tab") return;
    else return;
    e.preventDefault();
  };

  private onResize = (): void => {
    if (this.fitted) this.fit();
    else this.paint();
  };

  private async copy(): Promise<void> {
    if (this.url) await copyPicture(this.url, this.what);
  }

  close(): void {
    if (open === this) open = null;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
    this.returnTo?.focus?.();
  }
}
