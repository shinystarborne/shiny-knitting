import { api, toBytes, type ChartPicture, type ChartPictureInput } from "../api";
import { chartPictureUrl, forgetChartPicture, imageMime, prepareBoardImage } from "../covers";
import { askYesNo, customDialog, dialogOpen, say } from "../dialogs";
import { closestEl } from "../dom";
import { openLightbox } from "../lightbox";
import { cropImage } from "./crop-dialog";
import { paintLazily } from "./lazy";
import { matches } from "./shopping";

/**
 * The Charts tab: charts kept as pictures, for knitting and for crochet --
 * only the chart, not the whole pattern -- from a book, a pattern or a
 * screenshot. Added from a file, pasted, or dropped on the tab; named, said
 * to be knitting or crochet, cropped; opened big; put on a project's board
 * from its toolbar. The charts drawn in Constructors are another thing.
 */

type Craft = ChartPicture["craft"];
type Shown = Craft | "all";

const CRAFT_LABELS: Record<Craft, string> = { knitting: "Knitting", crochet: "Crochet" };

/** The longest side a chart is kept at: big enough to read its smallest symbol on a big screen. */
const CHART_SIZE = 3000;

/** Which charts the tab shows, kept while the app is open. */
let shown: Shown = "all";

export function craftLabel(craft: string): string {
  return CRAFT_LABELS[craft as Craft] ?? craft;
}

