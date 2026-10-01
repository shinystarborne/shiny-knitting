import "./styles.css";
import { open } from "@tauri-apps/plugin-dialog";
import { api, toBytes, type AiSettingsView, type Pattern, type Project, type ScannedFile, type Tool, type Yarn } from "./api";
import { LibraryView } from "./views/library";
import { StashView } from "./views/stash";
import { ToolsView } from "./views/tools";
import { ToolForm } from "./views/tool-form";
import { ProjectsView } from "./views/projects";
import { ProjectForm } from "./views/project-form";
import { FinishProjectDialog } from "./views/finish-project";
import { ProjectPage } from "./views/project-page";
import { PatternForm } from "./views/pattern-form";
import { YarnForm } from "./views/yarn-form";
import { runBulkAdd } from "./views/bulk-add";
import { SettingsDialog } from "./views/settings";
import { clearBoardImageCache, clearCoverCache, clearYarnPhotoCache, ensureCover } from "./covers";
import { say } from "./dialogs";
import { closestEl } from "./dom";
import { ReaderView, type Layout } from "./reader/reader";

/**
 * App shell. A tab bar picks the top-level screen — Patterns, Projects,
 * Stash, or Needles & hooks — and
 * the reader covers the Patterns tab when a pattern is open. The current
 * layout choice is remembered for the session.
 */
class App {
  private root: HTMLElement;
  private tabBar!: HTMLElement;
  private screen!: HTMLElement;
  private modal!: HTMLElement;

