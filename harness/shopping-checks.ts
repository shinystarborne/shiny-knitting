/**
 * Checks for the Wishlist and Shops tabs.
 *
 * Two halves, as the needles and hooks checks: the search, filter and
 * link-to-shop functions, checked directly against the seed, and the wiring
 * -- the tabs, the cards, Got it, the forms, a pasted link picking its shop,
 * a shop added from the wishlist form, and a shop's count going to the
 * wishlist filtered to it -- clicked through on the live, stubbed app.
 *
 * Run with the harness open:
 *   window.__shoppingChecks()
 */
import type { Shop, Wish } from "../src/api";
import { ballsIn, filterShops, filterWishes, shopForUrl, shopTagFacets, siteOf, toolStart, wishFacets, yarnStart } from "../src/views/shopping";
import { withoutBrand } from "../src/views/wish-form";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, condition: unknown, detail = ""): void {
  results.push({ name, ok: !!condition, detail: condition ? "" : detail });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

type Store = {
  projects: { id: string; name: string; status: string }[];
  shops: { id: string; name: string; url: string; comment: string; tags: string[] }[];
  wishes: {
    id: string;
    name: string;
    brand: string;
    url: string;
    shopId: string | null;
    projectId: string | null;
    photoPath: string;
    gotAt: number | null;
    stashedAt: number | null;
  }[];
  yarns: { id: string; name: string; brand: string; colourway: string; lots: { balls: number; boughtAt: number | null }[] }[];
  tools: { id: string; kind: string; sizeMm: number; cableCm: number; notes: string }[];
  covers: Map<string, unknown>;
};

const invoke = <T>(cmd: string) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd);

