/**
 * Checks for what needles and hooks cost: a needle's price from its form, a
 * price the same brand and kind already has offered for another, several
 * sizes added as a set with one price, the set made and changed under Sets
 * with its pieces ticked, what all of it cost in the header (a set once, its
 * pieces not again), and needles in what was spent.
 *
 * Run with the harness open:
 *   window.__toolPriceChecks()
 */
import type { Tool, ToolSet, Wish } from "../src/api";
import { money, spending, spentByMonth, toolsCost } from "../src/views/money";
import { toolStart } from "../src/views/shopping";
import { setName } from "../src/views/tool-form";

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
  const tool = (id: string, price: number | null, setId: string | null = null, addedAt = 0) =>
    ({ id, kind: "hook", sizeMm: 4, lengthCm: 0, cableCm: 0, cableSize: "", connector: "", adapterTo: "", brand: "Clover", material: "", projectId: null, projectName: "", notes: "", addedAt, uses: [], price, setId, setName: "" }) as Tool;
  const sets = [{ id: "s", name: "Twist Lace", price: 120, addedAt: new Date(2028, 2, 2).getTime(), toolIds: ["b", "c"] }] as ToolSet[];
  const tools = [tool("a", 7.5, null, new Date(2028, 1, 9).getTime()), tool("b", 9, "s"), tool("c", null, "s"), tool("d", null), tool("e", 3, "gone")];
  const cost = toolsCost(tools, sets);
  check(results, "the needles' cost: each alone at its price, a set once at its, its pieces not again", cost.total === 130.5 && cost.unpriced === 1, JSON.stringify(cost));
  check(results, "…a set with no price is one without", toolsCost(tools, [{ ...sets[0], price: null }]).unpriced === 2);
  const spends = spending([], [], tools, sets);
  check(results, "what was spent: a needle when added, a set once", spends.filter((s) => s.kind === "tool").map((s) => s.amount).join() === "120,7.5,3", JSON.stringify(spends));
  const months = spentByMonth(spends, new Date(2028, 2, 15).getTime());
  check(results, "…in its month, with the totals", months[11].tools === 120 && months[11].total === 120 && months[10].tools === 7.5);
  check(results, "a set from the form is named by its brand, kind and sizes", setName("ChiaoGoo", "tips", [3, 2.75, 5]) === "ChiaoGoo interchangeable tips, 2.75–5 mm" && setName("", "hook", [3, 4]) === "Crochet hooks, 3–4 mm", setName("ChiaoGoo", "tips", [3, 2.75, 5]));
  const wish = { id: "w", kind: "needles", name: "Clover Amour hook 4 mm", brand: "Clover", url: "", shopId: null, price: "€14,90", amount: "", notes: "", gotAt: null } as unknown as Wish;
  check(results, "a needle from the wishlist starts with its price", toolStart(wish).price === 14.9);
}

