/**
 * Pins: a cropped picture of part of a page, floating over the pattern.
 *
 * The point of a pin is to hold a chart or a run of instructions somewhere you
 * can see them while you work, rather than where the pattern happens to print
 * them. So a pin is two things that have to agree: the crop, stored as a
 * region of the page so it can be taken again, and the card, positioned as a
 * fraction of the reading pane so it stays put while the document scrolls.
 *
 * Only PDFs, for now. A PDF page is a canvas, so a crop is real pixels taken
 * from what is already on screen. An EPUB chapter is text in an iframe, and
 * there is no honest way to rasterise a region of it without re-implementing a
 * layout engine, so the tool is refused there rather than producing a card that
 * is subtly not what you pinned.
 */
import { api, MAX_PINS, type Pin, type PinPlacement } from "../api";
import { fromPageRect, textInRect, toPageRect, type Rect } from "../annotations";

/** The part of a rendered document a pin needs. */
export interface PinTarget {
  /** 1-based page currently at the top of the view. */
  currentPage(): number;
  /** The element a page is painted into. */
  pageElement(page: number): HTMLElement | null;
  /**
   * The element holding a page's real text, for labelling a crop.
   *
   * Null for a page with no text layer, which is an image-only scan: the crop
   * still works, it just cannot be named after the words under it.
   */
  textLayerFor(page: number): HTMLElement | null;
  /** "pdf" or "epub". */
  format: string;
}

/** How small a crop may be, as a fraction of the page. */
const MIN_CROP = 0.01;

/** A page's pixels as they were when a drag started, and the size they showed at. */
interface Shot {
  canvas: HTMLCanvasElement;
  shownWidth: number;
  shownHeight: number;
}

/** Where a new card starts: to the right, clear of the text. */
const NEW_CARD_X = 0.7;

/** The first of five slots down the pane, so five cards do not land on one spot. */
const NEW_CARD_TOP = 0.04;
const NEW_CARD_STEP = 0.17;

/** Which slot the nth card starts in, so a pattern at the limit still fans out. */
function newCardY(n: number): number {
  // Wrapping past the fifth keeps a sixth from walking off the bottom, and the
  // limit means there is never a sixth.
  return NEW_CARD_TOP + ((n % 5) * NEW_CARD_STEP);
}

/** The longest a card title is before it is trimmed. */
const TITLE_LIMIT = 60;

export class PinLayer {
  private pane: HTMLElement;
  private scroller: HTMLElement;
  private patternId: string;
  private doc: PinTarget;

  /** The floating cards, over the pane rather than in the scrolling document. */
  private host: HTMLElement;
  /** The rubber-band rectangle, while a crop is being dragged out. */
  private band: HTMLElement | null = null;

  private pins: Pin[] = [];
  private images = new Map<string, string>();
  /** Set while a card is being dragged or resized, so it saves once at the end. */
  private moving: {
    pin: Pin;
    pointer: number;
    mode: "move" | "size";
    start: { x: number; y: number };
    origin: PinPlacement;
  } | null = null;
  private busy = false;

  constructor(scroller: HTMLElement, patternId: string, doc: PinTarget) {
    this.scroller = scroller;
    this.patternId = patternId;
    this.doc = doc;

    // The cards belong to the pane, not the document: a card that scrolled
    // away with the text would be no use for the thing it is there to help with.
    this.pane = scroller.parentElement ?? scroller;
    this.host = document.createElement("div");
    this.host.className = "pin-layer";
    this.pane.appendChild(this.host);
  }

  /**
   * Called when the set of pins changes, so the toolbar can be brought up to
   * date. Without it the Pin button still reads as available after the fifth
   * pin, and only finds out by refusing.
   */
  onChange: (() => void) | null = null;

  /** Whether pinning is possible for this document, and why not if it is not. */
  availability(): { ok: boolean; reason: string } {
    if (this.doc.format === "epub") {
      return {
        ok: false,
        reason:
          "Pinning needs a PDF. An EPUB's text can be reflowed and rewrapped, so there is no fixed region of the page to crop.",
      };
    }
    if (this.pins.length >= MAX_PINS) {
      return { ok: false, reason: `This pattern already has ${MAX_PINS} pins.` };
    }
    return { ok: true, reason: "" };
  }

