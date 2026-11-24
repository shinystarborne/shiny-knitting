/**
 * Checks for a chart from a picture: the picture shrunk to a square a stitch
 * (row 0 its bottom, the rows as many as the stitches' shape needs), its
 * colours brought down to the number asked for, the most used first, single
 * squares tidied, a stash's yarns used in place of its own colours; and in the
 * Charts list, From a picture… making the chart.
 *
 * Run with the harness open:
 *   window.__pictureChartChecks()
 */
import type { Yarn } from "../src/api";
import { colourNames, pictureColours, rowsFor, squareColours, stitchAspect, tidied } from "../src/views/picture-chart";
import { keep } from "./keep";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** A picture: white, with a red square in the middle of it and a navy stripe along its bottom. */
function picture(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#c01818";
  // Whole pixels, so no edge is a blend of two colours.
  ctx.fillRect(Math.round(w / 4), Math.round(h / 4), Math.round(w / 2), Math.round(h / 2));
  ctx.fillStyle = "#1a2a6c";
  ctx.fillRect(0, h - Math.round(h / 10), w, Math.round(h / 10));
  return canvas;
}

const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));

function pure(results: CheckResult[]): void {
  check(results, "a square picture 60 stitches wide is 80 rows, stitches being 4 to 3 without a gauge", rowsFor(100, 100, 60, stitchAspect({ sts: 0, rows: 0 })) === 80);
  check(results, "…and 60 rows at a gauge as many rows as stitches", rowsFor(100, 100, 60, stitchAspect({ sts: 20, rows: 20 })) === 60);

  // Top half red, bottom half blue, 4 × 4 pixels into 2 × 2 squares.
  const px = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) px.set(y < 2 ? [200, 0, 0, 255] : [0, 0, 200, 255], (y * 4 + x) * 4);
  const sq = squareColours(px, 4, 4, 2, 2);
  check(results, "each square the picture's colour under it, row 0 the picture's bottom", sq[0][2] === 200 && sq[1][2] === 200 && sq[2][0] === 200 && sq[3][0] === 200, JSON.stringify(sq));
  // Half white, half black, averaged.
  const half = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  check(results, "…the average of the pixels under it", squareColours(half, 2, 1, 1, 1)[0][0] === 127.5);

  const pic = picture(40, 40).getContext("2d")!.getImageData(0, 0, 40, 40).data;
  const squares = squareColours(pic, 40, 40, 20, 20);
  const three = pictureColours(squares, 20, 20, { count: 3, tidy: false });
  check(results, "brought down to the colours asked for, the most used first", three.colours.length === 3 && three.colours[0] === "#ffffff" && three.counts[0] >= three.counts[1] && three.counts[1] >= three.counts[2], JSON.stringify(three.colours));
  check(results, "…every square one of them", three.cells.length === 400 && [...three.cells].every((c) => c < 3) && three.counts.reduce((a, b) => a + b, 0) === 400);
  check(results, "…the bottom row the stripe, the middle the square", three.colours[three.cells[0]] === "#1a2a6c" && three.colours[three.cells[10 * 20 + 10]] === "#c01818", `${three.colours[three.cells[0]]} ${three.colours[three.cells[210]]}`);
  const two = pictureColours(squares, 20, 20, { count: 2, tidy: false });
  check(results, "fewer colours asked for, fewer given, each one in the picture (not white and navy blended)", two.colours.length === 2 && two.colours.every((c) => ["#ffffff", "#c01818", "#1a2a6c"].includes(c)) && two.colours[0] === "#ffffff", JSON.stringify(two.colours));

  const yarns = ["#f2f0ea", "#2b2b2b", "#b8262a", "#203070"];
  const stash = pictureColours(squares, 20, 20, { count: 3, palette: yarns, tidy: false });
  check(results, "from a palette: the nearest of its colours, each once, and which it is", stash.colours.join() === ["#f2f0ea", "#b8262a", "#203070"].join() && stash.from.join() === "0,2,3", `${stash.colours.join()} / ${stash.from.join()}`);

  // A 5 × 3 field of 0 with a lone 1 in the middle, and a pair of 2s along the top.
  const field = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 2]);
  const tidy = tidied(field, 5, 3);
  check(results, "a single square takes the colour round it; two together are kept", tidy[7] === 0 && tidy[13] === 2 && tidy[14] === 2, [...tidy].join(""));
  check(results, "colours named plainly, a second of a name numbered", colourNames(["#ffffff", "#808080", "#858585"]).join() === "white,grey,grey 2", colourNames(["#ffffff", "#808080", "#858585"]).join());
}

