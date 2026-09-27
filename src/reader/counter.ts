import { api, type Counter, type CountOutcome, type Progress } from "../api";
import { askForm } from "../dialogs";
import { closestEl } from "../dom";
import { isClickMuted, playClick, setClickMuted } from "./click";

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

  private counters: Counter[] = [];
  private progress: Progress | null = null;

  // Element references, kept to avoid re-querying on every render.
  private totalValue!: HTMLElement;
  private counterList!: HTMLElement;
  private soundButton!: HTMLButtonElement;

  constructor(root: HTMLElement, patternId: string) {
    this.root = root;
    this.patternId = patternId;
    this.build();
  }

  private build(): void {
    // Add to the host's classes rather than replacing them, so the container's
    // own class (e.g. "counter-slot") stays intact.
    this.root.classList.add("counter");
    this.root.innerHTML = `
      <div class="counter-head">
        <h3>Row counter</h3>
        <button class="ghost counter-sound" data-act="sound" title="Counting sound">♪</button>
        <button class="ghost" data-act="collapse" title="Hide the counter">–</button>
      </div>
      <div class="counter-body">
        <div class="counter-total">
          <label>Project total</label>
          <div class="stepper big">
            <button data-act="total-dec" title="Subtract 1">−</button>
            <span class="value" data-el="total">0</span>
            <button data-act="total-inc" title="Add 1">+</button>
          </div>
          <div class="quick">
            <button data-act="total-dec10" title="Subtract 10">−10</button>
            <button data-act="total-inc10" title="Add 10">+10</button>
            <button data-act="total-reset" title="Reset to zero">Reset</button>
          </div>
          <p class="hint">
            Counts every row, and every counter that is switched on.
          </p>
        </div>

        <div class="counter-counters">
          <label>Counters</label>
          <ul data-el="counterlist" class="counter-list"></ul>
          <button class="ghost" data-act="add-counter">+ Add counter</button>
          <p class="hint">
            The dot switches a counter on and off. Off keeps its count but stops
            it moving. Several can be on at once.
          </p>
        </div>
      </div>
    `;

    this.totalValue = this.q('[data-el="total"]');
    this.counterList = this.q('[data-el="counterlist"]');
    this.soundButton = this.q('[data-act="sound"]');
    this.paintSoundButton();

    this.root.addEventListener("click", (e) => this.onClick(e));
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
        await api.setTotalRows(this.patternId, 0);
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

      case "sound":
        setClickMuted(!isClickMuted());
        this.paintSoundButton();
        // Give the turned-on state something to prove itself with.
        if (!isClickMuted()) playClick();
        break;

      case "collapse": {
        const body = this.q(".counter-body");
        const hidden = body.hasAttribute("hidden");
        if (hidden) body.removeAttribute("hidden");
        else body.setAttribute("hidden", "");
        btn.textContent = hidden ? "–" : "+";
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
  private async count(delta: number): Promise<void> {
    const outcome = await api.countRows(this.patternId, delta);
    playClick();
    this.apply(outcome);
  }

  private async countOne(id: string, delta: number): Promise<void> {
    const outcome = await api.countCounter(id, delta);
    playClick();
    this.apply(outcome);
  }

  private async toggle(id: string): Promise<void> {
    const current = this.counters.find((c) => c.id === id);
    if (!current) return;
    const outcome = await api.setCounterEnabled(this.patternId, id, !current.enabled);
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
  async countRows(delta: number): Promise<void> {
    try {
      await this.count(delta);
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

    const created = await api.addCounter(this.patternId, {
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
          label: "Leave the project total alone when this counter's own buttons are used",
          checked: current.excludedFromTotal,
          hint:
            "For setup rows and other counts that are not part of the pattern's " +
            "main row total. Counting rows normally still moves the total either way.",
        },
      },
    );
    if (!answer) return;
    const target = Math.max(0, parseInt(answer["Rows"], 10) || 0);
    const excluded = answer["Leave the project total alone when this counter's own buttons are used"] === "yes";
    await api.updateCounter(id, (answer["Name"] ?? "").trim() || "Counter", target, excluded);
    await this.refresh();
  }

  /** Loads counters and progress, then paints. */
  async refresh(): Promise<void> {
    const [counters, progress] = await Promise.all([
      api.listCounters(this.patternId),
      api.getProgress(this.patternId),
    ]);
    this.counters = counters;
    this.progress = progress;
    this.render();
  }

  private render(): void {
    if (!this.progress) return;
    this.totalValue.textContent = String(this.progress.totalRows);

    if (!this.counters.length) {
      this.counterList.innerHTML =
        '<li class="counter-empty">No counters yet. Add one for each part you count separately.</li>';
      return;
    }

    this.counterList.innerHTML = this.counters
      .map((c) => {
        const target = c.target > 0 ? ` / ${c.target}` : "";
        const done = c.target > 0 && c.current >= c.target;
        // A short badge, because a long one eats the name. The explanation
        // lives in the tooltip rather than in the two words.
        const excluded = c.excludedFromTotal
          ? ' <span class="badge" title="This counter’s own buttons leave the project total alone">own</span>'
          : "";
        return `
          <li class="counter-row${c.enabled ? " on" : ""}" data-id="${c.id}">
            <button class="counter-toggle" data-act="c-toggle" data-id="${c.id}"
              title="${c.enabled ? "Counting — click to set aside" : "Set aside — click to count it"}"
              aria-label="${c.enabled ? "Counting" : "Set aside"}"
              aria-pressed="${c.enabled}">${c.enabled ? "●" : "○"}</button>
            <div class="counter-info">
              <span class="counter-name">${escapeHtml(c.name)}${excluded}</span>
              <span class="counter-count${done ? " complete" : ""}">${c.current}${target}</span>
            </div>
            <div class="stepper small">
              <button data-act="c-dec" data-id="${c.id}" title="Subtract 1">−</button>
              <button data-act="c-inc" data-id="${c.id}" title="Add 1">+</button>
            </div>
            <div class="counter-more">
              <button class="ghost" data-act="c-edit" data-id="${c.id}" title="Rename or set a target">Edit</button>
              <button class="ghost" data-act="c-reset" data-id="${c.id}" title="Reset to zero">Reset</button>
              <button class="ghost" data-act="c-del" data-id="${c.id}" title="Remove this counter">×</button>
            </div>
          </li>`;
      })
      .join("");
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
   * Every counting key goes through the one action, so the total and the
   * enabled counters always move together. There is deliberately no key that
   * counts a single counter: that is what the counter's own buttons are for,
   * and a keyboard route to one would make it too easy to move one number
   * without the other.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return false;
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
