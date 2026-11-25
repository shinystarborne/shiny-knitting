/**
 * Checks that pdf.js finds its picture decoders: a PDF whose picture is
 * JPEG 2000 (as JBIG2 in scans, decoded the same way) is drawn in its
 * colours, with WebAssembly and with the plain-JS fallback pdf.js uses where
 * WebAssembly is not allowed.
 *
 * Run with the harness open:
 *   window.__pdfDecoderChecks()
 */
import * as pdfjs from "pdfjs-dist";
import { openPdf } from "../src/pdf-open";
import "../src/reader/pdf";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

/** The page drawn, and the colour at a point of it, as [r, g, b]. */
async function drawn(doc: pdfjs.PDFDocumentProxy): Promise<(x: number, y: number) => number[]> {
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  const ctx = canvas.getContext("2d")!;
  return (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
}

export async function verifyPdfDecoders() {
  const results: CheckResult[] = [];
  const bytes = new Uint8Array(await (await fetch("/fixtures/jpx-picture.pdf")).arrayBuffer());
  // The picture: 400 x 200 at (100, 300) from the bottom of a 600 pt page,
  // red on the left, blue on the right.
  const reddish = (c: number[]) => c[0] > 150 && c[2] < 90;
  const bluish = (c: number[]) => c[2] > 150 && c[0] < 90;
  try {
    const task = openPdf(bytes);
    const at = await drawn(await task.promise);
    const [left, right] = [at(200, 200), at(400, 200)];
    check(results, "a JPEG 2000 picture in a PDF is drawn, in its colours", reddish(left) && bluish(right), JSON.stringify([left, right]));
    await task.destroy();

    const fallback = pdfjs.getDocument({ data: bytes.slice(), wasmUrl: new URL("/pdfjs-wasm/", document.baseURI).href, useWasm: false });
    const at2 = await drawn(await fallback.promise);
    const [l2, r2] = [at2(200, 200), at2(400, 200)];
    check(results, "…and so without WebAssembly, by the plain-JS decoder", reddish(l2) && bluish(r2), JSON.stringify([l2, r2]));
    await fallback.destroy();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__pdfDecoderChecks = verifyPdfDecoders;
