/**
 * Checks for the size knitted, marked in a pattern: runs of the sizes'
 * numbers found in text ("100 (110, 120)", dashes, decimals, halves, over a
 * line break) and look-alikes left alone; the sizes' names read after
 * "Sizes"; and the reader: the Size picker offering them, the chosen size's
 * numbers marked and the others dimmed (not hidden), kept with the pattern
 * and put back when it is opened again.
 *
 * Run with the harness open:
 *   window.__sizeChecks()
 */
import type { Pattern } from "../src/api";
import { sizeLabel, sizeNames, sizeRuns, sizesOf } from "../src/reader/sizes";

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

function pure(results: CheckResult[]): void {
  const said = (text: string) => sizeRuns(text).map((run) => run.map((i) => text.slice(i.start, i.end)).join("|"));
  check(results, "a run of sizes: the first number, the others in brackets", JSON.stringify(said("cast on 100 (110, 120, 130) sts.")) === JSON.stringify(["100|110|120|130"]), JSON.stringify(said("cast on 100 (110, 120, 130) sts.")));
  check(results, "…a dash for a size with none, decimals either way, halves", JSON.stringify([...said("work 2 (-, 3, 4) times"), ...said("knit 1,5 (2, 2,5) cm"), ...said("knit 2.5 (3; 3.5) cm"), ...said("1½ (2, 2½) in")]) === JSON.stringify(["2|-|3|4", "1,5|2|2,5", "2.5|3|3.5", "1½|2|2½"]));
  check(results, "…several on a line", said("chest 86 (96, 106) cm, length 50 (52, 54) cm").length === 2);
  check(results, "a stitch pattern in brackets, or numbers run together, are no sizes", said("rib (k2, p2) to end").length === 0 && said("cast on 100,110,120 sts").length === 0 && said("row 12a (14b)").length === 0);

  check(results, "the sizes' names, after Sizes", JSON.stringify(sizeNames("sizes: xs (s, m, l, xl) to fit chest")) === JSON.stringify(["XS", "S", "M", "L", "XL"]), JSON.stringify(sizeNames("sizes: xs (s, m, l, xl) to fit chest")));
  check(results, "…numbers, and 2XL", JSON.stringify(sizeNames("size 1 (2, 3)")) === JSON.stringify(["1", "2", "3"]) && JSON.stringify(sizeNames("finished sizes: s (m, l, 2xl)")) === JSON.stringify(["S", "M", "L", "2XL"]));
  check(results, "…and none when it names none", sizeNames("a lovely shawl in one size") === null);

  const unnamed = ["cast on 100 (110, 120, 130).", "work 2 (2, 3, 3) times; see page 4 (12).", "decrease 6 (6, 8, 8) times."];
  check(results, "unnamed, the sizes are the commonest run's length, met three times", sizesOf(unnamed).count === 4 && sizesOf(unnamed).names === null);
  check(results, "…a run or two is not enough to call them sizes", sizesOf(["cast on 100 (110)"]).count === 0);
  check(results, "named, the names count them", sizesOf(["sizes: s (m, l)", ...unnamed]).count === 3);
  check(results, "a size is said by its name, or its place", sizeLabel(0, ["XS"]) === "XS" && sizeLabel(1, null) === "2nd size" && sizeLabel(2, null) === "3rd size" && sizeLabel(10, null) === "11th size" && sizeLabel(21, null) === "22nd size");
}

export async function verifySizes() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { patterns: Pattern[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const pick = () => document.querySelector<HTMLSelectElement>(".reader [data-size-pick]");
  const mine = () => [...document.querySelectorAll<HTMLElement>(".reader .size-mine")];
  const dim = () => [...document.querySelectorAll<HTMLElement>(".reader .size-dim")];
  const sized = { ...store.patterns[0], id: "p-sized", title: "Sunday Cardigan", fileName: "sized-pattern.pdf", filePath: "library/originals/p-sized.pdf", format: "pdf", sizeIndex: null } as Pattern;
  store.patterns.push(sized);
  const open = async () => {
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: sized.id }));
    await waitFor(() => !!pick() && !pick()!.hidden, "the Size picker");
  };

  try {
    pure(results);

    await open();
    const options = [...pick()!.options].map((o) => o.textContent).join(" | ");
    check(results, "the reader offers the pattern's sizes by name, all of them shown to start", options === "Size: all | Size: XS | Size: S | Size: M | Size: L | Size: XL" && pick()!.value === "", options);
    check(results, "…and with none chosen, nothing is marked or dimmed", mine().length === 0 && dim().length === 0);

    pick()!.value = "2";
    pick()!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => mine().length >= 4, "the size marked");
    // Page 1 has three runs of five (chest, cast-on, repeats), page 2 two (one broken over two lines).
    await waitFor(() => mine().length >= 5, "both pages marked", 5000).catch(() => {});
    check(results, "M chosen: its number marked in every run of five", mine().length >= 5, `${mine().length} marked`);
    check(results, "…the other sizes' dimmed, four for each mark, and not hidden", dim().length >= 4 * mine().length - 1 && dim().every((d) => getComputedStyle(d).opacity !== "0" && getComputedStyle(d).backgroundColor !== "rgb(255, 255, 255)"), `${dim().length} dimmed`);
    check(results, "…a stitch pattern and a page reference left alone", mine().length <= 6, `${mine().length}`);
    check(results, "the size is kept with the pattern", store.patterns.find((p) => p.id === sized.id)?.sizeIndex === 2);

    // Opened again, it is still M.
    tab("patterns");
    await waitFor(() => !document.querySelector(".reader"), "the library again");
    await open();
    await waitFor(() => mine().length >= 3, "marked again");
    check(results, "opened again, the size chosen is chosen and marked", pick()!.value === "2" && mine().length >= 3);

    pick()!.value = "";
    pick()!.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => mine().length === 0 && dim().length === 0, "cleared");
    check(results, "Size: all marks nothing again, and forgets the size", store.patterns.find((p) => p.id === sized.id)?.sizeIndex === null);

    // A pattern with no sizes in its text offers none.
    tab("patterns");
    await waitFor(() => !document.querySelector(".reader"), "the library again");
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: store.patterns.find((p) => p.fileName === "long-pattern.pdf")!.id }));
    await waitFor(() => !!pick(), "the long pattern");
    await wait(1200);
    check(results, "a pattern whose text gives no sizes shows no Size picker", pick()!.hidden);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.patterns = store.patterns.filter((p) => p.id !== sized.id);
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__sizeChecks = verifySizes;
