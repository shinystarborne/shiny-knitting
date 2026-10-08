/**
 * Checks for the highlight line's direction, on the live reader: counting a
 * row steps the line down the page for written instructions, and up it for
 * a chart, which is read from the bottom row up.
 *
 * Run with the harness open:
 *   window.__chartLineChecks()
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

type Highlight = { enabled: boolean; readsUp?: boolean; thickness: number; offsetY: number; animate: boolean };

export async function verifyChartLine() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { highlights: Map<string, Highlight> } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const line = () => document.querySelector<HTMLElement>(".reader .highlight-line");
  const top = () => parseFloat(line()?.style.top || "0");
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const press = () => scroller().dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true, cancelable: true }));
  const pattern = "p1";
  const saved = { ...store.highlights.get(pattern)! };

  const open = async (readsUp: boolean) => {
    // Halfway down, a 20 px row, no animation: one press is one clear step either way.
    store.highlights.set(pattern, { ...saved, enabled: true, readsUp, thickness: 20, offsetY: 0.5, animate: false });
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!line() && top() > 0 && !!document.querySelector(".reader .counter"), "the line");
    await wait(300);
  };

  try {
    await open(false);
    const before = top();
    press();
    await waitFor(() => top() !== before, "the line to move");
    check(results, "for written instructions, counting a row steps the line down the page", top() > before, `${before} → ${top()}`);

    await open(true);
    const start = top();
    press();
    await waitFor(() => top() !== start, "the line to move");
    check(results, "for a chart, counting a row steps the line up the page, as a chart is read", top() < start, `${start} → ${top()}`);
    const panelBox = () => document.querySelector<HTMLInputElement>('.reader [data-f="readsUp"]');
    check(results, "the line's settings say so: Rows go up the page (a chart)", !panelBox() || panelBox()!.checked, "the box is unticked");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.highlights.set(pattern, saved);
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__chartLineChecks = verifyChartLine;
