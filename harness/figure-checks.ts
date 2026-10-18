/**
 * Checks for the measurement drawings: every measurement People keeps has
 * one, with what it says of how it is taken; People shows the one being
 * typed beside the table; and the raglan shows its measurements' beside its
 * fields, the body's length too.
 *
 * Run with the harness open:
 *   window.__figureChecks()
 */
import { MEASUREMENTS } from "../src/api";
import { figureCaption, hasFigure, measureFigure } from "../src/views/measure-figures";

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

export async function verifyFigures() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const focus = (el: HTMLElement) => {
    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  };
  try {
    const missing = MEASUREMENTS.filter((m) => !hasFigure(m.key) || !figureCaption(m.key)).map((m) => m.key);
    check(results, "every measurement People keeps is drawn, with how it is taken", !missing.length, missing.join(", "));
    const svg = new DOMParser().parseFromString(measureFigure("chest", 150), "image/svg+xml").documentElement;
    check(results, "…a figure with the tape marked, sized by its height", svg.getAttribute("height") === "150" && !!svg.querySelector(".mf-body") && svg.querySelectorAll(".mf-tape").length >= 2 && svg.getAttribute("aria-label") === figureCaption("chest"));
    check(results, "…and the body's length for the calculators", hasFigure("body_length") && !MEASUREMENTS.some((m) => (m.key as string) === "body_length"));

    // People: the one being typed, drawn beside the table.
    tab("people");
    await waitFor(() => !!document.querySelector(".people .person-card"), "the people");
    document.querySelector<HTMLElement>(".people .person-card")!.click();
    await waitFor(() => !!document.querySelector('.person-page input[data-key="upper_arm"]'), "a person's measurements");
    const how = () => document.querySelector<HTMLElement>('.person-page [data-el="how"]')!;
    for (const key of ["upper_arm", "head", "hand"]) {
      focus(document.querySelector<HTMLElement>(`.person-page input[data-key="${key}"]`)!);
      await waitFor(() => how().querySelector("svg")?.getAttribute("data-figure") === key, `${key} drawn`, 2000).catch(() => {});
    }
    check(results, "People draws the measurement being typed beside the table: an arm's, a head's, a hand's", how().querySelector("svg")?.getAttribute("data-figure") === "hand" && how().textContent!.includes("Hand"), how().innerHTML.slice(0, 120));

    // The raglan: its fields' drawings beside them.
    tab("calculators");
    await waitFor(() => !!document.querySelector(".calculators"), "the calculators");
    document.querySelector<HTMLElement>('.calculators [data-calc="raglan"]')!.click();
    await waitFor(() => !!document.querySelector('.calculators [data-el="calc-how"] svg'), "the raglan's drawing");
    const calcHow = () => document.querySelector<HTMLElement>('.calculators [data-el="calc-how"]')!;
    check(results, "the raglan shows how its measurements are taken, the chest's to start", calcHow().querySelector("svg")?.getAttribute("data-figure") === "chest");
    focus(document.querySelector<HTMLElement>('.calculators [data-k="yokeDepth"]')!);
    await wait(100);
    const depth = calcHow().querySelector("svg")?.getAttribute("data-figure");
    focus(document.querySelector<HTMLElement>('.calculators [data-k="bodyLength"]')!);
    await wait(100);
    check(results, "…the one typed in: armhole depth, the body's length", depth === "armhole_depth" && calcHow().querySelector("svg")?.getAttribute("data-figure") === "body_length" && /underarm down to where the hem/.test(calcHow().textContent ?? ""), `${depth} / ${calcHow().querySelector("svg")?.getAttribute("data-figure")}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__figureChecks = verifyFigures;