export async function verifyToolPrices() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { currency?: string; tools: (Tool & { setId?: string | null })[]; toolSets: ToolSet[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => modal()?.querySelector<T>(`[data-f="${name}"]`) ?? null;
  const set = (name: string, value: string) => {
    const el = field<HTMLInputElement | HTMLSelectElement>(name);
    if (!el) throw new Error(`no field ${name}`);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const act = (name: string) => modal()!.querySelector<HTMLElement>(`[data-act="${name}"]`)!.click();
  const before = { tools: store.tools.map((t) => t.id), currency: store.currency };
  const card = (id: string) => document.querySelector<HTMLElement>(`.tool-card[data-open="${id}"]`);
  store.currency = "EUR";

  try {
    pure(results);
    tab("tools");
    await waitFor(() => !!document.querySelector('.tools [data-act="add"]'), "Needles & hooks");
    const addForm = async () => {
      document.querySelector<HTMLElement>('.tools [data-act="add"]')!.click();
      await waitFor(() => !!field("price"), "the needle form");
    };

    // ---------- a needle's price ----------
    await addForm();
    check(results, "a needle's form asks its price", modal()!.querySelector('[data-el="price-label"]')?.textContent === "Price");
    set("kind", "hook");
    set("sizeMm", "4");
    set("brand", "Tulip");
    set("price", "12,50");
    act("save");
    const tulip = () => store.tools.filter((t) => t.brand === "Tulip" && !before.tools.includes(t.id));
    await waitFor(() => !modal() && tulip().length === 1, "the hook added");
    const hook = tulip()[0];
    check(results, "…kept to the cent", hook.price === 12.5, String(hook.price));
    await waitFor(() => !!card(hook.id), "its card");
    check(results, "…and its card says it", card(hook.id)!.textContent!.includes(money(12.5, "EUR")), card(hook.id)!.textContent ?? "");

    // Another of the brand and kind starts at that price; typed over, it is the one typed.
    await addForm();
    set("kind", "hook");
    set("sizeMm", "5");
    set("brand", "Tulip");
    check(results, "another Tulip hook starts at its price, saying why", field("price")!.value === "12.5" && /other Tulip crochet hooks/.test(modal()!.querySelector('[data-el="price-hint"]')?.textContent ?? ""), field("price")!.value);
    set("brand", "Addi");
    check(results, "…another brand has none to offer", field("price")!.value === "");
    set("brand", "Tulip");
    set("price", "abc");
    act("save");
    await waitFor(() => !modal()!.querySelector<HTMLElement>('[data-el="error"]')!.hidden, "the error");
    check(results, "a price that is no number is refused", /Price must be a number/.test(modal()!.querySelector('[data-el="error"]')!.textContent ?? ""));
    act("cancel");
    await waitFor(() => !modal(), "closed");

    // ---------- several sizes: a set, with one price ----------
    await addForm();
    set("kind", "tips");
    set("sizeMm", "3, 3.5, 4");
    set("brand", "ChiaoGoo");
    check(results, "several sizes ask the set's price", modal()!.querySelector('[data-el="price-label"]')?.textContent === "Price of the set of 3" && /one price/.test(modal()!.querySelector('[data-el="set-preview"]')?.textContent ?? ""));
    set("price", "89,90");
    act("save");
    const twist = () => store.toolSets.find((s) => s.name === "ChiaoGoo interchangeable tips, 3–4 mm");
    await waitFor(() => !modal() && !!twist(), "the set added");
    const pieces = store.tools.filter((t) => t.setId === twist()!.id);
    check(results, "…kept as a set: named, priced, its three pieces with none of their own", twist()!.price === 89.9 && pieces.length === 3 && pieces.every((t) => t.price == null), JSON.stringify({ set: twist(), pieces: pieces.map((t) => [t.sizeMm, t.price]) }));
    await waitFor(() => !!card(pieces[0].id), "the pieces' cards");
    check(results, "a piece's card says its set", /In the set ChiaoGoo interchangeable tips, 3–4 mm/.test(card(pieces[0].id)!.textContent ?? ""));
    const total = async () => {
      const [tools, sets] = await Promise.all([invoke<Tool[]>("list_tools"), invoke<ToolSet[]>("list_tool_sets")]);
      return toolsCost(tools, sets);
    };
    const header = () => document.querySelector('.tools [data-el="total"]')?.textContent ?? "";
    const expected = await total();
    check(results, "the header says what they all cost, the set once", header().includes(`cost ${money(expected.total, "EUR")}`) && expected.total === 102.4 && /without a price/.test(header()), header());

    // A piece's form says the set has its price.
    card(pieces[1].id)!.click();
    await waitFor(() => !!modal()?.classList.contains("tool-form"), "the piece's form");
    check(results, "a piece's form has no price: the set has it", !field("price") && /Part of the set/.test(modal()!.querySelector('[data-el="in-set"]')?.textContent ?? ""));
    act("cancel");
    await waitFor(() => !modal(), "closed");

    // ---------- Sets ----------
    document.querySelector<HTMLElement>('.tools [data-act="sets"]')!.click();
    await waitFor(() => !!modal()?.querySelector(".tool-set-list"), "the sets");
    const row = () => modal()!.querySelector<HTMLElement>(`.tool-set-row[data-set="${twist()!.id}"]`);
    check(results, "Sets lists the set, its pieces and price", /3 pieces/.test(row()?.textContent ?? "") && row()!.textContent!.includes(money(89.9, "EUR")), row()?.textContent ?? "");
    // A new one, of a box of hooks bought before: the Tulip hook ticked.
    act("new-set");
    await waitFor(() => !!field("set-name"), "a new set");
    const tick = (id: string, on: boolean) => {
      const box = modal()!.querySelector<HTMLInputElement>(`[data-piece="${id}"]`)!;
      box.checked = on;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    };
    check(results, "…a piece with a price alone says it", /€12\.50 alone|12,50\s*€ alone/.test(modal()!.querySelector(`[data-piece="${hook.id}"]`)!.closest("label")!.textContent ?? ""), modal()!.querySelector(`[data-piece="${hook.id}"]`)!.closest("label")!.textContent ?? "");
    tick(hook.id, true);
    set("set-name", "Hook box");
    set("set-price", "30");
    act("save-set");
    const box = () => store.toolSets.find((s) => s.name === "Hook box");
    await waitFor(() => !!box() && !!modal()?.querySelector(".tool-set-list"), "the hook box");
    check(results, "a set made under Sets, its piece ticked", box()!.price === 30 && store.tools.find((t) => t.id === hook.id)!.setId === box()!.id);
    // Changed: a piece left out leaves it.
    modal()!.querySelector<HTMLElement>(`[data-act="edit-set"][data-id="${twist()!.id}"]`)!.click();
    await waitFor(() => !!field("set-name"), "the set's form");
    tick(pieces[2].id, false);
    act("save-set");
    await waitFor(() => !!modal()?.querySelector(".tool-set-list") && store.tools.filter((t) => t.setId === twist()!.id).length === 2, "the set changed");
    check(results, "…and a piece left out of a set is in none", !store.tools.find((t) => t.id === pieces[2].id)!.setId);
    // Removed: asked first; its pieces stay.
    modal()!.querySelector<HTMLElement>(`[data-act="remove-set"][data-id="${box()!.id}"]`)!.click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the question");
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => !box(), "the box removed");
    check(results, "a set removed leaves its pieces, in no set", !!store.tools.find((t) => t.id === hook.id) && !store.tools.find((t) => t.id === hook.id)!.setId);
    act("close");
    await waitFor(() => !modal(), "Sets closed");
    const after = await total();
    await waitFor(() => header().includes(`cost ${money(after.total, "EUR")}`), "the header again");
    check(results, "the header is current after Sets: the hook alone again", after.total === 102.4, JSON.stringify(after));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"], .modal-backdrop:not(.hidden) [data-act="close"]')?.click();
    for (const t of store.tools.filter((x) => !before.tools.includes(x.id))) await invoke("delete_tool", { id: t.id }).catch(() => {});
    for (const s of [...store.toolSets]) await invoke("delete_tool_set", { id: s.id }).catch(() => {});
    store.currency = before.currency;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__toolPriceChecks = verifyToolPrices;
