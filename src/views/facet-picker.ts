import type { FacetCount } from "../api";
import { customDialog } from "../dialogs";

/**
 * Every designer, or every tag, in a dialog of its own, for when the sidebar's
 * few most used are not the one wanted: a search field over the whole list,
 * most used first (or A–Z), each one ticked on or off for the filter there
 * and then. `onToggle` is told of each change, so the library behind it
 * follows as they are ticked.
 */
export function pickFromAll(
  title: string,
  items: FacetCount[],
  selected: Set<string>,
  onToggle: (value: string, on: boolean) => void,
  key: (value: string) => string = (v) => v,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      dialog.close();
      resolve();
    };
    const dialog = customDialog(title, finish, "facet-picker");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <div class="facet-picker-bar">
        <input class="dialog-input" type="search" data-el="find" placeholder="Search ${items.length} …" />
        <select data-el="order" aria-label="Order">
          <option value="use">Most used</option>
          <option value="az">A–Z</option>
        </select>
      </div>
      <div class="facet-picker-list" data-el="list"></div>
      <div class="dialog-actions">
        <span class="hint" data-el="count"></span>
        <span class="spacer"></span>
        <button class="primary" data-act="done">Done</button>
      </div>`,
    );
    const find = dialog.card.querySelector<HTMLInputElement>('[data-el="find"]')!;
    const order = dialog.card.querySelector<HTMLSelectElement>('[data-el="order"]')!;
    const list = dialog.card.querySelector<HTMLElement>('[data-el="list"]')!;
    const count = dialog.card.querySelector<HTMLElement>('[data-el="count"]')!;

    const paint = () => {
      const words = find.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = items.filter((i) => words.every((w) => i.value.toLowerCase().includes(w)));
      if (order.value === "az") shown = [...shown].sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: "base" }));
      list.innerHTML = shown.length
        ? shown
            .map(
              (i) => `
                <label class="check">
                  <input type="checkbox" value="${esc(i.value)}" ${selected.has(key(i.value)) ? "checked" : ""} />
                  <span>${esc(i.value)}</span>
                  <em>${i.count}</em>
                </label>`,
            )
            .join("")
        : `<p class="hint">Nothing by that name.</p>`;
      const ticked = items.filter((i) => selected.has(key(i.value))).length;
      count.textContent = ticked ? `${ticked} ticked` : "";
    };
    find.addEventListener("input", paint);
    order.addEventListener("change", paint);
    list.addEventListener("change", (e) => {
      const box = e.target as HTMLInputElement;
      if (box.checked) selected.add(key(box.value));
      else selected.delete(key(box.value));
      onToggle(box.value, box.checked);
      paint();
    });
    dialog.card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest('[data-act="done"]')) finish();
    });
    paint();
    dialog.show(find);
  });
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
