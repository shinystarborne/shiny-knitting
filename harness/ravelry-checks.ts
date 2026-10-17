/**
 * Checks for the Ravelry tab, through Ravelry's API: connected with a
 * personal key (a wrong one said so), searched, the patterns found as cards,
 * more of them on asking, the free ones alone; one opened with what Ravelry
 * says of it, to the wishlist with its name, designer and price, or to its
 * page in the browser; disconnected again.
 *
 * Run with the harness open:
 *   window.__ravelryChecks()
 */

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

export async function verifyRavelry() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { ravelryKey?: unknown }; __opened?: string[] };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".ravelry");
  const field = (f: string) => view()!.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${f}"]`)!;
  const cards = () => [...(view()?.querySelectorAll<HTMLElement>("[data-pattern]") ?? [])];
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card.rav-pattern-dialog");
  const before = store.ravelryKey;
  store.ravelryKey = null;
  const search = async (words: string, free = false) => {
    field("query").value = words;
    field("free").checked = free;
    view()!.querySelector<HTMLFormElement>('[data-el="search"]')!.requestSubmit();
    await wait(150);
    await waitFor(() => !view()!.querySelector(".calc-wait"), "the search");
  };

  try {
    tab("ravelry");
    await waitFor(() => !!view()?.querySelector('[data-el="connect"]'), "the Ravelry tab");
    check(results, "a tab of its own, beside Masterclasses, asking first for a personal API key, saying how to make one", document.querySelector('.tab-bar [data-tab="masterclasses"] + [data-tab="ravelry"]') !== null && /Connect your Ravelry account/.test(view()!.textContent ?? "") && /personal/.test(view()!.textContent ?? ""));
    view()!.querySelector<HTMLElement>('[data-act="developer"]')!.click();
    await wait(100);
    check(results, "…its developer page opened in the browser from there", (w.__opened ?? []).at(-1) === "https://www.ravelry.com/pro/developer");

    field("access").value = "refused";
    field("personal").value = "secret";
    view()!.querySelector<HTMLFormElement>('[data-el="connect"]')!.requestSubmit();
    await waitFor(() => !view()!.querySelector<HTMLElement>('[data-el="error"]')!.hidden, "the refusal");
    check(results, "a key Ravelry won't take is said so, and nothing kept", /didn't accept the key/.test(view()!.querySelector('[data-el="error"]')!.textContent ?? "") && !store.ravelryKey);
    field("access").value = "my-access";
    view()!.querySelector<HTMLFormElement>('[data-el="connect"]')!.requestSubmit();
    await waitFor(() => !!view()!.querySelector('[data-el="search"]'), "connected");
    check(results, "a good key connects, saying as whom", /Connected as shinyknits/.test(view()!.textContent ?? ""));

    await search("védís");
    check(results, "a search shows the patterns found as cards, with their designer", cards().length === 2 && /Riddari/.test(cards()[0].textContent ?? "") && /Védís Jónsdóttir/.test(cards()[0].textContent ?? ""), cards().map((c) => c.textContent).join(" | "));
    await search("védís", true);
    check(results, "…Free only, the free ones alone, said so on the card", cards().length === 1 && /Free/.test(cards()[0].textContent ?? ""));
    await search("lopapeysa");
    check(results, "…twenty-four at a time, saying how many there are, with More", cards().length === 24 && /27 patterns/.test(view()!.textContent ?? "") && !!view()!.querySelector('[data-act="more"]'));
    view()!.querySelector<HTMLElement>('[data-act="more"]')!.click();
    await waitFor(() => cards().length === 27, "more");
    check(results, "…More brings the rest, and goes", !view()!.querySelector('[data-act="more"]'));

    // One opened: what Ravelry says of it.
    await search("riddari");
    cards()[0].click();
    await waitFor(() => !!dialog(), "the pattern");
    const said = dialog()!.textContent ?? "";
    check(results, "a pattern opened says what Ravelry says of it: designer, price, yarn, needles, gauge, notes", /Védís Jónsdóttir/.test(said) && /6\.00 EUR/.test(said) && /Aran/.test(said) && /4\.0 mm/.test(said) && /18 sts/.test(said) && /bottom up/.test(said), said.replace(/\s+/g, " "));
    dialog()!.querySelector<HTMLElement>('[data-act="ravelry"]')!.click();
    await wait(100);
    check(results, "…Ravelry page ↗ opens its page in the browser, to buy it", (w.__opened ?? []).at(-1) === "https://www.ravelry.com/patterns/library/riddari");
    dialog()!.querySelector<HTMLElement>('[data-act="wish"]')!.click();
    await waitFor(() => !!document.querySelector('.modal [data-f="url"]'), "the wishlist's form");
    const wish = (f: string) => document.querySelector<HTMLInputElement & HTMLSelectElement>(`.modal [data-f="${f}"]`)!.value;
    check(results, "…To the wishlist opens a wish for the pattern, its name, designer, price and link filled in", wish("kind") === "pattern" && wish("url") === "https://www.ravelry.com/patterns/library/riddari" && wish("name") === "Riddari" && wish("brand") === "Védís Jónsdóttir" && wish("price") === "6.00 EUR", `${wish("kind")} ${wish("name")} ${wish("brand")} ${wish("price")}`);
    document.querySelector<HTMLElement>('.modal [data-act="cancel"]')!.click();
    await waitFor(() => !document.querySelector('.modal [data-f="url"]'), "the form closed");

    // Disconnected.
    view()!.querySelector<HTMLElement>('[data-act="disconnect"]')!.click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the question");
    document.querySelector<HTMLElement>(".dialog-card button.primary")!.click();
    await waitFor(() => !!view()!.querySelector('[data-el="connect"]'), "disconnected");
    check(results, "Disconnect forgets the key, and the tab asks for one again", !store.ravelryKey);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector<HTMLElement>('.modal [data-act="cancel"]')?.click();
    store.ravelryKey = before;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__ravelryChecks = verifyRavelry;
