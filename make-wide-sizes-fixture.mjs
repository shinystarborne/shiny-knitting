// Builds a pattern set in a wide font (Verdana, embedded), in ten sizes
// written past their brackets, to test that the size knitted is marked on
// its own letters: the text layer's stand-in font puts letters elsewhere.
//
// Usage: start Edge or Chrome with --headless=new --remote-debugging-port=9222,
// then: node make-wide-sizes-fixture.mjs
// Output: public/fixtures/wide-sizes.pdf (1 page)
import { writeFileSync } from "node:fs";

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Verdana; font-size: 15px; line-height: 1.7; margin: 40px; color: #111; }
  h1 { font-size: 26px; letter-spacing: 0.2em; }
</style></head><body>
  <h1>BEGIN PATTERN</h1>
  <p>Sizes: XS (S, M, L) XL, 2XL [3XL, 4XL, 5XL] 6XL</p>
  <p>Using 5mm needles and with cc1, co 84 (84, 84, 88) 96, 96 [100, 100, 100] 104 sts. Join in the rnd.</p>
  <p>Rep rnd 1 until collar measures 8 (8, 8, 9) 9, 9 [9, 9, 9] 9 cm from co edge.</p>
  <p>After rnd 2, you have: 144 (156, 168, 192) 216, 228 [252, 276, 288] 300 sts.</p>
  <p>K the first 69 (80, 86, 100) 110, 118 [132, 142, 151] 160 sts for back of body.</p>
</body></html>`;

// A tab of its own, closed after: a tab left in front would stop another's
// painting (a hidden page gets no animation frames).
// Only the tab's id is taken from the answer, and only if it looks like one;
// the addresses are built here, so nothing in the answer can point elsewhere.
const DEVTOOLS = "localhost:9222";
const target = await (await fetch(`http://${DEVTOOLS}/json/new?about:blank`, { method: "PUT" })).json();
const tabId = String(target?.id ?? "");
if (!/^[A-Za-z0-9-]{1,64}$/.test(tabId)) throw new Error("The browser did not answer with a tab.");
const ws = new WebSocket(`ws://${DEVTOOLS}/devtools/page/${encodeURIComponent(tabId)}`);
// A dropped connection, or an answer that never comes, ends the script with
// a reason rather than leaving it waiting.
ws.onerror = () => {
  console.error("The DevTools connection failed.");
  process.exit(1);
};
let id = 0;
const pending = new Map();
let onLoad = () => {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Page.loadEventFired") onLoad();
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const within = (what, promise, ms = 30000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`No answer to ${what} in ${ms / 1000} s.`)), ms))]);
const send = (method, params = {}) => within(method, new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }));
await within("the connection", new Promise((r) => (ws.onopen = r)));
await send("Page.enable");
// Printed once the page has loaded and its font is ready, not after a guess.
const loaded = new Promise((r) => (onLoad = r));
await send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
await within("the page loading", loaded);
await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
const pdf = await send("Page.printToPDF", { paperWidth: 8.27, paperHeight: 11.69, printBackground: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
writeFileSync("public/fixtures/wide-sizes.pdf", Buffer.from(pdf.result.data, "base64"));
await fetch(`http://${DEVTOOLS}/json/close/${encodeURIComponent(tabId)}`);
console.log("public/fixtures/wide-sizes.pdf");
process.exit(0);
