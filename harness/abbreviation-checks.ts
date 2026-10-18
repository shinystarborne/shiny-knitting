/**
 * Checks for abbreviations: found in a line of pattern text as words of their
 * own, the longest first; yours in place of a known one; a masterclass video
 * found by its title; the glossary in Cheatsheets, looked up and added to;
 * and one in a PDF's text explained when the pointer rests on it.
 *
 * Run with the harness open:
 *   window.__abbreviationChecks()
 */
import type { Abbreviation, Masterclass } from "../src/api";
import { KNOWN, findAbbreviations, glossary, videoFor } from "../src/views/abbreviations";

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
  const all = glossary([]);
  const said = (text: string) => findAbbreviations(text, all).map((f) => f.text);
  check(results, "a line's abbreviations found, the longest first: slip1-k2tog-psso whole", JSON.stringify(said("Rows 1 and 7: k1, yo, k5, slip1-k2tog-psso.")) === '["k1","yo","k5","slip1-k2tog-psso"]', JSON.stringify(said("Rows 1 and 7: k1, yo, k5, slip1-k2tog-psso.")));
  check(results, "…only as words of their own: not k in knit, nor st in first", said("knit the first stitch").length === 0, JSON.stringify(said("knit the first stitch")));
  check(results, "…ones with a space, and w&t", JSON.stringify(said("Work in St st to the marker, sl1 wyif, w&t.")) === '["St st","sl1 wyif","w&t"]', JSON.stringify(said("Work in St st to the marker, sl1 wyif, w&t.")));
  const k = findAbbreviations("k3, p12, C6F", all);
  check(results, "…and counted ones said with their count: k3, p12, a C6F cable", k.length === 3 && k[0].entry.meaning === "Knit 3." && k[1].entry.meaning === "Purl 12." && /slip 3 to a cable needle held in front/.test(k[2].entry.meaning), JSON.stringify(k.map((f) => f.entry.meaning)));
  check(results, "the glossary knows the common ones", ["ssk", "k2tog", "m1l", "m1r", "w&t", "sl1 wyif", "kfb", "psso"].every((t) => KNOWN.some((x) => x.term === t)));

  const own: Abbreviation[] = [
    { id: "a1", term: "SSK", meaning: "As this designer does it: slip, slip, knit through the back loops.", addedAt: 0 },
    { id: "a2", term: "MB5", meaning: "Make a 5-stitch bobble.", addedAt: 0 },
  ];
  const mine = glossary(own);
  const ssk = findAbbreviations("ssk, k1", mine)[0];
  check(results, "one of yours with a known one's letters is shown in its place", ssk.entry.own?.id === "a1" && /this designer/.test(ssk.entry.meaning) && mine.filter((e) => e.term.toLowerCase() === "ssk").length === 1);
  check(results, "…and one of your own is found in a pattern too", findAbbreviations("MB5 in the next st", mine)[0]?.entry.own?.id === "a2");

  const mc = (id: string, title: string, parts: string[]) =>
    ({ id, title, notes: "", channel: "", patternId: "", patternTitle: "", projectCount: 0, addedAt: 0, parts: parts.map((t, i) => ({ id: `${id}-${i}`, masterclassId: id, position: i, title: t, url: `https://youtu.be/${id}${i}`, videoId: "", channel: "", hasThumb: false, watched: false, addedAt: 0 })) }) as Masterclass;
  const classes = [mc("m1", "Decreases", ["Knit two together", "How to SSK, neatly"]), mc("m2", "Short rows", ["German short rows", "Wrap and turn"]), mc("m3", "Repairs", ["Rep a dropped stitch"])];
  const entry = (t: string) => mine.find((e) => e.term.toLowerCase() === t)!;
  check(results, "a masterclass video found for one: SSK by its letters, k2tog and w&t by their names", videoFor(entry("ssk"), classes)?.part.title === "How to SSK, neatly" && videoFor(entry("k2tog"), classes)?.part.title === "Knit two together" && videoFor(entry("w&t"), classes)?.part.title === "Wrap and turn", JSON.stringify([videoFor(entry("ssk"), classes)?.part.title, videoFor(entry("w&t"), classes)?.part.title]));
  check(results, "…but none for plain words like rep, nor where none covers it", !videoFor(entry("rep"), classes) && !videoFor(entry("m1l"), classes));
}

