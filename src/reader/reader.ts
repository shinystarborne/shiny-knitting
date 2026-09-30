import { api, toBytes, STATUSES, type AiSettingsView, type HighlightSettings, type Pattern, type SuggestionResult } from "../api";
import { EpubView } from "./epub";
import { say } from "../dialogs";
import { closestEl } from "../dom";
import { HighlightLine } from "./highlight";
import { MarkLayer, MARK_COLOURS, type MarkTool } from "./marks";
import { PinLayer } from "./pins";
import { PdfView, type RenderedDoc } from "./pdf";
import { RowCounter } from "./counter";
import { scanOne } from "../ai/scan";
import { extractFromDocument, forgetCover, prepareChosenImage, saveCover } from "../covers";

export type Layout = "focus" | "split";

/**
 * The thickest highlight line the settings panel will produce, in px.
 *
 * A highlight is often used to mask a block of chart legend or a run of
 * instructions, not just to draw a hairline under the current row, so the
 * range has to reach well past a line of text. The number field beside the
 * slider accepts the same range for an exact value.
 */
const HIGHLIGHT_THICKNESS_MAX = 600;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The reading screen: document on one side, tools on the other, with a layout
 * toggle because a chart wants more document width and a text page benefits
 * from the notes being visible at the same time.
 */
export class ReaderView {
  /**
   * The shared screen the reader is mounted into.
   *
   * The reader builds its own element inside it rather than writing straight
   * into the screen. That matters: every listener this view adds is attached
   * to its own element, so mounting a second reader cannot leave a stale
   * listener behind to act on the new one's clicks.
   */
  private screen: HTMLElement;
  private root!: HTMLElement;
  private pattern: Pattern;
  private layout: Layout;

  private scroller!: HTMLElement;
  private doc: RenderedDoc | null = null;
  private highlight: HighlightLine | null = null;
  private marks: MarkLayer | null = null;
  /** The floating pin cards. Null until the document has loaded. */
  private pins: PinLayer | null = null;
  private counter: RowCounter | null = null;
  private settings: HighlightSettings | null = null;

  /** Guards against writing a stale scroll position after the user navigates. */
  private saveTimer: number | null = null;
  /**
   * Debounces writes of the notes textarea. Separate from `saveTimer`: sharing
   * one timer meant typing then scrolling within the debounce window silently
   * discarded the pending notes write.
   */
  private notesTimer: number | null = null;
  /** Throttles mark repainting while scrolling. */
  private markRepaintTimer: number | null = null;
  /** Click-outside dismissal for the floating counter panel, while it is open. */
  private fabDismiss: ((e: MouseEvent) => void) | null = null;

  /**
   * Set once the view is torn down. `mount` does real async work (reading a
   * file, rendering pages), so it can still be mid-flight when the user opens
   * another pattern. Every await after the first is a chance to notice that
   * this view is no longer on screen and stop touching detached DOM.
   */
  private destroyed = false;

  /** The pattern being read, so the app can re-render this view in a new layout. */
  get patternId(): string {
    return this.pattern.id;
  }

  constructor(screen: HTMLElement, pattern: Pattern, layout: Layout) {
    this.screen = screen;
    this.pattern = pattern;
    this.layout = layout;
  }

