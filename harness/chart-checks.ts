/**
 * Checks for the colourwork charts: the chart's arithmetic (a yoke's
 * shaping, the rows in words, long floats, editing), the PDF read back by
 * pdf.js, and the page -- a chart made, drawn on, undone, turned round,
 * exported and put on a board -- clicked through.
 *
 * Run with the harness open, after the other suites:
 *   window.__chartChecks()
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  clearRect,
  copyBlock,
  decode,
  encode,
  fillArea,
  flipped,
  flippedBlock,
  longFloats,
  MAX_COLOURS,
  newGrid,
  nextColour,
  normalize,
  pasteBlock,
  rectBetween,
  removeColour,
  resized,
  shifted,
  spreadColumns,
  stitchMask,
  stsInRow,
  turnedRound,
  usage,
  writeOut,
  range,
  type Grid,
} from "../src/views/chart";
import { chartPdf, squareSize, winAnsi } from "../src/views/chart-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

type StoredChart = { id: string; name: string; data: { kind: string; cells: string; width: number; height: number; repeats: number; topDown: boolean; sections: { row: number; sts: number; cols: number[] }[] } };
type Store = {
  charts: StoredChart[];
  boardItems: { id: string; boardId: string; kind: string; data: { text?: string } }[];
  projects: { id: string; name: string; status: string }[];
};

/** A grid from rows of colour digits, the first row knitted first. */
function grid(kind: "standard" | "yoke", rows: string[], o: Partial<Grid> = {}): Grid {
  const g = newGrid({ kind, width: rows[0].length, height: rows.length, repeats: o.repeats ?? 1 });
  Object.assign(g, o);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (g.cells[y * g.width + x] = Number(ch))));
  normalize(g);
  return g;
}

/** Stitches a written round takes from the round below, and makes: k3 takes and makes 3, k2tog takes 2 and makes 1, M1 makes 1. */
function tally(text: string): { takes: number; makes: number } {
  const inner = /\*(.*)\*/.exec(text)?.[1] ?? text;
  let takes = 0;
  let makes = 0;
  for (const part of inner.split(", ")) {
    const tog = /^[kp](\d)tog /.exec(part);
    const run = /^[kp](\d+) /.exec(part);
    if (tog) {
      takes += Number(tog[1]);
      makes += 1;
    } else if (/^M1 /.test(part)) {
      makes += 1;
    } else if (run) {
      takes += Number(run[1]);
      makes += Number(run[1]);
    }
  }
  return { takes, makes };
}

