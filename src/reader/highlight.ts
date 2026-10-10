import type { HighlightSettings } from "../api";

/**
 * The moving highlight line.
 *
 * It lives in a fixed-position overlay above the reading area rather than
 * inside the scrolled content, so it stays put on screen while the pattern
 * scrolls underneath it. That is what makes it useful for following a chart:
 * the line is your "you are here" marker.
 *
 * Supported interactions:
 *  - Arrow keys / Page keys scroll the content under a stationary line
 *  - Dragging the line by its grip moves it vertically
 *  - Clicking the grip readies the line, and the next click in the content
 *    puts it there; a click in the content is otherwise the content's own
 *  - Movement can be smooth-animated or instant
 *  - All geometry is configurable and saved per pattern
 */
export class HighlightLine {
  private host: HTMLElement;
  private el: HTMLDivElement;
  private grip: HTMLDivElement;
  private settings: HighlightSettings;
  private scroller: HTMLElement | null = null;

  /** Set while a drag is in progress, to avoid fighting the scroll handler. */
  private dragging = false;
  private dragOffsetY = 0;
  /** Where a press on the grip began, to tell a click from a drag. */
  private pressY = 0;
  private moved = false;
  /** Readied by a click on the grip: the next click in the content puts the line there. */
  private ready = false;
  /** Where a smooth scroll still under way is going, so steps taken during it add up. */
  private scrollGoal: number | null = null;

  /** Cancels an in-flight smooth scroll when a new movement starts. */
  private animToken = 0;

  constructor(settings: HighlightSettings) {
    this.settings = settings;

    this.host = document.createElement("div");
    this.host.className = "highlight-layer";

    this.el = document.createElement("div");
    this.el.className = "highlight-line";
    this.el.setAttribute("role", "slider");
    this.el.setAttribute("aria-label", "Highlight line position");
    this.el.tabIndex = 0;

    // A small handle on the left edge makes the line grabbable without
    // covering much of the chart.
    this.grip = document.createElement("div");
    this.grip.className = "highlight-grip";
    this.grip.title = "Drag to move, double-click to configure";
    this.el.appendChild(this.grip);

    this.host.appendChild(this.el);
    this.apply();
    this.bindEvents();
  }

  get element(): HTMLElement {
    return this.host;
  }

  /** Mounts the overlay and tells it which element scrolls the content. */
  attach(scroller: HTMLElement): void {
    this.scroller = scroller;
    if (this.host.parentElement !== scroller.parentElement) {
      scroller.parentElement?.appendChild(this.host);
    }
    // The position is stored as a fraction of the viewport height precisely so
    // it survives a window resize -- re-resolve it when the reading area
    // changes size, or the line keeps a stale pixel top.
    this.scrollerObserver?.disconnect();
    this.scrollerObserver = new ResizeObserver(() => {
      if (!this.dragging && this.scroller) {
        this.position(resolveTop(this.settings, this.scroller));
      }
    });
    this.scrollerObserver.observe(scroller);
    // Wheel and touch are the user's own scrolling: cancel any smooth-scroll
    // animation still in flight, or it keeps writing scrollTop over the
    // user's position until it finishes.
    scroller.addEventListener("wheel", this.cancelAnimation, { passive: true });
    scroller.addEventListener("touchstart", this.cancelAnimation, { passive: true });
    this.apply();
  }

  detach(): void {
    this.scrollerObserver?.disconnect();
    this.scrollerObserver = null;
    if (this.scroller) {
      this.scroller.removeEventListener("wheel", this.cancelAnimation);
      this.scroller.removeEventListener("touchstart", this.cancelAnimation);
    }
    this.host.remove();
  }

  /** Cancels an in-flight smooth scroll, so a direct write wins. */
  private cancelAnimation = (): void => {
    this.animToken++;
    this.scrollGoal = null;
  };

  /** Re-resolves the stored fraction when the reading area resizes. */
  private scrollerObserver: ResizeObserver | null = null;

  update(settings: HighlightSettings): void {
    this.settings = settings;
    this.apply();
  }

  /** Whether the line is switched on and showing. */
  get enabled(): boolean {
    return this.settings.enabled;
  }

  get current(): HighlightSettings {
    return { ...this.settings };
  }

  private apply(): void {
    const s = this.settings;
    this.host.style.display = s.enabled ? "block" : "none";
    this.el.style.background = s.color;
    this.el.style.opacity = String(s.opacity);
    this.el.style.height = `${Math.max(1, s.thickness)}px`;

    // width 0 means "span the column", otherwise honour the exact pixel width
    // and centre it in the reading area.
    if (s.width > 0) {
      this.el.style.width = `${s.width}px`;
      this.el.style.left = "50%";
      this.el.style.transform = "translateX(-50%)";
    } else {
      this.el.style.width = `calc(100% - ${s.insetX * 2}px)`;
      this.el.style.left = `${s.insetX}px`;
      this.el.style.transform = "none";
    }

    this.position(resolveTop(s, this.scroller));
  }

