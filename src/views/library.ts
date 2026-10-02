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
import { coverUrl, ensureCover, forgetCover } from "../covers";
import { MetadataScanner, undoPattern } from "../ai/scan";
import { describing, ROBOT, showDescribePanel, startDescribing } from "../ai/describe-run";
import { changeCover } from "./cover-dialog";
import { editTags } from "./tags-dialog";
import { sortOutDuplicates } from "./duplicates";
import { paintLazily } from "./lazy";

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
            <option value="title">Title A–Z</option>
            <option value="oldest">Oldest first</option>
            <option value="lastOpened">Recently read</option>
          </select>
          <button data-act="fill-covers" class="ghost" title="Add missing covers">Covers</button>
          <button data-act="duplicates" class="ghost" title="Find patterns that are in the library more than once">Duplicates…</button>
          <button data-act="scan" class="ghost lib-icon" hidden aria-label="Describe patterns with your model"
            title="Describe patterns with your model: designer, difficulty, needles, yarn and tags">${ROBOT}</button>
          <button data-act="add" class="primary">+ Add pattern</button>
          <button data-act="add-folder" class="ghost" title="Add every PDF and EPUB in a folder">Add folder…</button>
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
        const checked = this.checkedValues(field);
        this.filter.yarnWeight = checked.length ? checked : undefined;
      } else {
        // The other groups are single-valued in the query, so the first
        // ticked value is kept here; reload() fans out over every ticked
        // value, using the boxes themselves as the source of truth.
        const checked = this.checkedValues(field);
        (this.filter as Record<string, unknown>)[field] = checked.length ? checked[0] : undefined;
      }
      void this.reload();
    });

    this.root.addEventListener("click", (e) => this.onClick(e));

    this.settings = await api.getAiSettings();
    // The robot is there only when describing with a model is switched on.
    this.root.querySelector<HTMLElement>('[data-act="scan"]')!.hidden = !this.settings.enabled;
    // A run in the background changes patterns one at a time; each card is
    // brought up to date where it is, without repainting the grid.
    const onDescribed = (e: Event) => {
      if (!this.root.isConnected) return window.removeEventListener("pattern-described", onDescribed);
      void this.refreshCard((e as CustomEvent<string>).detail);
    };
    window.addEventListener("pattern-described", onDescribed);
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
      } else if (act === "add-folder") {
        this.root.dispatchEvent(new CustomEvent("add-folder", { bubbles: true }));
      } else if (act === "clear") {
        this.clearFilters();
        await this.reload();
      } else if (act === "scan") {
        await this.startScan();
      } else if (act === "duplicates") {
        if (await sortOutDuplicates()) {
          this.facets = await api.getFacets();
          this.renderFacets();
          await this.reload();
        }
      } else if (act === "want") {
        await this.toggleWant(btn.dataset.id!);
      } else if (act === "more") {
        this.openMenu(btn as HTMLButtonElement);
      } else if (act === "fill-covers") {
        await this.fillMissingCovers(btn as HTMLButtonElement);
      } else if (act === "cover") {
        const pattern = this.patterns.find((p) => p.id === btn.dataset.id);
        if (pattern && (await changeCover(pattern))) await this.afterCoverChange(pattern.id);
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

    const label = button.textContent;
    let done = 0;
    button.disabled = true;
    // Every pattern missing a cover is tried, not just the ones the current
    // filter happens to show: the filter is a view, not a selection.
    for (const id of missing) {
      try {
        const bytes = await api.readFile(id);
        const pattern = await api.getPattern(id);
        await ensureCover(pattern, toBytes(bytes));
        forgetCover(id);
        button.textContent = `Covers ${++done}/${missing.length}`;
      } catch {
        // A pattern that cannot be read simply keeps its placeholder, and is
        // not counted as done.
      }
    }
    button.disabled = false;
    button.textContent = label;
    await this.reload();
    this.flash(`Checked ${missing.length} pattern${missing.length === 1 ? "" : "s"}.`);
  }


  /** After the cover dialog: the card's picture, without repainting the grid. */
  private async afterCoverChange(patternId: string): Promise<void> {
    const fresh = await api.getPattern(patternId).catch(() => null);
    const i = this.patterns.findIndex((p) => p.id === patternId);
    if (fresh && i >= 0) this.patterns[i] = fresh;
    forgetCover(patternId);
    const cover = this.results.querySelector<HTMLElement>(`.cover[data-id="${patternId}"]`);
    const host = cover?.querySelector<HTMLElement>('[data-el="photo"]');
    if (!cover || !host) return;
    const url = fresh?.coverPath ? await coverUrl(patternId) : null;
    host.style.backgroundImage = url ? `url("${url}")` : "";
    cover.classList.toggle("has-cover", !!url);
  }

  // ---------- the card's ⋯ menu ----------

  private menu: HTMLElement | null = null;

  /**
   * The ⋯ menu: the pattern's status (none, want to knit, in progress,
   * finished, abandoned), its tags, its details, its cover, and starting a
   * project, all without opening it.
   */
  private openMenu(button: HTMLButtonElement): void {
    const id = button.dataset.id!;
    const wasOpen = this.menu?.dataset.id === id;
    this.closeMenu();
    if (wasOpen) return;
    const pattern = this.patterns.find((p) => p.id === id);
    if (!pattern) return;
    const menu = document.createElement("div");
    menu.className = "card-menu";
    menu.dataset.id = id;
    menu.setAttribute("role", "menu");
    const statuses = [{ value: "", label: "No status" }, ...STATUSES];
    menu.innerHTML = `
      <p class="card-menu-head">Status</p>
      ${statuses
        .map(
          (st) => `<button role="menuitemradio" aria-checked="${pattern.status === st.value}" data-status="${st.value}"
            class="${pattern.status === st.value ? "on" : ""}"><span class="tick">${pattern.status === st.value ? "✓" : ""}</span>${escapeHtml(st.label)}</button>`,
        )
        .join("")}
      <hr />
      <button role="menuitem" data-menu="tags"><span class="tick"></span>Tags…</button>
      <button role="menuitem" data-menu="details"><span class="tick"></span>Details…</button>
      <button role="menuitem" data-menu="cover"><span class="tick"></span>Cover…</button>
      <button role="menuitem" data-menu="project"><span class="tick"></span>Start a project…</button>`;
    document.body.appendChild(menu);
    // Under the button, kept on screen.
    const at = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, at.right - box.width));
    const below = at.bottom + 4 + box.height <= window.innerHeight - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${below ? at.bottom + 4 : Math.max(8, at.top - 4 - box.height)}px`;
    this.menu = menu;
    menu.querySelector<HTMLElement>("button.on, button")?.focus();

    menu.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!item) return;
      this.closeMenu();
      if (item.dataset.status !== undefined) void this.setStatus(id, item.dataset.status);
      else void this.menuAction(id, item.dataset.menu!);
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>("button")];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        button.focus();
      } else if (menu.contains(e.target as Node) || button.contains(e.target as Node)) {
        return;
      }
      this.closeMenu();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", away, true);
    this.results.addEventListener("scroll", away, { passive: true, once: true });
    this.closeMenuListeners = () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", away, true);
      this.results.removeEventListener("scroll", away);
    };
  }

  private closeMenuListeners: (() => void) | null = null;

  private closeMenu(): void {
    this.closeMenuListeners?.();
    this.closeMenuListeners = null;
    this.menu?.remove();
    this.menu = null;
  }

  private async setStatus(patternId: string, status: string): Promise<void> {
    try {
      await api.setPatternStatus(patternId, status);
    } catch (err) {
      return this.flash(err instanceof Error ? err.message : String(err), true);
    }
    await this.refreshCard(patternId);
  }

  private async menuAction(patternId: string, action: string): Promise<void> {
    const pattern = this.patterns.find((p) => p.id === patternId);
    if (!pattern) return;
    if (action === "tags") {
      const tags = await editTags(pattern.title, pattern.tags, this.facets.tags);
      if (!tags) return;
      try {
        await api.updatePattern({ ...pattern, tags });
      } catch (err) {
        return this.flash(err instanceof Error ? err.message : String(err), true);
      }
      if (tags.some((t) => !this.facets.tags.includes(t))) this.facets.tags = [...new Set([...this.facets.tags, ...tags])].sort();
      await this.refreshCard(patternId);
    } else if (action === "details") {
      this.root.dispatchEvent(new CustomEvent("edit-pattern-here", { bubbles: true, detail: pattern }));
    } else if (action === "cover") {
      if (await changeCover(pattern)) await this.afterCoverChange(patternId);
    } else if (action === "project") {
      this.root.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: { patternId } }));
    }
  }

  /** A pattern changed elsewhere (its details, a project started from it): its card again. */
  async refreshPattern(patternId: string): Promise<void> {
    await this.refreshCard(patternId);
  }

  /**
   * "Want to knit" on and off from the card. A pattern in progress or
   * finished becomes one wanted again; one wanted goes back to no status.
   */
  private async toggleWant(patternId: string): Promise<void> {
    const pattern = this.patterns.find((p) => p.id === patternId);
    if (!pattern) return;
    const next = pattern.status === "want-to-knit" ? "" : "want-to-knit";
    let saved: Pattern;
    try {
      saved = await api.setPatternStatus(patternId, next);
    } catch (err) {
      this.flash(err instanceof Error ? err.message : String(err), true);
      return;
    }
    Object.assign(pattern, saved);
    const card = this.results.querySelector<HTMLElement>(`.card[data-open="${patternId}"]`);
    if (!card) return;
    card.querySelector(".card-meta [data-status]")?.remove();
    card.querySelector(".card-meta")?.insertAdjacentHTML("afterbegin", statusPill(saved.status));
    const btn = card.querySelector<HTMLElement>('[data-act="want"]');
    if (btn) btn.outerHTML = wantButton(saved);
  }

  // ---------- AI ----------

  private async startScan(): Promise<void> {
    // One run at a time; asking again shows the one going.
    if (describing()) return showDescribePanel();
    if (!this.settings.enabled) return;
    if (!this.settings.baseUrl.trim()) {
      this.root.dispatchEvent(
        new CustomEvent("open-settings", { bubbles: true, detail: this.settings }),
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
        `Only the first pages of each pattern are sent, to ${
          this.settings.isLocal ? "your own network" : this.settings.baseUrl
        }: the part with the designer, sizes and materials, never the whole pattern.\n\n` +
        `It keeps going while you use the rest of the app.`,
      { title: "Describe with your model", okLabel: "Describe" },
    );
    if (!confirmed) return;
    startDescribing(targets, this.settings);
  }

  /** One card brought up to date after the model changed its pattern. */
  private async refreshCard(patternId: string): Promise<void> {
    const fresh = await api.getPattern(patternId).catch(() => null);
    const i = this.patterns.findIndex((p) => p.id === patternId);
    if (!fresh || i < 0) return;
    this.patterns[i] = fresh;
    const card = this.results.querySelector<HTMLElement>(`.card[data-open="${patternId}"]`);
    if (!card) return;
    card.insertAdjacentHTML("afterend", this.cardHtml(fresh));
    const next = card.nextElementSibling as HTMLElement;
    card.remove();
    await this.fillCard(next);
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
    for (const card of this.root.querySelectorAll<HTMLElement>(".card")) await this.undoButtonFor(card);
  }

  private async undoButtonFor(card: HTMLElement): Promise<void> {
    const id = card.dataset.open;
    if (!id || card.querySelector("[data-act='undo-ai']")) return;
    // The row exists in the card markup, but is emptied by `:empty` in CSS
    // when nothing is in it, so look it up rather than assuming.
    const row = card.querySelector<HTMLElement>(".card-tools-row");
    if (!row) return;
    try {
      if (await api.hasAiHistory(id)) {
        row.insertAdjacentHTML(
          "afterbegin",
          // An icon, its words shown only on hover or focus, so it does not
          // crowd the row on every card the model has touched.
          `<button class="card-undo" data-act="undo-ai" data-id="${id}"
             aria-label="Undo model change"><span aria-hidden="true">↶</span><span class="card-undo-label">Undo model change</span></button>`,
        );
      }
    } catch {
      // Not worth surfacing; the button simply does not appear.
    }
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

  /** The ticked values of one filter group; the boxes are the source of truth. */
  private checkedValues(field: string): string[] {
    return [...this.root.querySelectorAll<HTMLInputElement>(
      `input[data-filter="${field}"]:checked`,
    )].map((i) => i.value);
  }

  /**
   * Lists the patterns matching the current filter.
   *
   * Status, difficulty, designer and needle size are single-valued in the
   * query, but their filters allow several boxes to be ticked, meaning "any
   * of these". Each combination of ticked values gets its own request and the
   * results are merged, so every reload honours all ticked boxes rather than
   * only the first of each group.
   */
  private async queryPatterns(): Promise<Pattern[]> {
    const groups = ["status", "difficulty", "designer", "needleSize"].map((field) => ({
      field,
      values: this.checkedValues(field),
    }));
    const base: Filter = { ...this.filter };
    for (const g of groups) {
      (base as Record<string, unknown>)[g.field] = g.values.length ? g.values[0] : undefined;
    }
    let queries: Filter[] = [base];
    for (const g of groups) {
      if (g.values.length > 1) {
        queries = queries.flatMap((q) => g.values.map((v) => ({ ...q, [g.field]: v })));
      }
    }
    const batches = await Promise.all(queries.map((q) => api.listPatterns(q)));
    const seen = new Set<string>();
    return batches.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }

  /**
   * Incremented on every reload. Listing is async, so two quick changes — a
   * search keystroke while a filter query is still running, say — would
   * otherwise resolve out of order and the older, slower response would
   * paint over the newer one. Each reload captures this value and abandons
   * its result if it is no longer current.
   */
  private listToken = 0;

  private async reload(): Promise<void> {
    const token = ++this.listToken;
    const patterns = await this.queryPatterns();
    if (token !== this.listToken) return;
    this.patterns = patterns;
    this.paint();
  }

  private stopLazy: (() => void) | null = null;

  private paint(): void {
    this.stopLazy?.();
    this.stopLazy = null;
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

    // A page of cards at a time; each card's cover, and its undo button, are
    // read when it comes near the screen.
    this.stopLazy = paintLazily(this.results, this.patterns, (p) => this.cardHtml(p), {
      pictures: ".card",
      paint: (card) => this.fillCard(card),
    });
  }

  private async fillCard(card: HTMLElement): Promise<void> {
    const id = card.dataset.open!;
    const pattern = this.patterns.find((p) => p.id === id);
    if (pattern?.coverPath) {
      const host = card.querySelector<HTMLElement>('[data-el="photo"]');
      const url = await coverUrl(id);
      if (host && url) {
        host.style.backgroundImage = `url("${url}")`;
        host.parentElement?.classList.add("has-cover");
      }
    }
    await this.undoButtonFor(card);
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
            <button class="card-tool" data-act="cover" data-id="${p.id}"
              title="Change the cover: paste a picture, drop one, or choose one">Cover…</button>
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
            ${wantButton(p)}
            <button class="card-more" data-act="more" data-id="${p.id}" aria-label="More"
              title="Status, tags, details, cover, start a project">⋯</button>
            <button class="card-remove" data-delete="${p.id}"
              title="Remove this pattern from your library">Remove</button>
          </div>
        </div>
      </article>`;
  }


  /**
   * Repaints one card's cover after it was saved behind the view's back.
   *
   * Used when a cover arrives after the grid was painted — a new pattern's
   * cover is read from its file in the background while the library is already
   * on screen — so the card does not keep its placeholder until the next
   * mount. Same idea as `loadCovers`, but for a single pattern.
   */
  async refreshCover(patternId: string): Promise<void> {
    forgetCover(patternId);
    const host = this.results.querySelector(
      `.cover[data-id="${patternId}"] [data-el="photo"]`,
    ) as HTMLElement | null;
    if (!host) return;
    const url = await coverUrl(patternId);
    if (!url) return;
    host.style.backgroundImage = `url("${url}")`;
    host.parentElement?.classList.add("has-cover");
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
  // No status is no pill: most of a large library is simply there.
  if (!status) return "";
  // Status is a free string in the database, so the label is escaped, and
  // only a known value earns its own class; anything else gets the default.
  const known = STATUSES.find((s) => s.value === status);
  const cls = known ? `status-${status}` : "status-other";
  return `<span class="pill ${cls}" data-status>${escapeHtml(known?.label ?? status)}</span>`;
}

/** The card's own "Want to knit" switch, lit when it is wanted. */
function wantButton(p: Pattern): string {
  const on = p.status === "want-to-knit";
  return `<button class="card-want${on ? " on" : ""}" data-act="want" data-id="${p.id}" aria-pressed="${on}"
    title="${on ? "Planned to knit soon. Click to take it off the list." : "Mark it as one to knit soon"}">${on ? "★" : "☆"} Want to knit</button>`;
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
  // A family the table does not recognise falls back to the stated weight:
  // it is still the useful information, and hiding it helps no one.
  const label = YARN_LABELS.get(family) ?? stated;
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
