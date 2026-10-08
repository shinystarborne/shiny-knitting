/**
 * Checks for bringing a pin to the front, clicked through: pressed, a pin
 * under another comes on top, and stays there when the pattern is opened
 * again; shown again from its chip, it comes on top too.
 *
 * Run with the harness open:
 *   window.__pinFrontChecks()
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

type Store = { pins: { id: string; z: number; hidden: boolean }[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

export async function verifyPinFront() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const card = (id: string) => document.querySelector<HTMLElement>(`.reader .pin-card[data-id="${id}"]`);
  const z = (id: string) => Number(card(id)?.style.zIndex ?? 0);
  const pattern = "p1";
  const made: string[] = [];

  const open = async () => {
    tab("projects");
    tab("patterns");
    await waitFor(() => !!document.querySelector(`.library [data-open="${pattern}"]`), "the library");
    (document.querySelector(`.library [data-open="${pattern}"]`) as HTMLElement).click();
    await waitFor(() => made.every((id) => !!card(id)), "the pins");
  };

  try {
    const pin = async (title: string) => {
      const p = await invoke<{ id: string }>("add_pin", {
        patternId: pattern,
        input: { page: 1, geometry: JSON.stringify([{ x: 0.1, y: 0.1, w: 0.5, h: 0.2 }]), quote: "", title, imageBytes: [1, 2, 3], imageMime: "image/jpeg" },
      });
      made.push(p.id);
      return p.id;
    };
    const under = await pin("Chart");
    const over = await pin("Key");
    await open();
    check(results, "a newer pin starts on top", z(over) > z(under), `${z(under)} / ${z(over)}`);

    card(under)!.querySelector(".pin-canvas-wrap")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    await waitFor(() => z(under) > z(over), "the pressed pin to come up");
    await waitFor(() => store.pins.find((p) => p.id === under)!.z > store.pins.find((p) => p.id === over)!.z, "it to be kept");
    check(results, "pressed, a pin under another comes to the front", true);

    await open();
    check(results, "…and is still on top when the pattern is opened again", z(under) > z(over), `${z(under)} / ${z(over)}`);

    // Hidden, then shown again from its chip: on top.
    (card(over)!.querySelector('button[title="Hide"]') as HTMLElement).click();
    await waitFor(() => !card(over), "the pin to hide");
    const chip = [...document.querySelectorAll<HTMLElement>(".reader .pin-chip")].find((c) => /Key/.test(c.title))!;
    chip.click();
    await waitFor(() => !!card(over) && z(over) > z(under), "the shown pin on top");
    await waitFor(() => store.pins.find((p) => p.id === over)!.z > store.pins.find((p) => p.id === under)!.z, "it to be kept");
    check(results, "shown again from its chip, a pin comes to the front", store.pins.find((p) => p.id === over)!.z > store.pins.find((p) => p.id === under)!.z);
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (const id of made) await invoke("delete_pin", { id }).catch(() => {});
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__pinFrontChecks = verifyPinFront;
