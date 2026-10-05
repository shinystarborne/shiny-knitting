/**
 * Checks for the stash's history and its ball bands, clicked through: a yarn
 * marked used up leaves the stash for the History and comes back; finishing
 * a project with nothing left of a yarn sends it there too; a ball band is
 * added for a yarn in the stash, given a second picture, filed under another
 * brand, and a picture removed.
 *
 * Run with the harness open, after the other suites:
 *   window.__stashHistoryChecks()
 */

import { niceScale, usageByMonth } from "../src/views/usage-chart";
import type { YarnUse } from "../src/api";

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

type StoredYarn = { id: string; name: string; usedUpAt?: number | null };
type Store = {
  yarnUsage: unknown[];
  yarns: StoredYarn[];
  ballBands: { id: string; brand: string; name: string }[];
  projects: { id: string }[];
  projectYarns: { yarnId: string }[];
};

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** A small picture, as pasting one gives it. */
async function picture(colour: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 120, 80);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "band.png", { type: "image/png" });
}

async function paste(colour: string): Promise<void> {
  const data = new DataTransfer();
  data.items.add(await picture(colour));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
}

/** The month arithmetic: calendar months, first day to last, in local time. */
function pure(results: CheckResult[]): void {
  const use = (at: Date, metres: number, grams = 10): YarnUse => ({ id: String(+at), yarnId: null, yarnName: "Y", projectId: null, projectName: "", at: +at, grams, metres, source: "finished" });
  // 15 March 2028, a leap year.
  const now = new Date(2028, 2, 15, 12).getTime();
  const uses = [
    use(new Date(2028, 1, 1, 0, 0, 0), 100), // the first moment of February
    use(new Date(2028, 1, 29, 23, 59, 59), 50), // the last of February: a leap day
    use(new Date(2028, 2, 1, 0, 0, 0), 7), // the first of March
    use(new Date(2027, 2, 31, 23, 0), 999), // a year and more ago: not shown
    use(new Date(2027, 3, 1, 9), 3, 40), // April last year: the first month shown
    use(new Date(2028, 2, 2), 0, 25), // no metres per ball
  ];
  const months = usageByMonth(uses, now);
  check(results, "twelve calendar months, the current one last", months.length === 12 && months[11].label === "March 2028" && months[0].label === "April 2027", `${months[0].label} … ${months[11].label}`);
  check(results, "a month runs from its first moment to its last, a leap day too", months[10].metres === 150 && months[10].uses.length === 2, String(months[10].metres));
  check(results, "…the next starts at midnight on the 1st", months[11].metres === 7 && months[11].grams === 35 && months[11].gramsWithoutMetres === 25, JSON.stringify([months[11].metres, months[11].grams]));
  check(results, "…and what is older than the twelve is left out", months[0].metres === 3 && months.reduce((n, m) => n + m.metres, 0) === 160);
  const scale = (max: number) => JSON.stringify(niceScale(max));
  check(results, "the axis goes up in round steps", scale(437) === JSON.stringify({ top: 600, step: 200 }) && scale(1240) === JSON.stringify({ top: 1500, step: 500 }) && niceScale(0).top > 0, `${scale(437)} ${scale(1240)}`);
}

