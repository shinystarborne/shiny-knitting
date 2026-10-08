/**
 * Checks for two patterns side by side, clicked through: Beside… opens another
 * pattern next to this one, each with its own zoom and scroll; it is there
 * again when the pattern is opened again; ✕ closes it.
 *
 * Run with the harness open:
 *   window.__besideChecks()
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

export async function verifyBeside() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const main = () => document.querySelector<HTMLElement>(".screen > .reader, .reader:not(.beside-pane .reader)");
  const beside = () => document.querySelector<HTMLElement>(".beside-pane .reader");
  const pattern = "p1";
  const other = "p3";

  const open = async () => {
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.reader [data-act="beside"]') && !!document.querySelector(".reader .pdf-page"), "the pattern");
  };

  try {
    for (const key of [`beside:${pattern}`, `pages:${pattern}`, `pages:${other}`]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing kept.
      }
    }
    await open();
    (document.querySelector('.reader [data-act="beside"]') as HTMLElement).click();
    const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "the choice of pattern");
    const list = dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!;
    check(results, "Beside… offers the other patterns, not this one", ![...list.options].some((o) => o.value === pattern) && [...list.options].some((o) => o.value === other));
    list.value = other;
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await waitFor(() => !!beside()?.querySelector(".pdf-page"), "the pattern beside");
    check(results, "the other pattern opens beside it, a reader of its own", !!main()?.classList.contains("with-beside") && document.querySelectorAll(".reader .doc-scroller").length === 2 && /Long Sock/.test(beside()!.querySelector(".reader-bar")?.textContent ?? ""));
    check(results, "…for reading and marking: no counter, no line, a ✕ to close it", !beside()!.querySelector(".counter, .highlight-line, [data-act='highlight-cfg']") && !!beside()!.querySelector('[data-act="close-beside"]') && !!beside()!.querySelector('[data-mark="highlight"]'));
    (beside()!.querySelector('[data-act="zoom-in"]') as HTMLElement).click();
    await wait(300);
    const zooms = [...document.querySelectorAll<HTMLElement>(".reader [data-zoom-pct]")].map((z) => z.textContent);
    check(results, "each has its own zoom", zooms.length === 2 && zooms[0] !== zooms[1], zooms.join(" / "));

    await open();
    await waitFor(() => !!beside()?.querySelector(".pdf-page"), "the pattern beside again");
    check(results, "opened again, the pattern beside is there again", true);

    (beside()!.querySelector('[data-act="close-beside"]') as HTMLElement).click();
    await waitFor(() => !beside(), "the pattern beside to close");
    let kept: string | null = "?";
    try {
      kept = localStorage.getItem(`beside:${pattern}`);
    } catch {
      kept = null;
    }
    check(results, "✕ closes it, and the pattern opens alone again", !main()?.classList.contains("with-beside") && kept === null);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    try {
      localStorage.removeItem(`beside:${pattern}`);
    } catch {
      // Nothing kept.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__besideChecks = verifyBeside;