  async mount(): Promise<void> {
    this.renderChrome();

    const bytes = await api.readFile(this.pattern.id);
    if (this.destroyed) return;
    const data = toBytes(bytes);

    this.doc = this.pattern.format === "epub" ? new EpubView(this.scroller) : new PdfView(this.scroller);
    // A chapter that changes height moves everything below it, and marks are
    // positioned against the text, so they have to be redrawn straight away.
    this.doc.onReflow = () => this.marks?.repaint();
    // A zoom re-renders every page, which is also a reflow as far as marks
    // are concerned: their pixel positions are worked out from the page
    // boxes pdf.js just resized.
    this.doc.onZoomChange = () => {
      this.refreshZoomReadout();
      this.marks?.repaint();
    };
    try {
      await this.doc.load(data);
    } catch (e) {
      if (!this.destroyed) this.showError(e);
      return;
    }
    if (this.destroyed) return;
    this.refreshZoomReadout();

    this.settings = await api.getHighlight(this.pattern.id);
    if (this.destroyed) return;
    this.highlight = new HighlightLine(this.settings);
    this.highlight.attach(this.scroller);
    // The attach resolved the stored fraction to a real position, but the
    // readout still shows its initial "row 1" until something refreshes it.
    this.refreshRowReadout();
    this.highlight.onChange = (s) => {
      void api.saveHighlight(s);
      // A drag ends here, so this is where the row readout catches up.
      this.refreshRowReadout();
    };
    this.highlight.onConfigureRequest = () => this.openHighlightPanel();

    this.marks = new MarkLayer(this.scroller, this.pattern.id, this.doc);
    this.marks.onChange = () => this.refreshMarkTools();
    this.marks.attach();
    this.marks.setTool("none");
    await this.marks.refresh();
    if (this.destroyed) return;

    this.pins = new PinLayer(this.scroller, this.pattern.id, {
      currentPage: () => this.doc?.currentPage() ?? 1,
      pageElement: (page) => this.doc?.pageElement(page) ?? null,
      textLayerFor: (page) => this.doc?.textLayerFor(page) ?? null,
      format: this.pattern.format,
    });
    // A pin drag is started from the mark layer, so that only one tool can be
    // active: a press that begins a crop cannot also leave a note behind.
    this.marks.onPinSelect = (e, page) => this.pins?.beginSelection(e, page);
    this.pins.onChange = () => this.refreshPinTool();
    await this.pins.load();
    if (this.destroyed) return;
    this.refreshPinTool();

    const slot = this.root.querySelector<HTMLElement>(".counter-slot");
    if (!slot) return;
    this.counter = new RowCounter(slot, this.pattern.id);
    await this.counter.refresh();
    if (this.destroyed) return;

    this.bindKeys();
    this.bindPositionSaving();
    this.restorePosition();

    // The toolbar opens on Select, so the common case -- reading, and removing
    // a mark by clicking it -- needs no tool chosen, and a stray drag on the
    // page draws nothing.
    this.setMarkTool("none");

    const colour = this.root.querySelector<HTMLInputElement>("[data-mark-colour]");
    colour?.addEventListener("input", () => this.marks?.setColour(colour.value));

    // Marks are stored per page, so they are repainted as the reader moves and
    // as pages finish rendering underneath.
    this.scroller.addEventListener("scroll", () => {
      clearTimeout(this.markRepaintTimer ?? undefined);
      this.markRepaintTimer = window.setTimeout(() => this.marks?.repaint(), 120);
    }, { passive: true });
  }