function pure(results: CheckResult[], shops: Shop[], wishes: Wish[]): void {
  const ids = (list: { id: string }[]) => list.map((x) => x.id).join(",");
  check(results, "a link's site is said without www", siteOf("https://www.Drops.com/en/x") === "drops.com", siteOf("https://www.Drops.com/en/x"));
  check(results, "no link has no site", siteOf("") === "" && siteOf("not a link") === "");
  check(results, "a link on a shop's site is from that shop", shopForUrl("https://www.wolle-roedel.com/drops-air", shops)?.id === "s1");
  check(results, "…and a link without www on one with it", shopForUrl("https://wolle-roedel.com/x", shops)?.id === "s1");
  check(results, "…and a link on part of a shop's site", shopForUrl("https://outlet.deadstock.example.com/a", shops)?.id === "s2");
  check(results, "a link on a site no shop has is from no shop", shopForUrl("https://example.org/x", shops) === undefined);
  check(results, "a site that only ends the same is not the shop's", shopForUrl("https://notdeadstock.example.com", shops) === undefined);
  check(results, "the shops search looks through comments", ids(filterShops(shops, "deadstock")) === "s2", ids(filterShops(shops, "deadstock")));
  check(results, "…every word, anywhere", ids(filterShops(shops, "drops cheapest")) === "s1");
  check(results, "…without minding accents", ids(filterShops(shops, "rodel")) === "s1");
  check(results, "…and finds a shop with no address by its comment", ids(filterShops(shops, "saturday")) === "s3");

  check(results, "Kind filters by what it is", ids(filterWishes(wishes, { kind: ["tool"] })) === "w2");
  check(results, "No shop finds what has none", ids(filterWishes(wishes, { shop: [""] })) === "w3,w2", ids(filterWishes(wishes, { shop: [""] })));
  check(results, "For filters by project", ids(filterWishes(wishes, { project: ["pr2"] })) === "w1");
  check(results, "a search looks through the name", ids(filterWishes(wishes, { search: "grey" })) === "w1");
  check(results, "…the notes, and the shop", ids(filterWishes(wishes, { search: "sleeves" })) === "w2" && ids(filterWishes(wishes, { search: "rödel" })) === "w1");
  const facets = wishFacets(wishes);
  const counts = (list: { key: string; count: number }[]) => list.map((f) => `${f.key || "none"}:${f.count}`).join(" ");
  check(results, "every kind is offered, counting what is still wanted", counts(facets.kind) === "yarn:1 tool:1 pattern:1 other:0", counts(facets.kind));
  check(results, "shops are offered most wanted first, No shop last", counts(facets.shop) === "s1:1 s2:0 none:2", counts(facets.shop));
  check(results, "…and projects the same", counts(facets.project) === "pr2:1 none:2", counts(facets.project));

  // Shop tags.
  const tagCounts = shopTagFacets(shops).map((f) => `${f.label}:${f.count}`).join(" ");
  check(results, "shop tags are counted, most used first", tagCounts === "yarn:2 deadstock:1 needles:1 Sale:1", tagCounts);
  check(results, "ticked tags must all be on a shop", ids(filterShops(shops, "", ["yarn"])) === "s2,s1" && ids(filterShops(shops, "", ["yarn", "deadstock"])) === "s2", ids(filterShops(shops, "", ["yarn"])));
  check(results, "a tag is matched whatever its case", ids(filterShops(shops, "", ["sale"])) === "s1");
  check(results, "the search looks through tags too", ids(filterShops(shops, "needles")) === "s3");

  // From the wishlist into the stash.
  const w = (fields: Partial<Wish>): Wish => ({ ...wishes[0], name: "", brand: "", amount: "", notes: "", gotAt: null, ...fields });
  const ys = (fields: Partial<Wish>) => {
    const y = yarnStart(w(fields));
    return `${y.brand}|${y.name}|${y.colourway}|${y.balls}`;
  };
  check(results, "a yarn's colour is after its comma", ys({ name: "Alpaca, light grey mix", brand: "DROPS", amount: "6 balls" }) === "DROPS|Alpaca|light grey mix|6", ys({ name: "Alpaca, light grey mix", brand: "DROPS", amount: "6 balls" }));
  check(results, "…or after a shop's dash", ys({ name: "Air – Off White" }) === "|Air|Off White|0", ys({ name: "Air – Off White" }));
  check(results, "the brand is not said twice", ys({ name: "DROPS Air", brand: "DROPS" }) === "DROPS|Air||0", ys({ name: "DROPS Air", brand: "DROPS" }));
  const kit = "Stylecraft Autumn CAL – Love Letters to Autumn – MadebyAnita Misty Moors Special DK Garnpaket";
  check(results, "a long part after a dash is more of the name", ys({ name: kit }) === `|${kit}||0`, ys({ name: kit }));
  const balls = ["6 balls", "6 x 50 g", "6 Knäuel", "6", "3 skeins", "500 g", ""].map(ballsIn).join(",");
  check(results, "the balls are read from how much", balls === "6,6,6,6,3,0,0", balls);
  const ts = (name: string, amount = "") => {
    const t = toolStart(w({ name, amount, brand: "ChiaoGoo" }));
    return `${t.kind} ${t.sizeMm} ${t.lengthCm} ${t.cableCm} ${t.brand}`;
  };
  check(results, "a circular's size and cable are read", ts("4 mm circular, 60 cm") === "circular 4 0 60 ChiaoGoo", ts("4 mm circular, 60 cm"));
  check(results, "…a circular with a cable is a circular", ts("Circular needle 3,5 mm, 80 cm cable") === "circular 3.5 0 80 ChiaoGoo", ts("Circular needle 3,5 mm, 80 cm cable"));
  check(results, "…double-pointed needles have a length", ts("DPNs 2.5mm 20cm") === "dpn 2.5 20 0 ChiaoGoo", ts("DPNs 2.5mm 20cm"));
  check(results, "…in German too", ts("Häkelnadel 5 mm") === "hook 5 0 0 ChiaoGoo" && ts("Nadelspiel 3 mm, 15 cm") === "dpn 3 15 0 ChiaoGoo", ts("Häkelnadel 5 mm"));
  check(results, "…tips and cables", ts("Interchangeable tips 4 mm, 13 cm") === "tips 4 13 0 ChiaoGoo" && ts("Cable 100 cm") === "cable 0 0 100 ChiaoGoo", ts("Cable 100 cm"));
  check(results, "a page's title loses the brand in front", withoutBrand("DROPS Air – Off White", "drops") === "Air – Off White" && withoutBrand("Air", "DROPS") === "Air");
}

