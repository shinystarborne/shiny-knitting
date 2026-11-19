// Runs every harness check in a headless Chrome and records which lines of
// src/ ran, as LCOV for SonarCloud: coverage/frontend/lcov.info.
//
// Needs, already running:
//   the harness dev server   npx vite --config harness/vite.harness.config.ts   (port 1421)
//   Chrome or Edge           --headless=new --remote-debugging-port=9222
// then: node harness/coverage.mjs
//
// The dev server, not the built harness: it serves each source file as its
// own module with an inline sourcemap, so every line maps back to its .ts
// file. Chrome's own coverage (Profiler.takePreciseCoverage) says what ran;
// monocart-coverage-reports maps it through the sourcemaps to LCOV.
//
// A failing check is reported, here and in the GitHub job summary, but does
// not fail the run: a coverage report should not go missing because one
// check failed, and the checks are run for themselves by run-checks.mjs.
import { appendFileSync } from "node:fs";
import { MCR } from "monocart-coverage-reports";
import { CHECKS } from "./check-names.mjs";

const DEVTOOLS = process.env.DEVTOOLS_PORT ?? "9222";
const PAGE = "http://localhost:1421/harness/index.html";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtools(path, init) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${DEVTOOLS}${path}`, init);
      if (res.ok) return res.json();
    } catch {
      // Not up yet.
    }
    await wait(500);
  }
  throw new Error(`no browser answering on port ${DEVTOOLS}`);
}

// A tab of its own; only its id is taken from the answer, and the address is
// built here.
const tab = await devtools("/json/new?about:blank", { method: "PUT" });
const tabId = String(tab?.id ?? "");
if (!/^[A-Za-z0-9-]{1,64}$/.test(tabId)) throw new Error("The browser did not answer with a tab.");
const ws = new WebSocket(`ws://localhost:${DEVTOOLS}/devtools/page/${encodeURIComponent(tabId)}`);

let lastId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((r) => (ws.onopen = r));

const evaluate = async (expression) => {
  const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
  return out.result?.value;
};

// Counting from before the page loads, so the code run at startup counts too.
await send("Runtime.enable");
await send("Debugger.enable");
await send("Profiler.enable");
await send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
await send("Page.enable");
await send("Page.navigate", { url: PAGE });

// The first load on a fresh dev server transforms every module; give it time.
for (let i = 0; i < 120; i++) {
  if (await evaluate(`typeof window.${CHECKS[0]} === "function" && !!document.querySelector("#app")?.children.length`).catch(() => false)) break;
  await wait(1000);
}

// ONLY=__priceChecks,__rowChecks runs just those, for a quick look.
const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const failed = [];
for (const name of only?.length ? CHECKS.filter((n) => only.includes(n)) : CHECKS) {
  if ((await evaluate(`typeof window.${name}`)) !== "function") {
    failed.push(`${name}: not on the page`);
    continue;
  }
  try {
    const out = await evaluate(`window.${name}().then((r) => r && (r.failed ?? (r.results ?? []).filter((x) => !x.ok).map((x) => x.name)) || [])`);
    for (const f of out ?? []) failed.push(`${name}: ${f}`);
    console.log(`${name}: ${out?.length ? `${out.length} failed` : "ok"}`);
  } catch (err) {
    failed.push(`${name}: threw ${err.message}`);
  }
}

// What ran, with each script's source: the sourcemap is inline in it.
const { result } = await send("Profiler.takePreciseCoverage");
const entries = [];
for (const script of result) {
  if (!new URL(script.url || "about:blank", PAGE).pathname.startsWith("/src/")) continue;
  const { scriptSource } = await send("Debugger.getScriptSource", { scriptId: script.scriptId });
  entries.push({ ...script, source: scriptSource });
}

const mcr = MCR({
  name: "Shiny Knitting, frontend",
  outputDir: "coverage/frontend",
  reports: ["lcovonly", "console-summary"],
  cleanCache: true,
  // The app's own sources, by their path in the repository.
  // Vite's inline sourcemaps name each source by its bare file name
  // ("main.ts"); the module it came from (src/views/x.ts, its distFile)
  // gives the folder. Paths are written with forward slashes.
  sourceFilter: (sourcePath) => sourcePath.endsWith(".ts"),
  sourcePath: (filePath, info) => {
    const path = filePath.replaceAll("\\", "/");
    const dist = (info?.distFile ?? "").replaceAll("\\", "/");
    const full = !path.includes("/") && dist.includes("/") ? `${dist.slice(0, dist.lastIndexOf("/") + 1)}${path}` : path;
    return full.replace(/^.*?(?=src\/)/, "");
  },
  // Files no check reaches are left out here: SonarCloud counts a source
  // file with no coverage as not covered.
});
await mcr.add(entries);
await mcr.generate();

await fetch(`http://localhost:${DEVTOOLS}/json/close/${encodeURIComponent(tabId)}`).catch(() => {});
// Closed and let go, then left to end by itself: process.exit() with the
// socket still closing trips an assertion in Node on Windows (exit code 127).
await new Promise((r) => {
  ws.onclose = r;
  ws.close();
});

if (failed.length) {
  console.log(`\n${failed.length} check(s) failed:\n${failed.map((f) => `  ${f}`).join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Harness checks that failed\n\n${failed.map((f) => `- ${f}`).join("\n")}\n`);
  }
}
