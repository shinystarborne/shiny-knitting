/**
 * Checks that a dialog closed any way at all is gone for good: nothing of it
 * goes on answering for the next one, or holds the keyboard.
 *
 * - Details opened for one pattern and closed (Cancel, Escape), then opened
 *   for another and saved: one update, for the pattern on screen.
 * - Settings opened and closed twice, then saved: saved once.
 * - The yarn and wish forms closed with Escape stop listening for a pasted
 *   picture, as they do when closed with Cancel.
 * - The shared questions (say, askYesNo, askText, askForm, askChoice) closed
 *   by their buttons, Escape, Enter or the backdrop, one over another, or
 *   taken off the page some other way: none left holding the keyboard, so a
 *   key pressed afterwards reaches the page.
 *
 * Run with the harness open:
 *   window.__dialogCloseChecks()
 */
import { askChoice, askForm, askText, askYesNo, dialogOpen, say } from "../src/dialogs";

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

type Internals = { invoke(c: string, a?: unknown, o?: unknown): Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
const escape = (target: EventTarget = document.activeElement ?? document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));

async function pngFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 20;
  canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "pasted.png", { type: "image/png" });
}

/** Whether a picture pasted with nothing focused is taken by anything. */
async function pasteTaken(): Promise<boolean> {
  const data = new DataTransfer();
  data.items.add(await pngFile());
  const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  document.body.dispatchEvent(paste);
  return paste.defaultPrevented;
}

/** Details from a card's ⋯ menu. */
async function details(id: string): Promise<void> {
  document.querySelector<HTMLElement>(`.library [data-act="more"][data-id="${id}"]`)!.click();
  await waitFor(() => !!document.querySelector('.card-menu [data-menu="details"]'), "the card menu");
  document.querySelector<HTMLElement>('.card-menu [data-menu="details"]')!.click();
  await waitFor(() => !!modal()?.querySelector('[data-f="title"]'), "Details");
}

