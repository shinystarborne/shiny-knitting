/**
 * Checks for gauge swatches: the Stash tab's Swatches, the swatch form, a
 * yarn's swatches, and gauges in centimetres or inches.
 *
 * Run with the harness open, after the other suites (it reads whatever yarn
 * and needles they left):
 *   window.__swatchChecks()
 */
import type { Swatch } from "../src/api";
import { blockingChange, blockingText, gaugeOf, gaugeText, needleText, readGauge, showGauge, swatchLine } from "../src/views/measure";

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

type Store = {
  swatches: (Swatch & { yarnText: string })[];
  yarns: { id: string; name: string; brand: string; colourway: string }[];
  tools: { id: string; kind: string; sizeMm: number }[];
  covers: Map<string, unknown>;
  measureUnit?: string;
};

function pure(results: CheckResult[]): void {
  check(results, "a gauge shows to a tenth", showGauge(22, "cm") === "22" && showGauge(22.5, "cm") === "22.5" && showGauge(0, "cm") === "");
  check(results, "over 4 in, the count is a little more", showGauge(22, "in") === "22.4" && showGauge(30, "in") === "30.5", showGauge(22, "in"));
  check(results, "a typed count is read per 10 cm", readGauge("22,5", "cm") === 22.5 && Math.abs(readGauge("22", "in") - 21.6535) < 0.001, String(readGauge("22", "in")));
  check(results, "empty is 0, words are not a count", readGauge("", "cm") === 0 && Number.isNaN(readGauge("lots", "cm")) && Number.isNaN(readGauge("22 sts", "cm")));
  const s = { sts: 32, rows: 44, stsBlocked: 30, rowsBlocked: 42, needleMm: 2.5 } as Swatch;
  check(results, "the blocked gauge is the one a swatch is known by", gaugeOf(s).sts === 30 && gaugeOf(s).blocked);
  check(results, "…else the unblocked", gaugeOf({ ...s, stsBlocked: 0, rowsBlocked: 0 }).sts === 32 && !gaugeOf({ ...s, stsBlocked: 0, rowsBlocked: 0 }).blocked);
  check(results, "a swatch in one line", swatchLine(s, "cm") === "30 sts × 42 rows on 2.5 mm", swatchLine(s, "cm"));
  check(results, "…as much as was counted", gaugeText({ ...s, stsBlocked: 0, rowsBlocked: 0, rows: 0 }, "cm") === "32 sts" && needleText(3.75) === "3.75 mm" && needleText(0) === "");
  check(results, "blocking that relaxed the fabric made it wider and longer", blockingText(s) === "7% wider, 5% longer", blockingText(s));
  check(results, "…and one that drew it in, narrower", blockingText({ sts: 20, rows: 30, stsBlocked: 22, rowsBlocked: 30 }) === "9% narrower, same length", blockingText({ sts: 20, rows: 30, stsBlocked: 22, rowsBlocked: 30 }));
  check(results, "…and nothing without both counts", blockingText({ sts: 0, rows: 0, stsBlocked: 22, rowsBlocked: 30 }) === "" && blockingChange({ sts: 22, rows: 0, stsBlocked: 20, rowsBlocked: 30 }).long === null);
  check(results, "…or that it was not", swatchLine({ ...s, sts: 0, rows: 0, stsBlocked: 0, rowsBlocked: 0, needleMm: 0 }, "cm") === "Not counted yet");
}

