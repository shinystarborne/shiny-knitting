/**
 * Checks for adding a pattern by dropping its file on the Add pattern form:
 * the file goes to the backend raw, as bytes, never as a JSON array of
 * numbers, with the rest of the pattern beside it.
 *
 * Run with the harness open:
 *   window.__uploadChecks()
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

type Upload = { input: { title: string; fileName: string; sourcePath?: string }; bytes: Uint8Array };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyUpload() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __lastUpload?: Upload; __store: { patterns: { id: string; title: string }[] } };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const form = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
  let made = "";

  try {
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-act="add"]'), "the library");
    (document.querySelector('.library [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!form()?.querySelector('[data-el="drop"]'), "the Add pattern form");

    // A 6 MB PDF, dropped.
    const size = 6 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    bytes[size - 1] = 0x42;
    const file = new File([bytes], "Dropped_Lace-Socks.pdf", { type: "application/pdf" });
    const data = new DataTransfer();
    data.items.add(file);
    form()!.querySelector('[data-el="drop"]')!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    await waitFor(() => /Dropped_Lace-Socks\.pdf/.test(form()!.querySelector('[data-el="chosen"]')?.textContent ?? ""), "the dropped file");
    check(results, "a dropped file is taken, its title from its name", form()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value === "Dropped Lace Socks");

    delete w.__lastUpload;
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !!w.__lastUpload && !form(), "the upload");
    const up = w.__lastUpload!;
    check(results, "it goes to the backend raw, as bytes, all of them", up.bytes instanceof Uint8Array && up.bytes.length === size && up.bytes[size - 1] === 0x42, `${up.bytes?.constructor?.name} ${up.bytes?.length}`);
    check(results, "…with the pattern's details beside it, and no path", up.input.title === "Dropped Lace Socks" && up.input.fileName === "Dropped_Lace-Socks.pdf" && !up.input.sourcePath, JSON.stringify(up.input));
    const added = w.__store.patterns.find((p) => p.title === "Dropped Lace Socks");
    made = added?.id ?? "";
    check(results, "and it is in the library", !!added);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (form()) (form()!.querySelector('[data-act="cancel"]') as HTMLElement | null)?.click();
    if (made) await invoke("delete_pattern", { id: made }).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__uploadChecks = verifyUpload;
