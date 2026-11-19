import { api, type AiSettingsView, type Pattern } from "../api";
import { askYesNo } from "../dialogs";
import { MetadataScanner, summarise, type ScanOutcome } from "./scan";

/**
 * Describing the library with a model, in the background.
 *
 * A run belongs to the app, not to the library screen: opening a pattern or
 * another tab does not stop it. Its panel sits over every screen and can be
 * minimised to a small bar, or closed, leaving only a robot and the count
 * beside the settings gear to bring it back. Stop is the only thing that ends
 * a run early.
 *
 * Each pattern the model changes is announced as a `pattern-described` event
 * on `window`, with the pattern's id, so whichever screen is up can repaint
 * that one card.
 *
 * A run sends to the server, with the model and the saving rule, that were
 * shown when it was confirmed. Settings saved while it runs do not quietly
 * redirect it: the backend refuses the next request, and the rest of the run
 * is asked about again with the new settings shown, or left. Stop stays on
 * the panel throughout.
 */

export const ROBOT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a1.5 1.5 0 0 1 .75 2.8V6H17a3 3 0 0 1 3 3v1h.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H20v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1h-.5A1.5 1.5 0 0 1 2 14.5v-3A1.5 1.5 0 0 1 3.5 10H4V9a3 3 0 0 1 3-3h4.25V4.8A1.5 1.5 0 0 1 12 2zM9 10.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm6 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM9 16.25a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H9z"/></svg>`;

type Shown = "open" | "minimised" | "closed";

let panel: HTMLElement | null = null;
let running = false;
let stopRequested = false;
let shown: Shown = "open";
let done = 0;
let total = 0;
const outcomes: ScanOutcome[] = [];
/** Why a run ended before its end, other than Stop; shown in place of "Stopped". */
let endedEarly = "";

/** Whether a run is going. */
export function describing(): boolean {
  return running;
}

/** Brings the panel back up, from minimised or closed. */
export function showDescribePanel(): void {
  if (!panel) return;
  setShown("open");
}

/**
 * Asks whether to describe `count` patterns with `settings`: the model, where
 * the text goes, and that it runs in the background. `lead` comes first, to
 * say why it is being asked again.
 */
export function askToDescribe(count: number, settings: AiSettingsView, lead = ""): Promise<boolean> {
  return askYesNo(
    `${lead}Describe ${count} pattern${count === 1 ? "" : "s"} using ${settings.model || "the model"}?\n\n` +
      `Only the first pages of each pattern are sent, to ${
        settings.isLocal ? "the local network" : settings.baseUrl
      } (designer, sizes and materials), never the whole pattern.\n\n` +
      `It runs in the background while the app is in use.`,
    { title: "Describe with the model", okLabel: "Describe" },
  );
}

/**
 * Starts describing `targets` with the `settings` they were confirmed with.
 * Returns at once; the run carries on whatever is on screen. A second call
 * while one runs only shows the panel.
 */
export function startDescribing(targets: Pattern[], settings: AiSettingsView): void {
  if (running) return showDescribePanel();
  running = true;
  stopRequested = false;
  endedEarly = "";
  done = 0;
  total = targets.length;
  outcomes.length = 0;
  buildPanel();
  setShown("open");
  void (async () => {
    let confirmed = settings;
    let queue = targets;
    for (;;) {
      const run = await new MetadataScanner(confirmed).scan(
        queue,
        (outcome) => {
          outcomes.push(outcome);
          done++;
          logOutcome(outcome);
          paintProgress();
          if (outcome.applied) window.dispatchEvent(new CustomEvent("pattern-described", { detail: outcome.patternId }));
        },
        () => stopRequested,
      );
      if (!run.unsent.length || stopRequested) break;
      // The settings were saved during the run: the rest only with a new yes.
      const next = await reconfirm(run.unsent.length);
      if (!next) break;
      confirmed = next;
      queue = run.unsent;
      setNote("A local model can take a moment per pattern. This runs in the background while the app is in use.");
    }
    running = false;
    finish([...outcomes]);
  })();
}

/**
 * The settings changed partway through: the new ones, if the rest is to go
 * on with them, or null to end the run here.
 */
async function reconfirm(left: number): Promise<AiSettingsView | null> {
  setNote("The model settings were changed. Waiting for an answer before going on…");
  setShown("open");
  const fresh = await api.getAiSettings().catch(() => null);
  if (!fresh?.enabled || !fresh.baseUrl.trim()) {
    endedEarly = "Ended: describing with a model was switched off in Settings.";
    return null;
  }
  const go = await askToDescribe(
    left,
    fresh,
    `The model settings were changed during the run. Nothing more was sent. `,
  );
  if (stopRequested) return null;
  if (!go) {
    endedEarly = "Ended: the model settings were changed.";
    return null;
  }
  return fresh;
}

