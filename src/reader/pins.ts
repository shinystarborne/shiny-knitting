/**
 * Pins: a region of a page kept floating over the pattern.
 *
 * The point of a pin is to hold a chart or a run of instructions somewhere you
 * can see them while you work, rather than where the pattern happens to print
 * them. Modelled on Shelfmind's: a numbered chip per pin in the reader bar
 * shows or hides it, and a shown pin is a panel you can drag by its header,
 * zoom with − and +, and resize from its corner.
 *
 * The panel is painted live from the PDF, not from a stored picture, so it is
 * as sharp as the page at any size. A JPEG of the crop is still taken when a
 * pin is made, because the backend keeps one per pin; it is simply not what
 * is shown. (Showing it was also how a new pin used to appear as a broken
 * image: the card was drawn before its picture had been loaded.)
 *
 * Only PDFs. An EPUB chapter is text in an iframe with no fixed region to
 * crop, so the tool is refused there rather than producing something that is
 * subtly not what was pinned.
 */
import { api, MAX_PINS, type Pin } from "../api";
import { textInRect, type Rect } from "../annotations";
import { say } from "../dialogs";
import type { RegionRect } from "./pdf";
import { boxFromView, type Rotation } from "./rotation";

/** The part of a rendered document a pin needs. */
export interface PinTarget {
  /** The element a page is painted into. */
  pageElement(page: number): HTMLElement | null;
  /**
   * The element holding a page's real text, for naming a crop. Null for an
   * image-only scan: the crop still works, it just cannot be named.
   */
  textLayerFor(page: number): HTMLElement | null;
  /** "pdf" or "epub". */
  format: string;
  /** Paints a region of a page into a canvas; PDF only. */
  renderRegion?(page: number, rect: RegionRect, cssWidth: number, canvas: HTMLCanvasElement): Promise<void>;
  /**
   * How far the reader has turned a page. A crop is stored upright, as marks
   * are, and renderRegion paints it the way the page is shown.
   */
  rotationOf?(page: number): Rotation;
}

/** How small a crop may be, in pixels on screen, before it counts as a slip. */
const MIN_CROP_PX = 12;

/** How wide a new panel starts, as Shelfmind's do. */
const NEW_PANEL_PX = 280;

/** Where new panels start, and how far each next one steps down and right. */
const CASCADE_START_PX = 24;
const CASCADE_STEP_PX = 28;

/** The panel width limits, as fractions of the pane. The backend clamps to these too. */
const MIN_WIDTH = 0.1;
const MAX_WIDTH = 0.9;

/** How much one press of − or + changes a panel's size. */
const ZOOM_STEP = 1.2;

/** A page's pixels as they were when a drag started, and the size they showed at. */
interface Shot {
  canvas: HTMLCanvasElement;
  shownWidth: number;
  shownHeight: number;
}

/** The longest a pin's name is before it is trimmed. */
const TITLE_LIMIT = 60;

export class PinLayer {
  private pane: HTMLElement;
  private scroller: HTMLElement;
  private patternId: string;
  private doc: PinTarget;

  /** The floating panels, over the pane rather than in the scrolling document. */
  private host: HTMLElement;
  /** Where the numbered chips go, in the reader bar. */
  private tray: HTMLElement | null = null;
  /** The rubber-band rectangle, while a crop is being dragged out. */
  private band: HTMLElement | null = null;

  /** In the order they were made, which is the order they are numbered in. */
  private pins: Pin[] = [];
  /** Set while a panel is being dragged or resized, so it saves once at the end. */
  private moving: {
    pin: Pin;
    pointer: number;
    mode: "move" | "size";
    start: { x: number; y: number };
    origin: { offsetX: number; offsetY: number; width: number };
  } | null = null;
  private busy = false;

  /** Called when the set of pins changes, so the Pin button can grey out at the limit. */
  onChange: (() => void) | null = null;
  /**
   * Called when a crop drag ends, made or not. Pin mode is one crop at a time,
   * as in Shelfmind, so the reader goes back to Select.
   */
  onCropEnd: (() => void) | null = null;

