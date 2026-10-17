/**
 * Checks for how much yarn a garment takes: a stitch's yarn from the gauge,
 * a sweater's and a pair of socks' fabric, the weight a gauge is knitted at,
 * the metres in balls and grams of a yarn, the stash's yarns against what is
 * needed; and the calculators saying it all, in the swatch's own yarn, in
 * the plan to copy too.
 *
 * Run with the harness open:
 *   window.__yarnNeedChecks()
 */
import type { Yarn } from "../src/api";
import { sock, type SockResult } from "../src/views/socks";
import { cmPerStitch, familyByGauge, inYarn, metresForArea, socksArea, stashFor, sweaterArea } from "../src/views/yarn-need";

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
  const dk = { sts: 22, rows: 30 };
  check(results, "a stitch's yarn from the gauge: about 1.7 cm at 22 × 30", Math.abs(cmPerStitch(dk) - 1.697) < 0.01, String(cmPerStitch(dk)));
  check(results, "…less at a finer gauge", cmPerStitch({ sts: 32, rows: 44 }) < 1.2);

  const finished = { chest: 100, upperArm: 32, wrist: 20, neck: 48, yokeDepth: 22 };
  const area = sweaterArea(finished, { bodyLength: 40, armLength: 45, neckRib: 2.5 });
  check(results, "a sweater's fabric: body, sleeves, yoke and neckband", area === 4000 + 2340 + 2332 + 120, String(area));
  check(results, "…a cardigan's bands added", sweaterArea(finished, { bodyLength: 40, armLength: 45, neckRib: 2.5, bandWidth: 2.5 }) === area + 2 * 2.5 * 62);
  const m = metresForArea(area, dk);
  check(results, "a DK sweater takes about 1 100 m, a tenth to spare", m > 1000 && m < 1200, String(Math.round(m)));

  const input = { gauge: { sts: 32, rows: 44 }, footAround: 22, footLength: 24, ease: 10, shorter: 1, leg: 15, cuff: 3, direction: "down" as const, heel: "flap" as const, toe: "wedge" as const, rib: 4 };
  const r = sock(input) as SockResult;
  const pair = metresForArea(socksArea(r, input), input.gauge);
  check(results, "a pair of socks of 64 stitches, about 300 m", pair > 260 && pair < 400, String(Math.round(pair)));
  const shortRow = sock({ ...input, heel: "short-row" }) as SockResult;
  check(results, "…a short-row heel takes less than a flap and gusset", metresForArea(socksArea(shortRow, { ...input, heel: "short-row" }), input.gauge) < pair);

  check(results, "the weight a gauge is knitted at", familyByGauge(22) === "dk" && familyByGauge(32) === "fingering" && familyByGauge(18) === "worsted" && familyByGauge(14) === "bulky" && familyByGauge(36) === "lace");

  const yarn = (fields: Partial<Yarn>) => ({ id: "y", brand: "Drops", name: "Merino", colourway: "", metresPerBall: 225, gramsPerBall: 50, metresLeft: 0, usedUpAt: null, yarnWeightFamily: "dk", lots: [], ...fields }) as unknown as Yarn;
  const own = inYarn(1083, yarn({}));
  check(results, "in a yarn: metres up to the ten, grams, and whole balls", own.metres === 1090 && own.balls === 5 && own.grams === 243, JSON.stringify(own));
  check(results, "…a yarn of no known metres says metres only", inYarn(1083, yarn({ metresPerBall: 0 })).balls === null && inYarn(1083, null).metres === 1090);

  const stash = [
    yarn({ id: "a", name: "Big", metresLeft: 2000 }),
    yarn({ id: "b", name: "Just", metresLeft: 1100 }),
    yarn({ id: "c", name: "Short", metresLeft: 700 }),
    yarn({ id: "d", name: "Shorter", metresLeft: 300, metresPerBall: 0 }),
    yarn({ id: "e", name: "Gone", metresLeft: 5000, usedUpAt: 1 }),
    yarn({ id: "f", name: "Aran", metresLeft: 5000, yarnWeightFamily: "aran" }),
  ];
  const fits = stashFor(1090, stash, "dk");
  check(results, "the stash: enough first, the nearest to enough first; then the least short", fits.map((f) => f.yarn.id).join() === "b,a,c,d", fits.map((f) => f.yarn.id).join());
  check(results, "…how many balls short, or metres when a ball's are not known", fits[2].ballsShort === 2 && fits[3].ballsShort === null && fits[3].metresShort === 790, JSON.stringify(fits.slice(2).map((f) => [f.ballsShort, f.metresShort])));
}

