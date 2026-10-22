/**
 * Checks for a cheatsheet on a project's board: a book's pages added from the
 * board and drawn on its card, read by scrolling without the card moving; a
 * web page in a frame, and one that refuses frames offered in a window;
 * Open taking it to Cheatsheets; put there from Cheatsheets with To a
 * project…; and a card whose sheet is gone saying so.
 *
 * Run with the harness open:
 *   window.__boardSheetChecks()
 */
import type { BoardItem, Cheatsheet, Pattern, Project } from "../src/api";

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

export async function verifyBoardSheets() {
  const results: CheckResult[] = [];
  const w = window as unknown as { __store: { cheatsheets?: Cheatsheet[]; boardItems: BoardItem[]; patterns: Pattern[] }; __sheetWindows?: { url: string }[] };
  const store = w.__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const choose = async (value: string, what: string) => {
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), what);
    dialog()!.querySelector<HTMLSelectElement>("select.dialog-choices")!.value = value;
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await waitFor(() => !dialog(), "the dialog to close");
  };
  const card = (sheetId: string) => {
    const item = store.boardItems.find((i) => i.kind === "sheet" && i.data.sheetId === sheetId);
    return item ? page()?.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"]`) ?? null : null;
  };
  const before = store.cheatsheets ? [...store.cheatsheets] : undefined;
  let projectId = "";
  try {
    const book = store.patterns.find((p) => p.format === "pdf" && p.fileName === "sample-pattern.pdf") ?? store.patterns.find((p) => p.format === "pdf")!;
    const pages = await invoke<Cheatsheet>("add_cheatsheet", { input: { kind: "pages", patternId: book.id, pageFrom: 1, pageTo: 2, title: "Cast-ons" } });
    const web = await invoke<Cheatsheet>("add_cheatsheet", { input: { kind: "web", url: "https://example.com/yarn-weights", title: "Yarn weights" } });
    const refused = await invoke<Cheatsheet>("add_cheatsheet", { input: { kind: "web", url: "https://refuses.example.com/table", title: "A shy site" } });
    const project = await invoke<Project>("add_project", { input: { name: "Cardigan with sheets", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    projectId = project.id;
    const openProject = async () => {
      tab("projects");
      await waitFor(() => !!document.querySelector(".projects"), "the projects");
      document.querySelector(".projects")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: projectId }));
      await waitFor(() => !!page()?.querySelector('.board-tools [data-add="sheet"]'), "the project's board");
    };
    await openProject();
    check(results, "a project's board offers a Cheatsheet", !!page()!.querySelector('.board-tools [data-add="sheet"]'));

    // A book's pages, from the board.
    (page()!.querySelector('.board-tools [data-add="sheet"]') as HTMLElement).click();
    await waitFor(() => !!dialog()?.querySelector("select.dialog-choices"), "the cheatsheets to choose from");
    const groups = [...dialog()!.querySelectorAll("optgroup")].map((g) => g.label);
    check(results, "…chosen from the cheatsheets, web pages and books' pages apart", groups.includes("Web pages") && groups.includes("From books"), JSON.stringify(groups));
    await choose(pages.id, "the choice");
    await waitFor(() => (card(pages.id)?.querySelectorAll("canvas.sheet-page").length ?? 0) === 2, "the pages drawn");
    const canvases = [...card(pages.id)!.querySelectorAll<HTMLCanvasElement>("canvas.sheet-page")];
    check(results, "added, its pages are drawn on the card, named", /Cast-ons/.test(card(pages.id)!.textContent ?? "") && canvases.every((c) => c.width > 200 && c.getBoundingClientRect().width > 200), canvases.map((c) => `${c.width}`).join(","));

    // Scrolled and read: a press on its pages does not move the card.
    const item = store.boardItems.find((i) => i.kind === "sheet" && i.data.sheetId === pages.id)!;
    const body = card(pages.id)!.querySelector<HTMLElement>(".board-sheet")!;
    const r = body.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, pointerId: 7, button: 0, isPrimary: true };
    body.dispatchEvent(new PointerEvent("pointerdown", at));
    body.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX + 80, clientY: at.clientY + 60 }));
    body.dispatchEvent(new PointerEvent("pointerup", { ...at, clientX: at.clientX + 80, clientY: at.clientY + 60 }));
    await wait(150);
    const still = store.boardItems.find((i) => i.id === item.id)!;
    check(results, "…a press on its pages reads them: the card stays put", still.x === item.x && still.y === item.y && body.scrollHeight > body.clientHeight, `${still.x},${still.y} / ${body.scrollHeight}>${body.clientHeight}`);

    // A web page, in a frame; one that refuses frames, in a window.
    (page()!.querySelector('.board-tools [data-add="sheet"]') as HTMLElement).click();
    await choose(web.id, "the web page");
    await waitFor(() => !!card(web.id)?.querySelector("iframe.board-sheet-frame"), "the web page's frame");
    check(results, "a web page shows in a frame on its card", card(web.id)!.querySelector<HTMLIFrameElement>("iframe.board-sheet-frame")!.src.startsWith("https://example.com/yarn-weights"));
    (page()!.querySelector('.board-tools [data-add="sheet"]') as HTMLElement).click();
    await choose(refused.id, "the shy site");
    await waitFor(() => !!card(refused.id), "the shy site's card");
    w.__sheetWindows = [];
    card(refused.id)!.querySelector<HTMLElement>('.board-sheet-refused [data-act="sheet-window"]')!.click();
    await waitFor(() => (w.__sheetWindows ?? []).length > 0, "its window", 3000).catch(() => {});
    check(results, "…one that will not be shown in a frame says so, and opens in a window", !card(refused.id)!.querySelector("iframe") && /cannot be shown inside the app/.test(card(refused.id)!.textContent ?? "") && (w.__sheetWindows ?? []).some((x) => x.url.includes("refuses.example.com")), JSON.stringify(w.__sheetWindows));

    // Open: in Cheatsheets.
    card(pages.id)!.querySelector<HTMLElement>('[data-act="open"]')!.click();
    await waitFor(() => !!document.querySelector(".cheatsheets .sheet-item.on"), "Cheatsheets");
    check(results, "Open ↗ opens it in Cheatsheets", document.querySelector(".cheatsheets .sheet-item.on")?.getAttribute("data-sheet") === pages.id);

    // To a project…, from Cheatsheets.
    const onBoard = store.boardItems.filter((i) => i.boardId === projectId).length;
    document.querySelector<HTMLElement>('.cheatsheets [data-sheet="' + web.id + '"]')!.click();
    await waitFor(() => !!document.querySelector('.cheatsheets [data-act="to-board"]') && /Yarn weights/.test((document.querySelector<HTMLInputElement>(".cheatsheets .sheet-title")?.value ?? "")), "the web page open");
    document.querySelector<HTMLElement>('.cheatsheets [data-act="to-board"]')!.click();
    await choose(projectId, "the projects");
    await waitFor(() => store.boardItems.filter((i) => i.boardId === projectId).length === onBoard + 1, "put on the board");
    const put = store.boardItems.filter((i) => i.boardId === projectId).at(-1)!;
    const others = store.boardItems.filter((i) => i.boardId === projectId && i.id !== put.id);
    check(results, "To a project… puts it on that project's board, under what is there", put.kind === "sheet" && put.data.sheetId === web.id && others.every((o) => put.y >= o.y + o.h), JSON.stringify(put));
    check(results, "…and says so, with a way there", /On the board of Cardigan with sheets/.test(document.querySelector(".notice")?.textContent ?? document.body.textContent ?? ""));

    // A sheet removed: its card says so.
    await invoke("delete_cheatsheet", { id: pages.id });
    await openProject();
    await waitFor(() => /no longer kept/.test(card(pages.id)?.textContent ?? ""), "the gone sheet's card", 5000).catch(() => {});
    check(results, "a card whose cheatsheet was removed says so", /A cheatsheet no longer kept/.test(card(pages.id)?.textContent ?? ""));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    store.cheatsheets = before;
    try {
      localStorage.removeItem("cheatsheets:open");
    } catch {
      // Nothing to clear.
    }
    tab("patterns");
  }
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__boardSheetChecks = verifyBoardSheets;
