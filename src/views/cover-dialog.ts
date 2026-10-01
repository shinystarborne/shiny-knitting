import { api, toBytes, type Pattern } from "../api";
import { coverUrl, extractFromDocument, forgetCover, prepareChosenImage, removeCover, saveCover } from "../covers";
import { customDialog } from "../dialogs";

/**
 * Changing a pattern's cover: paste a picture with Ctrl+V (a shop's photo is
 * usually on the clipboard already), drop one, choose a file, read it from
 * the pattern again, or remove it. Each change is made at once; the dialog
 * resolves whether anything changed, so the caller knows to repaint.
 */
export function changeCover(pattern: Pattern): Promise<boolean> {
  return new Promise((resolve) => {
    let changed = false;
    const finish = () => {
      document.removeEventListener("paste", onPaste);
      dialog.close();
      resolve(changed);
    };
    const dialog = customDialog(`Cover — ${pattern.title}`, finish, "cover-dialog");
    dialog.card.insertAdjacentHTML(
      "beforeend",
      `
      <div class="cover-drop" data-el="box" tabindex="0" title="Paste a picture here with Ctrl+V, or drop one">
        <span class="cover-drop-hint">Paste a picture with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drop one here</span>
      </div>
      <p class="form-error" data-el="error" hidden></p>
      <div class="dialog-actions cover-dialog-actions">
        <button class="ghost" data-act="file">Choose a picture…</button>
        <button class="ghost" data-act="read">Read from the pattern</button>
        <button class="ghost danger-text" data-act="remove">Remove</button>
        <span class="spacer"></span>
        <button class="primary" data-act="done">Done</button>
      </div>`,
    );
    const box = dialog.card.querySelector<HTMLElement>('[data-el="box"]')!;
    const error = dialog.card.querySelector<HTMLElement>('[data-el="error"]')!;
    const say = (text: string) => {
      error.textContent = text;
      error.hidden = !text;
    };

    const paint = async () => {
      forgetCover(pattern.id);
      const url = await coverUrl(pattern.id);
      box.style.backgroundImage = url ? `url("${url}")` : "";
      box.classList.toggle("filled", !!url);
    };
    const use = async (file: File | Blob | null) => {
      if (!file) return;
      say("");
      box.classList.add("busy");
      try {
        const blob = file instanceof File ? await prepareChosenImage(file) : file;
        if (!blob) return say("That could not be read as a picture.");
        await saveCover(pattern.id, blob);
        changed = true;
        await paint();
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      } finally {
        box.classList.remove("busy");
      }
    };

    // While this is up, any picture pasted is the cover.
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (!file) return say("There is no picture on the clipboard. Copy one first (right-click it, then Copy image).");
      e.preventDefault();
      void use(file);
    };
    document.addEventListener("paste", onPaste);

    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void use(file);
      else say("Only a picture file can be dropped here.");
    });

    dialog.card.addEventListener("click", async (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]")?.dataset.act;
      if (act === "done") finish();
      if (act === "file") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", () => void use(input.files?.[0] ?? null));
        input.click();
      }
      if (act === "read") {
        say("");
        try {
          const found = await extractFromDocument(pattern, toBytes(await api.readFile(pattern.id)));
          if (!found) return say("No cover picture was found in the pattern's file.");
          await use(found.blob);
        } catch {
          say("The pattern's file could not be read.");
        }
      }
      if (act === "remove") {
        await removeCover(pattern.id).catch(() => {});
        changed = true;
        await paint();
      }
    });

    dialog.show(box);
    void paint();
  });
}
