/**
 * Checks for the Cheatsheets tab, clicked through: a web page kept and shown
 * in a frame, an embed code and a YouTube link tidied, a site that refuses
 * frames offered a window of its own, pages of a PDF drawn from the book,
 * part of a page (a box drawn round it, in the tab or in the reader), a page
 * kept from the reader, and renaming, moving and removing.
 *
 * Run with the harness open:
 *   window.__cheatsheetsChecks()
 */

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

type Sheet = { id: string; title: string; kind: string; url: string; framable: boolean; patternId: string; pageFrom: number; pageTo: number; region: { x: number; y: number; w: number; h: number } | null };

/** A drag from one point to another, in fractions of an element's box, as a pointer makes it. */
function drag(down: HTMLElement, moves: HTMLElement, from: [number, number], to: [number, number]): void {
  const r = down.getBoundingClientRect();
  const at = ([fx, fy]: [number, number]) => ({ clientX: r.left + fx * r.width, clientY: r.top + fy * r.height, bubbles: true, button: 0, pointerId: 7 });
  down.dispatchEvent(new PointerEvent("pointerdown", at(from)));
  moves.dispatchEvent(new PointerEvent("pointermove", at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2])));
  moves.dispatchEvent(new PointerEvent("pointermove", at(to)));
  moves.dispatchEvent(new PointerEvent("pointerup", at(to)));
}

const near = (a: number, b: number, by = 0.02) => Math.abs(a - b) <= by;

