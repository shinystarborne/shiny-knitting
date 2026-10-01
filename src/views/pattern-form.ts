import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  toBytes,
  DIFFICULTIES,
  STATUSES,
  YARN_WEIGHT_OPTIONS,
  type Pattern,
} from "../api";
import { closestEl } from "../dom";
import {
  coverUrl,
  extractFromDocument,
  forgetCover,
  saveCover,
} from "../covers";
import { changeCover } from "./cover-dialog";

/**
 * The add/edit dialog for a pattern's details.
 *
 * Metadata is filled in after picking the file, because knowing the title up
 * front is not how anyone actually works. The form is a modal so it can be
 * used from both the library (to add) and the reader (to edit).
 */
export class PatternForm {
  private root: HTMLElement;
  private editing: Pattern | null;
  private fileBytes: number[] | null = null;
  /**
   * A path on disk, when the file was chosen with the native dialog.
   *
   * Preferred over `fileBytes`: the backend copies straight from the path, so
   * a large pattern's contents never have to be serialised across the IPC
   * boundary, which is what made adding one feel like it had hung.
   */
  private filePath: string | null = null;
  private fileName = "";
  private tagList: string[] = [];
  /** Taken back off the shared modal on close; see `close`. */
  private teardown: (() => void)[] = [];

  private onDone: (pattern: Pattern) => void;

