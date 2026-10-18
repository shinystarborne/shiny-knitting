/**
 * Checks for Make a backup, in Settings: it says when the last one was made,
 * asks where with today's date in the name, says how far it has got while it
 * copies, and what it saved; cancelled, it saves nothing. Restoring one says
 * plainly what it does first, saves what is here, says how far it has got,
 * and starts the app again; refused or cancelled, nothing changes.
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

type Store = {
  backupTo?: string | null;
  backupName?: string;
  lastBackup?: unknown;
  restoreFrom?: string | null;
  restoreError?: string;
  restoreBeforeName?: string;
  restarted?: number;
};

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

    // ---------- restoring one ----------
    const restore = () => dialog()!.querySelector<HTMLButtonElement>('[data-act="restore"]')!;
    const restored = () => dialog()?.querySelector<HTMLElement>('[data-el="restore-result"]')?.textContent ?? "";
    const ask = () => [...document.querySelectorAll<HTMLElement>(".dialog-card")].find((d) => /Restore a backup/.test(d.textContent ?? ""));
    const answer = (d: HTMLElement, label: RegExp) => [...d.querySelectorAll<HTMLButtonElement>("button")].find((b) => label.test(b.textContent ?? ""))!.click();
    store.restarted = 0;
    check(results, "Settings has Restore a backup", !!restore());
    restore().click();
    await waitFor(() => !!ask(), "the question");
    check(results, "…which says plainly that it takes the place of everything, and that what is here is saved first", /in place of everything in the app now/.test(ask()!.textContent ?? "") && /saved first/.test(ask()!.textContent ?? ""), ask()!.textContent ?? "");
    answer(ask()!, /Cancel/);
    await wait(300);
    check(results, "…said no to, nothing is asked for or done", store.restoreBeforeName === undefined && !store.restarted);

    store.restoreFrom = null;
    restore().click();
    await waitFor(() => !!ask(), "the question");
    answer(ask()!, /Choose the backup/);
    await waitFor(() => store.restoreBeforeName !== undefined && !restore().disabled, "the cancelled pick");
    check(results, "…cancelled when picking, nothing is restored", !store.restarted && !restored());

    store.restoreFrom = "D:/Backups/other.zip";
    store.restoreError = "That is not a Shiny Knitting backup: it is another app's.";
    restore().click();
    await waitFor(() => !!ask(), "the question");
    answer(ask()!, /Choose the backup/);
    await waitFor(() => /not restored/.test(restored()), "the refusal");
    check(results, "…a zip that is no backup is refused, saying why", /The backup was not restored: That is not a Shiny Knitting backup/.test(restored()) && !store.restarted, restored());
    delete store.restoreError;

    store.restoreFrom = "D:/Backups/Shiny Knitting backup 2026-10-01.zip";
    restore().click();
    await waitFor(() => !!ask(), "the question");
    answer(ask()!, /Choose the backup/);
    await waitFor(() => /Saving what is here now first: \d of 3 files/.test(restored()), "saving first");
    check(results, "…it saves what is here first, saying how far it has got", restore().disabled && button().disabled, restored());
    await waitFor(() => /Reading the backup: \d of 3 files/.test(restored()), "reading back");
    check(results, "…then reads the backup back in", true);
    const said = () => [...document.querySelectorAll<HTMLElement>(".dialog-card")].find((d) => /Backup restored/.test(d.textContent ?? ""));
    await waitFor(() => !!said(), "the restore said", 15000);
    const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    check(results, "…the present saved beside it, named for today", new RegExp(`^Shiny Knitting before restoring ${ymd} \\d\\d\\.\\d\\d\\.zip$`).test(store.restoreBeforeName ?? ""), store.restoreBeforeName ?? "");
    check(results, "…and done, it says where what was here before is", /saved in D:\/Backups\/Shiny Knitting before restoring/.test(said()!.textContent ?? ""), said()!.textContent ?? "");
    answer(said()!, /OK/);
    await waitFor(() => !!store.restarted, "the restart");
    check(results, "…and the app starts again, on the library restored", store.restarted === 1);
    await close();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (dialog()) (dialog()!.querySelector('[data-act="close"]') as HTMLElement | null)?.click();
    delete store.backupTo;
    delete store.restoreFrom;
    delete store.restoreError;
    delete store.restoreBeforeName;
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__backupChecks = verifyBackup;
