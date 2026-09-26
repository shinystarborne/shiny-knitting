import "./styles.css";
import { api, toBytes, type AiSettingsView, type Pattern } from "./api";
import { LibraryView } from "./views/library";
import { PatternForm } from "./views/pattern-form";
import { AiSettingsDialog } from "./views/ai-settings";
import { clearCoverCache, ensureCover } from "./covers";
import { ReaderView, type Layout } from "./reader/reader";

/**
 * App shell. Two screens, swapped in place: the library and the reader.
 * The current layout choice is remembered for the session.
 */
class App {
  private root: HTMLElement;
  private screen!: HTMLElement;
  private modal!: HTMLElement;

  private activeReader: ReaderView | null = null;
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
    this.screen = document.createElement("div");
    this.screen.className = "screen";
    this.modal = document.createElement("div");
    this.modal.className = "modal-backdrop hidden";

    this.root.append(this.screen, this.modal);

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
    this.screen.addEventListener("open-pattern", (e) => {
      void this.showReader((e as CustomEvent<string>).detail);
    });
    this.screen.addEventListener("edit-pattern", (e) => {
      this.openForm((e as CustomEvent<Pattern>).detail);
    });
    this.screen.addEventListener("open-ai-settings", (e) => {
      void this.openAiSettings((e as CustomEvent<AiSettingsView>).detail);
    });

    document.addEventListener("keydown", (e) => {
      // Escape backs out of a form or leaves the reader.
      if (e.key === "Escape") {
        if (!this.modal.classList.contains("hidden")) {
          this.modal.className = "modal-backdrop hidden";
          this.modal.innerHTML = "";
        } else if (this.activeReader) {
          void this.showLibrary();
        }
      }
    });

    await this.showLibrary();
  }

  private clearScreen(): void {
    this.activeReader?.destroy();
    this.activeReader = null;
    this.screen.innerHTML = "";
    // Cover object URLs are tied to the elements that showed them.
    clearCoverCache();
  }

  private async showLibrary(): Promise<void> {
    // The library has no async gap after clearScreen, so no token is needed.
    this.navToken++;
    this.clearScreen();
    const view = new LibraryView(this.screen);
    await view.mount();
  }

  private async showReader(id: string): Promise<void> {
    const token = ++this.navToken;
    this.clearScreen();
    const pattern = await api.getPattern(id);
    // A newer navigation started while this one was fetching; abandon it
    // rather than clobbering the screen it is replacing.
    if (token !== this.navToken) return;

    const reader = new ReaderView(this.screen, pattern, this.layout);
    this.activeReader = reader;
    await reader.mount();
  }

  private openForm(pattern: Pattern | null): void {
    const form = new PatternForm(this.modal, pattern, (saved) => {
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

  /** Reads the cover out of a newly added file without holding up the library. */
  private async addCoverInBackground(pattern: Pattern): Promise<void> {
    try {
      const bytes = await api.readFile(pattern.id);
      await ensureCover(pattern, toBytes(bytes));
    } catch {
      // No cover is a cosmetic loss, so it never surfaces as an error.
    }
  }

  private async openAiSettings(current: AiSettingsView): Promise<void> {
    // Re-read rather than trusting whatever the view had cached, in case the
    // dialog was opened twice in one session.
    const settings = await api.getAiSettings().catch(() => current);
    const dialog = new AiSettingsDialog(this.modal, settings, () => {
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
}
