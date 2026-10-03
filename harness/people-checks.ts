/**
 * Checks for the People tab: people, their measurements over time, the
 * centimetres or inches setting, and who a project is for.
 *
 * Two halves, as the other tabs' checks: the length functions, checked
 * directly, and the wiring -- the cards, the measurements table, a project's
 * For -- clicked through on the live, stubbed app.
 *
 * Run with the harness open:
 *   window.__peopleChecks()
 */
import type { MeasurementSet, Person } from "../src/api";
import { change, latestShoeSize, latestValue, readLength, showLength, showLengthWithUnit } from "../src/views/measure";

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
  people: { id: string; name: string; notes: string; extra: string[] }[];
  measurementSets: { id: string; personId: string; measuredAt: number; values: Record<string, number>; shoeSize: string }[];
  projects: { id: string; name: string; personId?: string | null }[];
  measureUnit?: string;
};

function pure(results: CheckResult[]): void {
  check(results, "centimetres show to one place, without a trailing .0", showLength(91.44, "cm") === "91.4" && showLength(60, "cm") === "60");
  check(results, "inches are worked out from centimetres", showLength(91.44, "in") === "36" && showLength(60, "in") === "23.6", showLength(60, "in"));
  check(results, "nothing shows as nothing", showLength(0, "cm") === "" && showLength(undefined, "in") === "" && showLengthWithUnit(undefined, "cm") === "");
  check(results, "a length is read in the chosen unit", readLength("91,5", "cm") === 91.5 && readLength("36", "in") === 91.44);
  check(results, "a unit typed with it wins", readLength("36 in", "cm") === 91.44 && readLength('36"', "cm") === 91.44 && readLength("91 cm", "in") === 91);
  check(results, "empty is 0, and words are not a length", readLength("  ", "cm") === 0 && Number.isNaN(readLength("big", "cm")) && Number.isNaN(readLength("3 4", "cm")));
  const sets: MeasurementSet[] = [
    { id: "b", personId: "p", measuredAt: 2, values: { chest: 60, head: 51 }, shoeSize: "" },
    { id: "m", personId: "p", measuredAt: 1, values: { head: 51 }, shoeSize: "EU 28" },
    { id: "a", personId: "p", measuredAt: 0, values: { chest: 58, head: 50 }, shoeSize: "" },
  ];
  check(results, "the change is since the last set that had it", change(sets, 0, "chest", "cm") === "+2" && change(sets, 0, "head", "cm") === "", change(sets, 0, "chest", "cm"));
  check(results, "…in the chosen unit, with a real minus", change([{ ...sets[2], values: { chest: 60 } }, { ...sets[0], values: { chest: 62.54 } }], 0, "chest", "in") === "−1");
  check(results, "the oldest has nothing to compare with", change(sets, 2, "chest", "cm") === "");
  const person = { sets } as Person;
  check(results, "the latest value skips sets without it", latestValue(person, "chest")?.cm === 60 && latestValue(person, "waist") === null);
  check(results, "the latest shoe size given", latestShoeSize(person) === "EU 28");
}

