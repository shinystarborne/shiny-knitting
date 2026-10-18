/**
 * Checks for books, clicked through: the library's Patterns and Books, a
 * pattern tagged "book" moving from one to the other, the choice remembered,
 * a file added from Books being a book, an EPUB a book from the start, and a
 * model's answer that a long file is a book written as the tag; one of 50
 * pages or more a book whatever the model says; and Describe filing the
 * long PDFs already described as books, without the model, once each.
 *
 * Run with the harness open:
 *   window.__booksChecks()
 */
import { api } from "../src/api";

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

type StorePattern = { id: string; title: string; format: string; tags: string[]; designer?: string; difficulty?: string; fileName?: string };

export async function verifyBooks() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { patterns: StorePattern[]; aiSettings: { enabled: boolean } | null; lastAiRequest?: { pages: number | null; patternId?: string }; aiSaysBook?: boolean } };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const shelfBtn = (which: string) => document.querySelector<HTMLElement>(`.library [data-shelf="${which}"]`);
  const shown = () => [...document.querySelectorAll<HTMLElement>(".library .card[data-open]")].map((c) => c.dataset.open!);
  const book = store.patterns.find((p) => p.format === "pdf" && p.id !== "p1")!;
  const tagsBefore = [...book.tags];
  const added: string[] = [];

  try {
    try {
      localStorage.removeItem("library:shelf");
    } catch {
      // Nothing remembered to clear.
    }
    tab("projects");
    tab("patterns");
    await waitFor(() => !!shelfBtn("books") && shown().length > 0, "the library");
    check(results, "the library opens on Patterns, with Books beside it", shelfBtn("patterns")!.classList.contains("on") && !shelfBtn("books")!.classList.contains("on"));
    check(results, "…the pattern among them while it is not a book", shown().includes(book.id));

    book.tags = [...tagsBefore, "Book"];
    tab("projects");
    tab("patterns");
    await waitFor(() => shown().length > 0, "the library again");
    check(results, "tagged “Book”, in any case, it is not among the patterns", !shown().includes(book.id));

    shelfBtn("books")!.click();
    await waitFor(() => shown().includes(book.id), "the book under Books");
    check(results, "…but under Books, and only books there", shown().every((id) => store.patterns.find((p) => p.id === id)!.tags.some((t) => t.toLowerCase() === "book")));
    check(results, "under Books, adding says so", document.querySelector('.library [data-act="add"]')?.textContent === "+ Add book");

    tab("projects");
    tab("patterns");
    await waitFor(() => !!shelfBtn("books"), "the library again");
    check(results, "Books is remembered, leaving the tab and coming back", shelfBtn("books")!.classList.contains("on"));

    (document.querySelector('.library [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.modal [data-el="tags"], [data-el="tags"] .tag'), "the add form");
    await wait(100);
    const formTags = [...document.querySelectorAll('[data-el="tags"] .tag')].map((t) => t.firstChild?.textContent ?? "");
    check(results, "+ Add book opens the form already tagged book", formTags.includes("book"), formTags.join(","));
    // The form's own Cancel: the nearest one round its tags.
    let around: HTMLElement | null = document.querySelector<HTMLElement>('[data-el="tags"]');
    while (around && !around.querySelector('[data-act="cancel"]')) around = around.parentElement;
    around?.querySelector<HTMLElement>('[data-act="cancel"]')?.click();
    await wait(200);

    // An EPUB is a book as it is added.
    const epub = await api.addPattern({ title: "Knits from the shelf", designer: "", fileName: "shelf.epub", sourcePath: "C:/books/shelf.epub", status: "", difficulty: "", needleSize: "", tags: ["shawls"], notes: "" } as never);
    added.push(epub.id);
    check(results, "an EPUB is tagged book as it is added", epub.tags.includes("book") && epub.tags.includes("shawls"), epub.tags.join(","));

    // The model is told the length, and a long file comes back a book.
    const before = store.aiSettings;
    store.aiSettings = { ...(before ?? {}), enabled: true } as never;
    const long = await api.addPattern({ title: "Sock anthology", designer: "", fileName: "anthology.pdf", sourcePath: "C:/books/anthology.pdf", status: "", difficulty: "", needleSize: "", tags: [], notes: "" } as never);
    added.push(long.id);
    const described = await api.suggestMetadata(long.id, "Contents: Sock one, Sock two, Sock three", [], 120);
    check(results, "the model is told how many pages the file has", store.lastAiRequest?.pages === 120);
    check(results, "…and a book it reads as one is tagged book", described.after.tags.includes("book"), described.after.tags.join(","));
    const one = await api.suggestMetadata(book.id, "One sock", [], 6);
    check(results, "…a six-page pattern is not", !(one.suggestion as { book?: boolean }).book);
    store.aiSaysBook = false;
    const sixty = await api.suggestMetadata(long.id, "Chapter one: casting on", [], 60);
    check(results, "a model saying no, 60 pages is a book all the same", (sixty.suggestion as { book?: boolean }).book === true);
    delete store.aiSaysBook;

    // Described already, the long PDFs filed as books by Describe, the model not asked.
    const described2 = (title: string, fileName: string) =>
      api.addPattern({ title, designer: "Someone", fileName, sourcePath: `C:/books/${fileName}`, status: "", difficulty: "easy", needleSize: "", tags: ["guide"], notes: "" } as never);
    const longBook = await described2("Raglan from A to Z", "book-length.pdf");
    const fortyPages = await described2("A long pattern", "long-pattern.pdf");
    added.push(longBook.id, fortyPages.id);
    try {
      localStorage.removeItem("describe:measured");
    } catch {
      // Nothing measured to forget.
    }
    store.lastAiRequest = undefined;
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-act="scan"]:not([hidden])'), "Describe offered");
    shelfBtn("patterns")?.click();
    await wait(300);
    document.querySelector<HTMLElement>('.library [data-act="scan"]')!.click();
    const measuredNow = () => JSON.parse(localStorage.getItem("describe:measured") ?? "[]") as string[];
    await waitFor(() => measuredNow().some((k) => k.startsWith(fortyPages.id)) && measuredNow().some((k) => k.startsWith(longBook.id)), "both measured", 15000).catch(() => {});
    const asked = document.querySelector<HTMLElement>(".dialog-card");
    if (asked) [...asked.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Cancel")?.click();
    check(results, "Describe files a described PDF of 60 pages under Books, the model not asked", !!store.patterns.find((p) => p.id === longBook.id)?.tags.includes("book") && (store.lastAiRequest as { patternId?: string } | undefined)?.patternId !== longBook.id, JSON.stringify(store.patterns.find((p) => p.id === longBook.id)?.tags));
    check(results, "…not one of 40", !store.patterns.find((p) => p.id === fortyPages.id)?.tags.includes("book"));
    check(results, "…each measured once, not again next time", measuredNow().some((k) => k.startsWith(fortyPages.id)) && measuredNow().some((k) => k.startsWith(longBook.id)));
    store.aiSettings = before;
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    book.tags = tagsBefore;
    store.patterns = store.patterns.filter((p) => !added.includes(p.id));
    try {
      localStorage.removeItem("library:shelf");
    } catch {
      // Nothing to clear.
    }
    shelfBtn("patterns")?.click();
    await wait(200);
    tab("projects");
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__booksChecks = verifyBooks;
