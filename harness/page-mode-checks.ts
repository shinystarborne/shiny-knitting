/**
 * Checks for reading a page at a time, clicked through on a 40-page PDF:
 * Pages fits a page whole; the arrows, the side buttons and a sideways swipe
 * turn it; it is remembered for the pattern; switched off, the zoom is back.
 *
 * Run with the harness open:
 *   window.__pageModeChecks()
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

export async function verifyPageMode() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const pageEl = (n: number) => document.querySelector<HTMLElement>(`.reader .pdf-page[data-page="${n}"]`)!;
  const button = () => document.querySelector<HTMLElement>('.reader [data-act="page-mode"]');
  const readout = () => document.querySelector<HTMLElement>(".reader [data-zoom-pct]")?.textContent ?? "";
  const pageInView = () => {
    const top = scroller().scrollTop;
    let best = 1;
    for (let n = 1; pageEl(n); n++) if (pageEl(n).offsetTop <= top + 8) best = n;
    return best;
  };
  const pattern = "p3";

  const open = async () => {
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!button() && !!pageEl(40) && /%$/.test(readout()), "the 40 pages");
    await wait(400);
  };
  const key = (k: string) => scroller().dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true }));

  try {
    try {
      localStorage.removeItem(`pages:${pattern}`);
    } catch {
      // Nothing kept.
    }
    await open();
    const zoomBefore = readout();
    button()!.click();
    await waitFor(() => scroller().classList.contains("page-mode") && readout() !== zoomBefore, "a page fitted whole");
    await wait(300);
    check(results, "Pages fits a whole page to the pane", pageEl(1).getBoundingClientRect().height <= scroller().clientHeight + 1, `${pageEl(1).getBoundingClientRect().height} in ${scroller().clientHeight}`);
    check(results, "…with the page-turning buttons at its sides", getComputedStyle(document.querySelector<HTMLElement>(".reader .page-turn.next")!).display !== "none");

    key("ArrowRight");
    await waitFor(() => pageInView() === 2, "the next page");
    key("PageDown");
    await waitFor(() => pageInView() === 3, "the page after");
    key("ArrowLeft");
    await waitFor(() => pageInView() === 2, "the page before");
    check(results, "→ and PageDown turn to the next page, ← back", true);
    (document.querySelector(".reader .page-turn.next") as HTMLElement).click();
    await waitFor(() => pageInView() === 3, "the button's next page");
    check(results, "…and so does the › at the side", true);
    for (let i = 0; i < 3; i++) scroller().dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 2, bubbles: true, cancelable: true }));
    await waitFor(() => pageInView() === 4, "a swipe to the next page");
    check(results, "a sideways swipe turns the page", true);

    await open();
    await waitFor(() => scroller().classList.contains("page-mode"), "page mode again");
    check(results, "the pattern opens a page at a time again", button()!.classList.contains("on"));
    button()!.click();
    await waitFor(() => !scroller().classList.contains("page-mode"), "the pages in a scroll");
    await waitFor(() => readout() === zoomBefore, "the zoom back");
    check(results, "switched off, the pages scroll again at the zoom they had", readout() === zoomBefore, readout());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    try {
      localStorage.removeItem(`pages:${pattern}`);
    } catch {
      // Nothing kept.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__pageModeChecks = verifyPageMode;