export async function verifySwatches() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const cards = () => [...document.querySelectorAll<HTMLElement>(".swatches .swatch-card")];
  const card = (id: string) => document.querySelector<HTMLElement>(`.swatches .swatch-card[data-open="${id}"]`);
  const modal = (cls: string) => document.querySelector<HTMLElement>(`.modal-backdrop:not(.hidden) .${cls}`);
  const field = (f: string) => modal("swatch-form")?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`) ?? null;
  const set = (f: string, v: string) => {
    const el = field(f)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const act = (cls: string, name: string) => (modal(cls)!.querySelector(`[data-act="${name}"]`) as HTMLElement).click();
  const shown = (el: Element | null) => !!el && !(el as HTMLElement).hidden && !(el.closest("[hidden]"));
  const mode = async (to: "yarn" | "swatches") => {
    (document.querySelector(`[data-act="stash-mode"][data-mode="${to}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector(to === "swatches" ? ".swatches .swatch-grid" : ".stash .results"), `the ${to}`);
  };
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");

  try {
    pure(results);
    const yarn = store.yarns[0];
    const tool = store.tools.find((t) => t.kind !== "cable" && t.sizeMm > 0)!;

    // ---------- the Swatches view ----------
    tab("stash");
    await waitFor(() => !!document.querySelector(".stash .results"), "the stash");
    check(results, "the stash opens on its yarn, with a switch to its swatches", !!document.querySelector('.stash .seg button.on[data-mode="yarn"]'));
    await mode("swatches");
    await waitFor(() => cards().length === store.swatches.length, "the swatch cards");
    check(results, "every swatch is there, the newest first", cards().map((c) => c.dataset.open).join(",") === "sw2,sw1,sw3", cards().map((c) => c.dataset.open).join(","));
    const sw1 = card("sw1")!;
    check(results, "a card shows the gauge it is known by, and says blocked", sw1.querySelector(".swatch-gauge b")?.textContent === "30 × 42" && /Blocked/.test(sw1.textContent ?? ""), sw1.querySelector(".swatch-gauge b")?.textContent ?? "");
    check(results, "…and over what", /sts × rows \/ 10 cm/.test(sw1.textContent ?? ""));
    check(results, "…the needle and stitch pattern", sw1.querySelector(".swatch-needle")?.textContent === "on 2.5 mm · Stockinette");
    check(results, "a swatch in yarn not in the stash names it as typed", card("sw3")!.querySelector(".swatch-yarn")?.textContent === "Friend's merino" && /Not blocked yet/.test(card("sw3")!.textContent ?? "") && !card("sw3")!.querySelector(".swatch-before"));
    check(results, "a blocked card says what it was before, and what blocking did", sw1.querySelector(".swatch-before")?.textContent === "Before: 32 × 44 · 7% wider, 5% longer", sw1.querySelector(".swatch-before")?.textContent ?? "(none)");
    const search = document.querySelector<HTMLInputElement>(".swatches .search")!;
    search.value = "garter";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "the search finds a stitch pattern", cards().map((c) => c.dataset.open).join(",") === "sw2");
    search.value = "4 mm";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…and a needle size", cards().map((c) => c.dataset.open).join(",") === "sw3", cards().map((c) => c.dataset.open).join(","));
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    // ---------- a swatch in yarn not in the stash ----------
    (document.querySelector('.swatches [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("swatch-form"), "the swatch form");
    check(results, "a new swatch starts in yarn not in the stash, on a size only", field("yarn")?.value === "" && shown(field("yarnText")) && shown(field("needleMm")));
    check(results, "the gauge is asked for over 10 cm", /over 10 cm/.test(modal("swatch-form")!.textContent ?? ""));
    set("yarnText", "  Cork board   mystery ");
    set("needleMm", "4,5");
    set("stitch", "Seed");
    set("sts", "lots");
    act("swatch-form", "save");
    await waitFor(() => !modal("swatch-form")!.querySelector<HTMLElement>('[data-el="error"]')!.hidden, "the count error");
    check(results, "a count that is not a number is refused, saying how", /not a number of stitches/.test(modal("swatch-form")!.textContent ?? ""));
    set("sts", "21");
    set("rows", "29,5");
    set("stsBlocked", "20");
    set("rowsBlocked", "28");
    const blocking = modal("swatch-form")!.querySelector<HTMLElement>('[data-el="blocking"]')!;
    check(results, "the form says what blocking did, as the counts are typed", !blocking.hidden && blocking.textContent === "Blocking made it 5% wider and 5% longer.", blocking.textContent ?? "");
    check(results, "after blocking comes first, before blocking is optional", /After blocking[\s\S]*Before blocking[\s\S]*optional/.test(modal("swatch-form")!.querySelector(".gauge-table")!.textContent ?? ""));
    // A photo dropped on the box.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 40;
    canvas.getContext("2d")!.fillRect(0, 0, 40, 40);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "swatch.png", { type: "image/png" }));
    modal("swatch-form")!.querySelector('[data-el="photobox"]')!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await waitFor(() => !!modal("swatch-form")?.querySelector('[data-el="photobox"].filled'), "the dropped photo");
    const count = store.swatches.length;
    act("swatch-form", "save");
    await waitFor(() => !modal("swatch-form") && store.swatches.length === count + 1, "the save");
    const added = store.swatches[store.swatches.length - 1];
    check(results, "it is stored tidied, per 10 cm, with its photo",
      added.yarnText === "Cork board mystery" && added.needleMm === 4.5 && added.sts === 21 && added.rows === 29.5 && added.stsBlocked === 20 && added.rowsBlocked === 28 && added.stitch === "Seed" && store.covers.has(`swatch:${added.id}`),
      JSON.stringify(added));
    await waitFor(() => !!card(added.id)?.querySelector(".swatch-photo.filled"), "its card's photo");
    check(results, "its card shows the photo, first", cards()[0]?.dataset.open === added.id);

    // ---------- a swatch in stash yarn, on a needle from the box ----------
    (document.querySelector('.swatches [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("swatch-form"), "the swatch form");
    set("yarn", yarn.id);
    check(results, "a stash yarn needs no typing, and shows what it is", !shown(field("yarnText")) && shown(modal("swatch-form")!.querySelector('[data-el="yarn-info"]')));
    set("tool", tool.id);
    check(results, "a needle from the box needs no size", !shown(field("needleMm")));
    set("sts", "24");
    set("rows", "32");
    const count2 = store.swatches.length;
    act("swatch-form", "save-another");
    await waitFor(() => store.swatches.length === count2 + 1 && !modal("swatch-form")!.querySelector<HTMLElement>('[data-el="saved"]')!.hidden, "save and add another");
    const inYarn = store.swatches[store.swatches.length - 1];
    check(results, "it is linked to the yarn and needle, at the needle's size", inYarn.yarnId === yarn.id && inYarn.toolId === tool.id && inYarn.needleMm === tool.sizeMm && inYarn.yarnText === "", JSON.stringify(inYarn));
    check(results, "Save and add another keeps the yarn and needle, and clears the counts", field("yarn")?.value === yarn.id && field("tool")?.value === tool.id && field("sts")?.value === "");
    act("swatch-form", "cancel");
    await waitFor(() => !modal("swatch-form"), "the form to close");

    // From the swatch through to its yarn, and back to a new swatch in it.
    await waitFor(() => !!card(inYarn.id), "its card");
    (card(inYarn.id)!.querySelector(".swatch-gauge") as HTMLElement).click();
    await waitFor(() => !!modal("swatch-form"), "the swatch");
    check(results, "a swatch opens with what it was counted at", field("sts")?.value === "24" && field("rows")?.value === "32");
    act("swatch-form", "open-yarn");
    await waitFor(() => !!modal("yarn-form")?.querySelector('[data-act="open-swatch"]'), "the yarn, with its swatches");
    const listed = [...modal("yarn-form")!.querySelectorAll<HTMLElement>('[data-act="open-swatch"]')].map((b) => b.dataset.id);
    check(results, "the yarn lists its swatches", listed.includes(inYarn.id), listed.join(","));
    act("yarn-form", "add-swatch");
    await waitFor(() => !!modal("swatch-form"), "a new swatch from the yarn");
    check(results, "+ Add a swatch on a yarn starts in that yarn", field("yarn")?.value === yarn.id && !field("sts")?.value);
    act("swatch-form", "cancel");
    await waitFor(() => !modal("swatch-form"), "the form to close");

    // ---------- on the yarn's card ----------
    await mode("yarn");
    const yarnCard = () => document.querySelector<HTMLElement>(`.stash .card[data-open="${yarn.id}"]`);
    await waitFor(() => !!yarnCard(), "the yarn's card");
    const newest = store.swatches.filter((s) => s.yarnId === yarn.id).sort((a, b) => b.madeAt - a.madeAt || b.addedAt - a.addedAt)[0];
    check(results, "a yarn's card says it was swatched, by its newest swatch", yarnCard()!.querySelector(".card-swatched")?.textContent === `Swatched: ${swatchLine(newest, "cm")}`, yarnCard()!.querySelector(".card-swatched")?.textContent ?? "(none)");

    // ---------- inches ----------
    store.measureUnit = "in";
    await mode("swatches");
    await waitFor(() => !!card("sw3"), "the swatches in inches");
    check(results, "with inches chosen, a gauge is over 4 in", card("sw3")!.querySelector(".swatch-gauge b")?.textContent === "22.4 × 30.5" && /\/ 4 in/.test(card("sw3")!.textContent ?? ""), card("sw3")!.querySelector(".swatch-gauge b")?.textContent ?? "");
    (card("sw3")!.querySelector(".swatch-gauge") as HTMLElement).click();
    await waitFor(() => !!modal("swatch-form"), "the swatch in inches");
    set("sts", "22");
    act("swatch-form", "save");
    await waitFor(() => !modal("swatch-form"), "the save in inches");
    check(results, "…and a count typed over 4 in is kept per 10 cm", store.swatches.find((s) => s.id === "sw3")?.sts === 21.7, String(store.swatches.find((s) => s.id === "sw3")?.sts));
    store.measureUnit = "cm";

    // ---------- removing ----------
    await mode("yarn");
    await mode("swatches");
    await waitFor(() => !!card("sw3"), "the swatches again");
    (card("sw3")!.querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the confirm");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => !card("sw3"), "the removal");
    check(results, "a swatch can be removed", !store.swatches.some((s) => s.id === "sw3"));
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    const label = `${[yarn.brand, yarn.name].filter(Boolean).join(" ")}${yarn.colourway ? `, ${yarn.colourway}` : ""}`;
    await invoke("delete_yarn", { id: yarn.id });
    const kept = ((await invoke("list_swatches", {})) as Swatch[]).find((s) => s.id === inYarn.id);
    check(results, "removing a yarn keeps its swatches, and what they were knitted in", !!kept && kept.yarnId === null && kept.yarnName === label, JSON.stringify(kept));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.measureUnit = "cm";
    document.querySelector<HTMLElement>(".dialog-card button.ghost")?.click();
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"]')?.click();
    document.querySelector<HTMLElement>('[data-act="stash-mode"][data-mode="yarn"]')?.click();
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.swatches)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__swatchChecks = verifySwatches;
