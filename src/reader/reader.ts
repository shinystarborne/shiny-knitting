import { ROBOT } from "../ai/describe-run";
import { api, isLive, toBytes, STATUSES, type AiSettingsView, type HighlightSettings, type Pattern, type Pin, type Project, type SuggestionResult } from "../api";
import { EpubView } from "./epub";
import { askChoice, dialogOpen, say } from "../dialogs";
import { closestEl } from "../dom";
import { HighlightLine } from "./highlight";
import { MarkLayer, MARK_COLOURS, type MarkTool } from "./marks";
import { PinLayer } from "./pins";
import { ContentsPanel } from "./contents";
import { SearchBar } from "./search";
import { PdfView, type RenderedDoc } from "./pdf";
import { RowCounter } from "./counter";
import { ProjectPanel } from "./project-panel";
import { isCapturing } from "./keys";
import { normalRotation } from "./rotation";
import { savePagesDialog } from "./save-pages-dialog";
import { scanOne } from "../ai/scan";
import { blobBytes, extractFromDocument, forgetCover, prepareBoardImage, prepareChosenImage, saveCover } from "../covers";
import { showNotice } from "../notice";

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
/**
 * A reader shown inside something else -- a project's page -- rather than as
 * its own screen. It has no way back, no layout switch and no side pane: the
 * page around it has the notes, and the row counter is the page's own,
 * handed in, so counting on either one is counting on both.
 */
