import { api, type LogEntry } from "../api";
import { forgetLogPhoto, logPhotoUrl } from "../covers";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { PhotoBox } from "./photo-box";

/**
 * A project's log: a diary of the knitting, the newest first, a day at a
 * time. What is typed is dated as it is added; the milestones -- started,
 * paused, finished, a new pattern -- are written by the project itself.
 * Every entry can be changed (its words, its time, its photo) or removed.
 */
export class ProjectLog {
  private host: HTMLElement;
  private projectId: string;
  private entries: LogEntry[] = [];
  private composerPhoto: PhotoBox | null = null;
  private editPhoto: PhotoBox | null = null;
  /** The entry being changed, if one is. */
  private editingId: string | null = null;

  constructor(host: HTMLElement, projectId: string) {
    this.host = host;
    this.projectId = projectId;
  }

  async mount(): Promise<void> {
    this.host.innerHTML = `
      <div class="log-inner">
        <div class="log-compose">
          <textarea data-f="text" rows="3" placeholder="What happened? What you changed in the pattern, where you stopped, how the yarn behaves… (Ctrl+Enter adds it)"></textarea>
          <div class="log-compose-bar">
            <div class="log-photo-box" data-el="compose-photo" title="Paste a picture with Ctrl+V, drop one here, or choose one"></div>
            <button class="ghost" data-act="photo-file">Add a photo…</button>
            <button class="ghost" data-act="photo-remove">Remove photo</button>
            <span class="spacer"></span>
            <button class="primary" data-act="add">Add to log</button>
          </div>
        </div>
        <div class="log-list" data-el="list"></div>
      </div>`;
    this.composerPhoto = new PhotoBox(
      this.host.querySelector<HTMLElement>('[data-el="compose-photo"]')!,
      async () => null,
      (message) => void say(message, "Photo"),
      () => !this.editingId,
    );
    this.host.addEventListener("click", (e) => void this.onClick(e));
    this.host.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      e.preventDefault();
      if (target.dataset.f === "text") void this.add();
      if (target.dataset.f === "edit-text") void this.saveEdit();
    });
    await this.reload();
  }

  /** Reads the log again: after a milestone, or a change elsewhere. */
  async reload(): Promise<void> {
    this.entries = await api.listProjectLog(this.projectId).catch(() => [] as LogEntry[]);
    this.render();
  }

  destroy(): void {
    this.composerPhoto?.destroy();
    this.editPhoto?.destroy();
  }

  private render(): void {
    this.editPhoto?.destroy();
    this.editPhoto = null;
    const list = this.host.querySelector<HTMLElement>('[data-el="list"]')!;
    if (!this.entries.length) {
      list.innerHTML = `<p class="hint log-empty">Nothing in the log yet. What you add here is dated by itself, and the project writes when it starts, pauses and finishes.</p>`;
      return;
    }
    // A heading a day, the entries under it.
    const days: { day: string; entries: LogEntry[] }[] = [];
    for (const entry of this.entries) {
      const day = dayLabel(entry.at);
      if (days[days.length - 1]?.day !== day) days.push({ day, entries: [] });
      days[days.length - 1].entries.push(entry);
    }
    list.innerHTML = days
      .map((d) => `<section class="log-day"><h3>${esc(d.day)}</h3>${d.entries.map((e) => this.entryHtml(e)).join("")}</section>`)
      .join("");
    for (const img of list.querySelectorAll<HTMLElement>("[data-photo]")) void paintPhoto(img);
    if (this.editingId) {
      const box = list.querySelector<HTMLElement>('[data-el="edit-photo"]');
      const entry = this.entries.find((e) => e.id === this.editingId);
      if (box && entry) {
        this.editPhoto = new PhotoBox(box, async () => (entry.photoPath ? logPhotoUrl(entry.id) : null), (m) => void say(m, "Photo"));
      }
      list.querySelector<HTMLTextAreaElement>('[data-f="edit-text"]')?.focus();
    }
  }

  private entryHtml(e: LogEntry): string {
    if (e.id === this.editingId) {
      return `
        <article class="log-entry editing" data-id="${esc(e.id)}">
          <input type="datetime-local" data-f="edit-at" value="${toLocalInput(e.at)}" aria-label="When" />
          <textarea data-f="edit-text" rows="3">${esc(e.text)}</textarea>
          <div class="log-compose-bar">
            <div class="log-photo-box" data-el="edit-photo" title="Paste a picture with Ctrl+V, drop one here, or choose one"></div>
            <button class="ghost" data-act="edit-photo-file">Photo…</button>
            <button class="ghost" data-act="edit-photo-remove">Remove photo</button>
            <span class="spacer"></span>
            <button class="ghost" data-act="cancel-edit">Cancel</button>
            <button class="primary" data-act="save-edit">Save</button>
          </div>
        </article>`;
    }
    const time = new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `
      <article class="log-entry${e.milestone ? " milestone" : ""}" data-id="${esc(e.id)}">
        <div class="log-head">
          <span class="log-time">${esc(time)}</span>
          ${e.milestone ? `<span class="log-milestone">${esc(e.text)}</span>` : ""}
          <span class="spacer"></span>
          <button class="card-remove" data-act="edit" data-id="${esc(e.id)}" title="Change it">Edit</button>
          <button class="card-remove" data-act="remove" data-id="${esc(e.id)}" title="Take it out of the log">Remove</button>
        </div>
        ${!e.milestone && e.text ? `<p class="log-text">${esc(e.text)}</p>` : ""}
        ${e.photoPath ? `<img class="log-photo" data-photo data-id="${esc(e.id)}" alt="" title="Click to see it bigger" />` : ""}
      </article>`;
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const photo = closestEl(e.target, ".log-photo");
    if (photo) return void photo.classList.toggle("big");
    const btn = closestEl(e.target, "button[data-act]");
    const act = btn?.dataset.act;
    if (act === "add") await this.add();
    if (act === "photo-file") this.composerPhoto?.choose();
    if (act === "photo-remove") this.composerPhoto?.reset();
    if (act === "edit") {
      this.editingId = btn!.dataset.id!;
      this.render();
    }
    if (act === "cancel-edit") {
      this.editingId = null;
      this.render();
    }
    if (act === "save-edit") await this.saveEdit();
    if (act === "edit-photo-file") this.editPhoto?.choose();
    if (act === "edit-photo-remove") this.editPhoto?.remove();
    if (act === "remove") await this.remove(btn!.dataset.id!);
  }

  /** Adds what is typed, and the photo if there is one, dated now. */
  private async add(): Promise<void> {
    const area = this.host.querySelector<HTMLTextAreaElement>('[data-f="text"]')!;
    const photo = this.composerPhoto?.pending ?? null;
    if (!area.value.trim() && !photo) return void area.focus();
    try {
      const entry = await api.addLogEntry(this.projectId, area.value);
      if (photo) await api.setLogPhoto(entry.id, await bytes(photo));
      area.value = "";
      this.composerPhoto?.reset();
      await this.reload();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Log");
    }
  }

  private async saveEdit(): Promise<void> {
    const id = this.editingId;
    if (!id) return;
    const text = this.host.querySelector<HTMLTextAreaElement>('[data-f="edit-text"]')?.value ?? "";
    const when = this.host.querySelector<HTMLInputElement>('[data-f="edit-at"]')?.value ?? "";
    const at = when ? new Date(when).getTime() : NaN;
    if (Number.isNaN(at)) return void (await say("Give the day and time it happened.", "Log"));
    try {
      await api.updateLogEntry(id, text, at);
      if (this.editPhoto?.pending) {
        await api.setLogPhoto(id, await bytes(this.editPhoto.pending));
        forgetLogPhoto(id);
      } else if (this.editPhoto?.removed) {
        await api.removeLogPhoto(id);
        forgetLogPhoto(id);
      }
      this.editingId = null;
      await this.reload();
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Log");
    }
  }

  private async remove(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    const what = entry.milestone ? `“${entry.text}”` : "this entry";
    if (!(await askYesNo(`Take ${what} out of the log${entry.photoPath ? ", with its photo" : ""}?`, { title: "Remove from log", okLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteLogEntry(id);
      forgetLogPhoto(id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Log");
    }
    await this.reload();
  }
}

async function bytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

async function paintPhoto(img: HTMLElement): Promise<void> {
  const url = await logPhotoUrl(img.dataset.id!);
  if (url && img.isConnected) (img as HTMLImageElement).src = url;
}

/** "Saturday 3 October 2026", or "Today" and "Yesterday". */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** A time as a datetime-local field's value, in local time. */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
