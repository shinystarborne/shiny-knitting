/**
 * Checks for lace charts: a chart of stitches, each square drawn in its
 * symbol; its rows in words as they are worked from each side, no stitch
 * left out; each row checked against the stitches the one before left; and
 * the editor: a lace chart made, a stitch drawn and said when pointed at,
 * the rows that do not add up pointed out, a stitch changed for another.
 *
 * Run with the harness open:
 *   window.__laceChecks()
 */
import type { Chart } from "../src/api";
import { decode, encode, laceColour, laceMismatches, laceRows, newGrid, nextColour, writeOut, writtenText, type Grid } from "../src/views/chart";
import { LACE_START, STITCHES, symbolSvg } from "../src/views/stitches";

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

/** A lace chart, its rows (the first at the bottom) as stitch keys, left to right. */
function chart(rows: string[][], flat: boolean): Grid {
  const keys = [...new Set(["knit", ...rows.flat()])];
  const g = newGrid({ kind: "lace", width: rows[0].length, height: rows.length, flat });
  g.colours = keys.map(laceColour);
  rows.forEach((row, y) => row.forEach((k, x) => (g.cells[y * g.width + x] = keys.indexOf(k))));
  return g;
}

function pure(results: CheckResult[]): void {
  const fresh = newGrid({ kind: "lace", width: 10, height: 8, flat: true });
  check(results, "a new lace chart: its stitches the usual ones, every square knit", JSON.stringify(fresh.colours.map((c) => c.stitch)) === JSON.stringify(LACE_START) && fresh.cells.every((c) => c === 0) && fresh.colours[0].hex === "#ffffff");
  check(results, "…another stitch offered is one not in it yet", nextColour(fresh).stitch === "cdd");
  check(results, "every stitch has a symbol, knit and no stitch blank", STITCHES.every((s) => symbolSvg(s.key).startsWith("<svg")) && STITCHES.filter((s) => !/<(line|polygon)/.test(symbolSvg(s.key))).map((s) => s.key).join() === "knit,none");

  const k = "knit";
  const flat = chart(
    [
      [k, "yo", "k2tog", k, "ssk", "yo", k],
      [k, k, k, k, k, k, k],
      ["purl", "k2tog", "yo", k, "yo", "ssk", "purl"],
      [k, "k2tog", "purl", k, "none", "purl", k],
    ],
    true,
  );
  const words = writeOut(flat);
  check(results, "a right-side row read from the right, each stitch as written", words[0].label === "Row 1 (RS, 7 sts)" && words[0].text === "k1, yo, ssk, k1, k2tog, yo, k1.", JSON.stringify(words[0]));
  check(results, "…a wrong-side row from the left, purled", words[1].label === "Row 2 (WS)" && words[1].text === "p7.", JSON.stringify(words[1]));
  check(results, "…its decreases and purls worked from that side, no stitch left out", words[3].text === "p1, p2tog, k1, p1, k1, p1." && /6 sts/.test(words[3].label), JSON.stringify(words[3]));
  check(results, "every row adds up: none pointed out", laceMismatches(flat).length === 0 && JSON.stringify(laceRows(flat).map((r) => [r.takes, r.makes])) === "[[7,7],[7,7],[7,7],[7,6]]", JSON.stringify(laceRows(flat)));

  const off = chart(
    [
      [k, k, k, k, k],
      [k, "yo", k, "yo", "yo"],
    ],
    false,
  );
  check(results, "a round with a yarn over too many, its stitches said", laceMismatches(off).length === 1 && laceMismatches(off)[0].takes === 2 && laceMismatches(off)[0].had === 5, JSON.stringify(laceMismatches(off)));
  check(results, "…in the round every round from the right, alike ones said so many times", writeOut(off)[1].text === "(yo) 2 times, k1, yo, k1." && writeOut(off)[1].label === "Round 2", JSON.stringify(writeOut(off)[1]));
  const text = writtenText("Leaf", flat);
  check(results, "in words, its stitches listed with what each is worked as on a WS row", /Stitches: k: knit \(on a WS row, p\); yo: yarn over; k2tog: knit 2 together \(on a WS row, p2tog\)/.test(text) && !/Colours:/.test(text), text.split("\n")[3]);
  check(results, "kept and read back as it was", encode(decode(encode(flat))).cells === encode(flat).cells && decode(encode(flat)).colours[2].stitch === "k2tog");
}