export interface EmbeddedReader {
  /** The page's counter; with none, there is no line either (a pattern beside another). */
  counter?: RowCounter;
  /** Shown beside another pattern: closing it is the other reader's. */
  beside?: { close(): void };
  /** The project whose page it is on: a pin goes on its board. */
  projectId?: string;
  /** Something was put on the page's board from the pattern. */
  boardChanged?: () => void;
}

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
  /** The outline and bookmarks panel. Null until the document has loaded. */
  private contents: ContentsPanel | null = null;
  /** Search inside the PDF. Null until loaded, and for an EPUB. */
  private search: SearchBar | null = null;
  private counter: RowCounter | null = null;
  private projectPanel: ProjectPanel | null = null;
  private settings: HighlightSettings | null = null;

  /** Guards against writing a stale scroll position after the user navigates. */
  private saveTimer: number | null = null;
  /**
   * Debounces writes of the notes textarea. Separate from `saveTimer`: sharing
   * one timer meant typing then scrolling within the debounce window silently
   * discarded the pending notes write.
   */
  private notesTimer: number | null = null;
  /** Set when the reader is shown inside a project's page. */
  private embedded: EmbeddedReader | null;
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
  /** Re-reads the side pane's project, after one was saved or finished. */
  refreshProject(): void {
    void this.projectPanel?.refresh();
    // A project started or finished from here: a pin goes on the board of one being knitted.
    if (!this.embedded) void this.loadLiveProjects();
  }

  /**
   * Puts a pin's picture on a project's board, below what is there, saying
   * which pattern and page it is from: the project whose page this is, or the
   * one being knitted from this pattern -- asked which, when there are several.
   */
  private async pinToBoard(pin: Pin, picture: HTMLCanvasElement): Promise<void> {
    let projectId = this.embedded?.projectId ?? null;
    if (!projectId) {
      if (!this.liveProjects.length) {
        return void (await say("This pattern is not being knitted, so there is no project board to put it on. Start a project from it first.", "Put on the board"));
      }
      projectId =
        this.liveProjects.length === 1
          ? this.liveProjects[0].id
          : await askChoice("Which project's board?", this.liveProjects.map((p) => ({ value: p.id, label: p.name })), { title: "Put on the board" });
      if (!projectId) return;
    }
    try {
      const png = await new Promise<Blob | null>((r) => picture.toBlob(r, "image/png"));
      const prepared = png ? await prepareBoardImage(png) : null;
      if (!prepared) throw new Error("The picture of the pin could not be made.");
      const items = await api.listBoardItems(projectId).catch(() => []);
      const y = items.reduce((max, it) => Math.max(max, it.y + it.h), 0) + 40;
      const w = 420;
      const h = Math.max(40, Math.round((w * prepared.height) / prepared.width));
      const item = await api.addBoardItem(projectId, { kind: "pin", x: 40, y, w, h, data: { patternId: this.pattern.id, page: pin.page, title: pin.title || pin.quote || "" } });
      await api.setBoardImage(item.id, await blobBytes(prepared.blob));
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Put on the board"));
    }
    if (this.embedded?.boardChanged) this.embedded.boardChanged();
    else {
      const name = this.liveProjects.find((p) => p.id === projectId)?.name ?? "the project";
      showNotice(`Put on ${name}'s board.`);
    }
  }

  /** The pattern's projects on the needles, the newest started first: a pin's boards. */
  private liveProjects: Project[] = [];

  private async loadLiveProjects(): Promise<void> {
    const projects = await api.listProjects().catch(() => [] as Project[]);
    this.liveProjects = projects.filter((p) => p.patternId === this.pattern.id && isLive(p.status)).sort((a, b) => b.startedAt - a.startedAt);
  }

  get patternId(): string {
    return this.pattern.id;
  }

  constructor(screen: HTMLElement, pattern: Pattern, layout: Layout, embedded: EmbeddedReader | null = null) {
    this.screen = screen;
    this.pattern = pattern;
    this.embedded = embedded;
    // Embedded, there is no side pane to show.
    this.layout = embedded ? "focus" : layout;
  }

  async mount(): Promise<void> {
    this.renderChrome();

    const bytes = await api.readFile(this.pattern.id);
    if (this.destroyed) return;
    const data = toBytes(bytes);

    if (this.pattern.format === "epub") {
      this.doc = new EpubView(this.scroller);
    } else {
      const pdf = new PdfView(this.scroller);
      // A link out of the pattern opens in the browser, not in place of the app.
      pdf.onExternalLink = (url) =>
        void api.openLink(url).catch((e) => say(e instanceof Error ? e.message : String(e), "Link"));
      // Turned pages are known before the first paint, so a sideways chart
      // never shows sideways first. A pattern whose turns cannot be read still
      // opens, upright.
      const turns = await api.listPageRotations(this.pattern.id).catch(() => []);
      if (this.destroyed) return;
      for (const t of turns) pdf.rotations.set(t.page, normalRotation(t.rotation));
      this.doc = pdf;
    }
    // A chapter that changes height moves everything below it; a PDF page
    // repaints at a different pixel size on a zoom or a window resize. Either
    // way, marks are positioned against the page's current box and have to be
    // redrawn, and the zoom readout (a no-op for EPUB, which has none) has to
    // catch up to whatever the new scale actually is.
    this.doc.onReflow = () => {
      this.marks?.repaint();
      this.refreshZoomReadout();
      this.rememberZoom();
    };
    try {
      await this.doc.load(data);
    } catch (e) {
      if (!this.destroyed) this.showError(e);
      return;
    }
    if (this.destroyed) return;
    // As far zoomed as it was when last read, before its place is put back.
    const zoom = this.pattern.zoom ?? 1;
    if (Math.abs(zoom - 1) > 0.001) await this.doc.setZoomLevel?.(zoom);
    if (this.destroyed) return;
    // A page at a time, when it was last read so; only a PDF has pages to fit.
    if (!this.doc.setPageMode) this.root.querySelector<HTMLElement>('[data-act="page-mode"]')?.remove();
    this.bindSwipe();
    this.refreshZoomReadout();

    // The line goes with the counter, on a project's page: a pattern read on
    // its own, or beside another, is for reading and marking, not counting.
    if (this.embedded?.counter) {
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
    }

    this.marks = new MarkLayer(this.scroller, this.pattern.id, this.doc);
    this.marks.onChange = () => this.refreshMarkTools();
    this.marks.attach();
    this.marks.setTool("none");
    await this.marks.refresh();
    if (this.destroyed) return;

    const doc = this.doc;
    const pane = this.root.querySelector<HTMLElement>(".doc-pane");
    if (pane) {
      this.contents = new ContentsPanel(pane, this.pattern.id, {
        outline: () => doc.outline(),
        currentPage: () => doc.currentPage(),
        goToPage: (page) => doc.goToPage(page),
      });
      this.contents.onToggle = (open) =>
        this.root.querySelector("[data-contents-tool]")?.classList.toggle("on", open);
      if (doc.searchTexts && doc.setSearch) {
        const searchTexts = doc.searchTexts.bind(doc);
        const setSearch = doc.setSearch.bind(doc);
        this.search = new SearchBar(pane, this.scroller, {
          searchTexts,
          setSearch,
          goToPage: (page) => doc.goToPage(page),
          currentPage: () => doc.currentPage(),
          pageElement: (page) => doc.pageElement(page),
        });
        this.search.onToggle = (open) =>
          this.root.querySelector("[data-search-tool]")?.classList.toggle("on", open);
        document.addEventListener("keydown", this.onFindKey, true);
      }
    }
    this.pins = new PinLayer(this.scroller, this.pattern.id, {
      pageElement: (page) => doc.pageElement(page),
      textLayerFor: (page) => doc.textLayerFor(page),
      format: this.pattern.format,
      renderRegion: doc.renderRegion?.bind(doc),
      rotationOf: doc.rotationOf?.bind(doc),
    });
    // A pin drag is started from the mark layer, so that only one tool can be
    // active: a press that begins a crop cannot also leave a note behind.
    this.marks.onPinSelect = (e, page, pageNumber) => this.pins?.beginSelection(e, page, pageNumber);
    this.pins.onChange = () => this.refreshPinTool();
    // A pin onto a project's board: the page's project, or the one counted for.
    this.pins.toBoard = (pin, picture) => this.pinToBoard(pin, picture);
    // One crop per press of the Pin button, as in Shelfmind.
    this.pins.onCropEnd = () => this.setMarkTool("none");
    this.pins.setTray(this.root.querySelector<HTMLElement>("[data-pin-chips]"));
    await this.pins.load();
    if (this.destroyed) return;
    this.refreshPinTool();

    if (this.embedded) {
      // The page's counter, already loaded.
      this.counter = this.embedded.counter ?? null;
    } else {
      await this.loadLiveProjects();
      if (this.destroyed) return;
      const projectHost = this.root.querySelector<HTMLElement>("[data-project-panel]");
      if (projectHost) {
        this.projectPanel = new ProjectPanel(projectHost, this.pattern.id);
        void this.projectPanel.refresh();
      }
    }

    this.bindKeys();
    this.bindPositionSaving();
    this.restorePosition();
    let pages = false;
    try {
      pages = localStorage.getItem(this.pagesKey()) === "1";
    } catch {
      // Scrolling, then.
    }
    if (pages) await this.setPageMode(true);
    if (this.destroyed) return;
    // The pattern that was open beside this one, when it was left so.
    if (!this.embedded) {
      let beside: string | null = null;
      try {
        beside = localStorage.getItem(this.besideKey());
      } catch {
        // Nothing beside, then.
      }
      if (beside) await this.openBeside(beside).catch(() => this.closeBeside());
      if (this.destroyed) return;
    }

    // The toolbar opens on Select, so the common case -- reading, and removing
    // a mark by clicking it -- needs no tool chosen, and a stray drag on the
    // page draws nothing.
    this.setMarkTool("none");

    const colour = this.root.querySelector<HTMLInputElement>("[data-mark-colour]");
    colour?.addEventListener("input", () => this.marks?.setColour(colour.value));
  }

  /** The side pane: the project, notes and tags. Not shown embedded. */
  private sidePaneHtml(sidebar: boolean): string {
    return `
        <aside class="side-pane" ${sidebar ? "" : "hidden"}>
          <div class="side-section" data-project-panel></div>
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
        </aside>`;
  }

  private renderChrome(): void {
    const sidebar = this.layout === "split";
    this.root = document.createElement("div");
    const embedded = !!this.embedded;
    this.root.className = `reader ${sidebar ? "layout-split" : "layout-focus"}${embedded ? " embedded" : ""}${readerTheme() === "light" ? " light" : ""}`;
    this.root.innerHTML = `
      <header class="reader-bar">
        ${embedded ? "" : `<button class="ghost back" data-act="back">← Library</button>`}
        <div class="reader-title">
          <h2>${escapeHtml(this.pattern.title)}</h2>
          <p>
            ${this.pattern.designer ? escapeHtml(this.pattern.designer) + " · " : ""}
            ${this.pattern.status ? `<span class="pill">${statusLabel(this.pattern.status)}</span>` : ""}
            ${this.pattern.needleSize ? `<span class="pill">${escapeHtml(this.pattern.needleSize)}</span>` : ""}
            ${this.pattern.difficulty ? `<span class="pill">${escapeHtml(this.pattern.difficulty)}</span>` : ""}
          </p>
        </div>
        <div class="reader-tools">
          ${this.embedded?.counter ? `<span class="row-readout" data-row-readout
            title="Which row the highlight line is on. The count keys (J and K unless you chose others) step a row and count it."
            >${this.rowLabel}</span
          >` : ""}
          <div class="mark-tools" role="toolbar" aria-label="Marking">
            <button data-mark="none" class="ghost icon-btn" aria-label="Select" title="Select: click a mark to remove it">➤</button>
            <button data-mark="highlight" class="ghost icon-btn" aria-label="Highlight" title="Highlighter: drag over the page">🖊</button>
            <button data-mark="note" class="ghost icon-btn" aria-label="Note" title="Note: click where it belongs">🅣</button>
            <button data-mark="draw" class="ghost icon-btn" aria-label="Draw" title="Draw: drag on the page">✏️</button>
            <input type="color" data-mark-colour title="Mark colour" value="${MARK_COLOURS[0].value}" />
            <button data-act="mark-undo" class="ghost icon-btn" aria-label="Undo" title="Undo the last mark made" data-mark-undo>↶</button>
            <button data-act="mark-clear" class="ghost icon-btn" aria-label="Clear all marks" title="Remove every highlight, note and drawing on this pattern" data-mark-clear>🗑</button>
          </div>
          <div class="nav-tools" role="toolbar" aria-label="Contents">
            <button data-act="bookmark-page" class="ghost icon-btn" aria-label="Bookmark this page" title="Bookmark this page — one click, rename later">🔖</button>
            <button data-act="contents" class="ghost icon-btn" aria-label="Contents" title="Contents — outline and your bookmarks" data-contents-tool>📑</button>
          </div>
          <div class="pin-tray" role="toolbar" aria-label="Pins">
            <span class="pin-chips" data-pin-chips></span>
            <button data-mark="pin" class="ghost icon-btn" aria-label="New pin" title="Pin: drag a box around part of the page to keep it in view" data-pin-tool>📌</button>
          </div>
          ${
            this.pattern.format === "pdf"
              ? `<div class="zoom-tools" role="toolbar" aria-label="Zoom">
                  <button data-act="search" class="ghost icon-btn" aria-label="Search" title="Search in this PDF (Ctrl+F)" data-search-tool>🔎</button>
                  <button data-act="zoom-out" class="ghost icon-btn" aria-label="Zoom out" title="Zoom out (Ctrl+-)">−</button>
                  <span class="zoom-pct" data-zoom-pct>100%</span>
                  <button data-act="zoom-in" class="ghost icon-btn" aria-label="Zoom in" title="Zoom in (Ctrl+=)">+</button>
                  <button data-act="zoom-fit" class="ghost icon-btn" aria-label="Fit width" title="Fit width (Ctrl+0)">⇔</button>
                  <button data-act="page-mode" class="ghost" title="One page at a time, fitted whole: ← and →, PageUp and PageDown, or a swipe turn the page">Pages</button>
                  <button data-act="rotate" class="ghost icon-btn" aria-label="Rotate page"
                    title="Turn the page in view a quarter turn clockwise — for a chart printed sideways. Shift-click turns it back.">⟳</button>
                </div>`
              : ""
          }
          <button data-act="describe" class="ghost icon-btn" hidden aria-label="Describe with your model"
            title="Describe this pattern with your model: designer, difficulty, needles, yarn and tags">${ROBOT}</button>
          <button data-act="theme" class="ghost icon-btn" aria-label="Light or dark reading" title="${readerTheme() === "light" ? "Dark reading" : "Light reading"}">${readerTheme() === "light" ? "☾" : "☀"}</button>
          ${embedded ? "" : `<button data-act="layout" class="ghost" title="Switch layout">
            ${sidebar ? "Focus view" : "Split view"}
          </button>`}
          ${this.embedded?.counter ? `<button data-act="highlight-cfg" class="ghost" title="Highlight line settings">Line</button>` : ""}
          ${embedded ? "" : `<button data-act="beside" class="ghost" title="Open another pattern beside this one: a chart, a size table, a second pattern">Beside…</button>`}
          ${this.embedded?.beside ? `<button data-act="close-beside" class="ghost icon-btn" aria-label="Close it" title="Close the pattern beside">✕</button>` : ""}
          <button data-act="save-pages" class="ghost" title="Save some of its ${this.pattern.format === "epub" ? "chapters" : "pages"} as a PDF">Save pages…</button>
          ${embedded ? "" : `<button data-act="edit" class="ghost" title="Edit details">Details</button>`}
        </div>
      </header>
      <div class="reader-body">
        <div class="doc-pane">
          <div class="doc-scroller" tabindex="0"></div>
          <button class="page-turn prev" data-act="page-prev" aria-label="The page before" title="The page before (←)">‹</button>
          <button class="page-turn next" data-act="page-next" aria-label="The next page" title="The next page (→)">›</button>
        </div>
        ${embedded ? "" : `<div class="beside-pane" hidden></div>`}
        ${embedded ? "" : this.sidePaneHtml(sidebar)}
      </div>
      <div class="highlight-panel" hidden></div>
    `;

    this.scroller = this.root.querySelector(".doc-scroller")!;

    this.root.addEventListener("click", (e) => {
      // A click in the pattern open beside this one is that reader's own.
      if (closestEl(e.target, ".reader") !== this.root) return;
      // Marking tools first: they sit in the reader bar, which is also where
      // the other buttons are, and a tool button carries no data-act.
      const tool = closestEl(e.target, "[data-mark]");
      if (tool) {
        const kind = tool.dataset.mark as MarkTool;
        // Pressing Pin again while it is armed cancels it, as in Shelfmind.
        this.setMarkTool(kind === "pin" && this.marks?.currentTool === "pin" ? "none" : kind);
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
      if (act === "highlight-cfg") this.openHighlightPanel();
      if (act === "save-pages") void this.savePages();      if (act === "edit") {
        this.root.dispatchEvent(
          new CustomEvent("edit-pattern", { bubbles: true, detail: this.pattern }),
        );
      }
      if (act === "describe") void this.describeWithModel(btn as HTMLButtonElement);
      if (act === "cover-file") void this.chooseCover();
      if (act === "cover-reset") void this.resetCover();
      if (act === "mark-undo") void this.marks?.undoLast().then(() => this.refreshMarkTools());
      if (act === "mark-clear") void this.marks?.clearAll().then(() => this.refreshMarkTools());
      if (act === "contents") this.contents?.toggle();
      if (act === "search") this.search?.toggle();
      if (act === "bookmark-page") void this.bookmarkPage(btn as HTMLButtonElement);
      if (act === "zoom-in") this.doc?.zoomIn?.();
      if (act === "zoom-out") this.doc?.zoomOut?.();
      if (act === "zoom-fit") this.doc?.zoomToFit?.();
      if (act === "page-mode") void this.setPageMode(!this.doc?.isPageMode?.());
      if (act === "beside") void this.chooseBeside();
      if (act === "close-beside") this.embedded?.beside?.close();
      if (act === "theme") {
        const light = !this.root.classList.contains("light");
        setReaderTheme(light ? "light" : "dark");
        this.root.classList.toggle("light", light);
        btn.textContent = light ? "☾" : "☀";
        btn.title = light ? "Dark reading" : "Light reading";
      }
      if (act === "page-prev") this.doc?.turnPage?.(-1);
      if (act === "page-next") this.doc?.turnPage?.(1);
      if (act === "rotate") void this.rotatePageInView(e.shiftKey ? -90 : 90);
    });

    // The side pane is always in the DOM, so the notes keep their state; the
    // focus layout just hides it. Show it on demand via the Notes button.
    const sidePane = this.root.querySelector(".side-pane") as HTMLElement;
    if (!sidebar && sidePane) {
      const fab = document.createElement("button");
      fab.className = "counter-fab";
      fab.textContent = "Notes";
      fab.title = "Show the project and the notes";
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

    const notes = this.root.querySelector(".notes-area") as HTMLTextAreaElement | null;
    notes?.addEventListener("input", () => {
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

    // The robot is there only when describing with a model is switched on.
    void api.getAiSettings().then((ai) => {
      const robot = this.root.querySelector<HTMLElement>('[data-act="describe"]');
      if (robot) robot.hidden = !ai.enabled;
    }).catch(() => {});
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

    if (!settings.enabled) return;
    button.disabled = true;
    button.classList.add("busy");
    button.title = "Reading…";
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
      button.classList.remove("busy");
      button.title = "Describe this pattern with your model: designer, difficulty, needles, yarn and tags";
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
    if (pattern.status) parts.push(`<span class="pill">${statusLabel(pattern.status)}</span>`);
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
  /** Some of the pattern's pages, or an EPUB's chapters, saved as a PDF. */
  private async savePages(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const epub = doc instanceof EpubView ? doc : null;
    await savePagesDialog(this.pattern, {
      pageCount: doc.pageCount,
      currentPage: () => doc.currentPage(),
      chapterTitles: epub ? async () => (await epub.outline()).map((o) => o.title) : undefined,
      chapterHtml: epub ? (n) => epub.chapterHtml(n) : undefined,
    });
  }

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
      <label class="row" title="A chart is read from the bottom row up: counting a row moves the line up to the next one">
        <span>Rows go up the page (a chart)</span>
        <input type="checkbox" data-f="readsUp" ${s.readsUp ? "checked" : ""} />
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
   * The count keys (`J` and `K` unless the reader chose others) step the highlight line down or up by exactly one band and
   * count the row at the same time, which is the whole point: with the line's
   * thickness set to the on-screen height of one schematic row, each press
   * lands on the next chart row and the counter follows without a second key.
   *
   * The two modifiers separate the halves for the cases where only one should
   * move. `Shift` counts without moving, for correcting a miscount when the
   * line is already where it should be; `Alt` moves without counting, for
   * re-aligning the line after dragging it somewhere free.
   *
   * Counting up moves the line on to the next row: down the page for written
   * instructions, and up it for a chart, which is read from the bottom row up
   * (the line's "Rows go up the page" setting, kept per pattern).
   * Every counter that is switched on moves with it; the counter's own buttons
   * are for nudging one without counting a project row.
   *
   * Returns true when the key was handled.
   */
  private handleRowKey(e: KeyboardEvent): boolean {
    // The keys are the reader's own choice now (J and K unless changed), and
    // matched by physical key, so Shift and Alt do not change which key it is.
    const keys = this.counter?.countKeys ?? { up: "KeyJ", down: "KeyK" };
    if (e.code !== keys.up && e.code !== keys.down) return false;
    if (e.ctrlKey || e.metaKey) return false;
    // Typing in the counter's own inputs must not be intercepted.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return false;
    }
    const line = this.highlight;
    if (!line) return false;

    e.preventDefault();
    const direction: 1 | -1 = e.code === keys.up ? 1 : -1;

    if (!e.altKey) {
      // The counter owns the arithmetic: one action moves the project total
      // and every enabled counter, so the numbers cannot drift apart.
      void this.counter?.countRows(direction);
    }
    // A line that is switched off is not moved: it would step out of sight
    // and scroll the page under the reader for no visible reason.
    if (!e.shiftKey && line.enabled) {
      // On to the next row: down for text, up for a chart.
      line.stepRow(this.highlight?.current.readsUp ? (-direction as 1 | -1) : direction, true);
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

  /** Switches the marking tool, and paints the toolbar to show which is on. */
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
    // Says what to do while Pin is armed, since dragging over the page means
    // something different then.
    let hint = this.root.querySelector<HTMLElement>(".pin-hint");
    if (tool === "pin" && !hint) {
      hint = document.createElement("div");
      hint.className = "pin-hint";
      hint.textContent = "Drag a rectangle around the area you want to pin";
      this.root.querySelector(".doc-pane")?.appendChild(hint);
    } else if (tool !== "pin") {
      hint?.remove();
    }
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

  /**
   * Ctrl/Cmd+F opens the PDF search, as in Shelfmind and every other reader,
   * and Escape closes it while it is open -- wherever the focus is.
   *
   * Listened for on the document in the capture phase, ahead of the app's own
   * Escape (which leaves the reader). Without that, pressing Escape after
   * clicking ▲ or ▼ -- which moves the focus off the search field -- closed
   * the pattern instead of the search. An open dialog still gets its Escape
   * first.
   */
  private onFindKey = (e: KeyboardEvent): void => {
    if (!this.search || dialogOpen() || isCapturing()) return;
    if (e.key === "Escape" && this.search.isOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.search.close();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      void this.search.open();
    }
  };

  /**
   * Bookmarks the page on screen in one click, as Shelfmind's 🔖 does. The
   * button lights briefly so a click with the panel closed is not a mystery.
   */
  private async bookmarkPage(button: HTMLButtonElement): Promise<void> {
    if (!this.contents) return;
    try {
      await this.contents.bookmarkCurrentPage();
    } catch (e) {
      await say(e instanceof Error ? e.message : String(e), "Bookmark");
      return;
    }
    button.classList.add("on");
    button.title = `Bookmarked page ${this.doc?.currentPage() ?? ""} — rename it in Contents`;
    setTimeout(() => {
      button.classList.remove("on");
      button.title = "Bookmark this page — one click, rename later";
    }, 1200);
  }

  /**
   * Turns the page taking up most of the pane, and remembers it for next time.
   *
   * The page in view rather than the one at the top: with the end of one page
   * and most of the next on screen, the one being read is the second.
   */
  private async rotatePageInView(by: 90 | -90): Promise<void> {
    const pdf = this.doc instanceof PdfView ? this.doc : null;
    if (!pdf) return;
    const n = pdf.pageInView();
    let next: number;
    try {
      next = await api.setPageRotation(this.pattern.id, n, pdf.rotationOf(n) + by);
    } catch (e) {
      await say(e instanceof Error ? e.message : String(e), "Rotate page");
      return;
    }
    await pdf.rotate(n, next);
    // Pins of this page are painted the way it now shows.
    this.pins?.redraw();
  }

  /** Updates the zoom percentage readout, and disables Zoom out at the floor. */
  private zoomTimer: number | null = null;

  /** Keeps the zoom a moment after it settles, for the next time the pattern is opened. */
  private rememberZoom(): void {
    // A page fitted whole is page mode's, not the zoom the pattern is read at.
    if (this.doc?.isPageMode?.()) return;
    const zoom = this.doc?.zoomLevel?.();
    if (zoom === undefined || Math.abs(zoom - (this.pattern.zoom ?? 1)) < 0.001) return;
    if (this.zoomTimer !== null) window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => {
      this.zoomTimer = null;
      this.pattern.zoom = zoom;
      void api.saveZoom(this.pattern.id, zoom).catch(() => {});
    }, 400);
  }

  /** Another pattern open beside this one, to read the two together. */
  private beside: ReaderView | null = null;

  private besideKey(): string {
    return `beside:${this.pattern.id}`;
  }

  /** Asks which pattern, from the library, and opens it beside this one. */
  private async chooseBeside(): Promise<void> {
    const patterns = await api.listPatterns({}).catch(() => [] as Pattern[]);
    const choices = patterns
      .filter((p) => p.id !== this.pattern.id)
      .map((p) => ({ value: p.id, label: p.designer ? `${p.title} — ${p.designer}` : p.title }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!choices.length) return void (await say("There is no other pattern in the library to open beside this one.", "Beside"));
    const id = await askChoice("Which pattern, beside this one?", choices, { title: "Open beside" });
    if (id) await this.openBeside(id);
  }

  private async openBeside(id: string): Promise<void> {
    const host = this.root.querySelector<HTMLElement>(".beside-pane");
    if (!host) return;
    const pattern = await api.getPattern(id);
    if (pattern.removedAt) throw new Error("That pattern is in the Bin.");
    this.beside?.destroy();
    host.innerHTML = "";
    host.hidden = false;
    this.root.classList.add("with-beside");
    try {
      localStorage.setItem(this.besideKey(), id);
    } catch {
      // Beside for this reading only.
    }
    // Both PDFs fit their pages to the width they now have.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    this.beside = new ReaderView(host, pattern, "focus", { beside: { close: () => this.closeBeside() } });
    await this.beside.mount();
    // Laid out before its column had its width: fitted again, now that it has.
    window.dispatchEvent(new Event("resize"));
  }

  private closeBeside(): void {
    this.beside?.destroy();
    this.beside = null;
    const host = this.root.querySelector<HTMLElement>(".beside-pane");
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
    }
    this.root.classList.remove("with-beside");
    try {
      localStorage.removeItem(this.besideKey());
    } catch {
      // Nothing kept.
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  private pagesKey(): string {
    return `pages:${this.pattern.id}`;
  }

  /** One page at a time, or the pages in a scroll; remembered for the pattern. */
  private async setPageMode(on: boolean): Promise<void> {
    if (!this.doc?.setPageMode) return;
    await this.doc.setPageMode(on);
    this.root.querySelector('[data-act="page-mode"]')?.classList.toggle("on", on);
    this.root.querySelector(".doc-pane")?.classList.toggle("page-mode", on);
    try {
      if (on) localStorage.setItem(this.pagesKey(), "1");
      else localStorage.removeItem(this.pagesKey());
    } catch {
      // Remembered for this reading only.
    }
    this.refreshZoomReadout();
    this.scroller.focus();
  }

  /** A swipe sideways turns the page: a trackpad's two fingers, or a finger on a screen. */
  private bindSwipe(): void {
    let sideways = 0;
    let resting = 0;
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        if (!this.doc?.isPageMode?.() || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        if (Date.now() < resting) return;
        sideways += e.deltaX;
        if (Math.abs(sideways) > 60) {
          this.doc.turnPage?.(sideways > 0 ? 1 : -1);
          sideways = 0;
          resting = Date.now() + 450;
        }
      },
      { passive: false },
    );
    let from: { x: number; y: number } | null = null;
    this.scroller.addEventListener("pointerdown", (e) => {
      from = e.pointerType === "touch" && this.doc?.isPageMode?.() ? { x: e.clientX, y: e.clientY } : null;
    });
    this.scroller.addEventListener("pointerup", (e) => {
      if (!from) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      from = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.doc?.turnPage?.(dx < 0 ? 1 : -1);
    });
  }

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

  private bindKeys(): void {
    this.scroller.addEventListener("keydown", (e) => {
      // Zoom first, and only with a modifier: plain +/-/0 are the counter's
      // own keys, and Ctrl/Cmd is also the combination every other app uses
      // for zoom, so it is the one combination guaranteed not to collide.
      if ((e.ctrlKey || e.metaKey) && this.handleZoomKey(e)) return;

      // A page at a time: the arrows and PageUp/PageDown turn the page.
      if (this.doc?.isPageMode?.() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const turn = { ArrowRight: 1, ArrowLeft: -1, PageDown: 1, PageUp: -1 }[e.key] as 1 | -1 | undefined;
        if (turn) {
          e.preventDefault();
          this.doc.turnPage?.(turn);
          return;
        }
      }

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
      // The release of a text selection also arrives as a click, and parking
      // the line there would move it to wherever the reader just finished
      // selecting words to highlight -- not somewhere they asked it to go.
      if (window.getSelection()?.toString()) return;
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
    this.beside?.destroy();
    this.beside = null;
    clearTimeout(this.saveTimer ?? undefined);
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
    this.contents?.close();
    this.search?.close();
    document.removeEventListener("keydown", this.onFindKey, true);
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

const THEME_KEY = "reader-theme";

/**
 * Light or dark reading, for every pattern: a preference rather than pattern
 * data, so it lives in local storage, as the counting sound does.
 */
function readerTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function setReaderTheme(theme: "light" | "dark"): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Light for this reading only.
  }
}
