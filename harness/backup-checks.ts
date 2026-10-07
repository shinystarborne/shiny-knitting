/**
 * Checks for Make a backup, in Settings: it says when the last one was made,
 * asks where with today's date in the name, says how far it has got while it
 * copies, and what it saved; cancelled, it saves nothing.
 *
 * Run with the harness open:
 *   window.__backupChecks()
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

type Store = { backupTo?: string | null; backupName?: string; lastBackup?: unknown };

export async function verifyBackup() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const settingsButton = () => document.querySelector<HTMLElement>('button[data-act="settings"]');
  const dialog = () => document.querySelector<HTMLElement>("#app .modal-backdrop:not(.hidden) .modal");
  const result = () => dialog()?.querySelector<HTMLElement>('[data-el="backup-result"]')?.textContent ?? "";
  const button = () => dialog()!.querySelector<HTMLButtonElement>('[data-act="backup"]')!;
  const open = async () => {
    settingsButton()!.click();
    await waitFor(() => !!dialog()?.querySelector('[data-act="backup"]'), "the settings' backup");
  };
  const close = async () => {
    (dialog()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !dialog(), "the settings to close");
  };

  try {
    delete store.lastBackup;
    await open();
    await waitFor(() => !!result(), "what Settings says of backups");
    check(results, "Settings has Make a backup, and says when none was made", /No backup made yet/.test(result()), result());

    store.backupTo = null;
    button().click();
    await waitFor(() => !button().disabled, "the cancelled backup");
    check(results, "cancelled in the save dialog, nothing is saved", !store.lastBackup && /No backup made yet/.test(result()), result());

    delete store.backupTo;
    button().click();
    await waitFor(() => /Copying \d+ of \d+ files/.test(result()), "the progress");
    check(results, "while it copies, it says how far it has got, and the button waits", button().disabled, result());
    await waitFor(() => /Backup saved/.test(result()), "the backup", 20000);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `Shiny Knitting backup ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.zip`;
    check(results, "the save dialog suggests a name with today's date", store.backupName === name, store.backupName ?? "");
    check(results, "done, it says how many files, how big, and where", /Backup saved: \d+ files, 6\.1 GB, in D:\/Backups\/Shiny Knitting backup/.test(result()) && !button().disabled, result());
    await close();

    await open();
    await waitFor(() => /Last backup/.test(result()), "the last backup");
    check(results, "opened again, Settings says when the last backup was made", /Last backup: \d+ \w+ \d{4}, \d+ files, 6\.1 GB/.test(result()), result());
    await close();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (dialog()) (dialog()!.querySelector('[data-act="close"]') as HTMLElement | null)?.click();
    delete store.backupTo;
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__backupChecks = verifyBackup;
