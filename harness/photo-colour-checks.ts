/**
 * Checks for colours from a photo: a photo's main colours picked out (alike
 * ones as one, slivers left out, the most first), named plainly, and matched
 * to the nearest yarns by their photos; and in the chart editor, the photo's
 * colours recolouring a chart, a yarn picked for a colour named in it.
 *
 * Run with the harness open:
 *   window.__photoColourChecks()
 */
import type { Chart, Yarn } from "../src/api";
import { colourDistance, colourName, mainColours, nearestYarns } from "../src/views/photo-colours";

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

/** A picture in bands of colour, `parts` of each, side by side. */
function banded(bands: [string, number][], w = 100, h = 60): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const total = bands.reduce((n, [, p]) => n + p, 0);
  let x = 0;
  for (const [colour, parts] of bands) {
    const bw = Math.round((parts / total) * w);
    ctx.fillStyle = colour;
    ctx.fillRect(x, 0, bw, h);
    x += bw;
  }
  return canvas;
}

const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));

function pure(results: CheckResult[]): void {
  const pixels = (bands: [string, number][]) => banded(bands).getContext("2d")!.getImageData(0, 0, 100, 60).data;
  const three = mainColours(pixels([["#b42323", 60], ["#2040a0", 30], ["#f4f4f4", 10]]));
  check(results, "a photo's main colours, the most of it first, with how much", three.length === 3 && three[0].hex === "#b42323" && three[1].hex === "#2040a0" && Math.abs(three[0].share - 0.6) < 0.03, JSON.stringify(three));
  const alike = mainColours(pixels([["#b42323", 50], ["#b82626", 49], ["#2040a0", 1]]));
  check(results, "…colours that look alike are one, and a sliver is left out", alike.length === 1 && alike[0].share > 0.95, JSON.stringify(alike));
  check(results, "colours compared as they look: the same is 0, red and blue far apart", colourDistance("#b42323", "#b42323") === 0 && colourDistance("#b42323", "#b82626") < 3 && colourDistance("#b42323", "#2040a0") > 50);
  check(results, "a colour named plainly", colourName("#ffffff") === "white" && colourName("#111111") === "black" && colourName("#808080") === "grey" && colourName("#2040a0") === "blue" && colourName("#b42323") === "red" && colourName("#f4a6c0") === "light pink" && colourName("#efe8d8") === "cream" && colourName("#c4a030") === "mustard", [colourName("#2040a0"), colourName("#b42323"), colourName("#f4a6c0"), colourName("#efe8d8"), colourName("#c4a030")].join(","));
  const yarn = (id: string) => ({ id }) as Yarn;
  const near = nearestYarns("#b42323", [{ yarn: yarn("brick"), hex: "#a52a2a" }, { yarn: yarn("navy"), hex: "#1a2a6c" }, { yarn: yarn("scarlet"), hex: "#b8262a" }]);
  check(results, "the yarns nearest a colour, the nearest first, none far off", near.map((n) => n.yarn.id).join(",") === "scarlet,brick", near.map((n) => `${n.yarn.id} ${n.distance.toFixed(1)}`).join(", "));
}

