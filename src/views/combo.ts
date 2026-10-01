/**
 * A text field that is also a list to pick from: type anything, or open the
 * list with ▾ (or the down arrow) and choose something used before.
 *
 * A plain `<datalist>` was the first attempt, and it is too easy to miss: it
 * shows nothing until you type, and nothing says it is there at all. This
 * always shows its ▾, lists every choice when opened, and narrows the list as
 * you type.
 */
export function makeCombo(input: HTMLInputElement, choices: () => string[]): void {
  const wrap = document.createElement("div");
  wrap.className = "combo";
  input.replaceWith(wrap);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "combo-toggle";
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-label", "Show choices");
  toggle.textContent = "▾";
  const list = document.createElement("ul");
  list.className = "combo-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(input, toggle, list);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");

  let active = -1;
  let shown: string[] = [];

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
  };
  const paint = () => {
    list.innerHTML = "";
    shown.forEach((choice, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = choice;
      if (i === active) li.classList.add("active");
      // mousedown rather than click, so the field keeps its focus and the
      // blur that closes the list does not win the race.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(choice);
      });
      list.appendChild(li);
    });
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  /** Opens the list: every choice, or those matching what is typed. */
  const open = (filter: boolean) => {
    const typed = input.value.trim().toLowerCase();
    const all = choices();
    shown = filter && typed ? all.filter((c) => c.toLowerCase().includes(typed)) : all;
    if (!shown.length) return close();
    active = shown.findIndex((c) => c.toLowerCase() === typed);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    paint();
  };
  const pick = (choice: string) => {
    input.value = choice;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  toggle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (list.hidden) {
      input.focus();
      open(false);
    } else {
      close();
    }
  });
  input.addEventListener("input", () => open(true));
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) return open(false);
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + shown.length) % shown.length;
      paint();
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape" && !list.hidden) {
      // Closes the list, not the dialog the field is in.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
}