export async function verifyStashHistory() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const mode = (m: string) => (document.querySelector(`.lib-title [data-mode="${m}"]`) as HTMLElement).click();
  const cardFor = (id: string) => document.querySelector<HTMLElement>(`.card[data-open="${id}"]`);
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const added: string[] = [];

  try {
    pure(results);
    store.yarnUsage = [];
    const yarn = async (name: string, brand: string, colourway: string) => {
      const y = await invoke<StoredYarn>("add_yarn", {
        input: { name, brand, colourway, yarnWeight: "Lace", metresPerBall: 150, gramsPerBall: 50, notes: "", fibres: [{ name: "alpaca", percent: 70 }], superwash: false, plans: [], lots: [{ balls: 2, gramsLeft: 100 }] },
      });
      added.push(y.id);
      return y;
    };
    const air = await yarn("Air", "Drops", "01 Off white");
    const kid = await yarn("Kid-Silk", "Drops", "03 Pink");

    // ---------- used up, from a card ----------
    tab("patterns");
    await waitFor(() => !document.querySelector(".stash"), "the library");
    tab("stash");
    await waitFor(() => !!document.querySelector('.lib-title [data-mode="yarn"]') && !!cardFor(air.id), "the stash");
    const total = document.querySelector<HTMLElement>('[data-el="total"]')?.textContent ?? "";
    check(results, "the stash says its metres and weight in all", /^In the stash: [\d,]+ m · [\d.,]+ k?g in \d+ yarns/.test(total), total);
    check(results, "the Stash switches between Yarn, Swatches, Ball bands and History", [...document.querySelectorAll<HTMLElement>(".lib-title [data-mode]")].map((b) => b.dataset.mode).join() === "yarn,swatches,bands,history");
    (cardFor(air.id)!.querySelector("[data-used-up]") as HTMLElement).click();
    await waitFor(() => !!dialog(), "the question");
    check(results, "Used up asks first, saying where it goes", /moves to the stash's History/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Used up")!.click();
    await waitFor(() => !cardFor(air.id), "the card to go");
    check(results, "a yarn used up leaves the stash", !!store.yarns.find((y) => y.id === air.id)!.usedUpAt && !!cardFor(kid.id));

    mode("history");
    await waitFor(() => !!document.querySelector(".stash-history") && !!cardFor(air.id), "the history");
    check(results, "…and is in the History, saying when", /Used up \w+ \d+, \d{4}/.test(cardFor(air.id)!.textContent ?? "") && !cardFor(kid.id), cardFor(air.id)!.textContent ?? "");
    (cardFor(air.id)!.querySelector('[data-act="restore"]') as HTMLElement).click();
    await waitFor(() => !cardFor(air.id), "it to leave the history");
    check(results, "Back in the stash undoes it", !store.yarns.find((y) => y.id === air.id)!.usedUpAt);

    // ---------- used up, by finishing ----------
    const project = await invoke<{ id: string; yarns: { id: string; yarnId: string }[] }>("add_project", {
      input: { name: "Lace shawl", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [{ id: null, yarnId: kid.id, lotId: null }] },
    });
    await invoke("finish_project", { id: project.id, input: { finishedAt: Date.now(), leftovers: [{ entryId: project.yarns[0].id, grams: 0 }] } });
    mode("yarn");
    await waitFor(() => !!document.querySelector(".stash") && !!cardFor(air.id), "the stash");
    mode("history");
    await waitFor(() => !!cardFor(kid.id), "the finished project's yarn in the history");
    const figure = document.querySelector<HTMLElement>(".usage-figure")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const thisMonth = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    check(results, "the History shows the metres used this month: the 100 g the shawl took, by its ball band", figure.replace(/ ?used in /, " used in ").startsWith(`300 m used in ${thisMonth} 100 g · 1 yarn`), figure);
    check(results, "…a column a month for twelve months, this one chosen", document.querySelectorAll(".usage-col").length === 12 && !!document.querySelector('.usage-col.chosen[data-month="11"]'));
    const listed = document.querySelector(".usage-list li")?.textContent ?? "";
    check(results, "…with what took it", /Drops Kid-Silk \(03 Pink\)\s*300 m\s*100 g · Lace shawl/.test(listed), listed);
    check(results, "Back in the stash took back what marking it used up counted", store.yarnUsage.length === 1);
    check(results, "finishing a project with nothing left of a yarn puts it in the History, with what it went into", /Went into: Lace shawl/.test(cardFor(kid.id)!.textContent ?? ""), cardFor(kid.id)!.textContent ?? "");

    // ---------- ball bands ----------
    mode("bands");
    await waitFor(() => !!document.querySelector(".ball-bands .band-missing"), "the ball bands");
    const offer = document.querySelector<HTMLElement>('.band-missing [data-act="add-for"][data-name="Air"]');
    check(results, "a yarn in the stash without a ball band is offered, to add one for", !!offer && !document.querySelector('.band-missing [data-name="Kid-Silk"]'), "a used up one is not");
    offer!.click();
    await waitFor(() => !!document.querySelector(".band-dialog"), "the add dialog");
    const box = (f: string) => dialog()!.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!;
    check(results, "…its brand and name filled in", box("brand").value === "Drops" && box("name").value === "Air");
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    check(results, "a ball band needs its picture", /Paste, drop or choose a picture/.test(dialog()!.textContent ?? ""));
    await paste("#c33");
    await waitFor(() => !!dialog()!.querySelector(".band-drop.filled"), "the picture");
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !document.querySelector(".band-dialog") && !!document.querySelector(".band-card"), "the band's card");
    const bandCard = () => document.querySelector<HTMLElement>(".band-card")!;
    // The seed has a Drops Air of its own.
    const airs = () => (store.yarns as (StoredYarn & { brand: string })[]).filter((y) => y.brand.trim().toLowerCase() === "drops" && y.name.trim().toLowerCase() === "air" && !y.usedUpAt).length;
    check(results, "the ball band is filed under its brand, with what the stash knows of the yarn", document.querySelector(".band-brand h2")?.textContent === "Drops" && /Air/.test(bandCard().textContent ?? "") && new RegExp(`${airs()} colours? in the stash`).test(bandCard().textContent ?? "") && /150 m \/ 50 g/.test(bandCard().textContent ?? ""), bandCard().textContent ?? "");

    bandCard().click();
    await waitFor(() => !!document.querySelector(".band-view"), "the band");
    await paste("#3c3");
    await waitFor(() => store.ballBands.length === 2 && dialog()!.querySelectorAll(".band-picture").length === 2, "the second picture");
    check(results, "another picture goes with it: the band's back", store.ballBands.every((b) => b.brand === "Drops" && b.name === "Air"));
    box("brand").value = "Garnstudio";
    box("brand").dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.ballBands.every((b) => b.brand === "Garnstudio"), "the move");
    check(results, "filed under another brand, every picture of it moves", true);
    (dialog()!.querySelector('[data-act="remove-picture"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelectorAll(".dialog-card")[1], "the question");
    (document.querySelectorAll(".dialog-card")[1].querySelector("button.danger") as HTMLElement).click();
    await waitFor(() => store.ballBands.length === 1, "the removal");
    check(results, "a picture can be removed", dialog()!.querySelectorAll(".band-picture").length === 1);
    (dialog()!.querySelector('[data-act="done"]') as HTMLElement).click();
    await waitFor(() => !document.querySelector(".band-dialog"), "the dialog to close");
    await waitFor(() => document.querySelector(".band-brand h2")?.textContent === "Garnstudio", "the list again");
    check(results, "the list shows it under its new brand", /None in the stash/.test(bandCard().textContent ?? ""), bandCard().textContent ?? "");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    store.yarns = store.yarns.filter((y) => !added.includes(y.id));
    store.ballBands = [];
    document.querySelector<HTMLElement>('.lib-title [data-mode="yarn"]')?.click();
    tab("patterns");
    await waitFor(() => !document.querySelector(".stash"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__stashHistoryChecks = verifyStashHistory;
