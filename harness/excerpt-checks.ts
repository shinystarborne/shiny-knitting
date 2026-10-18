/**
 * Checks for what a model is sent of a file: an EPUB whose first chapters are
 * pictures read on to its text; one that is all pictures sent its first
 * pictures, its cover first and small ones left out; and a scanned PDF its
 * pages as pictures.
 *
 * Run with the harness open:
 *   window.__excerptChecks()
 */
import { excerptImages, extractExcerpt } from "../src/ai/excerpt";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const fixture = async (name: string) => new Uint8Array(await (await fetch(`/fixtures/${name}`)).arrayBuffer());

/** A picture's size, from its data: URL. */
async function sizeOf(url: string): Promise<[number, number]> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return [img.naturalWidth, img.naturalHeight];
}

export async function verifyExcerpts() {
  const results: CheckResult[] = [];
  try {
    const first = await fixture("pictures-first.epub");
    const text = await extractExcerpt("epub", first, 4000);
    check(results, "an EPUB whose first chapters are pictures is read on to its text", /Kate Example/.test(text) && /Gauge 22 sts/.test(text), text.slice(0, 120));

    const only = await fixture("pictures-only.epub");
    check(results, "a book of scanned pages has no text", (await extractExcerpt("epub", only, 4000)).trim() === "");
    const pictures = await excerptImages("epub", only);
    const sizes = await Promise.all(pictures.map(sizeOf));
    check(results, "…so its first three pictures are sent, as JPEG, the cover once", pictures.length === 3 && pictures.every((p) => p.startsWith("data:image/jpeg;base64,")) && new Set(pictures).size === 3, `${pictures.length} pictures`);
    check(results, "…at the size of a page, no bigger than a page is sent", sizes.every(([w, h]) => w === 700 && h === 1000), JSON.stringify(sizes));
    const firstPictures = await excerptImages("epub", first);
    check(results, "…a small picture, a rule or an icon, left out", firstPictures.length === 3, `${firstPictures.length} pictures`);

    const scan = await excerptImages("pdf", await fixture("scanned-pattern.pdf"));
    check(results, "a scanned PDF's pages are sent as pictures", scan.length >= 1 && scan.every((p) => p.startsWith("data:image/jpeg")), `${scan.length} pages`);
    check(results, "an EPUB with text is read as text, as before", /\w{20,}|\w+ \w+ \w+/.test(await extractExcerpt("epub", await fixture("sample-pattern.epub"), 4000)));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__excerptChecks = verifyExcerpts;