  constructor(scroller: HTMLElement, patternId: string, doc: PinTarget) {
    this.scroller = scroller;
    this.patternId = patternId;
    this.doc = doc;

    // The panels belong to the pane, not the document: a pin that scrolled
    // away with the text would be no use for the thing it is there to help with.
    this.pane = scroller.parentElement ?? scroller;
    this.host = document.createElement("div");
    this.host.className = "pin-layer";
    this.pane.appendChild(this.host);
  }

  /** Where to draw the numbered chips. */
  setTray(tray: HTMLElement | null): void {
    this.tray = tray;
    this.renderTray();
  }

  /** Whether pinning is possible for this document, and why not if it is not. */
  availability(): { ok: boolean; reason: string } {
    if (this.doc.format === "epub" || !this.doc.renderRegion) {
      return {
        ok: false,
        reason:
          "Pinning needs a PDF. An EPUB's text can be reflowed and rewrapped, so there is no fixed region of the page to crop.",
      };
    }
    if (this.pins.length >= MAX_PINS) {
      return { ok: false, reason: `This pattern already has ${MAX_PINS} pins. Remove one from its numbered chip first.` };
    }
    return { ok: true, reason: "" };
  }

  async load(): Promise<void> {
    try {
      this.pins = (await api.listPins(this.patternId)).sort((a, b) => a.createdAt - b.createdAt);
    } catch (e) {
      this.pins = [];
      this.report(e);
      return;
    }
    this.render();
  }

  // ---------- making a pin ----------

  /**
   * Starts a crop, called by the mark layer when the Pin tool is active.
   *
   * `startPage` is the page under the press, not the page at the top of the
   * pane, which is a different page whenever two are on screen.
   */
  beginSelection(e: PointerEvent, page: HTMLElement, startPage: number): void {
    // One crop at a time. A second press while a band is out would otherwise
    // leave the first band's listeners attached to the scroller for good.
    if (this.band) return;
    const start = this.normalised(e.clientX, e.clientY, page);
    if (!start) return;
    const shot = this.snapshot(page);

    const band = document.createElement("div");
    band.className = "pin-band";
    page.appendChild(band);
    this.band = band;

    let latest = start;

    const move = (ev: PointerEvent) => {
      const here = this.normalised(ev.clientX, ev.clientY, page);
      if (!here) return;
      latest = here;
      const rect = span(start, here);
      Object.assign(band.style, {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      });
    };

    const stop = () => {
      this.scroller.removeEventListener("pointermove", move);
      this.scroller.removeEventListener("pointerup", finish);
      this.scroller.removeEventListener("pointercancel", cancel);
      band.remove();
      this.band = null;
      this.onCropEnd?.();
    };

    const finish = async () => {
      stop();
      const rect = span(start, latest);
      const box = page.getBoundingClientRect();
      // A click, or a slip of the hand, is not a crop.
      if (rect.w * box.width < MIN_CROP_PX || rect.h * box.height < MIN_CROP_PX) return;
      await this.save(page, rect, shot, startPage);
    };

    const cancel = () => stop();

    try {
      this.scroller.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the drag stops at the edge of the page, which is
      // survivable; losing the whole crop over a thrown capture is not.
    }
    this.scroller.addEventListener("pointermove", move);
    this.scroller.addEventListener("pointerup", finish);
    this.scroller.addEventListener("pointercancel", cancel);
  }

  /**
   * Copies the page's pixels at the moment the drag starts, for the backend's
   * stored crop. Taken now because the page can be repainted mid-drag, which
   * clears its canvas.
   */
  private snapshot(page: HTMLElement): Shot | null {
    const src = page.querySelector<HTMLCanvasElement>("canvas");
    if (!src || src.width <= 0 || src.height <= 0) return null;
    const shown = src.getBoundingClientRect();
    if (shown.width <= 0 || shown.height <= 0) return null;
    const copy = document.createElement("canvas");
    copy.width = src.width;
    copy.height = src.height;
    const ctx = copy.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    return { canvas: copy, shownWidth: shown.width, shownHeight: shown.height };
  }

