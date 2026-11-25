import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * pdf.js decodes some pictures in a PDF -- JBIG2, common in scans, and
 * JPEG 2000 -- with WebAssembly modules (or their plain-JS fallbacks) it
 * fetches by name from one folder. This serves that folder of
 * node_modules/pdfjs-dist/wasm at /pdfjs-wasm/ while developing and copies it
 * into the build. The PDF-JavaScript engine (quickjs) is left out: the app
 * never runs a PDF's scripts.
 */
const DIR = resolve(import.meta.dirname, "node_modules/pdfjs-dist/wasm");
const FOLDER = "pdfjs-wasm/";
const WANTED = (name: string) => /^[\w.-]+\.(wasm|js)$/.test(name) && !name.startsWith("quickjs");

export function pdfjsWasm(): Plugin {
  return {
    name: "pdfjs-wasm",
    configureServer(server) {
      server.middlewares.use(`/${FOLDER}`, (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!WANTED(name)) return next();
        try {
          const body = readFileSync(resolve(DIR, name));
          res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const name of readdirSync(DIR).filter(WANTED)) {
        this.emitFile({ type: "asset", fileName: FOLDER + name, source: readFileSync(resolve(DIR, name)) });
      }
    },
  };
}
