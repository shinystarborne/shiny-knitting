/**
 * Checks for opening a pattern's file in its own app: Open ↗ in the reader,
 * and the ⋯ menu's Open in your PDF app in the library, each opening that
 * pattern's file.
 *
 * Run with the harness open:
 *   window.__openExternalChecks()
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

export async function verifyOpenExternal() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __opened?: string[]; __store: { patterns: { id: string; filePath: string }[] } };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const path = (id: string) => w.__store.patterns.find((p) => p.id === id)!.filePath;

  try {
    w.__opened = [];
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-open="p1"]'), "the library");
    (document.querySelector('.library [data-open="p1"] [data-act="more"]') as HTMLElement).click();
    const item = () => document.querySelector<HTMLElement>('[data-menu="external"]');
    await waitFor(() => !!item(), "the ⋯ menu");
    check(results, "a pattern's ⋯ menu has Open in your PDF app", /Open in your PDF app/.test(item()!.textContent ?? ""), item()!.textContent ?? "");
    item()!.click();
    await waitFor(() => w.__opened!.length === 1, "the file to open");
    check(results, "…which opens its file", w.__opened![0] === path("p1"), w.__opened!.join());

    (document.querySelector('.library [data-open="p3"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.reader [data-act="open-external"]'), "the reader");
    (document.querySelector('.reader [data-act="open-external"]') as HTMLElement).click();
    await waitFor(() => w.__opened!.length === 2, "the file to open");
    check(results, "the reader's Open ↗ opens the file being read", w.__opened![1] === path("p3"), w.__opened!.join());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__openExternalChecks = verifyOpenExternal;
