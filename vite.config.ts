import { defineConfig } from "vite";
import { pdfjsWasm } from "./pdfjs-wasm.ts";

// Tauri serves the built assets from src-tauri and points dev traffic at 1420.
export default defineConfig({
  clearScreen: false,
  // pdf.js's picture decoders, served beside the app.
  plugins: [pdfjsWasm()],
  server: {
    port: 1420,
    strictPort: true,
    // harness/ drives the real UI in a browser with a stubbed IPC layer.
    fs: { allow: [".."] },
  },
  build: {
    target: "chrome110",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  // pdf.js ships its worker as a separate asset; Vite handles the ?url import.
  worker: {
    format: "es",
  },
  // Test fixtures live in public/ so the harness can fetch them, but they have
  // no business inside a shipped installer. The app references no static public
  // assets, so the app build copies no public directory at all; the harness
  // config sets its own publicDir.
  publicDir: false,
});
