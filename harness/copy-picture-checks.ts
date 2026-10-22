/**
 * Checks for copying a project's pictures, clicked through: its cover, a
 * picture on its board (Copy, and Ctrl+C selected), a photo on the board's
 * log card and in its log, and the gallery's photo shown. What reaches the
 * clipboard is caught here: a PNG of the picture, a JPEG photo made one.
 *
 * Run with the harness open:
 *   window.__copyPictureChecks()
 */
import { pngOf } from "../src/copy-picture";

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
  ctx.fillStyle = "#3a6";
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), type));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

export async function verifyCopyPicture() {
  const results: CheckResult[] = [];
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const toast = () => document.querySelector(".undo-toast")?.textContent ?? "";
  const made: string[] = [];

  // The clipboard, caught: what is written, a picture at a time.
  const copied: ClipboardItem[] = [];
  const clipboard = navigator.clipboard as Clipboard & { write: Clipboard["write"] };
  const write = clipboard.write;
  Object.defineProperty(clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => void copied.push(...items) });
  /** The size of the last picture copied, once it is a PNG. */
  const lastCopied = async (count: number): Promise<string> => {
    await waitFor(() => copied.length === count, `copy ${count}`);
    const item = copied[count - 1];
    if (!item.types.includes("image/png")) return `types ${item.types.join()}`;
    const blob = await item.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    return `${blob.type} ${bitmap.width}x${bitmap.height}`;
  };

  try {
    // A JPEG becomes a PNG of the same size.
    const jpeg = URL.createObjectURL(new Blob([Uint8Array.from(await picture(64, 48, "image/jpeg"))], { type: "image/jpeg" }));
    const png = await pngOf(jpeg);
    const pb = await createImageBitmap(png);
    check(results, "a JPEG photo is copied as a PNG of the same size", png.type === "image/png" && pb.width === 64 && pb.height === 48, `${png.type} ${pb.width}x${pb.height}`);
    URL.revokeObjectURL(jpeg);

    const p = await invoke<{ id: string }>("add_project", { input: { name: "Copy cardigan", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } });
    made.push(p.id);
    await invoke("set_project_cover", { projectId: p.id, bytes: await picture(300, 200, "image/jpeg") });
    const item = await invoke<{ id: string }>("add_board_item", { boardId: p.id, input: { kind: "image", x: 40, y: 40, w: 400, h: 200, data: {} } });
    await invoke("set_board_image", { id: item.id, bytes: await picture(400, 200, "image/png") });
    const entry = await invoke<{ id: string }>("add_log_entry", { projectId: p.id, text: "Sleeve done" });
    await invoke("set_log_photo", { id: entry.id, bytes: await picture(240, 320, "image/jpeg") });

    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${p.id}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${p.id}"]`) as HTMLElement).click();
    await waitFor(() => !!page()?.querySelector('[data-act="cover-copy"]'), "the project's page");

    // The cover.
    const coverCopy = page()!.querySelector<HTMLElement>('[data-act="cover-copy"]')!;
    check(results, "a project with a cover has Copy beside it", !coverCopy.hidden);
    coverCopy.click();
    check(results, "…which copies the cover, as a PNG", (await lastCopied(1)) === "image/png 300x200", await lastCopied(1));
    await waitFor(() => /The cover copied/.test(toast()), "the notice");
    check(results, "…and says so", true);

    // A picture on the board: Copy, and Ctrl+C with it selected.
    const boardCopy = () => page()?.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"] [data-act="copy"]`);
    await waitFor(() => !!boardCopy(), "the picture's Copy on the board");
    check(results, "a picture on the board has ⧉ Copy beside ✂ Crop", /Copy/.test(boardCopy()!.textContent ?? "") && !!boardCopy()!.parentElement!.querySelector('[data-act="crop"]'));
    boardCopy()!.click();
    check(results, "…which copies it", (await lastCopied(2)) === "image/png 400x200", await lastCopied(2));
    page()!.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"]`)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 4 }));
    page()!.querySelector<HTMLElement>(".board")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 4 }));
    await wait(100);
    page()!.querySelector<HTMLElement>(".board")!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }));
    check(results, "Ctrl+C copies the picture selected, and does not crop it", (await lastCopied(3)) === "image/png 400x200" && !document.querySelector(".dialog-card.crop-dialog"), await lastCopied(3));

    // The log card's photo.
    (page()!.querySelector('[data-add="log"]') as HTMLElement).click();
    const cardCopy = () => page()?.querySelector<HTMLElement>(`.board-item.kind-log [data-act="log-copy"][data-entry="${entry.id}"]`);
    await waitFor(() => !!cardCopy(), "the log card's photo");
    cardCopy()!.click();
    check(results, "a photo on the board's log card has Copy, copying it", (await lastCopied(4)) === "image/png 240x320", await lastCopied(4));

    // The log's photo.
    (page()!.querySelector('[data-view="log"]') as HTMLElement).click();
    const logCopy = () => page()?.querySelector<HTMLElement>(`.log-entry[data-id="${entry.id}"] [data-act="copy"]`);
    await waitFor(() => !!logCopy(), "the photo's Copy in the log");
    logCopy()!.click();
    check(results, "a photo in the log has Copy, copying it", (await lastCopied(5)) === "image/png 240x320", await lastCopied(5));
    check(results, "…an entry without a photo has none", !page()!.querySelector(`.log-entry:not([data-id="${entry.id}"]) [data-act="copy"]`));

    // The gallery's photo shown.
    await invoke("finish_project", { id: p.id, input: { finishedAt: Date.now(), leftovers: [] } });
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector('.projects [data-mode="gallery"]'), "the projects tab");
    (document.querySelector('.projects [data-act="mode"][data-mode="gallery"]') as HTMLElement).click();
    await waitFor(() => !!document.querySelector(`.gallery-tile[data-gallery="${p.id}"]`), "the gallery");
    (document.querySelector(`.gallery-tile[data-gallery="${p.id}"]`) as HTMLElement).click();
    const view = () => document.querySelector<HTMLElement>(".dialog-card.gallery-view");
    await waitFor(() => !!view()?.querySelector('[data-act="copy-photo"]'), "the gallery's photo");
    view()!.querySelector<HTMLElement>('[data-act="copy-photo"]')!.click();
    check(results, "the gallery copies the photo shown: the cover first", (await lastCopied(6)) === "image/png 300x200", await lastCopied(6));
    view()!.querySelectorAll<HTMLElement>(".gallery-thumb")[1].click();
    await waitFor(() => !!view()?.querySelector(".gallery-thumb.current[data-index='1']"), "the next photo");
    view()!.querySelector<HTMLElement>('[data-act="copy-photo"]')!.click();
    check(results, "…and the one chosen from its strip", (await lastCopied(7)) === "image/png 240x320", await lastCopied(7));
    view()!.querySelector<HTMLElement>('[data-act="close"]')!.click();

    // A clipboard that refuses: said, not swallowed.
    Object.defineProperty(clipboard, "write", { configurable: true, value: async () => Promise.reject(new Error("Document is not focused.")) });
    const { copyPicture } = await import("../src/copy-picture");
    const done = copyPicture(Promise.resolve(null), "The cover");
    await waitFor(() => /could not be copied/.test(document.querySelector(".dialog-card")?.textContent ?? ""), "the refusal said");
    check(results, "a picture that cannot be copied says why", /The cover could not be copied: Document is not focused\./.test(document.querySelector(".dialog-card")!.textContent ?? ""), document.querySelector(".dialog-card")!.textContent ?? "");
    document.querySelector<HTMLElement>(".dialog-card button")!.click();
    check(results, "…and resolves that it was not", (await done) === false);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    Object.defineProperty(clipboard, "write", { configurable: true, value: write });
    for (const id of made) await invoke("delete_project", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__copyPictureChecks = verifyCopyPicture;
