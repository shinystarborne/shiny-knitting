/**
 * Checks for projects: the tab, starting one with its needles and yarn,
 * finishing it -- needles released, leftovers back in the stash -- and the
 * reader's project pane. Clicked through on the live, stubbed app.
 *
 * Run with the harness open:
 *   window.__projectChecks()
 */

import { fitView, freeSpot, linkFrom, toBoard, zoomAt } from "../src/views/board";

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

interface Store {
  projects: { id: string; name: string; status: string; patternId: string | null; finishedAt: number | null }[];
  projectTools: { projectId: string; toolId: string }[];
  projectYarns: { id: string; projectId: string; yarnId: string; lotId: string | null; leftoverGrams: number | null }[];
  yarns: { id: string; name: string; lots: { id: string; gramsLeft: number; leftover?: boolean }[] }[];
  patterns: { id: string; title: string; status: string }[];
  yarnUsage: { yarnId: string | null; grams: number; projectName: string }[];
}

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyProjects() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const cards = () => [...document.querySelectorAll<HTMLElement>(".projects .project-card")];
  const form = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .project-form");
  const finish = () => document.querySelector<HTMLElement>(".modal-backdrop:not(.hidden) .finish-form");
  const f = (name: string) => form()?.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-f="${name}"]`) ?? null;
  const change = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const activeOn = (toolId: string) =>
    store.projectTools.find((l) => l.toolId === toolId && store.projects.find((p) => p.id === l.projectId)?.status === "active")?.projectId ?? null;

  // The board's arithmetic.
  const v = { x: 100, y: 50, scale: 2 };
  const at = toBoard(v, 300, 250);
  check(results, "a screen point maps to the board", at.x === 100 && at.y === 100, JSON.stringify(at));
  const z = zoomAt(v, 1.5, 300, 250);
  const still = toBoard(z, 300, 250);
  check(results, "zooming keeps the point under the pointer", Math.abs(still.x - 100) < 1e-9 && Math.abs(still.y - 100) < 1e-9 && z.scale === 3, JSON.stringify(z));
  check(results, "zoom stops at its limits", zoomAt(v, 100, 0, 0).scale === 3 && zoomAt(v, 0.001, 0, 0).scale === 0.2);
  const fit = fitView([{ x: 0, y: 0, w: 1000, h: 500 }], 600, 400, 50);
  check(results, "Fit shows everything", fit.scale === 0.5 && toBoard(fit, 300, 200).x === 500, JSON.stringify(fit));
  check(results, "Fit never zooms past 100%", fitView([{ x: 0, y: 0, w: 10, h: 10 }], 600, 400).scale === 1);
  const taken = [{ x: -100, y: -80, w: 200, h: 160 }];
  const spot = freeSpot(taken, 200, 160, 0, 0);
  check(results, "a new item goes beside, not on top of, what is there", spot.x + 200 + 24 <= -100 || spot.x >= 124 || spot.y + 160 + 24 <= -80 || spot.y >= 104, JSON.stringify(spot));
  check(results, "an empty board puts it in the middle", JSON.stringify(freeSpot([], 200, 160, 0, 0)) === '{"x":-100,"y":-80}');
  check(results, "an address without https is taken as https", linkFrom("ravelry.com/patterns") === "https://ravelry.com/patterns");
  check(results, "a full address is kept", linkFrom("http://example.com/a?b=1") === "http://example.com/a?b=1");
  check(results, "words are not a link", linkFrom("cast on 64") === null && linkFrom("javascript:alert(1)") === null && linkFrom("hello") === null);

  try {
    tab("projects");
    await waitFor(() => cards().length === store.projects.length, "the project cards");
    check(results, "the Projects tab lists every project", cards().length === 2, String(cards().length));
    const first = cards().find((c) => c.dataset.open === "pr1")!;
    check(results, "a card shows the name, its pattern and that it is active", /Featherweight Lace Sock/.test(first.textContent ?? "") && !!first.querySelector(".project-active") && !!first.querySelector('[data-act="open-pattern"]'));
    check(results, "…and what is on it", /1 needle or hook/.test(first.querySelector(".project-on")?.textContent ?? ""), first.querySelector(".project-on")?.textContent ?? "");
    check(results, "a project without a pattern says so", /No pattern/.test(cards().find((c) => c.dataset.open === "pr2")!.textContent ?? ""));

    // Start a project from the tab.
    (document.querySelector('.projects [data-act="add"]') as HTMLElement).click();
    await waitFor(() => !!form()?.querySelector('[data-el="tools"] .tool-add'), "the new project form");
    // Another suite may have renamed it, earlier in the same run.
    const p3 = store.patterns.find((p) => p.id === "p3")!.title;
    // The pattern is searched for, not scrolled to.
    const search = form()!.querySelector<HTMLInputElement>(".pattern-pick-input")!;
    const items = () => [...form()!.querySelectorAll<HTMLElement>(".pattern-pick-item")].map((li) => li.textContent?.trim().replace(/\s+/g, " ") ?? "");
    search.focus();
    check(results, "the pattern box lists the library when it is clicked into, no pattern first", items()[0] === "No pattern" && items().length === store.patterns.length + 1, items().join(" | "));
    search.value = "long format";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…and narrows to the patterns whose title, designer or tags have every word typed", items().length === 2 && items()[1].startsWith(p3), items().join(" | "));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    check(results, "Enter picks the match", f("pattern")!.value === "p3" && search.value === p3 && !!form()!.querySelector<HTMLElement>(".pattern-pick-list")!.hidden, `${f("pattern")!.value} / ${search.value}`);
    check(results, "choosing a pattern offers its title as the name", f("name")!.placeholder.startsWith(p3), f("name")!.placeholder);
    search.blur();
    const toolSel = () => form()!.querySelector<HTMLSelectElement>('[data-el="tools"] [data-el="tool-add"]')!;
    const toolUse = () => form()!.querySelector<HTMLButtonElement>('[data-el="tools"] [data-act="tool-use"]')!;
    change(toolSel(), "t3");
    toolUse().click();
    check(results, "a free needle can be chosen", /4 mm circular needle, 40 cm/.test(form()!.querySelector('[data-el="tools"] .tool-list')?.textContent ?? ""));
    check(results, "a needle on another project is offered, saying where", [...toolSel().querySelectorAll<HTMLOptionElement>('optgroup[label^="On another project"] option')].some((o) => o.value === "t2" && /Gift hat/.test(o.textContent ?? "")));
    change(toolSel(), "t2");
    toolUse().click();

    const yarnSel = () => form()!.querySelector<HTMLSelectElement>('[data-el="yarns"] [data-el="yarn-add"]')!;
    const lotSel = () => form()!.querySelector<HTMLSelectElement>('[data-el="yarns"] [data-el="yarn-lot"]')!;
    const yarnUse = () => form()!.querySelector<HTMLButtonElement>('[data-el="yarns"] [data-act="yarn-use"]')!;
    change(yarnSel(), "y1");
    check(results, "a yarn with two lots asks which", !lotSel().hidden && yarnUse().disabled);
    change(lotSel(), "l2");
    check(results, "…and Use waits for the lot", !yarnUse().disabled);
    yarnUse().click();
    change(yarnSel(), "y3");
    check(results, "a yarn with one lot does not ask", lotSel().hidden && !yarnUse().disabled);
    yarnUse().click();
    const chosenYarn = form()!.querySelector('[data-el="yarns"] .tool-list')?.textContent ?? "";
    check(results, "the chosen yarn shows its lot", /Shetland Sock · Peat — lot L57 \(200 g left\)/.test(chosenYarn) && /Handspun/.test(chosenYarn), chosenYarn);
    // How much each will take: in balls by the ball band, or all of it.
    const planned = (i: number) => form()!.querySelector<HTMLInputElement>(`[data-el="planned"][data-index="${i}"]`)!;
    const plannedUnit = (i: number) => form()!.querySelector<HTMLSelectElement>(`[data-el="planned-unit"][data-index="${i}"]`)!;
    const plannedNote = (i: number) => form()!.querySelector<HTMLElement>(`[data-el="planned-note"][data-index="${i}"]`)!.textContent ?? "";
    plannedUnit(0).value = "balls";
    planned(0).value = "1.5";
    planned(0).dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "how much a yarn will take is typed in balls, and kept in grams", planned(0).value === "150" && plannedNote(0) === "150 g, 1.5 balls ≈ 600 m", `${planned(0).value} / ${plannedNote(0)}`);
    (form()!.querySelector('[data-act="yarn-all"][data-index="1"]') as HTMLElement).click();
    const handspun = store.yarns.find((y) => y.id === "y3") as unknown as { lots: { gramsLeft: number }[] };
    check(results, "…or All of it, what there is of it", planned(1).value === String(handspun.lots[0].gramsLeft), `${planned(1).value} vs ${handspun.lots[0].gramsLeft}`);
    f("name")!.value = "Long socks for Mum";
    const n = store.projects.length;
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !form() && store.projects.length === n + 1, "the project to start");
    const made = store.projects[store.projects.length - 1];
    check(results, "the project is saved with its pattern", made.name === "Long socks for Mum" && made.patternId === "p3" && made.status === "active");
    check(results, "its needles are in use on it", activeOn("t3") === made.id && activeOn("t2") === made.id);
    check(results, "the one taken from another project left it", !store.projectTools.some((l) => l.projectId === "pr2" && l.toolId === "t2"));
    check(results, "its yarn is on it, from the lot chosen", store.projectYarns.filter((e) => e.projectId === made.id).map((e) => `${e.yarnId}:${e.lotId}`).join(" ") === "y1:l2 y3:l4");
    check(results, "…with how much each will take", store.projectYarns.filter((e) => e.projectId === made.id).map((e) => (e as unknown as { plannedGrams: number }).plannedGrams).join(" ") === `150 ${handspun.lots[0].gramsLeft}`);
    // Started from the tab, it opens on its own page.
    const page = () => document.querySelector<HTMLElement>(".project-page");
    const side = () => page()!.querySelector<HTMLElement>(".project-side")!;
    await waitFor(() => !!page()?.querySelector(".board"), "the new project's page");
    check(results, "a project started from the tab opens on its page", side().querySelector<HTMLInputElement>('[data-f="name"]')?.value === "Long socks for Mum");
    tab("projects");
    await waitFor(() => cards().length === n + 1, "the new card");

    // The stash shows the yarn in use.
    tab("stash");
    const yarnCard = (id: string) => document.querySelector<HTMLElement>(`.stash .card[data-open="${id}"]`);
    await waitFor(() => !!yarnCard("y1"), "the stash");
    check(results, "the stash says the yarn is in use, and on what", /In use: Long socks for Mum/.test(yarnCard("y1")!.querySelector(".card-use")?.textContent ?? ""));
    const useBox = (v: string) => document.querySelector<HTMLInputElement>(`.stash input[data-filter="use"][value="${v}"]`)!;
    useBox("in-use").checked = true;
    useBox("in-use").dispatchEvent(new Event("change", { bubbles: true }));
    const inUse = [...document.querySelectorAll<HTMLElement>(".stash .card")].map((c) => c.dataset.open).sort().join(",");
    check(results, "In use shows only the yarn on projects", inUse === "y1,y3", inUse);
    (document.querySelector('.stash [data-act="clear"]') as HTMLElement).click();

    // Finish it.
    tab("projects");
    await waitFor(() => cards().length > 0, "the projects again");
    cards().find((c) => c.dataset.open === made.id)!.click();
    await waitFor(() => !!page()?.querySelector('.project-side [data-act="finish"]'), "the project page");
    (side().querySelector('[data-act="finish"]') as HTMLElement).click();
    await waitFor(() => !!finish(), "the finish dialog");
    check(results, "finishing lists the needles that go back to free", /4 mm circular needle, 40 cm/.test(finish()!.textContent ?? "") && /80 cm/.test(finish()!.textContent ?? ""));
    const grams = [...finish()!.querySelectorAll<HTMLInputElement>("input[data-entry]")];
    check(results, "…and asks what each yarn used", grams.length === 2);
    check(results, "…offering to mark the pattern Finished", !!finish()!.querySelector<HTMLInputElement>('[data-f="mark-pattern"]')?.checked);
    const entryFor = (yarnId: string) => store.projectYarns.find((e) => e.projectId === made.id && e.yarnId === yarnId)!.id;
    const amountIn = (yarnId: string) => finish()!.querySelector<HTMLInputElement>(`input[data-entry="${entryFor(yarnId)}"]`)!;
    const unitOf = (yarnId: string) => finish()!.querySelector<HTMLSelectElement>(`select[data-unit="${entryFor(yarnId)}"]`)!;
    check(results, "…filled in with what each was to take, in grams when not whole balls", amountIn("y1").value === "150" && unitOf("y1").value === "used-g" && amountIn("y3").value === "87", `${amountIn("y1").value} ${unitOf("y1").value} / ${amountIn("y3").value}`);
    check(results, "…balls only for a yarn with a weight per ball", !!unitOf("y1").querySelector('[value="used-balls"]') && !unitOf("y3").querySelector('[value="used-balls"]'));
    const say = (yarnId: string, value: string, unit: string) => {
      amountIn(yarnId).value = value;
      unitOf(yarnId).value = unit;
      unitOf(yarnId).dispatchEvent(new Event("change", { bubbles: true }));
    };
    say("y1", "35", "left");
    say("y3", "0", "left");
    (finish()!.querySelector('[data-act="finish"]') as HTMLElement).click();
    await waitFor(() => !finish() && store.projects.find((p) => p.id === made.id)?.status === "finished", "the project to finish");
    check(results, "its needles are free again", !activeOn("t3") && !activeOn("t2"));
    check(results, "…but still listed on it, as what it used", store.projectTools.filter((l) => l.projectId === made.id).length === 2);
    const l2 = store.yarns.find((y) => y.id === "y1")!.lots.find((l) => l.id === "l2")!;
    check(results, "the leftover becomes what the lot holds, tagged", l2.gramsLeft === 35 && l2.leftover === true, JSON.stringify(l2));
    const l4 = store.yarns.find((y) => y.id === "y3")!.lots[0];
    check(results, "0 g is used up, not a leftover", l4.gramsLeft === 0 && !l4.leftover, JSON.stringify(l4));
    check(results, "the other lot is untouched", store.yarns.find((y) => y.id === "y1")!.lots.find((l) => l.id === "l1")!.gramsLeft === 300);
    await waitFor(() => store.patterns.find((p) => p.id === "p3")?.status === "finished", "the pattern to be marked");
    check(results, "the pattern is marked Finished", true);

    tab("stash");
    await waitFor(() => !!yarnCard("y1"), "the stash again");
    check(results, "the stash tags the leftover", !!yarnCard("y1")!.querySelector(".yarn-leftover") && !yarnCard("y1")!.querySelector(".card-use"));
    useBox("leftover").checked = true;
    useBox("leftover").dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "Leftover shows only leftovers", [...document.querySelectorAll<HTMLElement>(".stash .card")].map((c) => c.dataset.open).join(",") === "y1");
    (document.querySelector('.stash [data-act="clear"]') as HTMLElement).click();

    // A finished project is a record.
    tab("projects");
    await waitFor(() => cards().length > 0, "the projects once more");
    const done = cards().find((c) => c.dataset.open === made.id)!;
    check(results, "the card says Finished", !!done.querySelector(".project-finished"));
    done.click();
    await waitFor(() => !!page()?.querySelector(".project-side .tool-list"), "the finished project's page");
    check(results, "a finished project shows what was left", /35 g left/.test(side().textContent ?? "") && /used up/.test(side().textContent ?? ""));
    check(results, "…and offers no Finish, but a finished date", !side().querySelector('[data-act="finish"]') && !side().querySelector('[data-act="edit-links"]') && !!side().querySelector('[data-f="finished"]'));
    tab("projects");
    await waitFor(() => cards().length > 0, "the projects after the record");

    // A lot never weighed: its balls by the ball band are what it held.
    const alpaca = await invoke<{ id: string; lots: { id: string }[] }>("add_yarn", {
      input: { name: "Brushed Alpaca", brand: "Drops", colourway: "24 Rust", yarnWeight: "Aran", metresPerBall: 140, gramsPerBall: 25, notes: "", fibres: [], superwash: false, plans: [], lots: [{ balls: 2, gramsLeft: 0 }] },
    });
    const hat = await invoke<{ id: string }>("add_project", {
      input: { name: "Striped hat", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [{ id: null, yarnId: alpaca.id, lotId: alpaca.lots[0].id, plannedGrams: 20 }] },
    });
    tab("stash");
    await waitFor(() => !!yarnCard(alpaca.id), "the stash with the alpaca");
    tab("projects");
    await waitFor(() => cards().some((c) => c.dataset.open === hat.id), "the hat's card");
    cards().find((c) => c.dataset.open === hat.id)!.click();
    await waitFor(() => !!page()?.querySelector('.project-side [data-act="finish"]'), "the hat's page");
    (side().querySelector('[data-act="finish"]') as HTMLElement).click();
    await waitFor(() => !!finish(), "the hat's finish dialog");
    const hatText = () => finish()!.textContent ?? "";
    const hatAmount = finish()!.querySelector<HTMLInputElement>("input[data-entry]")!;
    const hatUnit = finish()!.querySelector<HTMLSelectElement>("select[data-unit]")!;
    check(results, "a lot never weighed held its balls by the ball band, not 0 g", /50 g before \(2 whole balls\)/.test(hatText()) && !/\b0 g before/.test(hatText()), hatText());
    check(results, "…filled in with the 20 g it was to take, saying what that leaves", hatAmount.value === "20" && hatUnit.value === "used-g" && /→ 30 g left/.test(hatText()) && /Filled in from what the project was to take/.test(hatText()), `${hatAmount.value} ${hatUnit.value} ${hatText()}`);
    hatAmount.value = "1";
    hatUnit.value = "used-balls";
    hatUnit.dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "1 ball used is one ball's weight: one of the two left", /→ 25 g left/.test(hatText()), hatText());
    hatAmount.value = "60";
    hatUnit.value = "used-g";
    hatAmount.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "…and more than there was is used up", /→ used up/.test(hatText()), hatText());
    hatAmount.value = "1";
    hatUnit.value = "used-balls";
    hatUnit.dispatchEvent(new Event("change", { bubbles: true }));
    (finish()!.querySelector('[data-act="finish"]') as HTMLElement).click();
    await waitFor(() => !finish() && store.projects.find((p) => p.id === hat.id)?.status === "finished", "the hat to finish");
    const alpacaLot = store.yarns.find((y) => y.id === alpaca.id)!.lots[0];
    check(results, "a ball used takes its weight off the stash", alpacaLot.gramsLeft === 25 && alpacaLot.leftover === true, JSON.stringify(alpacaLot));
    const took = store.yarnUsage.filter((u) => u.yarnId === alpaca.id);
    check(results, "…and records the 25 g used", took.length === 1 && took[0].grams === 25 && took[0].projectName === "Striped hat", JSON.stringify(took));
    tab("stash");
    await waitFor(() => !!yarnCard(alpaca.id), "the stash after the hat");
    const alpacaQty = yarnCard(alpaca.id)!.querySelector(".card-qty")?.textContent ?? "";
    check(results, "the stash shows what there is now, not what was bought: one ball", alpacaQty === "1 × 25 g · ~140 m" && !!yarnCard(alpaca.id)!.querySelector(".yarn-leftover"), alpacaQty);
    // Gone again, so the suites after this one find the stash as it was.
    await invoke("delete_project", { id: hat.id });
    await invoke("delete_yarn", { id: alpaca.id });
    store.yarnUsage = store.yarnUsage.filter((u) => u.yarnId !== alpaca.id);
    tab("projects");
    await waitFor(() => cards().length > 0, "the projects after the hat");

    // The reader's project pane.
    (cards().find((c) => c.dataset.open === "pr1")!.querySelector('[data-act="open-pattern"]') as HTMLElement).click();
    const pane = () => document.querySelector<HTMLElement>("[data-project-panel]");
    await waitFor(() => !!pane()?.querySelector(".project-panel-item, [data-act='project-start']"), "the reader's project pane", 15000);
    check(results, "the reader shows the pattern's project and its needles", /Featherweight Lace Sock/.test(pane()!.textContent ?? "") && /2\.5 mm double-pointed/.test(pane()!.textContent ?? ""));
    (pane()!.querySelector('[data-act="project-open"]') as HTMLElement).click();
    await waitFor(() => !!form()?.querySelector('[data-el="tools"] .tool-add'), "the project from the reader");
    change(form()!.querySelector<HTMLSelectElement>('[data-el="tools"] [data-el="tool-add"]')!, "t3");
    (form()!.querySelector('[data-el="tools"] [data-act="tool-use"]') as HTMLElement).click();
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => /4 mm circular needle, 40 cm/.test(pane()?.textContent ?? ""), "the pane to show the new needle");
    check(results, "a needle chosen from the reader shows in its pane", activeOn("t3") === "pr1");
    check(results, "…without leaving the pattern", !!document.querySelector(".reader .doc-scroller"));

    // A pattern with no active project offers to start one.
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library [data-open]"), "the library");
    [...document.querySelectorAll<HTMLElement>(".library [data-open]")].find((c) => (c.textContent ?? "").includes(p3))!.click();
    await waitFor(() => !!pane()?.querySelector('[data-act="project-start"]'), "the start button", 15000);
    check(results, "a finished one is counted", /Finished once before/.test(pane()!.textContent ?? ""));
    (pane()!.querySelector('[data-act="project-start"]') as HTMLElement).click();
    await waitFor(() => !!form(), "the form from the reader");
    check(results, "starting from the reader sets its pattern", f("pattern")!.value === "p3");
    (form()!.querySelector('[data-act="cancel"]') as HTMLElement).click();
    await waitFor(() => !form(), "the form to close");

    // Removing a project frees what is on it.
    tab("projects");
    await waitFor(() => cards().length > 0, "the projects for removal");
    cards().find((c) => c.dataset.open === "pr1")!.click();
    await waitFor(() => !!page()?.querySelector('.project-side [data-act="remove"]'), "the project to remove");
    (side().querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm");
    check(results, "removing asks, and says the needles go back to free", /go back to free/.test(document.querySelector(".dialog-card .dialog-message")?.textContent ?? ""));
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => !store.projects.some((p) => p.id === "pr1"), "the removal");
    check(results, "its needles are free", !activeOn("t1") && !activeOn("t3"));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>('.modal-backdrop:not(.hidden) [data-act="cancel"]')?.click();
    tab("patterns");
    await waitFor(() => !!document.querySelector(".library:not(.stash):not(.tools):not(.projects)"), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__projectChecks = verifyProjects;
