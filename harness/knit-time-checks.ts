/**
 * Checks for knitting time: the sums and how time is said; on a project's
 * page, Start and Stop with a running clock, the timer in the tab bar
 * (opening its project), time added by hand, a sitting put right and one
 * removed, what the project came to an hour; and the hours in Statistics.
 *
 * Run with the harness open:
 *   window.__knitTimeChecks()
 */
import type { KnitSession, Pattern } from "../src/api";
import { clock, hoursText, knittedSince, sessionMs, totalMs, trueCost, typedStart } from "../src/views/knit-time";

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

function pure(results: CheckResult[]): void {
  check(results, "a running clock: hours, minutes, seconds", clock(4985000) === "1:23:05" && clock(0) === "0:00:00" && clock(45296000) === "12:34:56");
  check(results, "time knitted, to the minute", hoursText(45 * 60000) === "45 min" && hoursText(3 * 3600000) === "3 h" && hoursText(12 * 3600000 + 35 * 60000) === "12 h 35 min" && hoursText(20000) === "0 min");
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  const s = (startedAt: number, endedAt: number | null) => ({ id: "s", projectId: "p", startedAt, endedAt }) as KnitSession;
  const sessions = [s(now - 3600000, now - 1800000), s(now - 600000, null), s(now - 400 * 86400000, now - 400 * 86400000 + 7200000)];
  check(results, "a spell's length, a running one to now", sessionMs(sessions[0], now) === 1800000 && sessionMs(sessions[1], now) === 600000);
  check(results, "all of them, and those since a day", totalMs(sessions, now) === 1800000 + 600000 + 7200000 && knittedSince(sessions, now - 365 * 86400000, now) === 2400000);
  check(results, "what it really costs: what it cost, and the time at an hour's worth", trueCost(30, 3 * 3600000, 15) === 75 && trueCost(0, 90 * 60000, 12) === 18);
  check(results, "time typed for a day is at its noon; for today, ended by now", typedStart("2026-10-10", 3600, now) === new Date(2026, 9, 10, 12).getTime() && typedStart("2026-10-18", 4 * 3600, now) === now - 4 * 3600000 && typedStart("last week", 60, now) === null);
}

