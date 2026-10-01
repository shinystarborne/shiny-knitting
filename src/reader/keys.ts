/**
 * Choosing a key, and showing one.
 *
 * Keys are kept as physical key codes (`KeyF`, `Digit2`, `Space`) rather than
 * the character they type. A code is the same with Shift held -- which is how
 * a counter is counted down -- and the same physical key on any keyboard
 * layout, where the character under it may be something else entirely.
 */

/** Keys the reader already needs for something else, so none can be chosen. */
const RESERVED = new Set([
  "Escape",
  "Tab",
  "PageUp",
  "PageDown",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "ContextMenu",
]);

const NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Num Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num −",
  NumpadMultiply: "Num ×",
  NumpadDivide: "Num ÷",
  NumpadDecimal: "Num .",
};

/** How a key code is shown: "F", "2", "Space", "↓", "Num 5". */
export function keyLabel(code: string): string {
  if (!code) return "";
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

let capturing = false;

/** Whether a key is being chosen right now, so nothing else should act on keys. */
export function isCapturing(): boolean {
  return capturing;
}

/** Whether a key press is a plain press of a key, with no Ctrl, Alt or Cmd. */
export function isPlainPress(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.altKey && !e.metaKey;
}

/**
 * Asks for a key: resolves its code, "" when the reader chose Clear, or null
 * when they cancelled.
 *
 * Held as the only thing listening to the keyboard while it is up, so the
 * key being chosen does not also count a row or close the pattern.
 */
export function captureKey(title: string, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop dialog-backdrop";
    const card = document.createElement("div");
    card.className = "dialog-card key-capture";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const heading = document.createElement("h3");
    heading.className = "dialog-title";
    heading.textContent = title;
    const prompt = document.createElement("p");
    prompt.className = "dialog-message";
    prompt.textContent = current
      ? `Now: ${keyLabel(current)}. Press the key you want instead.`
      : "Press the key you want to use.";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ghost";
    clear.textContent = "Clear";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "Cancel";
    actions.append(clear, cancel);
    card.append(heading, prompt, actions);
    overlay.appendChild(card);

    const finish = (answer: string | null) => {
      capturing = false;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") return finish(null);
      if (!isPlainPress(e) || RESERVED.has(e.code) || !e.code) {
        prompt.textContent = `${keyLabel(e.code) || "That key"} can't be used. Press another, or Escape to cancel.`;
        return;
      }
      finish(e.code);
    };
    clear.addEventListener("click", () => finish(""));
    cancel.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    capturing = true;
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}
