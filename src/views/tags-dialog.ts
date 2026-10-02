import { customDialog } from "../dialogs";

/**
 * Editing a pattern's tags without opening it: the tags as chips, a field to
 * add more (offering the tags already in the library), and × to remove one.
 * Resolves the new list, or null if cancelled.
 */
export function editTags(title: string, current: string[], known: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    let tags = [...current];
    const finish = (answer: string[] | null) => {
      dialog.close();
      resolve(answer);
    };
    const dialog = customDialog(`Tags — ${title}`, () => finish(null), "tags-dialog");
    const listId = `known-tags-${Math.random().toString(36).slice(2)}`;
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <div class="tag-chips" data-el="chips"></div>
      <input class="dialog-input" data-el="input" list="${listId}" placeholder="Add a tag and press Enter" />
      <datalist id="${listId}">${known.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>
      <p class="hint">Press Enter or a comma after each one. Tags you already use are offered as you type.</p>
      <div class="dialog-actions">
        <button class="ghost" data-act="cancel">Cancel</button>
        <button class="primary" data-act="save">Save</button>
      </div>`,
    );
    const chips = dialog.card.querySelector<HTMLElement>('[data-el="chips"]')!;
    const input = dialog.card.querySelector<HTMLInputElement>('[data-el="input"]')!;
    const paint = () => {
      chips.innerHTML = tags.length
        ? tags.map((t, i) => `<span class="tag">${esc(t)}<button data-remove="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join("")
        : `<span class="hint">No tags yet.</span>`;
    };
    /** Adds what is typed; a tag already there, in any case, is not added twice. */
    const take = () => {
      for (const part of input.value.split(",")) {
        const tag = part.trim();
        if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          // A tag the library already has keeps the spelling it has there.
          tags.push(known.find((k) => k.toLowerCase() === tag.toLowerCase()) ?? tag);
        }
      }
      input.value = "";
      paint();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        if (e.key === "Enter" && !input.value.trim()) return finish(tags);
        take();
      } else if (e.key === "Backspace" && !input.value && tags.length) {
        tags.pop();
        paint();
      }
    });
    // Picking from the offered list adds it straight away.
    input.addEventListener("input", (e) => {
      // A comma typed or pasted in ends a tag too.
      if ((e as InputEvent).inputType === "insertReplacementText" || input.value.includes(",")) take();
    });
    dialog.card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const remove = target.closest<HTMLElement>("[data-remove]");
      if (remove) {
        tags = tags.filter((_, i) => i !== Number(remove.dataset.remove));
        paint();
        input.focus();
        return;
      }
      const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "cancel") finish(null);
      if (act === "save") {
        take();
        finish(tags);
      }
    });
    paint();
    dialog.show(input);
  });
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