export async function verifyKnitTime() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { patterns: Pattern[]; knitSessions?: KnitSession[]; hourRate?: number | null } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const box = () => page()?.querySelector<HTMLElement>('[data-el="knit-time"]') ?? null;
  const act = (name: string) => box()!.querySelector<HTMLElement>(`[data-act="${name}"]`)!.click();
  const pill = () => document.querySelector<HTMLElement>('.tab-bar [data-act="timer"]')!;
  const total = () => box()?.querySelector('[data-el="knit-total"]')?.textContent ?? "";
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const fill = (values: string[]) => {
    const inputs = [...dialog()!.querySelectorAll<HTMLInputElement>("input")];
    values.forEach((v, i) => {
      inputs[i].value = v;
      inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
    });
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
  };
  const pattern = store.patterns[0];
  const was = { price: pattern.price };
  const made: string[] = [];

  try {
    pure(results);
    await invoke("set_pattern_price", { id: pattern.id, price: 30 });
    const hat = await invoke<{ id: string }>("add_project", { input: { name: "Timed hat", patternId: pattern.id, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    made.push(hat.id);
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector<HTMLElement>(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: hat.id }));
    await waitFor(() => !!box(), "the knitting time");
    check(results, "a project's page has its knitting time: not timed yet, to start", /Not timed yet/.test(total()) && !!box()!.querySelector('[data-act="knit-start"]'), box()!.textContent ?? "");

    // Timed.
    act("knit-start");
    await waitFor(() => !!box()?.querySelector('[data-act="knit-stop"]'), "the timer running");
    const first = box()!.querySelector('[data-el="knit-clock"]')!.textContent;
    check(results, "Start: the timer runs, its clock on Stop", /^0:00:0\d$/.test(first ?? ""), first ?? "");
    await waitFor(() => !pill().hidden && /Timed hat/.test(pill().title), "the tab bar's timer");
    check(results, "…and the tab bar's timer runs, saying which project", /^⏱ 0:00:0\d$/.test(pill().textContent ?? "") && pill().title === "Knitting Timed hat: open it", `${pill().textContent} ${pill().title}`);
    await waitFor(() => box()!.querySelector('[data-el="knit-clock"]')?.textContent !== first, "a second on", 3000);
    check(results, "…a second at a time", true);
    // The tab bar's timer opens its project from elsewhere.
    tab("patterns");
    await waitFor(() => !page(), "the library");
    pill().click();
    await waitFor(() => !!box(), "the project again");
    await waitFor(() => !!box()?.querySelector('[data-act="knit-stop"]'), "its timer on the page", 5000).catch(() => {});
    check(results, "the tab bar's timer opens the project timed", page()!.querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Timed hat" && !!box()!.querySelector('[data-act="knit-stop"]'), box()?.textContent?.replace(/\s+/g, " ") ?? "no box");
    act("knit-stop");
    await waitFor(() => !!box()?.querySelector('[data-act="knit-start"]') && pill().hidden, "stopped");
    check(results, "Stop: one session kept, and the tab bar's timer gone", /in 1 session/.test(box()!.textContent ?? "") && (store.knitSessions ?? []).filter((s) => s.projectId === hat.id && s.endedAt).length === 1);

    // By hand.
    act("knit-add");
    await waitFor(() => !!dialog()?.querySelector("input"), "the form");
    const yesterday = new Date(Date.now() - 86400000);
    const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    fill([day, "2", "30"]);
    await waitFor(() => /in 2 sessions/.test(box()?.textContent ?? ""), "the time added");
    check(results, "time added by hand: 2 hours 30 the day before", total() === "2 h 30 min", total());
    const typed = (store.knitSessions ?? []).find((s) => s.projectId === hat.id && s.endedAt! - s.startedAt === 9000000)!;
    check(results, "…at its noon", new Date(typed.startedAt).getHours() === 12);
    // Put right.
    box()!.querySelector<HTMLDetailsElement>(".knit-sittings")!.open = true;
    box()!.querySelector<HTMLElement>(`[data-act="knit-change"][data-id="${typed.id}"]`)!.click();
    await waitFor(() => dialog()?.querySelectorAll("input").length === 4, "the sitting's form");
    fill([day, "18:15", "3", "0"]);
    await waitFor(() => total() === "3 h", "put right");
    const fixed = (store.knitSessions ?? []).find((s) => s.id === typed.id)!;
    check(results, "a sitting put right: from a quarter past six, three hours", new Date(fixed.startedAt).getHours() === 18 && new Date(fixed.startedAt).getMinutes() === 15 && fixed.endedAt! - fixed.startedAt === 3 * 3600000, JSON.stringify(fixed));
    check(results, "…the sittings left open as they were", box()!.querySelector<HTMLDetailsElement>(".knit-sittings")!.open);
    check(results, "no cost per hour of knitting shown", !box()!.querySelector('[data-el="knit-rate"]') && !/an hour/.test(box()!.querySelector(".knit-total")?.textContent ?? ""));
    // What it really costs, with an hour's worth said in Settings.
    check(results, "with no hour's worth said, it says where to say it", /Set for all projects in Settings/.test(box()!.querySelector('[data-el="rate-hint"]')?.textContent ?? "") && !box()!.querySelector('[data-el="knit-worth"]'));
    store.hourRate = null;
    page()!.dispatchEvent(new CustomEvent("open-settings", { bubbles: true }));
    const settings = () => document.querySelector<HTMLInputElement>('.modal-backdrop:not(.hidden) [data-f="hourRate"]');
    await waitFor(() => !!settings(), "the settings");
    settings()!.value = "abc";
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="save"]')!.click();
    await waitFor(() => !document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-el="error"]')?.hidden, "the refusal");
    check(results, "Settings refuse an hour's worth that is no number", /must be a number, like 15/.test(document.querySelector('.modal-backdrop:not(.hidden) [data-el="error"]')?.textContent ?? ""));
    settings()!.value = "15";
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="save"]')!.click();
    await waitFor(() => !settings(), "saved");
    check(results, "…and keep one that is", store.hourRate === 15, String(store.hourRate));
    // The page open all along takes it up, not only once opened again.
    await waitFor(() => !!box()?.querySelector(".knit-worth"), "the open page to take up the standard", 5000).catch(() => {});
    check(results, "the project page open while Settings were saved takes up the new standard", !!page() && box()?.querySelector<HTMLInputElement>("[data-rate]")?.value === "15" && /€75\.0\d/.test(box()?.querySelector('[data-el="knit-worth"]')?.textContent ?? ""), box()?.querySelector<HTMLInputElement>("[data-rate]")?.value ?? "no page");
    tab("patterns");
    await waitFor(() => !page(), "the library");
    document.querySelector(".library")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: hat.id }));
    await waitFor(() => !!box()?.querySelector(".knit-worth"), "the page again");
    const worth = box()!.querySelector<HTMLElement>('[data-el="knit-worth"]')!.innerText.replace(/\s+/g, " ");
    // Three hours, and the few seconds the timer ran.
    check(results, "the hour's worth shows the standard, said so", box()!.querySelector<HTMLInputElement>("[data-rate]")!.value === "15" && /^From Settings/.test(box()!.querySelector('[data-el="rate-hint"]')!.textContent ?? ""));
    check(results, "project cost with time: 30 for the pattern, 3 hours at 15", /^Project cost with time: €75\.0\d$/.test(worth.trim()), worth);

    // This project's own hour's worth, and back to the standard.
    const rateInput = () => box()!.querySelector<HTMLInputElement>("[data-rate]")!;
    rateInput().value = "22";
    rateInput().dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => /€96\.0\d/.test(box()?.querySelector('[data-el="knit-worth"]')?.textContent ?? ""), "its own rate");
    check(results, "a project's own hour's worth, typed over the standard, counts", (await invoke<{ hourRate?: number | null }[]>("list_projects")).find((p) => (p as { id: string }).id === hat.id)?.hourRate === 22 && /This project only \(€15\.00 in Settings\)/.test(box()!.querySelector('[data-el="rate-hint"]')!.textContent ?? ""));
    box()!.querySelector<HTMLElement>('[data-act="rate-standard"]')!.click();
    await waitFor(() => rateInput().value === "15", "the standard again");
    check(results, "…and Use the one in Settings follows Settings again", (await invoke<{ id: string; hourRate?: number | null }[]>("list_projects")).find((p) => p.id === hat.id)?.hourRate == null && /€75\.0\d/.test(box()!.querySelector('[data-el="knit-worth"]')!.textContent ?? ""));

    // Removed.
    const short = (store.knitSessions ?? []).find((s) => s.projectId === hat.id && s.id !== typed.id)!;
    box()!.querySelector<HTMLElement>(`[data-act="knit-remove"][data-id="${short.id}"]`)!.click();
    await waitFor(() => !!dialog(), "the question");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => /in 1 session/.test(box()?.textContent ?? ""), "removed");
    check(results, "a sitting removed", (store.knitSessions ?? []).filter((s) => s.projectId === hat.id).length === 1);

    // Statistics.
    tab("stash");
    await waitFor(() => !!document.querySelector('.lib-title [data-mode="stats"]'), "the stash");
    document.querySelector<HTMLElement>('.lib-title [data-mode="stats"]')!.click();
    await waitFor(() => !!document.querySelector('[data-el="knitted"]'), "the statistics");
    const tile = document.querySelector<HTMLElement>('[data-el="knitted"]')!.innerText.replace(/\s+/g, " ");
    check(results, "Statistics say the hours knitted in twelve months", /Knitted in the last 12 months 3 h/.test(tile) && /1 project timed/.test(tile), tile);

    // A finished project's timer stops with it.
    await invoke("start_knitting", { projectId: hat.id });
    await invoke("finish_project", { id: hat.id, input: { finishedAt: Date.now(), leftovers: [] } });
    check(results, "finishing a project stops its timer", (await invoke<KnitSession | null>("running_knit_session")) === null);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await invoke("stop_knitting").catch(() => {});
    for (const id of made) await invoke("delete_project", { id }).catch(() => {});
    await invoke("set_pattern_price", { id: pattern.id, price: was.price ?? null }).catch(() => {});
    store.hourRate = null;
    document.querySelector(".screen")?.dispatchEvent(new CustomEvent("knit-timer", { bubbles: true }));
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__knitTimeChecks = verifyKnitTime;
