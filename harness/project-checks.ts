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
}

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
    change(f("pattern")!, "p3");
    check(results, "choosing a pattern offers its title as the name", f("name")!.placeholder.startsWith(p3), f("name")!.placeholder);
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
    check(results, "the chosen yarn shows its lot", /Shetland Sock · Peat — lot L57 \(200 g\)/.test(chosenYarn) && /Handspun/.test(chosenYarn), chosenYarn);
    f("name")!.value = "Long socks for Mum";
    const n = store.projects.length;
    (form()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => !form() && store.projects.length === n + 1, "the project to start");
    const made = store.projects[store.projects.length - 1];
    check(results, "the project is saved with its pattern", made.name === "Long socks for Mum" && made.patternId === "p3" && made.status === "active");
    check(results, "its needles are in use on it", activeOn("t3") === made.id && activeOn("t2") === made.id);
    check(results, "the one taken from another project left it", !store.projectTools.some((l) => l.projectId === "pr2" && l.toolId === "t2"));
    check(results, "its yarn is on it, from the lot chosen", store.projectYarns.filter((e) => e.projectId === made.id).map((e) => `${e.yarnId}:${e.lotId}`).join(" ") === "y1:l2 y3:l4");
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
    check(results, "…and asks what is left of each yarn", grams.length === 2);
    check(results, "…offering to mark the pattern Finished", !!finish()!.querySelector<HTMLInputElement>('[data-f="mark-pattern"]')?.checked);
    const entryFor = (yarnId: string) => store.projectYarns.find((e) => e.projectId === made.id && e.yarnId === yarnId)!.id;
    finish()!.querySelector<HTMLInputElement>(`input[data-entry="${entryFor("y1")}"]`)!.value = "35";
    finish()!.querySelector<HTMLInputElement>(`input[data-entry="${entryFor("y3")}"]`)!.value = "0";
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
