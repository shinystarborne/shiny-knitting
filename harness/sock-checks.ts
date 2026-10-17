/**
 * Checks for the socks calculator: the stitches from a foot and a gauge with
 * negative ease, the toes (wedge, round) and the six heels with their counts,
 * cuff-down and toe-up, the foot's length after the toe and the heel, and
 * the tab: a person's foot filled in, the heels on offer for the way it is
 * worked, the numbers and steps, and the foot kept in People.
 *
 * Run with the harness open:
 *   window.__sockChecks()
 */
import { HEELS, heelTurn, sock, sockSteps, toePlan, type SockInput, type SockResult } from "../src/views/socks";

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

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

function pure(results: CheckResult[]): void {
  // 32 stitches and 44 rounds to 10 cm, a 22 cm foot, 24 cm long.
  const base: SockInput = { gauge: { sts: 32, rows: 44 }, footAround: 22, footLength: 24, ease: 10, shorter: 1, leg: 15, cuff: 3, direction: "down", heel: "flap", toe: "wedge", rib: 4 };
  const make = (more: Partial<SockInput>) => sock({ ...base, ...more }) as SockResult;
  const r = make({});
  check(results, "the stitches: the foot less 10%, at the gauge, to a multiple of 4", r.sts === 64 && r.half === 32 && near(r.finished.around, 20), JSON.stringify([r.sts, r.finished.around]));
  check(results, "…less ease, more stitches", make({ ease: 5 }).sts === 68 && make({ ease: 0 }).sts === 72);

  const wedge = toePlan(64, "wedge", 4.4);
  check(results, "a wedge toe: every other round to half, every round to a quarter", wedge.everyOther === 8 && wedge.everyRound === 4 && wedge.mid === 32 && wedge.end === 16 && wedge.rounds === 20, JSON.stringify(wedge));
  const round = toePlan(64, "round", 4.4);
  check(results, "a round toe goes on to 8, drawn closed", round.end === 8 && round.everyRound === 6 && round.rounds === 22, JSON.stringify(round));

  check(results, "the heel turn: 32 stitches leave 18 in 14 rows", JSON.stringify(heelTurn(32)) === JSON.stringify({ rows: 14, sts: 18 }), JSON.stringify(heelTurn(32)));
  check(results, "…36 leave 20, and 30 (an odd half) leave 16", heelTurn(36).sts === 20 && heelTurn(30).sts === 16 && heelTurn(30).rows === 14, JSON.stringify([heelTurn(36), heelTurn(30)]));
  check(results, "a flap heel: as many rows as stitches, half and one picked up each side, the gusset back to 64", r.heel.flapRows === 32 && r.heel.pickUp === 17 && r.heel.gusset === 10, JSON.stringify(r.heel));
  check(results, "…the foot knitted to its length less the toe, from the back of the heel", near(r.footCm, 23) && near(r.footToCm, 23 - 20 / 4.4), JSON.stringify([r.footCm, r.footToCm]));

  const short = make({ heel: "short-row" });
  check(results, "a short-row heel: a third turned at each side, the middle third left", short.heel.sides === 10 && short.heel.middle === 12 && short.heel.between === 0);
  check(results, "…the Fish Lips Kiss with a round between its halves, the boomerang with two", make({ heel: "fish-lips" }).heel.between === 1 && make({ heel: "boomerang" }).heel.between === 2);
  const after = make({ heel: "afterthought" });
  check(results, "an afterthought heel: picked up round the waste yarn and 2 at each corner, shaped as a toe", after.heel.pickedUp === 68 && after.heel.shaping?.end === 16 && near(after.footToCm, 23 - 20 / 4.4 - 21 / 4.4), JSON.stringify([after.heel.pickedUp, after.footToCm]));

  const upFlap = sock({ ...base, direction: "up" });
  check(results, "the flap heel is cuff-down only: toe-up has the gusset heel", "error" in upFlap && /cuff-down/.test(upFlap.error), JSON.stringify(upFlap));
  const gusset = make({ direction: "up", heel: "gusset-up" });
  check(results, "the toe-up gusset heel: increases to nearly twice the sole, a flap taking them back", gusset.heel.gusset === 15 && gusset.heel.flapRows === 30, JSON.stringify(gusset.heel));
  const upShort = make({ direction: "up", heel: "short-row" });
  check(results, "toe-up, the heel starts at the foot's length less the heel", near(upShort.footToCm, 23 - 20 / 4.4), String(upShort.footToCm));
  check(results, "each heel is offered the way it is worked", HEELS.filter((h) => h.ways.includes("down")).map((h) => h.key).join() === "flap,short-row,fish-lips,boomerang,afterthought" && HEELS.filter((h) => h.ways.includes("up")).map((h) => h.key).join() === "gusset-up,short-row,fish-lips,boomerang,afterthought");

  const len = (cm: number) => `${Math.round(cm * 10) / 10} cm`;
  const down = sockSteps(r, base, len).join(" | ");
  check(results, "cuff-down steps: cast on, cuff, leg, flap, turn, gusset, foot, toe grafted", /Cast on 64/.test(down) && /k2, p2 rib for 13 rounds/.test(down) && /Heel flap, over 32/.test(down) && /18 stitches left/.test(down) && /pick up and knit 17/.test(down) && /Graft the 8 and 8/.test(down), down);
  const upSteps = sockSteps(upShort, { ...base, direction: "up", heel: "short-row", toe: "round" }, len).join(" | ");
  check(results, "toe-up steps: a cast-on at the toe, the heel, the leg, a stretchy bind-off", /circular cast-on/.test(sockSteps(make({ direction: "up", heel: "short-row", toe: "round" }), { ...base, direction: "up", heel: "short-row", toe: "round" }, len).join(" ")) && /Judy's magic cast-on/.test(upSteps) && /double stitch/.test(upSteps) && /Bind off stretchy/.test(upSteps), upSteps);
  const afterSteps = sockSteps(after, { ...base, heel: "afterthought" }, len).join(" | ");
  check(results, "an afterthought heel's steps: the waste yarn, then the heel last", /with a waste yarn/.test(afterSteps) && /pick up 32 stitches below the waste yarn/.test(afterSteps) && afterSteps.indexOf("waste yarn, slip") < afterSteps.indexOf("Graft"), afterSteps);

  const missing = sock({ ...base, gauge: { sts: 32, rows: 0 } });
  check(results, "no rows to the gauge: said", "error" in missing && /rows/.test(missing.error));
  check(results, "few stitches warned of", make({ footAround: 12 }).warnings.some((w) => /few for a sock/.test(w)));
}

export async function verifySocks() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { people: unknown[]; measurementSets: { personId: string; measuredAt: number; values: Record<string, number> }[]; measureUnit?: string } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".calculators");
  const field = (k: string) => view()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-k="${k}"]`) ?? null;
  const type = (k: string, v: string) => {
    const el = field(k)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // Cells and lines apart, as they read.
  const out = () => view()?.querySelector<HTMLElement>('[data-el="results"]')?.innerText.replace(/\s+/g, " ") ?? "";
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const before = { people: JSON.parse(JSON.stringify(store.people)), sets: JSON.parse(JSON.stringify(store.measurementSets)), unit: store.measureUnit };
  store.measureUnit = "cm";

  try {
    pure(results);

    const dana = await invoke<{ id: string; sets: { id: string }[] }>("add_person", { input: { name: "Dana", notes: "", extra: [] } });
    await invoke("update_measurement_set", { id: dana.sets[0].id, input: { measuredAt: Date.now() - 86400000, values: { foot_around: 22, foot_length: 24 }, shoeSize: "38" } });
    tab("patterns");
    tab("calculators");
    await waitFor(() => !!view()?.querySelector('[data-calc="socks"]'), "the calculators");
    (view()!.querySelector('[data-calc="socks"]') as HTMLElement).click();
    await waitFor(() => !!field("sockHeel"), "the socks");
    check(results, "Socks is among the calculators, after the round yoke", view()!.querySelector('[data-calc="yoke"] + [data-calc="socks"]') !== null);
    type("person", dana.id);
    check(results, "a person's foot fills in, round and long", field("footAround")!.value === "22" && field("footLength")!.value === "24", `${field("footAround")!.value} ${field("footLength")!.value}`);
    check(results, "…and the note says so", /From Dana's measurements of .+: foot, foot length\./.test(view()!.querySelector('[data-el="person-note"]')?.textContent ?? ""), view()!.querySelector('[data-el="person-note"]')?.textContent ?? "");
    type("swatch", "");
    type("sts", "32");
    type("rows", "44");
    type("sockDir", "down");
    await waitFor(() => !!field("sockHeel"), "the form again");
    type("sockHeel", "flap");
    check(results, "cuff-down offers its five heels, the flap first", [...field("sockHeel")!.options].map((o) => o.value).join() === "flap,short-row,fish-lips,boomerang,afterthought");
    check(results, "the numbers: 64 stitches, the flap, turn and gusset", /Stitches 64/.test(out()) && /Heel turn 32 → 18/.test(out()) && /17 picked up each side/.test(out()), out());
    check(results, "…and the steps, to copy or save", view()!.querySelectorAll(".calc-steps li").length >= 9 && !!view()!.querySelector('[data-act="copy"]'));
    type("sockDir", "up");
    await waitFor(() => field("sockDir")?.value === "up", "toe-up");
    check(results, "toe-up, the flap heel becomes the toe-up gusset heel", field("sockHeel")!.value === "gusset-up" && !/flap"/.test([...field("sockHeel")!.options].map((o) => `${o.value}"`).join()));
    type("sockHeel", "boomerang");
    check(results, "the heel's hint and numbers follow the heel chosen", /two rounds between/.test(view()!.querySelector('[data-el="heel-hint"]')?.textContent ?? "") && /2 rounds between the halves/.test(out()), out());
    type("sockToe", "round");
    check(results, "a round toe, toe-up, starts from 8", /Toe 8 → 64/.test(out()), out());
    type("footAround", "");
    check(results, "without the foot it says what is missing", /foot round/.test(out()), out());
    type("footAround", "22.5");

    // The foot kept in People.
    view()!.querySelector<HTMLElement>('[data-act="save-measurements"]')!.click();
    await waitFor(() => /Keep in Dana's measurements/.test(dialog()?.textContent ?? ""), "the question");
    check(results, "Save to People keeps the foot that changed", /foot 22\.5 cm \(was 22 cm\)/.test(dialog()!.textContent ?? "") && !/foot length/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => store.measurementSets.some((s) => s.personId === dana.id && s.values.foot_around === 22.5), "kept");
    check(results, "…dated today", true);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (field("person")) type("person", "");
    if (field("sockDir")) type("sockDir", "down");
    store.people = before.people;
    store.measurementSets = before.sets;
    store.measureUnit = before.unit;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__sockChecks = verifySocks;
