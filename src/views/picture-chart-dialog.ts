import { api, type MeasureUnit, type Swatch, type Yarn } from "../api";
import { customDialog } from "../dialogs";
import { closestEl } from "../dom";
import { knittedSize, MAX_SIDE, type Grid } from "./chart";
import { drawThumbnail } from "./chart-draw";
import { cropImage } from "./crop-dialog";
import { gaugeOf, gaugeSpan, readGauge, showGauge, showLength, unitLabel } from "./measure";
import { yarnColour, yarnLabel } from "./photo-colours";
import { MAX_PICTURE_COLOURS, MIN_WIDTH, pictureColours, pictureGrid, rowsFor, squareColours, stitchAspect, type PictureColours } from "./picture-chart";

/** The picture is read at most this many pixels on its longer side: plenty for 400 stitches. */
const READ_SIDE = 800;

interface Picture {
  blob: Blob;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * A chart from a picture: one chosen, pasted or dropped, cropped if wanted,
 * then made into squares at a width in stitches and a number of colours (the
 * picture's own, or the stash's yarns nearest them), shown as it will knit up
 * while the settings change. Resolves the chart to make, or null.
 */
export async function pictureChartDialog(first: File | null = null): Promise<{ name: string; grid: Grid } | null> {
  const [yarns, swatches, unit] = await Promise.all([
    api.listYarns().catch(() => [] as Yarn[]),
    api.listSwatches().catch(() => [] as Swatch[]),
    api.getMeasureUnit().catch(() => "cm" as MeasureUnit),
  ]);
  const inStash = yarns.filter((y) => !y.usedUpAt && y.photoPath);
  const usable = swatches.filter((s) => gaugeOf(s).sts && gaugeOf(s).rows);
  const span = gaugeSpan(unit);

  return new Promise((resolve) => {
    let picture: Picture | null = null;
    let made: { result: PictureColours; grid: Grid } | null = null;
    // The stash's yarns with their colours, read from their photos once asked for.
    let coloured: { yarn: Yarn; hex: string }[] | null = null;
    let timer = 0;
    let done = false;
    // Each working-out numbered: one overtaken by a newer one is dropped.
    let runs = 0;

    const finish = (out: { name: string; grid: Grid } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("paste", onPaste);
      dialog.close();
      resolve(out);
    };
    const dialog = customDialog("Chart from a picture", () => finish(null), "picture-chart-dialog");
    const card = dialog.card;
    card.insertAdjacentHTML(
      "beforeend",
      `
      <div class="picture-chart-body">
        <div class="picture-chart-stage" data-el="stage">
          <p class="picture-chart-empty" data-el="empty">A picture to choose, paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drop here.<br />
            <button type="button" class="primary" data-act="choose">Choose a picture…</button></p>
          <canvas data-el="preview" hidden></canvas>
        </div>
        <div class="picture-chart-fields">
          <label class="dialog-field"><span class="dialog-label">Name</span>
            <input class="dialog-input" data-f="name" placeholder="e.g. Fox" /></label>
          <div class="picture-chart-pair">
            <label class="dialog-field"><span class="dialog-label">Stitches wide</span>
              <input class="dialog-input" data-f="width" type="number" min="${MIN_WIDTH}" max="${MAX_SIDE}" step="1" value="60" /></label>
            <label class="dialog-field"><span class="dialog-label">Colours</span>
              <input class="dialog-input" data-f="count" type="number" min="2" max="${MAX_PICTURE_COLOURS}" step="1" value="4" /></label>
          </div>
          <label class="dialog-field"><span class="dialog-label">Colours from</span>
            <select class="dialog-input" data-f="from">
              <option value="picture">The picture</option>
              <option value="stash" ${inStash.length ? "" : "disabled"}>Yarn in the stash${inStash.length ? ", nearest the picture's" : " (none has a photo)"}</option>
            </select></label>
          <label class="dialog-field"><span class="dialog-label">Worked</span>
            <select class="dialog-input" data-f="flat"><option value="round">In the round</option><option value="flat">Flat, in rows</option></select></label>
          <div class="dialog-field"><span class="dialog-label">Gauge <em class="dialog-hint">per ${span}, for the stitches' shape</em></span>
            ${
              usable.length
                ? `<select class="dialog-input" data-f="swatch"><option value="">From a swatch…</option>${usable
                    .map((s) => `<option value="${esc(s.id)}">${esc(`${showGauge(gaugeOf(s).sts, unit)} × ${showGauge(gaugeOf(s).rows, unit)} on ${s.needleMm} mm · ${s.yarnName || "yarn"}`)}</option>`)
                    .join("")}</select>`
                : ""
            }
            <div class="picture-chart-pair">
              <input class="dialog-input" data-f="sts" inputmode="decimal" placeholder="Stitches, e.g. 18" aria-label="Stitches per ${span}" />
              <input class="dialog-input" data-f="rows" inputmode="decimal" placeholder="Rows, e.g. 24" aria-label="Rows per ${span}" />
            </div>
          </div>
          <label class="dialog-field dialog-checkfield"><input class="dialog-check" type="checkbox" data-f="tidy" checked />
            <span><span class="dialog-label">Tidy single squares</span><span class="dialog-hint">A square alone in its colour takes the colour round it.</span></span></label>
          <p class="hint" data-el="size"></p>
          <div class="picture-chart-colours" data-el="colours"></div>
        </div>
      </div>
      <p class="form-error" data-el="error" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="ghost" data-act="choose" data-el="another" hidden>Another picture…</button>
        <button type="button" class="ghost" data-act="crop" disabled>Crop…</button>
        <button type="button" class="ghost" data-act="cancel">Cancel</button>
        <button type="button" class="primary" data-act="make" disabled>Make the chart</button>
      </div>`,
    );
    const el = (name: string) => card.querySelector<HTMLElement>(`[data-el="${name}"]`)!;
    const field = <T extends HTMLElement = HTMLInputElement>(name: string) => card.querySelector<T>(`[data-f="${name}"]`)!;
    const canvas = el("preview") as HTMLCanvasElement;
    const stage = el("stage");
    const error = el("error");
    const makeButton = card.querySelector<HTMLButtonElement>('[data-act="make"]')!;
    const cropButton = card.querySelector<HTMLButtonElement>('[data-act="crop"]')!;

    const fail = (text: string) => {
      error.textContent = text;
      error.hidden = !text;
    };

    const gauge = () => {
      const sts = readGauge(field("sts").value, unit);
      const rows = readGauge(field("rows").value, unit);
      return { sts: sts > 0 ? Math.round(sts * 10) / 10 : 0, rows: rows > 0 ? Math.round(rows * 10) / 10 : 0 };
    };

    /** The chart worked out again from the picture and the settings, and shown. */
    const update = async () => {
      const run = ++runs;
      made = null;
      makeButton.disabled = true;
      if (!picture) return;
      const width = Number(field("width").value);
      const count = Number(field("count").value);
      if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_SIDE) return fail(`A chart from a picture is ${MIN_WIDTH} to ${MAX_SIDE} stitches wide.`);
      if (!Number.isInteger(count) || count < 2 || count > MAX_PICTURE_COLOURS) return fail(`2 to ${MAX_PICTURE_COLOURS} colours.`);
      const g = gauge();
      const rows = rowsFor(picture.width, picture.height, width, stitchAspect(g));
      if (rows > MAX_SIDE) return fail(`At ${width} stitches wide the picture is ${rows} rows: at most ${MAX_SIDE}. Fewer stitches, or crop it.`);
      let palette: string[] | undefined;
      if (field<HTMLSelectElement>("from").value === "stash") {
        coloured ??= (await Promise.all(inStash.map(async (yarn) => ({ yarn, hex: await yarnColour(yarn) })))).filter((c): c is { yarn: Yarn; hex: string } => !!c.hex);
        if (done || run !== runs) return;
        if (!coloured.length) return fail("No yarn in the stash has a photo to read its colour from.");
        palette = coloured.map((c) => c.hex);
      }
      fail("");
      const result = pictureColours(squareColours(picture.pixels, picture.width, picture.height, width, rows), width, rows, { count, palette, tidy: field("tidy").checked });
      const grid = pictureGrid(result, width, rows, { flat: field<HTMLSelectElement>("flat").value === "flat", gauge: g });
      if (palette) {
        result.from.forEach((j, i) => {
          const yarn = coloured![j].yarn;
          Object.assign(grid.colours[i], { yarnId: yarn.id, yarn: yarnLabel(yarn), name: (yarn.colourway || yarn.name || grid.colours[i].name).slice(0, 40) });
        });
      }
      made = { result, grid };
      canvas.hidden = false;
      el("empty").hidden = true;
      drawThumbnail(canvas, grid, Math.max(200, stage.clientWidth - 16), 380);
      const real = knittedSize(grid);
      el("size").textContent = `${width} stitches × ${rows} rows${real ? `, about ${showLength(real.width, unit)} × ${showLength(real.height, unit)} ${unitLabel(unit)}` : ""}.`;
      const total = width * rows;
      el("colours").innerHTML = grid.colours
        .map(
          (c, i) => `<span class="picture-chart-colour" title="${esc(c.yarn ?? c.name)}"><span class="photo-colour-sw small" style="background:${c.hex}"></span>${esc(c.name)}
            <span class="hint">${Math.max(1, Math.round((result.counts[i] / total) * 100))}%</span></span>`,
        )
        .join("");
      makeButton.disabled = false;
    };
    const updateSoon = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void update(), 150);
    };