export async function verifyPhotoColours() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: Chart[]; yarns: Yarn[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const calc = () => document.querySelector<HTMLElement>(".calculators");
  const page = () => document.querySelector<HTMLElement>(".chart-page");
  const dialog = () => document.querySelector<HTMLElement>(".photo-colours-dialog");
  const realClick = HTMLInputElement.prototype.click;
  const charts = [...store.charts];
  const red = store.yarns.find((y) => !y.usedUpAt)!;
  const photoBefore = red.photoPath;
  try {
    pure(results);

    // A yarn whose photo is scarlet, a little apart from the photo's red.
    const bytes = new Uint8Array(await (await pngOf(banded([["#b8262a", 1]]))).arrayBuffer());
    await invoke("set_yarn_photo", { yarnId: red.id, bytes: [...bytes] });
    const photo = new File([await pngOf(banded([["#b42323", 70], ["#2040a0", 30]]))], "fair-isle.png", { type: "image/png" });
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type !== "file") return realClick.call(this);
      const dt = new DataTransfer();
      dt.items.add(photo);
      this.files = dt.files;
      this.dispatchEvent(new Event("change"));
    };

    tab("calculators");
    await waitFor(() => !!calc(), "the calculators");
    (calc()!.querySelector('[data-calc="charts"]') as HTMLElement).click();
    await waitFor(() => !!calc()?.querySelector('[data-act="new-chart"]'), "the charts list");
    (calc()!.querySelector('[data-act="new-chart"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".chart-new-dialog"), "the new chart dialog");
    const nd = document.querySelector<HTMLElement>(".chart-new-dialog")!;
    const name = nd.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.value = "From a photo";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    (nd.querySelector('[data-act="make"]') as HTMLElement).click();
    await waitFor(() => !!page()?.querySelector('[data-act="photo-colours"]'), "the chart");
    check(results, "the chart's colours offer From a photo", !!page()!.querySelector('[data-act="photo-colours"]'));

    (page()!.querySelector('[data-act="photo-colours"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector(".photo-colour"), "the colours found", 20000);
    const rows = () => [...dialog()!.querySelectorAll<HTMLElement>(".photo-colour")];
    check(results, "the photo's colours are shown, the most of it first, each ticked", rows().length === 2 && /red/.test(rows()[0].textContent ?? "") && /70%/.test(rows()[0].textContent ?? "") && rows().every((r) => r.querySelector<HTMLInputElement>("[data-use]")!.checked), rows().map((r) => r.textContent?.replace(/\s+/g, " ")).join(" | "));
    const offered = rows()[0].querySelector<HTMLElement>(`[data-yarn="${red.id}"]`);
    check(results, "…with the stash's yarn nearest it, by its photo", !!offered && /very close/.test(offered.textContent ?? "") && !rows()[1].querySelector(`[data-yarn="${red.id}"]`), rows()[0].textContent?.replace(/\s+/g, " ") ?? "");
    offered!.click();
    check(results, "…picked, it is marked", offered!.classList.contains("on"));
    (dialog()!.querySelector('[data-act="recolour"]') as HTMLElement).click();
    await waitFor(() => !dialog(), "the dialog closed");
    const chart = () => store.charts.find((c) => c.name === "From a photo");
    await waitFor(() => chart()?.data.colours[0].hex === "#b42323", "the chart recoloured", 5000).catch(() => {});
    const cols = chart()?.data.colours ?? [];
    check(results, "Recolour: the chart's most used colour takes the photo's main one, knitted in the yarn picked", cols[0]?.hex === "#b42323" && cols[0]?.yarnId === red.id && cols[0]?.name === (red.colourway || red.name).slice(0, 40), JSON.stringify(cols));
    check(results, "…the next the next, named for how it looks", cols[1]?.hex === "#2040a0" && cols[1]?.name === "blue" && !cols[1]?.yarnId, JSON.stringify(cols[1]));

    (page()!.querySelector('[data-act="photo-colours"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector(".photo-colour"), "the colours again");
    rows()[0].querySelector<HTMLInputElement>("[data-use]")!.click();
    (dialog()!.querySelector('[data-act="add"]') as HTMLElement).click();
    await waitFor(() => (chart()?.data.colours.length ?? 0) === 3, "a colour added", 5000).catch(() => {});
    check(results, "Add to the chart: the ones ticked, after its own", chart()?.data.colours.length === 3 && chart()!.data.colours[2].hex === "#2040a0", JSON.stringify(chart()?.data.colours.map((c) => c.hex)));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    HTMLInputElement.prototype.click = realClick;
    document.querySelector<HTMLElement>('.photo-colours-dialog [data-act="cancel"]')?.click();
    if (!photoBefore) await invoke("remove_yarn_photo", { yarnId: red.id }).catch(() => {});
    store.charts = charts;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__photoColourChecks = verifyPhotoColours;
