/**
 * Checks for light reading: ☀ in the reader bar turns the reader light, every
 * pattern opens so after, and ☾ turns it dark again; the rest of the app stays.
 *
 * Run with the harness open:
 *   window.__themeChecks()
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

export async function verifyTheme() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const reader = () => document.querySelector<HTMLElement>(".reader");
  const button = () => document.querySelector<HTMLElement>('.reader [data-act="theme"]');
  const open = async (id: string) => {
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${id}"]`), "the library");
    (document.querySelector(`.library [data-open="${id}"]`) as HTMLElement).click();
    await waitFor(() => !!button(), "the reader");
  };

  try {
    try {
      localStorage.removeItem("reader-theme");
    } catch {
      // Nothing kept.
    }
    await open("p1");
    check(results, "the reader is dark until asked", !reader()!.classList.contains("light") && button()!.textContent === "☀");
    button()!.click();
    check(results, "☀ turns it light", reader()!.classList.contains("light") && button()!.textContent === "☾" && getComputedStyle(reader()!).getPropertyValue("--bg").trim() === "#f3f0e8");
    check(results, "…the rest of the app stays dark", getComputedStyle(document.querySelector<HTMLElement>(".tab-bar")!).getPropertyValue("--bg").trim() === "#14161a");
    await open("p3");
    check(results, "every pattern opens light after", reader()!.classList.contains("light"));
    button()!.click();
    check(results, "☾ turns it dark again", !reader()!.classList.contains("light"));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    try {
      localStorage.removeItem("reader-theme");
    } catch {
      // Nothing kept.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__themeChecks = verifyTheme;
