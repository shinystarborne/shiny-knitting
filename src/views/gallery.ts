import { api, type GalleryPhoto, type LogEntry, type Project, type Tool, type Yarn } from "../api";
import { coverUrl, logPhotoUrl, projectCoverUrl } from "../covers";
import { customDialog, say } from "../dialogs";
import { closestEl } from "../dom";
import { longDate } from "./project-form";
import { describe } from "./tool-filter";

/**
 * The finished gallery: every finished project, by itself, with its photos --
 * its cover and the photos in its log -- and what it was made of. One can be
 * hidden from it, and its photos chosen.
 */

/** One of a project's photos: its cover, or a log entry's photo. */
export interface Photo {
  /** "cover", or the log entry's id: what the gallery leaves out by. */
  key: string;
  at: number;
  caption: string;
}

/** Every photo of a project, newest first after its cover: the finished thing is usually the last taken. */
export function photosOf(p: Project, logged: GalleryPhoto[]): Photo[] {
  const cover: Photo[] = p.coverPath ? [{ key: "cover", at: p.finishedAt ?? p.startedAt, caption: "" }] : [];
  // The backend's are oldest first; turned round, two taken in the same moment keep their order too.
  const log = logged
    .filter((x) => x.projectId === p.id)
    .reverse()
    .map((x) => ({ key: x.id, at: x.at, caption: x.text }));
  return [...cover, ...log];
}

/** The photos the gallery shows: all but those left out. */
export function shownPhotos(p: Project, all: Photo[]): Photo[] {
  return all.filter((x) => !p.gallerySkip.includes(x.key));
}

export function photoUrl(p: Project, key: string): Promise<string | null> {
  return key === "cover" ? projectCoverUrl(p.id) : logPhotoUrl(key);
}

/** A tile's picture: its first photo shown, else its pattern's cover. */
export async function tilePicture(p: Project, photos: Photo[]): Promise<string | null> {
  const first = shownPhotos(p, photos)[0];
  if (first) return photoUrl(p, first.key);
  return p.patternId ? coverUrl(p.patternId) : null;
}

export function tileHtml(p: Project, photos: Photo[]): string {
  const count = shownPhotos(p, photos).length;
  return `
    <article class="gallery-tile${p.galleryHidden ? " hidden-tile" : ""}" data-gallery="${p.id}">
      <div class="gallery-pic"><span>${esc(p.name.slice(0, 1).toUpperCase())}</span>${p.galleryHidden ? `<span class="pill gallery-hidden-pill">Hidden</span>` : ""}</div>
      <div class="gallery-body">
        <h3>${esc(p.name)}</h3>
        <p>Finished ${esc(longDate(p.finishedAt ?? p.startedAt))}${count ? ` · ${count} photo${count === 1 ? "" : "s"}` : ""}</p>
      </div>
    </article>`;
}

export interface GalleryHooks {
  /** The project changed: hidden or shown, its photos chosen. */
  changed(p: Project): void;
  openPage(id: string): void;
  openPattern(id: string): void;
}

/**
 * One finished project, big: its photos, one at a time with the rest in a strip,
 * and beside them its pattern, yarn, needles, dates, notes and log. Choose
 * photos turns the strip into ticks for what the gallery shows.
 */