export async function verifyDialogClose() {
  const results: CheckResult[] = [];
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const inner = internals().invoke;
  internals().invoke = (cmd, args, o) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    return inner(cmd, args, o);
  };
  const titles: Record<string, string> = {};
  try {
    tab("projects");
    tab("patterns");
    await waitFor(() => document.querySelectorAll('.library [data-act="more"]').length >= 3, "the library");
    const ids = [...document.querySelectorAll<HTMLElement>('.library [data-act="more"]')].slice(0, 3).map((b) => b.dataset.id!);

    // ---- Details: one save, one pattern ----
    await details(ids[0]);
    titles[ids[0]] = modal()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value;
    (modal()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
    await waitFor(() => !modal(), "Details to close");
    await details(ids[1]);
    titles[ids[1]] = modal()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value;
    escape();
    await waitFor(() => !modal(), "Details to close with Escape");
    await details(ids[2]);
    titles[ids[2]] = modal()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value;
    modal()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value = `${titles[ids[2]]} (edited)`;
    calls.length = 0;
    (modal()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !modal(), "Details to save");
    await wait(300);
    const updates = calls.filter((c) => c.cmd === "update_pattern").map((c) => (c.args.pattern as { id: string }).id);
    check(results, "Details closed by Cancel and by Escape, then saved for another: one update, for that one", updates.length === 1 && updates[0] === ids[2], JSON.stringify(updates));

    // ---- Settings: reopened, saved once ----
    const settingsUp = () => !!modal()?.querySelector('[data-act="test"]');
    for (const close of ["button", "escape"]) {
      (document.querySelector('.tab-bar [data-act="settings"]') as HTMLElement).click();
      await waitFor(settingsUp, "Settings");
      if (close === "escape") escape();
      else (modal()!.querySelector('[data-act="close"]') as HTMLElement).click();
      await waitFor(() => !modal(), "Settings to close");
    }
    (document.querySelector('.tab-bar [data-act="settings"]') as HTMLElement).click();
    await waitFor(settingsUp, "Settings");
    await wait(150);
    calls.length = 0;
    (modal()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !modal(), "Settings to save");
    await wait(300);
    check(results, "Settings closed twice, then saved: saved once", calls.filter((c) => c.cmd === "save_ai_settings").length === 1, JSON.stringify(calls.map((c) => c.cmd)));

    // ---- Forms that listen on the document let go on Escape ----
    const screen = document.querySelector<HTMLElement>(".library")!;
    check(results, "with no form up, a pasted picture is left alone", !(await pasteTaken()));
    for (const [event, name] of [["add-yarn", "yarn"], ["add-wish", "wish"]] as const) {
      screen.dispatchEvent(new CustomEvent(event, { bubbles: true }));
      await waitFor(() => !!modal(), `the ${name} form`);
      escape();
      await waitFor(() => !modal(), `the ${name} form to close with Escape`);
      check(results, `the ${name} form closed with Escape no longer takes a pasted picture`, !(await pasteTaken()));
    }

    // ---- The shared questions: nothing left holding the keyboard ----
    let heard = 0;
    const listen = (e: KeyboardEvent) => {
      if (e.key === "j") heard++;
    };
    document.addEventListener("keydown", listen);
    const top = () => [...document.querySelectorAll<HTMLElement>(".dialog-backdrop")].at(-1)!;
    const key = (k: string, target: EventTarget = document.activeElement ?? document.body) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true }));
    const backdrop = (o: HTMLElement) => {
      o.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      o.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    const free = () => {
      heard = 0;
      key("j", document.body);
      return !dialogOpen() && heard === 1 && !document.querySelector(".dialog-backdrop");
    };
    const ways: [string, () => Promise<unknown>, (o: HTMLElement) => void][] = [
      ["a message closed with OK", () => say("x"), (o) => o.querySelector("button")!.click()],
      ["a message closed with Escape", () => say("x"), () => escape()],
      ["a message closed on the backdrop", () => say("x"), backdrop],
      ["a confirmation cancelled", () => askYesNo("x"), (o) => o.querySelector<HTMLElement>("button.ghost")!.click()],
      ["a confirmation closed with Escape", () => askYesNo("x"), () => escape()],
      ["a confirmation closed on the backdrop", () => askYesNo("x"), backdrop],
      ["a confirmation answered", () => askYesNo("x"), (o) => o.querySelector<HTMLElement>("button.primary")!.click()],
      ["a text question closed with Escape", () => askText("x"), () => escape()],
      ["a text question answered with Enter", () => askText("x"), (o) => key("Enter", o.querySelector("input")!)],
      ["a form (as the counter's) closed with Escape", () => askForm([{ label: "Name" }, { label: "Rows", type: "number" }]), () => escape()],
      ["a form cancelled", () => askForm([{ label: "Name" }]), (o) => o.querySelector<HTMLElement>("button.ghost")!.click()],
      ["a form saved with Enter", () => askForm([{ label: "Name" }]), (o) => key("Enter", o.querySelector("input")!)],
      ["a list closed with Escape", () => askChoice("x", [{ value: "a", label: "a" }]), () => escape()],
    ];
    for (const [what, open, close] of ways) {
      const answered = open();
      await wait(30);
      close(top());
      await Promise.race([answered, wait(500)]);
      check(results, `${what}: keys reach the page again`, free());
    }
    void askYesNo("under");
    await wait(20);
    void askYesNo("over");
    await wait(20);
    escape();
    await wait(20);
    check(results, "one question over another: Escape closes the top one only", document.querySelectorAll(".dialog-backdrop").length === 1 && /under/.test(top().textContent ?? ""));
    escape();
    await wait(20);
    check(results, "…and the next Escape the other, keys reaching the page again", free());
    void askYesNo("taken off");
    await wait(20);
    top().remove();
    check(results, "a question taken off the page some other way does not hold the keyboard", free());
    document.removeEventListener("keydown", listen);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    internals().invoke = inner;
    for (let i = 0; i < 5 && document.querySelector(".dialog-backdrop"); i++) escape();
    if (modal()) escape();
    for (const [id, title] of Object.entries(titles)) {
      const store = (window as unknown as { __store: { patterns: { id: string; title: string }[] } }).__store;
      const p = store.patterns.find((x) => x.id === id);
      if (p) p.title = title;
    }
    tab("projects");
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__dialogCloseChecks = verifyDialogClose;
