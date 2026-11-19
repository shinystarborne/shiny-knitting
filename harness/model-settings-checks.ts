/**
 * Checks that the model settings in use are the ones confirmed: Test
 * connection tests the form without saving any of it, whether it passes or
 * fails, and Cancel after a test leaves the saved settings as they were; the
 * library's Describe question names the settings as saved now, not as they
 * were when the library was drawn; and settings saved during a Describe run
 * send nothing more until the rest is confirmed again with the new ones
 * shown, a No ending the run there.
 *
 * Run with the harness open:
 *   window.__modelSettingsChecks()
 */
import type { AiSettingsView } from "../src/api";

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

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

interface Store {
  aiSettings: AiSettingsView | null;
  lastAiTest?: { baseUrl: string; model: string; apiKey: string | null };
  aiSent?: { patternId: string; baseUrl: string }[];
  aiDelay?: number;
}
const store = () => (window as unknown as { __store: Store }).__store;

const modal = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .modal");
const field = (f: string) => modal()!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
const asked = () => document.querySelector<HTMLElement>(".dialog-card");
const answer = (label: string) =>
  [...(asked()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === label)?.click();
const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
const panel = () => document.querySelector<HTMLElement>(".describe-panel");

async function save(changes: Partial<AiSettingsView>): Promise<AiSettingsView> {
  const now = await invoke<AiSettingsView>("get_ai_settings");
  return invoke<AiSettingsView>("save_ai_settings", { settings: { ...now, ...changes } });
}

async function testWith(baseUrl: string): Promise<string> {
  const result = modal()!.querySelector<HTMLElement>('[data-el="testresult"]')!;
  field("baseUrl").value = baseUrl;
  field("baseUrl").dispatchEvent(new Event("input", { bubbles: true }));
  const button = modal()!.querySelector<HTMLButtonElement>('[data-act="test"]')!;
  button.click();
  await waitFor(() => !button.disabled && !!result.textContent, "the test result");
  return result.textContent ?? "";
}

export async function verifyModelSettings() {
  const results: CheckResult[] = [];
  const before = JSON.parse(JSON.stringify(await invoke<AiSettingsView>("get_ai_settings"))) as AiSettingsView;
  try {
    const A = "http://192.168.1.10:8080/v1";
    const B = "http://192.168.1.20:8080/v1";
    const C = "http://192.168.1.30:8080/v1";
    // Not applied, so the runs leave the library as it was.
    const saved = await save({ enabled: true, baseUrl: A, model: "model-a", rescanExisting: true, applyAutomatically: false });

    // ---- Test connection: the draft, never saved ----
    (document.querySelector('.tab-bar [data-act="settings"]') as HTMLElement).click();
    await waitFor(() => !!modal()?.querySelector('[data-act="test"]'), "Settings");
    const failed = await testWith("http://fail.example/v1");
    check(results, "a failing test says so", /Could not reach/.test(failed), failed);
    check(results, "…the address tested is the one in the form", store().lastAiTest?.baseUrl === "http://fail.example/v1", JSON.stringify(store().lastAiTest));
    check(results, "…and nothing was saved", store().aiSettings?.baseUrl === A && store().aiSettings?.revision === saved.revision, JSON.stringify(store().aiSettings));
    field("apiKey").value = "sk-typed";
    const passed = await testWith(B);
    check(results, "a passing test lists the models", /Connected/.test(passed), passed);
    check(results, "…tested with the key typed in, not saved", store().lastAiTest?.apiKey === "sk-typed" && !store().aiSettings?.hasApiKey);
    check(results, "…and nothing was saved", store().aiSettings?.baseUrl === A && store().aiSettings?.revision === saved.revision, JSON.stringify(store().aiSettings));
    check(results, "…the typed key stays in the field, to be saved", field("apiKey").value === "sk-typed");
    (modal()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !modal(), "Settings to close");
    check(results, "closed without Save, the saved settings are as they were", store().aiSettings?.baseUrl === A && store().aiSettings?.revision === saved.revision);

    // ---- The question names the settings as saved now ----
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector('.library [data-act="scan"]:not([hidden])'), "Describe offered");
    // Saved after the library was drawn, as from Settings opened elsewhere.
    await save({ baseUrl: C, model: "model-c" });
    document.querySelector<HTMLElement>('.library [data-act="scan"]')!.click();
    await waitFor(() => /Describe \d+ pattern/.test(asked()?.textContent ?? ""), "the question", 20000);
    check(results, "the Describe question names the model saved now", /model-c/.test(asked()!.textContent ?? ""), asked()!.textContent ?? "");
    answer("Cancel");
    await waitFor(() => !asked(), "the question to close");

    // ---- Saved during a run: nothing more sent until asked again ----
    await save({ baseUrl: A, model: "model-a" });
    store().aiSent = [];
    store().aiDelay = 250;
    document.querySelector<HTMLElement>('.library [data-act="scan"]')!.click();
    await waitFor(() => /model-a/.test(asked()?.textContent ?? ""), "the question");
    const total = Number(/Describe (\d+) pattern/.exec(asked()!.textContent ?? "")?.[1] ?? 0);
    answer("Describe");
    await waitFor(() => (store().aiSent?.length ?? 0) >= 1, "the first pattern sent");
    await save({ baseUrl: B, model: "model-b" });
    await waitFor(() => /changed during the run/.test(asked()?.textContent ?? ""), "the run to ask again");
    const sentBefore = store().aiSent!.length;
    check(results, "settings saved during a run: it stops and asks again", total > 2 && sentBefore < total, `${sentBefore} of ${total}`);
    check(results, "…everything sent so far went where it was confirmed", store().aiSent!.every((s) => s.baseUrl === A), JSON.stringify(store().aiSent));
    check(results, "…the question names the new model and the patterns left", /model-b/.test(asked()!.textContent ?? "") && new RegExp(`Describe ${total - sentBefore} pattern`).test(asked()!.textContent ?? ""), asked()!.textContent ?? "");
    check(results, "…Stop stays on the panel while it asks", !!panel()?.querySelector('[data-act="stop"]'));
    answer("Cancel");
    await waitFor(() => !!panel()?.classList.contains("done"), "the run to end");
    check(results, "No ends the run, nothing sent to the new server", store().aiSent!.length === sentBefore && store().aiSent!.every((s) => s.baseUrl === A), JSON.stringify(store().aiSent));
    check(results, "…and the panel says why", /settings were changed/.test(panel()!.textContent ?? ""), panel()!.textContent ?? "");
    (panel()!.querySelector('[data-act="close"]') as HTMLElement).click();

    // Yes goes on with the new settings, for the rest only.
    await save({ baseUrl: A, model: "model-a" });
    store().aiSent = [];
    document.querySelector<HTMLElement>('.library [data-act="scan"]')!.click();
    await waitFor(() => /model-a/.test(asked()?.textContent ?? ""), "the question");
    answer("Describe");
    await waitFor(() => (store().aiSent?.length ?? 0) >= 1, "the first pattern sent");
    await save({ baseUrl: B, model: "model-b" });
    await waitFor(() => /changed during the run/.test(asked()?.textContent ?? ""), "the run to ask again");
    const firstPart = store().aiSent!.length;
    answer("Describe");
    await waitFor(() => !!panel()?.classList.contains("done"), "the run to end", 30000);
    const sent = store().aiSent!;
    check(results, "Yes goes on with the new settings: the rest to the new server, each once", sent.length === total && sent.slice(0, firstPart).every((s) => s.baseUrl === A) && sent.slice(firstPart).every((s) => s.baseUrl === B) && new Set(sent.map((s) => s.patternId)).size === total, JSON.stringify(sent));
    check(results, "…and the count reaches the whole run", (panel()?.querySelector('[data-el="count"]')?.textContent ?? "") === `${total} / ${total}`, panel()?.querySelector('[data-el="count"]')?.textContent ?? "");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (asked()) answer("Cancel");
    panel()?.querySelector<HTMLElement>('[data-act="stop"]')?.click();
    await waitFor(() => !panel() || panel()!.classList.contains("done"), "the run to end", 20000).catch(() => {});
    panel()?.querySelector<HTMLElement>('[data-act="close"]')?.click();
    if (modal()) (modal()!.querySelector('[data-act="close"]') as HTMLElement)?.click();
    delete store().aiDelay;
    delete store().aiSent;
    store().aiSettings = before;
    tab("projects");
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__modelSettingsChecks = verifyModelSettings;