  private async save(page: HTMLElement, rect: Rect, shot: Shot | null, startPage: number): Promise<void> {
    if (this.busy) return;
    const room = this.availability();
    if (!room.ok) {
      this.report(new Error(room.reason));
      return;
    }
    if (!shot) {
      this.report(new Error("That page has not finished drawing, so there is nothing to crop yet."));
      return;
    }

    this.busy = true;
    try {
      const blob = await cropToJpeg(shot.canvas, shot.shownWidth, shot.shownHeight, rect);
      if (!blob) throw new Error("That part of the page could not be cropped.");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // Named after the words under it; shown as the panel's tooltip.
      const text = this.doc.textLayerFor(startPage);
      const quote = text ? textInRect(text, page, rect) : "";

      const pin = await api.addPin(this.patternId, {
        page: startPage,
        geometry: JSON.stringify([round4(boxFromView(rect, this.doc.rotationOf?.(startPage) ?? 0))]),
        quote: quote.slice(0, 400),
        title: titleFor(quote, this.pins.length + 1),
        imageBytes: Array.from(bytes),
        imageMime: "image/jpeg",
      });
      // Cascaded from the top left, as Shelfmind does, so each new panel is
      // visible and none lands exactly on another.
      const paneBox = this.pane.getBoundingClientRect();
      const step = CASCADE_START_PX + this.pins.length * CASCADE_STEP_PX;
      pin.offsetX = step / (paneBox.width || 1);
      pin.offsetY = step / (paneBox.height || 1);
      pin.width = clamp(NEW_PANEL_PX / (paneBox.width || 1), MIN_WIDTH, MAX_WIDTH);
      pin.hidden = false;
      this.pins.push(pin);
      this.render();
      this.onChange?.();
      await this.savePlacement(pin);
    } catch (e) {
      this.report(e);
    } finally {
      this.busy = false;
    }
  }

  // ---------- drawing ----------

  /** Paints every panel again: after a page is turned, so its pins turn with it. */
  redraw(): void {
    this.render();
  }

  private render(): void {
    this.host.textContent = "";
    this.pins.forEach((pin, index) => {
      if (!pin.hidden) this.host.appendChild(this.panel(pin, index));
    });
    this.renderTray();
  }

