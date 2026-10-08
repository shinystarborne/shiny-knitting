/**
 * Checks for a pattern whose file has gone missing, clicked through: its card
 * says so, opening it offers to find the file rather than a reader on
 * nothing, a file of the wrong kind is refused, and the right one brings it
 * back.
 *
 * Run with the harness open:
 *   window.__missingFileChecks()
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

export async function verifyMissingFile() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __nextDialogPick?: string | null; __store: { patterns: { id: string; fileGone?: boolean; format: string }[] } };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const lost = w.__store.patterns.find((p) => p.format === "pdf" && p.id !== "p1")!;
  const card = () => document.querySelector<HTMLElement>(`.library .card[data-open="${lost.id}"]`);
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");

  try {
    lost.fileGone = true;
    tab("projects");
    tab("patterns");
    await waitFor(() => !!card(), "the library");
    check(results, "a pattern whose file is gone says so on its card", !!card()!.querySelector(".cover-missing") && /File missing/.test(card()!.textContent ?? ""));

    card()!.querySelector("h3")!.click();
    await waitFor(() => !!dialog(), "the question");
    check(results, "opened, it explains and offers to find the file, not a reader on nothing", /not in the library any more/.test(dialog()!.textContent ?? "") && !document.querySelector(".reader"));
    w.__nextDialogPick = "C:/Downloads/socks.epub";
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await wait(500);
    check(results, "a file of the wrong kind is refused", lost.fileGone === true && !!card()?.querySelector(".cover-missing"));

    w.__nextDialogPick = "C:/Downloads/socks.pdf";
    (card()!.querySelector('[data-act="relink"]') as HTMLElement).click();
    await waitFor(() => !card()?.querySelector(".cover-missing"), "the card to be whole again");
    check(results, "Find it… with the file brings it back", w.__store.patterns.find((p) => p.id === lost.id)!.fileGone === false);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    lost.fileGone = false;
    w.__nextDialogPick = null;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__missingFileChecks = verifyMissingFile;
