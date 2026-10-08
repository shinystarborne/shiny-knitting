/**
 * In-app replacements for the browser's own dialogs.
 *
 * `window.prompt`, `window.confirm` and `window.alert` do not work here, and
 * the ways they fail are worth spelling out, because they look like "nothing
 * happened" rather than like an error:
 *
 * - `window.prompt` never returns. A Tauri window is a WebView2, and there is
 *   no browser behind it to draw a prompt, so the call blocks the renderer for
 *   good. One note, and the whole window stops responding to everything.
 * - `window.confirm` returns `undefined` rather than `true` or `false`, so
 *   `if (!window.confirm(...))` is always taken and the thing it guards can
 *   never happen.
 * - `window.alert` does not show.
 *
 * All three work perfectly in a browser, which is how they survived being
 * tested in the browser harness and shipped broken. Anything in this app that
 * needs to ask the user a question goes through here.
 *
 * Each call builds its own overlay on `document.body`, so it can be raised from
 * anywhere — a reader layer deep in the document, a counter, a card floating
 * over a pattern — without any of them having to be handed a dialog host.
 */
import { dom } from "./dom";

/** What a dialog is offering, and what its buttons should say. */
export interface AskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button as destructive, for removing something. */
  danger?: boolean;
  /** Prefilled text, and a hint shown while the field is empty. */
  value?: string;
  placeholder?: string;
  /** Several lines: Enter starts a new one, Ctrl+Enter answers. */
  multiline?: boolean;
}

/**
 * A one-way message with a single button.
 *
 * Used where the app would have reached for `alert`: something went wrong, or
 * there was nothing to do. The message stays on screen until dismissed rather
 * than flashing away, because these are usually the answer to "why did nothing
 * just happen?".
 */
export function say(message: string, title = ""): Promise<void> {
  return new Promise((resolve) => {
    const { overlay, card } = frame(title);
    // OK, Escape and the backdrop all dismiss: there is nothing to decide
    // here, so every way out of a dialog means the same thing.
    const dismiss = () => {
      close(overlay);
      resolve();
    };
    card.append(
      dom("p", { class: "dialog-message" }, [message]),
      actions([button("OK", "primary", dismiss)]),
    );
    show(overlay, card, dismiss);
  });
}

/**
 * A yes/no question.
 *
 * Resolves `true` only when the confirm button is pressed. Escape, the backdrop
 * and the cancel button all resolve `false`, so there is no path where a
 * question is left hanging — which is the failure the browser version had.
 */
export function askYesNo(message: string, options: AskOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const { overlay, card } = frame(options.title);
    const finish = (answer: boolean) => {
      close(overlay);
      resolve(answer);
    };
    // The cancel button is focused, not the confirm one: a question that can
    // destroy something should not be one keystroke from being answered wrongly.
    const cancelButton = button(options.cancelLabel ?? "Cancel", "ghost", () => finish(false));
    card.append(
      dom("p", { class: "dialog-message" }, [message]),
      actions([
        cancelButton,
        button(options.okLabel ?? "OK", options.danger ? "danger" : "primary", () => finish(true)),
      ]),
    );
    show(overlay, card, () => finish(false), cancelButton);
  });
}

/**
 * A single-line question.
 *
 * Resolves the text, or `null` if the user cancelled. The distinction matters:
 * a cancelled prompt means "leave it alone", while cleared text means "yes, and
 * make it empty", and callers need to tell those apart.
 */
export function askText(message: string, options: AskOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, card } = frame(options.title);
    const finish = (answer: string | null) => {
      close(overlay);
      resolve(answer);
    };
    const field = (options.multiline
      ? dom("textarea", { class: "dialog-input dialog-text", rows: "3" })
      : dom("input", { class: "dialog-input", type: "text" })) as HTMLInputElement | HTMLTextAreaElement;
    field.value = options.value ?? "";
    if (options.placeholder) field.placeholder = options.placeholder;

    const confirmButton = button(options.okLabel ?? "OK", "primary", () => finish(field.value));
    // Enter answers, as it would in a browser prompt, so this is not a slower
    // version of the thing it replaces.
    field.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && (!options.multiline || ke.ctrlKey || ke.metaKey)) {
        e.preventDefault();
        finish(field.value);
      }
    });

    card.append(dom("p", { class: "dialog-message" }, [message]), field, actions([
      button(options.cancelLabel ?? "Cancel", "ghost", () => finish(null)),
      confirmButton,
    ]));
    show(overlay, card, () => finish(null), field);
  });
}

/** One choice in a pick-one dialog; `group` puts it under a heading. */
export interface Choice {
  value: string;
  label: string;
  group?: string;
}

/**
 * Pick one from a list: a pattern for the board, a yarn, a needle. Resolves
 * the chosen value, or `null` if cancelled. A filter field above the list
 * narrows it, since a library can be long.
 */
