import { api, isAlreadyHave, type Pattern, type ScannedFile } from "../api";

/**
 * Adds every file a folder scan found, one at a time, with the same progress
 * panel the Describe scan uses.
 *
 * Serial rather than parallel: the backend copies each file off disk, and a
 * failure partway through should not lose the adds already done. Progress is
 * reported per file so the user can watch it move and stop it. Nothing is
 * thrown: a file that cannot be added becomes a line in the log, and a
 * duplicate the backend already holds is a skip, not a failure.
 */
export async function runBulkAdd(
  host: HTMLElement,
  files: ScannedFile[],
  opts: { onAdded: (p: Pattern) => void; describeHint?: boolean },
): Promise<{ added: number; skipped: number; failed: number }> {
  host.querySelector(".scan-panel")?.remove();
  const panel = document.createElement("div");
  panel.className = "scan-panel";
  panel.innerHTML = `
    <div class="scan-head">
      <strong>Adding patterns…</strong>
      <span data-el="count">0 / ${files.length}</span>
      <button class="ghost" data-el="stop">Stop</button>
    </div>
    <div class="scan-bar"><div class="scan-fill" data-el="fill"></div></div>
    <p class="scan-note" data-el="note">Each file is copied into your library in turn.</p>
    <ul class="scan-log" data-el="log"></ul>
  `;
  host.appendChild(panel);

  // Same idea as the Describe scan's stopRequested: a flag the loop checks
  // between items, so the file in flight finishes before the run ends.
  let stopRequested = false;
  panel.querySelector('[data-el="stop"]')!.addEventListener("click", () => {
    stopRequested = true;
  });

  const count = panel.querySelector('[data-el="count"]')!;
  const fill = panel.querySelector<HTMLElement>('[data-el="fill"]')!;
  const log = panel.querySelector('[data-el="log"]')!;

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    if (stopRequested) break;
    const f = files[i];
    // The same filename-to-title transform the add form pre-fills with.
    const title = f.fileName.replace(/\.(pdf|epub)$/i, "").replace(/[_-]+/g, " ");
    const li = document.createElement("li");
    try {
      const pattern = await api.addPattern({
        title,
        designer: "",
        fileName: f.fileName,
        // Always the path: the backend copies the file itself, and no bytes
        // cross the boundary.
        sourcePath: f.path,
        status: "",
        difficulty: "",
        needleSize: "",
        tags: [],
        notes: "",
      });
      added++;
      li.className = "ok";
      li.textContent = `${title} — added`;
      opts.onAdded(pattern);
    } catch (err) {
      if (isAlreadyHave(err)) {
        skipped++;
        li.textContent = `${title} — already in the library`;
      } else {
        failed++;
        li.className = "bad";
        li.textContent = `${title} — ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    count.textContent = `${i + 1} / ${files.length}`;
    fill.style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;
  }

  // Retired the same way the Describe panel is: marked done, stop button and
  // progress chrome removed, and the note becomes the summary line.
  panel.classList.add("done");
  panel.querySelector('[data-el="stop"]')?.remove();
  const note = panel.querySelector('[data-el="note"]') as HTMLElement;
  let summary = summariseBulk(added, skipped, failed);
  if (added > 0 && opts.describeHint) {
    summary += ". Run Describe (the robot) to fill in designer, difficulty and tags.";
  }
  note.textContent = stopRequested ? `Stopped. ${summary}` : summary;
  panel.querySelector(".scan-bar")?.remove();
  panel.querySelector('[data-el="count"]')?.remove();

  return { added, skipped, failed };
}

/** Summarises a run, for the line under the progress bar. */
function summariseBulk(added: number, skipped: number, failed: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (skipped) parts.push(`${skipped} already in the library`);
  if (failed) parts.push(`${failed} could not be read`);
  return parts.join(" · ") || "Nothing to do";
}
