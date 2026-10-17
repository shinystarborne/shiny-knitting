import { api, type Masterclass, type MasterclassPart, type Pattern, type Project } from "../api";
import { masterclassThumbUrl } from "../covers";
import { askForm, askYesNo, customDialog, say } from "../dialogs";
import { closestEl } from "../dom";
import { mountPatternPicker } from "./pattern-picker";

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

/** Which of a masterclass's videos is being watched, where (the tab, or a project's page), remembered after. */
export function partShown(m: Masterclass, where: string): MasterclassPart {
  let id = "";
  try {
    id = localStorage.getItem(`masterclass-part:${where}`) ?? "";
  } catch {
    // The first video, then.
  }
  return m.parts.find((p) => p.id === id) ?? m.parts.find((p) => !p.watched) ?? m.parts[0];
}

export function showPart(where: string, partId: string): void {
  try {
    localStorage.setItem(`masterclass-part:${where}`, partId);
  } catch {
    // Remembered for this run only.
  }
}

/** A YouTube video's player, to show it here: on the privacy-minded host, which sets no cookies until played. */
export function embedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

/** The player for a video, as a frame: sandboxed, as a cheatsheet's page is. */
export function playerHtml(v: Pick<MasterclassPart, "videoId" | "title">, className = "mc-player"): string {
  return `<iframe class="${className}" src="${esc(embedUrl(v.videoId))}" title="${esc(v.title)}" referrerpolicy="strict-origin-when-cross-origin"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
    allow="fullscreen; encrypted-media; picture-in-picture; autoplay" allowfullscreen></iframe>`;
}

/** "3 videos, 1 watched", or nothing for one. */
export function partsSummary(m: Masterclass): string {
  if (m.parts.length < 2) return "";
  const watched = m.parts.filter((p) => p.watched).length;
  return `${m.parts.length} videos${watched ? `, ${watched === m.parts.length ? "all" : watched} watched` : ""}`;
}

/**
 * The Masterclasses tab: what is kept to learn from, each its videos -- one,
 * or several in order, a course or a knit-along -- listed down the side with
 * their pictures, the one open beside them: its video played here, or in
 * the browser or a window of its own; its videos, watched or not; notes, and
 * the projects knitted along with it, a new one started from it.
 */
