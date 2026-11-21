/**
 * Checks that the cards which open on a click open from the keyboard too.
 *
 * - opensFromKey: Enter or Space on a card itself; not on a button inside
 *   it, not with Ctrl, not on a held key.
 * - On the Patterns, Projects, Stash, Needles & hooks, Wishlist, Shops and
 *   People tabs every opening card is a tab stop.
 * - Enter on a stash card opens its yarn, as a click does; Space on a
 *   wishlist card opens its wish.
 *
 * Run with the harness open:
 *   window.__cardKeyChecks()
 */
import { opensFromKey } from "../src/views/card-keys";
import { keep } from "./keep";

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

const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
const key = (target: EventTarget, k: string, more: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
type Internals = { invoke(c: string, a?: unknown, o?: unknown): Promise<unknown> };
const invoke = (c: string, a?: unknown) => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__.invoke(c, a);
const visibleCards = () => [...document.querySelectorAll<HTMLElement>("[data-open], [data-open-chart]")].filter((c) => c.offsetParent !== null);

async function verifyCardKeys(): Promise<{ ok: boolean; results: CheckResult[]; failed: string[] }> {
  const results: CheckResult[] = [];
  // A project of its own, so the Projects tab has a card whatever ran before.
  const restore = keep(["projects", "projectLog"]);
  try {
    await invoke("add_project", { input: { name: "Reached from the keyboard", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    // The rule itself.
    const card = document.createElement("article");
    card.dataset.open = "x";
    card.tabIndex = 0;
    const inner = document.createElement("button");
    card.append(inner);
    document.body.append(card);
    const ev = (target: EventTarget, k: string, more: Partial<KeyboardEvent> = {}) =>
      ({ key: k, target, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...more }) as KeyboardEvent;
    check(results, "Enter on a card opens it", opensFromKey(ev(card, "Enter")));
    check(results, "Space on a card opens it", opensFromKey(ev(card, " ")));
    check(results, "a button inside the card keeps its own keys", !opensFromKey(ev(inner, "Enter")));
    check(results, "Ctrl+Enter is not an open", !opensFromKey(ev(card, "Enter", { ctrlKey: true })));
    check(results, "a held key does not open it again", !opensFromKey(ev(card, "Enter", { repeat: true })));
    check(results, "another key does nothing", !opensFromKey(ev(card, "a")));
    card.remove();

    // Every opening card on these tabs is a tab stop.
    for (const name of ["patterns", "projects", "stash", "tools", "wishlist", "shops", "people"]) {
      tab(name);
      // Another suite may have left a project page open, or the Plans or
      // Gallery view on: back to the cards.
      if (name === "projects") {
        await wait(300);
        document.querySelector<HTMLElement>('.project-page [data-act="back"]')?.click();
        await wait(200);
        document.querySelector<HTMLElement>('.projects [data-act="mode"][data-mode="projects"]')?.click();
      }
      await waitFor(() => visibleCards().length > 0, `${name} cards`, 4000).catch(() => {});
      const cards = visibleCards();
      const missing = cards.filter((c) => c.tabIndex !== 0);
      check(results, `${name}: every card is a tab stop`, cards.length > 0 && missing.length === 0, `${cards.length} cards, ${missing.length} not reachable`);
    }

    // Enter on a stash card opens its yarn.
    tab("stash");
    await waitFor(() => visibleCards().length > 0, "stash cards");
    const yarn = visibleCards()[0];
    yarn.focus();
    check(results, "a stash card takes the focus", document.activeElement === yarn);
    key(yarn, "Enter");
    await waitFor(() => !!modal(), "the yarn to open", 4000).catch(() => {});
    check(results, "Enter on a stash card opens its yarn", !!modal());
    if (modal()) key(document.activeElement ?? document.body, "Escape");
    await waitFor(() => !modal(), "the yarn to close", 4000).catch(() => {});

    // Space on a wishlist card opens its wish.
    tab("wishlist");
    await waitFor(() => visibleCards().length > 0, "wishlist cards");
    const wish = visibleCards()[0];
    wish.focus();
    key(wish, " ");
    await waitFor(() => !!modal(), "the wish to open", 4000).catch(() => {});
    check(results, "Space on a wishlist card opens its wish", !!modal());
    if (modal()) key(document.activeElement ?? document.body, "Escape");
    await waitFor(() => !modal(), "the wish to close", 4000).catch(() => {});
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (modal()) key(document.body, "Escape");
    restore();
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__cardKeyChecks = verifyCardKeys;