export class ChartPicturesView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private charts: ChartPicture[] = [];
  private search = "";
  private teardown: (() => void)[] = [];

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library chart-pictures";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Charts</h1>
          <div class="seg" role="tablist" aria-label="Show">
            ${(["all", "knitting", "crochet"] as Shown[])
              .map((s) => `<button class="${s === shown ? "on" : ""}" data-act="shown" data-shown="${s}" role="tab" aria-selected="${s === shown}">${s === "all" ? "All" : CRAFT_LABELS[s]}</button>`)
              .join("")}
          </div>
        </div>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search names and notes..." />
          <button data-act="add" class="primary" title="Choose a picture of a chart, or paste one with Ctrl+V, or drop one here">+ Add a chart</button>
        </div>
      </header>
      <main class="results chartpic-grid"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value;
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    this.root.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      this.root.classList.add("over");
    });
    this.root.addEventListener("dragleave", (e) => {
      if (!this.root.contains(e.relatedTarget as Node)) this.root.classList.remove("over");
    });
    this.root.addEventListener("drop", (e) => {
      e.preventDefault();
      this.root.classList.remove("over");
      void this.addFiles([...(e.dataTransfer?.files ?? [])]);
    });
    // A picture pasted anywhere on the tab, not into the search.
    const onPaste = (e: ClipboardEvent) => {
      if (dialogOpen() || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    this.teardown.push(() => document.removeEventListener("paste", onPaste));
    await this.reload();
  }

  destroy(): void {
    for (const undo of this.teardown) undo();
    this.teardown = [];
  }

  async reload(): Promise<void> {
    this.charts = await api.listChartPictures().catch(() => [] as ChartPicture[]);
    this.paint();
  }

  private visible(): ChartPicture[] {
    return this.charts.filter((c) => (shown === "all" || c.craft === shown) && matches(`${c.name} ${c.notes} ${craftLabel(c.craft)}`, this.search));
  }

  private paint(): void {
    const list = this.visible();
    if (!list.length) {
      const none = !this.charts.length;
      this.results.innerHTML = `
        <div class="empty">
          <h2>${none ? "No charts yet" : "No chart matches that"}</h2>
          <p>${
            none
              ? "Keep the charts you knit or crochet from as pictures: only the chart, from a book, a pattern or a screenshot. <b>+ Add a chart</b>, or paste one with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drop one here. A project's board can show one, from its Chart button."
              : "The search looks through the names and notes."
          }</p>
        </div>`;
      return;
    }
    paintLazily(this.results, list, cardHtml, { pictures: "[data-chartpic]", paint: paintPicture });
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "shown") {
        shown = (btn.dataset.shown as Shown) ?? "all";
        for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="shown"]')) {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-selected", String(b === btn));
        }
        this.paint();
      }
      if (act === "add") this.choose();
      const chart = this.charts.find((c) => c.id === btn.dataset.id);
      if (act === "edit" && chart) await this.edit(chart);
      if (act === "remove" && chart) await this.remove(chart);
      return;
    }
    const card = closestEl(e.target, "[data-open]");
    if (card) this.view(card.dataset.open!);
  }

  /** The charts shown, opened big at this one. */
  private view(id: string): void {
    const list = this.visible();
    openLightbox(
      list.map((c) => ({ url: () => chartPictureUrl(c.id), caption: c.name })),
      Math.max(0, list.findIndex((c) => c.id === id)),
      "The chart",
    );
  }

  private choose(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", () => void this.addFiles([...(input.files ?? [])]));
    input.click();
  }

  /** Each picture asked about in turn: its name, knitting or crochet, cropped if need be. */
  private async addFiles(files: File[]): Promise<void> {
    for (const file of files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name))) {
      const prepared = await prepareBoardImage(file, CHART_SIZE);
      if (!prepared) {
        await say(`${file.name || "That"} could not be read as a picture.`, "Add a chart");
        continue;
      }
      const name = file.name && !/^image\.\w+$/i.test(file.name) ? file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") : "";
      const answer = await chartDialog("Add a chart", { name, craft: shown === "all" ? "knitting" : shown, notes: "" }, prepared);
      if (!answer) continue;
      try {
        const bytes = new Uint8Array(await answer.picture.blob.arrayBuffer());
        await api.addChartPicture(answer.input, bytes, answer.picture);
      } catch (err) {
        await say(err instanceof Error ? err.message : String(err), "Add a chart");
      }
    }
    await this.reload();
  }

  private async edit(chart: ChartPicture): Promise<void> {
    const raw = await api.getChartPicture(chart.id).catch(() => null);
    const bytes = raw ? toBytes(raw) : null;
    const picture = bytes?.length ? { blob: new Blob([bytes], { type: imageMime(bytes) }), width: chart.width, height: chart.height } : null;
    const answer = await chartDialog("The chart", { name: chart.name, craft: chart.craft, notes: chart.notes }, picture);
    if (!answer) return;
    try {
      await api.updateChartPicture(chart.id, answer.input);
      if (answer.cropped) {
        await api.replaceChartPicture(chart.id, new Uint8Array(await answer.picture.blob.arrayBuffer()), answer.picture);
        forgetChartPicture(chart.id);
      }
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "The chart");
    }
    await this.reload();
  }

  private async remove(chart: ChartPicture): Promise<void> {
    const ok = await askYesNo(`Remove “${chart.name}”, and its picture?\n\nA board showing it says it is no longer kept. This cannot be undone.`, {
      title: "Remove chart",
      okLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteChartPicture(chart.id);
      forgetChartPicture(chart.id);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Remove chart");
    }
    await this.reload();
  }
}

