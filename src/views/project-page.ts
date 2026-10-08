import { api, isLive, isRecord, MEASUREMENTS, projectStatusLabel, type MeasureUnit, type Pattern, type Person, type Project, type ProjectInput, type ProjectStatus, type Tool } from "../api";
import { askYesNo, dialogOpen, say } from "../dialogs";
import { RowCounter } from "../reader/counter";
import { ReaderView } from "../reader/reader";
import { blobBytes, forgetProjectCover, prepareBoardImage, projectCoverUrl } from "../covers";
import { closestEl } from "../dom";
import { mountPatternPicker } from "./pattern-picker";
import { Board } from "./board";
import { ProjectLog } from "./project-log";
import { fromDateInput, toDateInput } from "./project-form";
import { describe } from "./tool-filter";
import { latestShoeSize, latestValue, measurementLabel, showLengthWithUnit } from "./measure";
import { longDate } from "./project-form";

export interface ProjectPageHooks {
  back(): void;
  openPattern(id: string): void;
  /** Opens the dialog for choosing its needles and yarn. */
  editLinks(project: Project): void;
  finish(project: Project): void;
  /** After the project was removed. */
  removed(): void;
}

/** Which each project's page showed last, its board or its log, while the app is open. */
const shownOf = new Map<string, "board" | "log">();

/** The longest side a project cover is kept at. */
const COVER_SIDE = 1000;

/** How the pattern sits on the page: open beside the board, a tab at the edge, or not there. */
type PaneState = "open" | "minimised" | "closed";

/** The narrowest the pattern pane and the board beside it may be, in pixels. */
const PANE_MIN = 340;
const BOARD_MIN = 260;

/**
 * One project's own page: what it is down the side -- a cover, its name and
 * pattern, when it was started and finished, its needles and yarn, notes --
 * and its board filling the rest.
 *
 * Details save as they are changed, as the reader's notes do; there is no
 * Save button to forget.
 */
export class ProjectPage {
  private screen: HTMLElement;
  private projectId: string;
  private hooks: ProjectPageHooks;
  private root!: HTMLElement;
  private project!: Project;
  private patterns: Pattern[] = [];
  private tools: Tool[] = [];
  /** The people a project can be for, and how their measurements are shown. */
  private people: Person[] = [];
  private unit: MeasureUnit = "cm";
  private board: Board | null = null;
  private teardown: (() => void)[] = [];
  /** The name or notes typed and not yet saved. */
  private typingTimer: number | null = null;
  /**
   * The pattern's row counter, the same counts as in the pattern itself. Its
   * element is kept across redraws of the side panel, so it keeps its state.
   */
  private counter: RowCounter | null = null;
  private counterHost: HTMLElement | null = null;
  private counterPattern: string | null = null;
  /** The pattern, read beside the board. */
  private reader: ReaderView | null = null;
  /** The project's log, made the first time it is shown. */
  private log: ProjectLog | null = null;

  constructor(screen: HTMLElement, projectId: string, hooks: ProjectPageHooks) {
    this.screen = screen;
    this.projectId = projectId;
    this.hooks = hooks;
  }

  get id(): string {
    return this.projectId;
  }

