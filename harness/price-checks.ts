/**
 * Checks for prices: what was typed read as a price, a wishlist price taken
 * as a ball's, a yarn's price a ball kept from the yarn form for every
 * colour and lot of it (by brand and name), or 100 g's for deadstock and
 * cone yarn, a pattern's
 * price from its form, the currency chosen in Settings, what the stash is
 * worth and what was spent in Statistics, and what a project cost on its
 * page (its yarn by the grams it takes, and its pattern; no tools).
 *
 * Run with the harness open:
 *   window.__priceChecks()
 */
import type { Pattern, Project, Wish, Yarn, YarnLot, YarnUse } from "../src/api";
import { money, parsePrice, pricePerBall, projectCost, spending, spentByMonth, stashWorth } from "../src/views/money";
import { yarnStart } from "../src/views/shopping";
import { byWeight, per100gOf, readPer100g } from "../src/views/yarn-weight";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

function pure(results: CheckResult[]): void {
  const read = (t: string) => parsePrice(t);
  check(results, "a price typed either way: 4,95 and 4.95", read("4,95") === 4.95 && read("4.95") === 4.95);
  check(results, "…with its currency and words around it", read("€4.95 a ball") === 4.95 && read("12 EUR") === 12 && read("CHF 7.-") === 7, `${read("€4.95 a ball")} ${read("12 EUR")} ${read("CHF 7.-")}`);
  check(results, "…thousands either way", read("1.234,50") === 1234.5 && read("1,234.50") === 1234.5 && read("1,000") === 1000, `${read("1.234,50")} ${read("1,234.50")} ${read("1,000")}`);
  check(results, "…and none when there is no number", read("free") === null && read("") === null);

  check(results, "a wishlist price for a ball is a ball's", pricePerBall("€4.95 a ball", 6) === 4.95 && pricePerBall("4,95/ball", 6) === 4.95 && pricePerBall("3.50 each", 4) === 3.5);
  check(results, "…else what was paid, shared over the balls", pricePerBall("29,70", 6) === 4.95 && pricePerBall("8", 1) === 8 && pricePerBall("8", 0) === 8, String(pricePerBall("29,70", 6)));
  const wish = (price: string, amount: string) => ({ id: "w", kind: "yarn", name: "Air, Off white", brand: "Drops", url: "", shopId: null, price, amount, notes: "", gotAt: null }) as unknown as Wish;
  check(results, "a yarn got from the wishlist starts its lot at a ball's price", yarnStart(wish("€4.95 a ball", "6 balls")).price === 4.95 && yarnStart(wish("29,70 €", "6 balls")).price === 4.95 && yarnStart(wish("", "6 balls")).price === null);

  // The stash: a yarn of whole balls and a weighed lot, one with no price, and a used-up yarn.
  const lot = (fields: Partial<YarnLot>): YarnLot => ({ id: "l", yarnId: "y", dyeLot: "", balls: 0, gramsLeft: 0, weighed: false, location: "", boughtAt: null, leftover: false, ...fields }) as YarnLot;
  const priced = (price: number | null) => ({ gaugeSts: 0, gaugeRows: 0, needleFrom: 0, needleTo: 0, care: [], price });
  const yarn = (fields: Partial<Yarn>): Yarn => ({ id: "y", brand: "Drops", name: "Air", colourway: "", gramsPerBall: 50, metresPerBall: 150, addedAt: new Date(2028, 0, 20).getTime(), usedUpAt: null, lots: [], details: priced(null), ...fields }) as unknown as Yarn;
  const yarns = [
    yarn({ id: "a", details: priced(4.95), lots: [lot({ id: "a1", balls: 3, boughtAt: new Date(2028, 2, 3).getTime() }), lot({ id: "a2", weighed: true, gramsLeft: 20 })] }),
    yarn({ id: "b", name: "Kid-Silk", lots: [lot({ id: "b1", balls: 2 })] }),
    yarn({ id: "c", name: "Gone", usedUpAt: 1, details: priced(10), lots: [lot({ id: "c1", balls: 5 })] }),
  ];
  const worth = stashWorth(yarns);
  check(results, "the stash's worth: whole balls at the yarn's price, a weighed lot by its share of a ball, used up yarn not", worth.worth === 16.83 && worth.unpriced === 1, JSON.stringify(worth));

  const patterns = [{ id: "p", title: "Riddari", price: 6.5, addedAt: new Date(2028, 1, 10).getTime() }, { id: "q", title: "Free one", price: null, addedAt: 0 }] as unknown as Pattern[];
  const spends = spending(yarns, patterns);
  check(results, "what was spent: each lot of a yarn with a price, dated when bought or else when the yarn was added, used up or not; patterns with one", spends.length === 3 && spends[0].amount === 14.85 && /Drops Air, 3 balls/.test(spends[0].name) && spends.some((s) => s.kind === "pattern" && s.amount === 6.5), JSON.stringify(spends));
  const months = spentByMonth(spends, new Date(2028, 2, 15).getTime());
  check(results, "…month by month for twelve, the oldest first", months.length === 12 && months[11].yarn === 14.85 && months[10].patterns === 6.5 && months[9].yarn === 50 && months[11].items.length === 1, JSON.stringify(months.slice(9).map((m) => [m.yarn, m.patterns])));

  const project = { id: "pr", patternId: "p", yarns: [{ id: "e1", yarnId: "a", yarnName: "Air", lotId: "a1", plannedGrams: 100 }, { id: "e2", yarnId: "b", yarnName: "Kid-Silk", lotId: null, plannedGrams: 25 }] } as unknown as Project;
  const planned = projectCost(project, yarns, patterns, []);
  check(results, "a project's cost: the grams it plans at the yarn's price a ball, and its pattern", planned.yarn === 9.9 && planned.pattern === 6.5 && planned.total === 16.4 && planned.unknown.join() === "Kid-Silk", JSON.stringify(planned));
  const used = [{ projectId: "pr", yarnId: "a", grams: 150, source: "finished" }] as unknown as YarnUse[];
  check(results, "…what it used, once finished, before what it planned", projectCost(project, yarns, patterns, used).yarn === 14.85);

  // Deadstock and cone yarn: the price is for 100 g. Two cones of 500 g, one
  // started (320 g left), and a lot bought by weight with no cones counted.
  const soldByWeight = (price: number | null) => ({ ...priced(price), deadstock: true });
  const cones = [
    yarn({ id: "d", name: "Cashmere 2/28", gramsPerBall: 500, metresPerBall: 7000, details: soldByWeight(8), lots: [lot({ id: "d1", balls: 2, boughtAt: new Date(2028, 2, 5).getTime() }), lot({ id: "d2", balls: 1, weighed: true, gramsLeft: 320 })] }),
    yarn({ id: "e", name: "Merino ends", gramsPerBall: 0, metresPerBall: 0, details: soldByWeight(5.5), lots: [lot({ id: "e1", weighed: true, gramsLeft: 400 })] }),
  ];
  const coneWorth = stashWorth(cones);
  check(results, "deadstock is worth its grams at its price per 100 g: 1000 g + 320 g + 400 g", coneWorth.worth === 80 + 25.6 + 22 && coneWorth.unpriced === 0, JSON.stringify(coneWorth));
  const coneSpends = spending(cones, []);
  check(results, "…it cost its cones by their weight, or the grams bought by weight", coneSpends.some((s) => s.amount === 80 && /2 balls/.test(s.name)) && coneSpends.some((s) => s.amount === 40) && coneSpends.some((s) => s.amount === 22 && /400 g/.test(s.name)), JSON.stringify(coneSpends));
  const coneProject = { id: "pc", patternId: null, yarns: [{ id: "e3", yarnId: "e", yarnName: "Merino ends", lotId: null, plannedGrams: 250 }] } as unknown as Project;
  const coneCost = projectCost(coneProject, cones, [], []);
  check(results, "…and a project takes it by the grams, with no weight per ball needed", coneCost.yarn === 13.75 && !coneCost.unknown.length, JSON.stringify(coneCost));
  check(results, "deadstock's metres per 100 g read from a figure or a count: 700, 2/1400, 2/28", readPer100g("700") === 700 && readPer100g("2/1400") === 700 && readPer100g("2/28") === 1400 && readPer100g("") === 0 && readPer100g("lots") === null);
  check(results, "…kept per ball: a 500 g cone, or 100 g when bought by weight; and read back", JSON.stringify(byWeight(700, 500)) === '{"metresPerBall":3500,"gramsPerBall":500}' && JSON.stringify(byWeight(700, 0)) === '{"metresPerBall":700,"gramsPerBall":100}' && per100gOf({ metresPerBall: 3500, gramsPerBall: 500 }) === 700 && byWeight(0, 0).gramsPerBall === 0);
  check(results, "a wishlist price per 100 g starts the yarn as deadstock, at that price", yarnStart(wish("€8,50 / 100 g", "500 g")).price === 8.5 && yarnStart(wish("12.90 per 100g", "")).deadstock === true && yarnStart(wish("12.90 per 100g", "")).price === 12.9 && !yarnStart(wish("€4.95 a ball", "6 balls")).deadstock);
}

