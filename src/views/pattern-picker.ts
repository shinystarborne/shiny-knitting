import { STATUSES, type Pattern } from "../api";

/** How many matches the list shows at once: enough to scroll, few enough to stay quick. */
const SHOWN = 80;

/**
 * Choosing a project's pattern by searching for it: type a word of its title,
 * its designer or a tag, and pick it from the list, the patterns in progress
 * and wanted first. A plain select listed every pattern at once, which in a
 * big library is a long scroll to find one.
 *
 * The choice is kept in a hidden `data-f="pattern"` field holding the
 * pattern's id ("" for none), which says `change` when it changes, so a form
 * reads and listens to it as it did the select.
 */
export function mountPatternPicker(host: HTMLElement, patterns: Pattern[], chosenId: string | null): void {
  const sorted = [...patterns].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  const byId = (id: string) => patterns.find((p) => p.id === id) ?? null;
  host.classList.add("pattern-pick");
  host.innerHTML = `
    <input type="hidden" data-f="pattern" />
    <input class="pattern-pick-input" type="search" autocomplete="off" role="combobox" aria-expanded="false"
      aria-label="Pattern" placeholder="Search your patterns: title, designer or tag" />
    <ul class="pattern-pick-list" role="listbox" hidden></ul>`;
  const value = host.querySelector<HTMLInputElement>('[data-f="pattern"]')!;
  const input = host.querySelector<HTMLInputElement>(".pattern-pick-input")!;
  const list = host.querySelector<HTMLUListElement>(".pattern-pick-list")!;
  let shown: (Pattern | null)[] = [];
  let active = -1;

  const titleOf = (id: string) => byId(id)?.title ?? "";
  value.value = chosenId && byId(chosenId) ? chosenId : "";
  input.value = titleOf(value.value);

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
  };
  const paint = () => {
    let group = "";
    list.innerHTML = shown
      .map((p, i) => {
        const head = p ? statusLabel(p) : "";
        const heading = p && head !== group ? `<li class="pattern-pick-group" role="presentation">${esc(head)}</li>` : "";
        if (p) group = head;
        const cls = `pattern-pick-item${i === active ? " active" : ""}${(p?.id ?? "") === value.value ? " chosen" : ""}`;
        const body = p
          ? `<span class="pattern-pick-title">${esc(p.title)}</span>${p.designer ? `<span class="pattern-pick-designer">${esc(p.designer)}</span>` : ""}`
          : `<span class="pattern-pick-title none">No pattern</span>`;
        return `${heading}<li class="${cls}" role="option" data-i="${i}">${body}</li>`;
      })
      .join("");
    const more = matches().length - (shown.length - 1);
    if (more > 0) list.insertAdjacentHTML("beforeend", `<li class="pattern-pick-more" role="presentation">${more} more: type more of the name</li>`);
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  /** The patterns every typed word is found in: title, designer or a tag. */
  const matches = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // The chosen pattern's own title in the box is not a search.
    if (!words.length || input.value === titleOf(value.value)) return sorted;
    return sorted.filter((p) => {
      const text = `${p.title} ${p.designer} ${p.tags.join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  };
  const open = () => {
    shown = [null, ...matches().slice(0, SHOWN)];
    active = shown.findIndex((p) => (p?.id ?? "") === value.value);
    if (input.value !== titleOf(value.value)) active = shown.length > 1 ? 1 : 0;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    paint();
  };
  const pick = (p: Pattern | null) => {
    const id = p?.id ?? "";
    input.value = p?.title ?? "";
    close();
    if (id === value.value) return;
    value.value = id;
    value.dispatchEvent(new Event("change", { bubbles: true }));
  };

  input.addEventListener("focus", open);
  input.addEventListener("click", () => list.hidden && open());
  input.addEventListener("input", open);
  input.addEventListener("blur", () => {
    // Left half-typed: an emptied box is no pattern; anything else goes back to the choice.
    if (!input.value.trim()) pick(null);
    else input.value = titleOf(value.value);
    close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) return open();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!list.hidden && active >= 0) pick(shown[active]);
    } else if (e.key === "Escape" && !list.hidden) {
      // Closes the list, not the form it is in.
      e.preventDefault();
      e.stopPropagation();
      input.value = titleOf(value.value);
      close();
    }
  });
  // mousedown, so the box keeps its focus and its blur does not win the race.
  list.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest<HTMLElement>(".pattern-pick-item");
    if (item) pick(shown[Number(item.dataset.i)]);
  });
}

/** In progress first, then wanted, then the rest. */
function rank(p: Pattern): number {
  const i = ["in-progress", "want-to-knit"].indexOf(p.status);
  return i < 0 ? 2 : i;
}

function statusLabel(p: Pattern): string {
  return rank(p) < 2 ? (STATUSES.find((s) => s.value === p.status)?.label ?? "Other") : "Other patterns";
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
