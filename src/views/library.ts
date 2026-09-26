import {
  api,
  toBytes,
  DIFFICULTIES,
  STATUSES,
  type AiSettingsView,
  type FacetValues,
  type Filter,
  type Pattern,
} from "../api";
import { askYesNo } from "../dialogs";
import { closestEl } from "../dom";
import {
  coverUrl,
  ensureCover,
  extractFromDocument,
  forgetCover,
  prepareChosenImage,
  removeCover,
  saveCover,
} from "../covers";
import { MetadataScanner, summarise, undoPattern, type ScanOutcome } from "../ai/scan";

/**
 * The library screen: covers, search, filters, and the pattern grid.
 *
 * The metadata scan lives here rather than in the reader because it is a
 * job you run over the whole shelf, and because the results are most useful
 * laid out next to the cards they changed.
 */
export class LibraryView {
  /**
   * The screen this view is mounted into.
   *
   * Like the reader, the library renders into a child element rather than
   * writing over the screen. The screen carries the `flex`/`min-height` chain
   * that makes a scrolling pane work; overwriting its class breaks the height
   * and the results list stops scrolling.
   */
  private screen: HTMLElement;
  private root!: HTMLElement;
  private filter: Filter = { sort: "recent" };
  private facets: FacetValues = { designers: [], needleSizes: [], yarnWeights: [], tags: [] };
  private patterns: Pattern[] = [];
  private results!: HTMLElement;
  private searchBox!: HTMLInputElement;
  private settings!: AiSettingsView;

  /** Live state for a scan in progress, so it can be stopped. */
  private scanning = false;
  private stopRequested = false;

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Patterns</h1>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search title, designer, notes..." />
          <select class="sort">
            <option value="recent">Newest first</option>
            <option value="title">Title Aâ€“Z</option>
            <option value="oldest">Oldest first</option>
            <option value="lastOpened">Recently read</option>
          </select>
          <button data-act="fill-covers" class="ghost" title="Add missing covers">Covers</button>
          <button data-act="scan" class="ghost" title="Describe patterns using your model">Describe</button>
          <button data-act="settings" class="ghost" title="Model settings">Settings</button>
          <button data-act="add" class="primary">+ Add pattern</button>
        </div>
      </header>

      <div class="lib-body">
        <aside class="filters">
          <div class="filter-group">
            <h4>Status</h4>
            ${STATUSES.map(
              (s) => `<label class="check">
                <input type="checkbox" data-filter="status" value="${s.value}" />
                <span>${s.label}</span>
              </label>`,
            ).join("")}
          </div>
          <div class="filter-group">
            <h4>Difficulty</h4>
            ${DIFFICULTIES.map(
              (d) => `<label class="check">
                <input type="checkbox" data-filter="difficulty" value="${d.value}" />
                <span>${d.label}</span>
              </label>`,
            ).join("")}
          </div>
          <div class="filter-group" data-slot="designer">
            <h4>Designer</h4>
            <div class="facet-list"></div>
          </div>
          <div class="filter-group" data-slot="needle">
            <h4>Needle size</h4>
            <div class="facet-list"></div>
          </div>
          <div class="filter-group" data-slot="yarn">
            <h4>Yarn weight</h4>
            <div class="facet-list weight-scale"></div>
          </div>
          <div class="filter-group" data-slot="tags">
            <h4>Tags</h4>
            <div class="tag-cloud"></div>
          </div>
          <button class="ghost clear-filters" data-act="clear">Clear all filters</button>
        </aside>