  async mount(): Promise<void> {
    const projects = await api.listProjects();
    const found = projects.find((p) => p.id === this.projectId);
    if (!found) {
      await say("That project is no longer there.");
      this.hooks.back();
      return;
    }
    this.project = found;
    [this.patterns, this.tools, this.people, this.unit] = await Promise.all([
      api.listPatterns({}).catch(() => [] as Pattern[]),
      api.listTools().catch(() => [] as Tool[]),
      api.listPeople().catch(() => [] as Person[]),
      api.getMeasureUnit().catch(() => "cm" as const),
    ]);

    this.root = document.createElement("div");
    this.root.className = "project-page";
    this.root.innerHTML = `
      <aside class="project-side"></aside>
      <div class="project-main">
        <div class="seg project-view-switch" role="tablist" aria-label="Show">
          <button data-view="board" role="tab">Board</button>
          <button data-view="log" role="tab">Log</button>
        </div>
        <div class="project-board"></div>
        <section class="project-log" hidden></section>
        <section class="project-pattern" hidden>
          <div class="project-pattern-grip" title="Drag to make the pattern wider or narrower"></div>
          <header class="project-pattern-bar">
            <strong data-el="pattern-title"></strong>
            <button class="ghost" data-pane="full" title="Open the pattern on its own, full size">Open full ↗</button>
            <button class="ghost" data-pane="min" title="Minimise: it stays open at the edge" aria-label="Minimise">–</button>
            <button class="ghost" data-pane="close" title="Close the pattern" aria-label="Close">×</button>
          </header>
          <div class="project-pattern-body"></div>
        </section>
        <button class="project-pattern-tab" data-pane="restore" hidden title="Show the pattern again">📄 <span>Pattern</span></button>
      </div>`;
    this.screen.appendChild(this.root);
    await this.syncCounter();
    this.renderSide();
    this.bindPane();

    this.board = new Board(this.root.querySelector<HTMLElement>(".project-board")!, this.projectId, {
      project: () => this.project,
      openPattern: (id) => this.hooks.openPattern(id),
      openLog: () => void this.show("log"),
    });
    await this.board.mount();
    this.root.querySelector(".project-view-switch")!.addEventListener("click", (e) => {
      const view = closestEl(e.target, "[data-view]")?.dataset.view;
      if (view === "board" || view === "log") void this.show(view);
    });
    await this.show(shownOf.get(this.projectId) ?? "board");

    // The pattern comes back the way it was left on this project.
    const was = this.savedPane();
    if (this.project.patternId && was !== "closed") await this.openPane(was);

    // The count keys count here too, away from the pattern: a row, or a
    // counter's own key. Not while typing, nor inside the pattern, which
    // counts for itself.
    const onKey = (e: KeyboardEvent) => {
      if (!this.counter || dialogOpen() || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest?.("input, textarea, select, [contenteditable], .project-pattern")) return;
      if (this.counter.handleCountKey(e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    this.teardown.push(() => document.removeEventListener("keydown", onKey));

    // A picture pasted while the cover is chosen is the cover.
    const onPaste = (e: ClipboardEvent) => {
      if (!(document.activeElement as HTMLElement | null)?.closest?.("[data-cover]")) return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void this.setCover(file);
    };
    document.addEventListener("paste", onPaste);
    this.teardown.push(() => document.removeEventListener("paste", onPaste));
  }

  /** Saves the name or notes still being typed, and takes the page down. */
  destroy(): void {
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
      void this.saveDetails();
    }
    for (const undo of this.teardown) undo();
    this.reader?.destroy();
    this.reader = null;
    this.log?.destroy();
    this.board?.destroy();
    this.root?.remove();
  }

  /** Shows the board, or the log, which is read the first time it is shown. */
  private async show(view: "board" | "log"): Promise<void> {
    shownOf.set(this.projectId, view);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-view]")) {
      b.classList.toggle("on", b.dataset.view === view);
      b.setAttribute("aria-selected", String(b.dataset.view === view));
    }
    this.root.querySelector<HTMLElement>(".project-board")!.hidden = view !== "board";
    const host = this.root.querySelector<HTMLElement>(".project-log")!;
    host.hidden = view !== "log";
    // Each side catches up with what was written in the other: the log on
    // its page, or its card on the board.
    if (view === "log" && !this.log) {
      this.log = new ProjectLog(host, this.projectId);
      await this.log.mount();
    } else if (view === "log") {
      await this.log?.reload();
    } else if (this.log) {
      await this.board?.refreshLog();
    }
  }

  /** Re-reads the project after a dialog changed it: needles, yarn, finishing. */
  async refresh(): Promise<void> {
    const found = (await api.listProjects().catch(() => [] as Project[])).find((p) => p.id === this.projectId);
    if (!found) return this.hooks.removed();
    this.project = found;
    this.tools = await api.listTools().catch(() => this.tools);
    this.people = await api.listPeople().catch(() => this.people);
    this.unit = await api.getMeasureUnit().catch(() => this.unit);
    await this.syncCounter();
    this.renderSide();
    await this.board?.refreshLinked();
    // A status change or finishing writes a milestone.
    await this.log?.reload();
  }

