/**
 * Checks for the yarn stash tab.
 *
 * These run against the live, stubbed app rather than pure functions: the
 * point of the feature is the wiring — the tab bar, the cards and their
 * derived quantities, the form with its lot rows, the family filter, and the
 * remove confirm — so the checks click the real UI and read the real grid.
 *
 * The expected quantities are computed from the seed data the same way the
 * backend derives them (weighed grams, metres scaled by the ball band), so a
 * card that adds up its own numbers differently is caught.
 *
 * Run with the harness open:
 *   window.__yarnStashChecks()
 */

function check(results, name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, what, timeoutMs = 15000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

/** The derived figures the backend would send for a stored yarn. */
function expectedTotals(yarn) {
  const gramsLeft = yarn.lots.reduce((n, l) => n + (l.gramsLeft || 0), 0);
  const balls = yarn.lots.reduce((n, l) => n + (l.balls || 0), 0);
  const metres =
    yarn.gramsPerBall > 0 && yarn.metresPerBall > 0
      ? Math.round((gramsLeft / yarn.gramsPerBall) * yarn.metresPerBall)
      : 0;
  return { gramsLeft, balls, metres };
}

function qtyLine(yarn) {
  const t = expectedTotals(yarn);
  return `${t.balls} × ${yarn.gramsPerBall} g · ${t.gramsLeft} g left · ~${t.metres} m`;
}

export async function verifyYarnStash() {
  const results = [];
  const store = window.__store;

  const tab = (name) => {
    const btn = document.querySelector(`.tab-bar [data-tab="${name}"]`);
    if (!btn) throw new Error(`no ${name} tab in the tab bar`);
    btn.click();
  };
  const cards = () => [...document.querySelectorAll(".stash .card")];
  const cardFor = (id) => document.querySelector(`.stash .card[data-open="${id}"]`);
  const qtyOf = (id) => cardFor(id)?.querySelector(".card-qty")?.textContent || "";
  const lotsOf = (id) => cardFor(id)?.querySelector(".card-lots")?.textContent || "";
  const modal = () => document.querySelector(".modal-backdrop:not(.hidden) .modal");
  const saveModal = () => {
    const btn = modal()?.querySelector('[data-act="save"]');
    if (!btn) throw new Error("no Save button in the yarn form");
    btn.click();
  };

  try {
    // --- the Stash tab shows the seeded yarns with derived quantities ---
    tab("stash");
    await waitFor(() => document.querySelector(".stash h1")?.textContent === "Stash", "the stash view");
    await waitFor(() => cards().length > 0, "the yarn cards");

    check(
      results,
      "the stash tab shows every seeded yarn",
      cards().length === store.yarns.length,
      `${cards().length} cards, ${store.yarns.length} seeded`,
    );

    const y2 = store.yarns.find((y) => y.id === "y2");
    check(
      results,
      "a partial lot shows weighed grams and derived metres",
      qtyOf("y2") === qtyLine(y2),
      `got "${qtyOf("y2")}", want "${qtyLine(y2)}"`,
    );
    check(
      results,
      "metres come from grams left, not balls bought",
      expectedTotals(y2).metres === 528 && y2.lots[0].balls * y2.metresPerBall === 880,
      `${JSON.stringify(expectedTotals(y2))}`,
    );
    check(
      results,
      "a yarn bought twice says 2 lots",
      lotsOf("y1") === "2 lots",
      lotsOf("y1"),
    );

    // --- back to Patterns: the shell survives the swap ---
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash)"), "the library");
    check(
      results,
      "the Patterns tab brings the library back",
      !!document.querySelector(".library:not(.stash) .results"),
    );
    check(
      results,
      ".screen keeps its class across tab switches",
      document.querySelector(".screen")?.className === "screen",
      document.querySelector(".screen")?.className,
    );
    const layout = await window.__layoutChecks();
    check(
      results,
      "layout checks still pass after tab switching",
      layout.ok,
      layout.failed.join("; "),
    );

    // --- add a yarn through the real form ---
    tab("stash");
    await waitFor(() => !!document.querySelector('.stash [data-act="add"]'), "the add button");
    document.querySelector('.stash [data-act="add"]').click();
    await waitFor(() => !!modal()?.querySelector('[data-f="name"]'), "the yarn form");
    check(
      results,
      "a new yarn starts with one empty lot row",
      modal().querySelectorAll(".lot-row").length === 1,
      `${modal().querySelectorAll(".lot-row").length} rows`,
    );

    const set = (sel, value) => {
      const el = modal().querySelector(sel);
      if (!el) throw new Error(`no field ${sel} in the yarn form`);
      el.value = value;
    };
    set('[data-f="name"]', "Mohair Silk");
    set('[data-f="brand"]', "Drops");
    set('[data-f="yarnWeight"]', "Lace");
    set('[data-f="metresPerBall"]', "210");
    set('[data-f="gramsPerBall"]', "25");
    const lotRow = modal().querySelector(".lot-row");
    lotRow.querySelector('[data-lf="balls"]').value = "3";
    lotRow.querySelector('[data-lf="gramsLeft"]').value = "60";
    saveModal();

    const added = () => store.yarns.find((y) => y.name === "Mohair Silk");
    await waitFor(() => added() && cardFor(added().id), "the new yarn card");
    check(
      results,
      "an added yarn appears with its quantities",
      qtyOf(added().id) === qtyLine(added()),
      `got "${qtyOf(added().id)}", want "${qtyLine(added())}"`,
    );

    // --- editing grams left moves the metres line ---
    cardFor(added().id).click();
    await waitFor(
      () => modal()?.querySelector('[data-f="name"]')?.value === "Mohair Silk",
      "the edit form",
    );
    check(
      results,
      "the edit form shows the existing lot",
      modal().querySelectorAll(".lot-row").length === 1,
      `${modal().querySelectorAll(".lot-row").length} rows`,
    );
    modal().querySelector('.lot-row [data-lf="gramsLeft"]').value = "30";
    saveModal();
    await waitFor(() => qtyOf(added().id).includes("30 g left"), "the updated quantities");
    // 30 g of a 25 g / 210 m ball is 252 m.
    check(
      results,
      "editing grams left updates the metres line",
      qtyOf(added().id) === "3 × 25 g · 30 g left · ~252 m",
      qtyOf(added().id),
    );

    // --- the family filter shows only its yarns ---
    const laceBox = () =>
      document.querySelector('.stash [data-filter="yarnWeight"][value="lace"]');
    await waitFor(() => !!laceBox(), "the lace facet");
    laceBox().click();
    await waitFor(
      () => cards().length === 1 && cards()[0].dataset.open === added().id,
      "the filtered grid",
    );
    check(
      results,
      "ticking a family filters to its yarns",
      cards().length === 1 && cards()[0].dataset.open === added().id,
      `${cards().length} cards`,
    );
    laceBox().click();
    await waitFor(() => cards().length === store.yarns.length, "the unfiltered grid");
    check(
      results,
      "unticking brings every yarn back",
      cards().length === store.yarns.length,
      `${cards().length} cards, ${store.yarns.length} in store`,
    );

    // --- a second lot is first-class ---
    cardFor(added().id).click();
    await waitFor(
      () => modal()?.querySelector('[data-f="name"]')?.value === "Mohair Silk",
      "the edit form",
    );
    modal().querySelector('[data-act="add-lot"]').click();
    check(
      results,
      "Add lot adds a row",
      modal().querySelectorAll(".lot-row").length === 2,
      `${modal().querySelectorAll(".lot-row").length} rows`,
    );
    const rows = modal().querySelectorAll(".lot-row");
    rows[1].querySelector('[data-lf="dyeLot"]').value = "B9";
    rows[1].querySelector('[data-lf="balls"]').value = "1";
    rows[1].querySelector('[data-lf="gramsLeft"]').value = "25";
    saveModal();
    await waitFor(() => lotsOf(added().id) === "2 lots", "the second lot");
    const dyeLots = () => added().lots.map((l) => l.dyeLot).sort().join(",");
    check(
      results,
      "the card counts both lots",
      lotsOf(added().id) === "2 lots",
      lotsOf(added().id),
    );
    check(
      results,
      "the second lot kept its own dye lot",
      added().lots.length === 2 && dyeLots() === ",B9",
      `${added().lots.length} lots, dye lots "${dyeLots()}"`,
    );
    // 30 + 25 = 55 g of a 25 g / 210 m ball is 462 m, over 4 balls.
    check(
      results,
      "the totals add up over both lots",
      qtyOf(added().id) === "4 × 25 g · 55 g left · ~462 m",
      qtyOf(added().id),
    );

    // --- removing asks first, and the yarn stays gone ---
    const removedId = added().id;
    const before = store.yarns.length;
    cardFor(removedId).querySelector("[data-delete]").click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm dialog");
    check(
      results,
      "removing asks first, and says the photo goes too",
      (document.querySelector(".dialog-card .dialog-message")?.textContent || "").includes("photo"),
      document.querySelector(".dialog-card .dialog-message")?.textContent,
    );
    const confirm = [...document.querySelectorAll(".dialog-card button")].find(
      (b) => b.textContent === "Remove",
    );
    if (!confirm) throw new Error("no Remove button in the confirm dialog");
    confirm.click();
    await waitFor(() => !store.yarns.some((y) => y.id === removedId), "the removal");
    check(
      results,
      "the yarn is gone from the grid and the store",
      !cardFor(removedId) && store.yarns.length === before - 1,
      `${store.yarns.length} in store, was ${before}`,
    );

    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash)"), "the library");
    tab("stash");
    await waitFor(() => cards().length === store.yarns.length, "the stash again");
    check(
      results,
      "still gone after switching tabs and back",
      !cardFor(removedId) && !store.yarns.some((y) => y.id === removedId),
      `card ${!!cardFor(removedId)}`,
    );

    // --- the fibres are the yarn's, whatever its colour ---
    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    const colour = (colourway, fibres, superwash) =>
      invoke("add_yarn", { input: { name: "Merino Extra Fine", brand: "Drops", colourway, yarnWeight: "Worsted", metresPerBall: 105, gramsPerBall: 50, notes: "", fibres, superwash, lots: [] } });
    const wool = [{ name: "wool", percent: 100 }];
    const nebel = await colour("37 Nebelwald", wool, true);
    const red = await colour("11 Red", [], false);
    const blue = await colour("21 Blue", [], false);
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash)"), "the library");
    tab("stash");
    await waitFor(() => !!cardFor(blue.id), "the new colours");
    const fibreNames = () => [...modal().querySelectorAll("[data-fibre-name]")].map((i) => i.value).filter(Boolean);
    const shareLabel = () => modal().querySelector('[data-el="share-fibres"]');

    cardFor(red.id).click();
    await waitFor(() => !!modal() && fibreNames().length > 0, "the fibres filled in from another colour");
    check(
      results,
      "editing a colour with no fibres fills them in from another colour of the yarn",
      fibreNames().join() === "wool" && modal().querySelector('[data-f="superwash"]').checked &&
        /Filled in the fibres from your Merino Extra Fine \(37 Nebelwald\)/.test(modal().querySelector('[data-el="known-hint"]').textContent),
      `${fibreNames()} / ${modal().querySelector('[data-el="known-hint"]').textContent}`,
    );
    check(
      results,
      "…and offers to give the colours still without them the same",
      !shareLabel().hidden && shareLabel().textContent.includes("Give the other colour of Drops Merino Extra Fine the same fibre content"),
      shareLabel().hidden ? "hidden" : shareLabel().textContent,
    );
    modal().querySelector('[data-act="save"]').click();
    await waitFor(() => !modal(), "the save");
    const stored = (id) => store.yarns.find((y) => y.id === id);
    check(
      results,
      "saved, every colour has the fibres and superwash",
      [red.id, blue.id].every((id) => stored(id).fibres.map((f) => `${f.name} ${f.percent}`).join() === "wool 100" && stored(id).superwash),
      JSON.stringify([stored(red.id), stored(blue.id)].map((y) => [y.fibres, y.superwash])),
    );

    cardFor(nebel.id).click();
    await waitFor(() => !!modal() && fibreNames().length > 0, "the form");
    // The other colours load after the form opens.
    await wait(300);
    check(results, "with every colour alike, nothing is offered", shareLabel().hidden);
    modal().querySelector('[data-f="superwash"]').click();
    check(results, "a change to one offers it to the others", !shareLabel().hidden && shareLabel().textContent.includes("the 2 other colours"), shareLabel().textContent);
    modal().querySelector('[data-f="shareFibres"]').click();
    modal().querySelector('[data-act="save"]').click();
    await waitFor(() => !modal(), "the save");
    check(results, "…and unticked, only that colour changes", !stored(nebel.id).superwash && stored(red.id).superwash && stored(blue.id).superwash);

    // A new colour takes the fibres from whichever colour has them, not only the newest.
    store.yarns.find((y) => y.id === blue.id).fibres = [];
    store.yarns.find((y) => y.id === blue.id).addedAt = Date.now() + 1000;
    document.querySelector('.stash [data-act="add"]').click();
    await waitFor(() => !!modal(), "the add form");
    const name = modal().querySelector('[data-f="name"]');
    modal().querySelector('[data-f="brand"]').value = "Drops";
    await wait(300);
    name.value = "Merino Extra Fine";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.dispatchEvent(new Event("change", { bubbles: true }));
    check(
      results,
      "a new colour takes the fibres from a colour that has them, though the newest has none",
      fibreNames().join() === "wool" && modal().querySelector('[data-f="metresPerBall"]').value === "105",
      `${fibreNames()} / ${modal().querySelector('[data-f="metresPerBall"]').value}`,
    );
    modal().querySelector('[data-act="cancel"]')?.click();
    if (modal()) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    store.yarns = store.yarns.filter((y) => ![nebel.id, red.id, blue.id].includes(y.id));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err && err.message) || err));
  } finally {
    // The app boots to the library, and the other suites expect to find it
    // there, so leave it on the Patterns tab.
    document.querySelector('.tab-bar [data-tab="patterns"]')?.click();
    await waitFor(() => !!document.querySelector(".library:not(.stash)"), "the library", 5000).catch(
      () => {},
    );
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`),
  };
}

if (typeof window !== "undefined") {
  window.__yarnStashChecks = verifyYarnStash;
}