  async load(): Promise<void> {
    try {
      this.pins = await api.listPins(this.patternId);
    } catch (e) {
      this.pins = [];
      this.report(e);
      return;
    }
    for (const pin of this.pins) void this.loadImage(pin);
    this.render();
  }

  /**
   * Starts a crop, called by the mark layer when the Pin tool is active.
   *
   * The whole drag belongs here rather than to a permanent listener, so the
   * pointer is only tracked between a press and a release and there is nothing
   * to leave behind if the reader is torn down mid-drag.
   */
  beginSelection(e: PointerEvent, page: HTMLElement): void {
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

    const finish = async () => {
      this.scroller.removeEventListener("pointermove", move);
      this.scroller.removeEventListener("pointerup", finish);
      this.scroller.removeEventListener("pointercancel", cancel);
      band.remove();
      this.band = null;
      const rect = span(start, latest);
      // A click, or a slip of the hand, is not a crop. Saying so beats storing
      // a sliver of white and calling it a chart.
      if (rect.w < MIN_CROP || rect.h < MIN_CROP) return;
      await this.save(page, rect, shot);
    };

    const cancel = () => {
      this.scroller.removeEventListener("pointermove", move);
      this.scroller.removeEventListener("pointerup", finish);
      this.scroller.removeEventListener("pointercancel", cancel);
      band.remove();
      this.band = null;
    };

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
   * Crops the region and stores it.
   *
   * The check for an existing full set is here as well as in the backend. The
   * backend is what actually enforces it — this is so the sixth pin is refused
   * with a sentence rather than after a slow round trip through a crop.
   */
  /**
   * Copies the page's pixels at the moment the drag starts.
   *
   * The crop is taken when the drag ends, and in between the page can be
   * repainted — which clears the canvas, because setting its size does. The pin
   * would then be a clean rectangle of white, and it would be saved that way,
   * because a blank crop is indistinguishable from a blank part of the page.
   * Copying now means the pin is always of what was under the drag when the
   * drag began, which is what the reader saw and pointed at.
   */
  private snapshot(page: HTMLElement): Shot | null {
    const src = page.querySelector<HTMLCanvasElement>("canvas");
    if (!src || src.width <= 0 || src.height <= 0) return null;
    // Measured now, while the canvas is still in the document. A detached
    // canvas has no box at all, and the copy is never in one.
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

  private async save(page: HTMLElement, rect: Rect, shot: Shot | null): Promise<void> {
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

      // Named after the words under it, which is the only thing that can say
      // what the picture is. A chart has none, and gets a plain name.
      const text = this.doc.textLayerFor(this.doc.currentPage());
      const quote = text ? textInRect(text, page, rect) : "";
      const title = titleFor(quote, this.pins.length + 1);

      const pin = await api.addPin(this.patternId, {
        page: this.doc.currentPage(),
        geometry: JSON.stringify([round4(rect)]),
        quote: quote.slice(0, 400),
        title,
        imageBytes: Array.from(bytes),
        imageMime: "image/jpeg",
      });
      this.pins.push(pin);
      // The backend stores one fixed placement, so two pins saved in a row land
      // exactly on top of each other and the second is simply not there. Fan
      // them out from where the last one went, so each new card is visible and
      // can be dragged where it belongs.
      pin.offsetX = NEW_CARD_X;
      pin.offsetY = newCardY(this.pins.length - 1);
      this.render();
      this.onChange?.();
      await this.savePlacement(pin);
    } catch (e) {
      this.report(e);
    } finally {
      this.busy = false;
    }
  }

  private async loadImage(pin: Pin): Promise<void> {
    if (this.images.has(pin.id)) return;
    try {
      const raw = await api.getPinImage(pin.id);
      const url = URL.createObjectURL(new Blob([raw as BlobPart], { type: "image/jpeg" }));
      this.images.set(pin.id, url);
      this.render();
    } catch {
      // A pin whose image has gone is still a pin; the card says so.
    }
  }

  private render(): void {
    // Images are looked up, not rebuilt: the object URLs are created once when
    // a crop is loaded and are only released when the pin goes or the reader
    // closes, so re-rendering a card does not throw its own picture away.
    this.host.textContent = "";
    for (const pin of this.pins) this.host.appendChild(this.card(pin));
  }

  private card(pin: Pin): HTMLElement {
    const card = document.createElement("div");
    card.className = "pin-card";
    card.dataset.id = pin.id;
    card.style.left = `${pin.offsetX * 100}%`;
    card.style.top = `${pin.offsetY * 100}%`;
    card.style.width = `${pin.width * 100}%`;
    card.style.zIndex = String(10 + pin.z);
    if (pin.hidden) card.classList.add("hidden");

    const bar = document.createElement("div");
    bar.className = "pin-bar";

    const name = document.createElement("button");
    name.className = "pin-name";
    name.type = "button";
    name.textContent = pin.title || "Pin";
    name.title = `${pin.title || "Pin"}\nClick to rename.`;
    name.addEventListener("click", () => void this.rename(pin));
    bar.appendChild(name);

    const hide = document.createElement("button");
    hide.className = "pin-btn";
    hide.type = "button";
    hide.textContent = pin.hidden ? "Show" : "Hide";
    hide.title = pin.hidden ? "Bring this pin back" : "Hide this pin without deleting it";
    hide.addEventListener("click", () => void this.setHidden(pin, !pin.hidden));

    const remove = document.createElement("button");
    remove.className = "pin-btn danger";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove this pin";
    remove.addEventListener("click", () => void this.remove(pin));

    bar.append(hide, remove);
    card.appendChild(bar);

    const picture = document.createElement("img");
    picture.className = "pin-image";
    picture.alt = pin.title || "Pinned part of the page";
    const url = this.images.get(pin.id);
    if (url) picture.src = url;
    else picture.replaceWith(Object.assign(document.createElement("div"), {
      className: "pin-missing",
      textContent: "This pin's picture is missing.",
    }));
    card.appendChild(picture);

    if (!pin.hidden) {
      const grip = document.createElement("div");
      grip.className = "pin-grip";
      grip.title = "Drag to make this pin bigger or smaller";
      card.appendChild(grip);
    }

    // The whole card moves by its title bar, so the picture is never in the
    // way of a click that means something else.
    bar.addEventListener("pointerdown", (e) => this.grab(e as PointerEvent, pin, card, "move"));
    card
      .querySelector(".pin-grip")
      ?.addEventListener("pointerdown", (e) => this.grab(e as PointerEvent, pin, card, "size"));
    return card;
  }

  private grab(e: PointerEvent, pin: Pin, card: HTMLElement, mode: "move" | "size"): void {
    if (e.button !== 0 || this.moving) return;
    const start = this.normalisedInPane(e.clientX, e.clientY);
    if (!start) return;
    e.preventDefault();
    e.stopPropagation();
    this.moving = {
      pin,
      pointer: e.pointerId,
      mode,
      start,
      origin: { offsetX: pin.offsetX, offsetY: pin.offsetY, width: pin.width, hidden: pin.hidden },
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
        // Clamped to the same range the backend uses, so the card stops where
        // it will be stored rather than springing back on save.
        pin.offsetX = clamp(live.origin.offsetX + dx, 0, 0.98);
        pin.offsetY = clamp(live.origin.offsetY + dy, 0, 0.98);
      } else {
        pin.width = clamp(live.origin.width + dx, 0.1, 0.9);
      }
      card.style.left = `${pin.offsetX * 100}%`;
      card.style.top = `${pin.offsetY * 100}%`;
      card.style.width = `${pin.width * 100}%`;
    };

    const finish = async () => {
      this.scroller.removeEventListener("pointermove", move);
      this.scroller.removeEventListener("pointerup", finish);
      this.scroller.removeEventListener("pointercancel", finish);
      card.classList.remove("moving", "resizing");
      const live = this.moving;
      this.moving = null;
      if (!live) return;
      await this.savePlacement(pin);
    };

    try {
      this.scroller.setPointerCapture(e.pointerId);
    } catch {
      // As with cropping: the drag just stops at the edge of the pane.
    }
    this.scroller.addEventListener("pointermove", move);
    this.scroller.addEventListener("pointerup", finish);
    this.scroller.addEventListener("pointercancel", finish);
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
      // was asked for, or the card would sit somewhere the next load undoes.
      Object.assign(pin, stored);
    } catch (e) {
      this.report(e);
    }
  }

  private async setHidden(pin: Pin, hidden: boolean): Promise<void> {
    pin.hidden = hidden;
    this.render();
    await this.savePlacement(pin);
  }

  private async rename(pin: Pin): Promise<void> {
    const next = window.prompt("Name this pin:", pin.title);
    // A prompt cancelled is null; one cleared is a deliberate blank. Only the
    // first means "leave it alone".
    if (next === null) return;
    const title = next.trim();
    if (!title) return;
    try {
      await api.renamePin(pin.id, title);
      pin.title = title;
      this.render();
    } catch (e) {
      this.report(e);
    }
  }

  private async remove(pin: Pin): Promise<void> {
    if (!window.confirm(`Remove “${pin.title || "this pin"}”?`)) return;
    try {
      await api.deletePin(pin.id);
    } catch (e) {
      this.report(e);
      return;
    }
    this.pins = this.pins.filter((p) => p.id !== pin.id);
    this.dropImage(pin.id);
    this.render();
    this.onChange?.();
  }

  /** Releases a pin's picture, so a removed one does not sit in memory. */
  private dropImage(id: string): void {
    const url = this.images.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.images.delete(id);
  }

  /** The pointer's position on a page, as a point in normalised page space. */
  private normalised(x: number, y: number, page: HTMLElement): { x: number; y: number } | null {
    const box = page.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const nx = (x - box.left) / box.width;
    const ny = (y - box.top) / box.height;
    // Outside the page means the drag ran off the edge; clamping keeps what was
    // asked for inside the page rather than cropping from beyond it.
    return { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) };
  }

  /** The same, but across the whole pane, which is what a card moves within. */
  private normalisedInPane(x: number, y: number): { x: number; y: number } | null {
    const box = this.pane.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
  }

  private report(e: unknown): void {
    window.alert(e instanceof Error ? e.message : String(e));
  }

  detach(): void {
    for (const url of this.images.values()) URL.revokeObjectURL(url);
    this.images.clear();
    this.host.remove();
  }
}