    /** A picture taken in: read onto white (a see-through one's background), at most READ_SIDE across. */
    const take = async (blob: Blob, fileName = "") => {
      let read: Picture | null = null;
      try {
        const bitmap = await createImageBitmap(blob);
        try {
          const scale = Math.min(1, READ_SIDE / Math.max(bitmap.width, bitmap.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(bitmap.width * scale));
          c.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(bitmap, 0, 0, c.width, c.height);
          read = { blob, pixels: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
        } finally {
          bitmap.close();
        }
      } catch {
        read = null;
      }
      if (done) return;
      if (!read) return fail("This file is not a readable picture.");
      const fresh = !picture;
      picture = read;
      cropButton.disabled = false;
      el("another").hidden = false;
      const name = field("name");
      const base = fileName.replace(/\.[^.]+$/, "").trim();
      if (fresh && !name.value.trim() && base && !/^image$/i.test(base)) name.value = base.slice(0, 80);
      // Pixel art comes in a pixel a stitch; a photo starts at 60 stitches.
      if (fresh) field("width").value = String(read.width <= 100 ? Math.max(MIN_WIDTH, read.width) : 60);
      await update();
    };

    const choose = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void take(file, file.name);
      });
      input.click();
    };

    const crop = async () => {
      if (!picture) return;
      const url = URL.createObjectURL(picture.blob);
      try {
        const cropped = await cropImage(url, "Crop the picture");
        if (cropped) await take(cropped);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    function onPaste(e: ClipboardEvent) {
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void take(file, file.name);
    }
    document.addEventListener("paste", onPaste);

    stage.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      stage.classList.add("over");
    });
    stage.addEventListener("dragleave", (e) => {
      if (!stage.contains(e.relatedTarget as Node)) stage.classList.remove("over");
    });
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      stage.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void take(file, file.name);
    });

    card.addEventListener("input", (e) => {
      const f = (e.target as HTMLElement).dataset.f;
      if (f && f !== "name") updateSoon();
    });
    card.addEventListener("change", (e) => {
      const f = (e.target as HTMLElement).dataset.f;
      if (f === "swatch") {
        const s = usable.find((x) => x.id === field<HTMLSelectElement>("swatch").value);
        if (s) {
          field("sts").value = showGauge(gaugeOf(s).sts, unit);
          field("rows").value = showGauge(gaugeOf(s).rows, unit);
        }
        field<HTMLSelectElement>("swatch").value = "";
      }
      if (f && f !== "name") updateSoon();
    });
    card.addEventListener("click", (e) => {
      const act = closestEl(e.target, "button[data-act]")?.dataset.act;
      if (act === "cancel") finish(null);
      if (act === "choose") choose();
      if (act === "crop") void crop();
      if (act === "make" && made) finish({ name: field("name").value.trim() || "Picture", grid: made.grid });
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
        e.preventDefault();
        clearTimeout(timer);
        void update().then(() => {
          if (made && !done) finish({ name: field("name").value.trim() || "Picture", grid: made.grid });
        });
      }
    });
    dialog.show(first ? field("name") : card.querySelector<HTMLElement>('[data-act="choose"]')!);
    if (first) void take(first, first.name);
  });
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