export class MasterclassesView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private classes: Masterclass[] = [];
  private projects: Project[] = [];
  /** The library's patterns, for the one a masterclass goes with. */
  private patterns: Pattern[] = [];
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
    [this.classes, this.projects, this.patterns] = await Promise.all([
      api.listMasterclasses().catch(() => [] as Masterclass[]),
      api.listProjects().catch(() => [] as Project[]),
      api.listPatterns({}).catch(() => [] as Pattern[]),
    ]);
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

  /** A masterclass as it now is, in its place in the list. */
  private replace(m: Masterclass): void {
    this.classes = this.classes.some((x) => x.id === m.id) ? this.classes.map((x) => (x.id === m.id ? m : x)) : [m, ...this.classes];
  }

  private shown(): Masterclass[] {
    const words = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.classes.filter((m) => {
      const text = `${m.title} ${m.channel} ${m.notes} ${m.parts.map((p) => p.title).join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }

  // ---------- the list ----------

  private paintList(): void {
    const list = this.root.querySelector<HTMLElement>('[data-el="list"]')!;
    const shown = this.shown();
    list.innerHTML = shown.length
      ? shown
          .map((m) => {
            const pic = m.parts.find((p) => p.hasThumb);
            const said = [m.channel || host(m.parts[0]?.url ?? ""), partsSummary(m), m.projectCount ? `${m.projectCount} project${m.projectCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
            return `
          <button class="sheet-item mc-item${m.id === this.openId ? " on" : ""}" data-class="${esc(m.id)}" title="${esc(m.title)}">
            <span class="mc-thumb" data-thumb="${pic ? esc(pic.id) : ""}" aria-hidden="true">${pic ? "" : "▶"}${m.parts.length > 1 ? `<i class="mc-count">${m.parts.length}</i>` : ""}</span>
            <span class="sheet-text"><b>${esc(m.title)}</b><span>${esc(said)}</span></span>
          </button>`;
          })
          .join("")
      : `<p class="hint sheet-none">${this.classes.length ? "Nothing matches the search." : "No videos yet."}</p>`;
    paintThumbs(list);
  }

  // ---------- the one open ----------

  private paintView(): void {
    const view = this.root.querySelector<HTMLElement>('[data-el="view"]')!;
    const m = this.open();
    if (!m) {
      view.innerHTML = `
        <div class="empty">
          <h2>No masterclasses yet</h2>
          <p>Keep the videos you learn from: a cast-on, a technique, a whole course. Paste a YouTube link with <b>+ Add a video</b>: its title, channel and picture come with it. A course in several videos is one masterclass: add its other videos to it, or bundle the ones you have.</p>
          <p class="hint">Start a project from one, or choose it on a project's page, and watch it there.</p>
        </div>`;
      return;
    }
    const part = partShown(m, m.id);
    const along = this.projects.filter((p) => p.masterclassId === m.id);
    const many = m.parts.length > 1;
    view.innerHTML = `
      <header class="sheet-head">
        <input class="sheet-title" data-f="title" value="${esc(m.title)}" aria-label="Its name" maxlength="200" />
        <span class="hint sheet-source">${esc([m.channel || host(part.url), partsSummary(m)].filter(Boolean).join(" · "))}</span>
        <span class="sheet-tools">
          <button class="primary" data-act="start" title="A new project, knitted along with this${m.patternTitle ? `, and its pattern` : ""}">Start a project…</button>
          <button class="ghost" data-act="browser" title="This video in your web browser">Browser ↗</button>
          <button class="ghost" data-act="window" title="This video in a window of its own, beside the app">Window ↗</button>
          <button class="ghost" data-act="bundle" title="Make this and others one masterclass, a course in several videos" ${this.classes.length > 1 ? "" : "disabled"}>Bundle with…</button>
          <button class="ghost danger-text" data-act="remove">Remove</button>
        </span>
      </header>
      <div class="mc-body">
        ${many ? `<p class="mc-now"><b>${m.parts.indexOf(part) + 1} of ${m.parts.length}:</b> ${esc(part.title)}</p>` : ""}
        ${
          part.videoId
            ? `${playerHtml(part)}<p class="hint mc-player-note">Not playing here? Some videos only play on YouTube: <button class="link" data-act="browser">open it in your browser</button>.</p>`
            : `<div class="empty mc-elsewhere"><h2>Played where it is kept</h2><p>Only YouTube videos play here. This one opens in your browser, or in a window of its own.</p></div>`
        }
        <div class="field"><span>Its videos <em class="hint">in order; tick them as you watch</em></span>
          <ol class="mc-parts">${m.parts.map((p, i) => this.partHtml(p, i, m.parts.length, p.id === part.id)).join("")}</ol>
          <div class="mc-part-add"><button class="ghost" data-act="add-part" title="Another video of the same course or knit-along, after these">+ Add a video to it</button></div>
        </div>
        <div class="field mc-pattern"><span>Pattern <em class="hint">the one it goes with, if it is in the library: a project started from either has both</em></span>
          <div class="mc-pattern-row"><div data-el="mc-pattern"></div>${m.patternTitle ? `<button class="ghost" data-act="open-pattern" title="Read it">Open ↗</button>` : ""}</div>
        </div>
        <label class="field"><span>Notes</span>
          <textarea data-f="notes" rows="4" placeholder="What it teaches, where the good bit starts (12:30), what to remember…" maxlength="4000">${esc(m.notes)}</textarea></label>
        <div class="field"><span>Knitted along with it</span>
          ${
            along.length
              ? `<div class="mc-projects">${along.map((p) => `<button class="ghost" data-project="${esc(p.id)}" title="Open the project">${esc(p.name)}</button>`).join("")}</div>`
              : `<p class="hint">No project yet: <b>Start a project…</b>, or choose it on a project's page, under Masterclass.</p>`
          }
        </div>
      </div>`;
    paintThumbs(view);
    mountPatternPicker(view.querySelector<HTMLElement>('[data-el="mc-pattern"]')!, this.patterns, m.patternTitle ? m.patternId : null);
  }

  private partHtml(p: MasterclassPart, i: number, count: number, playing: boolean): string {
    return `
      <li class="mc-part${playing ? " on" : ""}${p.watched ? " watched" : ""}" data-part="${esc(p.id)}">
        <button class="mc-thumb mc-part-thumb" data-act="play" data-thumb="${p.hasThumb ? esc(p.id) : ""}" title="Watch it">${p.hasThumb ? "" : "▶"}</button>
        <span class="mc-part-n">${i + 1}</span>
        <input class="mc-part-title" data-f="part-title" value="${esc(p.title)}" aria-label="Its name" maxlength="200" />
        <label class="mc-watched" title="Watched"><input type="checkbox" data-f="watched" ${p.watched ? "checked" : ""} /> Watched</label>
        ${
          count > 1
            ? `<span class="mc-part-tools">
                <button class="ghost icon-btn" data-act="part-up" title="Earlier" aria-label="Earlier" ${i === 0 ? "disabled" : ""}>↑</button>
                <button class="ghost icon-btn" data-act="part-down" title="Later" aria-label="Later" ${i === count - 1 ? "disabled" : ""}>↓</button>
                <button class="ghost" data-act="part-split" title="Take it out, to be a masterclass of its own">Its own</button>
                <button class="ghost icon-btn danger-text" data-act="part-remove" title="Take it out of the masterclass" aria-label="Take it out">✕</button>
              </span>`
            : ""
        }
      </li>`;
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
    const partId = closestEl(e.target, "[data-part]")?.dataset.part;
    const part = partShown(m, m.id);
    try {
      if (act === "start") this.root.dispatchEvent(new CustomEvent("start-project-from-masterclass", { bubbles: true, detail: { id: m.id, title: m.title, patternId: m.patternTitle ? m.patternId : "" } }));
      if (act === "open-pattern" && m.patternId) this.root.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: m.patternId }));
      if (act === "browser") await api.openLink(part.url);
      if (act === "window") await api.openCheatsheetWindow(`mc-${part.id}`, part.url, part.title);
      if (act === "play" && partId) {
        showPart(m.id, partId);
        this.paintView();
      }
      if ((act === "part-up" || act === "part-down") && partId) {
        const at = m.parts.findIndex((p) => p.id === partId);
        this.replace(await api.moveMasterclassPart(partId, at + (act === "part-up" ? -1 : 1)));
        this.paintView();
      }
      if (act === "part-remove" && partId) {
        const p = m.parts.find((x) => x.id === partId)!;
        if (!(await askYesNo(`Take “${p.title}” out of “${m.title}”?`, { title: "Take a video out", okLabel: "Take it out", danger: true }))) return;
        this.replace(await api.removeMasterclassPart(partId));
        this.paintList();
        this.paintView();
      }
      if (act === "part-split" && partId) {
        const own = await api.splitMasterclassPart(partId);
        this.classes = this.classes.map((x) => (x.id === m.id ? { ...x, parts: x.parts.filter((p) => p.id !== partId) } : x));
        this.replace(own);
        this.paintList();
        this.paintView();
      }
      if (act === "add-part") await this.addPart(m);
      if (act === "bundle") await this.bundle(m);
      if (act === "remove") {
        const along = m.projectCount ? ` ${m.projectCount === 1 ? "The project knitted along with it keeps going" : "The projects knitted along with it keep going"} without it.` : "";
        const videos = m.parts.length > 1 ? ` All its ${m.parts.length} videos go with it.` : "";
        if (!(await askYesNo(`Remove the masterclass “${m.title}”?${videos}${along}`, { title: "Remove masterclass", okLabel: "Remove", danger: true }))) return;
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

  /** The name, the notes, a video's name and whether it is watched: saved as they are changed. */
  private async onChange(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const f = el.dataset.f;
    const m = this.open();
    if (!m) return;
    try {
      if (f === "part-title" || f === "watched") {
        const p = m.parts.find((x) => x.id === closestEl(el, "[data-part]")?.dataset.part);
        if (!p) return;
        const value = el.value.trim();
        if (f === "part-title" && !value) {
          el.value = p.title;
          return;
        }
        const changed = f === "watched" ? { ...p, watched: el.checked } : { ...p, title: value };
        // Kept here first, as below.
        this.replace({ ...m, parts: m.parts.map((x) => (x.id === p.id ? changed : x)) });
        this.replace(await api.updateMasterclassPart(changed));
        if (f === "watched") {
          this.paintList();
          this.root.querySelector(`[data-part="${p.id}"]`)?.classList.toggle("watched", el.checked);
          const source = this.root.querySelector<HTMLElement>(".sheet-source");
          const now = this.open();
          if (source && now) source.textContent = [now.channel || host(now.parts[0].url), partsSummary(now)].filter(Boolean).join(" · ");
        }
        return;
      }
      // The pattern it goes with, from the picker's hidden field.
      if (f === "pattern") {
        const saved = await api.updateMasterclass({ ...m, patternId: el.value });
        this.replace(saved);
        return this.paintView();
      }
      if (f !== "title" && f !== "notes") return;
      const value = el.value.trim();
      if (f === "title" && !value) {
        el.value = m.title;
        return;
      }
      // Kept here first, so a second change made before the first is saved
      // does not save the first one's field back as it was.
      const changed = { ...m, [f]: value };
      this.replace(changed);
      await api.updateMasterclass(changed);
      if (f === "title") this.paintList();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Masterclass");
    }
  }

  private async add(): Promise<void> {
    const answer = await askVideo(this.patterns);
    if (!answer) return;
    this.asking();
    try {
      const m = await api.addMasterclass({ url: answer.url, title: answer.title, patternId: answer.patternId });
      this.replace(m);
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

  /** Another video of the same course, after its others. */
  private async addPart(m: Masterclass): Promise<void> {
    const answer = await askForm(
      [
        { label: "Link", placeholder: "https://www.youtube.com/watch?v=…" },
        { label: "Name", placeholder: "Optional: the video's own title is used" },
      ],
      { title: `Another video for “${m.title}”`, okLabel: "Add it" },
    );
    if (!answer) return;
    this.asking();
    try {
      const now = await api.addMasterclassPart(m.id, { url: answer.Link, title: answer.Name });
      this.replace(now);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Another video");
    }
    this.paintList();
    this.paintView();
  }

  /** This and others made one masterclass: the others chosen in the order ticked, and a name. */
  private bundle(m: Masterclass): Promise<void> {
    return new Promise((resolve) => {
      const others = this.classes.filter((x) => x.id !== m.id);
      const ticked: string[] = [];
      const finish = () => {
        dialog.close();
        resolve();
      };
      const dialog = customDialog(`Bundle “${m.title}” with…`, finish, "mc-bundle-dialog");
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <p class="dialog-message">Its videos come first, then the others' in the order you tick them. They become one masterclass; their notes and projects come with them.</p>
        <label class="dialog-field"><span class="dialog-label">Name</span><input class="dialog-input" data-f="bundle-name" value="${esc(m.title)}" maxlength="200" /></label>
        <div class="mc-bundle-list">${others
          .map(
            (x) => `<label class="dialog-checkfield"><input type="checkbox" data-bundle="${esc(x.id)}" /><span>${esc(x.title)} <em class="hint">${esc([x.channel, partsSummary(x)].filter(Boolean).join(" · "))}</em><b class="mc-order"></b></span></label>`,
          )
          .join("")}</div>
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="make" disabled>Bundle them</button>
        </div>`,
      );
      const card = dialog.card;
      const paintOrder = () => {
        for (const box of card.querySelectorAll<HTMLInputElement>("[data-bundle]")) {
          const at = ticked.indexOf(box.dataset.bundle!);
          box.closest("label")!.querySelector(".mc-order")!.textContent = at >= 0 ? ` ${at + 2}` : "";
        }
        card.querySelector<HTMLButtonElement>('[data-act="make"]')!.disabled = !ticked.length;
      };
      card.addEventListener("change", (e) => {
        const box = e.target as HTMLInputElement;
        const id = box.dataset.bundle;
        if (!id) return;
        if (box.checked && !ticked.includes(id)) ticked.push(id);
        if (!box.checked) ticked.splice(ticked.indexOf(id), 1);
        paintOrder();
      });
      card.addEventListener("click", async (e) => {
        const act = closestEl(e.target, "button[data-act]")?.dataset.act;
        if (act === "cancel") finish();
        if (act !== "make") return;
        try {
          const made = await api.bundleMasterclasses([m.id, ...ticked], card.querySelector<HTMLInputElement>('[data-f="bundle-name"]')!.value);
          this.classes = this.classes.filter((x) => !ticked.includes(x.id));
          this.replace(made);
          this.projects = this.projects.map((p) => (ticked.includes(p.masterclassId) ? { ...p, masterclassId: made.id } : p));
          this.openId = made.id;
          keepOpen(made.id);
          this.paintList();
          this.paintView();
          finish();
        } catch (err) {
          const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
          error.textContent = err instanceof Error ? err.message : String(err);
          error.hidden = false;
        }
      });
      dialog.show(card.querySelector<HTMLElement>('[data-f="bundle-name"]')!);
    });
  }

  /** Says YouTube is being asked, at the top of the list, until it answers. */
  private asking(): void {
    this.root.querySelector<HTMLElement>('[data-el="list"]')!.insertAdjacentHTML("afterbegin", `<p class="hint sheet-none" data-el="asking">Asking YouTube for it…</p>`);
  }
}

