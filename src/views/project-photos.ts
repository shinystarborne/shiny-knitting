import type { LogEntry } from "../api";
import { logPhotoUrl, projectCoverUrl } from "../covers";
import type { LightboxPicture } from "../lightbox";
import { longDate } from "./project-form";

/** A log entry's photo, opened big: what was written with it, and when. */
export function logPicture(e: LogEntry): LightboxPicture {
  const said = e.text.trim();
  return { url: () => logPhotoUrl(e.id), caption: `${said ? `${said} · ` : ""}${longDate(e.at)}` };
}

/** A log's photos, the newest first, as the log lists them. */
export function logPictures(entries: LogEntry[]): { id: string; picture: LightboxPicture }[] {
  return entries
    .filter((e) => e.photoPath)
    .sort((a, b) => b.at - a.at)
    .map((e) => ({ id: e.id, picture: logPicture(e) }));
}

/** Every photo of a project to step through: its cover first, then its log's. */
export function projectPictures(projectId: string, hasCover: boolean, entries: LogEntry[]): LightboxPicture[] {
  const cover: LightboxPicture[] = hasCover ? [{ url: () => projectCoverUrl(projectId), caption: "The cover" }] : [];
  return [...cover, ...logPictures(entries).map((x) => x.picture)];
}