export async function verifyPictureChart() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: { id: string; name: string; data: { width: number; height: number; flat: boolean; gauge: { sts: number; rows: number }; colours: { name: string; hex: string; yarnId?: string }[]; cells: string } }[]; yarns: Yarn[] } }).__store;
  const restore = keep(["charts", "yarns", "covers"]);
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const calc = () => document.querySelector<HTMLElement>(".calculators");
  const dialog = () => document.querySelector<HTMLElement>(".picture-chart-dialog");
  const field = (f: string) => dialog()!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
  const set = (f: string, value: string) => {
    const el = field(f);
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const size = () => dialog()?.querySelector('[data-el="size"]')?.textContent ?? "";
  const realClick = HTMLInputElement.prototype.click;
  try {
    pure(results);

    const file = new File([await pngOf(picture(40, 30))], "Fox.png", { type: "image/png" });
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type !== "file") return realClick.call(this);
      const dt = new DataTransfer();
      dt.items.add(file);
      this.files = dt.files;
      this.dispatchEvent(new Event("change"));
    };

    tab("calculators");
    await waitFor(() => !!calc(), "the calculators");
    (calc()!.querySelector('[data-calc="charts"]') as HTMLElement).click();
    await waitFor(() => !!calc()?.querySelector('[data-act="from-picture"]'), "the charts list");
    check(results, "the charts list offers From a picture", !!calc()!.querySelector('[data-act="from-picture"]'));
    (calc()!.querySelector('[data-act="from-picture"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the dialog");
    const make = () => dialog()!.querySelector<HTMLButtonElement>('[data-act="make"]')!;
    check(results, "…nothing to make before a picture", make().disabled && !dialog()!.querySelector<HTMLElement>('[data-el="empty"]')!.hidden);
    (dialog()!.querySelector('[data-act="choose"]') as HTMLElement).click();
    await waitFor(() => !make().disabled, "the chart worked out");
    check(results, "a small picture is a pixel a stitch, named for its file, the rows for stitches 4 to 3", field("width").value === "40" && field("name").value === "Fox" && /^40 stitches × 40 rows/.test(size()), `${field("width").value} ${field("name").value} ${size()}`);
    check(results, "…shown as it knits up, with its colours", !dialog()!.querySelector<HTMLCanvasElement>('[data-el="preview"]')!.hidden && dialog()!.querySelectorAll(".picture-chart-colour").length === 3);

    set("count", "2");
    set("sts", "20");
    set("rows", "20");
    await waitFor(() => /^40 stitches × 30 rows, about 20 × 15 cm/.test(size()) && dialog()!.querySelectorAll(".picture-chart-colour").length === 2, "the new settings", 5000).catch(() => {});
    check(results, "a gauge gives the rows and the size; fewer colours, fewer shown", /^40 stitches × 30 rows, about 20 × 15 cm/.test(size()) && dialog()!.querySelectorAll(".picture-chart-colour").length === 2, size());
    set("width", "500");
    await waitFor(() => !dialog()!.querySelector<HTMLElement>('[data-el="error"]')!.hidden, "the error", 5000).catch(() => {});
    check(results, "too wide is said, and nothing made", !dialog()!.querySelector<HTMLElement>('[data-el="error"]')!.hidden && make().disabled);
    set("width", "40");
    set("flat", "flat");
    await waitFor(() => !make().disabled, "the chart again");
    const before = store.charts.length;
    make().click();
    await waitFor(() => !dialog() && store.charts.length === before + 1, "the chart made");
    const made = store.charts[store.charts.length - 1];
    check(
      results,
      "Make the chart: its size, gauge, colours (the most used first) and working",
      made.name === "Fox" && made.data.width === 40 && made.data.height === 30 && made.data.flat && made.data.gauge.sts === 20 && made.data.colours.length === 2 && made.data.colours[0].name === "white",
      JSON.stringify({ ...made.data, cells: undefined }),
    );
    await waitFor(() => !!document.querySelector(".chart-page"), "the chart opened");
    check(results, "…and it opens", !!document.querySelector(".chart-page"));

    (document.querySelector('.chart-page [data-act="back"]') as HTMLElement).click();

    // In the stash's yarn: of a scarlet yarn and a cream one, the scarlet knits the red.
    const [red, cream] = store.yarns.filter((y) => !y.usedUpAt).slice(1, 3);
    for (const [yarn, hex] of [[red, "#b8262a"], [cream, "#f2efe6"]] as const) {
      const swatch = document.createElement("canvas");
      swatch.width = swatch.height = 20;
      const sctx = swatch.getContext("2d")!;
      sctx.fillStyle = hex;
      sctx.fillRect(0, 0, 20, 20);
      await invoke("set_yarn_photo", { yarnId: yarn.id, bytes: [...new Uint8Array(await (await pngOf(swatch)).arrayBuffer())] });
    }
    await waitFor(() => !!calc()?.querySelector('[data-act="from-picture"]'), "the charts list again");
    (calc()!.querySelector('[data-act="from-picture"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the dialog again");
    (dialog()!.querySelector('[data-act="choose"]') as HTMLElement).click();
    await waitFor(() => !make().disabled, "the picture again");
    set("count", "3");
    set("from", "stash");
    await waitFor(() => !!dialog()!.querySelector(`.picture-chart-colour[title*="${red.name}"]`), "the yarn used", 8000).catch(() => {});
    check(results, "colours from the stash: the yarn nearest the picture's red is used", !!dialog()!.querySelector(`.picture-chart-colour[title*="${red.name}"]`), dialog()!.querySelector('[data-el="colours"]')?.textContent?.replace(/\s+/g, " ") ?? "");
    await waitFor(() => !make().disabled, "the chart in yarn");
    make().click();
    await waitFor(() => !dialog() && store.charts.length === before + 2, "the second chart made");
    const yarned = store.charts[store.charts.length - 1];
    check(results, "…linked to it in the chart, the cream for the white", yarned.data.colours.length === 2 && yarned.data.colours[0].yarnId === cream.id && yarned.data.colours.some((c) => c.yarnId === red.id && c.hex === "#b8262a"), JSON.stringify(yarned.data.colours));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    HTMLInputElement.prototype.click = realClick;
    document.querySelector<HTMLElement>('.picture-chart-dialog [data-act="cancel"]')?.click();
    restore();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__pictureChartChecks = verifyPictureChart;