export async function verifyCheatsheets() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { pins?: { patternId: string }[]; cheatsheets?: Sheet[]; patterns: { id: string; title: string; format: string; fileName: string }[] }; __sheetWindows?: { url: string }[]; __opened?: string[] };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".cheatsheets");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  // The sheets kept, not the glossary always first.
  const items = () => [...document.querySelectorAll<HTMLElement>('.cheatsheets [data-sheet]:not([data-sheet="abbreviations"]):not([data-sheet="symbols"])')];
  const act = (name: string) => view()!.querySelector<HTMLElement>(`[data-act="${name}"]`);
  /** Fills a form dialog's boxes in order, and answers it. */
  const answer = async (values: string[]) => {
    await waitFor(() => !!dialog(), "the dialog");
    const inputs = [...dialog()!.querySelectorAll<HTMLInputElement>("input.dialog-input")];
    values.forEach((v, i) => {
      if (inputs[i]) inputs[i].value = v;
    });
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => !dialog(), "the dialog to close");
  };
  const before = store.cheatsheets ? [...store.cheatsheets] : undefined;
  try {
    localStorage.removeItem("cheatsheets:open");
  } catch {
    // Nothing remembered.
  }
  store.cheatsheets = [];

  try {
    tab("cheatsheets");
    await waitFor(() => !!view()?.querySelector(".empty"), "the Cheatsheets tab");
    check(results, "a tab of its own, saying what it is for while empty", /No cheatsheets yet/.test(view()!.textContent ?? "") && document.querySelector('.tab-bar [data-tab="cheatsheets"]')!.classList.contains("active"));

    // A web page, shown here.
    act("add-web")!.click();
    await answer(["knitty.com/ISSUEff24/FEATtips.php", ""]);
    await waitFor(() => !!view()!.querySelector("iframe.sheet-frame"), "the page in its frame");
    const frame = view()!.querySelector<HTMLIFrameElement>("iframe.sheet-frame")!;
    check(results, "a web page is kept, its address made whole, shown in a frame", frame.getAttribute("src") === "https://knitty.com/ISSUEff24/FEATtips.php" && items().length === 1 && items()[0].classList.contains("on"), frame.getAttribute("src") ?? "");
    check(results, "…named by its site when not named", /knitty\.com/.test(items()[0].textContent ?? ""));
    check(results, "…the frame sandboxed", (frame.getAttribute("sandbox") ?? "").includes("allow-scripts") && !(frame.getAttribute("sandbox") ?? "").includes("allow-top-navigation"));

    // An embed code, and a YouTube link.
    act("add-web")!.click();
    await answer(['<iframe width="560" src="https://youtu.be/dQw4w9WgXcQ"></iframe>', "Tubular cast-on"]);
    await waitFor(() => items().length === 2, "the second");
    check(results, "an embed code is unwrapped, a YouTube link kept as its embed page, at the top of the list", view()!.querySelector("iframe.sheet-frame")?.getAttribute("src") === "https://www.youtube.com/embed/dQw4w9WgXcQ" && /Tubular cast-on/.test(items()[0].textContent ?? ""), view()!.querySelector("iframe.sheet-frame")?.getAttribute("src") ?? "");

    // A site that will not be framed.
    act("add-web")!.click();
    await answer(["https://shop.example/refuses-frames", "Yarn weights"]);
    await waitFor(() => !!view()!.querySelector(".sheet-refused"), "the refusal");
    check(results, "a site that refuses frames is not framed: it says so, and offers a window", !view()!.querySelector("iframe") && /will not be shown inside another app/.test(view()!.textContent ?? ""));
    view()!.querySelector<HTMLElement>('.sheet-refused [data-act="window"]')!.click();
    await waitFor(() => (w.__sheetWindows ?? []).length > 0, "the window");
    check(results, "…Open in a window of its own opens one, at its address", w.__sheetWindows!.at(-1)!.url === "https://shop.example/refuses-frames");
    view()!.querySelector<HTMLElement>('.sheet-refused [data-act="browser"]')!.click();
    await wait(100);
    check(results, "…or in the browser", (w.__opened ?? []).at(-1) === "https://shop.example/refuses-frames");
    view()!.querySelector<HTMLElement>('[data-act="framable"]')!.click();
    await waitFor(() => !!view()!.querySelector("iframe.sheet-frame"), "trying it here");
    check(results, "…Try here anyway frames it, and is kept", store.cheatsheets!.find((s) => s.title === "Yarn weights")!.framable === true);

    // Pages of a PDF.
    const pdf = store.patterns.find((p) => p.format === "pdf" && p.fileName === "sample-pattern.pdf") ?? store.patterns.find((p) => p.format === "pdf")!;
    act("add-pages")!.click();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "the book to pick");
    const list = dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!;
    list.value = pdf.id;
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await answer(["1", "1", "Gauge table"]);
    await waitFor(() => !!view()!.querySelector("canvas.sheet-page"), "the page drawn");
    const drawn = view()!.querySelector<HTMLCanvasElement>("canvas.sheet-page")!;
    check(results, "pages from a book: drawn from its file, the page asked for", drawn.dataset.page === "1" && drawn.width > 100 && /Gauge table/.test(items()[0].textContent ?? "") && /page 1/.test(items()[0].textContent ?? ""));
    const width = drawn.getBoundingClientRect().width;
    act("zoom-in")!.click();
    await waitFor(() => (view()!.querySelector<HTMLCanvasElement>("canvas.sheet-page")?.getBoundingClientRect().width ?? 0) > width + 10, "bigger");
    check(results, "…+ draws it bigger", true);

    // Part of the page: a box drawn round it in the tab.
    const gauge = () => store.cheatsheets!.find((s) => s.title === "Gauge table")!;
    const pageWidth = view()!.querySelector<HTMLCanvasElement>("canvas.sheet-page")!.getBoundingClientRect().width;
    act("crop")!.click();
    await waitFor(() => !!view()!.querySelector(".sheet-crop canvas.sheet-page") && !!act("crop-cancel"), "the page to draw a box on");
    check(results, "Crop… shows the page whole, saying to draw a box, with Cancel", /Drag a box around the part to keep/.test(view()!.textContent ?? "") && !act("crop"));
    const cropFrame = () => view()!.querySelector<HTMLElement>(".sheet-crop")!;
    drag(cropFrame(), cropFrame(), [0.3, 0.3], [0.302, 0.301]);
    await wait(150);
    check(results, "…a click, or a slip of the hand, is not a box", gauge().region === null && !!cropFrame());
    drag(cropFrame(), cropFrame(), [0.6, 0.5], [0.1, 0.2]);
    await waitFor(() => !!gauge().region && !!view()!.querySelector("canvas.sheet-part"), "the part kept");
    const box = gauge().region!;
    check(results, "…a box drawn round part of the page keeps that part, whichever way it was drawn", near(box.x, 0.1) && near(box.y, 0.2) && near(box.w, 0.5) && near(box.h, 0.3), JSON.stringify(box));
    const part = view()!.querySelector<HTMLCanvasElement>("canvas.sheet-part")!;
    check(results, "…and only it is drawn, at the size it was on the page", near(part.getBoundingClientRect().width, pageWidth * box.w, 3) && part.height < part.width * 3, `${part.getBoundingClientRect().width} of ${pageWidth}`);
    check(results, "…the list saying it is part of the page; Crop again… and Whole page offered", /part of page 1/.test(items()[0].textContent ?? "") && /Crop again/.test(act("crop")?.textContent ?? "") && !!act("whole"));
    act("whole")!.click();
    await waitFor(() => gauge().region === null && !view()!.querySelector("canvas.sheet-part") && !!view()!.querySelector("canvas.sheet-page"), "the whole page again");
    check(results, "Whole page shows all of it again", /page 1/.test(items()[0].textContent ?? "") && !/part of/.test(items()[0].textContent ?? ""));
    act("crop")!.click();
    await waitFor(() => !!act("crop-cancel"), "cropping");
    act("crop-cancel")!.click();
    await waitFor(() => !view()!.querySelector(".sheet-crop") && !!act("crop"), "cancelled");
    check(results, "…Cancel leaves it as it was", gauge().region === null);

    // Renamed, moved, removed.
    const title = view()!.querySelector<HTMLInputElement>('[data-f="title"]')!;
    title.value = "Gauge, all sizes";
    title.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => /Gauge, all sizes/.test(items()[0].textContent ?? ""), "the new name in the list");
    check(results, "renamed where it shows, the list too", store.cheatsheets!.some((s) => s.title === "Gauge, all sizes"));
    act("down")!.click();
    await waitFor(() => /Gauge, all sizes/.test(items()[1]?.textContent ?? ""), "moved down");
    check(results, "↓ moves it down the list, and it stays open", items()[1].classList.contains("on"));

    // Its page has the way back to the cards; the tab comes back to them.
    check(results, "open, it is on a page of its own: the cards hidden, the way back to them", view()!.classList.contains("sheet-open") && !!act("back"));
    act("back")!.click();
    await waitFor(() => !view()!.classList.contains("sheet-open"), "the cards");
    check(results, "← Cheatsheets goes back to the cards, the glossaries first", !items().some((i) => i.classList.contains("on")) && view()!.querySelector(".sheet-item")?.getAttribute("data-sheet") === "abbreviations");
    items()[1].click();
    await waitFor(() => view()!.classList.contains("sheet-open"), "it open again");
    tab("projects");
    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 4, "the tab again");
    check(results, "the tab opens on its cards, whatever was open", !view()!.classList.contains("sheet-open") && /Gauge, all sizes/.test(items()[1].textContent ?? ""));

    // Kept from the reader.
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library .card[data-open="${pdf.id}"]`), "the library");
    document.querySelector<HTMLElement>(`.library .card[data-open="${pdf.id}"] h3`)!.click();
    await waitFor(() => !!document.querySelector('.reader [data-act="cheatsheet"]'), "the reader");
    await wait(500);
    const keep = async (what: "pages" | "part") => {
      document.querySelector<HTMLElement>('.reader [data-act="cheatsheet"]')!.click();
      await waitFor(() => !!dialog()?.querySelector(`[data-keep="${what}"]`), "whole pages or part");
      dialog()!.querySelector<HTMLElement>(`[data-keep="${what}"]`)!.click();
    };
    await keep("pages");
    await answer(["1", "2", ""]);
    await waitFor(() => (store.cheatsheets ?? []).length === 5, "the page kept");
    const kept = store.cheatsheets!.find((s) => s.patternId === pdf.id && s.pageTo === 2)!;
    check(results, "Cheatsheet… in the reader keeps the pages, named by the book", !!kept && kept.kind === "pages" && kept.title === `${pdf.title}, p. 1–2`, JSON.stringify(kept));

    // Part of a page, from the reader: a box drawn round it, as a pin is.
    const pinsBefore = (store.pins ?? []).length;
    await keep("part");
    await waitFor(() => /keep as a cheatsheet/.test(document.querySelector(".reader .pin-hint")?.textContent ?? ""), "the box to draw");
    check(results, "Part of a page… readies a box to draw, saying it is for a cheatsheet", document.querySelector('.reader [data-mark="pin"]')!.classList.contains("on"));
    const page = document.querySelector<HTMLElement>(".reader .pdf-page")!;
    page.scrollIntoView({ block: "start" });
    await wait(150);
    drag(page, document.querySelector<HTMLElement>(".reader .doc-scroller")!, [0.2, 0.1], [0.7, 0.3]);
    await waitFor(() => !!dialog(), "the name to give");
    await answer(["Needle chart"]);
    await waitFor(() => (store.cheatsheets ?? []).length === 6, "the part kept");
    const partKept = store.cheatsheets!.find((s) => s.title === "Needle chart")!;
    check(results, "…the box drawn is kept as a cheatsheet of that part of the page", partKept.kind === "pages" && partKept.pageFrom === 1 && partKept.pageTo === 1 && !!partKept.region && near(partKept.region.x, 0.2) && near(partKept.region.w, 0.5) && near(partKept.region.y, 0.1) && near(partKept.region.h, 0.2), JSON.stringify(partKept));
    check(results, "…no pin made, and the tool put back", (store.pins ?? []).length === pinsBefore && !document.querySelector(".reader .pin-hint") && !document.querySelector('.reader [data-mark="pin"]')!.classList.contains("on"));

    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 6, "the tab again");
    items()[0].click();
    await waitFor(() => !!view()!.querySelector("canvas.sheet-part"), "the part drawn");
    check(results, "…shown in the tab as only that part", /Needle chart/.test(items()[0].textContent ?? "") && /part of page 1/.test(items()[0].textContent ?? ""));
    await waitFor(() => !!act("open-book"), "the kept pages");
    act("open-book")!.click();
    await waitFor(() => !!document.querySelector(".reader") && !view(), "the book");
    check(results, "In the book ↗ opens the book", document.querySelector(".tab-bar .tab.active")?.getAttribute("data-tab") === "patterns");

    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 6, "the tab again");
    items()[0].click();
    await waitFor(() => !!act("remove"), "one open");
    act("remove")!.click();
    await waitFor(() => !!dialog(), "the question");
    dialog()!.querySelector<HTMLElement>("button.primary, button.danger")!.click();
    await waitFor(() => items().length === 5, "one fewer");
    check(results, "Remove takes it out, back to the cards", !view()!.classList.contains("sheet-open"));

    // Searched: by name, by the book it is from, the glossaries by theirs.
    const search = view()!.querySelector<HTMLInputElement>('[data-f="search"]')!;
    const searchFor = (text: string) => {
      search.value = text;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const sheetsNow = store.cheatsheets!;
    const named = sheetsNow[sheetsNow.length - 1];
    searchFor(named.title.toUpperCase());
    check(results, "the search finds a cheatsheet by its name, whatever the case", items().some((i) => i.dataset.sheet === named.id) && items().every((i) => sheetsNow.find((s) => s.id === i.dataset.sheet)!.title.toLowerCase().includes(named.title.toLowerCase())), items().map((i) => i.textContent?.trim()).join(" | "));
    const fromBook = sheetsNow.find((s) => s.kind === "pages")!;
    const bookTitle = store.patterns.find((p) => p.id === (fromBook as unknown as { patternId: string }).patternId)!.title;
    searchFor(bookTitle.split(/\s+/)[0]);
    check(results, "…by the book it is sheetsNow from", items().some((i) => i.dataset.sheet === fromBook.id), bookTitle);
    searchFor("no such thing anywhere");
    check(results, "…nothing found said so, the glossaries hidden too", items().length === 0 && /Nothing matches the search/.test(view()!.querySelector(".sheet-list")!.textContent ?? "") && !view()!.querySelector('[data-sheet="abbreviations"]'));
    searchFor("ssk");
    check(results, "…the glossaries found by what they hold", !!view()!.querySelector('[data-sheet="abbreviations"]') && !!view()!.querySelector('[data-sheet="symbols"]'));
    searchFor("");
    check(results, "…and emptied, all of them again", items().length === 5);

    // An EPUB's chapter, kept as a copy.
    const epub = store.patterns.find((p) => p.format === "epub")!;
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    // The EPUB may be under Books: opened by its id either way.
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: epub.id }));
    await waitFor(() => !!document.querySelector('.reader [data-act="cheatsheet"]') && !!document.querySelector(".reader .epub-frame"), "the book");
    await wait(800);
    document.querySelector<HTMLElement>('.reader [data-act="cheatsheet"]')!.click();
    await answer(["1", "Abbreviations"]);
    await waitFor(() => (store.cheatsheets ?? []).some((s) => s.kind === "chapter"), "the chapter kept");
    // The reader marks it the one to open, once it is back.
    await waitFor(() => localStorage.getItem("cheatsheets:open") === store.cheatsheets!.find((s) => s.kind === "chapter")!.id, "it marked to open");
    tab("cheatsheets");
    await waitFor(() => !!view()?.querySelector("iframe.sheet-chapter"), "the chapter shown").catch(() => {
      throw new Error(`no chapter shown: ${(view()?.querySelector(".sheet-view")?.textContent ?? "no view").replace(/\s+/g, " ").slice(0, 300)} / open ${localStorage.getItem("cheatsheets:open")} / ${JSON.stringify(store.cheatsheets?.map((x) => x.id + ":" + x.kind))}`);
    });
    const chapter = view()!.querySelector<HTMLIFrameElement>("iframe.sheet-chapter")!;
    check(results, "an EPUB's chapter is kept as a copy and shown, scripts and all shut out", /Abbreviations/.test(items()[0].textContent ?? "") && (chapter.srcdoc ?? "").length > 50 && chapter.getAttribute("sandbox") === "");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    store.cheatsheets = before;
    try {
      localStorage.removeItem("cheatsheets:open");
    } catch {
      // Nothing to clear.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__cheatsheetsChecks = verifyCheatsheets;
