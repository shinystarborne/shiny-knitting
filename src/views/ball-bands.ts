import { api, type BallBand, type Yarn } from "../api";
import { ballBandUrl, blobBytes, forgetBallBand, prepareBoardImage } from "../covers";
import { askYesNo, customDialog, say } from "../dialogs";
import { closestEl } from "../dom";
import { makeCombo } from "./combo";
import { describeFibres } from "./fibres";
import { stashModeSwitch } from "./swatches";
import { mostUsedSpellings } from "./tool-filter";

/** A ball band's picture is kept big enough to read its small print. */
const BAND_SIZE = 1800;

/** One yarn's ball band: every picture filed under its brand and name. */
interface Band {
  brand: string;
  name: string;
  pictures: BallBand[];
}

/** A yarn's brand and name as one key, whatever the case; it survives being an HTML attribute. */
const key = (brand: string, name: string) => JSON.stringify([brand.trim().toLowerCase(), name.trim().toLowerCase()]);

/**
 * The Stash tab's ball bands: pictures of the paper round each yarn's ball,
 * filed by the yarn's brand and name ("Drops", "Air"), not its colour, so one
 * band does for every colour of it. Grouped by brand, each with what the
 * stash knows of the yarn: the colours had, its weight, ball band and fibres.
 */
export class BallBandsView {
  private screen: HTMLElement;
  private root!: HTMLElement;
  private results!: HTMLElement;
  private bands: Band[] = [];
  private yarns: Yarn[] = [];
  private search = "";

  constructor(screen: HTMLElement) {
    this.screen = screen;
  }

  async mount(): Promise<void> {
    this.root = document.createElement("div");
    this.root.className = "library ball-bands";
    this.root.innerHTML = `
      <header class="lib-bar">
        <div class="lib-title"><h1>Stash</h1>${stashModeSwitch("bands")}</div>
        <div class="lib-actions">
          <input class="search" type="search" placeholder="Search brand or yarn..." />
          <button data-act="add" class="primary">+ Add a ball band</button>
        </div>
      </header>
      <main class="results band-results"></main>
    `;
    this.screen.appendChild(this.root);
    this.results = this.root.querySelector(".results")!;
    const box = this.root.querySelector<HTMLInputElement>(".search")!;
    box.addEventListener("input", () => {
      this.search = box.value.trim().toLowerCase();
      this.paint();
    });
    this.root.addEventListener("click", (e) => void this.onClick(e));
    await this.reload();
  }

  async reload(): Promise<void> {
    const [bands, yarns] = await Promise.all([api.listBallBands(), api.listYarns({ used: "all" }).catch(() => [] as Yarn[])]);
    this.yarns = yarns;
    const byKey = new Map<string, Band>();
    for (const b of bands) {
      const k = key(b.brand, b.name);
      if (!byKey.has(k)) byKey.set(k, { brand: b.brand, name: b.name, pictures: [] });
      byKey.get(k)!.pictures.push(b);
    }
    this.bands = [...byKey.values()];
    this.paint();
  }

  /** The stash's colours of a yarn, used up ones too. */
  private coloursOf(brand: string, name: string): Yarn[] {
    return this.yarns.filter((y) => key(y.brand, y.name) === key(brand, name));
  }

