/**
 * Checks for pictures opened big: a project's cover clicked (its log's
 * photos a step away), fitted to the window, zoomed by +, the wheel and a
 * double-click, dragged, back to Fit, the arrows going round, Copy, Esc and a
 * click beside it to close; a board picture by ⤢ View, a double-click and
 * Space; a photo in the log; the gallery's photo, over the gallery.
 *
 * Run with the harness open:
 *   window.__lightboxChecks()
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

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** A picture of a size, as bytes. */
async function picture(w: number, h: number, type: string): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#a63";
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), type));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

export async function verifyLightbox() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const box = () => document.querySelector<HTMLElement>(".lightbox");
  const img = () => box()?.querySelector<HTMLImageElement>('[data-el="img"]') ?? null;
  const stage = () => box()!.querySelector<HTMLElement>('[data-el="stage"]')!;
  const shownAs = () => box()?.querySelector('[data-el="count"]')?.textContent ?? "";
  const caption = () => box()?.querySelector('[data-el="caption"]')?.textContent ?? "";
  const zoomSays = () => box()?.querySelector('[data-el="zoom"]')?.textContent ?? "";
  const key = (k: string, more: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
  const ready = (w: number) => waitFor(() => !!img() && !img()!.hidden && img()!.naturalWidth === w, `the ${w} px picture shown`);
  const size = () => ({ w: img()!.getBoundingClientRect().width, h: img()!.getBoundingClientRect().height });
  const made: string[] = [];

  const copied: ClipboardItem[] = [];
  const clipboard = navigator.clipboard as Clipboard & { write: Clipboard["write"] };
  const write = clipboard.write;
  Object.defineProperty(clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => void copied.push(...items) });

  try {
    const p = await invoke<{ id: string }>("add_project", { input: { name: "Lightbox cardigan", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    made.push(p.id);
    await invoke("set_project_cover", { projectId: p.id, bytes: await picture(300, 200, "image/jpeg") });
    const wide = await invoke<{ id: string }>("add_board_item", { boardId: p.id, input: { kind: "image", x: 40, y: 40, w: 400, h: 200, data: {} } });
    await invoke("set_board_image", { id: wide.id, bytes: await picture(400, 200, "image/png") });
    const tall = await invoke<{ id: string }>("add_board_item", { boardId: p.id, input: { kind: "image", x: 480, y: 40, w: 100, h: 200, data: {} } });
    await invoke("set_board_image", { id: tall.id, bytes: await picture(200, 400, "image/png") });
    const older = await invoke<{ id: string }>("add_log_entry", { projectId: p.id, text: "Sleeve done" });
    await invoke("set_log_photo", { id: older.id, bytes: await picture(240, 320, "image/jpeg") });
    await wait(5);
    const newer = await invoke<{ id: string }>("add_log_entry", { projectId: p.id, text: "Blocked" });
    await invoke("set_log_photo", { id: newer.id, bytes: await picture(320, 240, "image/jpeg") });

    tab("patterns");
    tab("projects");
    // The list, whichever of its views was shown last.
    await waitFor(() => !!document.querySelector('.projects [data-act="mode"][data-mode="projects"]'), "the projects tab");
    (document.querySelector('.projects [data-act="mode"][data-mode="projects"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${p.id}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${p.id}"]`) as HTMLElement).click();
    await waitFor(() => !!page()?.querySelector("[data-cover].filled"), "the cover");

    // ---------- the cover, and the project's other photos ----------
    page()!.querySelector<HTMLElement>("[data-cover]")!.click();
    await ready(300);
    check(results, "the cover clicked opens big, the log's photos after it", shownAs() === "1 / 3" && caption() === "The cover", `${shownAs()} ${caption()}`);
    const st = stage().getBoundingClientRect();
    const fit = size();
    check(results, "…as big as the window allows, all of it", Math.abs(Math.min(st.width / 300, st.height / 200) * 300 - fit.w) < 1.5 && fit.h <= st.height + 1 && zoomSays() === "Fit", JSON.stringify({ fit, st: [st.width, st.height] }));
    key("ArrowRight");
    await ready(320);
    check(results, "→ goes to the next: the newest photo in the log, saying what was written", shownAs() === "2 / 3" && /^Blocked · /.test(caption()), `${shownAs()} ${caption()}`);
    key("ArrowLeft");
    key("ArrowLeft");
    await ready(240);
    check(results, "← goes back, and round from the first to the last", shownAs() === "3 / 3" && /^Sleeve done/.test(caption()), `${shownAs()} ${caption()}`);

    // Zoom, drag, fit.
    const before = size();
    key("+");
    check(results, "+ zooms in, saying how far", size().w > before.w * 1.2 && /^\d+%$/.test(zoomSays()), `${size().w} ${zoomSays()}`);
    const r = stage().getBoundingClientRect();
    stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -400, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    const zoomed = size();
    check(results, "…the wheel too", zoomed.w > before.w * 1.5, `${zoomed.w}`);
    const at = img()!.getBoundingClientRect();
    img()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    stage().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: r.left + r.width / 2 + 60, clientY: r.top + r.height / 2 + 40 }));
    img()!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 7, clientX: r.left + r.width / 2 + 60, clientY: r.top + r.height / 2 + 40 }));
    const moved = img()!.getBoundingClientRect();
    check(results, "a picture bigger than the window is dragged about, and stays open", !!box() && (moved.left !== at.left || moved.top !== at.top), JSON.stringify([at.left, at.top, moved.left, moved.top]));
    key("0");
    check(results, "0 fits it again", zoomSays() === "Fit" && Math.abs(size().w - before.w) < 1.5);
    const mid = img()!.getBoundingClientRect();
    img()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: mid.left + mid.width / 2, clientY: mid.top + mid.height / 2 }));
    check(results, "a double-click zooms in", zoomSays() !== "Fit" && size().w > before.w);
    img()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: mid.left + mid.width / 2, clientY: mid.top + mid.height / 2 }));
    check(results, "…and another fits it again", zoomSays() === "Fit");

    // Copy.
    box()!.querySelector<HTMLElement>('[data-act="copy"]')!.click();
    await waitFor(() => copied.length === 1, "the copy");
    const bitmap = await createImageBitmap(await copied[0].getType("image/png"));
    check(results, "Copy copies the picture shown, as a PNG", bitmap.width === 240 && bitmap.height === 320, `${bitmap.width}x${bitmap.height}`);

    // Esc closes it, and only it.
    key("Escape");
    check(results, "Esc closes it, and the page stays", !box() && !!page());

    // ---------- the board ----------
    const view = () => page()!.querySelector<HTMLElement>(`.board-item[data-id="${wide.id}"] [data-act="view"]`);
    await waitFor(() => !!view(), "the board picture's View");
    view()!.click();
    await ready(400);
    check(results, "a board picture's ⤢ View opens it, the board's other pictures a step away", shownAs() === "1 / 2");
    key("ArrowRight");
    await ready(200);
    check(results, "…the next picture on the board", shownAs() === "2 / 2");
    // A click beside the picture closes it.
    const corner = stage().getBoundingClientRect();
    stage().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 8, clientX: corner.left + 3, clientY: corner.top + 3 }));
    stage().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 8, clientX: corner.left + 3, clientY: corner.top + 3 }));
    check(results, "a click beside the picture closes it", !box());
    page()!.querySelector<HTMLElement>(`.board-item[data-id="${tall.id}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await ready(200);
    check(results, "a double-click on a board picture opens it", shownAs() === "2 / 2");
    key("Escape");

    // ---------- the log ----------
    (page()!.querySelector('[data-view="log"]') as HTMLElement).click();
    const photo = () => page()?.querySelector<HTMLImageElement>(`.log-entry[data-id="${older.id}"] .log-photo`);
    await waitFor(() => !!photo()?.src, "the log's photo");
    photo()!.click();
    await ready(240);
    check(results, "a photo in the log opens big, at its place among the log's", shownAs() === "2 / 2" && /^Sleeve done/.test(caption()), `${shownAs()} ${caption()}`);
    key("Escape");

    // ---------- the gallery ----------
    await invoke("finish_project", { id: p.id, input: { finishedAt: Date.now(), leftovers: [] } });
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector('.projects [data-mode="gallery"]'), "the projects tab");
    (document.querySelector('.projects [data-act="mode"][data-mode="gallery"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(`.gallery-tile[data-gallery="${p.id}"]`), "the gallery");
    (document.querySelector(`.gallery-tile[data-gallery="${p.id}"]`) as HTMLElement).click();
    const gallery = () => document.querySelector<HTMLElement>(".dialog-card.gallery-view");
    await waitFor(() => !!gallery()?.querySelector(".gallery-big img"), "the gallery's photo");
    gallery()!.querySelector<HTMLElement>(".gallery-big img")!.click();
    await ready(300);
    const over = Number(getComputedStyle(box()!).zIndex) > Number(getComputedStyle(gallery()!.closest(".dialog-backdrop")!).zIndex);
    check(results, "the gallery's photo opens big, over the gallery, its photos a step away", over && shownAs() === "1 / 3");
    key("Escape");
    check(results, "…and Esc closes it, the gallery still open", !box() && !!gallery());
    gallery()!.querySelector<HTMLElement>('[data-act="close"]')!.click();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    if (box()) key("Escape");
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    Object.defineProperty(clipboard, "write", { configurable: true, value: write });
    for (const id of made) await invoke("delete_project", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__lightboxChecks = verifyLightbox;
