/**
 * Checks for typed text on the page, clicked through: the Text tool puts
 * words where the page was clicked, in the mark colour, over more than one
 * line; clicked with Select they can be changed, and cleared they are gone.
 *
 * Run with the harness open:
 *   window.__textMarkChecks()
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

type Mark = { id: string; patternId: string; kind: string; geometry: string; text: string };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyTextMarks() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { annotations: Mark[] } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const scroller = () => document.querySelector<HTMLElement>(".reader .doc-scroller")!;
  const page = () => document.querySelector<HTMLElement>('.reader .pdf-page[data-page="1"]')!;
  const dialog = () => document.querySelector<HTMLElement>(".dialog-card");
  const pattern = "p1";
  const texts = () => store.annotations.filter((a) => a.patternId === pattern && a.kind === "text");
  const click = (f: [number, number]) => {
    const box = page().getBoundingClientRect();
    const at = { clientX: box.left + box.width * f[0], clientY: box.top + box.height * f[1], pointerId: 11, button: 0, bubbles: true, cancelable: true };
    page().dispatchEvent(new PointerEvent("pointerdown", at));
    scroller().dispatchEvent(new PointerEvent("pointerup", at));
  };

  try {
    try {
      localStorage.removeItem(`pages:${pattern}`);
      localStorage.removeItem(`beside:${pattern}`);
    } catch {
      // Nothing kept.
    }
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => !!document.querySelector('.reader [data-mark="text"]') && page()?.getBoundingClientRect().height > 100, "the pattern");
    await wait(300);

    (document.querySelector('.reader [data-mark="text"]') as HTMLElement).click();
    click([0.5, 0.6]);
    await waitFor(() => !!dialog()?.querySelector("textarea"), "the text box");
    const box = dialog()!.querySelector("textarea")!;
    box.value = "Row 12:\nk2tog twice";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    check(results, "Enter in the text box starts a new line, not puts it there", !!dialog());
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => texts().length === 1 && !dialog(), "the text on the page");
    const shown = () => document.querySelector<HTMLElement>(`.reader .mark-text[data-id="${texts()[0].id}"]`);
    await waitFor(() => !!shown(), "the words drawn");
    const rect = JSON.parse(texts()[0].geometry)[0];
    check(results, "the Text tool puts words where the page was clicked", Math.abs(rect.x - 0.5) < 0.01 && Math.abs(rect.y - 0.6) < 0.01 && shown()!.textContent === "Row 12:\nk2tog twice", JSON.stringify(rect));
    check(results, "…two lines, in the mark colour", Math.abs(rect.h - 0.036) < 0.001 && shown()!.style.color !== "", `${rect.h}`);

    // Changed, with Select.
    (document.querySelector('.reader [data-mark="none"]') as HTMLElement).click();
    click([rect.x + 0.01, rect.y + 0.01]);
    await waitFor(() => !!dialog()?.querySelector("textarea"), "the text to change");
    check(results, "clicked with Select, the text opens to change", dialog()!.querySelector("textarea")!.value === "Row 12:\nk2tog twice");
    dialog()!.querySelector("textarea")!.value = "Row 14";
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await waitFor(() => texts()[0]?.text === "Row 14", "the change");
    check(results, "…and changed, one line now, its letters the same size", Math.abs(JSON.parse(texts()[0].geometry)[0].h - 0.018) < 0.001);

    // Cleared, it is gone.
    click([rect.x + 0.01, rect.y + 0.008]);
    await waitFor(() => !!dialog()?.querySelector("textarea"), "the text again");
    dialog()!.querySelector("textarea")!.value = "";
    (dialog()!.querySelector("button.primary") as HTMLElement).click();
    await waitFor(() => texts().length === 0, "the text removed");
    check(results, "cleared, it is gone", !document.querySelector(".reader .mark-text"));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && dialog(); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (const t of texts()) await invoke("delete_annotation", { id: t.id }).catch(() => {});
    (document.querySelector('.reader [data-mark="none"]') as HTMLElement | null)?.click();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__textMarkChecks = verifyTextMarks;