export async function verifyPeople() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const cards = () => [...document.querySelectorAll<HTMLElement>(".people .person-card")];
  const card = (id: string) => document.querySelector<HTMLElement>(`.people .person-card[data-open="${id}"]`);
  const page = () => document.querySelector<HTMLElement>(".person-page");
  const cell = (set: string, key: string) => page()?.querySelector<HTMLInputElement>(`input[data-set="${set}"][data-key="${key}"]`) ?? null;
  const columns = () => [...(page()?.querySelectorAll<HTMLInputElement>('thead input[data-key="date"]') ?? [])].map((i) => i.dataset.set);
  const setOf = (id: string) => store.measurementSets.find((s) => s.id === id);
  const typeIn = (el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const act = (name: string) => (page()!.querySelector(`[data-act="${name}"]`) as HTMLElement).click();
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const answer = async (label: string) => {
    await waitFor(() => !!dialog(), "a question");
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!.click();
    await waitFor(() => !dialog(), "the question to close");
  };
  const ask = async (text: string, ok: string) => {
    await waitFor(() => !!dialog()?.querySelector(".dialog-input"), "a question to type in");
    dialog()!.querySelector<HTMLInputElement>(".dialog-input")!.value = text;
    await answer(ok);
  };
  const openPerson = async (id: string) => {
    tab("people");
    await waitFor(() => !!card(id), "the card");
    card(id)!.click();
    await waitFor(() => !!page() && !!page()!.querySelector(".measure-table"), "the person's page");
  };

  try {
    pure(results);

    // ---------- the cards ----------
    tab("people");
    await waitFor(() => cards().length === store.people.length, "the people cards");
    check(results, "people are listed by name", cards().map((c) => c.querySelector("h3")?.textContent).join(",") === "Anna,Mo");
    const mo = card("pe1")!;
    check(results, "a card says when they were last measured, and how often", /Measured .+ · 2 times/.test(mo.textContent ?? ""), mo.querySelector(".hint")?.textContent ?? "");
    const rowsOf = (el: Element) => [...el.querySelectorAll(".person-measures li")].map((li) => `${li.querySelector("span")?.textContent} ${li.querySelector("b")?.textContent}`).join(" | ");
    const moRows = rowsOf(mo);
    check(results, "…and their latest key measurements, with a shoe size", moRows === "Chest / bust 60 cm | Head 51 cm | Foot length 18.5 cm | Shoe size EU 30", moRows);
    check(results, "…notes, and the projects for them", /No mohair/.test(mo.textContent ?? "") && /1 project for them/.test(mo.textContent ?? ""));
    check(results, "someone not measured says so", /Not measured yet/.test(card("pe2")!.textContent ?? ""));

    // ---------- a person's page ----------
    await openPerson("pe1");
    check(results, "the page has a column per time measured, newest first", columns().join(",") === "ms2,ms1", columns().join(","));
    check(results, "a row for every measurement, their own, and the shoe size", page()!.querySelectorAll("tbody tr").length === 15 + 1 + 1, String(page()!.querySelectorAll("tbody tr").length));
    check(results, "a newer value says how much it changed", cell("ms2", "height")!.parentElement!.querySelector(".measure-delta")?.textContent === "+6" && cell("ms2", "foot_length")!.parentElement!.querySelector(".measure-delta")?.textContent === "+1.5");
    check(results, "each standard measurement says how to take it", /forehead/.test(page()!.querySelector<HTMLElement>("tbody tr:nth-child(12) th")?.title ?? ""), page()!.querySelector<HTMLElement>("tbody tr:nth-child(12) th")?.title ?? "");

    typeIn(cell("ms2", "waist")!, "52");
    await waitFor(() => setOf("ms2")?.values.waist === 52, "the waist to save");
    check(results, "a value typed saves at once", true);
    typeIn(cell("ms2", "hips")!, "25 in");
    await waitFor(() => setOf("ms2")?.values.hips === 63.5, "the hips to save");
    check(results, "a value typed in inches is kept in centimetres", cell("ms2", "hips")?.value === "63.5", cell("ms2", "hips")?.value ?? "");
    typeIn(cell("ms2", "chest")!, "lots");
    await waitFor(() => !!dialog(), "the complaint");
    check(results, "something that is not a length is refused, saying why", /not a length/.test(dialog()!.textContent ?? "") && setOf("ms2")?.values.chest === 60);
    await answer("OK");
    check(results, "…and the cell goes back to what was there", cell("ms2", "chest")?.value === "60");
    typeIn(cell("ms2", "chest")!, "");
    await waitFor(() => setOf("ms2")?.values.chest === undefined, "the chest to clear");
    check(results, "clearing a cell clears the measurement", true);
    typeIn(cell("ms2", "shoe")!, "EU 31");
    await waitFor(() => setOf("ms2")?.shoeSize === "EU 31", "the shoe size");
    check(results, "the shoe size is kept as typed", true);

    // Measuring again, redating, and removing a set.
    const before = store.measurementSets.filter((s) => s.personId === "pe1").length;
    act("measure");
    await waitFor(() => columns().length === 3, "a new column");
    const fresh = columns()[0]!;
    check(results, "Measure again starts a set dated today, first", store.measurementSets.filter((s) => s.personId === "pe1").length === before + 1 && fresh !== "ms2");
    check(results, "…empty, with the last values as a guide", cell(fresh, "height")?.value === "" && cell(fresh, "height")?.placeholder === "116", cell(fresh, "height")?.placeholder ?? "");
    check(results, "…and the cursor in it", document.activeElement === cell(fresh, "height"));
    typeIn(cell(fresh, "height")!, "120");
    await waitFor(() => setOf(fresh)?.values.height === 120, "the new height");
    check(results, "the new set shows the change since the last", cell(fresh, "height")!.parentElement!.querySelector(".measure-delta")?.textContent === "+4");
    typeIn(page()!.querySelector<HTMLInputElement>(`input[data-set="${fresh}"][data-key="date"]`)!, "2001-01-01");
    await waitFor(() => columns().at(-1) === fresh, "the redated set to move");
    check(results, "a set given an older date moves to its place", columns().join(",") === `ms2,ms1,${fresh}`, columns().join(","));
    (page()!.querySelector(`[data-act="remove-set"][data-id="${fresh}"]`) as HTMLElement).click();
    await waitFor(() => !!dialog(), "the confirm");
    check(results, "removing a set asks first, naming its date", /2001/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    await answer("Remove");
    await waitFor(() => columns().length === 2, "the set to go");
    check(results, "the set is gone", !setOf(fresh));

    // Their own measurements.
    act("add-extra");
    await ask("Calf", "Add");
    await waitFor(() => !!cell("ms2", "x:Calf"), "the new row");
    check(results, "a measurement of their own adds a row", store.people.find((p) => p.id === "pe1")?.extra.join("|") === "Thumb length|Calf");
    typeIn(cell("ms2", "x:Calf")!, "24");
    await waitFor(() => setOf("ms2")?.values["x:Calf"] === 24, "the calf");
    (page()!.querySelector('[data-act="remove-extra"][data-name="Thumb length"]') as HTMLElement).click();
    await answer("Remove");
    await waitFor(() => !cell("ms2", "x:Thumb length"), "the row to go");
    check(results, "removing one takes its values from every date", setOf("ms2")?.values["x:Thumb length"] === undefined && setOf("ms2")?.values["x:Calf"] === 24);

    // Name and notes save as they are typed.
    const notes = page()!.querySelector<HTMLTextAreaElement>('[data-f="notes"]')!;
    notes.value = "Loves green and yellow.";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => store.people.find((p) => p.id === "pe1")?.notes === "Loves green and yellow.", "the notes to save", 3000);
    check(results, "notes save a moment after typing", true);

    // Inches, from the setting.
    store.measureUnit = "in";
    await openPerson("pe1");
    check(results, "with inches chosen, the table shows inches", cell("ms2", "foot_length")?.value === "7.3" && /inches/.test(page()!.querySelector(".person-toolbar")?.textContent ?? ""), cell("ms2", "foot_length")?.value ?? "");
    typeIn(cell("ms2", "neck")!, "11");
    await waitFor(() => setOf("ms2")?.values.neck === 27.94, "the neck in inches");
    check(results, "…and reads what is typed as inches", true);
    store.measureUnit = "cm";

    // ---------- who a project is for ----------
    await openPerson("pe1");
    (page()!.querySelector('.person-projects [data-act="open-project"]') as HTMLElement).click();
    const side = () => document.querySelector<HTMLElement>(".project-page .project-side");
    await waitFor(() => !!side()?.querySelector(".project-person"), "the project page");
    check(results, "a person's projects open from their page", side()!.querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Gift hat");
    const forBox = side()!.querySelector<HTMLSelectElement>('[data-f="person"]')!;
    check(results, "the project says who it is for", forBox.value === "pe1");
    const block = side()!.querySelector(".project-person")!;
    const shown = rowsOf(block);
    check(results, "…with their latest measurements", /Mo's measurements/.test(block.textContent ?? "") && /Head 51 cm/.test(shown) && /Calf 24 cm/.test(shown) && /Shoe size EU 31/.test(shown), shown);
    forBox.value = "pe2";
    forBox.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => /Anna's measurements/.test(side()?.querySelector(".project-person")?.textContent ?? ""), "Anna");
    check(results, "choosing someone else saves on its own", store.projects.find((p) => p.id === "pr2")?.personId === "pe2" && /None taken yet/.test(side()!.querySelector(".project-person")!.textContent ?? ""));
    const name = side()!.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.value = "Gift hat for Anna";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.projects.find((p) => p.id === "pr2")?.name === "Gift hat for Anna", "the rename");
    check(results, "saving the project's details keeps who it is for", store.projects.find((p) => p.id === "pr2")?.personId === "pe2");
    (side()!.querySelector('[data-act="open-person"]') as HTMLElement).click();
    await waitFor(() => page()?.querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Anna", "Anna's page");
    check(results, "Measure them opens their page", true);

    // ---------- adding and removing ----------
    tab("people");
    await waitFor(() => cards().length > 0, "the people");
    (document.querySelector('.people [data-act="add"]') as HTMLElement).click();
    await ask("Lena", "Add");
    await waitFor(() => page()?.querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Lena", "Lena's page");
    const lena = store.people.find((p) => p.name === "Lena")!;
    check(results, "a new person opens on their page, with a set to fill in", columns().length === 1 && store.measurementSets.filter((s) => s.personId === lena.id).length === 1);
    tab("people");
    await waitFor(() => !!card("pe2"), "the cards");
    (card("pe2")!.querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the confirm");
    check(results, "removing someone says their projects stay", /project for them stays/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    await answer("Remove");
    await waitFor(() => !card("pe2"), "the card to go");
    check(results, "they are gone, and the project is for no one", !store.people.some((p) => p.id === "pe2") && !store.projects.find((p) => p.id === "pr2")?.personId);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.measureUnit = "cm";
    document.querySelector<HTMLElement>(".dialog-card button.ghost")?.click();
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.people)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__peopleChecks = verifyPeople;