interface Picture {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * A chart's name, craft and notes, with its picture to see and to crop.
 * Resolves what was said, the picture as it is now and whether it was
 * cropped, or null when cancelled.
 */
function chartDialog(title: string, start: ChartPictureInput, picture: Picture | null): Promise<{ input: ChartPictureInput; picture: Picture; cropped: boolean } | null> {
  return new Promise((resolve) => {
    let current = picture;
    let cropped = false;
    let url = current ? URL.createObjectURL(current.blob) : "";
    let craft: Craft = start.craft;
    const finish = (answer: { input: ChartPictureInput; picture: Picture; cropped: boolean } | null) => {
      dialog.close();
      if (url) URL.revokeObjectURL(url);
      resolve(answer);
    };
    const dialog = customDialog(title, () => finish(null), "chartpic-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `<div class="chartpic-preview">${url ? `<img data-el="img" alt="" src="${url}" />` : `<span class="hint">The picture could not be read.</span>`}</div>
       <label class="dialog-field"><span class="dialog-label">Name</span><input class="dialog-input" data-f="name" placeholder="e.g. Spiral rose, Owl cable" /></label>
       <div class="dialog-field"><span class="dialog-label">For</span>
         <div class="seg" role="radiogroup" aria-label="For">${(Object.keys(CRAFT_LABELS) as Craft[])
           .map((c) => `<button type="button" class="${c === craft ? "on" : ""}" data-craft="${c}" role="radio" aria-checked="${c === craft}">${CRAFT_LABELS[c]}</button>`)
           .join("")}</div></div>
       <label class="dialog-field"><span class="dialog-label">Notes <em class="optional">optional</em></span><textarea class="dialog-input" data-f="notes" rows="3" placeholder="Where it is from, what it is for"></textarea></label>
       <div class="dialog-actions">
         ${url ? `<button type="button" class="ghost" data-act="crop" title="Keep only part of the picture">✂ Crop…</button>` : ""}
         <span class="spacer"></span>
         <button type="button" class="ghost" data-act="cancel">Cancel</button>
         <button type="button" class="primary" data-act="save">Save</button>
       </div>`,
    );
    const card = dialog.card;
    const nameInput = card.querySelector<HTMLInputElement>('[data-f="name"]')!;
    const notesInput = card.querySelector<HTMLTextAreaElement>('[data-f="notes"]')!;
    nameInput.value = start.name;
    notesInput.value = start.notes;
    const save = () => {
      if (!current) return void finish(null);
      finish({ input: { name: nameInput.value, craft, notes: notesInput.value }, picture: current, cropped });
    };
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === nameInput) {
        e.preventDefault();
        save();
      }
    });
    card.addEventListener("click", async (e) => {
      const btn = closestEl(e.target, "button");
      if (!btn) return;
      if (btn.dataset.craft) {
        craft = btn.dataset.craft as Craft;
        for (const b of card.querySelectorAll<HTMLElement>("[data-craft]")) {
          b.classList.toggle("on", b === btn);
          b.setAttribute("aria-checked", String(b === btn));
        }
      }
      if (btn.dataset.act === "cancel") finish(null);
      if (btn.dataset.act === "save") save();
      if (btn.dataset.act === "crop" && url) {
        const blob = await cropImage(url, "Crop the chart");
        if (!blob) return;
        const bitmap = await createImageBitmap(blob).catch(() => null);
        current = { blob, width: bitmap?.width ?? 0, height: bitmap?.height ?? 0 };
        bitmap?.close();
        cropped = true;
        URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        card.querySelector<HTMLImageElement>('[data-el="img"]')!.src = url;
      }
    });
    dialog.show(nameInput);
  });
}

function cardHtml(c: ChartPicture): string {
  return `
    <article class="chartpic-card" data-open="${esc(c.id)}" title="Open it big">
      <div class="chartpic-picture" data-chartpic="${esc(c.id)}"></div>
      <div class="chartpic-body">
        <strong title="${esc(c.name)}">${esc(c.name)}</strong>
        <span class="pill chartpic-${esc(c.craft)}">${esc(craftLabel(c.craft))}</span>
        ${c.notes ? `<p class="chartpic-notes" title="${esc(c.notes)}">${esc(c.notes)}</p>` : ""}
        <div class="card-tools-row">
          <span class="spacer"></span>
          <button class="card-remove" data-act="edit" data-id="${esc(c.id)}" title="Its name, knitting or crochet, notes; crop it">Edit</button>
          <button class="card-remove" data-act="remove" data-id="${esc(c.id)}" title="Remove this chart">Remove</button>
        </div>
      </div>
    </article>`;
}

async function paintPicture(el: HTMLElement): Promise<void> {
  const url = await chartPictureUrl(el.dataset.chartpic!);
  if (url && el.isConnected) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add("filled");
  }
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
