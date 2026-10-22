import "./styles.css";
import { open } from "@tauri-apps/plugin-dialog";
import { clock, isPaused, sessionMs } from "./views/knit-time";
import { installAutoTimer, noteActivity, stopIfLeft } from "./auto-timer";
import { api, toBytes, type AiSettingsView, type KnitSession, type Pattern, type Project, type ScannedFile, type Shop, type Swatch, type Tool, type UpdateInfo, type Wish, type Yarn } from "./api";
import { LibraryView } from "./views/library";
import { StashView } from "./views/stash";
import { ToolsView } from "./views/tools";
import { ToolSetsDialog } from "./views/tool-sets";
import { ToolForm } from "./views/tool-form";
import { WishlistView } from "./views/wishlist";
import { WishForm, type WishTemplate } from "./views/wish-form";
import { ShopsView } from "./views/shops";
import { ShopForm } from "./views/shop-form";
import { shopTagFacets, toolStart, yarnStart, type WishFilter } from "./views/shopping";
import { ProjectsView } from "./views/projects";
import { ProjectForm, type ProjectPreset } from "./views/project-form";
import { FinishProjectDialog } from "./views/finish-project";
import { ProjectPage } from "./views/project-page";
import { InspirationPage, InspirationView } from "./views/inspiration";
import { PeopleView, PersonPage } from "./views/people";
import { SwatchesView, type StashMode } from "./views/swatches";
import { StashHistoryView } from "./views/stash-history";
import { StashStatsView } from "./views/stash-stats";
import { CalculatorsView, leaveProject, openCalculatorFor, openCalculatorsOn, takeChartReturn } from "./views/calculators";
import { ChartPage } from "./views/charts";
import { SwatchForm, type SwatchTemplate } from "./views/swatch-form";
import { PatternForm } from "./views/pattern-form";
import { YarnForm } from "./views/yarn-form";
import { runBulkAdd } from "./views/bulk-add";
import { SettingsDialog } from "./views/settings";
import { clearBoardImageCache, clearCoverCache, clearSwatchPhotoCache, clearWishPhotoCache, clearYarnPhotoCache, ensureCover } from "./covers";
import { askYesNo, say } from "./dialogs";
import { closestEl } from "./dom";
import { ReaderView, type Layout } from "./reader/reader";
import { CheatsheetsView } from "./views/cheatsheets";
import { MasterclassesView } from "./views/masterclasses";
import { RavelryView } from "./views/ravelry";
import { ChartPicturesView } from "./views/chart-pictures";
import { HIDDEN_TABS_EVENT, TABS, hiddenTabs, type Tab } from "./tabs";

/**
 * App shell. A tab bar picks the top-level screen — Patterns, Projects,
 * People, Calculators, Inspiration, Stash, Needles & hooks, Wishlist or Shops — with Settings as a
 * gear at its right end, and the reader covers the Patterns tab when a
 * pattern is open.
 * The current layout choice is remembered for the session.
 */

