import { api, type DuplicateGroup } from "../api";
import { coverUrl, forgetCover } from "../covers";
import { askYesNo, customDialog } from "../dialogs";
import { paintLazily } from "./lazy";

/**
 * Sorting out duplicate patterns: every group of patterns that look like the
 * same one, with which to keep and which to remove.
 *
 * Identical files are certainly copies, so their extra copies are ticked for
 * removal from the start. Patterns that only share a name may be different
 * versions or languages, so nothing in those groups is ticked until chosen.
 * The one suggested to keep is the copy with the most attached to it.
 *
 * Resolves whether anything was removed, so the library knows to reload.
 */
export function sortOutDuplicates(): Promise<boolean> {
  return new Promise((resolve) => {
    let changed = false;
    let groups: DuplicateGroup[] = [];
    /** Per group: the one kept, and the ones ticked to go. */
    const keep = new Map<number, string>();
    const remove = new Map<number, Set<string>>();
    let stopLazy: (() => void) | null = null;

    const finish = () => {
      stopLazy?.();
      dialog.close();
      resolve(changed);
    };
    const dialog = customDialog("Duplicate patterns", finish, "duplicates-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <p class="dialog-message" data-el="summary">Looking for duplicates…</p>
      <div class="dup-list" data-el="list"></div>
      <div class="dialog-actions">
        <span class="hint" data-el="count"></span>
        <span class="spacer"></span>
        <button class="ghost" data-act="close">Close</button>
        <button class="danger" data-act="remove" disabled>Remove</button>
      </div>`,
    );
    const list = dialog.card.querySelector<HTMLElement>('[data-el="list"]')!;
    const summary = dialog.card.querySelector<HTMLElement>('[data-el="summary"]')!;
    const removeBtn = dialog.card.querySelector<HTMLButtonElement>('[data-act="remove"]')!;
    const count = dialog.card.querySelector<HTMLElement>('[data-el="count"]')!;

    const ticked = () => [...remove.values()].reduce((n, s) => n + s.size, 0);
    const update = () => {
      const n = ticked();
      removeBtn.disabled = n === 0;
      removeBtn.textContent = n ? `Remove ${n} pattern${n === 1 ? "" : "s"}` : "Remove";
      count.textContent = n ? `Keeping one of each group, removing ${n}.` : "";
    };

    const load = async () => {
      summary.textContent = "Looking for duplicates…";
      try {
        groups = await api.findDuplicatePatterns();
      } catch (err) {
        summary.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      // Identical files first: those are the sure ones.
      groups.sort((a, b) => Number(b.exact) - Number(a.exact) || a.patterns[0].pattern.title.localeCompare(b.patterns[0].pattern.title));
      keep.clear();
      remove.clear();
      groups.forEach((g, i) => {
        keep.set(i, g.keep);
        remove.set(i, new Set(g.exact ? g.patterns.map((e) => e.pattern.id).filter((id) => id !== g.keep) : []));
      });
      const exact = groups.filter((g) => g.exact).length;
      const kinds = [
        exact ? `${exact} of identical files (their copies are ticked)` : "",
        groups.length - exact ? `${groups.length - exact} with the same name (check those yourself)` : "",
      ].filter(Boolean);
      summary.textContent = groups.length
        ? `${groups.length} group${groups.length === 1 ? "" : "s"} of patterns that look alike: ${kinds.join(", ")}. ` +
          `A copy's projects and board cards move to the one kept, with its tags, notes and status; ` +
          `its highlights, pins and counters go with it.`
        : "No duplicates found.";
      stopLazy = paintLazily(list, groups.map((g, i) => ({ g, i })), ({ g, i }) => groupHtml(g, i), {
        pictures: "[data-cover-of]",
        paint: async (el) => {
          const url = await coverUrl(el.dataset.coverOf!);
          if (url) el.style.backgroundImage = `url("${url}")`;
        },
        pageSize: 30,
      });
      update();
    };

    const groupHtml = (g: DuplicateGroup, i: number): string => `
      <section class="dup-group" data-group="${i}">
        <h4>${g.exact ? "Identical files" : "Same name — check these before removing"}</h4>
        ${g.patterns
          .map((e) => {
            const p = e.pattern;
            const kept = keep.get(i) === p.id;
            const going = remove.get(i)?.has(p.id) ?? false;
            const attached = [
              e.projects ? `${e.projects} project${e.projects === 1 ? "" : "s"}` : "",
              e.marks ? `${e.marks} mark${e.marks === 1 ? "" : "s"}` : "",
              e.rows ? `${e.rows} rows counted` : "",
              p.notes.trim() ? "notes" : "",
              p.lastOpenedAt ? `read ${shortDate(p.lastOpenedAt)}` : "",
            ].filter(Boolean);
            return `
              <div class="dup-row${kept ? " kept" : ""}${going ? " going" : ""}" data-id="${esc(p.id)}">
                <div class="dup-cover" ${p.coverPath ? `data-cover-of="${esc(p.id)}"` : ""}><span>${esc(p.format.toUpperCase())}</span></div>
                <div class="dup-text">
                  <strong>${esc(p.title)}</strong>
                  <span>${esc([p.designer, p.fileName, size(e.fileSize), `added ${shortDate(p.addedAt)}`].filter(Boolean).join(" · "))}</span>
                  <span class="dup-attached">${attached.length ? esc(attached.join(" · ")) : "Nothing attached"}</span>
                </div>
                <label class="dup-choice"><input type="radio" name="keep-${i}" data-keep="${i}" value="${esc(p.id)}" ${kept ? "checked" : ""} /> Keep</label>
                <label class="dup-choice"><input type="checkbox" data-remove="${i}" value="${esc(p.id)}" ${going ? "checked" : ""} ${kept ? "disabled" : ""} /> Remove</label>
              </div>`;
          })
          .join("")}
      </section>`;

    // A choice changes only its own group's rows, so the list keeps its place.
    const repaintGroup = (i: number) => {
      const section = list.querySelector<HTMLElement>(`[data-group="${i}"]`);
      if (!section) return;
      for (const row of section.querySelectorAll<HTMLElement>(".dup-row")) {
        const id = row.dataset.id!;
        const kept = keep.get(i) === id;
        const going = remove.get(i)!.has(id);
        row.classList.toggle("kept", kept);
        row.classList.toggle("going", going);
        const box = row.querySelector<HTMLInputElement>("[data-remove]")!;
        box.checked = going;
        box.disabled = kept;
      }
    };

    dialog.card.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.keep) {
        const i = Number(input.dataset.keep);
        keep.set(i, input.value);
        remove.get(i)!.delete(input.value);
        repaintGroup(i);
      } else if (input.dataset.remove) {
        const i = Number(input.dataset.remove);
        if (input.checked) remove.get(i)!.add(input.value);
        else remove.get(i)!.delete(input.value);
        repaintGroup(i);
      }
      update();
    });

    dialog.card.addEventListener("click", async (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]")?.dataset.act;
      if (act === "close") finish();
      if (act !== "remove") return;
      const n = ticked();
      if (!(await askYesNo(`Remove ${n} pattern${n === 1 ? "" : "s"} and their files? This cannot be undone.`, { title: "Remove duplicates", okLabel: "Remove", danger: true }))) return;
      removeBtn.disabled = true;
      let done = 0;
      const failed: string[] = [];
      for (const [i, going] of remove) {
        if (!going.size) continue;
        try {
          await api.mergeDuplicatePatterns(keep.get(i)!, [...going]);
          for (const id of going) forgetCover(id);
          done += going.size;
          changed = true;
          count.textContent = `Removed ${done} of ${n}…`;
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err));
        }
      }
      await load();
      if (failed.length) summary.textContent = `${summary.textContent} Some could not be removed: ${failed.join("; ")}`;
      else if (done) count.textContent = `Removed ${done} pattern${done === 1 ? "" : "s"}.`;
    });

    dialog.show(dialog.card.querySelector<HTMLButtonElement>('[data-act="close"]')!);
    void load();
  });
}

function size(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