function pure(results: CheckResult[]): void {
  // ---------- a block: copied, flipped, pasted ----------
  const src = grid("standard", ["0120", "0310"]);
  src.colours.push({ name: "Red", hex: "#a8322d" }, { name: "Odd", hex: "#ff0000" });
  const box = rectBetween(src, [2, 1], [1, 0]);
  check(results, "a box between two squares, whichever corners", box.x0 === 1 && box.x1 === 2 && box.y0 === 0 && box.y1 === 1);
  const block = copyBlock(src, stitchMask(src), box);
  check(results, "a block copied: its squares row by row from the bottom, its colours with it", [...block.cells].join() === "1,2,3,1" && block.width === 2 && block.colours.length === 4);
  check(results, "…flipped ↔ and ↕", [...flippedBlock(block, "x").cells].join() === "2,1,1,3" && [...flippedBlock(block, "y").cells].join() === "3,1,1,2");
  const into = newGrid({ kind: "standard", width: 4, height: 3 });
  const changed = pasteBlock(into, stitchMask(into), block, 2, 2);
  const row = (g: Grid, y: number) => [...g.cells.slice(y * g.width, (y + 1) * g.width)].join("");
  check(results, "pasted into another chart, top-left where asked, its colours added there", row(into, 1) === "0012" && row(into, 2) === "0031" && into.colours[2].hex === "#a8322d" && into.colours[3].hex === "#ff0000" && changed.length === 4, `${row(into, 2)}/${row(into, 1)}`);
  const edge = newGrid({ kind: "standard", width: 4, height: 3 });
  pasteBlock(edge, stitchMask(edge), block, 3, 0);
  check(results, "…what falls off the chart is left off", row(edge, 0) === "0003" && row(edge, 1) === "0000", `${row(edge, 1)}/${row(edge, 0)}`);
  const full = newGrid({ kind: "standard", width: 4, height: 3 });
  while (full.colours.length < MAX_COLOURS) full.colours.push(nextColour(full));
  full.colours = full.colours.filter((c) => c.hex !== "#a8322d").concat({ name: "Brick", hex: "#b0302a" });
  while (full.colours.length < MAX_COLOURS) full.colours.push({ name: "x", hex: "#00ff00" });
  pasteBlock(full, stitchMask(full), copyBlock(src, stitchMask(src), rectBetween(src, [2, 0], [2, 0])), 0, 0);
  check(results, "…into a chart with no room for more colours, the nearest it has", full.colours.length === MAX_COLOURS && full.colours[full.cells[0]].hex === "#b0302a", full.colours[full.cells[0]]?.hex);
  const holes = newGrid({ kind: "standard", width: 4, height: 3 });
  const mask = stitchMask(holes);
  mask[0] = 0;
  pasteBlock(holes, mask, block, 0, 1);
  check(results, "…a square with no stitch is not painted", holes.cells[0] === 0 && holes.cells[1] === 2);
  const cleared = clearRect(src, stitchMask(src), box);
  check(results, "a box cleared to the background", cleared.length === 4 && row(src, 0) === "0000" && row(src, 1) === "0000");

  // ---------- the grid ----------
  const g = grid("standard", ["0011", "1000"], { flat: true });
  check(results, "a chart survives being stored and read back", encode(decode(encode(g))).cells === "00111000" && encode(g).cells === "00111000");
  check(results, "columns that go are spread evenly, alike in each part", spreadColumns(range(12), 2).join() === "3,9" && spreadColumns(range(12), 3).join() === "2,6,10" && spreadColumns([0, 1, 3], 1).join() === "1");

  // ---------- written out ----------
  const flat = writeOut(g);
  check(results, "a right-side row is read from the right", flat[0].label === "Row 1 (RS)" && flat[0].text === "k2 Black sheep, k2 Natural white.", JSON.stringify(flat[0]));
  check(results, "…a wrong-side row from the left, purled", flat[1].label === "Row 2 (WS)" && flat[1].text === "p1 Black sheep, p3 Natural white.", JSON.stringify(flat[1]));
  const round = writeOut(grid("standard", ["0000", "0000", "0110", "0000"]));
  check(results, "rounds alike one after another are written once", round.length === 3 && round[0].label === "Rounds 1–2" && round[0].text === "knit all in Natural white.", JSON.stringify(round));

  // A 4-stitch yoke repeat, 10 times round, losing a stitch at round 3.
  const yoke = grid("yoke", ["0000", "0000", "0000"], { repeats: 10, sections: [{ row: 0, sts: 4, cols: [] }, { row: 2, sts: 3, cols: [] }] });
  check(results, "a yoke's shaping greys out the columns that go", stitchMask(yoke).join("") === "111111111101" && stsInRow(yoke, 2) === 3);
  const yw = writeOut(yoke);
  check(results, "a yoke's rounds are its repeat, as many times as it goes round", yw[0].label === "Rounds 1–2 (40 sts)" && yw[0].text === "knit all in Natural white.", JSON.stringify(yw[0]));
  check(results, "…a decrease round knits the gone stitch together with the one beside it", yw[1].label === "Round 3, decrease round (40 → 30 sts)" && yw[1].text === "*k2tog Natural white, k2 Natural white* 10 times.", JSON.stringify(yw[1]));
  const down = decode(encode(yoke));
  turnedRound(down);
  const dw = writeOut(down);
  check(results, "turned to top-down, the shaping is at the other end and grows", down.topDown && down.sections.map((s) => `${s.row}:${s.sts}`).join() === "0:3,1:4", JSON.stringify(down.sections));
  check(results, "…an increase round makes the new stitch where its square begins", dw[1].label === "Round 2, increase round (30 → 40 sts)" && dw[1].text === "*k2 Natural white, M1 Natural white, k1 Natural white* 10 times.", JSON.stringify(dw[1]));
  turnedRound(down);
  check(results, "turned back, it is as it was", encode(down).cells === encode(yoke).cells && JSON.stringify(down.sections) === JSON.stringify(yoke.sections) && !down.topDown);

  // Every stitch accounted for on a real yoke's shaping rounds.
  const lopi = newGrid({ kind: "yoke", width: 12, height: 45, repeats: 18, shaped: true });
  check(results, "the usual shaping: three decrease rounds from the whole repeat", lopi.sections.map((s) => `${s.row + 1}:${s.sts}`).join() === "1:12,24:9,32:7,42:5", JSON.stringify(lopi.sections.map((s) => [s.row + 1, s.sts])));
  for (let x = 0; x < 12; x += 2) for (let y = 0; y < 45; y += 3) lopi.cells[y * 12 + x] = 1;
  const shaped = writeOut(lopi).filter((r) => /round \(/.test(r.label));
  const counted = shaped.map((r) => tally(r.text));
  check(results, "…each shaping round takes all the stitches below and makes the ones above", shaped.length === 3 && counted.every((c, i) => c.takes === lopi.sections[i].sts && c.makes === lopi.sections[i + 1].sts), JSON.stringify(counted));
  const lopiDown = decode(encode(lopi));
  turnedRound(lopiDown);
  const grown = writeOut(lopiDown).filter((r) => /round \(/.test(r.label)).map((r) => tally(r.text));
  check(results, "…and top-down, the increase rounds", grown.length === 3 && grown.every((c, i) => c.takes === lopiDown.sections[i].sts && c.makes === lopiDown.sections[i + 1].sts), JSON.stringify(grown));
  check(results, "a yoke's stitches in each colour count every repeat", usage(lopi).reduce((a, b) => a + b, 0) === 18 * lopi.sections.reduce((sum, s, i) => sum + s.sts * ((lopi.sections[i + 1]?.row ?? 45) - s.row), 0));

  // Shaping that does not add up is put right.
  const bad = newGrid({ kind: "yoke", width: 12, height: 20 });
  bad.sections = [{ row: 0, sts: 12, cols: [] }, { row: 8, sts: 10, cols: [0, 0] }, { row: 12, sts: 11, cols: [] }, { row: 15, sts: 6, cols: [99] }];
  normalize(bad);
  check(results, "shaping that grows the wrong way is dropped, and bad columns spread anew", bad.sections.map((s) => `${s.row}:${s.sts}:${s.cols.length}`).join() === "0:12:0,8:10:2,15:6:4", JSON.stringify(bad.sections));

  // ---------- floats ----------
  const f1 = grid("standard", ["1000000111"], { floatLimit: 5 });
  check(results, "a run of one colour longer than the limit is a long float", longFloats(f1).map((f) => f.cols.join("")).join() === "123456");
  const wrap = grid("standard", ["0001111000"], { floatLimit: 5 });
  check(results, "…in the round a run goes round the edge", longFloats(wrap).map((f) => f.cols.join(",")).join() === "7,8,9,0,1,2", JSON.stringify(longFloats(wrap)));
  check(results, "…worked flat it does not", longFloats({ ...wrap, flat: true }).length === 0);
  check(results, "…and a row of one colour has no float", longFloats(grid("standard", ["00000000"], { floatLimit: 3 })).length === 0);

  // ---------- editing ----------
  const e = grid("standard", ["0110", "0100", "0000"]);
  check(results, "a fill takes the squares joined to one, in its colour", fillArea(e, stitchMask(e), 1, 0).sort().join() === "1,2,5");
  const yokeFill = newGrid({ kind: "yoke", width: 4, height: 3 });
  yokeFill.sections = [{ row: 0, sts: 4, cols: [] }, { row: 1, sts: 2, cols: [] }];
  normalize(yokeFill);
  check(results, "…and does not reach into squares with no stitch", fillArea(yokeFill, stitchMask(yokeFill), 0, 0).length === 8, String(fillArea(yokeFill, stitchMask(yokeFill), 0, 0).length));
  const big = resized(e, { width: 6, height: 4, atLeft: true, atBottom: false });
  check(results, "a chart made bigger at the left keeps stitch 1 where it was", encode(big).cells === "000110000100000000000000", encode(big).cells);
  const small = resized(lopi, { width: 10, height: 30, atLeft: true, atBottom: false });
  check(results, "a yoke made smaller keeps shaping that fits", small.sections[0].sts === 10 && small.sections.every((s, i) => !i || s.sts < small.sections[i - 1].sts) && small.sections.every((s) => s.row < 30), JSON.stringify(small.sections));
  const sh = grid("standard", ["1000"]);
  shifted(sh, 1, 0);
  const sh2 = grid("standard", ["1000"]);
  shifted(sh2, -1, 0);
  check(results, "moving goes round the edge", encode(sh).cells === "0100" && encode(sh2).cells === "0001");
  const fl = grid("standard", ["1200", "0000"], { colours: [...newGrid({ kind: "standard", width: 1, height: 1 }).colours, { name: "Red", hex: "#aa0000" }] });
  flipped(fl, "x");
  check(results, "flipping mirrors the picture", encode(fl).cells === "00210000");
  removeColour(fl, 1);
  check(results, "removing a colour gives its squares the background, and moves the others up", encode(fl).cells === "00100000" && fl.colours.length === 2 && fl.colours[1].name === "Red");

  // ---------- the PDF's text ----------
  check(results, "PDF text is written in WinAnsi, Icelandic letters too", winAnsi("Rjúpa ð → ×").join() === [82, 106, 250, 112, 97, 32, 240, 32, 45, 62, 32, 120].join());
  const knitted = newGrid({ kind: "standard", width: 10, height: 10 });
  knitted.gauge = { sts: 20, rows: 25 };
  const sq = squareSize(knitted, { paper: "a4", squares: "knitted", words: false });
  check(results, "as knitted, a square is a stitch's size at the gauge", Math.abs(sq.cw - (5 * 72) / 25.4) < 0.01 && Math.abs(sq.ch - (4 * 72) / 25.4) < 0.01, JSON.stringify(sq));
}

/** That every cross-reference entry points at its object, as a reader looks them up. */
function xrefHolds(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes);
  const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  if (!text.startsWith("%PDF-") || !text.trimEnd().endsWith("%%EOF") || text.slice(start, start + 4) !== "xref") return false;
  const lines = text.slice(start).split("\n");
  const count = Number(lines[1].split(" ")[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(lines[2 + i].slice(0, 10));
    if (!text.startsWith(`${i} 0 obj`, offset)) return false;
  }
  return true;
}

async function pdfChecks(results: CheckResult[]): Promise<void> {
  const g = newGrid({ kind: "yoke", width: 12, height: 45, repeats: 18, shaped: true });
  for (let i = 0; i < g.cells.length; i += 5) g.cells[i] = 1;
  g.colours[0].name = "Hvítur";
  const bytes = chartPdf("Rjúpa yoke", g, { paper: "a4", squares: "fit", words: true });
  check(results, "the PDF's cross-references point at its objects", xrefHolds(bytes));
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const words = async (n: number) => ((await (await doc.getPage(n)).getTextContent()).items as { str: string }[]).map((i) => i.str).join(" ");
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push(await words(n));
  check(results, "pdf.js reads it: the chart, then the rows in words", doc.numPages >= 2 && pages[0].startsWith("Rjúpa yoke") && pages.some((t) => t.startsWith("Rjúpa yoke: in words")), pages.map((t) => t.slice(0, 40)).join(" | "));
  const all = pages.join(" ");
  check(results, "…its colours named, accents and all, with the grey squares in the legend", all.includes("Hvítur") && all.includes("No stitch"), all.slice(0, 200));
  check(results, "…and the decrease rounds in words", /Round 24, decrease round \(216 -> 162 sts\)/.test(all), all.slice(0, 300));
  const page = await doc.getPage(1);
  const [, , w, h] = page.view;
  check(results, "…on A4", Math.abs(w - 595.28) < 0.5 && Math.abs(h - 841.89) < 0.5, `${w} × ${h}`);
  await doc.destroy();

  const wide = newGrid({ kind: "standard", width: 120, height: 100 });
  const tiled = chartPdf("Blanket", wide, { paper: "letter", squares: 7, words: false });
  const tdoc = await pdfjs.getDocument({ data: tiled.slice() }).promise;
  const head = ((await (await tdoc.getPage(1)).getTextContent()).items as { str: string }[]).map((i) => i.str).join(" ");
  check(results, "a chart too big for a page goes over several, stitch 1 and row 1 first", tdoc.numPages > 6 && /Page 1 of \d+: stitches 1–\d+, rows 1–\d+/.test(head), `${tdoc.numPages}: ${head.slice(0, 160)}`);
  await tdoc.destroy();
}

export async function verifyCharts() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const w = window as unknown as { __lastExport?: { kind: string; name: string; bytes: Uint8Array }; __nextSavePath?: string | null };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const calc = () => document.querySelector<HTMLElement>(".calculators");
  const page = () => document.querySelector<HTMLElement>(".chart-page");
  const click = (root: ParentNode | null, sel: string) => (root!.querySelector(sel) as HTMLElement).click();
  const dialogCard = () => document.querySelector<HTMLElement>(".dialog-card");
  const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const stored = () => store.charts[0];
  /** The last file the save dialog was handed, read afresh each time (the stub sets it). */
  const last = () => w.__lastExport;
  /** A press and release on a square, as the pointer gives them. */
  const press = (x: number, y: number, o: { button?: number; to?: [number, number] } = {}) => {
    const canvas = page()!.querySelector<HTMLCanvasElement>(".chart-canvas")!;
    const [gx, gy, cw, ch] = canvas.dataset.grid!.split(",").map(Number);
    const height = stored().data.height;
    const r = canvas.getBoundingClientRect();
    const at = (sx: number, sy: number) => ({ clientX: r.left + gx + (sx + 0.5) * cw, clientY: r.top + gy + (height - 1 - sy + 0.5) * ch });
    const base = { bubbles: true, pointerId: 7, button: o.button ?? 0, buttons: 1 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, ...at(x, y) }));
    if (o.to) canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, ...at(...o.to) }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, ...at(...(o.to ?? [x, y])) }));
  };
  const square = (x: number, y: number) => stored().data.cells[y * stored().data.width + x];
  const saved = async () => {
    await waitFor(() => page()?.querySelector('[data-el="saved"]')?.textContent === "Saved", "the chart to save", 5000);
  };

  try {
    pure(results);
    await pdfChecks(results);
    store.charts = [];

    tab("calculators");
    await waitFor(() => !!calc(), "the calculators");
    click(calc(), '[data-calc="charts"]');
    await waitFor(() => !!calc()?.querySelector(".chart-list-head"), "the charts list");
    check(results, "Colourwork charts are listed in the Calculators tab", /No charts yet/.test(calc()!.textContent ?? ""));

    // ---------- a new round yoke ----------
    click(calc(), '[data-act="new-chart"]');
    await waitFor(() => !!document.querySelector(".chart-new-dialog"), "the new chart dialog");
    const d = dialogCard()!;
    (d.querySelector('input[value="yoke"]') as HTMLInputElement).click();
    check(results, "the yoke asks for its repeat, rounds and repeats around", !(d.querySelector('[data-for="yoke"]') as HTMLElement).hidden && (d.querySelector('[data-for="standard"]') as HTMLElement).hidden);
    set(d.querySelector('[data-f="name"]')!, "Rjúpa");
    click(d, '[data-act="make"]');
    await waitFor(() => !!page()?.querySelector(".chart-canvas[data-grid]"), "the chart page");
    check(results, "Make the chart opens it, stored with the usual shaping", store.charts.length === 1 && stored().name === "Rjúpa" && stored().data.kind === "yoke" && stored().data.sections.length === 4 && stored().data.repeats === 18, JSON.stringify(stored()?.data.sections));
    check(results, "…drawn with the shaping greyed, and the yoke from above beside it", !!page()!.querySelector("canvas.chart-preview") && /216|Rounds 1–23/.test(page()!.querySelector(".chart-side")!.textContent ?? ""), page()!.querySelector(".chart-side")!.textContent ?? "");

    // ---------- drawing ----------
    press(11, 0);
    await saved();
    check(results, "a click draws a square in the colour chosen, and saves", square(11, 0) === "1", stored().data.cells.slice(0, 12));
    click(page(), '[data-act="mirror"]');
    press(1, 2);
    await saved();
    check(results, "mirrored, the other half is drawn too", square(1, 2) === "1" && square(10, 2) === "1", stored().data.cells.slice(24, 36));
    click(page(), '[data-act="mirror"]');
    click(page(), '[data-act="undo"]');
    await saved();
    check(results, "Undo takes it back", square(1, 2) === "0" && square(10, 2) === "0" && square(11, 0) === "1");
    click(page(), '[data-act="redo"]');
    await saved();
    check(results, "…and Redo brings it again", square(1, 2) === "1");
    press(1, 2, { button: 2 });
    await saved();
    check(results, "a right-click draws in the background colour", square(1, 2) === "0");
    click(page(), '[data-tool="line"]');
    press(0, 4, { to: [5, 4] });
    await saved();
    check(results, "a line, dragged end to end", [0, 1, 2, 3, 4, 5].every((x) => square(x, 4) === "1") && square(6, 4) === "0", stored().data.cells.slice(48, 60));
    click(page(), '[data-tool="fill"]');
    press(3, 4, { button: 2 });
    await saved();
    check(results, "a fill takes the whole run it is in", [0, 1, 2, 3, 4, 5].every((x) => square(x, 4) === "0"), stored().data.cells.slice(48, 60));
    click(page(), '[data-tool="draw"]');
    click(page(), '[data-act="add-colour"]');
    check(results, "+ Colour adds the next colour and picks it", page()!.querySelectorAll(".chart-chip").length === 3 && !!page()!.querySelector('.chart-chip.on[data-colour="2"]'));

    // ---------- a block: selected, copied, pasted ----------
    const canvasEl = () => page()!.querySelector<HTMLCanvasElement>(".chart-canvas")!;
    const key = (k: string, o: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
    click(page(), '.chart-chip[data-colour="1"]');
    press(2, 8);
    press(3, 9);
    await saved();
    click(page(), '[data-tool="select"]');
    check(results, "Select: nothing selected yet, so nothing to copy", page()!.querySelector<HTMLButtonElement>('[data-act="copy"]')!.disabled);
    press(3, 9, { to: [2, 8] });
    check(results, "…dragged corner to corner, the box selected, Copy offered", canvasEl().dataset.selection === "2,8,3,9" && !page()!.querySelector<HTMLButtonElement>('[data-act="copy"]')!.disabled, canvasEl().dataset.selection);
    click(page(), '[data-act="copy"]');
    click(page(), '[data-act="paste"]');
    check(results, "Paste: the block follows the pointer, to be put down", canvasEl().dataset.pasting !== "" && !page()!.querySelector<HTMLElement>('[data-el="paste-tools"]')!.hidden);
    press(6, 12);
    await saved();
    check(results, "…a click puts it down, its top left there", square(6, 11) === "1" && square(7, 11) === "0" && square(6, 12) === "0" && square(7, 12) === "1");
    press(8, 12);
    await saved();
    check(results, "…and again, as many times as you click", square(8, 11) === "1" && square(9, 12) === "1" && canvasEl().dataset.pasting !== "");
    click(page(), '[data-act="block-flip-x"]');
    press(2, 16);
    await saved();
    check(results, "…Flip ↔ mirrors the block before it goes down", square(2, 16) === "1" && square(3, 15) === "1" && square(2, 15) === "0");
    key("Escape");
    check(results, "Esc stops pasting", canvasEl().dataset.pasting === "" && page()!.querySelector<HTMLElement>('[data-el="paste-tools"]')!.hidden);
    click(page(), '[data-act="undo"]');
    await saved();
    check(results, "Undo takes back one paste", square(2, 16) === "0" && square(3, 15) === "0" && square(8, 11) === "1");
    press(6, 11, { to: [7, 12] });
    key("x", { ctrlKey: true });
    await saved();
    check(results, "Ctrl+X cuts: the squares go to the background", square(6, 11) === "0" && square(7, 12) === "0");
    press(8, 11, { to: [9, 12] });
    key("Delete");
    await saved();
    check(results, "Delete clears the squares selected", square(8, 11) === "0" && square(9, 12) === "0");
    key("a", { ctrlKey: true });
    check(results, "Ctrl+A selects the whole chart", canvasEl().dataset.selection === `0,0,${stored().data.width - 1},${stored().data.height - 1}`, canvasEl().dataset.selection);
    key("Escape");
    check(results, "…Esc lets it go", canvasEl().dataset.selection === "");
    press(2, 8, { to: [3, 9] });
    key("Delete");
    await saved();
    click(page(), '[data-tool="draw"]');

    // ---------- in words ----------
    click(page(), '[data-side="words"]');
    const first = page()!.querySelector(".chart-words li")?.textContent ?? "";
    check(results, "In words: each round, read from the right, the repeat 18 times", first === "Round 1 (216 sts): *k1 Black sheep, k11 Natural white* 18 times.", first);
    check(results, "…the decrease rounds marked", [...page()!.querySelectorAll(".chart-words li")].some((li) => /^Round 24, decrease round \(216 → 162 sts\)/.test(li.textContent ?? "")));

    // ---------- settings ----------
    click(page(), '[data-side="chart"]');
    set(page()!.querySelector('[data-f="repeats"]')!, "20");
    await saved();
    check(results, "the repeats around are changed", stored().data.repeats === 20);
    set(page()!.querySelector('[data-f="direction"]')!, "down");
    await saved();
    check(results, "turned top-down, the chart turns upside down with its shaping", stored().data.topDown && square(0, 44) === "1" && stored().data.sections[0].sts === 5 && stored().data.sections[3].sts === 12, JSON.stringify(stored().data.sections.map((s) => [s.row, s.sts])));
    const shaping = [...page()!.querySelectorAll<HTMLElement>(".chart-shaping tbody tr")];
    check(results, "the shaping is listed to change", shaping.length === 4);
    set(page()!.querySelector('[data-f="direction"]')!, "up");
    await saved();
    set(page()!.querySelector('[data-f="gauge-sts"]')!, "18");
    set(page()!.querySelector('[data-f="gauge-rows"]')!, "24");
    await saved();
    click(page(), '[data-side="preview"]');
    check(results, "with a gauge, it says how big the yoke comes out", /round at the widest/.test(page()!.querySelector(".chart-side")!.textContent ?? ""));

    // ---------- the name ----------
    set(page()!.querySelector('[data-f="name"]')!, "Rjúpa yoke");
    await waitFor(() => stored().name === "Rjúpa yoke", "the name to save", 5000);
    check(results, "the name saves as it is typed", true);

    // ---------- export ----------
    w.__lastExport = undefined;
    w.__nextSavePath = undefined;
    click(page(), '[data-act="export"]');
    await waitFor(() => !!document.querySelector(".chart-export-dialog"), "the export dialog");
    check(results, "with a gauge, the PDF is offered at the real size", (dialogCard()!.querySelector('[data-f="squares"]') as HTMLSelectElement).value === "knitted");
    click(dialogCard(), '[data-act="save"]');
    await waitFor(() => !document.querySelector(".chart-export-dialog"), "the PDF");
    check(results, "Export saves a PDF where it is asked to", last()?.kind === "pdf" && last()!.name === "Rjúpa yoke" && xrefHolds(last()!.bytes), JSON.stringify({ kind: last()?.kind, name: last()?.name }));
    check(results, "…and says where", page()!.querySelector('[data-el="note"]')!.textContent === "Saved to C:/Charts/Rjúpa yoke.pdf", page()!.querySelector('[data-el="note"]')!.textContent ?? "");
    w.__lastExport = undefined;
    click(page(), '[data-act="export"]');
    await waitFor(() => !!document.querySelector(".chart-export-dialog"), "the export dialog");
    (dialogCard()!.querySelector('input[value="png"]') as HTMLInputElement).click();
    w.__nextSavePath = null;
    click(dialogCard(), '[data-act="save"]');
    const saveButton = () => dialogCard()!.querySelector<HTMLButtonElement>('[data-act="save"]')!;
    await waitFor(() => !!last() && !saveButton().disabled, "the cancelled save");
    check(results, "a cancelled save leaves the dialog up", !!document.querySelector(".chart-export-dialog") && last()?.kind === "png");
    w.__lastExport = undefined;
    w.__nextSavePath = undefined;
    click(dialogCard(), '[data-act="save"]');
    await waitFor(() => !document.querySelector(".chart-export-dialog"), "the PNG");
    check(results, "…or a picture", last()?.kind === "png" && last()!.bytes.length > 1000);

    // ---------- on a project's board ----------
    const live = store.projects.find((p) => p.status === "active" || p.status === "paused");
    if (live) {
      const before = store.boardItems.length;
      click(page(), '[data-act="to-board"]');
      await waitFor(() => !!document.querySelector(".chart-export-dialog"), "the board dialog");
      set(dialogCard()!.querySelector('[data-f="project"]')!, live.id);
      (dialogCard()!.querySelector('[data-f="words"]') as HTMLInputElement).checked = true;
      click(dialogCard(), '[data-act="save"]');
      await waitFor(() => store.boardItems.length === before + 2, "the board items");
      const added = store.boardItems.slice(-2);
      check(results, "Save to a project puts the picture and the rows in words on its board", added[0].kind === "image" && added[1].kind === "text" && added.every((i) => i.boardId === live.id) && /Round 1 \(240 sts\)/.test(added[1].data.text ?? ""), JSON.stringify(added.map((a) => a.kind)));
    }

    // ---------- the list again ----------
    click(page(), '[data-act="back"]');
    await waitFor(() => !!calc()?.querySelector(".chart-card"), "the chart's card");
    check(results, "back in the list, the chart has a card drawn from it", calc()!.querySelectorAll(".chart-card canvas").length === 1 && /Rjúpa yoke/.test(calc()!.querySelector(".chart-card")!.textContent ?? ""));
    click(calc(), '[data-act="copy-chart"]');
    await waitFor(() => calc()!.querySelectorAll(".chart-card").length === 2, "the copy");
    check(results, "Copy makes another to change", store.charts.some((c) => c.name === "Rjúpa yoke (copy)"));
    const copy = store.charts.find((c) => c.name === "Rjúpa yoke (copy)")!;
    click(calc(), `[data-act="remove-chart"][data-id="${copy.id}"]`);
    await waitFor(() => !!document.querySelector(".dialog-card button.danger"), "the question");
    click(document, ".dialog-card button.danger");
    await waitFor(() => calc()!.querySelectorAll(".chart-card").length === 1, "the copy to go");
    check(results, "Remove takes it away, after asking", store.charts.length === 1);

    // ---------- a standard chart, worked flat ----------
    click(calc(), '[data-act="new-chart"]');
    await waitFor(() => !!document.querySelector(".chart-new-dialog"), "the new chart dialog");
    set(dialogCard()!.querySelector('[data-f="w"]')!, "8");
    set(dialogCard()!.querySelector('[data-f="h"]')!, "6");
    set(dialogCard()!.querySelector('[data-f="flat"]')!, "flat");
    click(dialogCard(), '[data-act="make"]');
    await waitFor(() => !!page()?.querySelector(".chart-canvas[data-grid]"), "the standard chart");
    const flatChart = store.charts.find((c) => c.data.kind === "standard")!;
    check(results, "a standard chart, flat", flatChart.data.width === 8 && flatChart.data.height === 6 && !!(flatChart.data as unknown as { flat: boolean }).flat);
    check(results, "…previewed tiled", !!page()!.querySelector("canvas.chart-preview"));
    click(page(), '[data-act="remove"]');
    await waitFor(() => !!document.querySelector(".dialog-card button.danger"), "the question");
    click(document, ".dialog-card button.danger");
    await waitFor(() => !!calc()?.querySelector(".chart-list-head") && !page(), "the list");
    check(results, "Remove chart on its page goes back to the list", !store.charts.some((c) => c.id === flatChart.id) && calc()!.querySelectorAll(".chart-card").length === 1);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".dialog-card [data-act='cancel']")?.click();
    tab("calculators");
    await waitFor(() => !!calc()?.querySelector('[data-calc="raglan"]'), "the calculators", 5000).catch(() => {});
    calc()?.querySelector<HTMLElement>('[data-calc="raglan"]')?.click();
    tab("patterns");
    await waitFor(() => !calc(), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__chartChecks = verifyCharts;
