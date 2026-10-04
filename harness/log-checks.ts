/**
 * Checks for a project's log: the Board | Log switch, writing entries with
 * and without photos, changing and removing them, the milestones the project
 * writes, and pastes going where they belong.
 *
 * Run with the harness open:
 *   window.__logChecks()
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

type Store = {
  projectLog: { id: string; projectId: string; at: number; text: string; milestone: boolean; photoPath: string }[];
  boardItems: { boardId: string }[];
  patterns: { id: string; title: string }[];
  covers: Map<string, unknown>;
};

const invoke = <T>(cmd: string, args: unknown) =>
  (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<T> } }).__TAURI_INTERNALS__.invoke(cmd, args);

async function picture(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 30;
  canvas.getContext("2d")!.fillRect(0, 0, 30, 30);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "progress.png", { type: "image/png" });
}

export async function verifyLog() {
  const results: CheckResult[] = [];
  const store = (window as unknown as { __store: Store }).__store;
  const tab = (name: string) => (document.querySelector(`.tab-bar [data-tab="${name}"]`) as HTMLElement).click();
  const page = () => document.querySelector<HTMLElement>(".project-page");
  const log = () => page()?.querySelector<HTMLElement>(".project-log") ?? null;
  const entries = () => [...(log()?.querySelectorAll<HTMLElement>(".log-entry") ?? [])];
  const texts = () => entries().map((e) => (e.querySelector(".log-milestone") ?? e.querySelector(".log-text"))?.textContent ?? (e.querySelector(".log-photo") ? "(photo)" : ""));
  const view = (v: string) => (page()!.querySelector(`[data-view="${v}"]`) as HTMLElement).click();
  const act = (name: string, within: Element | null = log()) => (within!.querySelector(`[data-act="${name}"]`) as HTMLElement).click();
  const mine = (projectId: string) => store.projectLog.filter((e) => e.projectId === projectId);
  const open = async (id: string) => {
    document.querySelector(".screen")!.dispatchEvent(new CustomEvent("open-project-page", { bubbles: true, detail: id }));
    await waitFor(() => !!page()?.querySelector(".project-view-switch") && !!page()?.querySelector(".board"), "the project page");
  };

  try {
    const project = await invoke<{ id: string }>("add_project", { input: { name: "Log test sweater", startedAt: Date.now() - 1000 } });
    await open(project.id);
    check(results, "a project's page shows its board, with a switch to its log", !page()!.querySelector<HTMLElement>(".project-board")!.hidden && log()!.hidden && !!page()!.querySelector('[data-view="board"].on'));
    view("log");
    await waitFor(() => !!log() && !log()!.hidden && entries().length > 0, "the log");
    check(results, "the log begins where the project did", texts().join("|") === "Started" && /Today/.test(log()!.querySelector(".log-day h3")?.textContent ?? ""), texts().join("|"));
    check(results, "the board is hidden behind it", page()!.querySelector<HTMLElement>(".project-board")!.hidden);

    // Writing: Ctrl+Enter adds it, dated now.
    const area = log()!.querySelector<HTMLTextAreaElement>('[data-f="text"]')!;
    area.value = "Changed the decreases to every 4th round. Stopped at round 40.";
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await waitFor(() => entries().length === 2, "the entry");
    check(results, "what is typed goes in, newest first", texts()[0] === "Changed the decreases to every 4th round. Stopped at round 40." && area.value === "", texts().join("|"));
    const typed = mine(project.id).find((e) => !e.milestone)!;
    check(results, "…dated now, not a milestone", Math.abs(typed.at - Date.now()) < 60000 && !typed.milestone);

    // A photo, pasted: into the log, not onto the hidden board.
    const boardBefore = store.boardItems.filter((b) => b.boardId === project.id).length;
    const dt = new DataTransfer();
    dt.items.add(await picture());
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await waitFor(() => !!log()!.querySelector('[data-el="compose-photo"].filled'), "the pasted photo");
    await wait(200);
    check(results, "a picture pasted goes to the log, not the board behind it", store.boardItems.filter((b) => b.boardId === project.id).length === boardBefore);
    act("add");
    await waitFor(() => entries().length === 3, "the photo entry");
    const withPhoto = mine(project.id).find((e) => e.photoPath)!;
    check(results, "a photo can be an entry on its own", !!withPhoto && withPhoto.text === "" && store.covers.has(`log:${withPhoto.id}`));
    await waitFor(() => !!log()!.querySelector<HTMLImageElement>(".log-photo")?.src, "the photo shown");
    const img = log()!.querySelector<HTMLImageElement>(".log-photo")!;
    img.click();
    check(results, "a photo shows bigger when clicked", img.classList.contains("big"));
    check(results, "nothing is added with nothing given", (act("add"), true) && entries().length === 3);

    // Changing an entry: its words and its day.
    const typedEl = entries().find((e) => e.dataset.id === typed.id)!;
    act("edit", typedEl);
    await waitFor(() => !!log()!.querySelector('[data-f="edit-text"]'), "the editor");
    const editor = log()!.querySelector<HTMLTextAreaElement>('[data-f="edit-text"]')!;
    editor.value = "Decreases every 3rd round after all.";
    const yesterday = new Date(Date.now() - 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    log()!.querySelector<HTMLInputElement>('[data-f="edit-at"]')!.value = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T20:15`;
    act("save-edit");
    await waitFor(() => !log()!.querySelector('[data-f="edit-text"]'), "the save");
    const saved = mine(project.id).find((e) => e.id === typed.id)!;
    check(results, "an entry's words and time can be changed", saved.text === "Decreases every 3rd round after all." && new Date(saved.at).getHours() === 20);
    const days = [...log()!.querySelectorAll(".log-day h3")].map((h) => h.textContent);
    check(results, "…and it moves to its day", days.includes("Yesterday"), days.join("|"));

    // Milestones from the project itself.
    const side = () => page()!.querySelector<HTMLElement>(".project-side")!;
    const setSide = async (f: string, v: string) => {
      const el = side().querySelector<HTMLSelectElement>(`[data-f="${f}"]`)!;
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await setSide("status", "paused");
    await waitFor(() => texts()[0] === "Paused", "the Paused milestone");
    check(results, "pausing writes a milestone", true);
    await setSide("status", "active");
    await waitFor(() => texts()[0] === "Back on the needles", "the next milestone");
    check(results, "…and picking it up again", true);
    const pattern = store.patterns[0];
    await setSide("pattern", pattern.id);
    await waitFor(() => texts()[0] === `Pattern: ${pattern.title}`, "the pattern milestone");
    check(results, "choosing a pattern writes it in the log", true);
    check(results, "milestones look like milestones", entries()[0].classList.contains("milestone"));

    // Removing.
    const before = entries().length;
    act("remove", entries()[0]);
    await waitFor(() => !!document.querySelector(".dialog-card"), "the confirm");
    check(results, "removing asks, naming a milestone", /Pattern: /.test(document.querySelector(".dialog-card .dialog-message")?.textContent ?? ""));
    [...document.querySelectorAll<HTMLButtonElement>(".dialog-card button")].find((b) => b.textContent === "Remove")!.click();
    await waitFor(() => entries().length === before - 1, "the removal");
    check(results, "an entry can be removed", !mine(project.id).some((e) => e.text.startsWith("Pattern: ")));

    // The page remembers it was showing the log.
    tab("projects");
    await waitFor(() => !page(), "the projects");
    await open(project.id);
    check(results, "the page comes back showing the log", !log()!.hidden && !!page()!.querySelector('[data-view="log"].on'));
    view("board");
    check(results, "the board comes back", !page()!.querySelector<HTMLElement>(".project-board")!.hidden && log()!.hidden);

    await invoke("delete_project", { id: project.id });
    check(results, "a removed project takes its log and photos", mine(project.id).length === 0 && !store.covers.has(`log:${withPhoto.id}`));
  } catch (err) {
    check(results, "the suite ran to completion", false, String((err as Error)?.message ?? err));
  } finally {
    document.querySelector<HTMLElement>(".dialog-card button.ghost")?.click();
    tab("patterns");
    await waitFor(() => !page(), "the library", 5000).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`) };
}

(window as unknown as Record<string, unknown>).__logChecks = verifyLog;
