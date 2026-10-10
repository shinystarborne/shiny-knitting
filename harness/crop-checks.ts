/**
 * Checks for cropping a picture, clicked through: a picture on a project's
 * board, and a photo in its log, each cropped by dragging a box; what is kept
 * replaces the picture, and the board item takes its shape.
 *
 * Run with the harness open:
 *   window.__cropChecks()
 */
import { forgetLogPhoto } from "../src/covers";

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

type Store = { covers: Map<string, ArrayLike<number>>; boardItems: { id: string; w: number; h: number }[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** A 400 × 200 picture, as bytes. */
async function picture(type: string): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c33";
  ctx.fillRect(0, 0, 400, 200);
  ctx.fillStyle = "#33c";
  ctx.fillRect(100, 50, 100, 100);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), type));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

async function sizeOf(bytes: ArrayLike<number>): Promise<[number, number]> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
  return [bitmap.width, bitmap.height];
}

/** Drags a box over the shown picture, from one fraction of it to another. */
async function dragBox(from: [number, number], to: [number, number]): Promise<void> {
  const dialog = document.querySelector<HTMLElement>(".dialog-card.crop-dialog")!;
  const stage = dialog.querySelector<HTMLElement>(".crop-stage")!;
  const img = dialog.querySelector<HTMLImageElement>("img")!;
  await waitFor(() => img.naturalWidth > 0 && img.getBoundingClientRect().width > 0, "the picture in the crop dialog");
  const r = img.getBoundingClientRect();
  const at = (f: [number, number]) => ({ clientX: r.left + r.width * f[0], clientY: r.top + r.height * f[1], pointerId: 1, bubbles: true });
  stage.dispatchEvent(new PointerEvent("pointerdown", at(from)));
  stage.dispatchEvent(new PointerEvent("pointermove", at(to)));
  stage.dispatchEvent(new PointerEvent("pointerup", at(to)));
}

export async function verifyCrop() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const crop = () => document.querySelector<HTMLElement>(".dialog-card.crop-dialog");
  let projectId = "";

  try {
    projectId = (await invoke<{ id: string }>("add_project", { input: { name: "Crop hat", patternId: null, notes: "", startedAt: null, toolIds: [], yarns: [] } })).id;
    const item = await invoke<{ id: string }>("add_board_item", { boardId: projectId, input: { kind: "image", x: 40, y: 40, w: 400, h: 200, data: {} } });
    await invoke("set_board_image", { id: item.id, bytes: await picture("image/png") });
    const entry = await invoke<{ id: string }>("add_log_entry", { projectId, text: "Blocked" });
    await invoke("set_log_photo", { id: entry.id, bytes: await picture("image/jpeg") });

    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${projectId}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${projectId}"]`) as HTMLElement).click();
    const scissors = () => page()?.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"] [data-act="crop"]`);
    await waitFor(() => !!scissors(), "the picture's ✂ on the board");
    check(results, "a picture on the board has ✂ Crop, said in words", /Crop/.test(scissors()!.textContent ?? "") && /Crop the picture/.test(scissors()!.title));
    scissors()!.click();
    await waitFor(() => !!crop(), "the crop dialog");
    check(results, "…which opens it to crop, Crop waiting for a box", (crop()!.querySelector('[data-act="crop"]') as HTMLButtonElement).disabled);
    // The left half, top to bottom: 200 × 200 of the 400 × 200.
    await dragBox([0, 0], [0.5, 1]);
    (crop()!.querySelector('[data-act="crop"]') as HTMLButtonElement).click();
    await waitFor(() => !crop() && store.boardItems.find((i) => i.id === item.id)!.h !== 200, "the cropped picture");
    const [w, h] = await sizeOf(store.covers.get(`board:${item.id}`)!);
    check(results, "what was in the box replaces the picture, at its own resolution", Math.abs(w - 200) <= 2 && Math.abs(h - 200) <= 2, `${w} × ${h}`);
    const stored = store.boardItems.find((i) => i.id === item.id)!;
    check(results, "…and the item takes its shape at the same width", stored.w === 400 && Math.abs(stored.h - 400) <= 4, `${stored.w} × ${stored.h}`);

    // C, with the picture selected.
    page()!.querySelector<HTMLElement>(`.board-item[data-id="${item.id}"]`)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 4 }));
    page()!.querySelector<HTMLElement>(".board")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 4 }));
    await wait(100);
    page()!.querySelector<HTMLElement>(".board")!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
    await waitFor(() => !!crop(), "C to open the crop");
    check(results, "C crops the picture selected", true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !crop(), "the crop put away");

    // A photo in the log, from the log card on the board.
    (page()!.querySelector('[data-add="log"]') as HTMLElement).click();
    const cardCrop = () => page()?.querySelector<HTMLElement>(`.board-item.kind-log [data-act="log-crop"][data-entry="${entry.id}"]`);
    await waitFor(() => !!cardCrop(), "the log card's photo");
    const cardBefore = store.covers.get(`log:${entry.id}`)!.length;
    cardCrop()!.click();
    await waitFor(() => !!crop(), "the crop dialog, from the card");
    await dragBox([0, 0], [0.5, 1]);
    (crop()!.querySelector('[data-act="crop"]') as HTMLButtonElement).click();
    await waitFor(() => !crop() && store.covers.get(`log:${entry.id}`)!.length !== cardBefore, "the card's photo cropped");
    const [cw2, ch2] = await sizeOf(store.covers.get(`log:${entry.id}`)!);
    check(results, "a photo in the log card is cropped there, without going to the log", Math.abs(cw2 - 200) <= 2 && Math.abs(ch2 - 200) <= 2, `${cw2} × ${ch2}`);
    // Back to the whole picture, for the log's own crop below.
    await invoke("set_log_photo", { id: entry.id, bytes: await picture("image/jpeg") });
    forgetLogPhoto(entry.id);

    // The log's photo.
    (page()!.querySelector('[data-view="log"]') as HTMLElement).click();
    const logCrop = () => page()?.querySelector<HTMLElement>(`.log-entry[data-id="${entry.id}"] [data-act="crop"]`);
    await waitFor(() => !!logCrop(), "the photo's Crop in the log");
    logCrop()!.click();
    await waitFor(() => !!crop(), "the crop dialog");
    // The middle square: from a quarter to three quarters across, the whole height.
    await dragBox([0.25, 0], [0.75, 1]);
    const before = store.covers.get(`log:${entry.id}`)!.length;
    (crop()!.querySelector('[data-act="crop"]') as HTMLButtonElement).click();
    await waitFor(() => !crop() && store.covers.get(`log:${entry.id}`)!.length !== before, "the cropped photo");
    const [lw, lh] = await sizeOf(store.covers.get(`log:${entry.id}`)!);
    const bytes = store.covers.get(`log:${entry.id}`)!;
    check(results, "a log photo is cropped the same way, and stays a JPEG", Math.abs(lw - 200) <= 2 && Math.abs(lh - 200) <= 2 && bytes[0] === 0xff && bytes[1] === 0xd8, `${lw} × ${lh}`);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__cropChecks = verifyCrop;