        <main class="results"></main>
      </div>
    `;

    // Attached last, so the whole view is in place before it goes on screen.
    this.screen.appendChild(this.root);

    this.results = this.root.querySelector(".results")!;
    this.searchBox = this.root.querySelector(".search")!;

    this.searchBox.addEventListener("input", () => {
      this.filter.search = this.searchBox.value || undefined;
      void this.reload();
    });

    (this.root.querySelector(".sort") as HTMLSelectElement).addEventListener("change", (e) => {
      this.filter.sort = (e.target as HTMLSelectElement).value;
      void this.reload();
    });

    this.root.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const field = input.dataset.filter;
      if (!field) return;
      // Yarn weight is always a set: picking DK and Aran means "either", and
      // the query handles that directly, so there is no need to fan out into
      // separate requests the way the single-valued groups do.
      if (field === "yarnWeight") {
        const checked = [...this.root.querySelectorAll<HTMLInputElement>(
          'input[data-filter="yarnWeight"]:checked',
        )].map((i) => i.value);
        this.filter.yarnWeight = checked.length ? checked : undefined;
        void this.reload();
        return;
      }
      if (field === "status" || field === "difficulty") {
        const checked = [...this.root.querySelectorAll<HTMLInputElement>(
          `input[data-filter="${field}"]:checked`,
        )].map((i) => i.value);
        (this.filter as Record<string, unknown>)[field] = checked.length ? checked[0] : undefined;
        if (checked.length > 1) {
          void this.reloadMulti(field as "status" | "difficulty", checked);
          return;
        }
      }
      void this.reload();
    });

    this.root.addEventListener("click", (e) => this.onClick(e));

    this.settings = await api.getAiSettings();
    this.facets = await api.getFacets();
    this.renderFacets();
    await this.reload();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") {
        this.root.dispatchEvent(new CustomEvent("add-pattern", { bubbles: true }));
      } else if (act === "clear") {
        this.clearFilters();
        await this.reload();
      } else if (act === "scan") {
        await this.startScan();
      } else if (act === "settings") {
        this.root.dispatchEvent(
          new CustomEvent("open-ai-settings", { bubbles: true, detail: this.settings }),
        );
      } else if (act === "fill-covers") {
        await this.fillMissingCovers(btn as HTMLButtonElement);
      } else if (act === "stop-scan") {
        this.stopRequested = true;
      } else if (act === "cover-file") {
        await this.pickCoverFile(btn.dataset.id!);
      } else if (act === "cover-reset") {
        await this.resetCover(btn.dataset.id!);
      } else if (act === "cover-remove") {
        await this.dropCover(btn.dataset.id!);
      } else if (act === "undo-ai") {
        await this.undoAi(btn.dataset.id!);
      }
      return;
    }

    // Checked before the card itself, because the Remove button lives inside
    // the card: with this the other way round, clicking Remove opens the
    // pattern instead of removing it, and the delete handler is never reached.
    const del = closestEl(e.target, "[data-delete]");
    if (del) {
      e.stopPropagation();
      await this.confirmDelete(del.dataset.delete!);
      return;
    }

    const card = closestEl(e.target, "[data-open]");
    if (card) {
      this.root.dispatchEvent(
        new CustomEvent("open-pattern", { bubbles: true, detail: card.dataset.open }),
      );
      return;
    }
    const tag = closestEl(e.target, "[data-tag]");
    if (tag) {
      this.toggleTag(tag.dataset.tag!);
      await this.reload();
    }
  }

  // ---------- covers ----------

  /** Adds a cover to every pattern that is missing one, reporting progress. */
  private async fillMissingCovers(button: HTMLButtonElement): Promise<void> {
    const missing = await api.patternsMissingCovers();
    if (!missing.length) {
      this.flash("Every pattern already has a cover.");
      return;
    }
    const targets = this.patterns.filter((p) => missing.includes(p.id));
    if (!targets.length) return;

    const label = button.textContent;
    let done = 0;
    button.disabled = true;
    for (const pattern of targets) {
      button.textContent = `Covers ${++done}/${targets.length}`;
      try {
        const bytes = await api.readFile(pattern.id);
        await ensureCover(pattern, toBytes(bytes));
        forgetCover(pattern.id);
      } catch {
        // A pattern that cannot be read simply keeps its placeholder.
      }
    }
    button.disabled = false;
    button.textContent = label;
    await this.reload();
    this.flash(`Checked ${targets.length} pattern${targets.length === 1 ? "" : "s"}.`);
  }

  private async pickCoverFile(patternId: string): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const blob = await prepareChosenImage(file);
      if (!blob) {
        this.flash("That file could not be read as an image.", true);
        return;
      }
      await saveCover(patternId, blob);
      forgetCover(patternId);
      await this.reload();
    });
    input.click();
  }

  private async resetCover(patternId: string): Promise<void> {
    const pattern = this.patterns.find((p) => p.id === patternId);
    if (!pattern) return;
    try {
      const bytes = await api.readFile(pattern.id);
      const found = await extractFromDocument(pattern, toBytes(bytes));
      if (!found) {
        this.flash("No cover image found in that file.", true);
        return;
      }
      await saveCover(patternId, found.blob);
      forgetCover(patternId);
      await this.reload();
    } catch {
      this.flash("Could not read that file.", true);
    }
  }

  private async dropCover(patternId: string): Promise<void> {
    await removeCover(patternId);
    forgetCover(patternId);
    await this.reload();
  }

  // ---------- AI ----------

  private async startScan(): Promise<void> {
    if (this.scanning) return;
    if (!this.settings.baseUrl.trim()) {
      this.root.dispatchEvent(
        new CustomEvent("open-ai-settings", { bubbles: true, detail: this.settings }),
      );
      return;
    }

    const targets = MetadataScanner.candidates(this.patterns, this.settings);
    if (!targets.length) {
      this.flash("Every pattern here is already described.");
      return;
    }

    const confirmed = await askYesNo(
      `Describe ${targets.length} pattern${targets.length === 1 ? "" : "s"} using ${
        this.settings.model || "your model"
      }?\n\n` +
        `Only the start of each pattern is sent, to ${
          this.settings.isLocal ? "your own network" : this.settings.baseUrl
        }.`,
      { title: "Describe with your model", okLabel: "Describe" },
    );
    if (!confirmed) return;

    this.scanning = true;
    this.stopRequested = false;
    this.showScanPanel(targets.length);

    const scanner = new MetadataScanner(this.settings);
    const outcomes: ScanOutcome[] = [];

    const done = await scanner.scan(
      targets,
      (outcome, index) => {
        outcomes.push(outcome);
        this.updateScanPanel(outcome, index, targets.length, outcomes);
        // Repaint as results land, so the card fills in behind the scan.
        if (outcome.applied) void this.reloadQuietly();
      },
      () => this.stopRequested,
    );

    this.scanning = false;
    this.finishScanPanel(done, this.stopRequested);
    await this.reload();
    await this.refreshUndoButtons();
  }

  private async undoAi(patternId: string): Promise<void> {
    const restored = await undoPattern(patternId);
    if (restored) {
      await this.reload();
      await this.refreshUndoButtons();
      this.flash("Undone.");
    } else {
      this.flash("Nothing to undo for that pattern.", true);
    }
  }

  /** Shows an undo button on any card the model has changed. */
  private async refreshUndoButtons(): Promise<void> {
    for (const card of this.root.querySelectorAll<HTMLElement>(".card")) {
      const id = card.dataset.open;
      if (!id || card.querySelector("[data-act='undo-ai']")) continue;
      // The row exists in the card markup, but is emptied by `:empty` in CSS
      // when nothing is in it, so look it up rather than assuming.
      const row = card.querySelector<HTMLElement>(".card-tools-row");
      if (!row) continue;
      try {
        if (await api.hasAiHistory(id)) {
          row.insertAdjacentHTML(
            "afterbegin",
            `<button class="card-tool" data-act="undo-ai" data-id="${id}"
               title="Undo the last change your model made">Undo model change</button>`,
          );
        }
      } catch {
        // Not worth surfacing; the button simply does not appear.
      }
    }
  }

  // ---------- panels ----------

  private showScanPanel(total: number): void {
    this.root.querySelector(".scan-panel")?.remove();
    const panel = document.createElement("div");
    panel.className = "scan-panel";
    panel.innerHTML = `
      <div class="scan-head">
        <strong>Reading your patternsâ€¦</strong>
        <span data-el="count">0 / ${total}</span>
        <button class="ghost" data-act="stop-scan">Stop</button>
      </div>
      <div class="scan-bar"><div class="scan-fill" data-el="fill"></div></div>
      <p class="scan-note" data-el="note">A local model can take a moment per pattern.</p>
      <ul class="scan-log" data-el="log"></ul>
    `;
    this.root.querySelector(".lib-body")?.appendChild(panel);
  }

  private updateScanPanel(
    outcome: ScanOutcome,
    index: number,
    total: number,
    done: ScanOutcome[],
  ): void {
    const panel = this.root.querySelector(".scan-panel");
    if (!panel) return;
    panel.querySelector('[data-el="count"]')!.textContent = `${index + 1} / ${total}`;
    panel.querySelector<HTMLElement>('[data-el="fill"]')!.style.width = `${Math.round(
      ((index + 1) / total) * 100,
    )}%`;

    const log = panel.querySelector('[data-el="log"]')!;
    const li = document.createElement("li");
    if (!outcome.ok) {
      li.className = "bad";
      li.textContent = `${outcome.title} â€” ${outcome.error}`;
    } else if (outcome.changed.length) {
      li.className = "ok";
      li.textContent = `${outcome.title} â€” added ${outcome.changed.join(", ")}`;
    } else {
      li.textContent = `${outcome.title} â€” nothing to add`;
    }
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    void done;
  }

  private finishScanPanel(outcomes: ScanOutcome[], stopped: boolean): void {
    const panel = this.root.querySelector(".scan-panel");
    if (!panel) return;
    panel.classList.add("done");
    panel.querySelector('[data-act="stop-scan"]')?.remove();
    const note = panel.querySelector('[data-el="note"]') as HTMLElement;
    note.textContent = stopped
      ? `Stopped. ${summarise(outcomes)}`
      : summarise(outcomes);
    // The log and bar have served their purpose.
    panel.querySelector(".scan-bar")?.remove();
    panel.querySelector('[data-el="count"]')?.remove();
  }

  /** A short-lived message under the toolbar. */
  private flash(message: string, isError = false): void {
    this.root.querySelector(".flash")?.remove();
    const el = document.createElement("div");
    el.className = `flash ${isError ? "bad" : ""}`;
    el.textContent = message;
    this.root.querySelector(".lib-bar")?.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---------- listing ----------

  private renderFacets(): void {
    const list = (values: string[], field: string) =>
      values.length
        ? values
            .map(
              (v) =>
                `<label class="check">
                  <input type="checkbox" data-filter="${field}" value="${escapeHtml(v)}" />
                  <span>${escapeHtml(v)}</span>
                </label>`,
            )
            .join("")
        : '<p class="hint">None yet</p>';

    this.root.querySelector('[data-slot="designer"] .facet-list')!.innerHTML = list(
      this.facets.designers,
      "designer",
    );
    this.root.querySelector('[data-slot="needle"] .facet-list')!.innerHTML = list(
      this.facets.needleSizes,
      "needleSize",
    );

    // Yarn weights come from the standard table rather than from the data, so
    // every family is listed whether or not it is used. A weight you have not
    // got is still worth seeing: it tells you what you could be looking for.
    // The count is shown, and an unused one is dimmed rather than hidden.
    this.root.querySelector('[data-slot="yarn"] .facet-list')!.innerHTML =
      this.facets.yarnWeights.length
        ? this.facets.yarnWeights
            .map(
              (w) => `
                <label class="check${w.count ? "" : " unused"}">
                  <input type="checkbox" data-filter="yarnWeight" value="${escapeHtml(w.key)}" />
                  <span>${escapeHtml(w.label)}</span>
                  <em>${w.count}</em>
                </label>`,
            )
            .join("")
        : '<p class="hint">None yet</p>';

    YARN_LABELS.clear();
    for (const w of this.facets.yarnWeights) YARN_LABELS.set(w.key, w.label);
    this.root.querySelector('[data-slot="tags"] .tag-cloud')!.innerHTML = this.facets.tags
      .map(
        (t) => `<button class="tag-btn" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`,
      )
      .join("");
  }

  private toggleTag(tag: string): void {
    const current = this.filter.tags ?? [];
    this.filter.tags = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
  }

  private clearFilters(): void {
    this.filter = { sort: this.filter.sort };
    this.searchBox.value = "";
    this.root
      .querySelectorAll<HTMLInputElement>("input[data-filter]")
      .forEach((i) => (i.checked = false));
  }

  private async reloadMulti(field: "status" | "difficulty", values: string[]): Promise<void> {
    const batches = await Promise.all(
      values.map((v) => api.listPatterns({ ...this.filter, [field]: v })),
    );
    const seen = new Set<string>();
    this.patterns = batches.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    this.paint();
  }

  private async reload(): Promise<void> {
    this.patterns = await api.listPatterns(this.filter);
    this.paint();
    await this.loadCovers();
    void this.refreshUndoButtons();
  }

  /** Repaints without reloading from the database, used during a scan. */
  private async reloadQuietly(): Promise<void> {
    this.patterns = await api.listPatterns(this.filter);
    this.paint();
  }

  private paint(): void {
    if (!this.patterns.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${
            this.filter.search || this.filter.status
              ? "Nothing matches those filters"
              : "No patterns yet"
          }</h2>
          <p>${
            this.filter.search || this.filter.status
              ? "Try removing a filter."
              : "Add a PDF or EPUB to get started."
          }</p>
        </div>`;
      return;
    }

    this.results.innerHTML = this.patterns.map((p) => this.cardHtml(p)).join("");
  }

  private cardHtml(p: Pattern): string {
    return `
      <article class="card" data-open="${p.id}">
        <div class="cover" data-id="${p.id}">
          <div class="cover-photo" data-el="photo"></div>
          <div class="cover-fallback format-${p.format}">
            <span>${p.format.toUpperCase()}</span>
          </div>
          <div class="cover-tools">
            <button class="card-tool" data-act="cover-file" data-id="${p.id}"
              title="Use your own image">Image</button>
            <button class="card-tool" data-act="cover-reset" data-id="${p.id}"
              title="Read the cover from the file">From file</button>
            <button class="card-tool danger" data-act="cover-remove" data-id="${p.id}"
              title="Remove the cover">Ã—</button>
          </div>
        </div>
        <div class="card-body">
          <h3>${escapeHtml(p.title)}</h3>
          <p class="designer">${p.designer ? escapeHtml(p.designer) : "Unknown designer"}</p>
          <div class="card-meta">
            ${statusPill(p.status)}
            ${p.difficulty ? `<span class="pill">${escapeHtml(p.difficulty)}</span>` : ""}
            ${p.needleSize ? `<span class="pill">${escapeHtml(p.needleSize)}</span>` : ""}
            ${yarnPill(p)}
          </div>
          ${p.tags.length ? `<div class="card-tags">${p.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          <div class="card-tools-row">
            <button class="card-remove" data-delete="${p.id}"
              title="Remove this pattern from your library">Remove</button>
          </div>
        </div>
      </article>`;
  }

  /**
   * Fills in cover photos. Loaded after the cards so the grid appears at once
   * with a placeholder, rather than waiting on a read per pattern.
   */
  private async loadCovers(): Promise<void> {
    for (const pattern of this.patterns) {
      if (!pattern.coverPath) continue;
      const host = this.results.querySelector(
        `.cover[data-id="${pattern.id}"] [data-el="photo"]`,
      ) as HTMLElement | null;
      if (!host) continue;
      const url = await coverUrl(pattern.id);
      if (!url) continue;
      host.style.backgroundImage = `url("${url}")`;
      host.parentElement?.classList.add("has-cover");
    }
  }

  private async confirmDelete(id: string): Promise<void> {
    const pattern = this.patterns.find((p) => p.id === id);
    const name = pattern ? `"${pattern.title}"` : "this pattern";
    if (
      !(await askYesNo(
        `Remove ${name} from your library?\n\nThe file and its cover will be deleted too. This cannot be undone.`,
        { title: "Remove pattern", okLabel: "Remove", danger: true },
      ))
    ) {
      return;
    }
    await api.deletePattern(id);
    forgetCover(id);
    this.facets = await api.getFacets();
    this.renderFacets();
    await this.reload();
  }
}

function statusPill(status: string): string {
  const label = STATUSES.find((s) => s.value === status)?.label ?? status;
  return `<span class="pill status-${status}">${label}</span>`;
}

/**
 * Family key to label, filled in from the facets the backend sends.
 *
 * The labels live in the standard weight table on the Rust side and travel out
 * with the facets, so "DK" and "Super chunky" are spelled in exactly one
 * place rather than duplicated here.
 */
const YARN_LABELS = new Map<string, string>();

/**
 * The yarn weight pill.
 *
 * Prefers the family label, because "DK" is how a knitter thinks about it and
 * it lines up with the filter. A weight the table does not recognise is shown
 * as written rather than hidden, since it is still the useful information.
 */
function yarnPill(p: Pattern): string {
  // Defensive about the field being absent. A card is rendered for every
  // pattern in one pass, so a single record missing a field would otherwise
  // take the whole grid down with it.
  const stated = (p.yarnWeight ?? "").trim();
  if (!stated) return "";
  const family = p.yarnWeightFamily ?? "";
  const label = YARN_LABELS.get(family) ?? (family ? "" : stated);
  if (!label) return "";
  // The stated weight goes in the tooltip when it says more than the family
  // label, so "75 m/100g" is recoverable from a card that reads "Aran". A
  // weight that is just the family name in different casing adds nothing.
  const saysMore = stated.toLowerCase() !== label.toLowerCase();
  const title = saysMore ? ` title="${escapeHtml(stated)}"` : "";
  return `<span class="pill weight"${title}>${escapeHtml(label)}</span>`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
