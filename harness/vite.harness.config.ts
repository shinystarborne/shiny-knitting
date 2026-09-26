import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * A second Vite config for the browser test harness, which serves the real
 * frontend with a stubbed Tauri IPC layer (see harness/stub.js).
 *
 * Usage: npx vite --config harness/vite.harness.config.ts
 */
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    fs: { allow: [".."] },
  },
  build: {
    target: "chrome110",
    outDir: "dist-harness",
    emptyOutDir: true,
    // Minified on purpose: `npm run harness:build` produces the same kind of
    // bundle the release build ships, so production-only problems (a stripped
    // name, a mangled module) can be reproduced without building the app.
    // The default minifier is used, which is what the app build uses too.
    minify: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
  // The harness needs public/fixtures; the app build points publicDir
  // elsewhere so test documents stay out of the installer.
  publicDir: "public",
  worker: { format: "es" },
});