const GEAR = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 .05-.94 7.07 7.07 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.03 7.03 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.61.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54a7.03 7.03 0 0 0 1.63-.94l2.39.96c.22.09.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>`;
class App {
  private root: HTMLElement;
  private tabBar!: HTMLElement;
  private screen!: HTMLElement;
  private modal!: HTMLElement;

  private activeReader: ReaderView | null = null;
  /** The project page on screen, so a dialog saved over it can refresh it. */
  private activeProjectPage: ProjectPage | null = null;
  /** The inspiration board on screen, so leaving it saves what is being typed. */
  private activeInspirationPage: InspirationPage | null = null;
  /** Which the Stash tab shows: the yarn, or the swatches. Kept while the app is open. */
  private stashMode: StashMode = "yarn";
  /** The person on screen, so leaving saves what is being typed. */
  private activePersonPage: PersonPage | null = null;
  /** The chart on screen, so leaving saves what was drawn last. */
  private activeChartPage: ChartPage | null = null;
  /** The mounted library, so background work can ask it to repaint a card. */
  private activeLibrary: LibraryView | null = null;
  /** The wishlist or shops on screen, so a form saved over them keeps their filters. */
  private activeWishlist: WishlistView | null = null;
  private activeShops: ShopsView | null = null;
  private activeCheatsheets: CheatsheetsView | null = null;
  private activeMasterclasses: MasterclassesView | null = null;
  private activeRavelry: RavelryView | null = null;
  private activeChartPictures: ChartPicturesView | null = null;
  private layout: Layout = "split";

  /**
   * Incremented on every navigation. Showing a screen is async (reading a
   * file, rendering pages), so two rapid clicks would otherwise interleave:
   * the slower, older one could finish last and overwrite the newer screen.
   * Each navigation captures this value and bails if it is no longer current.
   */
  private navToken = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    // The tab bar is a fixed-height sibling above the screen; #app is a flex
    // column, so the screen keeps its own class and its flex/min-height chain
    // exactly as it was, and the scrolling panes are none the wiser.
    this.tabBar = document.createElement("nav");
    this.tabBar.className = "tab-bar";
    this.tabBar.innerHTML = `
      ${TABS.map((t) => `<button class="tab${t.tab === "patterns" ? " active" : ""}" data-tab="${t.tab}">${escapeText(t.label)}</button>`).join("")}
      <span class="tab-spacer"></span>
      <button class="timer-pill" data-act="timer" hidden title="Timer running: open its project"></button>
      <button class="timer-stop" data-act="timer-pause" hidden title="Pause: the break is not counted" aria-label="Pause the timer">⏸</button>
      <button class="timer-stop" data-act="timer-stop" hidden title="Stop the timer" aria-label="Stop the timer">■</button>
      <button class="tab-gear" data-act="settings" title="Settings" aria-label="Settings">${GEAR}</button>
    `;
    this.screen = document.createElement("div");
    this.screen.className = "screen";
    this.modal = document.createElement("div");
    this.modal.className = "modal-backdrop hidden";

    this.root.append(this.tabBar, this.screen, this.modal);

    this.tabBar.addEventListener("click", (e) => {
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "settings") {
        void this.openSettings();
        return;
      }
      if (act === "timer" && this.timer) {
        // On its project already: the timer itself, shown.
        const id = this.timer.session.projectId;
        if (this.activeProjectPage?.id === id) this.activeProjectPage.showTimer();
        else void this.showProjectPage(id);
        return;
      }
      if (act === "timer-pause" && this.timer) {
        // As it is now, not as last painted: paused or not may have changed elsewhere.
        void api
          .runningKnitSession()
          .then(async (running) => {
            if (!running) return;
            const paused = isPaused(running);
            await (paused ? api.resumeKnitting() : api.pauseKnitting());
            if (paused) noteActivity(running.projectId);
            document.dispatchEvent(new CustomEvent("knit-timer"));
          })
          .catch((err) => say(err instanceof Error ? err.message : String(err), "Knitting time"));
        return;
      }
      if (act === "timer-stop") {
        void api
          .stopKnitting()
          .then(() => document.dispatchEvent(new CustomEvent("knit-timer")))
          .catch((err) => say(err instanceof Error ? err.message : String(err), "Knitting time"));
        return;
      }
      if (act === "update-available") {
        void this.updateNow(closestEl(e.target, "button[data-act]") as HTMLButtonElement);
        return;
      }
      const tab = closestEl(e.target, "button[data-tab]");
      if (!tab) return;
      void this.showTab(tab.dataset.tab as Tab);
    });

    // Reading events bubble up from whichever view is on screen.
    // Back from a pattern: to the library, or the first tab while Patterns is hidden.
    this.screen.addEventListener("navigate-back", () => void this.showTab(this.hidden.has("patterns") ? this.firstTab() : "patterns"));
    this.screen.addEventListener("change-layout", (e) => {
      this.layout = (e as CustomEvent<Layout>).detail;
      // Re-render the reader in the new layout rather than dropping back to
      // the library; changing view should not cost you your place.
      const id = this.activeReader?.patternId;
      if (id) {
        void this.showReader(id);
      } else {
        void this.showLibrary();
      }
    });
    // From the Books tab, what is added is a book.
    const asBook = (e: Event) => !!(e as CustomEvent<{ book?: boolean } | null>).detail?.book;
    this.screen.addEventListener("add-pattern", (e) => this.openForm(null, asBook(e) ? ["book"] : []));
    this.screen.addEventListener("add-folder", (e) => void this.addFolder(asBook(e)));
    this.screen.addEventListener("open-pattern", (e) => {
      void this.showReader((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("show-cheatsheets", () => void this.showCheatsheets());
    // A project started from a masterclass: named after it, knitted along with it.
    this.screen.addEventListener("start-project-from-masterclass", (e) => {
      const { id, title, patternId } = (e as CustomEvent<{ id: string; title: string; patternId?: string }>).detail;
      void this.openProjectForm(null, patternId || null, { name: title, masterclassId: id });
    });
    // A cheatsheet's pages, in their book.
    this.screen.addEventListener("open-pattern-at", (e) => {
      const { id, page } = (e as CustomEvent<{ id: string; page: number }>).detail;
      void this.showReader(id).then(() => this.activeReader?.patternId === id && this.activeReader.goTo(page));
    });
    this.screen.addEventListener("edit-pattern", (e) => {
      this.openForm((e as CustomEvent<Pattern>).detail);
    });
    // The details, from a card's ⋯ menu: saved, the library stays where it was.
    this.screen.addEventListener("edit-pattern-here", (e) => {
      const pattern = (e as CustomEvent<Pattern>).detail;
      const form = new PatternForm(this.freshModal(), pattern, (saved) => void this.activeLibrary?.refreshPattern(saved.id));
      form.open();
    });
    this.screen.addEventListener("add-yarn", (e) => {
      // A yarn in the detail is one to add another colour of.
      this.openYarnForm(null, (e as CustomEvent<Yarn | undefined>).detail ?? null);
    });
    this.screen.addEventListener("edit-yarn", (e) => {
      this.openYarnForm((e as CustomEvent<Yarn>).detail);
    });
    this.screen.addEventListener("add-project", (e) => {
      const detail = (e as CustomEvent<ProjectPreset>).detail ?? {};
      void this.openProjectForm(null, detail.patternId ?? null, detail);
    });
    // A timer started or stopped anywhere: the tab bar says so.
    // Heard on the document: started or stopped on a page, or by the row counter.
    document.addEventListener("knit-timer", () => void this.refreshTimer());
    installAutoTimer();
    void this.refreshTimer();
    this.screen.addEventListener("open-project-page", (e) => {
      void this.showProjectPage((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("stash-mode", (e) => {
      const mode = (e as CustomEvent<string>).detail;
      this.stashMode = mode === "swatches" || mode === "history" || mode === "stats" ? mode : "yarn";
      void this.showStash();
    });
    this.screen.addEventListener("add-swatch", (e) => {
      void this.openSwatchForm(null, (e as CustomEvent<SwatchTemplate | undefined>).detail ?? {});
    });
    this.screen.addEventListener("edit-swatch", (e) => {
      void this.openSwatchForm((e as CustomEvent<Swatch>).detail);
    });
    this.screen.addEventListener("open-person", (e) => {
      void this.showPersonPage((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("open-chart", (e) => {
      void this.showChartPage((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("open-inspiration", (e) => {
      void this.showInspirationPage((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("edit-project", (e) => {
      void this.editProject((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("add-tool", () => void this.openToolForm(null));
    this.screen.addEventListener("open-tool-sets", () => {
      void new ToolSetsDialog(this.freshModal(), () => void this.showTools()).open();
    });
    this.screen.addEventListener("edit-tool", (e) => {
      void this.openToolForm((e as CustomEvent<Tool>).detail);
    });
    this.screen.addEventListener("add-wish", (e) => {
      void this.openWishForm(null, (e as CustomEvent<WishTemplate | undefined>).detail ?? {});
    });
    this.screen.addEventListener("edit-wish", (e) => {
      void this.openWishForm((e as CustomEvent<Wish>).detail);
    });
    this.screen.addEventListener("open-wishlist", (e) => {
      void this.showWishlist((e as CustomEvent<WishFilter | undefined>).detail ?? {});
    });
    this.screen.addEventListener("stash-wish", (e) => {
      void this.stashWish((e as CustomEvent<Wish>).detail);
    });
    this.screen.addEventListener("add-shop", () => void this.openShopForm(null));
    this.screen.addEventListener("edit-shop", (e) => {
      void this.openShopForm((e as CustomEvent<Shop>).detail);
    });
    this.screen.addEventListener("open-settings", (e) => {
      void this.openSettings((e as CustomEvent<AiSettingsView | undefined>).detail);
    });
    // The reader still dispatches the old name from its single-pattern
    // Describe flow; both names open the same dialog.
    this.screen.addEventListener("open-ai-settings", (e) => {
      void this.openSettings((e as CustomEvent<AiSettingsView | undefined>).detail);
    });

    document.addEventListener("keydown", (e) => {
      // Escape backs out of a form or leaves the reader.
      if (e.key === "Escape") {
        if (!this.modal.classList.contains("hidden")) {
          this.freshModal();
        } else if (this.activeReader) {
          void this.showLibrary();
        }
      }
    });

    await this.applyHiddenTabs();
    await this.showTab(this.firstTab());
    // The update check runs once the library is up, and again every hour
    // while the app is open, so a release made meanwhile still shows. It
    // never blocks anything, and a failure says nothing.
    void this.runStartupUpdateCheck();
    window.setInterval(() => void this.runStartupUpdateCheck(), UPDATE_CHECK_EVERY_MS);
  }

  /**
   * The daily update check. Only a found update surfaces, as a button beside
   * the settings gear; "skipped" and errors both show nothing. Public so the
   * browser harness can re-run it after seeding a release.
   */
  async runStartupUpdateCheck(): Promise<void> {
    try {
      const outcome = await api.startupUpdateCheck();
      if (outcome.skipped || !outcome.update) return;
      this.pendingUpdate = outcome.update;
      this.showUpdateNotice(outcome.update.tag);
      this.showUpdateCard(outcome.update);
    } catch {
      // A failed check is a missed convenience, never an interruption.
    }
  }

  /** The update the startup check found, for the notice to install. */
  private pendingUpdate: UpdateInfo | null = null;
  /** The knitting being timed, and its project's name, while a timer runs. */
  private timer: { session: KnitSession; name: string } | null = null;
  private timerTick: number | null = null;

  /**
   * The timer in the tab bar: the project being timed and for how long, a
   * second at a time, wherever the app is. Read again every half minute, so a
   * timer stopped by finishing its project goes too.
   */
  async refreshTimer(): Promise<void> {
    const session = await api.runningKnitSession().catch(() => null);
    const pill = this.tabBar.querySelector<HTMLElement>('[data-act="timer"]');
    const stop = this.tabBar.querySelector<HTMLElement>('[data-act="timer-stop"]');
    const pause = this.tabBar.querySelector<HTMLElement>('[data-act="timer-pause"]');
    if (!pill || !stop || !pause) return;
    // Left thirty minutes without a row counted, where the counter keeps it: stopped, and said again.
    if (session && (await stopIfLeft(session))) return;
    if (!session) {
      this.timer = null;
      pill.hidden = true;
      stop.hidden = true;
      pause.hidden = true;
      if (this.timerTick !== null) window.clearInterval(this.timerTick);
      this.timerTick = null;
      return;
    }
    const project = (await api.listProjects().catch(() => [] as Project[])).find((p) => p.id === session.projectId);
    this.timer = { session, name: project?.name ?? "A project" };
    // The name in its tooltip: the tab bar has no room for it.
    pill.title = `Knitting ${this.timer.name}: open it`;
    const paint = () => {
      if (!this.timer) return;
      const paused = isPaused(this.timer.session);
      pill.textContent = `${paused ? "⏸" : "⏱"} ${clock(sessionMs(this.timer.session))}`;
      pill.classList.toggle("paused", paused);
      pill.title = `${paused ? "Paused: " : "Knitting "}${this.timer.name}: open it`;
    };
    paint();
    const paused = isPaused(session);
    pause.textContent = paused ? "▶" : "⏸";
    pause.title = paused ? "Resume the same session" : "Pause: the break is not counted";
    pause.setAttribute("aria-label", paused ? "Go on with the timer" : "Pause the timer");
    pill.hidden = false;
    stop.hidden = false;
    pause.hidden = false;
    if (this.timerTick === null) {
      let n = 0;
      this.timerTick = window.setInterval(() => {
        paint();
        if (++n % 30 === 0) void this.refreshTimer();
      }, 1000);
    }
  }
  /** The versions already announced this session, so "Later" means later. */
  private announced = new Set<string>();

  /**
   * The card that says so: in the corner, over whatever is on screen, once
   * per version per session. Update now updates; Later leaves the button by
   * the gear for when it suits.
   */
  private showUpdateCard(update: UpdateInfo): void {
    if (this.announced.has(update.tag)) return;
    this.announced.add(update.tag);
    document.querySelector(".update-card")?.remove();
    const card = document.createElement("div");
    card.className = "update-card";
    card.setAttribute("role", "status");
    card.innerHTML = `
      <div class="update-card-head">
        <strong>A new version is ready</strong>
        <button class="ghost" data-act="later" aria-label="Later" title="Later: the button by the gear stays available">×</button>
      </div>
      <p>${escapeText(update.name || update.tag)}${update.prerelease ? " <span class=\"pill\">beta</span>" : ""}</p>
      <p class="hint">Installs in place and reopens. The library is not affected.</p>
      <div class="update-card-actions">
        ${update.pageUrl ? `<button class="link" data-act="notes">What's new</button>` : ""}
        <span class="spacer"></span>
        <button class="ghost" data-act="later">Later</button>
        <button class="primary" data-act="update">Update now</button>
      </div>`;
    card.addEventListener("click", (e) => {
      const btn = closestEl(e.target, "button[data-act]") as HTMLButtonElement | null;
      const act = btn?.dataset.act;
      if (act === "later") card.remove();
      if (act === "notes") void api.openLink(update.pageUrl).catch(() => {});
      if (act === "update" && btn) {
        card.remove();
        const notice = this.tabBar.querySelector<HTMLButtonElement>('[data-act="update-available"]');
        void this.updateNow(notice ?? btn);
      }
    });
    document.body.appendChild(card);
  }

  /**
   * One click from the notice: asks, downloads, and hands over to the
   * installer, which updates in place without questions and opens the app
   * again. Nothing to uninstall, nothing to click through.
   */
  private async updateNow(button: HTMLButtonElement): Promise<void> {
    const update = this.pendingUpdate;
    if (!update) return void this.openSettings();
    const ok = await askYesNo(
      `Update to ${update.name}${update.prerelease ? " (beta)" : ""} now?\n\n` +
        "It downloads, then the app closes, updates and reopens. " +
        "Patterns, stash and projects are not affected.",
      { title: "Update", okLabel: "Update now" },
    );
    if (!ok) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Downloading…";
    try {
      const path = await api.downloadUpdate({ assetApiUrl: update.assetApiUrl, fileName: update.assetName });
      button.textContent = "Updating…";
      await api.installUpdate({ path });
    } catch (err) {
      button.disabled = false;
      button.textContent = label;
      await say(`The update could not be installed.\n\n${err instanceof Error ? err.message : String(err)}`, "Update");
    }
  }

  /**
   * "Update available", beside the gear, on every tab. Clicking it updates,
   * after asking. A second check adds no second one.
   */
  private showUpdateNotice(tag: string): void {
    if (this.tabBar.querySelector('[data-act="update-available"]')) return;
    const button = document.createElement("button");
    button.className = "ghost tab-update";
    button.dataset.act = "update-available";
    button.title = `${tag} is available. Click to update.`;
    button.textContent = "Update available";
    this.tabBar.querySelector(".tab-gear")?.before(button);
  }

  /**
   * Swaps in a new, empty modal element, and returns it.
   *
   * Every dialog is drawn into the one modal element, and each attaches its
   * listeners to it. A dialog closed some way other than its own close() --
   * Escape, which empties the element from here -- left those listeners on
   * it, still answering clicks in whichever dialog came next. A new element
   * per dialog means nothing from an earlier one can be listening.
   */
  private freshModal(): HTMLElement {
    const fresh = document.createElement("div");
    fresh.className = "modal-backdrop hidden";
    this.modal.replaceWith(fresh);
    this.modal = fresh;
    return fresh;
  }

  private clearScreen(): void {
    this.activeReader?.destroy();
    this.activeReader = null;
    this.activeProjectPage?.destroy();
    this.activeProjectPage = null;
    this.activeInspirationPage?.destroy();
    this.activeInspirationPage = null;
    this.activePersonPage?.destroy();
    this.activePersonPage = null;
    this.activeChartPage?.destroy();
    this.activeChartPage = null;
    this.activeCheatsheets?.destroy();
    this.activeCheatsheets = null;
    this.activeMasterclasses?.destroy();
    this.activeMasterclasses = null;
    this.activeRavelry?.destroy();
    this.activeRavelry = null;
    this.activeChartPictures?.destroy();
    this.activeChartPictures = null;
    clearBoardImageCache();
    this.activeLibrary = null;
    this.activeWishlist = null;
    this.activeShops = null;
    this.screen.innerHTML = "";
    // Cover and photo object URLs are tied to the elements that showed them.
    clearCoverCache();
    clearYarnPhotoCache();
    clearWishPhotoCache();
    clearSwatchPhotoCache();
  }

  /** Marks the tab that owns the current screen; the reader counts as Patterns. */
  /** The tab on screen, so a dialog saved over it can bring it up to date. */
  private currentTab: Tab = "patterns";

  /** The tabs hidden in Settings: not in the tab bar, and nothing from them added to a board. */
  private hidden = new Set<Tab>();

  /** Reads which tabs are hidden and takes them out of the tab bar. */
  private async applyHiddenTabs(): Promise<void> {
    this.hidden = await hiddenTabs();
    for (const tab of this.tabBar.querySelectorAll<HTMLElement>(".tab")) {
      tab.hidden = this.hidden.has(tab.dataset.tab as Tab);
    }
  }

  /** The tab the app opens on: Patterns, or the first one not hidden. */
  private firstTab(): Tab {
    return TABS.find((t) => !this.hidden.has(t.tab))?.tab ?? "patterns";
  }

  private async showTab(tab: Tab): Promise<void> {
    if (tab === "inspiration") await this.showInspiration();
    else if (tab === "stash") await this.showStash();
    else if (tab === "tools") await this.showTools();
    else if (tab === "wishlist") await this.showWishlist();
    else if (tab === "shops") await this.showShops();
    else if (tab === "people") await this.showPeople();
    else if (tab === "calculators") {
      leaveProject();
      await this.showCalculators();
    } else if (tab === "charts") await this.showChartPictures();
    else if (tab === "cheatsheets") await this.showCheatsheets();
    else if (tab === "masterclasses") await this.showMasterclasses();
    else if (tab === "ravelry") await this.showRavelry();
    else if (tab === "projects") await this.showProjects();
    else await this.showLibrary();
  }

  private setActiveTab(name: Tab): void {
    this.currentTab = name;
    for (const tab of this.tabBar.querySelectorAll<HTMLElement>(".tab")) {
      tab.classList.toggle("active", tab.dataset.tab === name);
    }
  }

  private async showLibrary(): Promise<void> {
    // The library has no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("patterns");
    const view = new LibraryView(this.screen);
    this.activeLibrary = view;
    await view.mount();
  }

  private async showStash(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("stash");
    if (this.stashMode === "swatches") await new SwatchesView(this.screen).mount();
    else if (this.stashMode === "history") await new StashHistoryView(this.screen).mount();
    else if (this.stashMode === "stats") await new StashStatsView(this.screen).mount();
    else await new StashView(this.screen).mount();
  }

  private async showProjects(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("projects");
    const view = new ProjectsView(this.screen);
    await view.mount();
  }

  private async showProjectPage(id: string): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    this.setActiveTab("projects");
    const page = new ProjectPage(this.screen, id, {
      back: () => void this.showProjects(),
      openPattern: (patternId) => void this.showReader(patternId),
      editLinks: (project) => void this.openProjectForm(project, null),
      finish: (project) => void this.openFinish(project),
      removed: () => void this.showProjects(),
      openChart: (chartId) => void this.showChartPage(chartId, { label: "← The project", go: () => void this.showProjectPage(id) }),
      openCalculator: (calc, project) => {
        openCalculatorFor(calc, project);
        void this.showCalculators();
      },
    });
    this.activeProjectPage = page;
    await page.mount();
    if (token !== this.navToken) page.destroy();
  }

  private async showInspiration(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("inspiration");
    const view = new InspirationView(this.screen);
    await view.mount();
  }

  private async showPeople(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("people");
    await new PeopleView(this.screen).mount();
  }

  private async showCalculators(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("calculators");
    await new CalculatorsView(this.screen).mount();
  }

  private async showChartPictures(): Promise<void> {
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("charts");
    const view = new ChartPicturesView(this.screen);
    this.activeChartPictures = view;
    await view.mount();
  }

  private async showCheatsheets(): Promise<void> {
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("cheatsheets");
    const view = new CheatsheetsView(this.screen);
    this.activeCheatsheets = view;
    await view.mount();
  }

  private async showMasterclasses(): Promise<void> {
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("masterclasses");
    const view = new MasterclassesView(this.screen);
    this.activeMasterclasses = view;
    await view.mount();
  }

  private async showRavelry(): Promise<void> {
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("ravelry");
    const view = new RavelryView(this.screen);
    this.activeRavelry = view;
    await view.mount();
  }

  private async showChartPage(id: string, back?: { label: string; go: () => void }): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    this.setActiveTab("calculators");
    // Opened from the round yoke calculator, it goes back there; from a project's board, there.
    const from = takeChartReturn();
    const page = new ChartPage(this.screen, id, {
      back: () => {
        if (back) return back.go();
        openCalculatorsOn(from);
        void this.showCalculators();
      },
      backLabel: back?.label ?? (from === "yoke" ? "← Round yoke" : "← Charts"),
    });
    this.activeChartPage = page;
    await page.mount();
    if (token !== this.navToken) page.destroy();
  }

  private async showPersonPage(id: string): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    this.setActiveTab("people");
    const page = new PersonPage(this.screen, id, {
      back: () => void this.showPeople(),
      openProject: (projectId) => void this.showProjectPage(projectId),
    });
    this.activePersonPage = page;
    await page.mount();
    if (token !== this.navToken) page.destroy();
  }

  private async showInspirationPage(id: string): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    this.setActiveTab("inspiration");
    const page = new InspirationPage(this.screen, id, {
      back: () => void this.showInspiration(),
      openPattern: (patternId) => void this.showReader(patternId),
    });
    this.activeInspirationPage = page;
    await page.mount();
    if (token !== this.navToken) page.destroy();
  }

  private async showTools(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("tools");
    const view = new ToolsView(this.screen);
    await view.mount();
  }

  private async showWishlist(filter: WishFilter = {}): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("wishlist");
    const view = new WishlistView(this.screen, filter);
    this.activeWishlist = view;
    await view.mount();
  }

  private async showShops(): Promise<void> {
    // As the library: no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    this.setActiveTab("shops");
    const view = new ShopsView(this.screen);
    this.activeShops = view;
    await view.mount();
  }

  private async showReader(id: string): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    let pattern: Pattern;
    try {
      pattern = await api.getPattern(id);
    } catch (error) {
      // The pattern may be gone — deleted while a stale card still showed it.
      // The screen was already cleared, so leave a message and go back to the
      // library rather than stranding the user on a blank screen.
      if (token !== this.navToken) return;
      const detail = error instanceof Error ? error.message : String(error);
      await say(`That pattern could not be opened. It may have been removed.\n\n${detail}`);
      if (token !== this.navToken) return;
      await this.showLibrary();
      return;
    }
    // A newer navigation started while this one was fetching; abandon it
    // rather than clobbering the screen it is replacing.
    if (token !== this.navToken) return;

    this.setActiveTab("patterns");
    const reader = new ReaderView(this.screen, pattern, this.layout);
    this.activeReader = reader;
    await reader.mount();
  }

  private openForm(pattern: Pattern | null, startTags: string[] = []): void {
    const form = new PatternForm(this.freshModal(), pattern, (saved) => {
      if (pattern) {
        // Re-open the reader so metadata edits show immediately.
        void this.showReader(saved.id);
      } else {
        // A new pattern gets a cover taken from its own file, in the
        // background, so the library shows something without a wait.
        void this.addCoverInBackground(saved);
        void this.showLibrary();
      }
    }, startTags);
    form.open();
  }

  private openYarnForm(yarn: Yarn | null, template: Yarn | null = null): void {
    const form = new YarnForm(this.freshModal(), yarn, () => {
      // A save re-mounts the stash, so the card picks up the new figures and
      // any photo the form uploaded afterwards.
      void this.showStash();
    }, template);
    form.swatchHooks = {
      open: (swatch) => void this.openSwatchForm(swatch),
      add: (y) => void this.openSwatchForm(null, { yarnId: y.id }),
    };
    form.open();
  }

  /**
   * A swatch's form, from the swatches, a yarn's form, or anywhere else. A
   * save brings the stash up to date when it is on screen, for the swatch
   * itself and the line on its yarn's card.
   */
  private async openSwatchForm(swatch: Swatch | null, template: SwatchTemplate = {}): Promise<void> {
    const form = new SwatchForm(
      this.freshModal(),
      swatch,
      () => {
        if (this.currentTab === "stash") void this.showStash();
      },
      template,
      {
        openYarn: (yarnId) =>
          void api
            .getYarn(yarnId)
            .then((yarn) => this.openYarnForm(yarn))
            .catch(() => say("That yarn is no longer in the stash.")),
      },
    );
    await form.open();
  }

  private async editProject(id: string): Promise<void> {
    const project = (await api.listProjects().catch(() => [] as Project[])).find((p) => p.id === id);
    if (!project) {
      await say("This project no longer exists.");
      return;
    }
    await this.openProjectForm(project, null);
  }

  private async openProjectForm(project: Project | null, patternId: string | null, preset: ProjectPreset = {}): Promise<void> {
    const form = new ProjectForm(this.freshModal(), project, { ...preset, patternId }, {
      onDone: (saved) => {
        // A new plan joins the plans, wherever it was made.
        if (!project && saved?.status === "planned") {
          if (this.currentTab === "projects") void this.showProjects();
          else this.afterProjectChange();
          if (saved.patternId) void this.activeLibrary?.refreshPattern(saved.patternId);
          return;
        }
        // A project started from the Projects tab opens on its own page,
        // ready for its board; one started from a pattern stays with it.
        if (!project && saved && (this.currentTab === "projects" || preset.masterclassId) && !this.activeProjectPage) void this.showProjectPage(saved.id);
        else this.afterProjectChange();
        // A project started from a card puts that pattern in progress; its card says so.
        if (saved?.patternId) void this.activeLibrary?.refreshPattern(saved.patternId);
      },
      onFinish: (saved) => void this.openFinish(saved),
    });
    await form.open();
  }

  private async openFinish(project: Project): Promise<void> {
    const dialog = new FinishProjectDialog(this.freshModal(), project, () => this.afterProjectChange());
    await dialog.open();
  }

  /**
   * Brings whatever is on screen up to date after a project was saved,
   * finished or removed: what is in use has changed under it. The reader only
   * re-reads its project pane, so the page and place are not lost.
   */
  private afterProjectChange(): void {
    if (this.activeReader) {
      this.activeReader.refreshProject();
      return;
    }
    if (this.activeProjectPage) {
      void this.activeProjectPage.refresh();
      return;
    }
    if (this.currentTab === "projects") void this.showProjects();
    else if (this.currentTab === "tools") void this.showTools();
    else if (this.currentTab === "stash") void this.showStash();
  }

  private async openToolForm(tool: Tool | null): Promise<void> {
    // Every save re-mounts the tab behind the form, so the grid and its
    // counts are current -- including after "Save and add another", whose
    // form stays open over it.
    const form = new ToolForm(this.freshModal(), tool, () => void this.showTools());
    await form.open();
  }

  private async openWishForm(wish: Wish | null, template: WishTemplate = {}): Promise<void> {
    // The list behind is read again on every save, "Save and add another"
    // included, so what was added shows under the form as it is added. A shop
    // added from the form is new on the Shops tab when it is next opened.
    const form = new WishForm(this.freshModal(), wish, () => void this.activeWishlist?.reload(), template);
    await form.open();
  }

  /**
   * Yarn or needles got from the wishlist, into the stash or Needles & hooks:
   * the form opens filled in from the item, its picture included, and saving
   * it marks the item as in the stash. The wishlist stays on screen behind.
   */
  private async stashWish(wish: Wish): Promise<void> {
    const done = () =>
      void api
        .setWishStashed(wish.id)
        .then(() => this.activeWishlist?.reload())
        .catch(() => {});
    if (wish.kind === "yarn") {
      let photo: Blob | null = null;
      if (wish.photoPath) {
        photo = await api
          .getWishPhoto(wish.id)
          .then((raw) => new Blob([toBytes(raw)], { type: "image/jpeg" }))
          .catch(() => null);
      }
      new YarnForm(this.freshModal(), null, done, null, { ...yarnStart(wish), photo }).open();
    } else if (wish.kind === "tool") {
      await new ToolForm(this.freshModal(), null, done, toolStart(wish)).open();
    }
  }

  private async openShopForm(shop: Shop | null): Promise<void> {
    // The tags other shops have are offered as the form's tags are typed.
    const known = shopTagFacets(await api.listShops().catch(() => [] as Shop[])).map((f) => f.label);
    const form = new ShopForm(this.freshModal(), shop, () => void this.activeShops?.reload(), known);
    form.open();
  }

  /** Reads the cover out of a newly added file without holding up the library. */
  private async addCoverInBackground(pattern: Pattern): Promise<void> {
    try {
      const bytes = await api.readFile(pattern.id);
      if (await ensureCover(pattern, toBytes(bytes))) {
        // The library mounted with a placeholder while this ran; repaint just
        // that card now the cover exists.
        await this.activeLibrary?.refreshCover(pattern.id);
      }
    } catch {
      // No cover is a cosmetic loss, so it never surfaces as an error.
    }
  }

  /**
   * Bulk add: pick a folder, take every PDF and EPUB under it, and add them
   * one at a time behind a progress panel. Every failure path ends in a
   * message or a quiet return — nothing here throws.
   */
  private async addFolder(books = false): Promise<void> {
    let path: string | null;
    try {
      path = await open({ directory: true });
    } catch {
      // The dialog plugin is absent (the browser harness answers the IPC
      // itself, so a throw here only means cancel): nothing to do.
      return;
    }
    // A cancelled dialog resolves null; a multi-pick is not offered.
    if (typeof path !== "string") return;

    let files: ScannedFile[];
    try {
      files = await api.scanPatternFolder(path);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await say(`That folder could not be scanned.\n\n${detail}`);
      return;
    }
    if (!files.length) {
      await say("No PDF or EPUB files found there.");
      return;
    }

    // The same element the Describe scan's panel is appended to.
    const host = this.screen.querySelector<HTMLElement>(".lib-body");
    if (!host) return;
    try {
      const ai = await api.getAiSettings().catch(() => null);
      await runBulkAdd(host, files, {
        onAdded: (p) => void this.addCoverInBackground(p),
        describeHint: !!ai?.enabled,
        tags: books ? ["book"] : [],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await say(`The folder could not be added.\n\n${detail}`);
      return;
    }
    // One repaint at the end, rather than one per file.
    await this.showLibrary();
  }

  private async openSettings(current?: AiSettingsView): Promise<void> {
    // Re-read rather than trusting whatever the view had cached, in case the
    // dialog was opened twice in one session.
    const fallback: AiSettingsView | undefined = current;
    let settings: AiSettingsView;
    try {
      settings = await api.getAiSettings();
    } catch (err) {
      if (!fallback) return void (await say(err instanceof Error ? err.message : String(err), "Settings"));
      settings = fallback;
    }
    const updateSettings = await api.getUpdateSettings().catch(() => ({
      includeBeta: false,
      checkOnStartup: true,
      currentVersion: "",
    }));
    // A missing setting (an older backend, or the harness) shows both.
    const needleSizeDisplay = await api.getNeedleSizeDisplay().catch(() => "both" as const);
    const measureUnit = await api.getMeasureUnit().catch(() => "cm" as const);
    const dialog = new SettingsDialog(this.freshModal(), settings, updateSettings, needleSizeDisplay, measureUnit, async () => {
      // The tab bar first, and a board's toolbar with it. The tab on screen,
      // hidden now, gives way to the first one shown; a pattern open stays.
      await this.applyHiddenTabs();
      document.dispatchEvent(new CustomEvent(HIDDEN_TABS_EVENT));
      if (this.hidden.has(this.currentTab) && !this.activeReader) return void this.showTab(this.firstTab());
      // The screens that show a setting read it on mount; a reload picks up
      // the new values. Elsewhere nothing shows them, so the screen is left.
      if (this.activeLibrary) void this.showLibrary();
      if (this.activePersonPage) void this.showPersonPage(this.activePersonPage.id);
      else if (this.currentTab === "people") void this.showPeople();
      else if (this.currentTab === "calculators") void this.showCalculators();
      else if (this.activeProjectPage) void this.activeProjectPage.refresh();
    });
    dialog.open();
  }
}

/** How often the open app looks for an update; the backend allows at most one an hour. */
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000 + 30 * 1000;

function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  void app.start();
  // Opened: the crash guard need not ask about going back next time.
  void api.appStarted().catch(() => {});
  // Test hook for the browser harness, so the startup update check can be
  // re-run after a release is seeded (it normally fires once, at boot).
  (window as unknown as Record<string, unknown>).__runStartupUpdateCheck = () =>
    app.runStartupUpdateCheck();
}