  constructor(root: HTMLElement, editing: Pattern | null, onDone: (p: Pattern) => void) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    this.tagList = editing ? [...editing.tags] : [];
  }

  open(): void {
    const e = this.editing;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${e ? "Edit pattern" : "Add a pattern"}</h2>

        ${e ? "" : `
          <div class="dropzone" data-el="drop">
            <input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden data-el="file" />
            <p><strong>Choose a PDF or EPUB</strong></p>
            <p class="hint">The file is copied into your library, so you can move or delete the original.</p>
            <p class="hint">Drag a file in, or use the button below. Browsing is much faster for large patterns.</p>
            <button class="ghost" data-act="browse" type="button">Browse for a file…</button>
            <p class="chosen" data-el="chosen"></p>
          </div>
        `}

        ${e ? `
          <div class="field">
            <span>Cover</span>
            <div class="cover-row">
              <div class="cover-preview" data-el="coverbox"></div>
              <div class="cover-actions">
                <button class="ghost" data-act="cover-file" title="Paste a picture, drop one, or choose a file">Change cover…</button>
                <button class="ghost" data-act="cover-reset">Read from the file</button>
                <p class="hint">The cover is taken from the first page of a PDF, or the cover image of an EPUB.</p>
              </div>
            </div>
          </div>
        ` : ""}

        <label class="field">
          <span>Title</span>
          <input data-f="title" value="${escapeAttr(e?.title ?? "")}" placeholder="e.g. Featherweight Lace Sock" />
        </label>
        <label class="field">
          <span>Designer</span>
          <input data-f="designer" value="${escapeAttr(e?.designer ?? "")}" placeholder="e.g. Jess Leslie" />
        </label>
        <div class="field-row">
          <label class="field">
            <span>Status</span>
            <select data-f="status">
              <option value="" ${e?.status ? "" : "selected"}>No status</option>
              ${STATUSES.map(
                (s) =>
                  `<option value="${s.value}" ${e?.status === s.value ? "selected" : ""}>${s.label}</option>`,
              ).join("")}
            </select>
          </label>
          <label class="field">
            <span>Difficulty</span>
            <select data-f="difficulty">
              <option value="">Not set</option>
              ${DIFFICULTIES.map(
                (d) =>
                  `<option value="${d.value}" ${e?.difficulty === d.value ? "selected" : ""}>${d.label}</option>`,
              ).join("")}
            </select>
          </label>
          <label class="field">
            <span>Needle size</span>
            <input data-f="needleSize" value="${escapeAttr(e?.needleSize ?? "")}" placeholder="e.g. 4mm" />
          </label>
          <label class="field">
            <span>Yarn weight</span>
            <input
              data-f="yarnWeight"
              list="yarn-weight-options"
              value="${escapeAttr(e?.yarnWeight ?? "")}"
              placeholder="e.g. DK, or 100 m/100g"
            />
            <datalist id="yarn-weight-options">
              ${YARN_WEIGHT_OPTIONS.map((o) => `<option value="${escapeAttr(o)}"></option>`).join("")}
            </datalist>
          </label>
        </div>
        <div class="field">
          <span>Tags</span>
          <div class="tag-editor">
            <div class="tag-list" data-el="tags"></div>
            <input data-el="taginput" placeholder="Add a tag and press Enter" />
          </div>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="Anything worth remembering about this pattern.">${escapeHtml(
            e?.notes ?? "",
          )}</textarea>
        </label>

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save" ${e ? "" : "disabled"}>
            ${e ? "Save changes" : "Add to library"}
          </button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;

    this.bind();
    this.renderTags();
    void this.paintCover();
  }

  private bind(): void {
    const fileInput = this.root.querySelector('[data-el="file"]') as HTMLInputElement | null;
    const drop = this.root.querySelector('[data-el="drop"]');

    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void this.loadFile(file);
    });

    // Drag and drop, since browsing for a knitting pattern in a deep folder
    // tree is tedious.
    drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (file) void this.loadFile(file);
    });
    drop?.addEventListener("click", (e) => {
      // The Browse button inside the dropzone handles its own click.
      if (closestEl(e.target, '[data-act="browse"]')) return;
      fileInput?.click();
    });

    const tagInput = this.root.querySelector('[data-el="taginput"]') as HTMLInputElement;
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.addTag(tagInput.value);
        tagInput.value = "";
      }
    });

    const onClick = (e: MouseEvent) => {
      // Clicking the backdrop dismisses, but not a stray click inside the form.
      if (e.target === this.root) {
        this.close();
        return;
      }
      const btn = closestEl(e.target, "button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "cancel") this.close();
      if (btn.dataset.act === "save") void this.save();
      if (btn.dataset.act === "remove-tag") {
        this.tagList = this.tagList.filter((t) => t !== btn.dataset.tag);
        this.renderTags();
      }
      if (btn.dataset.act === "cover-file") void this.chooseCover();
      if (btn.dataset.act === "cover-reset") void this.resetCover();
      if (btn.dataset.act === "browse") void this.browseForFile();
    };
    // On the shared modal element, so taken off again on close. Left on, it
    // went on hearing the clicks of every form opened after it: the needle
    // form's Save also ran this form's save, against fields that were not
    // there, and showed its error in the needle form.
    this.root.addEventListener("click", onClick);
    this.teardown.push(() => this.root.removeEventListener("click", onClick));
  }

  private async loadFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".epub")) {
      this.showError("Only PDF and EPUB files can be added.");
      return;
    }
    this.fileName = file.name;
    // A webview file gives us contents and no usable path, so the bytes are
    // what we have to send.
    this.filePath = null;
    const buffer = new Uint8Array(await file.arrayBuffer());
    this.fileBytes = Array.from(buffer);

    // Pre-fill the title from the filename, with the extension removed. It is
    // a starting point to correct, not a locked value.
    const titleField = this.root.querySelector('[data-f="title"]') as HTMLInputElement;
    if (!titleField.value) {
      titleField.value = file.name.replace(/\.(pdf|epub)$/i, "").replace(/[_-]+/g, " ");
    }
    const chosen = this.root.querySelector('[data-el="chosen"]');
    if (chosen) chosen.textContent = `${file.name} (${formatBytes(file.size)})`;
    (this.root.querySelector('[data-act="save"]') as HTMLButtonElement).disabled = false;
  }

  /**
   * Picks a file with the native dialog, which hands back a path rather than
   * the contents. Nothing is read here; the backend copies the file itself,
   * which is what keeps a large PDF from taking many seconds to add.
   */
  private async browseForFile(): Promise<void> {
    let picked: string | null;
    try {
      picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Patterns", extensions: ["pdf", "epub"] }],
      });
    } catch {
      // No dialog plugin (or the user dismissed it): fall back to the
      // webview's own picker rather than leaving no way to add a file.
      (this.root.querySelector('[data-el="file"]') as HTMLInputElement | null)?.click();
      return;
    }
    if (typeof picked !== "string") return;

    const name = picked.split(/[\\/]/).pop() ?? picked;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".epub")) {
      this.showError("Only PDF and EPUB files can be added.");
      return;
    }

    this.filePath = picked;
    this.fileBytes = null;
    this.fileName = name;

    const titleField = this.root.querySelector('[data-f="title"]') as HTMLInputElement;
    if (!titleField.value) {
      titleField.value = name.replace(/\.(pdf|epub)$/i, "").replace(/[_-]+/g, " ");
    }
    const chosen = this.root.querySelector('[data-el="chosen"]');
    // The size is not known without reading the file, which is exactly what
    // this path avoids, so it is left out.
    if (chosen) chosen.textContent = name;
    (this.root.querySelector('[data-act="save"]') as HTMLButtonElement).disabled = false;
  }

  private addTag(raw: string): void {
    const tag = raw.trim().toLowerCase();
    if (tag && !this.tagList.includes(tag)) {
      this.tagList.push(tag);
      this.renderTags();
    }
  }

  private renderTags(): void {
    const holder = this.root.querySelector('[data-el="tags"]')!;
    holder.innerHTML = this.tagList
      .map(
        (t) =>
          `<span class="tag">${escapeHtml(t)}<button data-act="remove-tag" data-tag="${escapeAttr(t)}">×</button></span>`,
      )
      .join("");
  }

  private value(field: string): string {
    return (this.root.querySelector(`[data-f="${field}"]`) as HTMLInputElement).value;
  }

  // ---------- covers ----------

  /** Shows the current cover, or a placeholder when there is none. */
  private async paintCover(): Promise<void> {
    const box = this.root.querySelector('[data-el="coverbox"]') as HTMLElement | null;
    if (!box) return;
    if (!this.editing) return;
    const url = await coverUrl(this.editing.id);
    box.classList.toggle("filled", !!url);
    box.style.backgroundImage = url ? `url("${url}")` : "";
  }

  /** The cover dialog: paste, drop, choose, read again or remove. */
  private async chooseCover(): Promise<void> {
    if (!this.editing) return;
    if (await changeCover(this.editing)) {
      forgetCover(this.editing.id);
      await this.paintCover();
    }
  }

  private async resetCover(): Promise<void> {
    if (!this.editing) return;
    try {
      const bytes = await api.readFile(this.editing.id);
      const found = await extractFromDocument(this.editing, toBytes(bytes));
      if (!found) {
        this.showError("No cover image was found in that file.");
        return;
      }
      await saveCover(this.editing.id, found.blob);
      forgetCover(this.editing.id);
      await this.paintCover();
    } catch {
      this.showError("Could not read that file.");
    }
  }

  private async save(): Promise<void> {
    const saveBtn = this.root.querySelector('[data-act="save"]') as HTMLButtonElement;
    saveBtn.disabled = true;

    try {
      if (this.editing) {
        const updated: Pattern = {
          ...this.editing,
          title: this.value("title").trim() || "Untitled pattern",
          designer: this.value("designer").trim(),
          status: this.value("status"),
          difficulty: this.value("difficulty"),
          needleSize: this.value("needleSize").trim(),
          yarnWeight: this.value("yarnWeight").trim(),
          notes: this.value("notes"),
          tags: this.tagList,
        };
        this.onDone(await api.updatePattern(updated));
      } else {
        if (!this.fileBytes && !this.filePath) throw new Error("Choose a file first.");
        const created = await api.addPattern({
          title: this.value("title").trim() || "Untitled pattern",
          designer: this.value("designer").trim(),
          fileName: this.fileName,
          // One of these is set: the path when the native dialog was used,
          // the bytes when a file was dropped or picked in the webview.
          sourcePath: this.filePath ?? undefined,
          bytes: this.fileBytes ?? undefined,
          status: this.value("status"),
          difficulty: this.value("difficulty"),
          needleSize: this.value("needleSize").trim(),
          yarnWeight: this.value("yarnWeight").trim(),
          notes: this.value("notes"),
          tags: this.tagList,
        });
        this.onDone(created);
      }
      this.close();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
      saveBtn.disabled = false;
    }
  }

  private showError(message: string): void {
    const el = this.root.querySelector('[data-el="error"]') as HTMLElement;
    el.textContent = message;
    el.hidden = false;
  }

  private close(): void {
    for (const undo of this.teardown) undo();
    this.teardown = [];
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
