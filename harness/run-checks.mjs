// Minimal CDP driver: runs the harness check functions in the open tab.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await send("Page.navigate", { url: "http://localhost:1422/harness/index.html" });
  await wait(4000); // let the app boot

  const evalJs = async (expr) => {
    const res = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    return res.result?.result?.value ?? res.result;
  };

  // wait for the app to render
  for (let i = 0; i < 20; i++) {
    const ready = await evalJs("!!document.querySelector('#app').children.length");
    if (ready) break;
    await wait(500);
  }

  for (const name of ["__layoutChecks", "__rowChecks", "__annotationChecks", "__bulkAddChecks", "__updateChecks", "__yarnStashChecks", "__toolChecks", "__projectChecks", "__yarnWeightChecks", "__needleSizeChecks", "__shoppingChecks", "__peopleChecks", "__swatchChecks", "__calculatorChecks", "__logChecks", "__chartChecks", "__stashHistoryChecks", "__savePagesChecks", "__planChecks", "__galleryChecks", "__counterProjectChecks", "__backupChecks", "__binChecks", "__uploadChecks", "__chartLineChecks", "__cropChecks", "__pinFrontChecks", "__zoomChecks", "__pageModeChecks", "__themeChecks", "__besideChecks", "__markMoveChecks", "__eraserChecks", "__textMarkChecks", "__openExternalChecks", "__missingFileChecks", "__booksChecks", "__cheatsheetsChecks", "__projectChartChecks"]) {
    const exists = await evalJs(`typeof window.${name}`);
    if (exists !== "function") {
      console.log(`${name}: NOT PRESENT (${exists})`);
      continue;
    }
    const out = await evalJs(`window.${name}()`);
    console.log(`\n===== ${name} =====`);
    console.log(JSON.stringify(out, null, 2));
  }
  // Serialised in the page, so an empty list and "nothing collected" are not
  // mangled by the result coercion in evalJs.
  const errors = await evalJs("JSON.stringify(window.__errors || [])");
  if (errors && errors !== "[]") console.log("harness errors:", errors);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