  private renderChrome(): void {
    const sidebar = this.layout === "split";
    this.root = document.createElement("div");
    this.root.className = `reader ${sidebar ? "layout-split" : "layout-focus"}`;
    this.root.innerHTML = `
      <header class="reader-bar">
        <button class="ghost back" data-act="back">← Library</button>
        <div class="reader-title">
          <h2>${escapeHtml(this.pattern.title)}</h2>
          <p>
            ${this.pattern.designer ? escapeHtml(this.pattern.designer) + " · " : ""}
            <span class="pill">${statusLabel(this.pattern.status)}</span>
            ${this.pattern.needleSize ? `<span class="pill">${escapeHtml(this.pattern.needleSize)}</span>` : ""}
            ${this.pattern.difficulty ? `<span class="pill">${escapeHtml(this.pattern.difficulty)}</span>` : ""}
          </p>
        </div>
        <div class="reader-tools">
          <span class="row-readout" data-row-readout
            title="Which row the highlight line is on. Press J or K to step a row and count it."
            >${this.rowLabel}</span
          >
          <div class="mark-tools" role="toolbar" aria-label="Marking">
            <button data-mark="none" class="ghost icon-btn" aria-label="Select" title="Select: click a mark to remove it">➤</button>
            <button data-mark="highlight" class="ghost icon-btn" aria-label="Highlight" title="Highlight: select text, then press this or H">🖊</button>
            <button data-mark="note" class="ghost icon-btn" aria-label="Note" title="Note: click where it belongs">🅣</button>
            <button data-mark="draw" class="ghost icon-btn" aria-label="Draw" title="Draw: drag on the page">✏️</button>
            <button data-mark="pin" class="ghost icon-btn" aria-label="Pin" title="Pin: drag a box around part of the page to keep it in view" data-pin-tool>📌</button>
            <input type="color" data-mark-colour title="Mark colour" value="${MARK_COLOURS[0].value}" />
            <button data-act="mark-undo" class="ghost icon-btn" aria-label="Undo" title="Undo the last mark made" data-mark-undo>↶</button>
            <button data-act="mark-clear" class="ghost icon-btn" aria-label="Clear all marks" title="Remove every highlight, note and drawing on this pattern" data-mark-clear>🗑</button>
          </div>
          ${
            this.pattern.format === "pdf"
              ? `<div class="zoom-tools" role="toolbar" aria-label="Zoom">
                  <button data-act="zoom-out" class="ghost icon-btn" aria-label="Zoom out" title="Zoom out (Ctrl+-)">−</button>
                  <span class="zoom-pct" data-zoom-pct>100%</span>
                  <button data-act="zoom-in" class="ghost icon-btn" aria-label="Zoom in" title="Zoom in (Ctrl+=)">+</button>
                  <button data-act="zoom-fit" class="ghost icon-btn" aria-label="Fit width" title="Fit width (Ctrl+0)">⇔</button>
                </div>`
              : ""
          }
          <button data-act="describe" class="ghost" title="Read this pattern's details with your model">Describe</button>
          <button data-act="layout" class="ghost" title="Switch layout">
            ${sidebar ? "Focus view" : "Split view"}
          </button>
          <button data-act="highlight-cfg" class="ghost" title="Highlight line settings">Line</button>
          <button data-act="edit" class="ghost" title="Edit details">Details</button>
        </div>
      </header>
      <div class="reader-body">
        <div class="doc-pane">
          <div class="doc-scroller" tabindex="0"></div>
        </div>
        <aside class="side-pane" ${sidebar ? "" : "hidden"}>
          <div class="counter-slot"></div>
          <div class="side-section">
            <h3>Notes</h3>
            <textarea class="notes-area" placeholder="Notes about this pattern...">${escapeHtml(
              this.pattern.notes,
            )}</textarea>
            <p class="hint">Saved automatically.</p>
          </div>
          <div class="side-section">
            <h3>Tags</h3>
            <div class="tag-row">${this.pattern.tags
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join("")}</div>
          </div>
        </aside>
      </div>
      <div class="highlight-panel" hidden></div>
    `;

    this.scroller = this.root.querySelector(".doc-scroller")!;

    this.root.addEventListener("click", (e) => {
      // Marking tools first: they sit in the reader bar, which is also where
      // the other buttons are, and a tool button carries no data-act.
      const tool = closestEl(e.target, "[data-mark]");
      if (tool) {
        const kind = tool.dataset.mark as MarkTool;
        // Highlight is not a drag tool like Draw or Pin: it acts on the
        // selection that is already made, the same as the H key does. Just
        // arming it would leave the button looking on with nothing to click
        // it into, since the mark layer has no drag behaviour for this tool.
        if (kind === "highlight") void this.highlightSelection();
        else this.setMarkTool(kind);
        return;
      }
      const btn = closestEl(e.target, "button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "back") this.root.dispatchEvent(new CustomEvent("navigate-back", { bubbles: true }));
      if (act === "layout") {
        this.root.dispatchEvent(
          new CustomEvent("change-layout", { bubbles: true, detail: sidebar ? "focus" : "split" }),
        );
      }
      if (act === "highlight-cfg") this.openHighlightPanel();      if (act === "edit") {
        this.root.dispatchEvent(
          new CustomEvent("edit-pattern", { bubbles: true, detail: this.pattern }),
        );
      }
      if (act === "describe") void this.describeWithModel(btn as HTMLButtonElement);
      if (act === "cover-file") void this.chooseCover();
      if (act === "cover-reset") void this.resetCover();
      if (act === "mark-undo") void this.marks?.undoLast().then(() => this.refreshMarkTools());
      if (act === "mark-clear") void this.marks?.clearAll().then(() => this.refreshMarkTools());
      if (act === "zoom-in") this.doc?.zoomIn?.();
      if (act === "zoom-out") this.doc?.zoomOut?.();
      if (act === "zoom-fit") this.doc?.zoomToFit?.();
    });

    // The side pane is always in the DOM, so the counter keeps its state; the
    // focus layout just hides it. Show it on demand via the counter button.
    const sidePane = this.root.querySelector(".side-pane") as HTMLElement;
    if (!sidebar) {
      const fab = document.createElement("button");
      fab.className = "counter-fab";
      fab.textContent = "Counter";
      fab.title = "Show the row counter";
      fab.addEventListener("click", () => {
        sidePane.hidden = false;
        sidePane.classList.add("peek");
        fab.remove();
        // Click outside the floating panel to put it away again. Registered
        // on the next tick so the click that opened the panel does not
        // immediately close it.
        const dismiss = (e: MouseEvent) => {
          if (sidePane.contains(e.target as Node)) return;
          sidePane.hidden = true;
          sidePane.classList.remove("peek");
          document.removeEventListener("click", dismiss);
          this.fabDismiss = null;
        };
        this.fabDismiss = dismiss;
        setTimeout(() => document.addEventListener("click", dismiss), 0);
      });
      this.root.querySelector(".reader-body")?.appendChild(fab);
    }

    const notes = this.root.querySelector(".notes-area") as HTMLTextAreaElement;
    notes.addEventListener("input", () => {
      this.pattern.notes = notes.value;
      clearTimeout(this.notesTimer ?? undefined);
      this.notesTimer = window.setTimeout(() => {
        this.notesTimer = null;
        void api.updatePattern(this.pattern);
      }, 600);
    });

    // Attached last, so everything above is in place before the element goes
    // on screen and can receive a click.
    this.screen.appendChild(this.root);
  }

  /**
   * Asks the configured model to describe this one pattern, and shows what it
   * found before anything is written.
   *
   * Unlike a library-wide scan, a single pattern is always shown first: the
   * user is looking at the pattern, so they can judge a needle size or a tag
   * immediately and correct it there and then.
   */
  private async describeWithModel(button: HTMLButtonElement): Promise<void> {
    const settings: AiSettingsView = await api.getAiSettings();
    if (!settings.baseUrl.trim()) {
      this.root.dispatchEvent(
        new CustomEvent("open-ai-settings", { bubbles: true, detail: settings }),
      );
      return;
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Reading...";
    try {
      const result: SuggestionResult = await scanOne(this.pattern, settings);
      if (result.failed) {
        await say(`The model could not read this pattern.\n\n${result.error}`, "Describe");
        return;
      }
      if (!result.changedFields.length) {
        await say("Everything the model could fill in is already filled in.", "Describe");
        return;
      }
      this.showSuggestion(result);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Describe");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  /** A small panel showing the model's proposal, with the choice to keep it. */
  private showSuggestion(result: SuggestionResult): void {
    this.root.querySelector(".suggest-panel")?.remove();
    const rows = result.changedFields
      .map((field) => {
        const before = fieldValue(result.before, field);
        const after = fieldValue(result.after, field);
        return `
          <tr>
            <th>${escapeHtml(field)}</th>
            <td class="was">${escapeHtml(before) || "<em>empty</em>"}</td>
            <td class="now">${escapeHtml(after) || "<em>empty</em>"}</td>
          </tr>`;
      })
      .join("");

    const panel = document.createElement("div");
    panel.className = "suggest-panel";
    panel.innerHTML = `
      <div class="panel-head">
        <h3>What the model found</h3>
        <button class="ghost" data-act="suggest-close">×</button>
      </div>
      <table class="suggest-table">
        <thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        result.applied
          ? `<p class="hint">Already saved. You can undo it from the library card.</p>`
          : ""
      }
      <div class="modal-actions">
        <button class="ghost" data-act="suggest-close">Close</button>
        ${
          result.applied
            ? ""
            : `<button class="primary" data-act="suggest-apply">Use these</button>`
        }
      </div>
    `;
    this.root.appendChild(panel);

    panel.addEventListener("click", async (e) => {
      const btn = closestEl(e.target, "button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "suggest-close") {
        panel.remove();
      }
      if (btn.dataset.act === "suggest-apply") {
        const updated = await api.applySuggestion(result.patternId, result.after);
        this.pattern = updated;
        // Repaint the header so the new details show at once.
        const title = this.root.querySelector(".reader-title h2");
        if (title) title.textContent = updated.title;
        const sub = this.root.querySelector(".reader-title p");
        if (sub) sub.innerHTML = this.subtitleHtml(updated);
        panel.remove();
        this.root.dispatchEvent(
          new CustomEvent("pattern-updated", { bubbles: true, detail: updated }),
        );
      }
    });
  }

  private subtitleHtml(pattern: Pattern): string {
    const parts: string[] = [];
    if (pattern.designer) parts.push(escapeHtml(pattern.designer));
    parts.push(`<span class="pill">${statusLabel(pattern.status)}</span>`);
    if (pattern.needleSize) parts.push(`<span class="pill">${escapeHtml(pattern.needleSize)}</span>`);
    if (pattern.difficulty) parts.push(`<span class="pill">${escapeHtml(pattern.difficulty)}</span>`);
    return parts.join(" · ");
  }

  // ---------- covers ----------

  private async chooseCover(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const blob = await prepareChosenImage(file);
      if (!blob) {
        await say("That file could not be read as an image.", "Cover");
        return;
      }
      await saveCover(this.pattern.id, blob);
      forgetCover(this.pattern.id);
      this.root.dispatchEvent(
        new CustomEvent("pattern-updated", { bubbles: true, detail: this.pattern }),
      );
    });
    input.click();
  }

  private async resetCover(): Promise<void> {
    try {
      const bytes = await api.readFile(this.pattern.id);
      const found = await extractFromDocument(this.pattern, toBytes(bytes));
      if (!found) {
        await say("No cover image was found in that file.", "Cover");
        return;
      }
      await saveCover(this.pattern.id, found.blob);
      forgetCover(this.pattern.id);
      this.root.dispatchEvent(
        new CustomEvent("pattern-updated", { bubbles: true, detail: this.pattern }),
      );
    } catch {
      await say("Could not read that file.", "Cover");
    }
  }

  /**
   * The highlight settings panel. Every control writes straight through to
   * the database, so the configuration is remembered per pattern.
   */
  private openHighlightPanel(): void {
    const panel = this.root.querySelector(".highlight-panel") as HTMLElement;
    const s = this.highlight?.current;
    if (!s) return;

    const wasHidden = panel.hasAttribute("hidden");
    panel.innerHTML = `
      <div class="panel-head">
        <h3>Highlight line</h3>
        <button class="ghost" data-act="close-panel">×</button>
      </div>
      <label class="row">
        <span>Show line</span>
        <input type="checkbox" data-f="enabled" ${s.enabled ? "checked" : ""} />
      </label>
      <label class="row">
        <span>Height on screen <em data-row-readout>${this.rowLabel}</em></span>
        <input type="range" data-f="offsetY" min="0" max="1" step="0.001" value="${s.offsetY}" />
      </label>
      <label class="row">
        <span>Thickness <em data-out="thickness">${s.thickness}px</em></span>
        <span class="thickness-controls">
          <input
            type="range"
            data-f="thickness"
            min="1"
            max="${HIGHLIGHT_THICKNESS_MAX}"
            step="1"
            value="${Math.min(s.thickness, HIGHLIGHT_THICKNESS_MAX)}"
          />
          <input
            class="px-field"
            type="number"
            data-f="thickness-number"
            min="1"
            max="${HIGHLIGHT_THICKNESS_MAX}"
            step="1"
            value="${s.thickness}"
            aria-label="Highlight line thickness in pixels"
          />
        </span>
      </label>
      <label class="row">
        <span>Width <em>${s.width > 0 ? s.width + "px" : "full width"}</em></span>
        <input type="range" data-f="width" min="0" max="1600" step="10" value="${s.width}" />
      </label>
      <label class="row">
        <span>Side margin <em>${s.insetX}px</em></span>
        <input type="range" data-f="insetX" min="0" max="200" step="2" value="${s.insetX}" />
      </label>
      <label class="row">
        <span>Colour</span>
        <input type="color" data-f="color" value="${s.color}" />
      </label>
      <label class="row">
        <span>Opacity <em>${Math.round(s.opacity * 100)}%</em></span>
        <input type="range" data-f="opacity" min="0.1" max="1" step="0.05" value="${s.opacity}" />
      </label>
      <label class="row">
        <span>Smooth movement</span>
        <input type="checkbox" data-f="animate" ${s.animate ? "checked" : ""} />
      </label>
      <label class="row">
        <span>Animation speed <em>${s.animationMs}ms</em></span>
        <input type="range" data-f="animationMs" min="80" max="800" step="20" value="${s.animationMs}" />
      </label>
      <p class="hint">
        Set the thickness to the on-screen height of one chart row and
        <kbd>J</kbd>/<kbd>K</kbd> steps the line a whole row and counts it.
        <kbd>Shift</kbd> to count without moving, <kbd>Alt</kbd> to move
        without counting. Drag the line to place it freely,
        double-click it to reopen this panel.
      </p>
    `;

    if (wasHidden) panel.removeAttribute("hidden");

    panel.querySelector('[data-act="close-panel"]')?.addEventListener("click", () => {
      panel.setAttribute("hidden", "");
    });

    // The number field next to the thickness slider is a second control for
    // the same setting, not a setting of its own, so it is wired separately
    // and kept in step with the slider.
    const thicknessNumber = panel.querySelector<HTMLInputElement>('[data-f="thickness-number"]');
    const thicknessRange = panel.querySelector<HTMLInputElement>('[data-f="thickness"]');
    const setThickness = (raw: string) => {
      const parsed = Math.round(parseFloat(raw));
      if (!Number.isFinite(parsed)) return;
      const value = clamp(parsed, 1, HIGHLIGHT_THICKNESS_MAX);
      const current = this.highlight!.current;
      current.thickness = value;
      // Both boxes are written back, including the one being typed into: a
      // value outside the range is clamped, and the field has to show what was
      // actually stored rather than what was typed.
      if (thicknessRange) thicknessRange.value = String(value);
      if (thicknessNumber) thicknessNumber.value = String(value);
      this.highlight!.update(current);
      void api.saveHighlight(current);
      this.updatePanelReadout(panel, current);
      // The band grid is the thickness, so changing it changes which row the
      // line is on even though the line itself has not moved.
      this.refreshRowReadout();
    };
    thicknessNumber?.addEventListener("input", () => setThickness(thicknessNumber.value));
    thicknessNumber?.addEventListener("change", () => setThickness(thicknessNumber.value));

    panel.querySelectorAll<HTMLInputElement>("[data-f]").forEach((input) => {
      const name = input.dataset.f ?? "";
      if (name === "thickness-number") return; // handled above
      const field = name as keyof HighlightSettings;
      const handler = () => {
        const current = this.highlight!.current;
        let value: unknown;
        if (input.type === "checkbox") value = input.checked;
        else if (input.type === "range") value = parseFloat(input.value);
        else value = input.value;
        // The field comes from a fixed list of input data-f attributes.
        (current as unknown as Record<string, unknown>)[field] = value;
        this.highlight!.update(current);
        void api.saveHighlight(current);
        this.updatePanelReadout(panel, current);
        if (field === "thickness" && thicknessNumber) {
          thicknessNumber.value = String(current.thickness);
        }
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });
  }

  private updatePanelReadout(panel: HTMLElement, s: HighlightSettings): void {
    const set = (label: string, text: string) => {
      const row = [...panel.querySelectorAll(".row")].find((r) =>
        r.querySelector("span")?.textContent?.startsWith(label),
      );
      const em = row?.querySelector("em");
      if (em) em.textContent = text;
    };
    // Computed live rather than read from the cached label, so dragging the
    // height slider reports the row it actually landed on.
    set("Height on screen", this.highlight ? `row ${this.highlight.row}` : this.rowLabel);
    set("Thickness", `${s.thickness}px`);
    set("Width", s.width > 0 ? `${s.width}px` : "full width");
    set("Side margin", `${s.insetX}px`);
    set("Opacity", `${Math.round(s.opacity * 100)}%`);
    set("Animation speed", `${s.animationMs}ms`);
  }

  /**
   * The synchronised row keys.
   *
   * `J` and `K` step the highlight line down or up by exactly one band and
   * count the row at the same time, which is the whole point: with the line's
   * thickness set to the on-screen height of one schematic row, each press
   * lands on the next chart row and the counter follows without a second key.
   *
   * The two modifiers separate the halves for the cases where only one should
   * move. `Shift` counts without moving, for correcting a miscount when the
   * line is already where it should be; `Alt` moves without counting, for
   * re-aligning the line after dragging it somewhere free.
   *
   * Moving down counts up: the line tracks progress through the document, and
   * the project total counts rows worked, so the two run in the same direction.
   * Every counter that is switched on moves with it; the counter's own buttons
   * are for nudging one without counting a project row.
   *
   * Returns true when the key was handled.
   */
  private handleRowKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    if (key !== "j" && key !== "k") return false;
    if (e.ctrlKey || e.metaKey) return false;
    // Typing in the counter's own inputs must not be intercepted.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return false;
    }
    const line = this.highlight;
    if (!line) return false;

    e.preventDefault();
    const direction: 1 | -1 = key === "j" ? 1 : -1;

    if (!e.altKey) {
      // The counter owns the arithmetic: one action moves the project total
      // and every enabled counter, so the numbers cannot drift apart.
      void this.counter?.countRows(direction);
    }
    if (!e.shiftKey) {
      line.stepRow(direction, true);
      line.flush();
    }
    this.refreshRowReadout();
    return true;
  }

  /**
   * Updates the "row N" readout wherever it appears.
   *
   * There are two: a badge in the reader bar and the panel's own row, and both
   * have to move together or the number lies about where the line is.
   */
  private refreshRowReadout(): void {
    const line = this.highlight;
    if (!line) return;
    this.rowLabel = `row ${line.row}`;
    this.root
      .querySelectorAll("[data-row-readout]")
      .forEach((el) => (el.textContent = this.rowLabel));
  }

  /** The row the line is on, shown in the reader bar and the settings panel. */
  private rowLabel = "row 1";

  /**
   * The marking shortcuts: H highlights the selection, N places a note, D draws.
   *
   * H is the one that earns a key, because highlighting is a two-step action --
   * select the words, then press -- and reaching for the toolbar with the other
   * hand on the mouse is awkward. The other two are single clicks on the page,
   * which are quicker than a key.
   */
  private handleMarkKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return false;
    }
    const key = e.key.toLowerCase();
    if (key === "h") {
      e.preventDefault();
      void this.highlightSelection();
      return true;
    }
    return false;
  }

  /**
   * Switches the marking tool, and paints the toolbar to show which is on.
   *
   * The highlight tool is the one that needs a two-step action -- select, then
   * press -- so it also takes a key. Switching away from it does not clear the
   * selection, which would throw away the words the user just chose.
   */
  private setMarkTool(tool: MarkTool): void {
    if (!this.marks) return;
    // A tool that cannot work right now is not chosen: pressing Pin on an
    // EPUB, or on a pattern already holding five, falls back to Select rather
    // than arming a drag that would refuse at the end of it.
    if (tool === "pin") {
      const room = this.pins?.availability();
      if (room && !room.ok) {
        void say(room.reason, "Pin");
        tool = "none";
      }
    }
    this.marks.setTool(tool);
    this.root.querySelectorAll<HTMLElement>("[data-mark]").forEach((button) => {
      const on = button.dataset.mark === tool;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  /**
   * Greys the Pin button out when pinning is not possible.
   *
   * The reason is kept in the tooltip, because a button that is simply
   * disabled tells you nothing about why.
   */
  private refreshPinTool(): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-pin-tool]");
    if (!button) return;
    const room = this.pins?.availability() ?? { ok: false, reason: "Still opening." };
    button.disabled = !room.ok;
    button.title = room.ok
      ? "Pin: drag a box around part of the page to keep it in view"
      : room.reason;
  }

  /** Updates the zoom percentage readout, and disables Zoom out at the floor. */
  private refreshZoomReadout(): void {
    const pct = this.doc?.zoomPercent?.();
    if (pct === undefined) return;
    const readout = this.root.querySelector<HTMLElement>("[data-zoom-pct]");
    if (readout) readout.textContent = `${pct}%`;
  }

  /** Greys Undo and Clear out when there is nothing on the pattern to act on. */
  private refreshMarkTools(): void {
    const has = this.marks?.hasMarks ?? false;
    const undo = this.root.querySelector<HTMLButtonElement>("[data-mark-undo]");
    if (undo) undo.disabled = !has;
    const clear = this.root.querySelector<HTMLButtonElement>("[data-mark-clear]");
    if (clear) clear.disabled = !has;
  }

  /** Ctrl/Cmd + =, -, or 0. Returns true when one matched and was handled. */
  private handleZoomKey(e: KeyboardEvent): boolean {
    if (!this.doc?.zoomIn) return false; // EPUB: nothing to zoom
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      this.doc.zoomIn();
      return true;
    }
    if (e.key === "-") {
      e.preventDefault();
      this.doc.zoomOut?.();
      return true;
    }
    if (e.key === "0") {
      e.preventDefault();
      this.doc.zoomToFit?.();
      return true;
    }
    return false;
  }

  /**
   * Highlights whatever is selected, and reports whether it did.
   *
   * The selection is left alone when there is nothing to highlight, so a
   * mistimed keypress does not clear the words.
   */
  private async highlightSelection(): Promise<boolean> {
    if (!this.marks) return false;
    const done = await this.marks.highlightSelection();
    if (done) this.setMarkTool("highlight");
    return done;
  }

  private bindKeys(): void {
    this.scroller.addEventListener("keydown", (e) => {
      // Marking keys first, so H reaches the highlight rather than falling
      // through to something that handles letters.
      if (this.handleMarkKey(e)) return;

      // Zoom next, and only with a modifier: plain +/-/0 are the counter's
      // own keys, and Ctrl/Cmd is also the combination every other app uses
      // for zoom, so it is the one combination guaranteed not to collide.
      if ((e.ctrlKey || e.metaKey) && this.handleZoomKey(e)) return;

      // Row keys next: they are the synchronised action, and the counter
      // below must not swallow them.
      if (this.handleRowKey(e)) return;

      // Counter keys win when the counter is present, except for scrolling
      // keys with Shift, which move the highlight line.
      if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        this.highlight?.moveLineBy(e.key === "ArrowDown" ? 40 : -40, true);
        this.highlight?.flush();
        this.refreshRowReadout();
        return;
      }
      if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        this.highlight?.nudge(e.key === "PageDown" ? 600 : -600, true);
        return;
      }
      // handleKey decides synchronously whether the key counts, so the
      // preventDefault lands in this same event dispatch, before the default
      // action -- an awaited decision would let an arrow key scroll as well
      // as count.
      if (this.counter && this.counter.handleKey(e)) {
        e.preventDefault();
      }
    });

    // Clicking the document parks the line at that spot, which is handy when
    // you are counting down a specific chart row.
    this.scroller.addEventListener("click", (e) => {
      const line = this.highlight;
      if (!line || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest(".highlight-line")) return;
      const rect = this.scroller.getBoundingClientRect();
      line.commitTop(e.clientY - rect.top);
      line.flush();
      this.refreshRowReadout();
    });

    // Ctrl/Cmd + wheel zooms, the same combination every other document
    // viewer uses, so the bare wheel is left alone for ordinary scrolling.
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || !this.doc?.zoomIn) return;
        e.preventDefault();
        if (e.deltaY < 0) this.doc.zoomIn();
        else this.doc.zoomOut?.();
      },
      { passive: false },
    );
  }

  private bindPositionSaving(): void {
    this.scroller.addEventListener("scroll", () => {
      clearTimeout(this.saveTimer ?? undefined);
      this.saveTimer = window.setTimeout(this.savePosition, 400);
    });
    window.addEventListener("beforeunload", this.savePosition);
  }

  /** Writes the reading position back to the database. */
  private savePosition = (): void => {
    if (!this.doc || this.destroyed) return;
    const page = this.doc.currentPage();
    const el = this.doc.pageElement(page);
    // The offset is saved relative to the page, not absolutely: goToPage()
    // adds the page's own offsetTop back on restore, so an absolute value
    // would be counted twice and reopening would land too far down.
    const offset = el ? Math.max(0, Math.round(this.doc.scrollTop - el.offsetTop)) : 0;
    void api.savePosition(this.pattern.id, page, offset);
  };

  private restorePosition(): void {
    if (!this.doc) return;
    const { lastPage, lastScroll } = this.pattern;
    if (lastPage > 1) {
      this.doc.goToPage(lastPage, lastScroll);
    } else if (lastScroll > 0) {
      // Page 1 goes through goToPage too: the saved offset is page-relative,
      // and goToPage puts the page's own offsetTop back.
      this.doc.goToPage(1, lastScroll);
    }
  }

  private showError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    this.scroller.innerHTML = `
      <div class="reader-error">
        <h3>Could not open this pattern</h3>
        <p>${escapeHtml(message)}</p>
        <p class="hint">The file is in your library folder. Re-adding it may help.</p>
      </div>`;
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.saveTimer ?? undefined);
    clearTimeout(this.markRepaintTimer ?? undefined);
    // A note typed within the debounce window has not been written yet; fire
    // the save now rather than losing the text.
    if (this.notesTimer !== null) {
      clearTimeout(this.notesTimer);
      this.notesTimer = null;
      void api.updatePattern(this.pattern);
    }
    // The click-outside dismissal is a document listener, which outlives this
    // view unless removed here.
    if (this.fabDismiss) {
      document.removeEventListener("click", this.fabDismiss);
      this.fabDismiss = null;
    }
    // A window listener outlives the element unless removed, so drop it here.
    window.removeEventListener("beforeunload", this.savePosition);
    this.marks?.detach();
    this.pins?.detach();
    this.highlight?.detach();
    this.doc?.destroy();
    // Takes this view's listeners with it, so a later reader cannot be acted
    // on by them.
    this.root?.remove();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A pattern's status as display text. Known statuses use their label; anything
 * else is shown as written, escaped, rather than interpolated raw into markup.
 */
function statusLabel(status: string): string {
  const label = STATUSES.find((s) => s.value === status)?.label ?? status.replace(/-/g, " ");
  return escapeHtml(label);
}

/** Reads one displayable value out of a pattern, by field name. */
function fieldValue(pattern: Pattern, field: string): string {
  switch (field) {
    case "Designer":
      return pattern.designer;
    case "Difficulty":
      return pattern.difficulty;
    case "Needle size":
      return pattern.needleSize;
    case "Yarn weight":
      return pattern.yarnWeight;
    case "Tags":
      return pattern.tags.join(", ");
    case "Yarn":
      return pattern.notes.includes("Yarn:") ? pattern.notes : "";
    case "Summary":
      return pattern.notes.includes("Yarn:") ? "" : pattern.notes;
    default:
      return "";
  }
}
