/**
 * Checks for the Cheatsheets tab, clicked through: a web page kept and shown
 * in a frame, an embed code and a YouTube link tidied, a site that refuses
 * frames offered a window of its own, pages of a PDF drawn from the book,
 * a page kept from the reader, and renaming, moving and removing.
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

type Sheet = { id: string; title: string; kind: string; url: string; framable: boolean; patternId: string; pageFrom: number; pageTo: number };

export async function verifyCheatsheets() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { cheatsheets?: Sheet[]; patterns: { id: string; title: string; format: string; fileName: string }[] }; __sheetWindows?: { url: string }[]; __opened?: string[] };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".cheatsheets");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const items = () => [...document.querySelectorAll<HTMLElement>(".cheatsheets [data-sheet]")];
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

    // Renamed, moved, removed.
    const title = view()!.querySelector<HTMLInputElement>('[data-f="title"]')!;
    title.value = "Gauge, all sizes";
    title.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => /Gauge, all sizes/.test(items()[0].textContent ?? ""), "the new name in the list");
    check(results, "renamed where it shows, the list too", store.cheatsheets!.some((s) => s.title === "Gauge, all sizes"));
    act("down")!.click();
    await waitFor(() => /Gauge, all sizes/.test(items()[1]?.textContent ?? ""), "moved down");
    check(results, "↓ moves it down the list, and it stays open", items()[1].classList.contains("on"));

    // Remembered, leaving the tab.
    tab("projects");
    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 4, "the tab again");
    check(results, "the one open is remembered, leaving the tab and coming back", items()[1].classList.contains("on") && /Gauge, all sizes/.test(items()[1].textContent ?? ""));

    // Kept from the reader.
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library .card[data-open="${pdf.id}"]`), "the library");
    document.querySelector<HTMLElement>(`.library .card[data-open="${pdf.id}"] h3`)!.click();
    await waitFor(() => !!document.querySelector('.reader [data-act="cheatsheet"]'), "the reader");
    await wait(500);
    document.querySelector<HTMLElement>('.reader [data-act="cheatsheet"]')!.click();
    await answer(["1", "2", ""]);
    await waitFor(() => (store.cheatsheets ?? []).length === 5, "the page kept");
    const kept = store.cheatsheets!.find((s) => s.patternId === pdf.id && s.pageTo === 2)!;
    check(results, "Cheatsheet… in the reader keeps the pages, named by the book", !!kept && kept.kind === "pages" && kept.title === `${pdf.title}, p. 1–2`, JSON.stringify(kept));

    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 5, "the tab again");
    items()[0].click();
    await waitFor(() => !!act("open-book"), "the kept pages");
    act("open-book")!.click();
    await waitFor(() => !!document.querySelector(".reader") && !view(), "the book");
    check(results, "In the book ↗ opens the book", document.querySelector(".tab-bar .tab.active")?.getAttribute("data-tab") === "patterns");

    tab("cheatsheets");
    await waitFor(() => !!view() && items().length === 5, "the tab again");
    act("remove")!.click();
    await waitFor(() => !!dialog(), "the question");
    dialog()!.querySelector<HTMLElement>("button.primary, button.danger")!.click();
    await waitFor(() => items().length === 4, "one fewer");
    check(results, "Remove takes it out, the next one open", !!view()!.querySelector(".sheet-item.on"));

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