export async function verifyYarnNeed() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { measureUnit?: string } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".calculators");
  const field = (k: string) => view()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-k="${k}"]`) ?? null;
  const type = (k: string, v: string) => {
    const el = field(k)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const out = () => view()?.querySelector<HTMLElement>('[data-el="results"]')?.innerText.replace(/\s+/g, " ") ?? "";
  const unit = store.measureUnit;
  store.measureUnit = "cm";
  let swatchId = "";
  let yarnId = "";

  try {
    pure(results);
    // A sock yarn of its own in the stash, five balls of it, and a swatch in it at a sock's gauge.
    const y = await invoke<{ id: string }>("add_yarn", {
      input: { name: "Need Sock", brand: "Drops", colourway: "Peat", yarnWeight: "fingering", metresPerBall: 400, gramsPerBall: 100, notes: "", fibres: [], superwash: false, plans: [], lots: [{ dyeLot: "", balls: 5, gramsLeft: 0, location: "", boughtAt: null, leftover: false }] },
    });
    yarnId = y.id;
    const sw = await invoke<{ id: string }>("add_swatch", { input: { yarnId, yarnText: "", toolId: null, needleMm: 2.5, stitch: "Stocking stitch", sts: 32, rows: 44, stsBlocked: 0, rowsBlocked: 0, projectId: null, notes: "", madeAt: null } });
    swatchId = sw.id;
    tab("patterns");
    tab("calculators");
    await waitFor(() => !!view()?.querySelector('[data-calc="socks"]'), "the calculators");
    (view()!.querySelector('[data-calc="socks"]') as HTMLElement).click();
    await waitFor(() => !!field("sockHeel"), "the socks");
    type("person", "");
    type("swatch", "");
    type("sts", "32");
    type("rows", "44");
    type("footAround", "22");
    type("footLength", "24");
    type("sockDir", "down");
    await waitFor(() => !!field("sockHeel"), "the form again");
    type("sockHeel", "flap");
    await waitFor(() => /About \d+ m/.test(out()), "the yarn");
    const metres = Number(/About ([\d ]+) m/.exec(out())![1].replace(/ /g, ""));
    check(results, "the socks say how much yarn: about 300 m, a tenth to spare", metres > 260 && metres < 400 && /with a tenth to spare/.test(out()), out().slice(0, 300));
    check(results, "…and without a stash yarn's swatch, how to have it in grams and balls", /Pick the swatch you knitted for it/.test(out()));
    check(results, "…the stash's fingering yarns: Need Sock has enough", /Fingering in your stash: .*Drops Need Sock \(Peat\) [\d ]+ m enough/.test(out()), out());

    type("swatch", swatchId);
    await waitFor(() => /In your swatch's yarn/.test(out()), "the swatch's yarn");
    check(results, "the swatch's own yarn: grams and balls of it", new RegExp(`In your swatch's yarn: ${Math.ceil(metres / 400 * 100)} g, 1 ball of Drops Need Sock \\(Peat\\)`).test(out()), out());
    // What Copy puts on the clipboard says it too.
    let copied = "";
    const clipboard = navigator.clipboard;
    const writeText = clipboard.writeText;
    Object.defineProperty(clipboard, "writeText", { configurable: true, value: async (t: string) => void (copied = t) });
    try {
      view()!.querySelector<HTMLElement>('[data-act="copy"]')!.click();
      await waitFor(() => !!copied, "the copy");
    } finally {
      Object.defineProperty(clipboard, "writeText", { configurable: true, value: writeText });
    }
    check(results, "…said in the plan to copy", /Yarn: about [\d ]+ m, with a tenth to spare: \d+ g, 1 ball of Drops Need Sock \(Peat\)\.$/.test(copied), copied.slice(-200));

    // A sweater.
    (view()!.querySelector('[data-calc="raglan"]') as HTMLElement).click();
    await waitFor(() => !!field("chest"), "the raglan");
    type("swatch", "");
    type("sts", "22");
    type("rows", "30");
    for (const [k, v] of [["chest", "92"], ["upperArm", "30"], ["wrist", "16"], ["neck", "36"], ["yokeDepth", "20"], ["armLength", "45"]]) type(k, v);
    await waitFor(() => /About [\d ]+ m/.test(out()), "the sweater's yarn");
    const sweater = Number(/About ([\d ]+) m/.exec(out())![1].replace(/ /g, ""));
    check(results, "a raglan says its yarn too: a DK sweater, over 1 000 m", sweater > 1000 && sweater < 1800 && /DK in your stash/.test(out()), `${sweater} ${out().slice(0, 200)}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (swatchId) await invoke("delete_swatch", { id: swatchId }).catch(() => {});
    if (yarnId) await invoke("delete_yarn", { id: yarnId }).catch(() => {});
    if (field("swatch")) type("swatch", "");
    store.measureUnit = unit;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__yarnNeedChecks = verifyYarnNeed;