export async function verifyShopping() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const opened = () => ((window as unknown as { __opened?: string[] }).__opened ?? []);
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const wishCards = () => [...document.querySelectorAll<HTMLElement>(".wishlist .wish-card")];
  const wanted = () => wishCards().filter((c) => !c.classList.contains("got")).map((c) => c.dataset.open).join(",");
  const got = () => wishCards().filter((c) => c.classList.contains("got")).map((c) => c.dataset.open).join(",");
  const wishCard = (id: string) => document.querySelector<HTMLElement>(`.wishlist .wish-card[data-open="${id}"]`);
  const shopCards = () => [...document.querySelectorAll<HTMLElement>(".shops .shop-card")];
  const shopCard = (id: string) => document.querySelector<HTMLElement>(`.shops .shop-card[data-open="${id}"]`);
  const modal = (cls: string) => document.querySelector<HTMLElement>(`.modal-backdrop:not(.hidden) .${cls}`);
  const field = (cls: string, f: string) => modal(cls)?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`) ?? null;
  const type = (cls: string, f: string, v: string) => {
    const el = field(cls, f)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const act = (cls: string, name: string) => (modal(cls)?.querySelector(`[data-act="${name}"]`) as HTMLElement).click();
  const errorText = (cls: string) => {
    const el = modal(cls)?.querySelector<HTMLElement>('[data-el="error"]');
    return el && !el.hidden ? el.textContent ?? "" : "";
  };
  const tick = (group: string, value: string, on = true) => {
    const box = document.querySelector<HTMLInputElement>(`.wishlist input[data-filter="${group}"][value="${value}"]`)!;
    box.checked = on;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const answer = async (label: string) => {
    await waitFor(() => !!document.querySelector(".dialog-card"), "a question");
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === label)!.click();
  };

  try {
    pure(results, await invoke<Shop[]>("list_shops"), await invoke<Wish[]>("list_wishes"));

    // ---------- the wishlist ----------
    tab("wishlist");
    await waitFor(() => wishCards().length === 4, "the wishlist cards");
    check(results, "the tabs are there, in order", [...document.querySelectorAll<HTMLElement>(".tab-bar .tab")].map((t) => t.dataset.tab).join(",") === "patterns,projects,inspiration,stash,tools,wishlist,shops");
    check(results, "what is wanted comes first, newest first", wanted() === "w3,w2,w1", wanted());
    check(results, "what was got is under Got", got() === "w4" && /Got\s*1/.test(document.querySelector(".wish-section h3")?.textContent ?? ""));
    const w1 = wishCard("w1")!;
    check(results, "a card says how much and the price", w1.querySelector(".wish-meta")?.textContent === "6 balls · €3.95 a ball");
    check(results, "…where from, and what for", /At\s*Wolle Rödel/.test(w1.textContent ?? "") && /For\s*Gift hat/.test(w1.textContent ?? ""));
    const sizes = wishCards().map((c) => c.getBoundingClientRect()).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`);
    check(results, "every card is the same size", new Set(sizes).size === 1, sizes.join(" "));

    (w1.querySelector('[data-act="open-link"]') as HTMLElement).click();
    await waitFor(() => opened().includes("https://www.wolle-roedel.com/drops-alpaca"), "the link to open");
    check(results, "Open link opens the item's page", true);
    (w1.querySelector('[data-act="open-shop"]') as HTMLElement).click();
    await waitFor(() => opened().includes("https://www.wolle-roedel.com"), "the shop to open");
    check(results, "the shop's name opens the shop", true);
    check(results, "a card without a link has no Open link", !wishCard("w2")!.querySelector('[data-act="open-link"]'));

    tick("kind", "tool");
    check(results, "ticking a kind shows only that kind", wanted() === "w2" && got() === "", `${wanted()} / ${got()}`);
    tick("kind", "tool", false);
    tick("shop", "s1");
    (document.querySelector('.wishlist [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the wishlist form");
    check(results, "a new item from a shop's filter starts at that shop", field("wish-form", "shop")?.value === "s1");
    act("wish-form", "cancel");
    await waitFor(() => !modal("wish-form"), "the form to close");
    (document.querySelector('.wishlist [data-act="clear"]') as HTMLElement).click();
    check(results, "Clear filters shows everything again", wishCards().length === 4);

    // Add one, with a pasted link picking its shop.
    (document.querySelector('.wishlist [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the wishlist form");
    check(results, "a new item starts as yarn, from no shop", field("wish-form", "kind")?.value === "yarn" && field("wish-form", "shop")?.value === "");
    // Earlier suites finish and frog projects, so what is live is read, not assumed.
    const live = store.projects.filter((p) => p.status === "active" || p.status === "paused");
    const projectChoices = [...field("wish-form", "project")!.options].map((o) => o.textContent).join("|");
    check(results, "For offers the projects on the needles, and only those", live.length > 0 && projectChoices === ["Nothing in particular", ...live.map((p) => p.name)].join("|"), projectChoices);
    act("wish-form", "save");
    await waitFor(() => !!errorText("wish-form"), "the name error");
    check(results, "saving without a name says what is missing", /what it is/.test(errorText("wish-form")));
    type("wish-form", "name", "  Merino   DK, teal ");
    type("wish-form", "url", "deadstock.example.com/merino-dk");
    check(results, "a pasted link picks its shop", field("wish-form", "shop")?.value === "s2");
    check(results, "…and says so", /Deadstock Yarns, from the link/.test(modal("wish-form")?.querySelector('[data-el="shop-hint"]')?.textContent ?? ""));
    type("wish-form", "amount", "5 balls");
    type("wish-form", "project", live[0].id);
    const before = store.wishes.length;
    act("wish-form", "save");
    await waitFor(() => !modal("wish-form") && store.wishes.length === before + 1, "the save");
    const added = store.wishes[store.wishes.length - 1];
    check(results, "it is stored tidied, with its shop and project", added.name === "Merino DK, teal" && added.url === "https://deadstock.example.com/merino-dk" && added.shopId === "s2" && added.projectId === live[0].id, JSON.stringify(added));
    await waitFor(() => !!wishCard(added.id), "its card");
    check(results, "its card is first", wanted().split(",")[0] === added.id, wanted());

    // A shop chosen by hand is not changed by a link.
    (document.querySelector('.wishlist [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the form again");
    type("wish-form", "shop", "s3");
    type("wish-form", "url", "https://www.wolle-roedel.com/x");
    check(results, "a shop chosen by hand stays when a link is pasted", field("wish-form", "shop")?.value === "s3");

    // A new shop from the picker, named after the link's site.
    type("wish-form", "url", "https://www.knitpicks.example.com/needles");
    type("wish-form", "shop", "__new__");
    await waitFor(() => !!document.querySelector(".dialog-card .dialog-input"), "the shop name question");
    const nameBox = document.querySelector<HTMLInputElement>(".dialog-card .dialog-input")!;
    check(results, "+ New shop… starts from the link's site", nameBox.value === "knitpicks.example.com", nameBox.value);
    nameBox.value = "KnitPicks";
    const shopsBefore = store.shops.length;
    await answer("Add the shop");
    await waitFor(() => store.shops.length === shopsBefore + 1, "the new shop");
    const newShop = store.shops[store.shops.length - 1];
    check(results, "the shop is added with the link's site as its address", newShop.name === "KnitPicks" && newShop.url === "https://knitpicks.example.com", JSON.stringify(newShop));
    await waitFor(() => field("wish-form", "shop")?.value === newShop.id, "the new shop to be chosen");
    check(results, "…and chosen in the form", true);
    type("wish-form", "kind", "tool");
    type("wish-form", "name", "3.5 mm tips");
    const n = store.wishes.length;
    act("wish-form", "save-another");
    await waitFor(() => store.wishes.length === n + 1 && !modal("wish-form")?.querySelector<HTMLElement>('[data-el="saved"]')?.hidden, "save and add another");
    check(results, "Save and add another keeps the kind and shop, and clears the rest",
      field("wish-form", "kind")?.value === "tool" && field("wish-form", "shop")?.value === newShop.id && field("wish-form", "name")?.value === "" && field("wish-form", "url")?.value === "");
    act("wish-form", "cancel");
    await waitFor(() => !modal("wish-form"), "the form to close");

    // A link that is not a web address.
    (wishCard("w3")!.querySelector(".wish-name") as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the edit form");
    check(results, "clicking a card edits it", field("wish-form", "name")?.value === "Ankers Summer Shirt" && field("wish-form", "kind")?.value === "pattern");
    type("wish-form", "url", "javascript:alert(1)");
    act("wish-form", "save");
    await waitFor(() => !!errorText("wish-form"), "the link error");
    check(results, "a link that is not a web address is refused", /not a web address/.test(errorText("wish-form")));
    act("wish-form", "cancel");
    await waitFor(() => !modal("wish-form"), "the form to close");

    // Got it, and back.
    (wishCard("w2")!.querySelector('[data-act="got"]') as HTMLElement).click();
    await waitFor(() => got().split(",").includes("w2"), "w2 to be got");
    check(results, "Got it moves it to Got, first", got().split(",")[0] === "w2" && store.wishes.find((w) => w.id === "w2")?.gotAt !== null, got());
    check(results, "…dated", /^Got\s+\S/.test(wishCard("w2")!.querySelector(".wish-got-pill")?.textContent ?? ""), wishCard("w2")!.querySelector(".wish-got-pill")?.textContent ?? "");
    (document.querySelector('.wishlist [data-act="toggle-got"]') as HTMLElement).click();
    check(results, "Hide hides what was got", got() === "" && document.querySelector('.wishlist [data-act="toggle-got"]')?.textContent === "Show");
    (document.querySelector('.wishlist [data-act="toggle-got"]') as HTMLElement).click();
    (wishCard("w2")!.querySelector('[data-act="want"]') as HTMLElement).click();
    await waitFor(() => wanted().split(",").includes("w2"), "w2 to be wanted again");
    check(results, "Still want it puts it back", store.wishes.find((w) => w.id === "w2")?.gotAt === null);

    // Remove, after asking.
    (wishCard("w3")!.querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm");
    check(results, "removing asks first, naming it", /Ankers Summer Shirt/.test(document.querySelector(".dialog-card .dialog-message")?.textContent ?? ""));
    await answer("Remove");
    await waitFor(() => !wishCard("w3"), "the removal");
    check(results, "it is gone", !store.wishes.some((w) => w.id === "w3"));

    // ---------- reading a link ----------
    const pages = ((window as unknown as { __linkPages?: Record<string, unknown> }).__linkPages ??= {});
    pages["https://www.wolle-roedel.com/drops-air"] = { title: "DROPS Air – Off White", brand: "DROPS", price: "€5.95", imageUrl: "https://www.wolle-roedel.com/img/air.png" };
    pages["https://www.etsy.example.com/listing/1"] = "The page answered 403. The shop may not let apps read its pages; fill the details in yourself.";
    const fetchStatus = () => modal("wish-form")?.querySelector<HTMLElement>('[data-el="fetch-status"]') ?? null;
    const paste = (url: string) => {
      const el = field("wish-form", "url")!;
      el.value = url;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("paste", { bubbles: true }));
    };
    (document.querySelector('.wishlist [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the form");
    check(results, "a new item's form starts in the link", document.activeElement === field("wish-form", "url"));
    type("wish-form", "amount", "6 balls");
    paste("www.wolle-roedel.com/drops-air");
    await waitFor(() => /from the page/.test(fetchStatus()?.textContent ?? ""), "the page to be read");
    check(results, "pasting a link reads the page", /Filled in the brand, name, price and picture from the page/.test(fetchStatus()!.textContent ?? ""), fetchStatus()!.textContent ?? "");
    check(results, "…the name without the brand, which has a field of its own",
      field("wish-form", "name")!.value === "Air – Off White" && field("wish-form", "brand")!.value === "DROPS" && field("wish-form", "price")!.value === "€5.95",
      `${field("wish-form", "name")!.value} / ${field("wish-form", "brand")!.value}`);
    check(results, "…the picture", !!modal("wish-form")!.querySelector('[data-el="photobox"].filled'));
    check(results, "…and the shop, from the link", field("wish-form", "shop")!.value === "s1");
    check(results, "what was typed stays", field("wish-form", "amount")!.value === "6 balls");
    type("wish-form", "name", "Air, Off White");
    act("wish-form", "fetch");
    await waitFor(() => /Nothing new/.test(fetchStatus()?.textContent ?? ""), "the page to be read again");
    check(results, "reading it again replaces nothing typed", field("wish-form", "name")!.value === "Air, Off White");
    const wishesBefore = store.wishes.length;
    act("wish-form", "save");
    await waitFor(() => !modal("wish-form") && store.wishes.length === wishesBefore + 1, "the save");
    const air =store.wishes[store.wishes.length - 1];
    check(results, "it is stored with its brand and picture", air.brand === "DROPS" && air.photoPath !== "" && store.covers.has(`wish:${air.id}`), JSON.stringify(air));
    await waitFor(() => !!wishCard(air.id)?.querySelector(".wish-thumb.filled"), "its picture on the card");
    check(results, "its card shows the picture, and the brand with the name", wishCard(air.id)!.querySelector(".wish-name")?.textContent === "DROPS Air, Off White");

    (document.querySelector('.wishlist [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("wish-form"), "the form");
    paste("https://www.etsy.example.com/listing/1");
    await waitFor(() => !!fetchStatus()?.classList.contains("bad"), "the refusal");
    check(results, "a shop that will not be read says so", /403/.test(fetchStatus()!.textContent ?? "") && field("wish-form", "name")!.value === "");
    act("wish-form", "cancel");
    await waitFor(() => !modal("wish-form"), "the form to close");

    // ---------- into the stash ----------
    check(results, "something still wanted cannot go into the stash yet", !wishCard(air.id)!.querySelector('[data-act="stash"]'));
    (wishCard(air.id)!.querySelector('[data-act="got"]') as HTMLElement).click();
    await waitFor(() => !!wishCard(air.id)?.querySelector('[data-act="stash"]'), "Add to stash");
    check(results, "yarn that was got offers Add to stash", wishCard(air.id)!.querySelector('[data-act="stash"]')!.textContent?.trim() === "+ Add to stash");
    (wishCard(air.id)!.querySelector('[data-act="stash"]') as HTMLElement).click();
    await waitFor(() => !!modal("yarn-form"), "the yarn form");
    const yarnField = (f: string) => modal("yarn-form")!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!.value;
    check(results, "the yarn form is filled in from the wishlist", /from the wishlist/.test(modal("yarn-form")!.querySelector("h2")?.textContent ?? ""));
    check(results, "…brand, name and colourway", yarnField("brand") === "DROPS" && yarnField("name") === "Air" && yarnField("colourway") === "Off White", `${yarnField("brand")}|${yarnField("name")}|${yarnField("colourway")}`);
    check(results, "…the balls bought, as its first lot", modal("yarn-form")!.querySelector<HTMLInputElement>('[data-lf="balls"]')?.value === "6");
    await waitFor(() => !!modal("yarn-form")!.querySelector('[data-el="photobox"].filled'), "the picture in the yarn form");
    check(results, "…and the picture", true);
    const yarnsBefore = store.yarns.length;
    act("yarn-form", "save");
    await waitFor(() => !modal("yarn-form") && store.yarns.length === yarnsBefore + 1, "the yarn to save");
    const yarn = store.yarns[store.yarns.length - 1];
    check(results, "the yarn is in the stash, with its lot and photo", yarn.name === "Air" && yarn.brand === "DROPS" && yarn.lots[0]?.balls === 6 && store.covers.has(yarn.id), JSON.stringify(yarn));
    await waitFor(() => !!store.wishes.find((w) => w.id === air.id)?.stashedAt && /In the stash/.test(wishCard(air.id)?.textContent ?? ""), "the card to say so");
    check(results, "the card says it is in the stash, and offers it no more", !wishCard(air.id)!.querySelector('[data-act="stash"]'));

    (wishCard("w2")!.querySelector('[data-act="got"]') as HTMLElement).click();
    await waitFor(() => !!wishCard("w2")?.querySelector('[data-act="stash"]'), "Add to needles");
    check(results, "needles that were got offer Add to needles", /Add to needles/.test(wishCard("w2")!.querySelector('[data-act="stash"]')!.textContent ?? ""));
    (wishCard("w2")!.querySelector('[data-act="stash"]') as HTMLElement).click();
    await waitFor(() => !!modal("tool-form"), "the needle form");
    const toolField = (f: string) => modal("tool-form")!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!.value;
    check(results, "the needle form is read from the item: a 4 mm circular, 60 cm",
      toolField("kind") === "circular" && toolField("sizeMm") === "4" && toolField("cableCm") === "60" && toolField("notes") === "For sleeves",
      `${toolField("kind")} ${toolField("sizeMm")} ${toolField("cableCm")}`);
    const toolsBefore = store.tools.length;
    act("tool-form", "save");
    await waitFor(() => !modal("tool-form") && store.tools.length === toolsBefore + 1, "the needle to save");
    const tool = store.tools[store.tools.length - 1];
    check(results, "the needle is in Needles & hooks", tool.kind === "circular" && tool.sizeMm === 4 && tool.cableCm === 60, JSON.stringify(tool));
    await waitFor(() => /In Needles & hooks/.test(wishCard("w2")?.textContent ?? ""), "the card to say so");
    check(results, "…and its card says so", !!store.wishes.find((w) => w.id === "w2")?.stashedAt);

    // ---------- shops ----------
    tab("shops");
    await waitFor(() => shopCards().length === store.shops.length, "the shop cards");
    const names = () => shopCards().map((c) => c.querySelector(".shop-name")?.textContent).join("|");
    check(results, "shops are listed by name", names() === "Deadstock Yarns|KnitPicks|The yarn shop in town|Wolle Rödel", names());
    check(results, "a comment keeps its lines", shopCard("s2")!.querySelector(".shop-comment")?.textContent === "Great prices on deadstock.\nSlow to ship.");
    check(results, "a shop without an address says so", /No web address/.test(shopCard("s3")!.textContent ?? ""));
    check(results, "a card shows the site", /wolle-roedel\.com/.test(shopCard("s1")!.querySelector(".shop-site")?.textContent ?? ""));
    const search = document.querySelector<HTMLInputElement>(".shops .search")!;
    search.value = "deadstock";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "the search finds a shop by its comment", names() === "Deadstock Yarns", names());
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    // Tags: down the side, on the cards, and in the search.
    const tagBoxes = () => [...document.querySelectorAll<HTMLInputElement>('.shops input[data-filter="tag"]')];
    check(results, "the tags are down the side, most used first", tagBoxes().map((i) => i.value).join(",") === "yarn,deadstock,needles,sale", tagBoxes().map((i) => i.value).join(","));
    const yarnBox = tagBoxes().find((i) => i.value === "yarn")!;
    yarnBox.checked = true;
    yarnBox.dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "ticking a tag shows the shops that have it", names() === "Deadstock Yarns|Wolle Rödel", names());
    (shopCard("s2")!.querySelector('[data-act="tag"][data-tag="deadstock"]') as HTMLElement).click();
    check(results, "a tag on a card ticks it too, and both must match", names() === "Deadstock Yarns" && !!shopCard("s2")!.querySelector('.shop-tag.on[data-tag="deadstock"]'), names());
    check(results, "…its box ticked down the side", !!tagBoxes().find((i) => i.value === "deadstock")?.checked);
    (document.querySelector('.shops [data-act="clear"]') as HTMLElement).click();
    check(results, "Clear filters shows every shop again", shopCards().length === store.shops.length && !tagBoxes().some((i) => i.checked));
    search.value = "sale";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "the search finds a shop by its tag", names() === "Wolle Rödel", names());
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    (shopCard("s1")!.querySelector('[data-act="visit"]') as HTMLElement).click();
    check(results, "the site on a card opens the shop", opened().filter((u) => u === "https://www.wolle-roedel.com").length >= 2);

    // Its count goes to the wishlist, filtered to it.
    const count = shopCard("s2")!.querySelector<HTMLElement>('[data-act="wishlist"]');
    check(results, "a shop says how much on the wishlist is from it", count?.textContent === "1 thing on your wishlist", count?.textContent ?? "(none)");
    count!.click();
    await waitFor(() => !!document.querySelector(".wishlist") && wishCards().length > 0, "the wishlist");
    check(results, "…and goes to the wishlist, filtered to it", wanted() === added.id && got() === "w4" && !!document.querySelector<HTMLInputElement>('.wishlist input[data-filter="shop"][value="s2"]')?.checked, `${wanted()} / ${got()}`);
    check(results, "…with its tab marked", document.querySelector(".tab-bar .tab.active")?.getAttribute("data-tab") === "wishlist");

    // Add one, by its address only.
    tab("shops");
    await waitFor(() => shopCards().length > 0, "the shops again");
    (document.querySelector('.shops [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!modal("shop-form"), "the shop form");
    act("shop-form", "save");
    await waitFor(() => !!errorText("shop-form"), "the empty shop error");
    check(results, "a shop needs a name or an address", /name, or its web address/.test(errorText("shop-form")));
    type("shop-form", "url", "drops");
    act("shop-form", "save");
    await waitFor(() => /not a web address/.test(errorText("shop-form")), "the address error");
    check(results, "a word on its own is not an address", true);
    type("shop-form", "url", "www.garnstudio.example.com");
    type("shop-form", "comment", "Their own shop. Patterns are free.");
    const s = store.shops.length;
    act("shop-form", "save");
    await waitFor(() => store.shops.length === s + 1 && !modal("shop-form"), "the shop to save");
    const made = store.shops[store.shops.length - 1];
    check(results, "a shop given only its address is named after it", made.name === "garnstudio.example.com" && made.url === "https://www.garnstudio.example.com", JSON.stringify(made));
    await waitFor(() => !!shopCard(made.id), "its card");

    // Edit one from its card.
    (shopCard("s3")!.querySelector(".shop-name") as HTMLElement).click();
    await waitFor(() => !!modal("shop-form"), "the edit form");
    check(results, "clicking a shop edits it", field("shop-form", "name")?.value === "The yarn shop in town");
    const chips = () => [...modal("shop-form")!.querySelectorAll<HTMLElement>('[data-el="tags"] .tag')].map((c) => c.firstChild?.textContent).join("|");
    const tagInput = modal("shop-form")!.querySelector<HTMLInputElement>('[data-el="tag-input"]')!;
    check(results, "the form shows the shop's tags", chips() === "needles", chips());
    tagInput.value = "local";
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    check(results, "Enter adds a tag, and does not save yet", chips() === "needles|local" && !!modal("shop-form"), chips());
    tagInput.value = "Yarn,";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "a comma adds one, spelled as other shops have it", chips() === "needles|local|yarn", chips());
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    check(results, "Backspace in the empty field takes the last off", chips() === "needles|local", chips());
    (modal("shop-form")!.querySelector('[data-act="remove-tag"][data-i="0"]') as HTMLElement).click();
    check(results, "× takes a tag off", chips() === "local", chips());
    tagInput.value = "yarn";
    type("shop-form", "comment", "Saturday mornings only. Ask for Anja.");
    act("shop-form", "save");
    await waitFor(() => !modal("shop-form") && /Anja/.test(shopCard("s3")?.textContent ?? ""), "the edit");
    check(results, "an edit shows on the card", true);
    check(results, "a tag still being typed is saved too", store.shops.find((x) => x.id === "s3")?.tags.join("|") === "local|yarn", store.shops.find((x) => x.id === "s3")?.tags.join("|"));
    check(results, "…and the card shows the tags", [...shopCard("s3")!.querySelectorAll(".shop-tag")].map((t) => t.textContent).join("|") === "local|yarn");

    // Remove one: what was to be got there stays, with no shop.
    (shopCard("s1")!.querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm");
    check(results, "removing a shop says its wishlist items stay", /stay on it, with no shop/.test(document.querySelector(".dialog-card .dialog-message")?.textContent ?? ""));
    await answer("Remove");
    await waitFor(() => !shopCard("s1"), "the removal");
    check(results, "the shop is gone, and its item stays without it", !store.shops.some((x) => x.id === "s1") && store.wishes.find((w) => w.id === "w1")?.shopId === null);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".dialog-card button.ghost")?.click();
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"]')?.click();
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.tools):not(.wishlist):not(.shops)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__shoppingChecks = verifyShopping;
