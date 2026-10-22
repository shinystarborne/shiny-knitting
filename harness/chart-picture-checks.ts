/**
 * Checks for the Charts tab, charts kept as pictures: one dropped on the tab
 * asked about (named from its file, knitting or crochet) and kept; Knitting,
 * Crochet and the search; changed; opened big; on a project's board from the
 * Chart button, beside the charts drawn in Constructors, its picture painted
 * and opened big; offered only while its tab is shown; and removed, the
 * board saying so.
 *
 * Run with the harness open:
 *   window.__chartPictureChecks()
 */
import type { ChartPicture, Project } from "../src/api";

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

/** A small chart as a PNG file: a grid of squares, some filled, wider than it is tall. */
async function chartFile(name: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 120;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 240, 120);
  for (let x = 0; x < 240; x += 20) for (let y = 0; y < 120; y += 20) {
    ctx.strokeStyle = "#333";
    ctx.strokeRect(x, y, 20, 20);
    if ((x + y) % 60 === 0) ctx.fillRect(x + 4, y + 4, 12, 12);
  }
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

export async function verifyChartPictures() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const view = () => document.querySelector<HTMLElement>(".chart-pictures");
  const cards = () => [...(view()?.querySelectorAll<HTMLElement>(".chartpic-card") ?? [])];
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const setHidden = (tabs: string[]) => invoke("save_hidden_tabs", { tabs }).then(() => document.dispatchEvent(new CustomEvent("hidden-tabs")));
  let projectId = "";
  const kept = await invoke<ChartPicture[]>("list_chart_pictures");
  try {
    const names = [...document.querySelectorAll<HTMLElement>(".tab-bar .tab")].map((t) => t.textContent);
    check(results, "a Charts tab, after Constructors", names[names.indexOf("Constructors") + 1] === "Charts", names.join(","));
    tab("charts");
    await waitFor(() => !!view()?.querySelector(".empty, .chartpic-card"), "the Charts tab");
    if (!kept.length) check(results, "empty, it says what it is for and how to add one", /Ctrl/.test(view()!.querySelector(".empty")?.textContent ?? "") && /board/.test(view()!.querySelector(".empty")?.textContent ?? ""));

    // Dropped on the tab: asked about, its name from the file.
    const drop = new DataTransfer();
    drop.items.add(await chartFile("spiral_rose.png"));
    view()!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: drop }));
    await waitFor(() => !!dialog()?.querySelector('[data-f="name"]'), "the chart's dialog");
    await waitFor(() => !!dialog()!.querySelector<HTMLImageElement>(".chartpic-preview img")?.naturalWidth, "its picture");
    const name = dialog()!.querySelector<HTMLInputElement>('[data-f="name"]')!;
    check(results, "a picture dropped is asked about: shown, named from its file, a Crop", name.value === "spiral rose" && !!dialog()!.querySelector('[data-act="crop"]'), name.value);
    check(results, "…knitting unless said", dialog()!.querySelector('[data-craft="knitting"]')!.classList.contains("on"));
    name.value = "Spiral rose";
    (dialog()!.querySelector('[data-craft="crochet"]') as HTMLElement).click();
    dialog()!.querySelector<HTMLTextAreaElement>('[data-f="notes"]')!.value = "From the flower book";
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => cards().some((c) => /Spiral rose/.test(c.textContent ?? "")), "the chart's card");
    const stored = (await invoke<ChartPicture[]>("list_chart_pictures")).find((c) => c.name === "Spiral rose")!;
    check(results, "kept: crochet, its notes, its size", stored.craft === "crochet" && stored.notes === "From the flower book" && stored.width === 240 && stored.height === 120, JSON.stringify(stored));
    const card = () => cards().find((c) => c.dataset.open === stored.id)!;
    check(results, "its card says Crochet", /Crochet/.test(card().querySelector(".pill")?.textContent ?? ""));
    await waitFor(() => card().querySelector(".chartpic-picture")!.classList.contains("filled"), "its picture on the card");
    check(results, "…and shows the picture", true);

    const show = async (s: string) => {
      (view()!.querySelector(`[data-act="shown"][data-shown="${s}"]`) as HTMLElement).click();
      await wait(100);
    };
    await show("knitting");
    check(results, "Knitting leaves it out", !card());
    await show("crochet");
    check(results, "Crochet shows it", !!card());
    await show("all");
    const search = view()!.querySelector<HTMLInputElement>(".search")!;
    search.value = "flower book";
    search.dispatchEvent(new Event("input"));
    await wait(100);
    check(results, "the search finds it by its notes", !!card() && cards().length === 1, String(cards().length));
    search.value = "owl";
    search.dispatchEvent(new Event("input"));
    await wait(100);
    check(results, "…and not by what it is not", !card());
    search.value = "";
    search.dispatchEvent(new Event("input"));
    await wait(100);

    // Changed.
    (card().querySelector('[data-act="edit"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector('[data-f="name"]'), "the chart's dialog again");
    check(results, "Edit shows it as kept", dialog()!.querySelector<HTMLInputElement>('[data-f="name"]')!.value === "Spiral rose" && dialog()!.querySelector('[data-craft="crochet"]')!.classList.contains("on"));
    dialog()!.querySelector<HTMLInputElement>('[data-f="name"]')!.value = "Spiral rose, big";
    (dialog()!.querySelector('[data-act="save"]') as HTMLElement).click();
    await waitFor(() => /Spiral rose, big/.test(card()?.textContent ?? ""), "the new name");
    check(results, "…and keeps what is changed", true);

    // Opened big.
    (card().querySelector(".chartpic-picture") as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".lightbox"), "the chart big");
    check(results, "clicked, it opens big", /Spiral rose, big/.test(document.querySelector(".lightbox")!.textContent ?? ""));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !document.querySelector(".lightbox"), "the chart big to close");

    // On a board.
    const project = await invoke<Project>("add_project", { input: { name: "Roses", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!page()?.querySelector('.board-tools [data-add="chart"]'), "the project's board");
    (page()!.querySelector('.board-tools [data-add="chart"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "the choice of chart");
    const groups = [...dialog()!.querySelectorAll("optgroup")].map((g) => g.label);
    check(results, "the board's Chart offers it under Charts: crochet", groups[0] === "Charts: crochet", groups.join(" | "));
    dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!.value = `pic:${stored.id}`;
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    const boardCard = () => page()?.querySelector<HTMLElement>(".board-item.kind-chartpic") ?? null;
    await waitFor(() => !!boardCard()?.querySelector(".board-chartpic.filled"), "the chart on the board");
    const box = boardCard()!.getBoundingClientRect();
    check(results, "on the board: its name, its picture, the card its shape", /Spiral rose, big/.test(boardCard()!.querySelector(".board-chart-bar")!.textContent ?? "") && box.width > box.height, `${box.width}×${box.height}`);
    (boardCard()!.querySelector('[data-act="open"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(".lightbox"), "the board's chart big");
    check(results, "⤢ View opens it big", true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !document.querySelector(".lightbox"), "it to close");

    // Charts hidden: its pictures not offered; Constructors hidden too: the button greyed.
    await setHidden(["charts"]);
    await wait(200);
    const chartButton = page()!.querySelector<HTMLElement>('.board-tools [data-add="chart"]')!;
    check(results, "Charts hidden, Constructors shown: Chart is not greyed", !chartButton.classList.contains("tab-hidden"));
    chartButton.click();
    await waitFor(() => !!dialog(), "the choice, or that there is none");
    const offered = [...dialog()!.querySelectorAll("option")].map((o) => o.value);
    check(results, "…and offers no picture", !offered.some((v) => v.startsWith("pic:")), offered.join(","));
    (dialog()!.querySelector("button.ghost, button") as HTMLElement).click();
    await waitFor(() => !dialog(), "it to close");
    await setHidden(["charts", "calculators"]);
    await wait(200);
    check(results, "both hidden: greyed, and says both", chartButton.classList.contains("tab-hidden") && /Constructors and Charts are hidden/.test(chartButton.title), chartButton.title);
    await setHidden([]);
    await wait(200);

    // Removed: the board says so.
    tab("charts");
    await waitFor(() => !!card(), "the Charts tab again");
    (card().querySelector('[data-act="remove"]') as HTMLElement).click();
    await waitFor(() => !!dialog(), "the question");
    (dialog()!.querySelector("button.danger, button.primary") as HTMLElement).click();
    await waitFor(() => !card(), "the chart to go");
    check(results, "removed, it goes", !(await invoke<ChartPicture[]>("list_chart_pictures")).some((c) => c.id === stored.id));
    tab("projects");
    await waitFor(() => !!document.querySelector(".projects"), "the projects");
    document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
    await waitFor(() => !!boardCard(), "the board again");
    check(results, "…and the board's card says it is no longer kept", /no longer kept/.test(boardCard()!.textContent ?? ""));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (dialog()) (dialog()!.querySelector("button.ghost, button") as HTMLElement)?.click();
    await invoke("save_hidden_tabs", { tabs: [] }).catch(() => {});
    document.dispatchEvent(new CustomEvent("hidden-tabs"));
    for (const c of await invoke<ChartPicture[]>("list_chart_pictures")) if (!kept.some((k) => k.id === c.id)) await invoke("delete_chart_picture", { id: c.id });
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__chartPictureChecks = verifyChartPictures;