  private renderSide(): void {
    const p = this.project;
    const side = this.root.querySelector<HTMLElement>(".project-side")!;
    // Finished or frogged: what it used is a record now.
    const finished = isRecord(p.status);
    const plan = p.status === "planned";
    const tools = p.toolIds.map((id) => this.tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
    side.innerHTML = `
      <button class="ghost back" data-act="back">← Projects</button>

      <div class="project-cover" data-cover tabindex="0" title="Paste a picture here with Ctrl+V, drop one, or choose one">
        <span class="project-cover-empty">Cover — click here and paste, drop a picture, or choose one</span>
      </div>
      <div class="project-cover-actions">
        <button class="ghost" data-act="cover-file">Choose…</button>
        <button class="ghost" data-act="cover-remove" ${p.coverPath ? "" : "hidden"}>Remove</button>
      </div>

      <input class="project-title" data-f="name" value="${esc(p.name)}" aria-label="Project name" />
      ${
        plan
          ? `<div class="project-plan-head"><span class="pill project-planned">Planned${p.planWhen || p.planDate ? `: ${esc([p.planWhen, p.planDate ? longDate(p.planDate) : ""].filter(Boolean).join(", "))}` : ""}</span>
               <button class="primary" data-act="start-plan" title="Start knitting it: from today, its pattern in progress, its yarn in use">Start knitting</button></div>`
          : p.status === "finished"
          ? `<span class="pill project-finished">Finished</span>`
          : `<label class="field project-status"><span>Status</span>
              <select data-f="status" title="Paused keeps its needles and yarn; frogged frees them">
                ${(["active", "paused", "frogged"] as ProjectStatus[])
                  .map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s === "active" && p.status === "frogged" ? "Active (start again)" : projectStatusLabel(s)}</option>`)
                  .join("")}
              </select></label>`
      }

      <div class="field">
        <span>Pattern</span>
        <div data-el="pattern-pick"></div>
      </div>
      ${
        p.patternId
          ? `<div class="project-pattern-links">
               <button class="ghost" data-act="show-pattern" title="Read the pattern here, beside the board">📄 Show the pattern here</button>
               <button class="link" data-act="open-pattern" title="Open the pattern on its own">Open it full ↗</button>
             </div>
             <div data-el="counter"></div>`
          : ""
      }

      <label class="field">
        <span>For</span>
        <select data-f="person">
          <option value="">No one in particular</option>
          ${this.people.map((pe) => `<option value="${esc(pe.id)}" ${pe.id === p.personId ? "selected" : ""}>${esc(pe.name)}</option>`).join("")}
        </select>
        ${this.people.length ? "" : `<span class="hint">Add the people you knit for in the People tab.</span>`}
      </label>
      ${this.personMeasures()}

${plan ? "" : `      <div class="project-side-dates">
        <label class="field"><span>Started</span><input type="date" data-f="started" value="${toDateInput(p.startedAt)}" /></label>
        <label class="field"><span>${p.status === "frogged" ? "Frogged" : "Finished"}</span>${
          finished
            ? `<input type="date" data-f="finished" value="${toDateInput(p.finishedAt ?? Date.now())}" />`
            : `<button class="ghost" data-act="finish" title="Release the needles and record the leftover yarn">Finish…</button>`
        }</label>
      </div>`}

      <div class="side-section">
        <h3>Needles, hooks &amp; cables</h3>
        ${tools.length ? `<ul class="tool-list record">${tools.map((t) => `<li><span>${esc(describe(t))}</span></li>`).join("")}</ul>` : `<p class="hint">None${finished ? " recorded" : " yet"}.</p>`}
        <h3>Yarn</h3>
        ${
          p.yarns.length
            ? `<ul class="tool-list record">${p.yarns
                .map((y) => {
                  const left = y.leftoverGrams === null ? "" : y.leftoverGrams === 0 ? " · used up" : ` · ${y.leftoverGrams} g left`;
                  const takes = y.plannedGrams && !finished ? ` · will take ${y.plannedGrams} g` : "";
                  return `<li><span>${esc(`${y.yarnName}${y.dyeLot ? ` — lot ${y.dyeLot}` : ""}${takes}${left}`)}</span></li>`;
                })
                .join("")}</ul>`
            : `<p class="hint">None${finished ? " recorded" : " yet"}.</p>`
        }
        ${finished ? "" : `<button class="ghost" data-act="edit-links">${plan ? "Choose yarn…" : "Choose needles &amp; yarn…"}</button>`}
      </div>

      <label class="field">
        <span>Notes</span>
        <textarea data-f="notes" placeholder="Size made, changes to the pattern, who it is for…">${esc(p.notes)}</textarea>
      </label>

      <button class="ghost danger-text" data-act="remove">Remove project</button>
    `;
    // The counter's element is moved back in, not rebuilt, so it keeps its state.
    const slot = side.querySelector('[data-el="counter"]');
    if (slot && this.counterHost) slot.replaceWith(this.counterHost);
    mountPatternPicker(side.querySelector<HTMLElement>('[data-el="pattern-pick"]')!, this.patterns, p.patternId);
    side.onclick = (e) => void this.onClick(e);
    side.onchange = (e) => void this.onChange(e);
    // The name and notes save a moment after typing stops, too, so nothing
    // typed is lost to opening another page before the field is left.
    side.oninput = (e) => {
      const f = (e.target as HTMLElement).dataset.f;
      if (f !== "name" && f !== "notes") return;
      if (this.typingTimer !== null) clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => {
        this.typingTimer = null;
        void this.saveDetails();
      }, 800);
    };
    const cover = side.querySelector<HTMLElement>("[data-cover]")!;
    cover.ondragover = (e) => {
      e.preventDefault();
      cover.classList.add("over");
    };
    cover.ondragleave = () => cover.classList.remove("over");
    cover.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      cover.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void this.setCover(file);
    };
    void this.paintCover();
  }

  /**
   * The latest measurements of the person it is for: every one they have,
   * since which matter depends on what is being knitted.
   */
  private personMeasures(): string {
    const person = this.people.find((pe) => pe.id === this.project.personId);
    if (!person) return "";
    const keys = [...MEASUREMENTS.map((m) => m.key as string), ...person.extra.map((e) => `x:${e}`)];
    const known = keys.map((key) => ({ key, v: latestValue(person, key) })).filter((m) => m.v);
    const shoe = latestShoeSize(person);
    const newest = known.reduce((at, m) => Math.max(at, m.v!.at), 0);
    const rows = [
      ...known.map((m) => `<li><span>${esc(measurementLabel(m.key))}</span><b>${esc(showLengthWithUnit(m.v!.cm, this.unit))}</b></li>`),
      ...(shoe ? [`<li><span>Shoe size</span><b>${esc(shoe)}</b></li>`] : []),
    ];
    return `
      <div class="side-section project-person">
        <h3>${esc(person.name)}'s measurements${newest ? ` <span class="hint">${esc(longDate(newest))}</span>` : ""}</h3>
        ${rows.length ? `<ul class="person-measures">${rows.join("")}</ul>` : `<p class="hint">None taken yet.</p>`}
        <button class="link" data-act="open-person">${rows.length ? "All their measurements" : "Measure them"} ↗</button>
      </div>`;
  }

  private async paintCover(): Promise<void> {
    const box = this.root.querySelector<HTMLElement>("[data-cover]");
    if (!box) return;
    const url = this.project.coverPath ? await projectCoverUrl(this.projectId) : null;
    box.style.backgroundImage = url ? `url("${url}")` : "";
    box.classList.toggle("filled", !!url);
  }

  private async setCover(file: Blob): Promise<void> {
    const prepared = await prepareBoardImage(file, COVER_SIDE);
    if (!prepared) return void (await say("That could not be read as a picture.", "Cover"));
    try {
      await api.setProjectCover(this.projectId, await blobBytes(prepared.blob));
    } catch (err) {
      return void (await say(err instanceof Error ? err.message : String(err), "Cover"));
    }
    forgetProjectCover(this.projectId);
    this.project.coverPath = "set";
    this.root.querySelector<HTMLElement>('[data-act="cover-remove"]')!.hidden = false;
    await this.paintCover();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "back") this.hooks.back();
    if (act === "open-pattern" && this.project.patternId) this.hooks.openPattern(this.project.patternId);
    if (act === "show-pattern") await this.openPane("open");
    if (act === "edit-links") this.hooks.editLinks(this.project);
    if (act === "open-person" && this.project.personId) {
      this.root.dispatchEvent(new CustomEvent("open-person", { bubbles: true, detail: this.project.personId }));
    }
    if (act === "finish") this.hooks.finish(this.project);
    if (act === "start-plan") {
      try {
        this.project = await api.setProjectStatus(this.projectId, "active");
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Start knitting"));
      }
      this.renderSide();
      void this.log?.reload();
    }
    if (act === "cover-file") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void this.setCover(file);
      });
      input.click();
    }
    if (act === "cover-remove") {
      await api.removeProjectCover(this.projectId).catch(() => {});
      forgetProjectCover(this.projectId);
      this.project.coverPath = "";
      btn.hidden = true;
      await this.paintCover();
    }
    if (act === "remove") {
      const what = isLive(this.project.status) ? " Its needles and yarn go back to free; they are not removed." : "";
      if (!(await askYesNo(`Remove the project “${this.project.name}” and its board?${what} This cannot be undone.`, { title: "Remove project", okLabel: "Remove", danger: true }))) return;
      try {
        await api.deleteProject(this.projectId);
      } catch (err) {
        return void (await say(err instanceof Error ? err.message : String(err), "Remove project"));
      }
      this.hooks.removed();
    }
  }

  /** Every detail saves as soon as it is changed. */
  private async onChange(e: Event): Promise<void> {
    const f = (e.target as HTMLElement).dataset.f;
    if (!f) return;
    if (f === "status") return void (await this.changeStatus((e.target as HTMLSelectElement).value as ProjectStatus));
    // Who it is for is saved on its own, so saving the details never clears it.
    if (f === "person") {
      try {
        this.project = await api.setProjectPerson(this.projectId, (e.target as HTMLSelectElement).value || null);
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "Project");
      }
      return this.renderSide();
    }
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (!(await this.saveDetails())) return;
    // A different pattern has its own counter, and its own pages to show.
    if (f === "pattern") {
      this.closePane();
      await this.syncCounter();
      // A new pattern is a milestone.
      void this.log?.reload();
    }
    // The pattern decides the Open link; the rest is already as typed.
    if (f === "pattern" || f === "name") this.renderSide();
  }

  // ---------- the pattern's counter ----------

  /** A counter for the project's pattern; a new one when the pattern changed. */
  private async syncCounter(): Promise<void> {
    const patternId = this.project.patternId;
    if (patternId === this.counterPattern) return;
    this.counterPattern = patternId;
    this.counterHost?.remove();
    this.counterHost = null;
    this.counter = null;
    if (!patternId) return;
    const host = document.createElement("div");
    host.className = "side-section project-counter";
    // The project's own counter: two projects from one pattern each count their own rows.
    const counter = new RowCounter(host, patternId, this.projectId);
    this.counterHost = host;
    this.counter = counter;
    await counter.refresh().catch(() => {});
  }

  // ---------- the pattern beside the board ----------

  private paneKey(): string {
    return `project-pattern:${this.projectId}`;
  }

  private savedPane(): PaneState {
    try {
      // Open unless it was closed here: the pattern beside the board is how a project is knitted.
      const v = localStorage.getItem(this.paneKey());
      return v === "closed" || v === "minimised" ? v : "open";
    } catch {
      return "open";
    }
  }

  private setPane(state: PaneState): void {
    const section = this.root.querySelector<HTMLElement>(".project-pattern")!;
    section.hidden = state !== "open";
    this.root.querySelector<HTMLElement>(".project-pattern-tab")!.hidden = state !== "minimised";
    this.root.classList.toggle("pattern-open", state === "open");
    try {
      localStorage.setItem(this.paneKey(), state);
    } catch {
      // Remembering how the page was left is a nicety.
    }
    // A PDF fits its pages to the width it has, which just changed.
    if (state === "open") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  /** Shows the pattern beside the board, reading it in first if it is not there yet. */
  private async openPane(state: PaneState = "open"): Promise<void> {
    const patternId = this.project.patternId;
    if (!patternId || !this.counter) return;
    this.applyWidth();
    if (!this.reader) {
      let pattern: Pattern;
      try {
        pattern = await api.getPattern(patternId);
      } catch {
        return void (await say("That pattern could not be opened. It may have been removed.", "Pattern"));
      }
      this.root.querySelector<HTMLElement>('[data-el="pattern-title"]')!.textContent = pattern.title;
      this.root.querySelector<HTMLElement>(".project-pattern-tab span")!.textContent = pattern.title;
      // Shown before it is read in, so its pages are laid out at the pane's width.
      this.setPane(state);
      const body = this.root.querySelector<HTMLElement>(".project-pattern-body")!;
      body.innerHTML = "";
      this.reader = new ReaderView(body, pattern, "focus", {
        counter: this.counter,
        projectId: this.projectId,
        // A pin put on the board from the pattern shows on it at once.
        boardChanged: () => void this.board?.reloadItems(),
      });
      await this.reader.mount();
      return;
    }
    this.setPane(state);
  }

  private closePane(): void {
    this.reader?.destroy();
    this.reader = null;
    if (this.root) this.setPane("closed");
  }

  private widthKey = "project-pattern-width";

  /** The pane's width as it was last left, kept within the page. */
  private applyWidth(px?: number): void {
    const main = this.root.querySelector<HTMLElement>(".project-main")!;
    let width = px;
    if (width === undefined) {
      try {
        width = Number(localStorage.getItem(this.widthKey)) || 0;
      } catch {
        width = 0;
      }
    }
    const room = main.clientWidth || window.innerWidth - 320;
    if (!width) width = Math.round(room * 0.5);
    width = Math.max(PANE_MIN, Math.min(room - BOARD_MIN, width));
    main.style.setProperty("--pattern-width", `${width}px`);
  }

  private bindPane(): void {
    const main = this.root.querySelector<HTMLElement>(".project-main")!;
    main.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]")?.dataset.pane;
      if (act === "min") this.setPane("minimised");
      if (act === "restore") void this.openPane("open");
      if (act === "close") this.closePane();
      if (act === "full" && this.project.patternId) this.hooks.openPattern(this.project.patternId);
    });
    // Dragging the pane's left edge makes it wider or narrower.
    const grip = this.root.querySelector<HTMLElement>(".project-pattern-grip")!;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      main.classList.add("resizing");
      const right = main.getBoundingClientRect().right;
      const move = (ev: PointerEvent) => this.applyWidth(Math.round(right - ev.clientX));
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        main.classList.remove("resizing");
        const width = parseInt(main.style.getPropertyValue("--pattern-width"), 10);
        try {
          if (width) localStorage.setItem(this.widthKey, String(width));
        } catch {
          // As above: a nicety.
        }
        window.dispatchEvent(new Event("resize"));
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  /**
   * Active, paused or frogged. Frogging frees the needles and yarn, so it
   * asks first; starting a frogged one again takes back what is still free.
   */
  private async changeStatus(status: ProjectStatus): Promise<void> {
    if (
      status === "frogged" &&
      !(await askYesNo(`Frog “${this.project.name}”? Its needles go back to free and its yarn back to the stash; they stay listed on it as a record.`, { title: "Frog project", okLabel: "Frog it" }))
    ) {
      this.renderSide();
      return;
    }
    try {
      this.project = await api.setProjectStatus(this.projectId, status);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Project");
    }
    await this.refresh();
  }

  /** Saves the details as they stand on the page; false if that failed. */
  private async saveDetails(): Promise<boolean> {
    const value = (name: string) => this.root.querySelector<HTMLInputElement>(`.project-side [data-f="${name}"]`)?.value ?? "";
    const started = value("started");
    const finishedAt = value("finished");
    const input: ProjectInput = {
      name: value("name").trim(),
      patternId: value("pattern") || null,
      notes: value("notes"),
      startedAt: started ? fromDateInput(started) : null,
      finishedAt: finishedAt ? fromDateInput(finishedAt) : null,
      toolIds: this.project.toolIds,
      yarns: this.project.yarns.map((y) => ({ id: y.id, yarnId: y.yarnId, lotId: y.lotId })),
    };
    if (!input.name) return false;
    try {
      this.project = await api.updateProject(this.projectId, input);
      return true;
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Project");
      return false;
    }
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
