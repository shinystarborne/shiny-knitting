/**
 * Checks for the Masterclasses tab and a project knitted along with one,
 * clicked through: a YouTube link kept as its video (its picture, played
 * here, or in the browser or a window), another site's kept as it is,
 * searched, renamed and noted; a course in several videos (one added, the
 * ones there bundled, ticked as watched, put in order, one taken out); a
 * project started from one, or chosen on a project's page and put on its
 * board to watch, as a card of its own (or from the board's Video); the
 * pattern it goes with, a project started from either having both; removed,
 * the project going on without it.
 *
 * Run with the harness open:
 *   window.__masterclassChecks()
 */
import type { Masterclass, Project } from "../src/api";

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

export async function verifyMasterclasses() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { masterclasses: (Masterclass & { parts: { id: string; videoId: string; url: string; watched: boolean }[] })[]; projects: Project[] }; __opened?: string[]; __sheetWindows?: { url: string }[] };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".masterclasses");
  const items = () => [...document.querySelectorAll<HTMLElement>(".masterclasses [data-class]")];
  const act = (name: string) => view()!.querySelector<HTMLElement>(`[data-act="${name}"]`);
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const answer = async (values: string[]) => {
    await waitFor(() => !!dialog(), "the dialog");
    const inputs = [...dialog()!.querySelectorAll<HTMLInputElement>("input.dialog-input")];
    values.forEach((v, i) => {
      if (inputs[i]) inputs[i].value = v;
    });
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => !dialog(), "the dialog to close");
  };
  const before = JSON.stringify(store.masterclasses);
  let projectId = "";
  /** What the tab remembers: the one open, and which video of each was watched where. */
  const forget = () => {
    try {
      for (const key of Object.keys(localStorage)) if (key === "masterclasses:open" || key.startsWith("masterclass-part:")) localStorage.removeItem(key);
    } catch {
      // Nothing remembered.
    }
  };
  forget();
  store.masterclasses = [];

  try {
    tab("masterclasses");
    await waitFor(() => !!view()?.querySelector(".empty"), "the Masterclasses tab");
    check(results, "a tab of its own, beside Cheatsheets, saying what it is for while empty", /No masterclasses yet/.test(view()!.textContent ?? "") && document.querySelector('.tab-bar [data-tab="cheatsheets"] + [data-tab="masterclasses"]') !== null);

    // A YouTube video.
    act("add")!.click();
    await answer(["youtu.be/dQw4w9WgXcQ?si=shared", ""]);
    await waitFor(() => items().length === 1 && !!view()!.querySelector("iframe.mc-player"), "the video kept");
    const kept = store.masterclasses[0];
    check(results, "a YouTube link is kept as its video, its address made whole", kept.parts.length === 1 && kept.parts[0].videoId === "dQw4w9WgXcQ" && kept.parts[0].url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", JSON.stringify(kept));
    check(results, "…named and listed with its channel", /A video, dQw4w9WgXcQ/.test(items()[0].textContent ?? "") && /A channel/.test(items()[0].textContent ?? ""));
    await waitFor(() => !!items()[0].querySelector<HTMLElement>(".mc-thumb")!.style.backgroundImage, "its picture");
    check(results, "…with its picture", true);
    const frame = view()!.querySelector<HTMLIFrameElement>("iframe.mc-player")!;
    check(results, "…played here, YouTube's player in a sandboxed frame", frame.getAttribute("src") === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" && (frame.getAttribute("sandbox") ?? "").includes("allow-scripts") && !(frame.getAttribute("sandbox") ?? "").includes("allow-top-navigation"), frame.getAttribute("src") ?? "");
    act("browser")!.click();
    await wait(100);
    check(results, "…or in the browser", (w.__opened ?? []).at(-1) === "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    act("window")!.click();
    await waitFor(() => (w.__sheetWindows ?? []).some((x) => x.url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "the window");
    check(results, "…or in a window of its own", true);

    // Another site, named.
    act("add")!.click();
    await answer(["https://vimeo.com/76979871", "Steeking, step by step"]);
    await waitFor(() => items().length === 2, "the second");
    check(results, "another site's video is kept as it is, named as given, at the top, opened in the browser", /Steeking, step by step/.test(items()[0].textContent ?? "") && !view()!.querySelector("iframe") && /Played where it is kept/.test(view()!.textContent ?? ""));

    // A main page of cards; one opened on a page of its own, and back.
    check(results, "one added opens on its page, the cards hidden, the way back to them", view()!.classList.contains("sheet-open") && !!act("back"));
    act("back")!.click();
    await waitFor(() => !view()!.classList.contains("sheet-open"), "the cards");
    check(results, "← Masterclasses: a card for each, with its picture", items().length === 2 && !view()!.querySelector("iframe") && !!items()[1].querySelector<HTMLElement>(".mc-thumb")!.style.backgroundImage);

    // Searched, renamed, noted.
    const search = view()!.querySelector<HTMLInputElement>('[data-f="search"]')!;
    search.value = "steek";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    check(results, "the search finds by title", items().length === 1 && /Steeking/.test(items()[0].textContent ?? ""));
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    items()[1].click();
    await waitFor(() => !!view()!.querySelector("iframe.mc-player"), "the YouTube one again");
    const title = view()!.querySelector<HTMLInputElement>('[data-f="title"]')!;
    title.value = "Italian cast-on";
    title.dispatchEvent(new Event("change", { bubbles: true }));
    const notes = view()!.querySelector<HTMLTextAreaElement>('[data-f="notes"]')!;
    notes.value = "The good bit starts at 3:10.";
    notes.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.masterclasses.some((m) => m.title === "Italian cast-on" && m.notes === "The good bit starts at 3:10."), "renamed and noted");
    await waitFor(() => items().some((i) => /Italian cast-on/.test(i.textContent ?? "")), "the list renamed");
    check(results, "renamed and noted where it shows, the list too", true);

    // The pattern got after the video was kept: chosen on it afterwards, at the top, and shown.
    const later = (store as unknown as { patterns: { id: string; title: string }[] }).patterns[1];
    const field = view()!.querySelector<HTMLElement>(".mc-body > .mc-pattern");
    check(results, "a masterclass has its Pattern at the top, to choose or change any time", !!field && field === view()!.querySelector(".mc-body")!.firstElementChild);
    const pickBox = field!.querySelector<HTMLInputElement>(".pattern-pick-input")!;
    pickBox.focus();
    pickBox.value = later.title.split(" ")[0];
    pickBox.dispatchEvent(new Event("input", { bubbles: true }));
    [...field!.querySelectorAll<HTMLElement>(".pattern-pick-item")].find((li) => li.textContent?.includes(later.title))!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await waitFor(() => store.masterclasses.some((m) => (m as unknown as { patternId: string }).patternId === later.id) && !!view()!.querySelector('[data-act="open-pattern"]'), "the pattern chosen afterwards");
    check(results, "…chosen, it is kept, and shown in the list with the masterclass", items().some((i) => i.textContent?.includes(`📄 ${later.title}`)));
    const clear = view()!.querySelector<HTMLInputElement>(".mc-pattern [data-f=\"pattern\"]")!;
    clear.value = "";
    clear.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => !store.masterclasses.some((m) => (m as unknown as { patternId: string }).patternId === later.id) && !view()!.querySelector('[data-act="open-pattern"]'), "the pattern taken off");
    check(results, "…and taken off again", true);

    // A course in several videos: one added to it.
    act("add-part")!.click();
    await answer(["https://www.youtube.com/watch?v=aaaaaaaaaaa", "Part two: the rib"]);
    await waitFor(() => view()!.querySelectorAll(".mc-part").length === 2, "the second video");
    const italian = () => store.masterclasses.find((m) => m.title === "Italian cast-on")!;
    check(results, "+ Add a video to it puts another video after the first, named as given", italian().parts.length === 2 && /Part two: the rib/.test(view()!.querySelectorAll(".mc-part")[1].textContent + (view()!.querySelectorAll<HTMLInputElement>(".mc-part-title")[1].value ?? "")) && /2 videos/.test(items().find((i) => /Italian/.test(i.textContent ?? ""))!.textContent ?? ""));
    // Watched, and played.
    const watched = view()!.querySelectorAll<HTMLInputElement>('.mc-part [data-f="watched"]')[0];
    watched.checked = true;
    watched.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => italian().parts[0].watched && /1 watched/.test(items().find((i) => /Italian/.test(i.textContent ?? ""))!.textContent ?? ""), "ticked");
    check(results, "a video ticked as watched is kept so, the list saying how many", true);
    view()!.querySelectorAll<HTMLElement>('.mc-part [data-act="play"]')[1].click();
    await waitFor(() => view()!.querySelector("iframe.mc-player")!.getAttribute("src")!.includes("aaaaaaaaaaa"), "the second playing");
    check(results, "▶ on a video plays it, saying which of how many", /2 of 2:/.test(view()!.querySelector(".mc-now")!.textContent ?? ""));
    // Put in order.
    view()!.querySelectorAll<HTMLElement>('.mc-part [data-act="part-up"]')[1].click();
    await waitFor(() => italian().parts[0].videoId === "aaaaaaaaaaa" && view()!.querySelectorAll<HTMLInputElement>(".mc-part-title")[0]?.value === "Part two: the rib", "moved up");
    check(results, "↑ puts a video earlier", true);

    // Bundled: the steeking video comes into it.
    act("bundle")!.click();
    await waitFor(() => !!dialog()?.querySelector("[data-bundle]"), "the bundle dialog");
    check(results, "Bundle with… offers the others, and waits for one to be ticked", dialog()!.querySelectorAll("[data-bundle]").length === 1 && dialog()!.querySelector<HTMLButtonElement>('[data-act="make"]')!.disabled);
    const box = dialog()!.querySelector<HTMLInputElement>("[data-bundle]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    dialog()!.querySelector<HTMLInputElement>('[data-f="bundle-name"]')!.value = "The cast-on course";
    dialog()!.querySelector<HTMLElement>('[data-act="make"]')!.click();
    await waitFor(() => !dialog() && items().length === 1, "bundled");
    const course = store.masterclasses[0];
    check(results, "…bundled, one masterclass of their videos in order, named as given", store.masterclasses.length === 1 && course.title === "The cast-on course" && course.parts.length === 3 && /3 videos/.test(items()[0].textContent ?? ""), JSON.stringify(course.parts.map((p) => p.url)));
    // One taken out again, to be its own.
    const steek = [...view()!.querySelectorAll<HTMLElement>(".mc-part")].findIndex((li) => /Steeking/.test(li.querySelector<HTMLInputElement>(".mc-part-title")!.value));
    view()!.querySelectorAll<HTMLElement>('.mc-part [data-act="part-split"]')[steek].click();
    await waitFor(() => items().length === 2, "taken out");
    check(results, "Its own takes a video out, to be a masterclass of its own, the course still open", store.masterclasses.find((m) => m.title === "The cast-on course")!.parts.length === 2 && items().some((i) => /Steeking/.test(i.textContent ?? "")) && view()!.querySelectorAll(".mc-part").length === 2);
    items().find((i) => /The cast-on course/.test(i.textContent ?? ""))!.click();
    await waitFor(() => /The cast-on course/.test(view()!.querySelector<HTMLInputElement>('[data-f="title"]')!.value), "the course again");

    // A project started from it.
    act("start")!.click();
    await waitFor(() => !!document.querySelector(".modal.project-form"), "the new project's form");
    const name = document.querySelector<HTMLInputElement>('.modal.project-form [data-f="name"]')!;
    check(results, "Start a project… opens a new project, named after the masterclass", name.value === "The cast-on course", name.value);
    name.value = "Cast-on swatches";
    document.querySelector<HTMLElement>('.modal.project-form [data-act="save"]')!.click();
    await waitFor(() => !!page() && store.projects.some((p) => p.name === "Cast-on swatches"), "the project's page");
    const started = store.projects.find((p) => p.name === "Cast-on swatches")!;
    check(results, "…saved, knitted along with it, its page opened", started.masterclassId === kept.id && !!page()!.querySelector('[data-act="mc-board"]'));
    const partPick = page()!.querySelector<HTMLSelectElement>('[data-f="mc-part"]');
    check(results, "…its videos to choose from there, the first not watched first", !!partPick && partPick.options.length === 2 && partPick.selectedIndex === 0 && /Part two/.test(partPick.options[0].textContent ?? ""), [...(partPick?.options ?? [])].map((o) => o.textContent).join(" | "));
    partPick!.value = partPick!.options[1].value;
    partPick!.dispatchEvent(new Event("change", { bubbles: true }));
    page()!.querySelector<HTMLElement>('[data-act="mc-board"]')!.click();
    await waitFor(() => !!page()!.querySelector(".board-item.kind-video iframe.board-video"), "the chosen video on the board");
    check(results, "…the one chosen put on the board to play", page()!.querySelector(".board-item.kind-video iframe.board-video")!.getAttribute("src")!.includes("dQw4w9WgXcQ"));
    await invoke("delete_project", { id: started.id });
    tab("masterclasses");
    await waitFor(() => items().length === 2, "the tab again");
    items().find((i) => /The cast-on course/.test(i.textContent ?? ""))!.click();

    // The pattern a video goes with: chosen as it is added, and a project
    // started from either the video or the pattern has both.
    const pattern = (store as unknown as { patterns: { id: string; title: string }[] }).patterns[0];
    act("add")!.click();
    await waitFor(() => !!dialog()?.querySelector('[data-el="pattern"] .pattern-pick-input'), "the add dialog's pattern");
    check(results, "adding a video asks, besides its link and name, the pattern it goes with, if any", /optional: the one it goes with/.test(dialog()!.textContent ?? ""));
    dialog()!.querySelector<HTMLInputElement>('[data-f="link"]')!.value = "https://youtu.be/ccccccccccc";
    dialog()!.querySelector<HTMLInputElement>('[data-f="name"]')!.value = "Riddari yoke, step by step";
    // Picked as a hand picks it: pressed on the pattern in the list, which
    // closes under the pointer, so the release -- and so the click -- lands
    // on the backdrop behind. The dialog stays, with the pattern chosen.
    const patternBox = dialog()!.querySelector<HTMLInputElement>('[data-el="pattern"] .pattern-pick-input')!;
    patternBox.focus();
    patternBox.value = pattern.title.split(" ")[0];
    patternBox.dispatchEvent(new Event("input", { bubbles: true }));
    const option = [...dialog()!.querySelectorAll<HTMLElement>(".pattern-pick-item")].find((li) => li.textContent?.includes(pattern.title))!;
    const overlay = dialog()!.parentElement!;
    option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await wait(100);
    check(results, "picking a pattern from the list, let go on the backdrop, does not close the dialog", !!dialog() && dialog()!.querySelector<HTMLInputElement>('[data-el="pattern"] [data-f="pattern"]')!.value === pattern.id && patternBox.value === pattern.title, `${!!dialog()} ${patternBox.value}`);
    dialog()!.querySelector<HTMLElement>('[data-act="keep"]')!.click();
    await waitFor(() => store.masterclasses.some((m) => m.title === "Riddari yoke, step by step") && !!view()!.querySelector('[data-act="open-pattern"]'), "kept with its pattern");
    const withPattern = store.masterclasses.find((m) => m.title === "Riddari yoke, step by step")!;
    check(results, "…kept with it, the pattern shown on it with Open ↗", (withPattern as unknown as { patternId: string }).patternId === pattern.id && view()!.querySelector<HTMLInputElement>(".mc-pattern .pattern-pick-input")!.value === pattern.title);
    act("add")!.click();
    await waitFor(() => !!dialog(), "the add dialog again");
    const backdrop = dialog()!.parentElement!;
    backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await waitFor(() => !dialog(), "the dialog closed by its backdrop");
    check(results, "…while a click on the backdrop itself still closes it", true);
    act("start")!.click();
    await waitFor(() => !!document.querySelector(".modal.project-form"), "the form");
    document.querySelector<HTMLElement>('.modal.project-form [data-act="save"]')!.click();
    await waitFor(() => store.projects.some((p) => p.name === "Riddari yoke, step by step" && !!p.masterclassId), "the project");
    const fromVideo = store.projects.find((p) => p.name === "Riddari yoke, step by step")!;
    check(results, "a project started from the video has the video and its pattern", fromVideo.masterclassId === withPattern.id && fromVideo.patternId === pattern.id, JSON.stringify({ m: fromVideo.masterclassId, p: fromVideo.patternId }));
    await invoke("delete_project", { id: fromVideo.id });
    (page() ?? view() ?? document.querySelector<HTMLElement>(".projects"))!.dispatchEvent(new CustomEvent("add-project", { bubbles: true, detail: { patternId: pattern.id, name: "From the pattern" } }));
    await waitFor(() => !!document.querySelector(".modal.project-form"), "the form, from the pattern");
    document.querySelector<HTMLElement>('.modal.project-form [data-act="save"]')!.click();
    await waitFor(() => store.projects.some((p) => p.name === "From the pattern" && !!p.masterclassId), "the project from the pattern");
    const fromPattern = store.projects.find((p) => p.name === "From the pattern")!;
    check(results, "a project started from the pattern has the video that goes with it too", fromPattern.patternId === pattern.id && fromPattern.masterclassId === withPattern.id, JSON.stringify({ m: fromPattern.masterclassId }));
    await invoke("delete_project", { id: fromPattern.id });
    await invoke("delete_masterclass", { id: withPattern.id });
    tab("masterclasses");
    await waitFor(() => items().length === 2, "the tab again");
    items().find((i) => /The cast-on course/.test(i.textContent ?? ""))!.click();

    // A project knitted along with it.
    const project = await invoke<Project>("add_project", { input: { name: "Cast-on practice", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    view()!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!page()?.querySelector('[data-f="masterclass"]'), "the project's page");
    const select = page()!.querySelector<HTMLSelectElement>('[data-f="masterclass"]')!;
    check(results, "a project's page offers the masterclasses", [...select.options].some((o) => /The cast-on course \(A channel\)/.test(o.textContent ?? "")));
    select.value = kept.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.projects.find((p) => p.id === projectId)?.masterclassId === kept.id && !!page()!.querySelector('[data-act="mc-board"]'), "chosen");
    check(results, "…chosen, it is kept on the project, with Put it on the board and Open it ↗, and no tiny player", !!page()!.querySelector('[data-act="mc-open"]') && !page()!.querySelector(".project-masterclass iframe"));
    const cards = () => [...page()!.querySelectorAll<HTMLElement>(".board-item.kind-video")];
    page()!.querySelector<HTMLElement>('[data-act="mc-board"]')!.click();
    await waitFor(() => cards().length === 1, "the video on the board");
    const card = cards()[0];
    check(results, "Put it on the board plays the first not watched there, in a card of its own, moved by its bar", card.querySelector("iframe.board-video")!.getAttribute("src")!.includes("aaaaaaaaaaa") && /Part two: the rib/.test(card.querySelector(".board-video-bar")!.textContent ?? "") && card.offsetWidth >= 400);
    page()!.querySelector<HTMLElement>('[data-act="mc-board"]')!.click();
    await wait(200);
    check(results, "…put on it again, the one there is picked, not a second put down", cards().length === 1 && cards()[0].classList.contains("selected"));
    card.querySelector<HTMLElement>('.board-video-bar [data-act="open"]')!.click();
    await wait(100);
    check(results, "…its ↗ opens it in the browser", (w.__opened ?? []).at(-1) === "https://www.youtube.com/watch?v=aaaaaaaaaaa");
    // The board's own Video: any masterclass's, the project's first.
    page()!.querySelector<HTMLElement>('.board-tools [data-add="video"]')!.click();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "which video");
    const groups = [...dialog()!.querySelectorAll("optgroup")].map((g) => g.label);
    check(results, "the board's Video offers the masterclasses' videos, the project's own first", groups[0] === "This project's: The cast-on course" && groups.length === 2, groups.join(" | "));
    const pick = dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!;
    pick.value = [...pick.options].find((o) => /dQw4w9WgXcQ/.test(o.textContent ?? ""))!.value;
    dialog()!.querySelector<HTMLElement>("button.primary")!.click();
    await waitFor(() => cards().length === 2, "a second video");
    check(results, "…the one chosen put on the board", cards().some((c) => c.querySelector("iframe")!.getAttribute("src")!.includes("dQw4w9WgXcQ")));
    page()!.querySelector<HTMLElement>('[data-act="mc-open"]')!.click();
    await wait(100);
    check(results, "Open it ↗ opens it in the browser", (w.__opened ?? []).at(-1) === kept.parts[0].url);

    // Back in the tab: the project with it, and removed.
    tab("masterclasses");
    await waitFor(() => items().length === 2, "the tab again");
    items().find((i) => /The cast-on course/.test(i.textContent ?? ""))!.click();
    await waitFor(() => !!view()!.querySelector("[data-project]"), "its project");
    check(results, "the masterclass lists the projects knitted along with it, and counts them", /Cast-on practice/.test(view()!.querySelector("[data-project]")!.textContent ?? "") && /1 project/.test(items().find((i) => /The cast-on course/.test(i.textContent ?? ""))!.textContent ?? ""));
    act("remove")!.click();
    await waitFor(() => !!dialog(), "the question");
    check(results, "removing it says its videos go, and the project keeps going", /All its 2 videos go with it\. The project knitted along with it keeps going without it/.test(dialog()!.textContent ?? ""), dialog()!.textContent ?? "");
    dialog()!.querySelector<HTMLElement>("button.danger, button.primary")!.click();
    await waitFor(() => items().length === 1, "one fewer");
    check(results, "…and it goes; the project has none", store.projects.find((p) => p.id === projectId)?.masterclassId === "");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    store.masterclasses = JSON.parse(before);
    forget();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__masterclassChecks = verifyMasterclasses;
