/**
 * Checks for a PDF's page number and its place on a resize, clicked
 * through: the bar says which page is in view of how many, following the
 * reading; a click on it goes to another page; and the reader made narrower
 * keeps the same spot of the same page where it was in the pane.
 *
 * Run with the harness open:
 *   window.__pageNumberChecks()
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

type Store = { patterns: { id: string; fileName: string }[] };

export async function verifyPageNumber() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const readout = () => document.querySelector<HTMLElement>(".reader [data-page-readout]");
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const pages = () => [...document.querySelectorAll<HTMLElement>(".reader .pdf-page")];
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  /** The page at a third of the way down the pane, and how far down it. */
  const spot = () => {
    const sr = scroller().getBoundingClientRect();
    const y = sr.top + scroller().clientHeight * 0.35;
    const i = pages().findIndex((p) => p.getBoundingClientRect().bottom > y);
    const r = pages()[i].getBoundingClientRect();
    return { page: i + 1, share: (y - r.top) / r.height };
  };
  const long = store.patterns.find((p) => p.fileName === "long-pattern.pdf")!;

  try {
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library"), "the library");
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-pattern", { bubbles: true, detail: long.id }));
    await waitFor(() => /^\d+ \/ \d+$/.test(readout()?.textContent ?? "") && pages().length > 5, "the page number");
    scroller().scrollTop = 0;
    await wait(200);
    const total = Number(readout()!.textContent!.split(" / ")[1]);
    check(results, "a PDF says which page is in view, of how many", readout()!.textContent === `1 / ${total}` && total === pages().length, readout()!.textContent ?? "");

    const third = pages()[2];
    scroller().scrollTop = third.offsetTop + 20;
    await waitFor(() => readout()!.textContent === `3 / ${total}`, "page 3 in view").catch(() => {
      throw new Error(`page 3 in view: it says ${readout()!.textContent}; scrollTop ${scroller().scrollTop}, page 3 at ${third.offsetTop} (${third.offsetHeight} tall), pane ${scroller().clientHeight}`);
    });
    check(results, "…following the reading: scrolled to page 3, it says 3", true);

    readout()!.click();
    await waitFor(() => !!dialog(), "the question");
    dialog()!.querySelector<HTMLInputElement>("input")!.value = "5";
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => readout()!.textContent === `5 / ${total}`, "page 5");
    check(results, "a click on it goes to the page asked for", spot().page === 5 || spot().page === 4, JSON.stringify(spot()));

    // Made narrower, it keeps the same spot of the same page where it was.
    scroller().scrollTop = pages()[3].offsetTop + pages()[3].offsetHeight * 0.4;
    await wait(400);
    const before = spot();
    const reader = document.querySelector<HTMLElement>(".reader")!;
    reader.style.width = "55%";
    await wait(1500);
    const after = spot();
    check(results, "made narrower, the pages keep the same spot where it was in the pane", after.page === before.page && Math.abs(after.share - before.share) < 0.03, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    reader.style.width = "";
    await wait(1500);
    const back = spot();
    check(results, "…and wider again too", back.page === before.page && Math.abs(back.share - before.share) < 0.03, `${JSON.stringify(before)} → ${JSON.stringify(back)}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__pageNumberChecks = verifyPageNumber;