  /** The numbered chips: click to show or hide, ✕ to remove. */
  private renderTray(): void {
    if (!this.tray) return;
    this.tray.textContent = "";
    this.pins.forEach((pin, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = pin.hidden ? "pin-chip" : "pin-chip on";
      chip.textContent = String(index + 1);
      chip.title = `Pin ${index + 1} · p.${pin.page} — click to show or hide${pin.title ? `\n${pin.title}` : ""}`;
      chip.addEventListener("click", () => void this.setHidden(pin, !pin.hidden));

      const remove = document.createElement("span");
      remove.className = "pin-chip-delete";
      remove.textContent = "✕";
      remove.title = "Remove this pin";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.remove(pin);
      });
      chip.appendChild(remove);
      this.tray?.appendChild(chip);
    });
  }

  private panel(pin: Pin, index: number): HTMLElement {
    const card = document.createElement("div");
    card.className = "pin-card";
    card.dataset.id = pin.id;
    this.placeCard(card, pin);
    card.style.zIndex = String(10 + pin.z);

    const bar = document.createElement("div");
    bar.className = "pin-bar";
    const label = document.createElement("span");
    label.className = "pin-name";
    label.textContent = `📌 ${index + 1} · p.${pin.page}`;
    if (pin.title) label.title = pin.title;
    bar.append(
      label,
      barButton("−", "Zoom out", () => void this.zoomPin(pin, card, 1 / ZOOM_STEP)),
      barButton("+", "Zoom in", () => void this.zoomPin(pin, card, ZOOM_STEP)),
      barButton("✕", "Hide", () => void this.setHidden(pin, true)),
    );

    const wrap = document.createElement("div");
    wrap.className = "pin-canvas-wrap";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    const grip = document.createElement("div");
    grip.className = "pin-grip";
    grip.title = "Drag to resize";

    card.append(bar, wrap, grip);

    // Header buttons must stay plain clicks, so a press on one does not also
    // start dragging the panel.
    bar.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("button")) return;
      this.grab(e, pin, card, canvas, "move");
    });
    grip.addEventListener("pointerdown", (e) => this.grab(e, pin, card, canvas, "size"));

    this.paint(pin, canvas);
    return card;
  }

  private placeCard(card: HTMLElement, pin: Pin): void {
    card.style.left = `${pin.offsetX * 100}%`;
    card.style.top = `${pin.offsetY * 100}%`;
    card.style.width = `${pin.width * 100}%`;
  }

  /** Paints the pin's region into its canvas at the panel's current width. */
  private paint(pin: Pin, canvas: HTMLCanvasElement): void {
    const rect = regionOf(pin);
    if (!rect || !this.doc.renderRegion) return;
    const width = pin.width * this.pane.getBoundingClientRect().width;
    // Not awaited: pdf.js paints across animation frames, which do not run in
    // a hidden window, and nothing else waits on a pin being painted.
    void this.doc.renderRegion(pin.page, rect, Math.max(40, width), canvas);
  }

  // ---------- panel actions ----------

  private async zoomPin(pin: Pin, card: HTMLElement, factor: number): Promise<void> {
    pin.width = clamp(pin.width * factor, MIN_WIDTH, MAX_WIDTH);
    this.placeCard(card, pin);
    const canvas = card.querySelector("canvas");
    if (canvas) this.paint(pin, canvas);
    await this.savePlacement(pin);
  }

  private async setHidden(pin: Pin, hidden: boolean): Promise<void> {
    pin.hidden = hidden;
    this.render();
    await this.savePlacement(pin);
  }

  /** Removes a pin straight away, as Shelfmind's chip ✕ does. */
  private async remove(pin: Pin): Promise<void> {
    try {
      await api.deletePin(pin.id);
    } catch (e) {
      this.report(e);
      return;
    }
    this.pins = this.pins.filter((p) => p.id !== pin.id);
    this.render();
    this.onChange?.();
  }

  /**
   * Starts a panel drag or resize.
   *
   * Capture is taken on the element that received the press -- the header or
   * the resize corner -- which is in the event's own path, so the rest of the
   * drag comes to it wherever the pointer goes.
   */
  private grab(e: PointerEvent, pin: Pin, card: HTMLElement, canvas: HTMLCanvasElement, mode: "move" | "size"): void {
    if (e.button !== 0 || this.moving) return;
    const start = this.normalisedInPane(e.clientX, e.clientY);
    if (!start) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as Element;
    this.moving = {
      pin,
      pointer: e.pointerId,
      mode,
      start,
      origin: { offsetX: pin.offsetX, offsetY: pin.offsetY, width: pin.width },
    };
    card.classList.add(mode === "size" ? "resizing" : "moving");

    const move = (ev: PointerEvent) => {
      const live = this.moving;
      if (!live) return;
      const here = this.normalisedInPane(ev.clientX, ev.clientY);
      if (!here) return;
      const dx = here.x - live.start.x;
      const dy = here.y - live.start.y;
      if (live.mode === "move") {
        // Clamped to the same range the backend uses, so the panel stops where
        // it will be stored rather than springing back on save.
        pin.offsetX = clamp(live.origin.offsetX + dx, 0, 0.98);
        pin.offsetY = clamp(live.origin.offsetY + dy, 0, 0.98);
      } else {
        pin.width = clamp(live.origin.width + dx, MIN_WIDTH, MAX_WIDTH);
      }
      this.placeCard(card, pin);
    };

    const finish = async () => {
      handle.removeEventListener("pointermove", move as EventListener);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      card.classList.remove("moving", "resizing");
      const live = this.moving;
      this.moving = null;
      if (!live) return;
      // The bitmap was only stretched while resizing; paint it sharp again.
      if (live.mode === "size") this.paint(pin, canvas);
      await this.savePlacement(pin);
    };

    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // The drag just stops at the edge of the pane.
    }
    handle.addEventListener("pointermove", move as EventListener);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  private async savePlacement(pin: Pin): Promise<void> {
    try {
      const stored = await api.updatePin(pin.id, {
        offsetX: pin.offsetX,
        offsetY: pin.offsetY,
        width: pin.width,
        hidden: pin.hidden,
      });
      // The stored values are the clamped ones, so keep those rather than what
      // was asked for, or the panel would sit somewhere the next load undoes.
      Object.assign(pin, stored);
    } catch (e) {
      this.report(e);
    }
  }

  /** The pointer's position on a page, clamped into it, as page fractions. */
  private normalised(x: number, y: number, page: HTMLElement): { x: number; y: number } | null {
    const box = page.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: clamp((x - box.left) / box.width, 0, 1), y: clamp((y - box.top) / box.height, 0, 1) };
  }

  /** The same, but across the whole pane, which is what a panel moves within. */
  private normalisedInPane(x: number, y: number): { x: number; y: number } | null {
    const box = this.pane.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
  }

  private report(e: unknown): void {
    void say(e instanceof Error ? e.message : String(e), "Pins");
  }

  detach(): void {
    this.host.remove();
    if (this.tray) this.tray.textContent = "";
  }
}