export function askChoice(message: string, choices: Choice[], options: AskOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, card } = frame(options.title);
    const finish = (answer: string | null) => {
      close(overlay);
      resolve(answer);
    };
    const filter = dom("input", { class: "dialog-input", type: "search", placeholder: "Filter…" }) as HTMLInputElement;
    const list = dom("select", { class: "dialog-input dialog-choices", size: "8" }) as HTMLSelectElement;
    const paint = () => {
      const term = filter.value.trim().toLowerCase();
      list.innerHTML = "";
      const groups = new Map<string, HTMLElement>();
      for (const c of choices) {
        if (term && !c.label.toLowerCase().includes(term)) continue;
        const option = dom("option", { value: c.value }, [c.label]);
        if (c.group) {
          let g = groups.get(c.group);
          if (!g) {
            g = dom("optgroup", { label: c.group });
            groups.set(c.group, g);
            list.append(g);
          }
          g.append(option);
        } else {
          list.append(option);
        }
      }
      if (list.options.length) list.selectedIndex = 0;
    };
    paint();
    filter.addEventListener("input", paint);
    const confirm = () => {
      if (list.value) finish(list.value);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
      if (e.key === "ArrowDown" && e.target === filter) {
        e.preventDefault();
        list.focus();
      }
    };
    filter.addEventListener("keydown", keys);
    list.addEventListener("keydown", keys);
    list.addEventListener("dblclick", confirm);
    card.append(
      dom("p", { class: "dialog-message" }, [message]),
      ...(choices.length > 8 ? [filter] : []),
      list,
      actions([
        button(options.cancelLabel ?? "Cancel", "ghost", () => finish(null)),
        button(options.okLabel ?? "Add", "primary", confirm),
      ]),
    );
    show(overlay, card, () => finish(null), choices.length > 8 ? filter : list);
  });
}

/** One box in a form dialog. */
export interface Field {
  label: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "number";
}

/** Extra options for a form dialog. */
export interface FormOptions extends AskOptions {
  /**
   * A yes/no setting, shown as a ticked box rather than a second question.
   *
   * Used where a follow-up `askYesNo` used to be: asking the same thing as a
   * separate question after the fact is two dialogs for one decision, and the
   * answer reads better next to the thing it affects.
   */
  checkbox?: { label: string; checked: boolean; hint?: string };
}

/**
 * Several questions in one dialog.
 *
 * Resolves the field values keyed by label, or `null` if cancelled. The browser
 * prompt took one question at a time, so naming a counter and then saying how
 * many rows it had meant two dialogs in a row; asking both together is one
 * interruption rather than two.
 */
export function askForm(
  fields: Field[],
  options: FormOptions = {},
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const { overlay, card } = frame(options.title);
    const inputs: Record<string, HTMLInputElement> = {};

    const finish = (answer: Record<string, string> | null) => {
      close(overlay);
      resolve(answer);
    };

    const rows = fields.map((field) => {
      const id = `dlg-${field.label.replace(/\W+/g, "-").toLowerCase()}`;
      const input = dom("input", {
        class: "dialog-input",
        id,
        type: field.type ?? "text",
        value: field.value ?? "",
      });
      if (field.placeholder) input.placeholder = field.placeholder;
      inputs[field.label] = input;
      return dom("label", { class: "dialog-field", for: id }, [
        dom("span", { class: "dialog-label" }, [field.label]),
        input,
      ]);
    });

    let ticked = options.checkbox?.checked ?? false;
    const confirmButton = button(options.okLabel ?? "Save", "primary", () => {
      const answer: Record<string, string> = {};
      for (const [label, input] of Object.entries(inputs)) answer[label] = input.value;
      if (options.checkbox) answer[options.checkbox.label] = ticked ? "yes" : "no";
      finish(answer);
    });

    // Enter from any field saves, as it would in a form.
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        confirmButton.click();
      }
    });

    card.append(...rows);
    if (options.checkbox) {
      const box = dom("input", { class: "dialog-check", type: "checkbox" }) as HTMLInputElement;
      box.checked = ticked;
      box.addEventListener("change", () => (ticked = box.checked));
      const text = dom("span", {}, [dom("span", { class: "dialog-label" }, [options.checkbox.label])]);
      // Why one would want this, not just what it is. A bare tick box labelled
      // "excluded" is a question nobody can answer.
      if (options.checkbox.hint) {
        text.append(dom("span", { class: "dialog-hint" }, [options.checkbox.hint]));
      }
      card.append(
        dom("label", { class: "dialog-field dialog-checkfield" }, [box, text]),
      );
    }
    card.append(
      actions([
        button(options.cancelLabel ?? "Cancel", "ghost", () => finish(null)),
        confirmButton,
      ]),
    );
    show(overlay, card, () => finish(null), Object.values(inputs)[0]);
  });
}

