/**
 * Checks for a project's card, to post: its words as chosen (the pattern and
 * designer, dates, the yarn and how much, needles, size, who for, knitting
 * time, the yarn's cost and the total, lines from the log), where photos go, what does not fit left out from the end; and
 * the screen, clicked through from the project's page and the gallery: the
 * shape, the colours, the photos, the size saved to the project, copied and
 * saved as a PNG.
 *
 * Run with the harness open:
 *   window.__projectCardChecks()
 */
import type { Project } from "../src/api";
import { cardText, fitBlocks, photoRects, type CardData, type CardOptions } from "../src/views/project-card";

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

/** A picture of one colour, as bytes. */
async function picture(colour: string, w = 300, h = 200): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/** A pixel of a canvas, as #rrggbb. */
function pixel(canvas: HTMLCanvasElement, x: number, y: number): string {
  const [r, g, b] = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const near = (a: string, b: string) => {
  const n = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return n(a).every((v, i) => Math.abs(v - n(b)[i]) <= 6);
};

function pure(results: CheckResult[]): void {
  const day = 86400000;
  const project = {
    id: "pc", name: "Lopi for Anna", patternId: "pt", patternTitle: "Riddari", status: "finished", startedAt: Date.UTC(2026, 2, 3), finishedAt: Date.UTC(2026, 9, 12),
    notes: "", createdAt: 0, coverPath: "", personId: "pe", personName: "Anna", toolIds: ["t1", "t9"],
    yarns: [{ id: "e1", yarnId: "y1", yarnName: "Léttlopi", lotId: null, dyeLot: "", leftoverGrams: 40, plannedGrams: null }],
    planWhen: "", planDate: null, planOrder: 0, galleryHidden: false, gallerySkip: [], size: "M", masterclassId: "", masterclassTitle: "", toolTips: {},
  } as Project;
  const d: CardData = {
    project,
    pattern: { id: "pt", title: "Riddari", designer: "Védís Jónsdóttir", price: 6 } as CardData["pattern"],
    log: [{ id: "lg1", projectId: "pc", at: day, text: "Blocked it over a chair, and it grew 4 cm.", milestone: false, photoPath: "" } as CardData["log"][number]],
    tools: [{ id: "t1", kind: "circular", sizeMm: 4.5, cableCm: 80, brand: "ChiaoGoo" } as CardData["tools"][number]],
    yarns: [{ id: "y1", colourway: "Lava", gramsPerBall: 50, details: { price: 4.5 } } as CardData["yarns"][number]],
    usage: [
      { id: "u1", yarnId: "y1", yarnName: "Léttlopi", projectId: "pc", projectName: "", at: 0, grams: 410, metres: 820, source: "finished" },
      { id: "u2", yarnId: "y1", yarnName: "Léttlopi", projectId: "other", projectName: "", at: 0, grams: 999, metres: 0, source: "finished" },
    ],
    sessions: [
      { id: "s1", projectId: "pc", startedAt: 0, endedAt: 12 * 3600000, pausedMs: 0 },
      { id: "s2", projectId: "pc", startedAt: day, endedAt: day + 35 * 60000 },
      { id: "s3", projectId: "other", startedAt: day, endedAt: day + 9 * 3600000 },
    ],
    currency: "EUR",
    hourRate: 20,
  };
  const all: CardOptions = { shape: "portrait", theme: "cream", photos: [], show: ["pattern", "dates", "yarn", "needles", "size", "person", "time", "yarnCost", "patternCost", "totalCost", "costWithTime"], log: ["lg1"] };
  const text = cardText(d, all);
  const said = JSON.stringify(text);
  check(results, "a card says the name first, then the pattern by its designer", text[0].kind === "title" && (text[0] as { text: string }).text === "Lopi for Anna" && (text[1] as { text: string }).text === "Riddari by Védís Jónsdóttir", said);
  check(results, "…when, started and finished", /Started 3 March 2026 · Finished 12 October 2026/.test(said), said);
  check(results, "…the yarn with its colourway and what this project used, grams and metres", /Léttlopi, Lava — 410 g \(820 m\)/.test(said) && !/999/.test(said), said);
  check(results, "…the needles, the size, who for, and a line from the log", /"Needles","lines":\["4\.5 mm/.test(said) && /"Size","lines":\["M"\]/.test(said) && /"For","lines":\["Anna"\]/.test(said) && /Blocked it over a chair/.test(said), said);
  check(results, "…its knitting time, this project's alone", /"Time","lines":\["12 h 35 min"\]/.test(said), said);
  // 410 g at 4.50 a 50 g ball is 36.90; with the pattern's 6, 42.90.
  check(results, "…what its yarn and pattern cost and the total on one line, the cost with time under it", /"Cost","lines":\["Yarn [^"]*36[.,]90[^"]* · Pattern [^"]*6[.,]00[^"]* · Total [^"]*42[.,]90[^"]*","With time [^"]*294[.,]57[^"]*"\]/.test(said), said);
  // 12 h 35 min at 20 an hour is 251.67; with the 42.90, 294.57.
  const costOf = (show: CardOptions["show"], data = d) => (cardText(data, { ...all, show, log: [] }).find((b) => b.kind === "fact" && b.label === "Cost") as { lines: string[] } | undefined)?.lines ?? [];
  const alone = costOf(["patternCost"]);
  check(results, "each cost is its own choice: the pattern's alone", alone.length === 1 && /^Pattern [^·]*6[.,]00[^·]*$/.test(alone[0]), JSON.stringify(alone));
  const timed = costOf(["costWithTime"]);
  check(results, "…the cost with time alone", timed.length === 1 && /^With time .*294[.,]57/.test(timed[0]), JSON.stringify(timed));
  check(results, "…and none chosen, no cost at all", costOf(["time", "yarn"]).length === 0);
  check(results, "with no hour cost, no cost with time", costOf(["costWithTime", "totalCost"], { ...d, hourRate: null }).join() .includes("With time") === false && costOf(["totalCost"], { ...d, hourRate: null }).length === 1);
  const order = text.map((b) => (b.kind === "fact" ? b.label : b.kind));
  check(results, "…the time and cost straight after the dates, before the yarn", order.join() === "title,sub,dates,Time,Cost,Yarn,Needles,Size,For,quote", order.join());
  const named = cardText({ ...d, pattern: { ...d.pattern!, title: "Nocturnal by saskieco", designer: "Saskieco" } }, all);
  check(results, "a title that names its designer is not followed by them again", (named[1] as { text: string }).text === "Nocturnal by saskieco", JSON.stringify(named[1]));
  const same = cardText({ ...d, project: { ...project, name: "nocturnal by saskieco" }, pattern: { ...d.pattern!, title: "Nocturnal by saskieco", designer: "saskieco" } }, all);
  check(results, "…and a project named as its pattern does not say it twice", same[1].kind === "dates", JSON.stringify(same.slice(0, 2)));
  const unpriced = JSON.stringify(cardText({ ...d, yarns: [{ id: "y1", colourway: "Lava" } as CardData["yarns"][number]], pattern: { ...d.pattern!, price: null }, sessions: [] }, all));
  check(results, "with no prices and no time, no cost and no time on it", !/"Cost"|"Time"/.test(unpriced), unpriced);
  const bare = cardText(d, { ...all, show: [], log: [] });
  check(results, "with nothing chosen, only its name", bare.length === 1, JSON.stringify(bare));
  const active = cardText({ ...d, project: { ...project, status: "active", finishedAt: null } }, all);
  check(results, "a project still being knitted is on the needles since it started", /On the needles since 3 March 2026/.test(JSON.stringify(active)));

  const box = { x: 64, y: 64, w: 952, h: 740 };
  const inside = (rs: ReturnType<typeof photoRects>) => rs.every((r) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w + 0.5 && r.y + r.h <= box.y + box.h + 0.5);
  const apart = (rs: ReturnType<typeof photoRects>) => rs.every((a, i) => rs.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y));
  check(results, "one to four photos fill their box, none over another", [1, 2, 3, 4].every((n) => photoRects(n, box.x, box.y, box.w, box.h).length === n && inside(photoRects(n, box.x, box.y, box.w, box.h)) && apart(photoRects(n, box.x, box.y, box.w, box.h))) && photoRects(0, 0, 0, 1, 1).length === 0);

  const ctx = document.createElement("canvas").getContext("2d")!;
  const many = [text[0], ...Array.from({ length: 12 }, (_, i) => ({ kind: "quote" as const, text: `A long line from the log, number ${i + 1}, that takes room.`, id: `q${i}` }))];
  const fit = fitBlocks(ctx, many, 952, 400);
  check(results, "what does not fit is shrunk, then left out from the end, the name kept", fit.left > 0 && fit.scale < 1 && fit.laid[0].block === many[0] && fit.laid.length + fit.left === many.length, `${fit.left} left, scale ${fit.scale}`);
  // Three yarns and three needles under three photos on a 4:5 card: not all fits, and the cost stays.
  const crowded = cardText(
    {
      ...d,
      project: { ...project, yarns: [1, 2, 3].map((n) => ({ ...project.yarns[0], id: `e${n}`, yarnName: `Mota ${n}` })), toolIds: ["t1", "t1b", "t1c"] },
      tools: ["t1", "t1b", "t1c"].map((id) => ({ ...d.tools[0], id })),
    },
    { ...all, log: [] },
  );
  const tight = fitBlocks(ctx, crowded, 952, 1350 - 64 - 740 - 48 - 64);
  const kept = tight.laid.map((l) => (l.block.kind === "fact" ? l.block.label : l.block.kind));
  check(results, "a crowded card keeps its time and cost, what is left out is from the end", tight.left > 0 && kept.includes("Time") && kept.includes("Cost"), `${kept.join()} (${tight.left} left out)`);
  const small = fitBlocks(ctx, crowded, 952, 1350 - 64 - 740 - 48 - 64, { textSize: "small" });
  check(results, "smaller text makes room: less is left out", small.left < tight.left && small.scale < tight.scale, `large ${tight.left} left at ${tight.scale}, small ${small.left} left at ${small.scale}`);
  const medium = fitBlocks(ctx, text, 952, 2000, { textSize: "medium" });
  check(results, "…and with room, the words are at the size chosen", medium.scale === 0.85 && medium.left === 0, String(medium.scale));
  const modern = fitBlocks(ctx, crowded, 952, 1350 - 64 - 740 - 48 - 64, { font: "modern" });
  check(results, "another font is measured as it is drawn", modern.laid.length > 0 && modern.laid.length + modern.left === crowded.length);
  const roomy = fitBlocks(ctx, text, 952, 1000);
  check(results, "…and with room, all of it at its size", roomy.left === 0 && roomy.scale === 1);
}

export async function verifyProjectCard() {
  const results: CheckResult[] = [];
  type Store = { projects: Project[]; yarns: unknown[]; yarnUsage: unknown[]; projectLog: unknown[] };
  const store = (window as unknown as { __store: Store }).__store;
  const w = window as unknown as { __lastExport?: { kind: string; name: string; bytes: Uint8Array } };
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const dlg = () => document.querySelector<HTMLElement>(".dialog-card.project-card-dialog");
  const canvas = () => dlg()!.querySelector<HTMLCanvasElement>('[data-el="card"]')!;
  const click = (sel: string) => dlg()!.querySelector<HTMLElement>(sel)!.click();
  const before = { yarns: JSON.stringify(store.yarns), usage: JSON.stringify(store.yarnUsage) };
  const copied: ClipboardItem[] = [];
  const clipboard = navigator.clipboard as Clipboard & { write: Clipboard["write"] };
  const write = clipboard.write;
  Object.defineProperty(clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => void copied.push(...items) });
  let id = "";

  try {
    pure(results);

    // A yarn still in the stash: earlier suites may have used some up.
    const yarn = (store.yarns as { id: string; usedUpAt: number | null }[]).find((y) => !y.usedUpAt)!;
    const p = await invoke<Project>("add_project", { input: { name: "Card sweater", patternId: "p1", notes: "", startedAt: Date.now() - 40 * 86400000, toolIds: ["t2"], yarns: [{ yarnId: yarn.id, lotId: null }] } });
    id = p.id;
    try {
      // Kept from before the time and cost were there to choose.
      localStorage.setItem(`project-card:${id}`, JSON.stringify({ show: ["pattern", "dates", "yarn"] }));
    } catch {
      // Nothing kept.
    }
    await invoke("set_project_cover", { projectId: id, bytes: await picture("#33aa66") });
    for (const [text, colour] of [["Sleeves", "#3366cc"], ["Blocked", "#cc3333"]]) {
      const e = await invoke<{ id: string }>("add_log_entry", { projectId: id, text });
      await invoke("set_log_photo", { id: e.id, bytes: await picture(colour) });
    }
    const words = await invoke<{ id: string }>("add_log_entry", { projectId: id, text: "The yoke went faster than I thought." });
    await invoke("finish_project", { id, input: { finishedAt: Date.now(), leftovers: [{ entryId: p.yarns[0].id, usedGrams: 350 }] } });

    tab("patterns");
    tab("projects");
    // Finished, it is under the gallery's tab and in the list too.
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
    await waitFor(() => !!page()?.querySelector('[data-act="card"]'), "the project's page");
    check(results, "a project's page has Card to post…, and its size to say", !!page()!.querySelector('[data-f="size"]'));
    page()!.querySelector<HTMLElement>('[data-act="card"]')!.click();
    await waitFor(() => !!dlg() && canvas().width === 1080, "the card");
    await wait(300);
    const ticked = (k: string) => dlg()!.querySelector<HTMLInputElement>(`[data-show="${k}"]`)!.checked;
    check(results, "a card made before there were time and cost to choose shows them, and keeps what was left off", ticked("time") && ["yarnCost", "patternCost", "totalCost", "costWithTime"].every(ticked) && ticked("yarn") && !ticked("needles"));
    check(results, "the card opens 4:5, its first three photos in, numbered in order", canvas().height === 1350 && dlg()!.querySelectorAll(".pc-photo.on").length === 3 && dlg()!.querySelector(".pc-photo.on b")!.textContent === "1");
    check(results, "…the photos drawn on it, the first big", near(pixel(canvas(), 100, 100), "#33aa66"), pixel(canvas(), 100, 100));
    check(results, "…on cream", near(pixel(canvas(), 8, 1340), "#f5f0e6"), pixel(canvas(), 8, 1340));

    click('[data-shape="square"]');
    await waitFor(() => canvas().height === 1080, "square");
    click('[data-shape="story"]');
    await waitFor(() => canvas().height === 1920, "a story");
    check(results, "its shape is chosen: square, or a story's 9:16", true);
    click('[data-theme="night"]');
    await waitFor(() => near(pixel(canvas(), 8, 1910), "#1d1c21"), "night");
    check(results, "…and its colours", true);
    // The card as drawn, to see it change.
    const bodyOf = () => canvas().toDataURL();
    const large = bodyOf();
    click('[data-text-size="small"]');
    await waitFor(() => !!dlg()!.querySelector('[data-text-size="small"].on'), "small text");
    await wait(150);
    const smallPic = bodyOf();
    click('[data-font="soft"]');
    await waitFor(() => !!dlg()!.querySelector('[data-font="soft"].on'), "the soft font");
    await wait(150);
    check(results, "its text size and font are chosen, the card drawn again with each", large !== smallPic && smallPic !== bodyOf() && dlg()!.querySelectorAll(".pc-sizes .on, .pc-fonts .on").length === 2);

    // Photos taken out, and one put back: it is first.
    for (const b of [...dlg()!.querySelectorAll<HTMLElement>(".pc-photo.on")]) b.click();
    await waitFor(() => !dlg()!.querySelector(".pc-photo.on"), "no photos");
    await wait(200);
    // Where a photo would be, and the words do not reach.
    check(results, "without photos, the words have the card", near(pixel(canvas(), 1000, 700), "#1d1c21"), pixel(canvas(), 1000, 700));
    dlg()!.querySelectorAll<HTMLElement>(".pc-photo")[2].click();
    await waitFor(() => dlg()!.querySelectorAll(".pc-photo.on").length === 1, "one photo");
    await wait(200);
    check(results, "…a photo picked goes in", near(pixel(canvas(), 1000, 700), "#3366cc"), pixel(canvas(), 1000, 700));

    // The size, said here, is the project's.
    const size = dlg()!.querySelector<HTMLInputElement>('[data-f="size"]')!;
    size.value = "  M   (2nd size) ";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.projects.find((x) => x.id === id)!.size === "M (2nd size)", "the size kept");
    check(results, "the size said on the card is kept on the project", true);

    // A line from the log.
    const line = dlg()!.querySelector<HTMLInputElement>(`[data-log="${words.id}"]`);
    check(results, "lines from the log are offered, milestones not", !!line && !dlg()!.querySelector(".pc-log")!.textContent!.includes("Finished"));
    line!.checked = true;
    line!.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(200);

    // Copied, and saved.
    click('[data-act="copy"]');
    await waitFor(() => copied.length === 1, "copied");
    const png = await copied[0].getType("image/png");
    const bmp = await createImageBitmap(png);
    check(results, "Copy puts the card on the clipboard, a PNG at full size", png.type === "image/png" && bmp.width === 1080 && bmp.height === 1920, `${bmp.width}x${bmp.height}`);
    w.__lastExport = undefined;
    click('[data-act="save"]');
    await waitFor(() => !!w.__lastExport, "saved");
    check(results, "Save as PNG… saves it, named after the project", w.__lastExport!.kind === "png" && w.__lastExport!.name === "Card sweater card.png");

    // Closed: the choices kept for next time, and the page's size up to date.
    click('[data-act="close"]');
    await waitFor(() => !dlg(), "closed");
    check(results, "closed, the page shows the size said", page()!.querySelector<HTMLInputElement>('[data-f="size"]')!.value === "M (2nd size)");
    page()!.querySelector<HTMLElement>('[data-act="card"]')!.click();
    await waitFor(() => !!dlg() && canvas().height === 1920, "the card again");
    check(results, "opened again, it is as it was left: a story, night, small text in the soft font, one photo, the line from the log", dlg()!.querySelector('[data-theme="night"].on') !== null && !!dlg()!.querySelector('[data-text-size="small"].on') && !!dlg()!.querySelector('[data-font="soft"].on') && dlg()!.querySelectorAll(".pc-photo.on").length === 1 && dlg()!.querySelector<HTMLInputElement>(`[data-log="${words.id}"]`)!.checked);
    click('[data-act="close"]');
    await waitFor(() => !dlg(), "closed");

    // The page's own size field.
    const field = page()!.querySelector<HTMLInputElement>('[data-f="size"]')!;
    field.value = "L";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => store.projects.find((x) => x.id === id)!.size === "L", "the size from the page");
    check(results, "Size knitted on the project's page is saved", true);

    // From the gallery.
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector('.projects [data-mode="gallery"]'), "the projects tab");
    (document.querySelector('.projects [data-act="mode"][data-mode="gallery"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(`.gallery-tile[data-gallery="${id}"]`), "the gallery");
    (document.querySelector(`.gallery-tile[data-gallery="${id}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.gallery-view [data-act="card"]'), "the gallery's project");
    document.querySelector<HTMLElement>('.gallery-view [data-act="card"]')!.click();
    await waitFor(() => !!dlg() && canvas().width === 1080, "the card from the gallery");
    check(results, "the gallery has Card to post… too", true);
    click('[data-act="close"]');
    await waitFor(() => !dlg(), "closed");
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    Object.defineProperty(clipboard, "write", { configurable: true, value: write });
    if (id) await invoke("delete_project", { id }).catch(() => {});
    store.yarns = JSON.parse(before.yarns);
    store.yarnUsage = JSON.parse(before.usage);
    try {
      localStorage.removeItem(`project-card:${id}`);
    } catch {
      // Nothing kept.
    }
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__projectCardChecks = verifyProjectCard;