/**
 * Cuts a region out of a painted page into a JPEG.
 *
 * The canvas is painted at the screen's resolution and shown at CSS size, so
 * the two are related by a ratio rather than being equal. That ratio is read
 * from the element rather than assumed, because it is whatever the page was
 * actually rendered at: a 2x display would otherwise crop the top-left quarter
 * of the page and call it the whole thing.
 *
 * The size it is shown at is passed in rather than measured, because the source
 * is a copy that is not in the document and so has no box to measure.
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

  // A crop is read from what is on screen, so it is scaled to fit the card
  // rather than kept at full resolution: a pin is a glance, not a print, and a
  // page-sized JPEG per pin is a lot of disk for something 200px wide.
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
 * What to call a card, before the user names it.
 *
 * The words under the crop, since that is what the card is a picture of, cut at
 * a word so it does not end mid-word, and a plain number when there are no
 * words at all. Never invented: a chart that cannot be named is better
 * described as "Pin 2" than as something plausible and wrong.
 *
 * Deliberately not split at a sentence boundary. Patterns are full of labels
 * that look like sentence ends — "Row 1:", "Size:", "Finished gauge:" — and
 * cutting at the first one names every card after its own heading.
 */
export function titleFor(quote: string, index: number): string {
  const text = quote.replace(/\s+/g, " ").trim();
  if (!text) return `Pin ${index}`;
  if (text.length <= TITLE_LIMIT) return text;
  // Cut at the last space before the limit, so the name ends on a whole word.
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

/** Re-exported so the reader can convert a stored crop back to pixels. */
export { fromPageRect, toPageRect };
