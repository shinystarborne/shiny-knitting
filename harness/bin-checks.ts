/**
 * Checks for removing a pattern, clicked through: it goes at once, with Undo
 * for a few seconds; it waits in the Bin, to restore or delete for good; and
 * the Bin can be emptied.
 *
 * Run with the harness open:
 *   window.__binChecks()
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

async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(30);
  }
}

type Store = { patterns: { id: string }[]; bin?: { id: string }[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyBin() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const card = (id: string) => document.querySelector<HTMLElement>(`.library [data-open="${id}"]`);
  const toast = () => document.querySelector<HTMLElement>(".undo-toast");
  const binButton = () => document.querySelector<HTMLElement>('.library [data-act="bin"]');
  const bin = () => document.querySelector<HTMLElement>(".dialog-card.bin-dialog");
  const inBin = (id: string) => (store.bin ?? []).some((p) => p.id === id);
  const made: string[] = [];

  try {
    const add = async (title: string) => {
      const p = await invoke<{ id: string }>("add_pattern", {
        input: { title, designer: "Bin tester", fileName: `${title}.pdf`, sourcePath: `C:/patterns/${title}.pdf`, status: "", difficulty: "", needleSize: "", tags: [], notes: "" },
      });
      made.push(p.id);
      return p.id;
    };
    const shawl = await add("Bin shawl");
    const hat = await add("Bin hat");
    tab("projects");
    tab("patterns");
    await waitFor(() => !!card(shawl) && !!card(hat), "the new patterns' cards");

    (card(shawl)!.querySelector("[data-delete]") as HTMLElement).click();
    await waitFor(() => !card(shawl) && !!toast(), "the pattern to go");
    check(results, "Remove takes a pattern out at once, asking nothing", !document.querySelector(".dialog-card") && inBin(shawl));
    check(results, "…and says it is in the Bin, with Undo", /Removed “Bin shawl”\. It is in the Bin for 30 days\./.test(toast()!.textContent ?? ""), toast()!.textContent ?? "");
    await waitFor(() => !binButton()!.hidden, "the Bin button");
    check(results, "the library's Bin button says how many are in it", binButton()!.textContent === "Bin (1)", binButton()!.textContent ?? "");

    (toast()!.querySelector("button") as HTMLElement).click();
    await waitFor(() => !!card(shawl), "Undo to bring it back");
    check(results, "Undo brings it back, and the Bin is empty again", !toast() && !inBin(shawl));
    await waitFor(() => binButton()!.hidden, "the Bin button to go");

    // In the Bin: restore one, delete one for good.
    for (const id of [shawl, hat]) {
      (card(id)!.querySelector("[data-delete]") as HTMLElement).click();
      await waitFor(() => !card(id), "the pattern to go");
    }
    await waitFor(() => binButton()!.textContent === "Bin (2)", "two in the Bin");
    toast()?.remove();
    binButton()!.click();
    await waitFor(() => !!bin()?.querySelector(".bin-list"), "the Bin");
    const rows = () => [...bin()!.querySelectorAll<HTMLElement>(".bin-list li")];
    check(results, "the Bin lists what was removed, the latest first, saying when", rows().map((r) => r.dataset.id).join() === [hat, shawl].join() && /Removed \d+ \w+ \d{4}/.test(rows()[0].textContent ?? ""), rows().map((r) => r.textContent).join(" | "));
    (rows().find((r) => r.dataset.id === shawl)!.querySelector('[data-bin="restore"]') as HTMLElement).click();
    await waitFor(() => rows().length === 1 && !!card(shawl), "the restore");
    check(results, "Restore puts it back in the library", !inBin(shawl) && store.patterns.some((p) => p.id === shawl));

    (rows()[0].querySelector('[data-bin="delete"]') as HTMLElement).click();
    const confirm = () => [...document.querySelectorAll<HTMLElement>(".dialog-card")].find((d) => /Delete “Bin hat” for good/.test(d.textContent ?? ""));
    await waitFor(() => !!confirm(), "the question");
    check(results, "Delete for good asks first", /cannot be undone/.test(confirm()!.textContent ?? ""));
    (confirm()!.querySelector("button.danger") as HTMLElement).click();
    await waitFor(() => !inBin(hat) && /The Bin is empty/.test(bin()?.textContent ?? ""), "the deletion");
    check(results, "…and then it is gone for good", !store.patterns.some((p) => p.id === hat) && !inBin(hat));
    (bin()!.querySelector('[data-bin="close"]') as HTMLElement).click();
    await waitFor(() => !bin() && binButton()!.hidden, "the Bin to close");

    // Empty the bin.
    (card(shawl)!.querySelector("[data-delete]") as HTMLElement).click();
    await waitFor(() => !card(shawl) && !binButton()!.hidden, "the pattern in the Bin");
    toast()?.remove();
    binButton()!.click();
    await waitFor(() => !!bin()?.querySelector('[data-bin="empty"]'), "the Bin");
    (bin()!.querySelector('[data-bin="empty"]') as HTMLElement).click();
    const emptyAsk = () => [...document.querySelectorAll<HTMLElement>(".dialog-card")].find((d) => /Delete all 1 for good/.test(d.textContent ?? ""));
    await waitFor(() => !!emptyAsk(), "the question");
    (emptyAsk()!.querySelector("button.danger") as HTMLElement).click();
    await waitFor(() => /The Bin is empty/.test(bin()?.textContent ?? ""), "the Bin emptied");
    check(results, "Empty the bin deletes everything in it for good", !(store.bin ?? []).length && !store.patterns.some((p) => p.id === shawl));
    (bin()!.querySelector('[data-bin="close"]') as HTMLElement).click();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    toast()?.remove();
    for (const id of made) await invoke("delete_pattern", { id }).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__binChecks = verifyBin;