  /** Places the line at an absolute pixel offset within the scroller. */
  private position(top: number): void {
    this.el.style.top = `${top}px`;
    this.el.setAttribute("aria-valuenow", String(Math.round(top)));
  }

  private bindEvents(): void {
    // Drag the line to reposition it -- from the grip specifically, not the
    // whole band. The band sits above the text layer, so at any real
    // thickness it would otherwise swallow the mousedown a text selection
    // needs to start, exactly over the row the reader is most likely trying
    // to select from. The grip is small and to the side for the same reason
    // the original comment on it says: grabbable without covering the chart.
    this.grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.dragging = true;
      this.pressY = e.clientY;
      this.moved = false;
      const rect = this.el.getBoundingClientRect();
      // Grab offset so the line does not jump to centre under the cursor.
      this.dragOffsetY = e.clientY - rect.top;
      this.grip.setPointerCapture(e.pointerId);
      document.body.classList.add("dragging-highlight");
    });

    this.grip.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.scroller) return;
      if (Math.abs(e.clientY - this.pressY) < 3 && !this.moved) return;
      this.moved = true;
      const rect = this.scroller.getBoundingClientRect();
      const top = e.clientY - rect.top - this.dragOffsetY;
      this.commitTop(top);
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.grip.hasPointerCapture(e.pointerId)) {
        this.grip.releasePointerCapture(e.pointerId);
      }
      document.body.classList.remove("dragging-highlight");
      // A press that did not move is a click: it readies the line to be put
      // somewhere, or lets it go again.
      if (!this.moved) return this.setReady(!this.ready);
      this.setReady(false);
      // Persist once the drag is over rather than on every pointermove, which
      // would write to the database hundreds of times per second.
      this.flush();
    };
    this.grip.addEventListener("pointerup", endDrag);
    this.grip.addEventListener("pointercancel", endDrag);

    // Double-click the grip opens the settings panel.
    this.grip.addEventListener("dblclick", () => {
      this.onConfigureRequest?.();
    });
  }

  /**
   * Moves the line to an absolute offset and stores it back as a fraction, so
   * the position is remembered relative to the window rather than the page.
   *
   * `minTop` exists because stepping to a row and dragging want different
   * limits. A drag keeps a small margin so the line cannot be lost off the
   * top edge, but stepping has to be able to reach the very first band, since
   * marking row 1 at the top of a chart is the whole point. The bottom clamp
   * matches `resolveTop`'s, so a resize and a move agree about the limit.
   */
  commitTop(top: number, minTop = 8): number {
    const scroller = this.scroller;
    if (!scroller) return 0;
    const height = scroller.clientHeight || 1;
    const clamped = Math.min(Math.max(top, minTop), Math.max(minTop, height - 1));
    this.position(clamped);
    this.settings.offsetY = clamped / height;
    return clamped;
  }

  /** Whether a click in the content puts the line there: once its grip has been clicked. */
  get isReady(): boolean {
    return this.ready;
  }

  setReady(on: boolean): void {
    this.ready = on;
    this.el.classList.toggle("ready", on);
    this.grip.title = on ? "Click in the pattern to put the line there (Esc: not now)" : "Drag to move; click, then click in the pattern, to put it there; double-click to configure";
  }

  /** Puts the line where the content was clicked, if it was readied for it. Returns whether it moved. */
  placeAt(top: number): boolean {
    if (!this.ready) return false;
    this.commitTop(top);
    this.setReady(false);
    this.flush();
    return true;
  }

  /** The line's current top, in pixels from the top of the reading area. */
  get top(): number {
    return parseFloat(this.el.style.top || "0") || 0;
  }

  /** The band's thickness, which is also the height of one row. */
  get bandHeight(): number {
    return Math.max(1, Math.round(this.settings.thickness));
  }

  /**
   * Which row the line is on, counting from the top of the reading area.
   *
   * Row 1 is the first band, so the number shown matches how a chart is
   * counted rather than being zero-based.
   */
  get row(): number {
    return Math.round(this.top / this.bandHeight) + 1;
  }

  /**
   * Moves the line exactly one row along the pattern: its own height, so with
   * the line the height of a chart row each step lands on the next row from
   * wherever it was put. Within the middle of the pane the line moves; near
   * its top or bottom the pattern moves instead, by the same row, so the line
   * stays on the chart's rows rather than drifting off them. Only at the very
   * start or end of the pattern, which cannot scroll further, does the line
   * go on to the pane's edge.
   */
  stepRow(direction: 1 | -1, smooth: boolean): number {
    const scroller = this.scroller;
    if (!scroller) return this.row;
    const height = scroller.clientHeight || 1;
    const row = this.bandHeight;
    const want = this.top + direction * row;
    const low = Math.min(height * 0.1, Math.max(0, height - row));
    const high = Math.max(low, height * 0.85 - row);
    if (want >= low && want <= high) {
      this.commitTop(want, 0);
      return this.row;
    }
    // The pattern moves under the line, as far as it can; the line takes the rest.
    const base = this.scrollGoal ?? scroller.scrollTop;
    const max = Math.max(0, scroller.scrollHeight - height);
    const goal = Math.min(max, Math.max(0, base + direction * row));
    const scrolled = goal - base;
    const rest = direction * row - scrolled;
    if (rest) this.commitTop(Math.min(Math.max(this.top + rest, 0), Math.max(0, height - row)), 0);
    if (scrolled) this.scrollTo(goal, smooth);
    return this.row;
  }

  /** Scrolls the content to a place, easing if asked; steps taken meanwhile go on from where it is going. */
  private scrollTo(target: number, smooth: boolean): void {
    if (!this.scroller) return;
    if (this.settings.animate && smooth) {
      this.smoothScrollTo(target);
    } else {
      this.animToken++;
      this.scrollGoal = null;
      this.scroller.scrollTop = target;
    }
  }

  /**
   * Scrolls the content when the line has moved somewhere it would otherwise
   * sit over nothing useful, so stepping down a long chart keeps the content
   * arriving under the line.
   */
  private keepInView(top: number, smooth: boolean): void {
    if (!this.scroller) return;
    const height = this.scroller.clientHeight;
    const overscroll = top + this.bandHeight - height * 0.85;
    if (overscroll > 0) {
      this.nudge(overscroll, smooth);
    } else if (top < height * 0.1) {
      this.nudge(top - height * 0.1, smooth);
    }
  }

  /** Scrolls the content so the line's current offset moves to the centre. */
  nudge(delta: number, smooth: boolean): void {
    if (!this.scroller) return;
    const target = this.scroller.scrollTop + delta;
    if (this.settings.animate && smooth) {
      this.smoothScrollTo(target);
    } else {
      // An instant write supersedes any smooth scroll still in flight;
      // without bumping the token the animation keeps overwriting the
      // position for up to a second afterwards.
      this.animToken++;
      this.scrollGoal = null;
      this.scroller.scrollTop = target;
    }
  }

  /** Moves the line itself, in pixels, optionally easing as it goes. */
  moveLineBy(delta: number, smooth: boolean): void {
    if (!this.scroller) return;
    const next = this.top + delta;
    // minTop 0, like stepRow: Shift+Arrow has to reach the top band (row 1),
    // which the drag margin would otherwise make unreachable by keys.
    const landed = this.commitTop(next, 0);
    this.keepInView(landed, smooth);
  }

  private smoothScrollTo(target: number): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const token = ++this.animToken;
    const start = scroller.scrollTop;
    const distance = target - start;
    this.scrollGoal = target;
    if (Math.abs(distance) < 1) {
      scroller.scrollTop = target;
      this.scrollGoal = null;
      return;
    }

    const duration = Math.min(Math.max(this.settings.animationMs, 80), 1200);
    const startTime = performance.now();

    const step = (now: number) => {
      // A newer movement superseded this one.
      if (token !== this.animToken) return;
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeOutCubic: fast start, gentle settle, easy on the eyes.
      const eased = 1 - Math.pow(1 - t, 3);
      scroller.scrollTop = start + distance * eased;
      if (t < 1) requestAnimationFrame(step);
      else this.scrollGoal = null;
    };
    requestAnimationFrame(step);
  }

  /** Fires when the line asks to open the settings panel. */
  onConfigureRequest: (() => void) | null = null;

  /** Fires whenever the line's position changes, for persistence. */
  onChange: ((settings: HighlightSettings) => void) | null = null;

  /** Called after a drag so the caller can save the new position. */
  flush(): void {
    this.onChange?.(this.current);
  }
}

/**
 * Recovers the line's pixel position from the stored fraction.
 *
 * The limits match `stepTop`'s rather than keeping a margin of their own: a
 * line stepped up to the first band sits at 0, and clamping that to a margin
 * on the next resize would quietly push it off the band grid, which is exactly
 * what the grid exists to prevent.
 */
function resolveTop(s: HighlightSettings, scroller: HTMLElement | null): number {
  if (!scroller) return s.offsetY;
  const height = scroller.clientHeight || 1;
  const raw = s.offsetY * height;
  return Math.min(Math.max(raw, 0), Math.max(0, height - 1));
}
