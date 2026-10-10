/**
 * Checks for the highlight line's direction, on the pattern beside a
 * project's board, where the line and the counter are: counting a row steps
 * the line down the page for written instructions, and up it for a chart,
 * which is read from the bottom row up.
 *
 * Run with the harness open:
 *   window.__chartLineChecks()
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

type Highlight = { enabled: boolean; readsUp?: boolean; thickness: number; offsetY: number; animate: boolean };

export async function verifyChartLine() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: { highlights: Map<string, Highlight> } }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const line = () => document.querySelector<HTMLElement>(".project-page .highlight-line");
  const top = () => parseFloat(line()?.style.top || "0");
  const scroller = () => document.querySelector<HTMLElement>(".project-page .doc-scroller")!;
  const press = () => scroller().dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true, cancelable: true }));
  const pattern = "p1";
  const saved = { ...store.highlights.get(pattern)! };
  let projectId = "";

  const open = async (readsUp: boolean) => {
    // Halfway down, a 20 px row, no animation: one press is one clear step either way.
    store.highlights.set(pattern, { ...saved, enabled: true, readsUp, thickness: 20, offsetY: 0.5, animate: false });
    tab("patterns");
    tab("projects");
    await waitFor(() => !!document.querySelector(`.projects .project-card[data-open="${projectId}"]`), "the projects");
    (document.querySelector(`.projects .project-card[data-open="${projectId}"]`) as HTMLElement).click();
    await waitFor(() => !!line() && top() > 0 && !!document.querySelector(".project-page .project-counter"), "the line beside the board");
    await wait(300);
  };

  try {
    projectId = (await invoke<{ id: string }>("add_project", { input: { name: "Chart jumper", patternId: pattern, notes: "", startedAt: null, toolIds: [], yarns: [] } })).id;
    await open(false);
    const before = top();
    press();
    await waitFor(() => top() !== before, "the line to move");
    check(results, "for written instructions, counting a row steps the line down the page", top() > before, `${before} → ${top()}`);

    await open(true);
    const start = top();
    press();
    await waitFor(() => top() !== start, "the line to move");
    check(results, "for a chart, counting a row steps the line up the page, as a chart is read", top() < start, `${start} → ${top()}`);
    const panelBox = () => document.querySelector<HTMLInputElement>('.project-page [data-f="readsUp"]');
    check(results, "the line's settings say so: Rows go up the page (a chart)", !panelBox() || panelBox()!.checked, "the box is unticked");

    // Every count moves it, whatever counted: the counter's own + and −, its keys.
    const counterBtn = (act: string) => document.querySelector<HTMLElement>(`.project-page .project-counter [data-act="${act}"]`)!;
    const total = () => document.querySelector(".project-page .project-counter [data-el=\"total\"]")?.textContent ?? "";
    await open(false);
    let at = top();
    let count = total();
    counterBtn("total-inc").click();
    await waitFor(() => top() !== at, "the line to move with +");
    check(results, "the counter's + moves the line a row, as the count key does", top() > at && total() !== count, `${at} → ${top()}`);
    at = top();
    counterBtn("total-dec").click();
    await waitFor(() => top() !== at, "the line to move back with −");
    check(results, "…its − moves it back", top() < at, `${at} → ${top()}`);
    at = top();
    count = total();
    scroller().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    await waitFor(() => total() !== count, "the arrow to count");
    await wait(100);
    check(results, "…the arrow key that counts moves it too", top() > at, `${at} → ${top()}`);
    at = top();
    count = total();
    scroller().dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "J", shiftKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => total() !== count, "Shift+J to count");
    await wait(150);
    check(results, "…Shift with the count key counts without moving it", top() === at, `${at} → ${top()}`);
    count = total();
    scroller().dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", altKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => top() !== at, "Alt+J to move the line");
    await wait(150);
    check(results, "…Alt with it moves it without counting", total() === count, `${count} → ${total()}`);

    // A click in the pattern is the pattern's: the line stays on its row.
    at = top();
    const sr = scroller().getBoundingClientRect();
    scroller().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: sr.left + 50, clientY: sr.top + 30 }));
    await wait(100);
    check(results, "a click in the pattern leaves the line where it is", top() === at, `${at} → ${top()}`);
    // The grip, clicked, readies it: then a click puts it there.
    const grip = document.querySelector<HTMLElement>(".project-page .highlight-grip")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, clientY: 10 }));
    grip.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, clientY: 10 }));
    check(results, "…a click on its grip readies it", !!document.querySelector(".project-page .highlight-line.ready"));
    scroller().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: sr.left + 50, clientY: sr.top + 30 }));
    await wait(100);
    check(results, "…and the next click in the pattern puts it there, once", Math.abs(top() - 30) <= 1 && !document.querySelector(".project-page .highlight-line.ready"), `${top()}`);

    // Put away and shown again, the pattern is where the knitting is: the same spot under the line.
    for (let i = 0; i < 12; i++) counterBtn("total-inc").click();
    await wait(600);
    const spot = scroller().scrollTop + top();
    document.querySelector<HTMLElement>('.project-page [data-pane="close"]')!.click();
    await waitFor(() => !document.querySelector(".project-page .doc-scroller"), "the pattern put away");
    document.querySelector<HTMLElement>('.project-page [data-act="show-pattern"]')!.click();
    await waitFor(() => !!line() && !!document.querySelector(".project-page .doc-scroller"), "the pattern again");
    await wait(1200);
    const back = scroller().scrollTop + top();
    check(results, "hidden and shown again, the pattern is back where the line was on it", Math.abs(back - spot) <= 3, `${spot} → ${back}`);

    // The sound: a few to choose from, the choice kept.
    const pick = document.querySelector<HTMLSelectElement>('.project-page .project-counter [data-el="sound-pick"]')!;
    const options = [...pick.options].map((o) => o.value).join(",");
    const soundBefore = localStorage.getItem("shiny.knitting.counterSoundKind");
    pick.value = "wood";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    check(results, "the counter's sounds: Shelfmind's clicker first, and others to choose, the choice kept", options === "clicker,soft,wood,tick" && localStorage.getItem("shiny.knitting.counterSoundKind") === "wood", options);
    if (soundBefore === null) localStorage.removeItem("shiny.knitting.counterSoundKind");
    else localStorage.setItem("shiny.knitting.counterSoundKind", soundBefore);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    store.highlights.set(pattern, saved);
    if (projectId) await invoke("delete_project", { id: projectId }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__chartLineChecks = verifyChartLine;