/** The stored crop region of a pin. */
function regionOf(pin: Pin): RegionRect | null {
  try {
    const parsed: unknown = JSON.parse(pin.geometry);
    const r = Array.isArray(parsed) ? (parsed[0] as RegionRect) : null;
    return r && r.w > 0 && r.h > 0 ? r : null;
  } catch {
    return null;
  }
}

function barButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pin-btn";
  el.textContent = label;
  el.title = title;
  el.addEventListener("click", onClick);
  return el;
}

/**
 * Cuts a region out of a painted page into a JPEG, for the backend's copy.
 *
 * The canvas is painted at the screen's resolution and shown at CSS size, so
 * the two are related by a ratio that is read rather than assumed.
 */
async function cropToJpeg(
  source: HTMLCanvasElement,
  shownWidth: number,
  shownHeight: number,
  rect: Rect,
): Promise<Blob | null> {
  if (shownWidth <= 0 || shownHeight <= 0 || source.width <= 0 || source.height <= 0) return null;
  const scale = source.width / shownWidth;

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.w * shownWidth));
  out.height = Math.max(1, Math.round(rect.h * shownHeight));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const target = 900;
  if (out.width > target) {
    out.height = Math.round((out.height * target) / out.width);
    out.width = target;
  }
  ctx.drawImage(
    source,
    rect.x * shownWidth * scale,
    rect.y * shownHeight * scale,
    rect.w * shownWidth * scale,
    rect.h * shownHeight * scale,
    0,
    0,
    out.width,
    out.height,
  );
  return new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.85));
}

/** The smaller box containing two points, as a normalised rectangle. */
function span(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/**
 * What to call a pin: the words under the crop, cut at a word so it does not
 * end mid-word, and a plain number when there are no words at all.
 *
 * Deliberately not split at a sentence boundary. Patterns are full of labels
 * that look like sentence ends — "Row 1:", "Size:", "Finished gauge:" — and
 * cutting at the first one names every pin after its own heading.
 */
export function titleFor(quote: string, index: number): string {
  const text = quote.replace(/\s+/g, " ").trim();
  if (!text) return `Pin ${index}`;
  if (text.length <= TITLE_LIMIT) return text;
  const cut = text.slice(0, TITLE_LIMIT - 1);
  const at = cut.lastIndexOf(" ");
  const short = `${(at > TITLE_LIMIT * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`;
  return short || `Pin ${index}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Four decimal places is well past a pixel on any page, and keeps the JSON short. */
function round4(rect: Rect): Rect {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
}
