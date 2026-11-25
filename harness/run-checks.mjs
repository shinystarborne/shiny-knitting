// Minimal CDP driver: runs the harness check functions in the open tab, and
// exits 1 when any fails, is missing, throws or hangs, or the page reports
// errors -- so a failing check fails the run.
import { CHECKS } from "./check-names.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Longer than any suite takes; one that runs past it has hung. */
const SUITE_MS = Number(process.env.SUITE_MS ?? 180000);

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://localhost:9222/json");
      const list = await res.json();
      const page = list.find(
        (t) => t.type === "page" && t.url.includes("harness/index.html"),
      );
      if (page) return page;
    } catch {}
    await wait(500);
  }
  throw new Error("no harness page found");
}

async function main() {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onerror = () => {
    console.error("The DevTools connection failed.");
    process.exit(1);
  };
  ws.onclose = () => {
    console.error("The DevTools connection closed.");
    process.exit(1);
  };
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("Page.enable");
  // Headless, the window never has focus; checks that leave a field need it.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: "http://localhost:1422/harness/index.html" });
  await wait(4000); // let the app boot

  // An exception in the page is thrown here; an answer that never comes, too.
  const evalJs = async (expr, ms = SUITE_MS) => {
    let timer;
    const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms)));
    const res = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), timeout]).finally(() => clearTimeout(timer));
    const thrown = res.result?.exceptionDetails;
    if (thrown) throw new Error(thrown.exception?.description ?? thrown.text ?? "an exception");
    return res.result?.result?.value;
  };

  // wait for the app to render
  for (let i = 0; i < 20; i++) {
    const ready = await evalJs("!!document.querySelector('#app')?.children.length", 5000).catch(() => false);
    if (ready) break;
    await wait(500);
  }

  const failures = [];
  for (const name of CHECKS) {
    const exists = await evalJs(`typeof window.${name}`);
    if (exists !== "function") {
      console.log(`${name}: NOT PRESENT (${exists})`);
      failures.push(`${name}: not on the page`);
      continue;
    }
    let out;
    try {
      out = await evalJs(`window.${name}()`);
    } catch (err) {
      console.log(`\n===== ${name} =====\nthrew: ${err.message}`);
      failures.push(`${name}: ${err.message}`);
      continue;
    }
    console.log(`\n===== ${name} =====`);
    console.log(JSON.stringify(out, null, 2));
    if (!out || out.ok === false) failures.push(`${name}: ${(out?.failed ?? ["no result"]).join("; ")}`);
  }
  // Serialised in the page, so an empty list and "nothing collected" are not
  // mangled by the result coercion in evalJs.
  // The browser's own notice that a resize was put off a frame is not an error.
  const errors = await evalJs("JSON.stringify((window.__errors || []).filter((e) => !/^ResizeObserver loop/.test(e)))");
  if (errors && errors !== "[]") {
    console.log("harness errors:", errors);
    failures.push(`page errors: ${errors}`);
  }
  if (failures.length) console.log(`\n${failures.length} failing:\n  ${failures.join("\n  ")}`);
  ws.onclose = null;
  ws.close();
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
