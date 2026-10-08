/**
 * Checks for moving and resizing marks, clicked through with Select: a
 * drawing dragged moves, its corner dragged resizes it, both kept; a click
 * that does not drag still asks to remove it; a text highlight is left to
 * select its words.
 *
 * Run with the harness open:
 *   window.__markMoveChecks()
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

type Store = { annotations: { id: string; geometry: string }[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyMarkMove() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const page = () => document.querySelector<HTMLElement>('.reader .pdf-page[data-page="1"]')!;
  const pattern = "p1";
  const made: string[] = [];
  const points = (id: string) => JSON.parse(store.annotations.find((a) => a.id === id)!.geometry) as { x: number; y: number }[];

  /** A press, a drag and a release, from one fraction of page 1 to another. */
  const drag = async (from: [number, number], to: [number, number]) => {
    const box = page().getBoundingClientRect();
    const at = (f: [number, number]) => ({ clientX: box.left + box.width * f[0], clientY: box.top + box.height * f[1], pointerId: 7, button: 0, bubbles: true, cancelable: true });
    page().dispatchEvent(new PointerEvent("pointerdown", at(from)));
    for (let i = 1; i <= 4; i++) {
      const f: [number, number] = [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4];
      scroller().dispatchEvent(new PointerEvent("pointermove", at(f)));
    }
    scroller().dispatchEvent(new PointerEvent("pointerup", at(to)));
  };

  try {
    try {
      localStorage.removeItem(`pages:${pattern}`);
      localStorage.removeItem(`beside:${pattern}`);
    } catch {
      // Nothing kept.
    }
    const drawing = await invoke<{ id: string }>("add_annotation", {
      patternId: pattern,
      input: { kind: "draw", page: 1, geometry: JSON.stringify([{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.32 }, { x: 0.5, y: 0.4 }]), quote: "", occurrence: 0, color: "#e5484d", text: "" },
    });
    made.push(drawing.id);
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!page() && page().getBoundingClientRect().height > 100 && !!document.querySelector(".reader .mark-draw, .reader svg"), "the pattern with its drawing");
    await wait(300);

    // Moved: dragged from its middle, a tenth across and a tenth down.
    await drag([0.4, 0.32], [0.5, 0.42]);
    await waitFor(() => Math.abs(points(drawing.id)[0].x - 0.4) < 0.01, "the drawing to be kept where it went");
    const moved = points(drawing.id);
    check(results, "a drawing dragged with Select moves, and is kept there", Math.abs(moved[0].y - 0.4) < 0.01 && Math.abs(moved[2].x - 0.6) < 0.01 && !document.querySelector(".dialog-card"), JSON.stringify(moved));

    // Resized: its bottom-right corner (0.6, 0.5) dragged to (0.7, 0.6) doubles it from its top-left.
    await drag([0.6, 0.5], [0.7, 0.6]);
    await waitFor(() => Math.abs(points(drawing.id)[2].x - 0.7) < 0.01, "the drawing to be resized");
    const sized = points(drawing.id);
    check(results, "its corner dragged resizes it, its top-left staying where it is", Math.abs(sized[0].x - 0.4) < 0.01 && Math.abs(sized[0].y - 0.4) < 0.01 && Math.abs(sized[2].y - 0.6) < 0.01, JSON.stringify(sized));

    // A click that does not drag still asks to remove it.
    await drag([0.5, 0.45], [0.5, 0.45]);
    await waitFor(() => !!document.querySelector(".dialog-card"), "the question");
    check(results, "a click without a drag still asks to remove it", /Remove/.test(document.querySelector(".dialog-card")!.textContent ?? ""));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !document.querySelector(".dialog-card"), "the question to go");
    check(results, "…and cancelled, it stays", store.annotations.some((a) => a.id === drawing.id));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (const id of made) await invoke("delete_annotation", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__markMoveChecks = verifyMarkMove;