  private paint(): void {
    const words = this.search.split(/\s+/).filter(Boolean);
    const found = (brand: string, name: string) => words.every((w) => `${brand} ${name}`.toLowerCase().includes(w));
    const shown = this.bands.filter((b) => found(b.brand, b.name));
    // Yarn in the stash with no band yet, to add one for at a click.
    const banded = new Set(this.bands.map((b) => key(b.brand, b.name)));
    const missing = new Map<string, Yarn>();
    for (const y of this.yarns) {
      const k = key(y.brand, y.name);
      if (!y.usedUpAt && !banded.has(k) && !missing.has(k) && found(y.brand, y.name)) missing.set(k, y);
    }
    const brands = [...new Set(shown.map((b) => b.brand))].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1));
    const sections = brands
      .map(
        (brand) => `
        <section class="band-brand">
          <h2>${esc(brand || "No brand")}</h2>
          <div class="band-grid">${shown.filter((b) => b.brand === brand).map((b) => this.cardHtml(b)).join("")}</div>
        </section>`,
      )
      .join("");
    const todo = [...missing.values()].sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`));
    this.results.innerHTML = `
      ${
        sections ||
        `<div class="empty"><h2>${this.bands.length ? "No ball band by that name" : "No ball bands yet"}</h2>
          <p>${this.bands.length ? "Try another word." : "Keep a picture of each yarn's ball band, its care symbols, needle size and gauge, filed by brand and yarn: one for every colour of it."}</p></div>`
      }
      ${
        todo.length
          ? `<section class="band-missing">
              <h3>In the stash, without a ball band</h3>
              <div class="band-missing-list">${todo
                .map((y) => `<button class="ghost" data-act="add-for" data-brand="${esc(y.brand)}" data-name="${esc(y.name)}" title="Add a picture of its ball band">+ ${esc([y.brand, y.name].filter(Boolean).join(" "))}</button>`)
                .join("")}</div>
            </section>`
          : ""
      }`;
    for (const img of this.results.querySelectorAll<HTMLElement>("[data-pic]")) void this.paintPicture(img);
  }

  private cardHtml(b: Band): string {
    const colours = this.coloursOf(b.brand, b.name);
    const had = colours.filter((y) => !y.usedUpAt).length;
    const used = colours.length - had;
    const known = colours.find((y) => y.metresPerBall && y.gramsPerBall) ?? colours[0];
    const fibres = colours.find((y) => y.fibres.length)?.fibres ?? [];
    const lines = [
      !colours.length
        ? "None in the stash"
        : had
          ? `${had} colour${had === 1 ? "" : "s"} in the stash${used ? `, ${used} used up` : ""}`
          : `None left: ${used} colour${used === 1 ? "" : "s"} used up`,
      [known?.yarnWeight, known?.metresPerBall && known.gramsPerBall ? `${known.metresPerBall} m / ${known.gramsPerBall} g` : ""].filter(Boolean).join(" · "),
      fibres.length ? describeFibres(fibres) : "",
    ].filter(Boolean);
    return `
      <article class="band-card" data-open-band="${esc(key(b.brand, b.name))}">
        <div class="band-pic" data-pic="${esc(b.pictures[0].id)}">
          ${b.pictures.length > 1 ? `<span class="band-count">${b.pictures.length} pictures</span>` : ""}
        </div>
        <div class="band-body">
          <h3>${esc(b.name)}</h3>
          ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
        </div>
      </article>`;
  }

  private async paintPicture(el: HTMLElement): Promise<void> {
    const url = await ballBandUrl(el.dataset.pic!).catch(() => null);
    if (url) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add("filled");
    }
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (btn?.dataset.act === "stash-mode") return void this.root.dispatchEvent(new CustomEvent("stash-mode", { bubbles: true, detail: btn.dataset.mode }));
    if (btn?.dataset.act === "add") return void (await this.addDialog("", ""));
    if (btn?.dataset.act === "add-for") return void (await this.addDialog(btn.dataset.brand ?? "", btn.dataset.name ?? ""));
    const card = closestEl(e.target, "[data-open-band]");
    const band = card && this.bands.find((b) => key(b.brand, b.name) === card.dataset.openBand);
    if (band) await this.showBand(band);
  }

  /** Every brand and name the stash and the bands know, for the boxes to offer. */
  private known(): { brands: string[]; names: (brand: string) => string[] } {
    const all = [...this.yarns.map((y) => ({ brand: y.brand, name: y.name })), ...this.bands.map((b) => ({ brand: b.brand, name: b.name }))];
    return {
      brands: mostUsedSpellings(all.map((a) => a.brand).filter(Boolean)),
      names: (brand) => {
        const b = brand.trim().toLowerCase();
        const of = b ? all.filter((a) => a.brand.trim().toLowerCase() === b) : all;
        return mostUsedSpellings((of.length ? of : all).map((a) => a.name));
      },
    };
  }

  /** A new ball band: its brand and name, and a picture pasted, dropped or chosen. */
  private addDialog(brand: string, name: string): Promise<void> {
    return new Promise((resolve) => {
      let picture: Blob | null = null;
      const finish = async (saved: boolean) => {
        document.removeEventListener("paste", onPaste);
        dialog.close();
        if (saved) await this.reload();
        resolve();
      };
      const dialog = customDialog("Add a ball band", () => void finish(false), "band-dialog");
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <div class="band-names">
          <label class="dialog-field"><span class="dialog-label">Brand</span><input class="dialog-input" data-f="brand" value="${esc(brand)}" placeholder="e.g. Drops" /></label>
          <label class="dialog-field"><span class="dialog-label">Yarn</span><input class="dialog-input" data-f="name" value="${esc(name)}" placeholder="e.g. Air" /></label>
        </div>
        <p class="dialog-hint">Filed by brand and yarn, not colour: one ball band does for every colour of it.</p>
        ${dropBox()}
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="file">Choose a picture…</button>
          <span class="spacer"></span>
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">Add</button>
        </div>`,
      );
      const card = dialog.card;
      const known = this.known();
      const brandBox = card.querySelector<HTMLInputElement>('[data-f="brand"]')!;
      const nameBox = card.querySelector<HTMLInputElement>('[data-f="name"]')!;
      makeCombo(brandBox, () => known.brands);
      makeCombo(nameBox, () => known.names(brandBox.value));
      const box = card.querySelector<HTMLElement>('[data-el="drop"]')!;
      const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
      const fail = (text: string) => {
        error.textContent = text;
        error.hidden = !text;
      };
      const use = async (file: Blob | null) => {
        if (!file) return;
        fail("");
        const prepared = await prepareBoardImage(file, BAND_SIZE);
        if (!prepared) return fail("That could not be read as a picture.");
        picture = prepared.blob;
        box.style.backgroundImage = `url("${URL.createObjectURL(picture)}")`;
        box.classList.add("filled");
      };
      const onPaste = pasteHandler(use, fail);
      document.addEventListener("paste", onPaste);
      wireDrop(box, use, fail);
      card.addEventListener("click", async (e) => {
        const act = closestEl(e.target, "button[data-act]");
        if (act?.dataset.act === "cancel") return void finish(false);
        if (act?.dataset.act === "file") return chooseFile(use);
        if (act?.dataset.act !== "save") return;
        if (!nameBox.value.trim()) return fail("Say which yarn it is: Air, for Drops Air.");
        if (!picture) return fail("Paste, drop or choose a picture of the ball band.");
        (act as HTMLButtonElement).disabled = true;
        try {
          await api.addBallBand(brandBox.value, nameBox.value, await blobBytes(picture));
          await finish(true);
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
          (act as HTMLButtonElement).disabled = false;
        }
      });
      dialog.show(brand ? box : brandBox);
    });
  }

  /** One yarn's ball band, big: its pictures, another added, one removed, or the yarn named again. */
  private showBand(band: Band): Promise<void> {
    return new Promise((resolve) => {
      let changed = false;
      let { brand, name } = band;
      let pictures = [...band.pictures];
      const finish = async () => {
        document.removeEventListener("paste", onPaste);
        dialog.close();
        if (changed) await this.reload();
        resolve();
      };
      const dialog = customDialog(`${[band.brand, band.name].filter(Boolean).join(" ")}: ball band`, () => void finish(), "band-dialog band-view");
      dialog.card.insertAdjacentHTML(
        "beforeend",
        `
        <div class="band-pictures" data-el="pictures"></div>
        ${dropBox("Paste, drop or choose another picture: the band's back, say")}
        <div class="band-names">
          <label class="dialog-field"><span class="dialog-label">Brand</span><input class="dialog-input" data-f="brand" value="${esc(brand)}" /></label>
          <label class="dialog-field"><span class="dialog-label">Yarn</span><input class="dialog-input" data-f="name" value="${esc(name)}" /></label>
        </div>
        <p class="form-error" data-el="error" hidden></p>
        <div class="dialog-actions">
          <button class="ghost" data-act="file">Choose a picture…</button>
          <span class="spacer"></span>
          <button class="primary" data-act="done">Done</button>
        </div>`,
      );
      const card = dialog.card;
      const error = card.querySelector<HTMLElement>('[data-el="error"]')!;
      const fail = (text: string) => {
        error.textContent = text;
        error.hidden = !text;
      };
      const paintPictures = () => {
        const host = card.querySelector<HTMLElement>('[data-el="pictures"]')!;
        host.innerHTML = pictures
          .map((p) => `<figure class="band-picture"><img data-pic="${esc(p.id)}" alt="" /><button class="ghost danger-text" data-act="remove-picture" data-id="${esc(p.id)}" title="Remove this picture">Remove</button></figure>`)
          .join("");
        for (const img of host.querySelectorAll<HTMLImageElement>("img[data-pic]")) {
          void ballBandUrl(img.dataset.pic!).then((url) => url && (img.src = url));
        }
      };
      const use = async (file: Blob | null) => {
        if (!file) return;
        fail("");
        const prepared = await prepareBoardImage(file, BAND_SIZE);
        if (!prepared) return fail("That could not be read as a picture.");
        try {
          pictures.push(await api.addBallBand(brand, name, await blobBytes(prepared.blob)));
          changed = true;
          paintPictures();
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
      };
      const onPaste = pasteHandler(use, fail);
      document.addEventListener("paste", onPaste);
      wireDrop(card.querySelector<HTMLElement>('[data-el="drop"]')!, use, fail);
      // Named again: every picture of it moves, when the name is left.
      const rename = async () => {
        const b = card.querySelector<HTMLInputElement>('[data-f="brand"]')!.value;
        const n = card.querySelector<HTMLInputElement>('[data-f="name"]')!.value;
        if (b.trim() === brand && n.trim() === name) return;
        try {
          const all = await api.renameBallBands(brand, name, b, n);
          const moved = all.find((x) => pictures.some((p) => p.id === x.id));
          if (moved) ({ brand, name } = moved);
          changed = true;
          fail("");
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
      };
      for (const f of card.querySelectorAll<HTMLInputElement>('[data-f="brand"], [data-f="name"]')) f.addEventListener("change", () => void rename());
      card.addEventListener("click", async (e) => {
        const act = closestEl(e.target, "button[data-act]");
        if (act?.dataset.act === "done") {
          await rename();
          return void finish();
        }
        if (act?.dataset.act === "file") return chooseFile(use);
        if (act?.dataset.act === "remove-picture") {
          const last = pictures.length === 1;
          if (!(await askYesNo(last ? "Remove the ball band's only picture? The ball band goes with it." : "Remove this picture of the ball band?", { title: "Remove picture", okLabel: "Remove", danger: true }))) return;
          try {
            await api.deleteBallBand(act.dataset.id!);
            forgetBallBand(act.dataset.id!);
          } catch (err) {
            return void (await say(err instanceof Error ? err.message : String(err), "Ball band"));
          }
          changed = true;
          pictures = pictures.filter((p) => p.id !== act.dataset.id);
          if (!pictures.length) return void finish();
          paintPictures();
        }
      });
      paintPictures();
      dialog.show(card.querySelector<HTMLElement>('[data-act="done"]')!);
    });
  }
}

function dropBox(hint = "Paste a picture with Ctrl+V, or drop one here"): string {
  return `<div class="cover-drop band-drop" data-el="drop" tabindex="0"><span class="cover-drop-hint">${esc(hint)}</span></div>`;
}

/** While a dialog is up, a picture pasted anywhere is for it. */
function pasteHandler(use: (file: Blob | null) => Promise<void>, fail: (text: string) => void): (e: ClipboardEvent) => void {
  return (e) => {
    const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
    if (!file) {
      // Text pasted into a box is the box's.
      if (!(e.target instanceof HTMLInputElement)) fail("There is no picture on the clipboard. Copy one first (right-click it, then Copy image).");
      return;
    }
    e.preventDefault();
    void use(file);
  };
}

function wireDrop(box: HTMLElement, use: (file: Blob | null) => Promise<void>, fail: (text: string) => void): void {
  box.addEventListener("dragover", (e) => {
    e.preventDefault();
    box.classList.add("over");
  });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("over");
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) void use(file);
    else fail("Only a picture file can be dropped here.");
  });
}

function chooseFile(use: (file: Blob | null) => Promise<void>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => void use(input.files?.[0] ?? null));
  input.click();
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
