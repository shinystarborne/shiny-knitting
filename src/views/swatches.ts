import { api, type MeasureUnit, type Swatch } from "../api";
import { forgetSwatchPhoto, swatchPhotoUrl } from "../covers";
import { askYesNo, say } from "../dialogs";
import { closestEl } from "../dom";
import { paintLazily } from "./lazy";
import { blockingText, gaugeOf, gaugeSpan, needleText, showGauge } from "./measure";
import { longDate } from "./project-form";
import { matches } from "./shopping";

/** What the Stash tab shows: the yarn, the swatches, the ball bands, or the yarn used up. */
export type StashMode = "yarn" | "swatches" | "bands" | "history" | "stats";

const STASH_MODES: { mode: StashMode; label: string; title: string }[] = [
  { mode: "yarn", label: "Yarn", title: "The yarn you have" },
  { mode: "swatches", label: "Swatches", title: "Your gauge swatches" },
  { mode: "bands", label: "Ball bands", title: "Pictures of the ball bands, by brand and yarn" },
  { mode: "history", label: "History", title: "Yarn you had, and used up" },
  { mode: "stats", label: "Statistics", title: "How much is in the stash, and yarn added and used month by month" },
];

/** The Stash tab's switch between its yarn, its swatches, its ball bands, its history and its statistics. */
export function stashModeSwitch(mode: StashMode): string {
  return `
    <div class="seg" role="tablist" aria-label="Show">
      ${STASH_MODES.map((m) => `<button class="${m.mode === mode ? "on" : ""}" data-act="stash-mode" data-mode="${m.mode}" role="tab" title="${m.title}" aria-selected="${m.mode === mode}">${m.label}</button>`).join("")}
    </div>`;
}

/** Everything a swatch search looks through. */
export function swatchText(s: Swatch): string {
  return [s.yarnName, s.yarnColourway, s.stitch, s.notes, s.projectName, needleText(s.needleMm), `${s.needleMm}mm`].join(" ");
}

/**
 * The Stash tab's swatches: every gauge swatch knitted, the newest first, as
 * a grid of cards with the photo, the gauge, the needle and the yarn.
 */
export class SwatchesView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private swatches: Swatch[] = [];
  private unit: MeasureUnit = "cm";
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library swatches";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Stash</h1>${stashModeSwitch("swatches")}</div>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search yarn, stitch, needle, notes..." />
          <button data-act="add" class="primary">+ Add a swatch</button>
        </div>
      </header>
      <main class="results swatch-grid"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value;
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    await this.reload();
  }

  async reload(): Promise<void> {
    [this.swatches, this.unit] = await Promise.all([api.listSwatches(), api.getMeasureUnit().catch(() => "cm" as const)]);
    this.paint();
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "add") this.emit("add-swatch", {});
      if (act === "stash-mode") this.emit("stash-mode", btn.dataset.mode);
      if (act === "remove") await this.remove(btn.dataset.id!);
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    const swatch = card && this.swatches.find((s) => s.id === card.dataset.open);
    if (swatch) this.emit("edit-swatch", swatch);
  }

  private emit(name: string, detail: unknown): void {
    this.root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  private paint(): void {
    const shown = this.swatches.filter((s) => matches(swatchText(s), this.search));
    if (!shown.length) {
      this.results.innerHTML = `
        <div class="empty">
          <h2>${this.swatches.length ? "No swatch matches that" : "No swatches yet"}</h2>
          <p>${this.swatches.length ? "The search looks through the yarn, stitch pattern, needle and notes." : "Add your gauge swatches: the yarn, the needle, and the stitches and rows over 10 cm, before and after blocking. Your real gauge, not the ball band's."}</p>
        </div>`;
      return;
    }
    paintLazily(this.results, shown, (s) => cardHtml(s, this.unit), { pictures: "[data-pic]", paint: paintPhoto });
  }

  private async remove(id: string): Promise<void> {
    const ok = await askYesNo("Remove this swatch, and its photo?\n\nThis cannot be undone.", { title: "Remove swatch", okLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.deleteSwatch(id);
      forgetSwatchPhoto(id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Remove swatch");
    }
    await this.reload();
  }
}

function cardHtml(s: Swatch, unit: MeasureUnit): string {
  const g = gaugeOf(s);
  const counts = [g.sts ? showGauge(g.sts, unit) : "–", g.rows ? showGauge(g.rows, unit) : "–"].join(" × ");
  const counted = g.sts || g.rows;
  const yarn = [s.yarnName || "Yarn not given", s.yarnColourway].filter(Boolean).join(", ");
  return `
    <article class="swatch-card" data-open="${esc(s.id)}">
      <div class="swatch-photo${s.photoPath ? "" : " none"}" ${s.photoPath ? `data-pic data-id="${esc(s.id)}"` : ""}>
        ${s.photoPath ? "" : `<span>${esc(s.stitch || "Swatch")}</span>`}
      </div>
      <div class="swatch-body">
        <div class="swatch-gauge">
          <b>${counted ? esc(counts) : "Not counted"}</b>
          ${counted ? `<span>sts × rows / ${esc(gaugeSpan(unit))}</span>` : ""}
          ${counted ? `<span class="pill ${g.blocked ? "swatch-blocked" : ""}">${g.blocked ? "Blocked" : "Not blocked yet"}</span>` : ""}
        </div>
        ${g.blocked && (s.sts || s.rows) ? `<p class="swatch-before" title="Counted before blocking, and what blocking did">Before: ${esc(beforeCounts(s, unit))}${blockingText(s) ? ` · ${esc(blockingText(s))}` : ""}</p>` : ""}
        <p class="swatch-needle">${esc([needleText(s.needleMm) ? `on ${needleText(s.needleMm)}` : "", s.stitch].filter(Boolean).join(" · ") || " ")}</p>
        <p class="swatch-yarn" title="${esc(yarn)}">${esc(yarn)}</p>
        <div class="card-tools-row">
          <span class="hint">${esc(longDate(s.madeAt))}</span>
          <span class="spacer"></span>
          <button class="card-remove" data-act="remove" data-id="${esc(s.id)}" title="Remove this swatch">Remove</button>
        </div>
      </div>
    </article>`;
}

/** The counts before blocking: "32 × 44", a dash for one not counted. */
function beforeCounts(s: Swatch, unit: MeasureUnit): string {
  return [s.sts ? showGauge(s.sts, unit) : "–", s.rows ? showGauge(s.rows, unit) : "–"].join(" × ");
}

async function paintPhoto(el: HTMLElement): Promise<void> {
  const url = await swatchPhotoUrl(el.dataset.id!);
  if (url && el.isConnected) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("filled");
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