export async function verifyPrices() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { currency?: string; yarns: Yarn[]; patterns: Pattern[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
  const screen = () => document.querySelector<HTMLElement>(".library, .stash, .projects, .project-page")!;
  const before = { currency: store.currency };
  const pattern = store.patterns.find((p) => !(p as { removedAt?: number }).removedAt)!;
  const was = { price: pattern.price, addedAt: pattern.addedAt };
  let yarnId = "";
  let otherColour = "";
  let coneId = "";
  let projectId = "";

  try {
    pure(results);

    // ---------- the currency, in Settings ----------
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    store.currency = "EUR";
    screen().dispatchEvent(new CustomEvent("open-settings", { bubbles: true }));
    await waitFor(() => !!modal()?.querySelector('[data-f="currency"]') && modal()!.querySelector<HTMLSelectElement>('[data-f="currency"]')!.value === "EUR", "the settings");
    const currency = modal()!.querySelector<HTMLSelectElement>('[data-f="currency"]')!;
    check(results, "Settings offer currencies, the euro first", currency.options[0].value === "EUR" && [...currency.options].some((o) => o.value === "GBP") && currency.options.length >= 10);
    currency.value = "GBP";
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !modal(), "settings saved");
    check(results, "…and the one chosen is kept", store.currency === "GBP", String(store.currency));

    // ---------- a yarn's price a ball, from the yarn form ----------
    tab("stash");
    await waitFor(() => !!document.querySelector('.stash [data-act="add"]'), "the stash");
    const addYarn = async () => {
      document.querySelector<HTMLElement>('.stash [data-act="add"]')!.click();
      await waitFor(() => !!modal()?.querySelector('.yarn-price [data-f="price"]'), "the yarn form");
    };
    const set = (sel: string, value: string) => {
      const el = modal()!.querySelector<HTMLInputElement>(sel);
      if (!el) throw new Error(`no field ${sel} in the yarn form`);
      el.value = value;
    };
    const listed = () => invoke<Yarn[]>("list_yarns", { filter: { used: "all" } });
    await addYarn();
    check(results, "a lot row has no price of its own: the yarn has one, a ball's", !modal()!.querySelector('.lot-row [data-lf="price"]') && /Price a ball/.test(modal()!.querySelector(".yarn-price")!.textContent ?? ""));
    set('[data-f="name"]', "Price Check");
    set('[data-f="brand"]', "Drops");
    set('[data-f="colourway"]', "Rust");
    set('[data-f="yarnWeight"]', "DK");
    set('[data-f="metresPerBall"]', "150");
    set('[data-f="gramsPerBall"]', "50");
    set('.lot-row [data-lf="balls"]', "3");
    set('[data-f="price"]', "4,95 a ball");
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    const added = () => store.yarns.find((y) => y.name === "Price Check");
    await waitFor(() => !!added() && !modal(), "the yarn added");
    yarnId = added()!.id;
    const kept = (await listed()).find((y) => y.id === yarnId)?.details;
    check(results, "the yarn's price a ball is kept, typed with a comma and words", kept?.price === 4.95, JSON.stringify(kept));

    // Another colour of it starts at that price; changed there, it changes for both.
    await addYarn();
    set('[data-f="name"]', "Price Check");
    // The stash's yarns come in just after the form opens: the name is
    // picked again until they have.
    const priceNow = () => modal()!.querySelector<HTMLInputElement>('[data-f="price"]')!.value;
    await waitFor(() => {
      modal()!.querySelector('[data-f="name"]')!.dispatchEvent(new Event("change", { bubbles: true }));
      return priceNow() !== "";
    }, "the yarn known", 3000).catch(() => {});
    const start = priceNow();
    check(results, "another colour of the yarn starts at its price a ball", start === "4.95", start);
    set('[data-f="colourway"]', "Moss");
    set('[data-f="price"]', "5.20");
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => store.yarns.filter((y) => y.name === "Price Check").length === 2 && !modal(), "the second colour");
    otherColour = store.yarns.find((y) => y.name === "Price Check" && y.id !== yarnId)!.id;
    const both = (await listed()).filter((y) => y.name === "Price Check").map((y) => y.details?.price);
    check(results, "…and a new price on one colour is every colour's", both.length === 2 && both.every((x) => x === 5.2), JSON.stringify(both));
    // The first colour stays, at 5.20, for Statistics and the project.
    await invoke("delete_yarn", { id: otherColour });
    otherColour = "";

    // ---------- deadstock and cone yarn: a price per 100 g ----------
    await addYarn();
    set('[data-f="name"]', "Cone Check");
    set('[data-f="metresPerBall"]', "3500");
    set('[data-f="gramsPerBall"]', "500");
    set('.lot-row [data-lf="balls"]', "2");
    const figureLabels = () => [...modal()!.querySelectorAll('[data-el="metres-label"], [data-el="grams-label"]')].map((e) => e.textContent).join(" / ");
    const box = modal()!.querySelector<HTMLInputElement>('[data-f="deadstock"]');
    check(results, "the yarn form has a deadstock or cone yarn box, not ticked", !!box && !box.checked && /Deadstock or cone yarn/.test(box.closest("label")!.textContent ?? ""));
    box!.checked = true;
    box!.dispatchEvent(new Event("input", { bubbles: true }));
    const label = modal()!.querySelector('[data-el="price-label"]')!.textContent;
    check(results, "…ticked, the price is said per 100 g", label === "Price per 100 g" && /grams/.test(modal()!.querySelector('[data-el="price-hint"]')!.textContent ?? ""), String(label));
    const metresNow = () => modal()!.querySelector<HTMLInputElement>('[data-f="metresPerBall"]')!.value;
    check(results, "…and the figures are metres per 100 g and a cone's grams, what was typed turned: 3500 m a 500 g ball is 700", figureLabels() === "Metres per 100 g / Grams per cone" && metresNow() === "700", `${figureLabels()} ${metresNow()}`);
    const weightField = modal()!.querySelector<HTMLInputElement>('[data-f="yarnWeight"]')!;
    set('[data-f="metresPerBall"]', "");
    weightField.value = "2/1400";
    weightField.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…a count typed as the weight fills them in: 2/1400 is 700 m/100 g", metresNow() === "700" && /700 m\/100 g: Lace/.test(modal()!.querySelector('[data-el="weight-hint"]')!.textContent ?? ""), `${metresNow()} ${modal()!.querySelector('[data-el="weight-hint"]')!.textContent}`);
    set('[data-f="metresPerBall"]', "2/28");
    modal()!.querySelector('[data-f="metresPerBall"]')!.dispatchEvent(new Event("input", { bubbles: true }));
    const countHint = modal()!.querySelector('[data-el="weight-hint"]')!.textContent ?? "";
    check(results, "…and a count typed there is read: 2/28 is 1 400 m/100 g, a 500 g cone 7 000 m", /2\/28 is about 1 400 m\/100 g/.test(countHint) && /500 g cone is about 7 000 m/.test(countHint), countHint);
    set('[data-f="price"]', "8,50");
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !!store.yarns.find((y) => y.name === "Cone Check") && !modal(), "the cone yarn added");
    coneId = store.yarns.find((y) => y.name === "Cone Check")!.id;
    const cone = (await listed()).find((y) => y.id === coneId)?.details;
    const coneYarn = (await listed()).find((y) => y.id === coneId);
    check(results, "…and kept: deadstock, 8.50 per 100 g", cone?.deadstock === true && cone.price === 8.5, JSON.stringify(cone));
    check(results, "…its 2/28 on 500 g cones kept as 7 000 m a cone", coneYarn?.metresPerBall === 7000 && coneYarn.gramsPerBall === 500, JSON.stringify([coneYarn?.metresPerBall, coneYarn?.gramsPerBall]));
    const coneCard = document.querySelector(`.stash [data-open="${coneId}"] .yarn-deadstock`)?.textContent;
    check(results, "…and its card says deadstock and its metres per 100 g", coneCard === "Deadstock · 1 400 m/100 g", String(coneCard));
    await addYarn();
    set('[data-f="name"]', "Cone Check");
    const coneLabel = () => modal()!.querySelector('[data-el="price-label"]')!.textContent;
    await waitFor(() => {
      modal()!.querySelector('[data-f="name"]')!.dispatchEvent(new Event("change", { bubbles: true }));
      return priceNow() !== "";
    }, "the cone yarn known", 3000).catch(() => {});
    check(results, "…another colour of it starts as deadstock at that price", priceNow() === "8.5" && coneLabel() === "Price per 100 g" && modal()!.querySelector<HTMLInputElement>('[data-f="deadstock"]')!.checked, `${priceNow()} ${coneLabel()}`);
    const gramsNow = () => modal()!.querySelector<HTMLInputElement>('[data-f="gramsPerBall"]')!.value;
    check(results, "…with its metres per 100 g and its cone", metresNow() === "1400" && gramsNow() === "500" && figureLabels() === "Metres per 100 g / Grams per cone", `${metresNow()} ${gramsNow()} ${figureLabels()}`);
    const box2 = modal()!.querySelector<HTMLInputElement>('[data-f="deadstock"]')!;
    box2.checked = false;
    box2.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…unticked, the figures are a ball's again: 7 000 m, 500 g", metresNow() === "7000" && gramsNow() === "500" && figureLabels() === "Metres per ball / Grams per ball", `${metresNow()} ${gramsNow()}`);
    modal()!.querySelector<HTMLElement>('[data-act="cancel"]')!.click();
    await waitFor(() => !modal(), "the form closed");

    // ---------- a pattern's price, from its form ----------
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    pattern.addedAt = Date.now();
    screen().dispatchEvent(new CustomEvent("edit-pattern-here", { bubbles: true, detail: { ...pattern, price: null } }));
    await waitFor(() => !!modal()?.querySelector('[data-f="price"]'), "the pattern's form");
    modal()!.querySelector<HTMLInputElement>('[data-f="price"]')!.value = "abc";
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !!modal()?.querySelector('[data-el="error"]:not([hidden])') || !modal(), "the answer");
    check(results, "a pattern's price that is no number is refused, saying so", !!modal() && /The price is a number/.test(modal()!.textContent ?? ""), modal()?.textContent?.slice(0, 200) ?? "closed");
    modal()!.querySelector<HTMLInputElement>('[data-f="price"]')!.value = "6,50";
    modal()!.querySelector<HTMLElement>('[data-act="save"]')!.click();
    await waitFor(() => !modal(), "the pattern saved");
    check(results, "…and one that is, kept to the cent", store.patterns.find((p) => p.id === pattern.id)!.price === 6.5, String(store.patterns.find((p) => p.id === pattern.id)!.price));

    // ---------- Statistics ----------
    tab("stash");
    await waitFor(() => !!document.querySelector('.lib-title [data-mode="stats"]'), "the stash");
    document.querySelector<HTMLElement>('.lib-title [data-mode="stats"]')!.click();
    await waitFor(() => !!document.querySelector('.stash-stats [data-el="worth"]'), "the statistics");
    const yarns = await invoke<Yarn[]>("list_yarns", { filter: { used: "all" } }).catch(() => store.yarns);
    const worthTile = document.querySelector('[data-el="worth"]')!.textContent!.replace(/\s+/g, " ");
    check(results, "Statistics say what the stash is worth, in the currency chosen", worthTile.includes(money(stashWorth(yarns).worth, "GBP")) && worthTile.includes("£"), worthTile);
    const spentTile = document.querySelector('[data-el="spent"]')!.textContent!.replace(/\s+/g, " ");
    check(results, "…and what was spent in twelve months, on yarn and on patterns", /on yarn/.test(spentTile) && spentTile.includes(money(6.5, "GBP")), spentTile);
    const month = document.querySelector('[data-el="spent-month"]')!.textContent!.replace(/\s+/g, " ");
    check(results, "…this month's buying listed: the lot, and the pattern", /Drops Price Check \(Rust\), 3 balls/.test(month) && month.includes(money(15.6, "GBP")) && month.includes(pattern.title), month);
    check(results, "…and a Spent column in the months' table", [...document.querySelectorAll(".usage-table th")].some((th) => th.textContent === "Spent"));

    // ---------- a project's cost ----------
    const other = (await listed()).find((y) => y.id !== yarnId && !y.usedUpAt && y.details?.price == null)!;
    const p = await invoke<Project>("add_project", {
      input: { name: "Priced cowl", patternId: pattern.id, notes: "", startedAt: null, toolIds: [], yarns: [{ id: null, yarnId, lotId: null, plannedGrams: 100 }, { id: null, yarnId: other.id, lotId: null, plannedGrams: 20 }] },
    });
    projectId = p.id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector<HTMLElement>(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: p.id }));
    await waitFor(() => !!document.querySelector('.project-page [data-el="cost"]'), "the project's cost");
    const cost = document.querySelector<HTMLElement>(".project-cost-field")!.textContent!.replace(/\s+/g, " ");
    check(results, "a project's page says what it cost: 2 balls' worth and the pattern", document.querySelector('[data-el="cost"] b')?.textContent === money(16.9, "GBP") && cost.includes(money(10.4, "GBP")) && cost.includes(money(6.5, "GBP")), cost);
    check(results, "…and which yarn it could not count", new RegExp(`Not counted.*${other.name}`).test(cost), cost);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"]')?.click();
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    if (yarnId) await invoke("delete_yarn", { id: yarnId }).catch(() => {});
    if (otherColour) await invoke("delete_yarn", { id: otherColour }).catch(() => {});
    if (coneId) await invoke("delete_yarn", { id: coneId }).catch(() => {});
    const kept = store.patterns.find((x) => x.id === pattern.id);
    if (kept) Object.assign(kept, was);
    store.currency = before.currency;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__priceChecks = verifyPrices;