  private activeReader: ReaderView | null = null;
  /** The project page on screen, so a dialog saved over it can refresh it. */
  private activeProjectPage: ProjectPage | null = null;
  /** The mounted library, so background work can ask it to repaint a card. */
  private activeLibrary: LibraryView | null = null;
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
      <button class="tab active" data-tab="patterns">Patterns</button>
      <button class="tab" data-tab="projects">Projects</button>
      <button class="tab" data-tab="stash">Stash</button>
      <button class="tab" data-tab="tools">Needles &amp; hooks</button>
    `;
    this.screen = document.createElement("div");
    this.screen.className = "screen";
    this.modal = document.createElement("div");
    this.modal.className = "modal-backdrop hidden";

    this.root.append(this.tabBar, this.screen, this.modal);

    this.tabBar.addEventListener("click", (e) => {
      const tab = closestEl(e.target, "button[data-tab]");
      if (!tab) return;
      if (tab.dataset.tab === "stash") {
        void this.showStash();
      } else if (tab.dataset.tab === "tools") {
        void this.showTools();
      } else if (tab.dataset.tab === "projects") {
        void this.showProjects();
      } else {
        void this.showLibrary();
      }
    });

    // Reading events bubble up from whichever view is on screen.
    this.screen.addEventListener("navigate-back", () => void this.showLibrary());
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
    this.screen.addEventListener("add-pattern", () => this.openForm(null));
    this.screen.addEventListener("add-folder", () => void this.addFolder());
    this.screen.addEventListener("open-pattern", (e) => {
      void this.showReader((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("edit-pattern", (e) => {
      this.openForm((e as CustomEvent<Pattern>).detail);
    });
    this.screen.addEventListener("add-yarn", (e) => {
      // A yarn in the detail is one to add another colour of.
      this.openYarnForm(null, (e as CustomEvent<Yarn | undefined>).detail ?? null);
    });
    this.screen.addEventListener("edit-yarn", (e) => {
      this.openYarnForm((e as CustomEvent<Yarn>).detail);
    });
    this.screen.addEventListener("add-project", (e) => {
      const detail = (e as CustomEvent<{ patternId?: string }>).detail ?? {};
      void this.openProjectForm(null, detail.patternId ?? null);
    });
    this.screen.addEventListener("open-project-page", (e) => {
      void this.showProjectPage((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("edit-project", (e) => {
      void this.editProject((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("add-tool", () => void this.openToolForm(null));
    this.screen.addEventListener("edit-tool", (e) => {
      void this.openToolForm((e as CustomEvent<Tool>).detail);
    });
    this.screen.addEventListener("open-settings", (e) => {
      void this.openSettings((e as CustomEvent<AiSettingsView>).detail);
    });
    // The reader still dispatches the old name from its single-pattern
    // Describe flow; both names open the same dialog.
    this.screen.addEventListener("open-ai-settings", (e) => {
      void this.openSettings((e as CustomEvent<AiSettingsView>).detail);
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

    await this.showLibrary();
    // The quiet update check runs once the library is up; it never blocks
    // startup and a failure says nothing.
    void this.runStartupUpdateCheck();
  }

  /**
   * The daily update check. Only a found update surfaces, as a ghost button on
   * the library toolbar; "skipped" and errors both show nothing. Public so the
   * browser harness can re-run it after seeding a release.
   */
  async runStartupUpdateCheck(): Promise<void> {
    const token = this.navToken;
    try {
      const outcome = await api.startupUpdateCheck();
      // The user may have opened a pattern while the check was in flight; a
      // notice for a screen that is no longer up would be worse than none.
      if (token !== this.navToken) return;
      if (outcome.skipped || !outcome.update) return;
      this.activeLibrary?.showUpdateNotice(outcome.update.tag);
    } catch {
      // A failed check is a missed convenience, never an interruption.
    }
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
    clearBoardImageCache();
    this.activeLibrary = null;
    this.screen.innerHTML = "";
    // Cover and photo object URLs are tied to the elements that showed them.
    clearCoverCache();
    clearYarnPhotoCache();
  }

  /** Marks the tab that owns the current screen; the reader counts as Patterns. */
  /** The tab on screen, so a dialog saved over it can bring it up to date. */
  private currentTab: "patterns" | "projects" | "stash" | "tools" = "patterns";

  private setActiveTab(name: "patterns" | "projects" | "stash" | "tools"): void {
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
    const view = new StashView(this.screen);
    await view.mount();
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
    });
    this.activeProjectPage = page;
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

  private openForm(pattern: Pattern | null): void {
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
    });
    form.open();
  }

  private openYarnForm(yarn: Yarn | null, template: Yarn | null = null): void {
    const form = new YarnForm(this.freshModal(), yarn, () => {
      // A save re-mounts the stash, so the card picks up the new figures and
      // any photo the form uploaded afterwards.
      void this.showStash();
    }, template);
    form.open();
  }

  private async editProject(id: string): Promise<void> {
    const project = (await api.listProjects().catch(() => [] as Project[])).find((p) => p.id === id);
    if (!project) {
      await say("That project is no longer there.");
      return;
    }
    await this.openProjectForm(project, null);
  }

  private async openProjectForm(project: Project | null, patternId: string | null): Promise<void> {
    const form = new ProjectForm(this.freshModal(), project, { patternId }, {
      onDone: (saved) => {
        // A project started from the Projects tab opens on its own page,
        // ready for its board; one started from a pattern stays with it.
        if (!project && saved && this.currentTab === "projects" && !this.activeProjectPage) void this.showProjectPage(saved.id);
        else this.afterProjectChange();
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
  private async addFolder(): Promise<void> {
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
      await runBulkAdd(host, files, {
        onAdded: (p) => void this.addCoverInBackground(p),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await say(`The folder could not be added.\n\n${detail}`);
      return;
    }
    // One repaint at the end, rather than one per file.
    await this.showLibrary();
  }

  private async openSettings(current: AiSettingsView): Promise<void> {
    // Re-read rather than trusting whatever the view had cached, in case the
    // dialog was opened twice in one session.
    const settings = await api.getAiSettings().catch(() => current);
    const updateSettings = await api.getUpdateSettings().catch(() => ({
      includeBeta: false,
      checkOnStartup: true,
      currentVersion: "",
    }));
    const dialog = new SettingsDialog(this.freshModal(), settings, updateSettings, () => {
      // The library reads settings on mount; a reload picks up the new values.
      void this.showLibrary();
    });
    dialog.open();
  }
}

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  void app.start();
  // Test hook for the browser harness, so the startup update check can be
  // re-run after a release is seeded (it normally fires once, at boot).
  (window as unknown as Record<string, unknown>).__runStartupUpdateCheck = () =>
    app.runStartupUpdateCheck();
}