export async function verifyLace() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { charts: Chart[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const calc = () => document.querySelector<HTMLElement>(".calculators");
  const page = () => document.querySelector<HTMLElement>(".chart-page");
  const stored = () => store.charts.find((c) => c.name === "Leaf edging")!;
  const before = [...store.charts];
  const press = (x: number, y: number) => {
    const canvas = page()!.querySelector<HTMLCanvasElement>(".chart-canvas")!;
    const [gx, gy, cw, ch] = canvas.dataset.grid!.split(",").map(Number);
    const height = stored().data.height;
    const r = canvas.getBoundingClientRect();
    const at = { clientX: r.left + gx + (x + 0.5) * cw, clientY: r.top + gy + (height - 1 - y + 0.5) * ch };
    const base = { bubbles: true, pointerId: 7, button: 0, buttons: 1, ...at };
    canvas.dispatchEvent(new PointerEvent("pointerdown", base));
    canvas.dispatchEvent(new PointerEvent("pointerup", base));
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 0 }));
  };
  const saved = () => waitFor(() => page()?.querySelector('[data-el="saved"]')?.textContent === "Saved", "the chart to save", 5000);
  try {
    pure(results);

    tab("calculators");
    await waitFor(() => !!calc(), "the calculators");
    (calc()!.querySelector('[data-calc="charts"]') as HTMLElement).click();
    await waitFor(() => !!calc()?.querySelector('[data-act="new-chart"]'), "the charts");
    (calc()!.querySelector('[data-act="new-chart"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".chart-new-dialog"), "the new chart dialog");
    const d = document.querySelector<HTMLElement>(".chart-new-dialog")!;
    d.querySelector<HTMLInputElement>('input[value="lace"]')!.click();
    d.querySelector<HTMLInputElement>('input[value="lace"]')!.dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "New chart offers Lace, sized as a standard one", !d.querySelector<HTMLElement>('[data-for="standard lace"]')!.hidden && d.querySelector<HTMLElement>('[data-for="yoke"]')!.hidden);
    d.querySelector<HTMLInputElement>('[data-f="name"]')!.value = "Leaf edging";
    d.querySelector<HTMLInputElement>('[data-f="w"]')!.value = "12";
    d.querySelector<HTMLInputElement>('[data-f="h"]')!.value = "8";
    d.querySelector<HTMLSelectElement>('[data-f="flat"]')!.value = "flat";
    (d.querySelector('[data-act="make"]') as HTMLElement).click();
    await waitFor(() => !!page()?.querySelector(".stitch-chip"), "the lace chart");
    const chips = () => [...page()!.querySelectorAll<HTMLElement>(".stitch-chip")];
    check(results, "its stitches to draw with, each its symbol and abbreviation", chips().length === 7 && chips().every((c) => !!c.querySelector("svg.stitch-symbol")) && chips().map((c) => c.textContent!.trim()).join(",") === "k,p,yo,k2tog,ssk,sk2p,no stitch" && stored().data.kind === "lace", chips().map((c) => c.textContent!.trim()).join(","));
    check(results, "…its side panel its stitches, not a picture knitted up", page()!.querySelector('[data-side="preview"]')!.textContent === "Stitches" && !page()!.querySelector(".chart-palette [data-act='photo-colours']"));

    // A yarn over on the second row, with no decrease for it.
    chips()[2].click();
    press(5, 1);
    await saved();
    const status = page()!.querySelector('[data-el="status"]')!.textContent ?? "";
    check(results, "drawn, the square is a yarn over, and pointing at it says so", stored().data.cells[1 * 12 + 5] === "2" && /yo, yarn over/.test(status), status);
    (page()!.querySelector('[data-side="preview"]') as HTMLElement).click();
    await waitFor(() => !!page()!.querySelector(".lace-rows"), "the stitches");
    const said = page()!.querySelector('[data-el="side"]')!.textContent!.replace(/\s+/g, " ");
    check(results, "…its row pointed out: it works fewer stitches than the row before left", /Row 2 works 11 stitches, but row 1 left 12: a yarn over too many, or a decrease missing/.test(said) && !!page()!.querySelector(".lace-rows tr.off"), said.slice(0, 160));
    (page()!.querySelector('[data-side="words"]') as HTMLElement).click();
    await waitFor(() => !!page()!.querySelector(".chart-words li"), "the words");
    const row2 = [...page()!.querySelectorAll(".chart-words li")][1].textContent ?? "";
    check(results, "in words: the wrong-side row purled, the yarn over in its place from the left", /Row 2 \(WS\): p5, yo, p6\./.test(row2), row2);

    // The yarn over changed for a make 1 left: its squares with it.
    chips()[2].click();
    const select = page()!.querySelector<HTMLSelectElement>('[data-f="stitch"]')!;
    check(results, "a stitch is changed from a list of those not in the chart yet", [...select.options].every((o) => o.value === "yo" || !["knit", "purl", "k2tog", "ssk", "sk2p", "none"].includes(o.value)));
    select.value = "m1l";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await saved();
    check(results, "…changed, its squares are that stitch", stored().data.colours[2].stitch === "m1l" && stored().data.colours[2].name === "m1l" && stored().data.cells[1 * 12 + 5] === "2");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.charts = before;
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__laceChecks = verifyLace;
