import { api, type Masterclass, type Project } from "../api";
import { masterclassThumbUrl } from "../covers";
import { askForm, askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";

/** The one open, remembered after. */
function readOpen(): string {
  try {
    return localStorage.getItem("masterclasses:open") ?? "";
  } catch {
    return "";
  }
}

function keepOpen(id: string): void {
  try {
    localStorage.setItem("masterclasses:open", id);
  } catch {
    // Remembered for this run only.
  }
}

/** A YouTube video's player, to show it here: on the privacy-minded host, which sets no cookies until played. */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

/** The player for a video, as a frame: sandboxed, as a cheatsheet's page is. */
export function playerHtml(m: Pick<Masterclass, "videoId" | "title">, className = "mc-player"): string {
  return `<iframe class="${className}" src="${esc(embedUrl(m.videoId))}" title="${esc(m.title)}" referrerpolicy="strict-origin-when-cross-origin"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
    allow="fullscreen; encrypted-media; picture-in-picture; autoplay" allowfullscreen></iframe>`;
}

/**
 * The Masterclasses tab: videos kept to learn from, listed down the side
 * with their pictures, the one open beside them -- played here when YouTube
 * lets it, else in the browser or a window of its own -- with notes, and the
 * projects knitted along with it.
 */
export class MasterclassesView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private classes: Masterclass[] = [];
  private projects: Project[] = [];
  private openId = readOpen();
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library cheatsheets masterclasses";
    this.root.innerHTML = `
      <header class="lib-bar">
        <h1>Masterclasses</h1>
        <div class="lib-actions">
          <input type="search" class="mc-search" data-f="search" placeholder="Search titles, channels, notes…" aria-label="Search the masterclasses" />
          <button class="primary" data-act="add" title="A YouTube video, or any other: kept to learn from">+ Add a video</button>
        </div>
      </header>
      <div class="lib-body">
        <aside class="filters sheet-list mc-list" data-el="list"></aside>
        <main class="sheet-view" data-el="view"></main>
      </div>`;
    this.screen.appendChild(this.root);
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("change", (e) => void this.onChange(e));
    this.root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.f !== "search") return;
      this.search = el.value;
      this.paintList();
    });
    [this.classes, this.projects] = await Promise.all([api.listMasterclasses().catch(() => [] as Masterclass[]), api.listProjects().catch(() => [] as Project[])]);
    if (!this.classes.some((m) => m.id === this.openId)) this.openId = this.classes[0]?.id ?? "";
    this.paintList();
    this.paintView();
  }

  destroy(): void {
    this.root?.remove();
  }

  private open(): Masterclass | undefined {
    return this.classes.find((m) => m.id === this.openId);
  }

  private shown(): Masterclass[] {
    const words = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.classes.filter((m) => {
      const text = `${m.title} ${m.channel} ${m.notes}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }

  // ---------- the list ----------

  private paintList(): void {
    const list = this.root.querySelector<HTMLElement>('[data-el="list"]')!;
    const shown = this.shown();
    list.innerHTML = shown.length
      ? shown
          .map(
            (m) => `
          <button class="sheet-item mc-item${m.id === this.openId ? " on" : ""}" data-class="${esc(m.id)}" title="${esc(m.title)}">
            <span class="mc-thumb" data-thumb="${m.hasThumb ? esc(m.id) : ""}" aria-hidden="true">${m.hasThumb ? "" : "▶"}</span>
            <span class="sheet-text"><b>${esc(m.title)}</b><span>${esc(m.channel || host(m.url))}${m.projectCount ? ` · ${m.projectCount} project${m.projectCount === 1 ? "" : "s"}` : ""}</span></span>
          </button>`,
          )
          .join("")
      : `<p class="hint sheet-none">${this.classes.length ? "Nothing matches the search." : "No videos yet."}</p>`;
    for (const thumb of list.querySelectorAll<HTMLElement>("[data-thumb]")) {
      const id = thumb.dataset.thumb;
      if (!id) continue;
      void masterclassThumbUrl(id).then((url) => {
        if (url) thumb.style.backgroundImage = `url("${url}")`;
      });
    }
  }

  // ---------- the one open ----------

  private paintView(): void {
    const view = this.root.querySelector<HTMLElement>('[data-el="view"]')!;
    const m = this.open();
    if (!m) {
      view.innerHTML = `
        <div class="empty">
          <h2>No masterclasses yet</h2>
          <p>Keep the videos you learn from: a cast-on, a technique, a whole course. Paste a YouTube link with <b>+ Add a video</b>: its title, channel and picture come with it.</p>
          <p class="hint">A project can be knitted along with one: choose it on the project's page, and watch it there.</p>
        </div>`;
      return;
    }
    const along = this.projects.filter((p) => p.masterclassId === m.id);
    view.innerHTML = `
      <header class="sheet-head">
        <input class="sheet-title" data-f="title" value="${esc(m.title)}" aria-label="Its name" maxlength="200" />
        <span class="hint sheet-source">${esc(m.channel || host(m.url))}</span>
        <span class="sheet-tools">
          <button class="ghost" data-act="browser" title="In your web browser">Browser ↗</button>
          <button class="ghost" data-act="window" title="In a window of its own, beside the app">Window ↗</button>
          <button class="ghost danger-text" data-act="remove">Remove</button>
        </span>
      </header>
      <div class="mc-body">
        ${
          m.videoId
            ? `${playerHtml(m)}<p class="hint mc-player-note">Not playing here? Some videos only play on YouTube: <button class="link" data-act="browser">open it in your browser</button>.</p>`
            : `<div class="empty mc-elsewhere"><h2>Played where it is kept</h2><p>Only YouTube videos play here. This one opens in your browser, or in a window of its own.</p></div>`
        }
        <label class="field"><span>Notes</span>
          <textarea data-f="notes" rows="4" placeholder="What it teaches, where the good bit starts (12:30), what to remember…" maxlength="4000">${esc(m.notes)}</textarea></label>
        <div class="field"><span>Knitted along with it</span>
          ${
            along.length
              ? `<div class="mc-projects">${along.map((p) => `<button class="ghost" data-project="${esc(p.id)}" title="Open the project">${esc(p.name)}</button>`).join("")}</div>`
              : `<p class="hint">No project yet: choose it on a project's page, under Masterclass.</p>`
          }
        </div>
      </div>`;
  }

  // ---------- doing things ----------

  private async onClick(e: MouseEvent): Promise<void> {
    const item = closestEl(e.target, "[data-class]");
    if (item) {
      this.openId = item.dataset.class!;
      keepOpen(this.openId);
      this.paintList();
      return this.paintView();
    }
    const project = closestEl(e.target, "[data-project]")?.dataset.project;
    if (project) return void this.root.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: project }));
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "add") return this.add();
    const m = this.open();
    if (!m) return;
    try {
      if (act === "browser") await api.openLink(m.url);
      if (act === "window") await api.openCheatsheetWindow(`mc-${m.id}`, m.url, m.title);
      if (act === "remove") {
        const along = m.projectCount ? ` ${m.projectCount === 1 ? "The project knitted along with it keeps going" : "The projects knitted along with it keep going"} without it.` : "";
        if (!(await askYesNo(`Remove the masterclass “${m.title}”?${along}`, { title: "Remove masterclass", okLabel: "Remove", danger: true }))) return;
        await api.deleteMasterclass(m.id);
        const at = this.classes.indexOf(m);
        this.classes = this.classes.filter((x) => x.id !== m.id);
        this.projects = this.projects.map((p) => (p.masterclassId === m.id ? { ...p, masterclassId: "", masterclassTitle: "" } : p));
        this.openId = this.classes[Math.min(at, this.classes.length - 1)]?.id ?? "";
        keepOpen(this.openId);
        this.paintList();
        this.paintView();
      }
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Masterclass");
    }
  }

  /** The name and the notes, saved as they are changed. */
  private async onChange(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const f = el.dataset.f;
    const m = this.open();
    if (!m || (f !== "title" && f !== "notes")) return;
    const value = el.value.trim();
    if (f === "title" && !value) {
      el.value = m.title;
      return;
    }
    // Kept here first, so a second change made before the first is saved
    // does not save the first one's field back as it was.
    const changed = { ...m, [f]: value };
    this.classes = this.classes.map((x) => (x.id === m.id ? changed : x));
    try {
      await api.updateMasterclass(changed);
      if (f === "title") this.paintList();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Masterclass");
    }
  }

  private async add(): Promise<void> {
    const answer = await askForm(
      [
        { label: "Link", placeholder: "https://www.youtube.com/watch?v=…" },
        { label: "Name", placeholder: "Optional: the video's own title is used" },
      ],
      { title: "A video to learn from", okLabel: "Keep it" },
    );
    if (!answer) return;
    const list = this.root.querySelector<HTMLElement>('[data-el="list"]')!;
    list.insertAdjacentHTML("afterbegin", `<p class="hint sheet-none" data-el="asking">Asking YouTube for it…</p>`);
    try {
      const m = await api.addMasterclass({ url: answer.Link, title: answer.Name });
      this.classes = [m, ...this.classes.filter((x) => x.id !== m.id)];
      this.openId = m.id;
      keepOpen(m.id);
      this.search = "";
      const search = this.root.querySelector<HTMLInputElement>('[data-f="search"]');
      if (search) search.value = "";
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "A video to learn from");
    }
    this.paintList();
    this.paintView();
  }
}

/** A web address's site, without www. */
function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
