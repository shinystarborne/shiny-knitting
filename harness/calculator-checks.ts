/**
 * Checks for the Calculators tab: the arithmetic, checked directly, and the
 * page -- a person and a swatch filling the raglan, the fit, the steps saved
 * to a project's board, and the everyday helpers -- clicked through.
 *
 * Run with the harness open, after the other suites:
 *   window.__calculatorChecks()
 */
import { even, nearestRepeat, raglan, raglanSteps, regauge, roundYoke, roundYokeSteps, rowsFor, spreadEvenly, stitchesFor, type RaglanInput, type RaglanResult, type RoundYokeResult } from "../src/views/calc";

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

type Store = {
  boardItems: { id: string; boardId: string; kind: string; data: { text?: string } }[];
  projects: { id: string; name: string; status: string }[];
  measureUnit?: string;
};

/** A grown-up's sweater at 22 sts and 30 rows. */
const ADULT: RaglanInput = {
  gauge: { sts: 22, rows: 30 },
  chest: 92,
  upperArm: 30,
  wrist: 16,
  neck: 36,
  yokeDepth: 20,
  armLength: 45,
  bodyLength: 35,
  bodyEase: 8,
  sleeveEase: 5,
  wristEase: 2,
  neckEase: 10,
  underarm: 5,
  neckRib: 2.5,
  hemRib: 5,
  cuffRib: 5,
};