/** The overlay and card a dialog is built into. */
function frame(title: string | undefined): { overlay: HTMLElement; card: HTMLElement } {
  const overlay = dom("div", { class: "modal-backdrop dialog-backdrop" });
  const card = dom("div", { class: "dialog-card", role: "dialog", "aria-modal": "true" });
  if (title) card.append(dom("h3", { class: "dialog-title" }, [title]));
  return { overlay, card };
}

/**
 * The dialogs currently up, oldest first.
 *
 * A single document-level key listener serves all of them, and this stack is
 * how it knows who to talk to. The earlier version registered one listener per
 * dialog, which was a trap of its own: each one called
 * `stopImmediatePropagation` to keep the app's own shortcuts out, so the first
 * listener to fire silenced every other one -- including the listener belonging
 * to the dialog actually on screen. Escape then cancelled a dialog that had
 * already gone and left the visible one exactly where it was.
 *
 * One listener cannot have that problem. It cancels the topmost dialog, which
 * is the one the reader can see. Entries leave the stack in `close`, the only
 * way a dialog comes down.
 */
const stack: { overlay: HTMLElement; cancel: () => void }[] = [];
let listening = false;

function listenForKeys(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const top = stack[stack.length - 1];
      if (!top) return;
      // A key aimed inside the dialog is left alone: the field's own Enter
      // handler and the focused button's Space still need to fire, and
      // stopping the event here — capture phase, on the document — would kill
      // them before they ever ran. Escape is the exception: it always means
      // "cancel the top dialog", wherever the focus happens to be.
      if (e.key === "Escape") {
        // `stopImmediatePropagation`, not `stopPropagation`. The app has
        // another Escape handler on the document itself (main.ts, which backs
        // out to the library) in the *bubble* phase, and a document is one
        // node in the event path however many phases it has: the
        // stop-propagation flag is only read between nodes, so a bubble
        // listener on the same node still runs. That is why Escape closed the
        // question *and* left the pattern. Stopping immediately ends the
        // node's listener list, which is what a modal needs.
        e.stopImmediatePropagation();
        e.preventDefault();
        // Copied out first, because cancelling removes the dialog and so
        // mutates the stack this is reading from.
        const cancel = top.cancel;
        cancel();
        return;
      }
      // A key aimed outside the dialog — a stray-focused app element behind
      // the modal — must not answer the app's own shortcuts, so it is stopped
      // the same way.
      if (!(e.target instanceof Node) || !top.overlay.contains(e.target)) {
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

/**
 * Puts a dialog on screen and wires the ways out of it.
 *
 * The backdrop and Escape both mean "cancel", and the keyboard is held for as
 * long as it is up.
 */
function show(
  overlay: HTMLElement,
  card: HTMLElement,
  onCancel?: () => void,
  focus?: HTMLElement,
): void {
  overlay.append(card);
  overlay.addEventListener("click", (e) => {
    // Only a click on the backdrop itself, not one that bubbled up from inside.
    if (e.target === overlay) onCancel?.();
  });
  stack.push({ overlay, cancel: () => onCancel?.() });
  listenForKeys();
  document.body.append(overlay);
  (focus ?? card.querySelector<HTMLButtonElement>("button"))?.focus();
}

/** Whether any dialog is up, so other code can stand aside. */
export function dialogOpen(): boolean {
  return stack.length > 0;
}

function close(overlay: HTMLElement): void {
  // Off the stack with the overlay, so a dialog that is answered cannot go on
  // swallowing the keyboard on behalf of the next one.
  const at = stack.findIndex((d) => d.overlay === overlay);
  if (at >= 0) stack.splice(at, 1);
  overlay.remove();
}

function actions(buttons: HTMLElement[]): HTMLElement {
  return dom("div", { class: "dialog-actions" }, buttons);
}

function button(label: string, kind: string, onClick: () => void): HTMLButtonElement {
  const el = dom("button", { class: kind, type: "button" }, [label]);
  el.addEventListener("click", onClick);
  return el;
}

/**
 * A dialog built by its caller, for what the questions above do not cover: a
 * cover to paste in, a list of duplicates to sort out. The caller fills
 * `card` and calls `show`; `close` takes it down. Escape and the backdrop call
 * `onCancel`, which should end in `close`.
 */
export function customDialog(
  title: string,
  onCancel: () => void,
  className = "",
): { card: HTMLElement; show: (focus?: HTMLElement) => void; close: () => void } {
  const { overlay, card } = frame(title);
  if (className) card.classList.add(...className.split(/\s+/).filter(Boolean));
  return {
    card,
    show: (focus) => show(overlay, card, onCancel, focus),
    close: () => close(overlay),
  };
}
