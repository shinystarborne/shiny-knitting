import { api, type Counter, type CountKeys, type CountOutcome, type Progress } from "../api";
import { rowsCounted } from "../auto-timer";
import { askForm, say } from "../dialogs";
import { closestEl } from "../dom";
import { CLICK_SOUNDS, clickSound, isClickMuted, playClick, setClickMuted, setClickSound, type ClickSound } from "./click";
import { captureKey, isPlainPress, keyLabel } from "./keys";

/**
 * The row counter.
 *
 * One project total, which always counts, plus any number of named counters
 * that can be switched on individually.
 *
 * The distinction matters and is the whole design here. The total is the single
 * running figure for the project and moves on every counting action, always.
 * A counter is a named place that also moves when it is enabled -- a front, a
 * sleeve, a collar, a lace repeat. Several can be enabled at once, so working
 * two sleeves alternately advances both from the same rows. Counters never
 * affect each other; each has its own count and its own target.
 *
 * Large + and - buttons are deliberate: they get clicked one-handed, without
 * aiming, while the eyes stay on the needles. The keyboard mirrors them, Shift
 * for larger steps, and a click sound confirms the press registered.
 */
export class RowCounter {
  private root: HTMLElement;
  private patternId: string;
  /** The project it counts for; null for the pattern's own counter. */
  private projectId: string | null;

  private counters: Counter[] = [];
  private progress: Progress | null = null;
  /** The count up / count down keys, shared by every pattern. */
  private keys: CountKeys = { up: "KeyJ", down: "KeyK" };

  // Element references, kept to avoid re-querying on every render.
  private totalValue!: HTMLElement;
  private counterList!: HTMLElement;
  private soundButton!: HTMLButtonElement;
  /**
   * Told of every row counted on the total -- by its buttons, the arrow and
   * +/- keys, or the row keys -- so the reader beside it steps its line by as
   * many rows. A counter's own buttons are a nudge, and do not tell it.
   */
  onRowsCounted: ((delta: number) => void) | null = null;

  constructor(root: HTMLElement, patternId: string, projectId: string | null = null) {
    this.root = root;
    this.patternId = patternId;
    this.projectId = projectId;
    this.build();
  }