function pure(results: CheckResult[]): void {
  check(results, "even rounds to the nearest even count", even(77) === 78 && even(101.2) === 102 && even(3) === 4);
  check(results, "a count fits a stitch pattern's repeat", nearestRepeat(97, 4, 2) === 98 && nearestRepeat(110, 4) === 112 && nearestRepeat(1, 4, 2) === 6);
  const s = stitchesFor(50, { sts: 22, rows: 30 });
  check(results, "stitches for a width", s.count === 110 && Math.abs(s.cm - 50) < 0.01);
  check(results, "…and rows for a length", rowsFor(10, { sts: 22, rows: 30 }).count === 30);

  const sp = (n: number, c: number, round: boolean) => {
    const r = spreadEvenly(n, c, round);
    return "error" in r ? `error: ${r.error}` : r.text;
  };
  check(results, "increases in the round divide it into equal parts", sp(100, 8, true) === "*K13, M1* 4 times, *K12, M1* 4 times.", sp(100, 8, true));
  check(results, "…worked flat, none at the edges", sp(100, 8, false) === "K12, *M1, K11* 8 times.", sp(100, 8, false));
  check(results, "decreases in the round", sp(100, -8, true) === "*K11, k2tog* 4 times, *K10, k2tog* 4 times.", sp(100, -8, true));
  check(results, "…and flat, the longer stretches at the ends", sp(100, -8, false) === "K10, k2tog, K10, *k2tog, K9* 6 times, k2tog, K10.", sp(100, -8, false));
  check(results, "an even split needs no second part", sp(96, 8, true) === "*K12, M1* 8 times.", sp(96, 8, true));
  check(results, "too many decreases say what to do instead", /Knit 2 together all the way for 5/.test(sp(10, -6, true)), sp(10, -6, true));
  check(results, "too many increases too", /front and back of every stitch for 8/.test(sp(4, 6, true)), sp(4, 6, true));
  const counted = (n: number, c: number, round: boolean) => {
    const r = spreadEvenly(n, c, round);
    return "error" in r ? -1 : r.gaps.reduce((a, b) => a + b, 0) + (c < 0 ? -2 * c : 0);
  };
  check(results, "every stitch is accounted for", [[96, 7, true], [101, -9, false], [37, 5, false], [200, -30, true]].every(([n, c, r]) => counted(n as number, c as number, r as boolean) === n));

  const g = regauge(100, 20, 22);
  check(results, "re-gauging: the count for the same size, and the size as written", g.mine === 110 && g.patternCm === 50 && Math.abs(g.asWrittenCm - 45.45) < 0.01);

  const r = raglan(ADULT) as RaglanResult;
  check(results, "a grown-up's raglan: cast-on and split", r.castOn === 104 && r.front0 === 42 && r.sleeve0 === 10, JSON.stringify(r));
  check(results, "…the increases fill the yoke, every other round", r.bodyIncreases === 28 && r.sleeveIncreases === 28 && r.everyOther === 28 && r.everyRound === 0 && r.plainRounds === 4);
  check(results, "…the pieces at the split", r.front === 98 && r.sleeve === 66 && r.underarmSts === 12 && r.body === 220 && r.upperArmSts === 78);
  check(results, "…and the body and sleeves add up", r.front * 2 + r.underarmSts * 2 === r.body && r.sleeve + r.underarmSts === r.upperArmSts);
  check(results, "…the sleeve narrows to the wrist", r.wristSts === 40 && r.sleeveDecreases === 19 && r.sleeveEvery === 6);
  check(results, "…and it measures what was asked", Math.abs(r.finished.chest - 100) < 0.5 && r.warnings.length === 0, JSON.stringify(r.finished));
  const steps = raglanSteps(r, ADULT, (cm) => `${Math.round(cm * 10) / 10} cm`);
  check(results, "the steps say it in words", steps[0].startsWith("Cast on 104 stitches") && steps.some((s) => /every other round 28 times/.test(s)) && steps.some((s) => /every 6 rounds 19 times, to 40 stitches/.test(s)), steps.join(" | "));

  const shallow = raglan({ ...ADULT, yokeDepth: 14 }) as RaglanResult;
  check(results, "a shallow yoke increases on some rounds in a row", shallow.everyRound > 0 && shallow.everyRound + 2 * shallow.everyOther === Math.round(14 * 3), JSON.stringify(shallow));
  const tooShallow = raglan({ ...ADULT, yokeDepth: 8 }) as RaglanResult;
  check(results, "too shallow for even that says so", tooShallow.warnings.some((w) => /more than the 8 cm/.test(w)), tooShallow.warnings.join(" | "));
  const tight = raglan({ ...ADULT, neck: 30, neckEase: 4, chest: 120 }) as RaglanResult;
  check(results, "a small neck on a big body gives the body extra increases", tight.bodyIncreases > tight.sleeveIncreases && tight.warnings.some((w) => /on the body only/.test(w)), JSON.stringify(tight));
  check(results, "…and still adds up", tight.front0 + 2 * tight.bodyIncreases === tight.front && tight.sleeve0 + 2 * tight.sleeveIncreases === tight.sleeve);
  check(results, "a missing measurement is asked for", (raglan({ ...ADULT, chest: 0 }) as { error: string }).error === "Give the chest.");

  // A lopapeysa in Lopi, at 18 stitches.
  const LOPI: RaglanInput = { ...ADULT, gauge: { sts: 18, rows: 24 }, chest: 96, upperArm: 31, wrist: 17, neck: 38, yokeDepth: 23, armLength: 46, bodyLength: 38, bodyEase: 10, wristEase: 3, neckRib: 3, hemRib: 6, cuffRib: 6 };
  const y = roundYoke(LOPI) as RoundYokeResult;
  const counts = (r: RoundYokeResult) => r.rounds.map((x) => `${x.from}→${x.to}`).join(" ");
  check(results, "a round yoke: three increase rounds from the neck to the split", y.castOn === 86 && y.yokeTotal === 278 && counts(y) === "86→128 128→188 188→278", `${y.castOn} ${counts(y)} ${y.yokeTotal}`);
  const at = y.rounds.map((x) => Math.round(x.atCm * 10) / 10).join(" ");
  check(results, "…spaced as the percentage system spaces them", at === "2.3 6.9 11.5", at);
  check(results, "…splitting as a raglan does", 2 * y.pieces.front + 2 * y.pieces.sleeve === y.yokeTotal && y.pieces.body === 190 && y.pieces.upperArmSts === 64 && !y.adjust);
  const every = y.rounds.every((x) => { const s = spreadEvenly(x.from, x.to - x.from, true); return !("error" in s) && s.text === x.text; });
  check(results, "…each round written out evenly", every && y.rounds[0].text === "*K3, M1* 2 times, *K2, M1* 40 times.", y.rounds[0].text);
  const y6 = roundYoke(LOPI, 3, 6) as RoundYokeResult;
  check(results, "a colourwork repeat keeps every count to it", y6.rounds.every((x) => x.from % 6 === 0 && x.to % 6 === 0) && y6.adjust?.from === 276 && y6.adjust?.to === 278, `${counts(y6)} / ${JSON.stringify(y6.adjust)}`);
  const y5 = roundYoke(LOPI, 5) as RoundYokeResult;
  check(results, "more increase rounds, smaller steps", y5.rounds.length === 5 && y5.rounds.every((x) => x.to / x.from < 1.3), counts(y5));
  check(results, "one round too few for a big step says so", /choose more increase rounds/.test((roundYoke({ ...LOPI, neck: 20, neckEase: 0 }, 1) as { error: string }).error ?? ""));
  const ysteps = roundYokeSteps(y6, LOPI, (cm) => `${Math.round(cm * 10) / 10} cm`);
  check(results, "the yoke's steps in words", ysteps[0] === "Cast on 84 stitches. Join to knit in the round, and work 7 rounds of rib (3 cm) for the neckband." && ysteps.some((s) => s.startsWith("At 2.3 cm (round 6), from 84 to 126:")) && ysteps.some((s) => /to split evenly/.test(s)), ysteps.join(" | "));
}