export async function openGalleryProject(project: Project, photos: Photo[], hooks: GalleryHooks): Promise<void> {
  let p = project;
  const [log, tools, yarns] = await Promise.all([
    api.listProjectLog(p.id).catch(() => [] as LogEntry[]),
    api.listTools().catch(() => [] as Tool[]),
    api.listYarns({ used: "all" }).catch(() => [] as Yarn[]),
  ]);
  let choosing = false;
  let at = 0;
  const dialog = customDialog(p.name, () => dialog.close(), "gallery-view");
  const card = dialog.card;
  const body = document.createElement("div");
  body.className = "gallery-view-body";
  card.append(body);

  const visible = () => (choosing ? photos : shownPhotos(p, photos));

  const info = (): string => {
    const yarnLines = p.yarns.map((y) => {
      const colourway = yarns.find((x) => x.id === y.yarnId)?.colourway;
      const left = y.leftoverGrams == null ? "" : y.leftoverGrams === 0 ? " · used up" : ` · ${y.leftoverGrams} g left`;
      return `<li>${esc(`${y.yarnName}${colourway ? ` · ${colourway}` : ""}${y.dyeLot ? ` — lot ${y.dyeLot}` : ""}`)}<em>${esc(left)}</em></li>`;
    });
    const toolLines = p.toolIds.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => !!t).map((t) => `<li>${esc(describe(t))}</li>`);
    const written = log.filter((e) => e.text.trim());
    return `
      <p class="gallery-dates">Finished ${esc(longDate(p.finishedAt ?? p.startedAt))} · started ${esc(longDate(p.startedAt))}</p>
      ${p.personName ? `<p><span class="gallery-label">For</span> ${esc(p.personName)}</p>` : ""}
      <p><span class="gallery-label">Pattern</span> ${p.patternId ? `<button class="link" data-act="pattern">${esc(p.patternTitle)}</button>` : "<em>None</em>"}</p>
      <div><span class="gallery-label">Yarn</span>${yarnLines.length ? `<ul>${yarnLines.join("")}</ul>` : " <em>None recorded</em>"}</div>
      <div><span class="gallery-label">Needles &amp; hooks</span>${toolLines.length ? `<ul>${toolLines.join("")}</ul>` : " <em>None recorded</em>"}</div>
      ${p.notes.trim() ? `<div><span class="gallery-label">Notes</span><p class="gallery-notes">${esc(p.notes)}</p></div>` : ""}
      ${
        written.length
          ? `<div><span class="gallery-label">Log</span><ol class="gallery-log">${written
              .map((e) => `<li class="${e.milestone ? "milestone" : ""}"><time>${esc(longDate(e.at))}</time> ${esc(e.text)}${e.photoPath ? ` <span class="hint">(photo)</span>` : ""}</li>`)
              .join("")}</ol></div>`
          : ""
      }`;
  };

  const paint = (): void => {
    const list = visible();
    at = Math.min(at, Math.max(0, list.length - 1));
    const current = list[at];
    body.innerHTML = `
      <div class="gallery-stage">
        <div class="gallery-big" data-el="big">${current ? "" : `<p class="hint">${photos.length ? "Every photo is left out: Choose photos to show some." : "No photos yet: add a cover, or a photo to its log, on its page."}</p>`}</div>
        ${current?.caption ? `<p class="gallery-caption">${esc(current.caption)} <span class="hint">${esc(longDate(current.at))}</span></p>` : ""}
        ${choosing ? `<p class="hint">Ticked photos are in the gallery. Click one to leave it out or bring it back.</p>` : ""}
        <div class="gallery-strip">${list
          .map((x, i) => {
            const on = !p.gallerySkip.includes(x.key);
            return `<button type="button" class="gallery-thumb${i === at ? " current" : ""}${choosing ? (on ? " chosen" : " left-out") : ""}" data-photo="${esc(x.key)}" data-index="${i}" title="${esc(x.caption || (x.key === "cover" ? "Its cover" : longDate(x.at)))}"${choosing ? ` aria-pressed="${on}"` : ""}><img alt="" /></button>`;
          })
          .join("")}</div>
      </div>
      <aside class="gallery-info">${info()}</aside>
      <div class="dialog-actions gallery-actions">
        ${photos.length ? `<button type="button" class="ghost" data-act="choose">${choosing ? "Done choosing" : "Choose photos"}</button>` : ""}
        <button type="button" class="ghost" data-act="hide">${p.galleryHidden ? "Show in the gallery" : "Hide from the gallery"}</button>
        <button type="button" class="ghost" data-act="page">Open its page</button>
        <button type="button" class="primary" data-act="close">Close</button>
      </div>`;
    if (current) {
      void photoUrl(p, current.key).then((url) => {
        const big = body.querySelector<HTMLElement>('[data-el="big"]');
        if (url && big) big.innerHTML = `<img src="${url}" alt="${esc(current.caption || p.name)}" />`;
      });
    }
    for (const thumb of body.querySelectorAll<HTMLButtonElement>(".gallery-thumb")) {
      void photoUrl(p, thumb.dataset.photo!).then((url) => {
        const img = thumb.querySelector("img");
        if (url && img) img.src = url;
      });
    }
  };

  const save = async (hidden: boolean, skip: string[]): Promise<void> => {
    try {
      p = await api.setProjectGallery(p.id, hidden, skip);
      hooks.changed(p);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Gallery");
    }
    paint();
  };

  card.addEventListener("click", (e) => {
    const btn = closestEl(e.target, "button");
    if (!btn) return;
    const act = btn.dataset.act;
    if (btn.dataset.photo != null) {
      const key = btn.dataset.photo;
      if (choosing) {
        const skip = p.gallerySkip.includes(key) ? p.gallerySkip.filter((k) => k !== key) : [...p.gallerySkip, key];
        at = Number(btn.dataset.index);
        void save(p.galleryHidden, skip);
      } else {
        at = Number(btn.dataset.index);
        paint();
      }
      return;
    }
    if (act === "choose") {
      choosing = !choosing;
      at = 0;
      paint();
    }
    if (act === "hide") void save(!p.galleryHidden, p.gallerySkip);
    if (act === "close") dialog.close();
    if (act === "page") {
      dialog.close();
      hooks.openPage(p.id);
    }
    if (act === "pattern" && p.patternId) {
      dialog.close();
      hooks.openPattern(p.patternId);
    }
  });
  // The arrow keys go through the photos.
  card.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const n = visible().length;
    if (!n) return;
    e.preventDefault();
    at = (at + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
    paint();
    card.querySelector<HTMLElement>(".gallery-thumb.current")?.focus();
  });
  card.tabIndex = -1;
  paint();
  dialog.show(card);
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
