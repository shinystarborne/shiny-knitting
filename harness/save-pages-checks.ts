/**
 * Checks for saving a pattern's pages as a PDF: the page ranges, where an
 * EPUB chapter's pages break, the PDFs made (read back by pdf.js), and the
 * reader's Save pages dialog, for a PDF and an EPUB.
 *
 * Run with the harness open, after the other suites:
 *   window.__savePagesChecks()
 */
import * as pdfjs from "pdfjs-dist";
import { epubPages, formatRanges, pageBreaks, parseRanges, pdfPages } from "../src/reader/save-pages";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items as { str: string }[];
    out.push(items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.destroy();
  return out;
}

async function pure(results: CheckResult[]): Promise<void> {
  check(results, "pages typed as ranges, in the order written, each once", parseRanges("1-3, 7, 2, 9-8", 10).join() === "1,2,3,7,9,8");
  check(results, "…pages past the end left out", parseRanges("4-6, 12, x", 5).join() === "4,5");
  check(results, "…and written back as runs", formatRanges([1, 2, 3, 7, 9, 10]) === "1–3, 7, 9–10");

  // Lines 20 px tall, every 24 px, and a picture 300 px tall from 990.
  const lines: [number, number][] = [];
  for (let y = 0; y < 3000; y += 24) if (y < 990 || y > 1290) lines.push([y, y + 20]);
  const spans: [number, number][] = [...lines, [990, 1290]];
  const breaks = pageBreaks(3000, spans, 1000);
  const cuts = breaks.slice(0, -1);
  check(results, "a chapter's pages break between lines, never through one or a picture", cuts.every((b) => !spans.some(([t, bt]) => t < b - 0.5 && b + 0.5 < bt)), JSON.stringify(breaks));
  check(results, "…as full as can be, and the last at the chapter's end", cuts.every((b, i) => b - (i ? cuts[i - 1] : 0) <= 1000 && b - (i ? cuts[i - 1] : 0) > 500) && breaks[breaks.length - 1] === 3000, JSON.stringify(breaks));
  check(results, "…a picture taller than a page is cut where the page ends", pageBreaks(2500, [[100, 2400]], 1000)[0] === 1000);

  // A PDF's pages, copied.
  const sample = new Uint8Array(await (await fetch("/fixtures/long-pattern.pdf")).arrayBuffer());
  const original = await pageTexts(sample);
  const saved = await pdfPages(sample, [3, 1], "Two pages");
  const copied = await pageTexts(saved);
  check(results, "chosen pages of a PDF are copied as they are, words and all, in the order chosen", copied.length === 2 && copied[0] === original[2] && copied[1] === original[0] && copied[0].length > 0, `${copied.length} pages`);
  const savedDoc = await pdfjs.getDocument({ data: saved.slice() }).promise;
  check(results, "…titled", (((await savedDoc.getMetadata()).info as { Title?: string }).Title ?? "") === "Two pages");
  await savedDoc.destroy();

  // EPUB chapters, laid out on A4.
  const para = (n: number) => `<p>Row ${n}: knit across, then purl back, keeping the edge stitches in garter.</p>`;
  const long = `<!doctype html><html><head><style>p { margin: 0 0 8px; }</style></head><body><h1>Hat</h1>${Array.from({ length: 120 }, (_, i) => para(i + 1)).join("")}</body></html>`;
  const short = `<!doctype html><html><body><h1>Mittens</h1><p>Cast on 40.</p></body></html>`;
  const pdf = await epubPages([long, short], "Chapters", () => {});
  const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
  const [, , w, h] = (await doc.getPage(1)).view;
  check(results, "EPUB chapters are laid out on A4 pages, a long one over several, each chapter on a new page", doc.numPages >= 3 && Math.abs(w - 595.28) < 0.5 && Math.abs(h - 841.89) < 0.5, `${doc.numPages} pages, ${w} × ${h}`);
  await doc.destroy();
}

export async function verifySavePages() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __lastExport?: { kind: string; name: string; bytes: Uint8Array }; __nextSavePath?: string | null };
  const last = () => w.__lastExport;
  const dialog = () => document.querySelector<HTMLElement>(".save-pages-dialog");
  const open = async (id: string) => {
    document.querySelector(".screen")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: id }));
    await waitFor(() => !!document.querySelector('.reader [data-act="save-pages"]'), "the reader");
  };

  try {
    await pure(results);

    // ---------- a PDF ----------
    await open("p1");
    await wait(800);
    (document.querySelector('.reader [data-act="save-pages"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the dialog");
    const pagesBox = dialog()!.querySelector<HTMLInputElement>('[data-f="pages"]')!;
    const nameBox = dialog()!.querySelector<HTMLInputElement>('[data-f="name"]')!;
    const tiles = () => [...dialog()!.querySelectorAll<HTMLElement>(".save-thumb")];
    check(results, "Save pages offers a thumbnail a page, the page being read chosen", tiles().length > 0 && pagesBox.value === "1" && tiles()[0].classList.contains("on"), `${tiles().length} / ${pagesBox.value}`);
    (dialog()!.querySelector('[data-act="all"]') as HTMLElement).click();
    check(results, "…All ticks them all", tiles().every((t) => t.classList.contains("on")) && /–/.test(nameBox.value), nameBox.value);
    tiles()[0].click();
    check(results, "…a thumbnail clicked is taken off", !tiles()[0].classList.contains("on") && pagesBox.value.startsWith("2"), pagesBox.value);
    pagesBox.value = "1";
    pagesBox.dispatchEvent(new Event("input", { bubbles: true }));
    w.__lastExport = undefined;
    w.__nextSavePath = undefined;
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => /Saved to/.test(dialog()?.querySelector('[data-el="status"]')?.textContent ?? ""), "the save");
    const saved = await pageTexts(last()!.bytes);
    check(results, "Save as PDF saves the chosen pages where asked", last()!.kind === "pdf" && saved.length === 1 && /Featherweight Lace Sock — page 1$/.test(last()!.name), `${last()?.name} / ${saved.length}`);
    (dialog()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
    await waitFor(() => !dialog(), "the dialog to close");

    // ---------- an EPUB ----------
    await open("p2");
    await waitFor(() => !!document.querySelector(".reader .epub-frame"), "the chapters");
    await wait(800);
    (document.querySelector('.reader [data-act="save-pages"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector(".save-chapter"), "the chapters to choose");
    check(results, "for an EPUB, the chapters by name", /chapters as a PDF/.test(dialog()!.textContent ?? "") && dialog()!.querySelectorAll(".save-chapter").length > 0);
    (dialog()!.querySelector('[data-act="all"]') as HTMLElement).click();
    w.__lastExport = undefined;
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => /Saved to/.test(dialog()?.querySelector('[data-el="status"]')?.textContent ?? ""), "the chapters saved", 60000);
    const doc = await pdfjs.getDocument({ data: last()!.bytes.slice() }).promise;
    check(results, "…saved as A4 pages, every chapter chosen", doc.numPages >= dialog()!.querySelectorAll(".save-chapter").length, String(doc.numPages));
    await doc.destroy();
    (dialog()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".save-pages-dialog [data-act='cancel']")?.click();
    document.querySelector<HTMLElement>('.tab-bar [data-tab="patterns"]')?.click();
    await waitFor(() => !document.querySelector(".reader"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__savePagesChecks = verifySavePages;