export async function verifyCalculators() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".calculators");
  const field = (k: string) => view()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-k="${k}"]`) ?? null;
  const type = (k: string, v: string) => {
    const el = field(k)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const results_ = () => view()?.querySelector<HTMLElement>('[data-el="results"]')?.textContent ?? "";
  const pick = (calc: string) => (view()!.querySelector(`[data-calc="${calc}"]`) as HTMLElement).click();
  const cell = (row: string) =>
    [...(view()?.querySelectorAll<HTMLTableRowElement>(".calc-table tr") ?? [])].find((tr) => tr.querySelector("th")?.textContent === row)?.querySelector("td")?.textContent ?? "";

  try {
    pure(results);

    tab("calculators");
    await waitFor(() => !!view()?.querySelector(".calc-inputs"), "the calculators");
    check(results, "the tab lists the calculators, the raglan first", [...view()!.querySelectorAll<HTMLElement>(".calc-pick")].map((b) => b.dataset.calc).join(",") === "raglan,yoke,size,evenly,regauge" && !!view()!.querySelector('.calc-pick.on[data-calc="raglan"]'));
    check(results, "with nothing given, it says what it needs first", /Give your gauge/.test(results_()), results_());

    // A swatch gives the gauge; typing one over it un-picks the swatch.
    const swatchOption = [...field("swatch")!.options].find((o) => o.value);
    if (swatchOption) {
      type("swatch", swatchOption.value);
      check(results, "picking a swatch fills in its gauge", !!field("sts")!.value && !!field("rows")!.value);
    }
    type("sts", "22");
    type("rows", "30");
    check(results, "typing a gauge over a swatch's leaves it typed in", field("swatch")!.value === "");

    // A person fills the measurements they have.
    const mo = [...field("person")!.options].find((o) => o.textContent === "Mo");
    if (mo) {
      type("person", mo.value);
      check(results, "picking someone fills in their measurements", field("chest")!.value === "58", field("chest")!.value);
    }
    for (const [k, v] of [["chest", "92"], ["upperArm", "30"], ["wrist", "16"], ["neck", "36"], ["yokeDepth", "20"], ["armLength", "45"], ["bodyLength", "35"]]) type(k, v);
    type("fit", "relaxed");
    check(results, "the fit sets the body ease", field("bodyEase")!.value === "10");
    type("bodyEase", "8");
    type("sleeveEase", "5");
    check(results, "the raglan is worked out as it is typed", cell("Cast on") === "104" && cell("Body") === "220" && cell("Sleeve") === "78 → 40", `${cell("Cast on")} / ${cell("Body")} / ${cell("Sleeve")}`);
    const steps = [...view()!.querySelectorAll(".calc-steps li")].map((li) => li.textContent ?? "");
    check(results, "…with the steps in words", steps.length >= 9 && steps[0].startsWith("Cast on 104 stitches"), steps[0]);
    type("chest", "lots");
    check(results, "something that is not a length says so", /chest is not a length/.test(results_()), results_());
    type("chest", "92");

    // Saved to a project's board.
    const live = store.projects.find((p) => p.status === "active" || p.status === "paused");
    if (live) {
      type("saveTo", live.id);
      const before = store.boardItems.length;
      (view()!.querySelector('[data-act="save"]') as HTMLElement).click();
      await waitFor(() => store.boardItems.length === before + 1, "the board item");
      const item = store.boardItems[store.boardItems.length - 1];
      check(results, "Save puts the steps on the project's board, as a text", item.boardId === live.id && item.kind === "text" && /Cast on 104 stitches/.test(item.data.text ?? ""), JSON.stringify(item));
      check(results, "…and says so", /Saved to/.test(view()!.querySelector('[data-el="saved"]')?.textContent ?? ""));
    }

    // What was typed is kept, going away and back.
    tab("patterns");
    await waitFor(() => !view(), "the library");
    tab("calculators");
    await waitFor(() => !!view()?.querySelector(".calc-inputs"), "the calculators again");
    check(results, "what was typed is still there after leaving the tab", field("chest")?.value === "92" && cell("Cast on") === "104");

    // ---------- the round yoke, from the same measurements ----------
    pick("yoke");
    await waitFor(() => !!field("increases"), "the round yoke");
    check(results, "the round yoke keeps the raglan's measurements", field("chest")?.value === "92" && /Yoke depth/.test(view()!.querySelector(".calc-inputs")!.textContent ?? ""));
    const expected = roundYoke(ADULT) as RoundYokeResult;
    check(results, "…and works it out", cell("Cast on") === String(expected.castOn) && cell("Increase round 3") === `${expected.rounds[2].from} → ${expected.rounds[2].to}`, `${cell("Cast on")} / ${cell("Increase round 3")}`);
    type("increases", "5");
    check(results, "…with more increase rounds when asked", !!cell("Increase round 5") && !cell("Increase round 6"));
    type("repeat", "8");
    const stepCounts = [1, 2, 3, 4, 5].map((n) => cell(`Increase round ${n}`).split(" → ").map(Number));
    check(results, "…fitted to the pattern repeat", stepCounts.every(([a, b]) => a % 8 === 0 && b % 8 === 0), JSON.stringify(stepCounts));
    type("repeat", "1");
    type("increases", "3");

    // ---------- the everyday helpers ----------
    pick("evenly");
    type("now", "100");
    type("change", "8");
    check(results, "increase evenly, in the round", view()!.querySelector(".calc-big")?.textContent === "*K13, M1* 4 times, *K12, M1* 4 times.", view()!.querySelector(".calc-big")?.textContent ?? "");
    type("round", "flat");
    check(results, "…and flat", view()!.querySelector(".calc-big")?.textContent === "K12, *M1, K11* 8 times.");
    type("change", "−8");
    check(results, "a minus decreases, the typographic one too", view()!.querySelector(".calc-big")?.textContent === "K10, k2tog, K10, *k2tog, K9* 6 times, k2tog, K10.", view()!.querySelector(".calc-big")?.textContent ?? "");
    check(results, "…saying how many it leaves", /100 → 92/.test(results_()));

    pick("size");
    check(results, "the gauge typed for the raglan is there for the others", field("sts")?.value === "22");
    type("width", "50");
    type("length", "10");
    check(results, "stitches for a width, and rows for a length", cell("Stitches") === "110" && cell("Rows") === "30", `${cell("Stitches")} / ${cell("Rows")}`);
    type("multiple", "4");
    type("plus", "2");
    check(results, "…fitted to a stitch pattern's repeat", cell("Stitches") === "110" && /multiple of 4 plus 2/.test(results_()));
    type("plus", "0");
    check(results, "…the nearest that fits", cell("Stitches") === "112");

    pick("regauge");
    type("psts", "20");
    type("counts", "100, 120");
    const rows = [...view()!.querySelectorAll(".calc-table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent).join(" | "));
    check(results, "a pattern's counts at your gauge, and what they make as written", rows[0]?.startsWith("100 sts | 110 sts | 50 cm; as written 45.5 cm") && rows[1]?.startsWith("120 sts | 132 sts"), rows.join(" / "));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    tab("patterns");
    await waitFor(() => !view(), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__calculatorChecks = verifyCalculators;
