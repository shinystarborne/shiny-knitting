import * as pdfjs from "pdfjs-dist";

/**
 * Where pdf.js finds its picture decoders (JBIG2, JPEG 2000), served beside
 * the app (see pdfjs-wasm.ts), from the root whatever page asks. A folder
 * URL, as pdf.js asks for one.
 */
const WASM_URL = new URL("/pdfjs-wasm/", document.baseURI).href;

/**
 * Opens a PDF's bytes with pdf.js, the one way every part of the app does.
 * The bytes are copied: pdf.js takes the buffer it is given to its worker.
 */
export function openPdf(bytes: Uint8Array): pdfjs.PDFDocumentLoadingTask {
  return pdfjs.getDocument({ data: bytes.slice(), wasmUrl: WASM_URL });
}
