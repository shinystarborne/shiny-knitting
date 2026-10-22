/**
 * Checks for measurements between the garment calculators and People,
 * clicked through: someone picked fills in what they were measured for,
 * says from when and what they lack, and leaves no one else's there; what is
 * typed is kept in People, dated today, for them or for someone new; the
 * round yoke's depth goes back as the armhole's.
 *
 * Run with the harness open:
 *   window.__calcPeopleChecks()
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

async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

type Set = { id: string; personId: string; measuredAt: number; values: Record<string, number>; shoeSize: string };
type Store = { people: { id: string; name: string }[]; measurementSets: Set[]; measureUnit?: string };

export async function verifyCalcPeople() {
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
  const note = () => view()?.querySelector('[data-el="person-note"]')?.textContent ?? "";
  const saved = () => view()?.querySelector('[data-el="people-saved"]')?.textContent ?? "";
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const save = () => view()!.querySelector<HTMLElement>('[data-act="save-measurements"]')!.click();
  const setsOf = (id: string) => store.measurementSets.filter((s) => s.personId === id).sort((a, b) => b.measuredAt - a.measuredAt);
  const today = (s: Set | undefined) => !!s && new Date(s.measuredAt).toDateString() === new Date().toDateString();
  const before = { people: JSON.parse(JSON.stringify(store.people)), sets: JSON.parse(JSON.stringify(store.measurementSets)), unit: store.measureUnit };
  store.measureUnit = "cm";

  try {
    // Someone of its own, measured yesterday for the chest only.
    const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);
    const cleo = await invoke<{ id: string; sets: { id: string }[] }>("add_person", { input: { name: "Cleo", notes: "", extra: [] } });
    await invoke("update_measurement_set", { id: cleo.sets[0].id, input: { measuredAt: Date.now() - 86400000, values: { chest: 60 }, shoeSize: "" } });
    tab("patterns");
    tab("calculators");
    await waitFor(() => !!view()?.querySelector(".calc-pick"), "the calculators");
    (view()!.querySelector('[data-calc="raglan"]') as HTMLElement).click();
    await waitFor(() => !!field("person"), "the raglan");
    type("person", "");
    check(results, "with no one picked, it says People can fill the measurements", /Pick a person from People/.test(note()), note());

    // Someone measured for the chest only: the rest is theirs to type.
    type("wrist", "99");
    type("person", cleo.id);
    const mo = setsOf(cleo.id)[0];
    check(results, "picking someone fills in what they were measured for", field("chest")!.value === String(mo.values.chest), field("chest")!.value);
    check(results, "…says whose and from when, and what they were not measured for", /^From Cleo's measurements of .+: chest\. Not measured yet: upper arm, wrist, neck, armhole depth, arm length\./.test(note()), note());
    check(results, "…and leaves no one else's measurement where they have none", field("wrist")!.value === "");

    // Typed in, and kept for them.
    type("wrist", "13.5");
    type("neck", "29");
    type("chest", String(mo.values.chest));
    const moSets = setsOf(cleo.id).length;
    save();
    await waitFor(() => /Save to Cleo's measurements, dated today/.test(dialog()?.textContent ?? ""), "the question");
    check(results, "Save to People asks first, saying only what is new or changed", /wrist 13\.5 cm, neck 29 cm\?/.test(dialog()!.textContent ?? "") && !/chest/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => /Saved to Cleo's measurements/.test(saved()), "saved");
    const kept = setsOf(cleo.id)[0];
    check(results, "…kept as a set of measurements dated today", setsOf(cleo.id).length === moSets + 1 && today(kept) && kept.values.wrist === 13.5 && kept.values.neck === 29 && !("chest" in kept.values), JSON.stringify(kept));
    check(results, "…and the note now has them as measured", /: chest, wrist, neck\./.test(note()), note());
    type("wrist", "14");
    save();
    await waitFor(() => !!dialog(), "the question");
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => setsOf(cleo.id)[0].values.wrist === 14, "the wrist changed");
    check(results, "measured again the same day, today's set takes it", setsOf(cleo.id).length === moSets + 1 && setsOf(cleo.id)[0].values.neck === 29, JSON.stringify(setsOf(cleo.id)[0]));
    save();
    await waitFor(() => /already say this/.test(saved()), "nothing new");
    check(results, "nothing new: said, and nothing asked or kept", !dialog() && setsOf(cleo.id).length === moSets + 1);

    // Someone new.
    type("person", "");
    for (const [k, v] of [["chest", "88"], ["upperArm", "28"], ["wrist", "15"], ["neck", "34"], ["yokeDepth", "19"], ["armLength", "44"]]) type(k, v);
    save();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "whose");
    const list = dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!;
    check(results, "with no one picked it asks whose, someone new first", list.options[0]?.textContent === "Someone new…" && [...list.options].some((o) => o.textContent === "Cleo"));
    list.value = "+new";
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => !!dialog()?.querySelector("input.dialog-input") && !dialog()!.querySelector("select"), "their name");
    dialog()!.querySelector<HTMLInputElement>("input.dialog-input")!.value = "Bea";
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => /Saved to Bea's measurements/.test(saved()), "Bea saved");
    const bea = store.people.find((p) => p.name === "Bea")!;
    const beaSets = setsOf(bea.id);
    check(results, "someone new is added to People with these as their measurements, asked nothing more", beaSets.length === 1 && beaSets[0].values.chest === 88 && beaSets[0].values.armhole_depth === 19 && beaSets[0].values.arm_length === 44, JSON.stringify(beaSets));
    check(results, "…and the form is for them now", field("person")!.value === bea.id && /^From Bea's measurements/.test(note()), note());

    // The round yoke's depth reaches over the shoulders: People keeps the armhole's.
    (view()!.querySelector('[data-calc="yoke"]') as HTMLElement).click();
    await waitFor(() => !!field("chart"), "the round yoke");
    type("person", bea.id);
    check(results, "the round yoke fills its depth as the armhole's and 2 cm", field("yokeDepth")!.value === "21", field("yokeDepth")!.value);
    type("yokeDepth", "23");
    save();
    await waitFor(() => !!dialog(), "the question");
    check(results, "…and saves it back as the armhole's, 2 cm less", /armhole depth 21 cm \(was 19 cm\)/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => setsOf(bea.id)[0].values.armhole_depth === 21, "the armhole kept");
    check(results, "…kept so", true);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (field("person")) type("person", "");
    store.people = before.people;
    store.measurementSets = before.sets;
    store.measureUnit = before.unit;
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__calcPeopleChecks = verifyCalcPeople;
