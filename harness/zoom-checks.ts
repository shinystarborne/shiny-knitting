/**
 * Checks for a pattern's zoom, clicked through: zoomed in, it opens zoomed in
 * the next time; another pattern keeps its own.
 *
 * Run with the harness open:
 *   window.__zoomChecks()
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

type Store = { patterns: { id: string; zoom?: number; format: string }[] };

export async function verifyZoom() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const readout = () => document.querySelector<HTMLElement>(".reader [data-zoom-pct]")?.textContent ?? "";
  const pattern = "p1";
  const other = store.patterns.find((p) => p.id !== pattern && p.format === "pdf")!.id;
  const saved = store.patterns.find((p) => p.id === pattern)!.zoom;

  const open = async (id: string) => {
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${id}"]`), "the library");
    (document.querySelector(`.library [data-open="${id}"]`) as HTMLElement).click();
    await waitFor(() => /%$/.test(readout()) && !!document.querySelector(".reader .pdf-page, .reader canvas"), "the pattern");
    await wait(300);
  };

  try {
    store.patterns.find((p) => p.id === pattern)!.zoom = 1;
    await open(pattern);
    check(results, "a pattern opens at fit-width until it is zoomed", readout() === "100%", readout());
    for (let i = 0; i < 2; i++) {
      (document.querySelector('.reader [data-act="zoom-in"]') as HTMLElement).click();
      await wait(250);
    }
    await waitFor(() => readout() === "144%", "two steps in");
    await waitFor(() => Math.abs((store.patterns.find((p) => p.id === pattern)!.zoom ?? 1) - 1.44) < 0.01, "the zoom to be kept");
    check(results, "zoomed, the zoom is kept with the pattern", true);

    await open(other);
    check(results, "another pattern keeps its own", readout() === `${Math.round((store.patterns.find((p) => p.id === other)!.zoom ?? 1) * 100)}%`, readout());

    await open(pattern);
    await waitFor(() => readout() === "144%", "the zoom put back", 8000);
    check(results, "opened again, it is as far zoomed as it was", readout() === "144%", readout());
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.patterns.find((p) => p.id === pattern)!.zoom = saved ?? 1;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__zoomChecks = verifyZoom;