/**
 * Asks for a video to keep: its link, a name if the video's own will not
 * do, and the pattern in the library it goes with, if there is one.
 */
function askVideo(patterns: Pattern[]): Promise<{ url: string; title: string; patternId: string } | null> {
  return new Promise((resolve) => {
    const finish = (answer: { url: string; title: string; patternId: string } | null) => {
      dialog.close();
      resolve(answer);
    };
    const dialog = customDialog("A video to learn from", () => finish(null), "mc-add-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <label class="dialog-field"><span class="dialog-label">Link</span><input class="dialog-input" data-f="link" placeholder="https://www.youtube.com/watch?v=…" /></label>
      <label class="dialog-field"><span class="dialog-label">Name</span><input class="dialog-input" data-f="name" placeholder="Optional: the video's own title is used" /></label>
      <div class="dialog-field"><span class="dialog-label">Pattern <em class="hint">optional: the one it goes with, if you have it</em></span><div data-el="pattern"></div></div>
      <p class="form-error" data-el="error" hidden></p>
      <div class="dialog-actions">
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="keep">Keep it</button>
      </div>`,
    );
    const card = dialog.card;
    mountPatternPicker(card.querySelector<HTMLElement>('[data-el="pattern"]')!, patterns, null);
    const keep = () => {
      const url = card.querySelector<HTMLInputElement>('[data-f="link"]')!.value.trim();
      if (!url) {
        const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
        error.textContent = "Give the video's link: a YouTube address.";
        error.hidden = false;
        return;
      }
      finish({ url, title: card.querySelector<HTMLInputElement>('[data-f="name"]')!.value.trim(), patternId: card.querySelector<HTMLInputElement>('[data-f="pattern"]')!.value });
    };
    card.addEventListener("click", (e) => {
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "cancel") finish(null);
      if (act === "keep") keep();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).matches('[data-f="link"], [data-f="name"]')) {
        e.preventDefault();
        keep();
      }
    });
    dialog.show(card.querySelector<HTMLElement>('[data-f="link"]')!);
  });
}

/** Fills in the videos' pictures under an element, as they load. */
function paintThumbs(under: HTMLElement): void {
  for (const thumb of under.querySelectorAll<HTMLElement>("[data-thumb]")) {
    const id = thumb.dataset.thumb;
    if (!id) continue;
    void masterclassThumbUrl(id).then((url) => {
      if (url) thumb.style.backgroundImage = `url("${url}")`;
    });
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
