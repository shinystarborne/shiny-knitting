/**
 * Checks for the eraser, clicked through: dragged across the middle of a
 * drawn line, it leaves two lines; dragged along one, it rubs it out; a note
 * under it is left alone.
 *
 * Run with the harness open:
 *   window.__eraserChecks()
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

type Mark = { id: string; patternId: string; kind: string; geometry: string };
type Store = { annotations: Mark[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyEraser() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const page = () => document.querySelector<HTMLElement>('.reader .pdf-page[data-page="1"]')!;
  const pattern = "p1";
  const drawings = () => store.annotations.filter((a) => a.patternId === pattern && a.kind === "draw");
  const xs = (m: Mark) => (JSON.parse(m.geometry) as { x: number }[]).map((p) => p.x);

  const rub = async (from: [number, number], to: [number, number]) => {
    const box = page().getBoundingClientRect();
    const at = (f: [number, number]) => ({ clientX: box.left + box.width * f[0], clientY: box.top + box.height * f[1], pointerId: 9, button: 0, bubbles: true, cancelable: true });
    page().dispatchEvent(new PointerEvent("pointerdown", at(from)));
    for (let i = 1; i <= 12; i++) {
      scroller().dispatchEvent(new PointerEvent("pointermove", at([from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12])));
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
    for (const a of drawings()) await invoke("delete_annotation", { id: a.id });
    // A line across the page at half height, a point every hundredth.
    const line = Array.from({ length: 41 }, (_, i) => ({ x: 0.2 + i * 0.01, y: 0.5 }));
    await invoke("add_annotation", { patternId: pattern, input: { kind: "draw", page: 1, geometry: JSON.stringify(line), quote: "", occurrence: 0, color: "#e5484d", text: "" } });
    const note = await invoke<{ id: string }>("add_annotation", { patternId: pattern, input: { kind: "note", page: 1, geometry: JSON.stringify([{ x: 0.25, y: 0.3, w: 0.01, h: 0.01 }]), quote: "", occurrence: 0, color: "#e5484d", text: "Keep me" } });

    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.reader [data-mark="erase"]') && page()?.getBoundingClientRect().height > 100, "the pattern");
    await wait(300);
    (document.querySelector('.reader [data-mark="erase"]') as HTMLElement).click();
    check(results, "the Eraser is a tool of its own", scroller().classList.contains("mark-tool-erase"));

    // Across the middle, top to bottom.
    await rub([0.4, 0.44], [0.4, 0.56]);
    await waitFor(() => drawings().length === 2, "the line in two");
    const [a, b] = drawings().map(xs).sort((p, q) => p[0] - q[0]);
    check(results, "dragged across a line, it rubs out its middle and leaves two", Math.max(...a) < 0.4 && Math.min(...b) > 0.4 && Math.min(...a) === 0.2 && Math.max(...b) > 0.59, `${Math.max(...a)} / ${Math.min(...b)}`);

    // Along the right-hand piece, end to end.
    await rub([0.4, 0.5], [0.62, 0.5]);
    await waitFor(() => drawings().length === 1, "the piece rubbed out");
    check(results, "dragged along one, it rubs it out", Math.max(...xs(drawings()[0])) < 0.4);
    // Over the note.
    await rub([0.24, 0.3], [0.27, 0.31]);
    await wait(300);
    check(results, "a note under it is left alone", store.annotations.some((m) => m.id === note.id));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (const a of store.annotations.filter((m) => m.patternId === pattern && (m.kind === "draw" || m.kind === "note"))) await invoke("delete_annotation", { id: a.id }).catch(() => {});
    (document.querySelector('.reader [data-mark="none"]') as HTMLElement | null)?.click();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__eraserChecks = verifyEraser;