export async function verifyAbbreviations() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { abbreviations: Abbreviation[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const panel = () => document.querySelector<HTMLElement>(".cheatsheets .abbr-panel");
  const rows = () => [...(panel()?.querySelectorAll<HTMLElement>(".abbr-row") ?? [])];
  const row = (term: string) => rows().find((r) => r.dataset.term === term);
  const tip = () => document.querySelector<HTMLElement>(".abbr-tip:not([hidden])");
  const before = [...store.abbreviations];
  try {
    pure(results);

    // ---------- the glossary, in Cheatsheets ----------
    tab("cheatsheets");
    await waitFor(() => !!document.querySelector('.cheatsheets [data-sheet="abbreviations"]'), "the cheatsheets");
    check(results, "Cheatsheets lists Abbreviations first", document.querySelector(".cheatsheets .sheet-item")?.getAttribute("data-sheet") === "abbreviations");
    (document.querySelector('.cheatsheets [data-sheet="abbreviations"]') as HTMLElement).click();
    await waitFor(() => rows().length > 40, "the glossary");
    check(results, "…open, it lists them with what they mean", /Slip, slip, knit/.test(row("ssk")?.textContent ?? ""), row("ssk")?.textContent ?? "none");
    const search = panel()!.querySelector<HTMLInputElement>('[data-f="abbr-search"]')!;
    search.value = "wrap";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…looked up by typing, by letters or by meaning", rows().length >= 1 && rows().length < 5 && !!row("w&t"), rows().map((r) => r.dataset.term).join(","));
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const field = (f: string) => panel()!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
    field("abbr-term").value = "CDD2";
    field("abbr-meaning").value = "Centred double decrease, the designer's way.";
    panel()!.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await waitFor(() => !!row("CDD2"), "your own added");
    check(results, "one of your own is added, marked yours, and kept", /Yours/.test(row("CDD2")!.textContent ?? "") && store.abbreviations.some((a) => a.term === "CDD2"));
    (row("CDD2")!.querySelector('[data-act="abbr-edit"]') as HTMLElement).click();
    check(results, "…Change puts it back in the form", field("abbr-term").value === "CDD2" && /Save/.test(panel()!.querySelector('[data-el="abbr-save"]')!.textContent ?? ""));
    field("abbr-meaning").value = "Slip 2 together, k1, pass both over.";
    panel()!.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await waitFor(() => /pass both over/.test(row("CDD2")?.textContent ?? ""), "the change");
    check(results, "…and changed, it is that one, not a second", store.abbreviations.filter((a) => a.term === "CDD2").length === 1);
    (row("CDD2")!.querySelector('[data-act="abbr-remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the question");
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => !row("CDD2"), "removed");
    check(results, "…and taken away, after asking", !store.abbreviations.some((a) => a.term === "CDD2"));

    // ---------- in a pattern's text ----------
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-open="p1"]'), "the library");
    (document.querySelector('.library [data-open="p1"]') as HTMLElement).click();
    const textNode = () => {
      for (const span of document.querySelectorAll<HTMLElement>(".reader .text-layer span")) {
        const node = span.firstChild;
        if (node?.nodeType === Node.TEXT_NODE && /k2tog-psso/.test(node.textContent ?? "") && !/slip1/.test(node.textContent ?? "")) return node as Text;
      }
      return null;
    };
    await waitFor(() => !!textNode(), "the pattern's text", 20000);
    await wait(500);
    // On screen: the pointer finds only what is shown.
    textNode()!.parentElement!.scrollIntoView({ block: "center" });
    await wait(600);
    const node = textNode()!;
    const at = node.textContent!.indexOf("k2tog");
    const range = document.createRange();
    range.setStart(node, at + 1);
    range.setEnd(node, at + 4);
    const rect = range.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>(".reader .doc-scroller")!;
    scroller.dispatchEvent(new MouseEvent("mousemove", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true }));
    await waitFor(() => !!tip(), "the tip", 3000).catch(() => {});
    check(results, "in a pattern, resting on k2tog says what it means, beside it", /k2tog/.test(tip()?.textContent ?? "") && /Knit 2 together/.test(tip()?.textContent ?? ""), tip()?.textContent ?? `none (pointer at ${Math.round(rect.left)},${Math.round(rect.top)}, ${Math.round(rect.width)}×${Math.round(rect.height)})`);
    if (tip()) {
      const t = tip()!.getBoundingClientRect();
      check(results, "…just below the word", t.top >= rect.bottom && t.top - rect.bottom < 20, `${Math.round(t.top)} vs ${Math.round(rect.bottom)}`);
    }
    scroller.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
    await waitFor(() => !tip(), "the tip gone", 2000).catch(() => {});
    check(results, "…and gone when the pointer leaves", !tip());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.abbreviations = before;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__abbreviationChecks = verifyAbbreviations;
