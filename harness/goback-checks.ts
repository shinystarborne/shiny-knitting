/**
 * Checks for going back to the previous version: the app says it has opened
 * (so the crash guard asks nothing next time); in Settings, Go back says when
 * there is nothing to go back to, and otherwise asks, then downloads and
 * installs the version before.
 *
 * Run with the harness open:
 *   window.__goBackChecks()
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
    await wait(40);
  }
}

export async function verifyGoBack() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { appStarted?: number; previousVersion?: unknown }; __installedUpdate?: string };
  const store = w.__store;
  const dialog = () => document.querySelector<HTMLElement>("#app .modal-backdrop:not(.hidden) .modal");
  const result = () => dialog()?.querySelector('[data-el="update-result"]')?.textContent ?? "";
  const open = async () => {
    document.querySelector<HTMLElement>('button[data-act="settings"]')!.click();
    await waitFor(() => !!dialog()?.querySelector('[data-act="go-back"]'), "Settings");
  };
  const close = async () => {
    (dialog()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !dialog(), "Settings closed");
  };
  try {
    check(results, "opened, the app says so, for the crash guard", (store.appStarted ?? 0) >= 1);

    delete store.previousVersion;
    await open();
    (dialog()!.querySelector('[data-act="go-back"]') as HTMLElement).click();
    await waitFor(() => /no earlier version/.test(result()), "the answer");
    check(results, "Go back, with no earlier version, says so", /There is no earlier version to go back to/.test(result()), result());
    await close();

    store.previousVersion = { tag: "v0.3.0-beta.112", name: "Shiny Knitting 0.3.0-beta.112", publishedAt: "", prerelease: true, assetName: "Shiny.Knitting_0.3.112_x64-setup.exe", assetApiUrl: "https://api.github.com/x", sizeBytes: 5, pageUrl: "", version: "0.3.112" };
    w.__installedUpdate = undefined;
    await open();
    (dialog()!.querySelector('[data-act="go-back"]') as HTMLElement).click();
    const ask = () => [...document.querySelectorAll<HTMLElement>(".dialog-card")].find((d) => /Go back to version 0\.3\.112/.test(d.textContent ?? ""));
    await waitFor(() => !!ask(), "the question");
    check(results, "…with one, it asks first, saying the library is kept", /only the app changes/.test(ask()!.textContent ?? ""));
    [...ask()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Go back")!.click();
    await waitFor(() => !!w.__installedUpdate, "the installer started");
    check(results, "…and goes back: the version before downloaded and installed", /ShinyKnitting-update/.test(w.__installedUpdate ?? "") && /Starting the installer/.test(result()), `${w.__installedUpdate} / ${result()}`);
    await close();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    delete store.previousVersion;
    if (dialog()) (dialog()!.querySelector('[data-act="close"]') as HTMLElement | null)?.click();
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__goBackChecks = verifyGoBack;
