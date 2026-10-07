/**
 * Checks for the finished gallery, clicked through: every finished project is
 * in it by itself, with its cover and log photos; one opens big with what it
 * was made of; its photos can be chosen, and it can be hidden and shown again.
 *
 * Run with the harness open:
 *   window.__galleryChecks()
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

async function waitFor(pred: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(40);
  }
}

type Store = { projects: { id: string; galleryHidden?: boolean; gallerySkip?: string[] }[] };

const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

/** A small picture's bytes, as a photo would come. */
async function picture(colour: string): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 160, 120);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

export async function verifyGallery() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const mode = (m: string) => (document.querySelector(`.projects [data-act="mode"][data-mode="${m}"]`) as HTMLElement).click();
  const tile = (id: string) => document.querySelector<HTMLElement>(`.gallery-tile[data-gallery="${id}"]`);
  const view = () => document.querySelector<HTMLElement>(".dialog-card.gallery-view");
  const made: string[] = [];

  try {
    const project = async (name: string) => {
      const p = await invoke<{ id: string }>("add_project", { input: { name, patternId: "p1", notes: "Blocked hard.", startedAt: null, toolIds: [], yarns: [] } });
      made.push(p.id);
      return p;
    };
    const hat = await project("Gallery hat");
    await invoke("set_project_cover", { projectId: hat.id, bytes: await picture("#c33") });
    const logged = async (text: string, colour?: string) => {
      const e = await invoke<{ id: string }>("add_log_entry", { projectId: hat.id, text });
      if (colour) await invoke("set_log_photo", { id: e.id, bytes: await picture(colour) });
      return e;
    };
    const crown = await logged("Crown decreases", "#3c3");
    await logged("Only words, no photo");
    const blocked = await logged("Blocked", "#33c");
    const scarf = await project("Gallery scarf");
    const socks = await project("Gallery socks, still knitting");
    for (const p of [hat, scarf]) await invoke("finish_project", { id: p.id, input: { finishedAt: Date.now(), leftovers: [] } });

    tab("projects");
    await waitFor(() => !!document.querySelector('.projects [data-mode="gallery"]'), "the projects tab");
    mode("gallery");
    await waitFor(() => !!tile(hat.id), "the gallery");
    check(results, "the Projects tab has a Gallery, with no filters and no New project", !!document.querySelector(".projects.gallery-mode") && (document.querySelector('.projects [data-act="add"]') as HTMLElement).hidden);
    check(results, "every finished project is in it by itself, not one still on the needles", !!tile(scarf.id) && !tile(socks.id));
    check(results, "a tile says when, and how many photos: its cover and its log's", /Finished .* · 3 photos/.test(tile(hat.id)!.textContent ?? ""), tile(hat.id)!.textContent ?? "");
    await waitFor(() => !!tile(hat.id)!.querySelector(".gallery-pic.filled"), "the tile's photo");
    check(results, "…shown by its photo; one with none by its pattern's cover or its letter", !/photo/.test(tile(scarf.id)!.textContent ?? ""));

    tile(hat.id)!.click();
    await waitFor(() => !!view()?.querySelector(".gallery-big img"), "the project, big");
    const thumbs = () => [...view()!.querySelectorAll<HTMLElement>(".gallery-thumb")];
    check(results, "opened, it shows its photos: the cover, then the log's newest first", thumbs().map((t) => t.dataset.photo).join() === ["cover", blocked.id, crown.id].join(), thumbs().map((t) => t.dataset.photo).join());
    const info = view()!.querySelector(".gallery-info")!.textContent ?? "";
    check(results, "…with its pattern, dates, notes and log", /Finished/.test(info) && /Blocked hard\./.test(info) && /Crown decreases/.test(info) && /Only words, no photo/.test(info) && !!view()!.querySelector('.gallery-info [data-act="pattern"]'), info);
    view()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    check(results, "the arrow keys go through the photos", thumbs()[1].classList.contains("current") && /Blocked/.test(view()!.querySelector(".gallery-caption")?.textContent ?? ""));

    (view()!.querySelector('[data-act="choose"]') as HTMLElement).click();
    check(results, "Choose photos ticks what the gallery shows", thumbs().every((t) => t.getAttribute("aria-pressed") === "true"));
    thumbs()[0].click();
    await waitFor(() => !!store.projects.find((p) => p.id === hat.id)?.gallerySkip?.includes("cover") && thumbs()[0]?.getAttribute("aria-pressed") === "false", "the cover to be left out");
    check(results, "…one clicked is left out", thumbs()[0].getAttribute("aria-pressed") === "false" && thumbs().length === 3);
    (view()!.querySelector('[data-act="choose"]') as HTMLElement).click();
    await waitFor(() => /2 photos/.test(tile(hat.id)?.textContent ?? ""), "the tile's count");
    check(results, "done choosing, it shows only those kept", thumbs().length === 2 && !thumbs().some((t) => t.dataset.photo === "cover"));
    check(results, "…and the tile counts them", /2 photos/.test(tile(hat.id)!.textContent ?? ""), tile(hat.id)!.textContent ?? "");

    (view()!.querySelector('[data-act="hide"]') as HTMLElement).click();
    await waitFor(() => !!store.projects.find((p) => p.id === hat.id)?.galleryHidden, "the project to be hidden");
    (view()!.querySelector('[data-act="close"]') as HTMLElement).click();
    await waitFor(() => !view() && !tile(hat.id), "the tile to go");
    const toggle = document.querySelector<HTMLElement>('.projects [data-act="show-hidden"]')!;
    check(results, "hidden, it leaves the gallery, and Show hidden says how many", !toggle.hidden && /Show hidden \(1\)/.test(toggle.textContent ?? ""), toggle.textContent ?? "");
    toggle.click();
    await waitFor(() => !!tile(hat.id), "the hidden tile");
    check(results, "…shown again, marked Hidden", !!tile(hat.id)!.querySelector(".gallery-hidden-pill"));
    tile(hat.id)!.click();
    await waitFor(() => !!view(), "the project again");
    (view()!.querySelector('[data-act="hide"]') as HTMLElement).click();
    await waitFor(() => store.projects.find((p) => p.id === hat.id)?.galleryHidden === false && !tile(hat.id)?.querySelector(".gallery-hidden-pill"), "the project to be shown");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !view(), "Escape to close it");
    check(results, "Show in the gallery brings it back; Escape closes", !tile(hat.id)!.querySelector(".gallery-hidden-pill"));
    toggle.click();
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    for (let i = 0; i < 3 && document.querySelector(".dialog-card"); i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (const id of made) await invoke("delete_project", { id }).catch(() => {});
    document.querySelector<HTMLElement>('.projects [data-act="mode"][data-mode="projects"]')?.click();
    tab("patterns");
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__galleryChecks = verifyGallery;