  private build(): void {
    // Add to the host's classes rather than replacing them, so the container's
    // own class (e.g. "counter-slot") stays intact.
    this.root.classList.add("counter");
    this.root.innerHTML = `
      <div class="counter-head">
        <h3>Row counter</h3>
        <button class="ghost counter-sound counter-setting" data-act="sound" title="Counting sound">♪</button>
        <button class="ghost counter-gear" data-act="settings" title="Settings: sound, keys, ±10, Reset, and counters" aria-label="Counter settings" aria-pressed="false">⚙</button>
      </div>
      <div class="counter-body">
        <div class="counter-total">
          <label>Project total</label>
          <div class="stepper big">
            <button data-act="total-dec" title="Subtract 1">−</button>
            <span class="value" data-el="total">0</span>
            <button data-act="total-inc" title="Add 1">+</button>
          </div>
          <div class="quick counter-setting">
            <button data-act="total-dec10" title="Subtract 10">−10</button>
            <button data-act="total-inc10" title="Add 10">+10</button>
            <button data-act="total-reset" title="Reset to zero">Reset</button>
          </div>
          <p class="hint counter-setting">
            Counts every row, along with every counter that is on.
          </p>
        </div>

        <div class="counter-counters">
          <label>Counters</label>
          <ul data-el="counterlist" class="counter-list"></ul>
          <button class="ghost counter-setting" data-act="add-counter">+ Add counter</button>
          <p class="hint counter-setting">
            The dot turns a counter on or off. An off counter keeps its count but
            stops counting. Several can be on at once.
          </p>
        </div>

        <div class="counter-keys counter-setting">
          <label>Keys</label>
          <div class="key-row">
            <span>Count up</span>
            <button class="key-chip" data-act="key-up" title="Choose the key that counts a row"></button>
          </div>
          <div class="key-row">
            <span>Count down</span>
            <button class="key-chip" data-act="key-down" title="Choose the key that counts a row back"></button>
          </div>
          <div class="key-row">
            <span>Sound</span>
            <select class="counter-sound-pick" data-el="sound-pick" title="Sound for each count (plays when chosen)">
              ${CLICK_SOUNDS.map((s) => `<option value="${s.key}" ${s.key === clickSound() ? "selected" : ""}>${s.label}</option>`).join("")}
            </select>
          </div>
          <p class="hint">
            These keys count the total and every counter that is on, and move the
            highlight line. Shift counts without moving the line; Alt moves it
            without counting. A counter can have its own key (its <em>Key</em>
            button): the key works like its + button, and Shift with it like −.
          </p>
        </div>
      </div>
    `;

    this.totalValue = this.q('[data-el="total"]');
    this.counterList = this.q('[data-el="counterlist"]');
    this.soundButton = this.q('[data-act="sound"]');
    this.paintSoundButton();

    this.root.addEventListener("click", (e) => this.onClick(e));
    // A sound picked is heard at once, and switched on if it was off.
    this.q<HTMLSelectElement>('[data-el="sound-pick"]').addEventListener("change", (e) => {
      setClickSound((e.target as HTMLSelectElement).value as ClickSound);
      if (isClickMuted()) {
        setClickMuted(false);
        this.paintSoundButton();
      }
      playClick();
    });
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private paintSoundButton(): void {
    const muted = isClickMuted();
    this.soundButton.textContent = muted ? "♪̸" : "♪";
    this.soundButton.classList.toggle("off", muted);
    this.soundButton.title = muted
      ? "Counting sound is off. Click to turn it on."
      : "Counting sound is on. Click to turn it off.";
  }

  private async onClick(e: MouseEvent): Promise<void> {
    const btn = closestEl(e.target, "button[data-act]");
    if (!btn) return;
    try {
      await this.dispatch(btn, btn.dataset.act, btn.dataset.id, e.shiftKey);
    } catch (err) {
      // A rejected command must not surface as an unhandled rejection; the
      // panel simply keeps showing the state it already has.
      console.error("Counter action failed:", err);
    }
  }

  private async dispatch(
    btn: HTMLElement,
    act: string | undefined,
    id: string | undefined,
    shift: boolean,
  ): Promise<void> {
    const step = shift ? 10 : 1;

    switch (act) {
      case "total-inc":
        await this.count(step);
        break;
      case "total-dec":
        await this.count(-step);
        break;
      case "total-inc10":
        await this.count(10);
        break;
      case "total-dec10":
        await this.count(-10);
        break;
      case "total-reset":
        await api.setTotalRows(this.patternId, this.projectId, 0);
        await this.refresh();
        break;

      // A counter's own buttons. These move that counter alone, which is how
      // one is nudged or checked against the pattern without counting a
      // project row.
      case "c-inc":
        if (id) await this.countOne(id, step);
        break;
      case "c-dec":
        if (id) await this.countOne(id, -step);
        break;
      case "c-toggle":
        if (id) await this.toggle(id);
        break;
      case "c-reset":
        if (id) {
          await api.resetCounter(id);
          await this.refresh();
        }
        break;
      case "c-edit":
        if (id) await this.editCounter(id);
        break;
      case "c-del":
        if (id) {
          await api.deleteCounter(id);
          await this.refresh();
        }
        break;
      case "add-counter":
        await this.promptCounter();
        break;
      case "key-up":
        await this.chooseCountKey("up");
        break;
      case "key-down":
        await this.chooseCountKey("down");
        break;
      case "c-key":
        if (id) await this.chooseCounterKey(id);
        break;

      case "sound":
        setClickMuted(!isClickMuted());
        this.paintSoundButton();
        // Give the turned-on state something to prove itself with.
        if (!isClickMuted()) playClick();
        break;

      case "settings": {
        // Only the counts, until the gear: the rest is set up once and left.
        const open = this.root.classList.toggle("settings-open");
        btn.setAttribute("aria-pressed", String(open));
        btn.classList.toggle("on", open);
        break;
      }
    }
  }

  /**
   * One counting action: the project total, plus every enabled counter.
   *
   * The click is played here rather than on the keypress so that it follows
   * the count actually landing, and only when one did.
   */
  private async count(delta: number, moveLine = true): Promise<void> {
    const outcome = await api.countRows(this.patternId, this.projectId, delta);
    playClick(delta < 0);
    this.apply(outcome);
    // The timer hears it: a project's card may keep the timer by the counter.
    if (this.projectId) rowsCounted(this.projectId, delta);
    if (moveLine) this.onRowsCounted?.(delta);
  }

  private async countOne(id: string, delta: number): Promise<void> {
    const outcome = await api.countCounter(id, delta);
    playClick(delta < 0);
    this.apply(outcome);
    if (this.projectId) rowsCounted(this.projectId, delta);
  }

  private async toggle(id: string): Promise<void> {
    const current = this.counters.find((c) => c.id === id);
    if (!current) return;
    const outcome = await api.setCounterEnabled(this.patternId, this.projectId, id, !current.enabled);
    this.apply(outcome);
  }

  /**
   * The one counting action the keyboard drives.
   *
   * Public because the highlight line's row keys call it: stepping the line
   * along a schematic and counting the row are the same action, and going
   * through here keeps the on-screen numbers, the database and the saved
   * progress from ever disagreeing.
   */
  async countRows(delta: number, moveLine = true): Promise<void> {
    try {
      await this.count(delta, moveLine);
    } catch (err) {
      // Called fire-and-forget from the row keys, so a rejection here would
      // otherwise be an unhandled promise rejection.
      console.error("Counting failed:", err);
    }
  }

  private apply(outcome: CountOutcome): void {
    this.counters = outcome.counters;
    if (this.progress) this.progress.totalRows = outcome.totalRows;
    this.render();
  }

  private async promptCounter(): Promise<void> {
    const answer = await askForm(
      [
        { label: "Name", placeholder: 'Front, Sleeve, Lace repeat…' },
        { label: "Rows", value: "0", type: "number", placeholder: "0 for no target" },
      ],
      { title: "Add a counter", okLabel: "Add" },
    );
    if (!answer) return;
    const target = Math.max(0, parseInt(answer["Rows"], 10) || 0);

    const created = await api.addCounter(this.patternId, this.projectId, {
      name: (answer["Name"] ?? "").trim() || "Counter",
      target,
      // New counters start switched on: someone who has just named the part
      // they are working is almost certainly working it.
      enabled: true,
      excludedFromTotal: false,
    });
    await this.refresh();
    // Nudge the new row into view so it is visible where it landed.
    this.counterList
      .querySelector(`[data-id="${created.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  private async editCounter(id: string): Promise<void> {
    const current = this.counters.find((c) => c.id === id);
    if (!current) return;
    const answer = await askForm(
      [
        { label: "Name", value: current.name },
        { label: "Rows", value: String(current.target), type: "number" },
      ],
      {
        title: "Edit counter",
        checkbox: {
          label: "Don't change the project total with this counter's own buttons",
          checked: current.excludedFromTotal,
          hint:
            "For setup rows and other counts outside the pattern's main row total. " +
            "Counting rows normally still changes the total.",
        },
      },
    );
    if (!answer) return;
    const target = Math.max(0, parseInt(answer["Rows"], 10) || 0);
    const excluded = answer["Don't change the project total with this counter's own buttons"] === "yes";
    await api.updateCounter(id, (answer["Name"] ?? "").trim() || "Counter", target, excluded);
    await this.refresh();
  }

  /** Loads counters, progress and keys, then paints. */
  async refresh(): Promise<void> {
    const [counters, progress, keys] = await Promise.all([
      api.listCounters(this.patternId, this.projectId),
      api.getProgress(this.patternId, this.projectId),
      api.getCountKeys(),
    ]);
    this.counters = counters;
    this.progress = progress;
    this.keys = keys;
    this.render();
  }

  /** The count up / count down keys, for the reader's row keys. */
  get countKeys(): CountKeys {
    return this.keys;
  }

  /**
   * What a key is already used for, if anything, so one key never does two
   * things. `except` is the thing being given the key, which may keep it.
   */
  private keyOwner(code: string, except: string): string | null {
    if (except !== "up" && this.keys.up === code) return "Count up";
    if (except !== "down" && this.keys.down === code) return "Count down";
    const counter = this.counters.find((c) => c.hotkey === code && c.id !== except);
    return counter ? `the “${counter.name}” counter` : null;
  }

  private async chooseCountKey(which: "up" | "down"): Promise<void> {
    const title = which === "up" ? "Count up key" : "Count down key";
    const code = await captureKey(title, this.keys[which]);
    if (code === null || code === this.keys[which]) return;
    if (code === "") {
      // Counting must always have both keys; Clear here puts back the default.
      await this.saveCountKey(which, which === "up" ? "KeyJ" : "KeyK");
      return;
    }
    const owner = this.keyOwner(code, which);
    if (owner) {
      await say(`${keyLabel(code)} is already the key for ${owner}.`, title);
      return;
    }
    await this.saveCountKey(which, code);
  }

  private async saveCountKey(which: "up" | "down", code: string): Promise<void> {
    const next = { ...this.keys, [which]: code };
    try {
      this.keys = await api.saveCountKeys(next);
    } catch (e) {
      await say(e instanceof Error ? e.message : String(e), "Keys");
    }
    this.render();
  }

  private async chooseCounterKey(id: string): Promise<void> {
    const counter = this.counters.find((c) => c.id === id);
    if (!counter) return;
    const code = await captureKey(`Key for “${counter.name}”`, counter.hotkey);
    if (code === null || code === counter.hotkey) return;
    if (code) {
      const owner = this.keyOwner(code, id);
      if (owner) {
        await say(`${keyLabel(code)} is already the key for ${owner}.`, "Counter key");
        return;
      }
    }
    await api.setCounterKey(id, code);
    counter.hotkey = code;
    this.render();
  }

  /** The rows counted on the total. */
  get totalRows(): number {
    return this.progress?.totalRows ?? 0;
  }

  private render(): void {
    if (!this.progress) return;
    this.totalValue.textContent = String(this.progress.totalRows);
    // For what follows the count on the page around it: a chart's marked row.
    this.root.dispatchEvent(new CustomEvent("counter-total", { bubbles: true, detail: this.progress.totalRows }));
    this.q('[data-act="key-up"]').textContent = keyLabel(this.keys.up);
    this.q('[data-act="key-down"]').textContent = keyLabel(this.keys.down);

    if (!this.counters.length) {
      this.counterList.innerHTML =
        '<li class="counter-empty">No counters yet. ⚙ adds one for each part counted separately.</li>';
      return;
    }

    this.counterList.innerHTML = this.counters
      .map((c) => {
        const target = c.target > 0 ? ` / ${c.target}` : "";
        const done = c.target > 0 && c.current >= c.target;
        // A short badge, because a long one eats the name. The explanation
        // lives in the tooltip rather than in the two words.
        const excluded = c.excludedFromTotal
          ? ' <span class="badge" title="This counter’s own buttons don’t change the project total">own</span>'
          : "";
        return `
          <li class="counter-row${c.enabled ? " on" : ""}" data-id="${c.id}">
            <button class="counter-toggle counter-setting" data-act="c-toggle" data-id="${c.id}"
              title="${c.enabled ? "On: click to turn off" : "Off: click to turn on"}"
              aria-label="${c.enabled ? "On" : "Off"}"
              aria-pressed="${c.enabled}">${c.enabled ? "●" : "○"}</button>
            <div class="counter-info">
              <span class="counter-name">${escapeHtml(c.name)}${excluded}</span>
              <span class="counter-count${done ? " complete" : ""}">${c.current}${target}</span>
            </div>
            <div class="stepper small">
              <button data-act="c-dec" data-id="${c.id}" title="Subtract 1">−</button>
              <button data-act="c-inc" data-id="${c.id}" title="Add 1">+</button>
            </div>
            <div class="counter-more counter-setting">
              <button class="ghost key-chip${c.hotkey ? " set" : ""}" data-act="c-key" data-id="${c.id}"
                title="${c.hotkey ? `${escapeHtml(keyLabel(c.hotkey))} counts this counter; Shift+${escapeHtml(keyLabel(c.hotkey))} counts it down. Click to change.` : "Set a key for this counter"}"
                >${c.hotkey ? escapeHtml(keyLabel(c.hotkey)) : "Key"}</button>
              <button class="ghost" data-act="c-edit" data-id="${c.id}" title="Rename or set a target">Edit</button>
              <button class="ghost" data-act="c-reset" data-id="${c.id}" title="Reset to zero">Reset</button>
              <button class="ghost" data-act="c-del" data-id="${c.id}" title="Remove this counter">×</button>
            </div>
          </li>`;
      })
      .join("");
  }

  /**
   * The count keys away from the reader -- on a project's page, say: the count
   * up and count down keys count a row, and a counter's own key counts it.
   * Nothing else, so the arrow and +/- keys keep their usual jobs there.
   */
  handleCountKey(e: KeyboardEvent): boolean {
    if (!isPlainPress(e) || !e.code) return false;
    const own = this.counters.find((c) => c.hotkey === e.code);
    if (own) {
      void this.countOne(own.id, e.shiftKey ? -1 : 1).catch((err) => console.error("Counting failed:", err));
      return true;
    }
    if (e.code !== this.keys.up && e.code !== this.keys.down) return false;
    void this.countRows(e.code === this.keys.up ? 1 : -1).catch((err) => console.error("Counting failed:", err));
    return true;
  }

  /**
   * Applies the number keys while the reader has focus.
   *
   * The handled/not-handled decision is synchronous: the caller must be able
   * to preventDefault in the same event dispatch, before the counting round
   * trip, or an arrow key would scroll the page as well as count. PageDown and
   * PageUp are deliberately absent -- the reader intercepts them first to
   * scroll the pattern under a stationary line.
   *
   * The arrow and +/- keys go through the one action, so the total and the
   * enabled counters move together. A counter given its own key is the
   * exception, by request: that key counts that counter alone, the same as its
   * own + button, and Shift with it counts it down.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return false;
    }
    if (isPlainPress(e) && e.code) {
      const own = this.counters.find((c) => c.hotkey === e.code);
      if (own) {
        void this.countOne(own.id, e.shiftKey ? -1 : 1).catch((err) => console.error("Counting failed:", err));
        return true;
      }
    }
    const step = e.shiftKey ? 10 : 1;
    let delta: number | null = null;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        delta = step;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        delta = -step;
        break;
      case "+":
      case "=":
        delta = step;
        break;
      case "-":
        delta = -step;
        break;
    }
    if (delta === null) return false;
    void this.count(delta).catch((err) => console.error("Counting failed:", err));
    return true;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