function setNote(text: string): void {
  const note = panel?.querySelector<HTMLElement>('[data-el="note"]');
  if (note) note.textContent = text;
}

function buildPanel(): void {
  panel?.remove();
  panel = document.createElement("div");
  panel.className = "describe-panel";
  panel.setAttribute("role", "status");
  panel.innerHTML = `
    <div class="scan-head">
      <span class="describe-robot">${ROBOT}</span>
      <strong data-el="title">Reading patterns…</strong>
      <span data-el="count">0 / ${total}</span>
      <button class="ghost" data-act="stop" title="Stop after the pattern being read">Stop</button>
      <button class="ghost describe-win" data-act="minimise" title="Minimise; it keeps going" aria-label="Minimise">–</button>
      <button class="ghost describe-win" data-act="close" title="Close; it keeps running, and the robot button by the gear reopens it" aria-label="Close">×</button>
    </div>
    <div class="scan-bar"><div class="scan-fill" data-el="fill"></div></div>
    <p class="scan-note" data-el="note">A local model can take a moment per pattern. This runs in the background while the app is in use.</p>
    <ul class="scan-log" data-el="log"></ul>
  `;
  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "stop") {
      stopRequested = true;
      const note = panel?.querySelector<HTMLElement>('[data-el="note"]');
      if (note) note.textContent = "Stopping after this pattern…";
    } else if (act === "minimise") {
      setShown("minimised");
    } else if (act === "close") {
      if (running) setShown("closed");
      else dismiss();
    } else if (shown === "minimised") {
      // A minimised panel opens again wherever it is clicked.
      setShown("open");
    }
  });
  document.body.appendChild(panel);
}

function setShown(next: Shown): void {
  shown = next;
  if (!panel) return;
  panel.hidden = next === "closed";
  panel.classList.toggle("minimised", next === "minimised");
  paintIndicator();
}

/** The robot and count beside the gear, while the panel is closed. */
function paintIndicator(): void {
  const bar = document.querySelector<HTMLElement>(".tab-bar");
  let chip = bar?.querySelector<HTMLButtonElement>('[data-act="describe-progress"]') ?? null;
  if (shown !== "closed" || !bar) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement("button");
    chip.className = "ghost tab-describe";
    chip.dataset.act = "describe-progress";
    chip.title = "Describing patterns: click to see";
    chip.addEventListener("click", () => showDescribePanel());
    bar.querySelector(".tab-gear")?.before(chip);
  }
  chip.innerHTML = `${ROBOT}<span>${running ? `${done} / ${total}` : "Done"}</span>`;
}

function paintProgress(): void {
  if (!panel) return;
  panel.querySelector('[data-el="count"]')!.textContent = `${done} / ${total}`;
  panel.querySelector<HTMLElement>('[data-el="fill"]')!.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
  paintIndicator();
}

function logOutcome(outcome: ScanOutcome): void {
  const log = panel?.querySelector<HTMLElement>('[data-el="log"]');
  if (!log) return;
  const li = document.createElement("li");
  if (!outcome.ok) {
    li.className = "bad";
    li.textContent = `${outcome.title} — ${outcome.error}`;
  } else if (outcome.changed.length) {
    li.className = "ok";
    li.textContent = `${outcome.title} — added ${outcome.changed.join(", ")}`;
  } else {
    li.textContent = `${outcome.title} — nothing to add`;
  }
  // Only the most recent lines are kept, so a run over thousands stays light.
  log.appendChild(li);
  while (log.children.length > 200) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

function finish(results: ScanOutcome[]): void {
  if (!panel) return;
  panel.classList.add("done");
  panel.querySelector('[data-act="stop"]')?.remove();
  panel.querySelector(".scan-bar")?.remove();
  const early = stopRequested || !!endedEarly;
  panel.querySelector('[data-el="title"]')!.textContent = early ? "Stopped" : "Done";
  const note = panel.querySelector<HTMLElement>('[data-el="note"]')!;
  note.textContent = stopRequested
    ? `Stopped. ${summarise(results)}`
    : endedEarly
      ? `${endedEarly} ${summarise(results)}`
      : summarise(results);
  paintIndicator();
  window.dispatchEvent(new CustomEvent("describing-finished"));
}

function dismiss(): void {
  panel?.remove();
  panel = null;
  shown = "open";
  paintIndicator();
}
