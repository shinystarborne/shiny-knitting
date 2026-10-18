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
const target = await (await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send("Page.enable");
await send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
await new Promise((r) => setTimeout(r, 1500));
const pdf = await send("Page.printToPDF", { paperWidth: 8.27, paperHeight: 11.69, printBackground: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
writeFileSync("public/fixtures/wide-sizes.pdf", Buffer.from(pdf.result.data, "base64"));
await fetch(`http://localhost:9222/json/close/${target.id}`);
console.log("public/fixtures/wide-sizes.pdf");
process.exit(0);
