/**
 * Checks for links in a PDF pattern: addresses only written on the page
 * (www., https://, a shop's bare name, a mail address, one broken over two
 * lines) found and clickable, opened out of the app as a real link is;
 * look-alikes left alone; and a real link in the PDF winning over the words
 * under it.
 *
 * Run with the harness open:
 *   window.__linkChecks()
 */
import type { Pattern } from "../src/api";
import { addressUrl, findAddresses } from "../src/reader/links";

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
  const said = (text: string) => findAddresses(text).map((a) => text.slice(a.start, a.end));
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  check(results, "addresses in words: www., https://, a bare shop name with its path, a mail address", same(said("see www.shop.de or https://x.com/a?b=1 and ravelry.com/designers/me, mail me@mail.com"), ["www.shop.de", "https://x.com/a?b=1", "ravelry.com/designers/me", "me@mail.com"]), JSON.stringify(said("see www.shop.de or https://x.com/a?b=1 and ravelry.com/designers/me, mail me@mail.com")));
  check(results, "…what ends a sentence left off, brackets kept when the address has them", same(said("buy at www.shop.de. (or www.yarn.com)"), ["www.shop.de", "www.yarn.com"]) && same(said("https://en.wikipedia.org/wiki/Fair_(knitting)"), ["https://en.wikipedia.org/wiki/Fair_(knitting)"]), JSON.stringify(said("buy at www.shop.de. (or www.yarn.com)")));
  check(results, "…one broken over a line after a slash, read whole", same(said("at https://x.com/patterns/ sunday-shawl now"), ["https://x.com/patterns/ sunday-shawl"]));
  check(results, "look-alikes are no addresses: measures, e.g., fig., k2tog", same(said("knit 2.5 cm, e.g. k2tog, fig. 3. s.k.p"), []), JSON.stringify(said("knit 2.5 cm, e.g. k2tog, fig. 3.")));
  check(results, "what each opens: https:// added, mail as mailto, broken ones joined", addressUrl("www.Shop.de/Garn") === "https://www.Shop.de/Garn" && addressUrl("me@mail.com") === "mailto:me@mail.com" && addressUrl("http://x.com") === "http://x.com" && addressUrl("https://x.com/patterns/ sunday") === "https://x.com/patterns/sunday");
}

export async function verifyLinks() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { patterns: Pattern[] } }).__store;
  const w = window as unknown as { __opened?: string[] };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const links = () => [...document.querySelectorAll<HTMLAnchorElement>(".reader .text-links a")];
  const pattern = { ...store.patterns[0], id: "p-links", title: "Sunday Shawl", fileName: "links-pattern.pdf", filePath: "library/originals/p-links.pdf", format: "pdf", sizeIndex: null } as Pattern;
  store.patterns.push(pattern);
  try {
    pure(results);
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: pattern.id }));
    await waitFor(() => links().length >= 4, "the page's addresses");
    // Fonts settle, and the boxes are laid again on them.
    await wait(600);
    const hrefs = [...new Set(links().map((a) => a.href.replace(/\/$/, "")))];
    check(results, "the addresses written on the page are links", ["https://www.wollshop.de/garn/merino", "https://ravelry.com/designers/shiny", "mailto:hello@shiny-knits.com", "https://example.com/patterns/sunday-shawl"].every((h) => hrefs.includes(h)), JSON.stringify(hrefs));
    check(results, "…and the look-alikes are not", !hrefs.some((h) => /2\.5|e\.g|fig|k2tog/.test(h)), JSON.stringify(hrefs));
    const broken = links().filter((a) => a.href.includes("sunday-shawl"));
    check(results, "…the one broken over two lines a box on each line", broken.length === 2 && Math.abs(broken[0].getBoundingClientRect().top - broken[1].getBoundingClientRect().top) > 8, String(broken.length));
    const shop = links().find((a) => a.href.includes("wollshop"))!;
    const box = shop.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    check(results, "…on the words, and what a click there meets", hit === shop && box.width > 60 && box.height > 6, `${hit?.className} ${box.width}×${box.height}`);
    w.__opened = [];
    shop.click();
    await waitFor(() => (w.__opened ?? []).length > 0, "the link opened", 3000).catch(() => {});
    check(results, "clicked, it opens out of the app, as a link in the PDF does", JSON.stringify(w.__opened) === JSON.stringify(["https://www.wollshop.de/garn/merino"]) && !!document.querySelector(".reader"), JSON.stringify(w.__opened));

    // The real link wins over the words under it.
    await waitFor(() => !!document.querySelector(".reader .link-layer .linkAnnotation a"), "the PDF's own link");
    const real = document.querySelector<HTMLElement>(".reader .link-layer .linkAnnotation a")!;
    const rb = real.getBoundingClientRect();
    const top = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
    w.__opened = [];
    (top as HTMLElement | null)?.click();
    await waitFor(() => (w.__opened ?? []).length > 0, "the real link opened", 3000).catch(() => {});
    check(results, "where the PDF has a link of its own, that is the one followed", JSON.stringify(w.__opened) === JSON.stringify(["https://real-link.com/annotated"]), JSON.stringify(w.__opened));

    // With a pen in hand, a press is the pen's.
    const pen = document.querySelector<HTMLElement>('.reader [data-mark="draw"]');
    check(results, "the reader has a pen to try", !!pen);
    if (pen) {
      pen.click();
      await wait(100);
      check(results, "with a pen in hand the addresses do not answer", getComputedStyle(shop).pointerEvents === "none");
      (document.querySelector<HTMLElement>('.reader [data-mark="none"]') ?? pen).click();
    }
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.patterns = store.patterns.filter((p) => p.id !== pattern.id);
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__linkChecks = verifyLinks;
