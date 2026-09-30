import {
  api,
  YARN_WEIGHT_OPTIONS,
  type Yarn,
  type YarnInput,
  type YarnLotInput,
} from "../api";
import { closestEl } from "../dom";
import {
  forgetYarnPhoto,
  prepareChosenImage,
  removeYarnPhoto,
  saveYarnPhoto,
  yarnPhotoUrl,
} from "../covers";

/** One lot row in the editor, kept as strings while the form is open. */
interface LotRow {
  /** The stored lot's id; null for a row added in this dialog. */
  id: string | null;
  dyeLot: string;
  balls: string;
  gramsLeft: string;
  location: string;
  /** `YYYY-MM-DD`, as the date input speaks it; empty means not recorded. */
  boughtAt: string;
}

/**
 * The add/edit dialog for a yarn.
 *
 * Everything about a yarn is edited in one place, lots included, because the
 * lots are most of what a stash is for: the same yarn bought twice is two
 * dye lots, and a partial ball is grams weighed, not a fraction guessed at.
 * A photo is prepared here but only uploaded after the yarn is saved, since a
 * new yarn has no id to attach it to until then.
 */
export class YarnForm {
  private root: HTMLElement;
  private editing: Yarn | null;
  private lots: LotRow[];
  /** A chosen photo, downscaled and waiting for the save. */
  private pendingPhoto: Blob | null = null;
  private pendingPhotoUrl: string | null = null;
  private photoRemoved = false;

  private onDone: (yarn: Yarn) => void;

  constructor(root: HTMLElement, editing: Yarn | null, onDone: (y: Yarn) => void) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    // A new yarn starts with one empty lot row: a yarn you own is at least
    // one purchase, and the row is where that is said.
    this.lots = editing
      ? editing.lots.map((lot) => ({
          id: lot.id,
          dyeLot: lot.dyeLot,
          balls: lot.balls ? String(lot.balls) : "",
          gramsLeft: lot.gramsLeft ? String(lot.gramsLeft) : "",
          location: lot.location,
          boughtAt: lot.boughtAt != null ? toDateInput(lot.boughtAt) : "",
        }))
      : [emptyLot()];
  }

  open(): void {
    const e = this.editing;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${e ? "Edit yarn" : "Add a yarn"}</h2>

        <div class="field">
          <span>Photo</span>
          <div class="cover-row">
            <div class="cover-preview" data-el="photobox"></div>
            <div class="cover-actions">
              <button class="ghost" data-act="photo-file" type="button">Choose an image…</button>
              <button class="ghost" data-act="photo-remove" type="button">Remove</button>
              <p class="hint">The ball band or the yarn itself. It is scaled down before it is stored.</p>
            </div>
          </div>
        </div>

        <label class="field">
          <span>Name</span>
          <input data-f="name" value="${escapeAttr(e?.name ?? "")}" placeholder="e.g. Felted Tweed" />
        </label>
        <div class="field-row">
          <label class="field">
            <span>Brand</span>
            <input data-f="brand" value="${escapeAttr(e?.brand ?? "")}" placeholder="e.g. Rowan" />
          </label>
          <label class="field">
            <span>Colourway</span>
            <input data-f="colourway" value="${escapeAttr(e?.colourway ?? "")}" placeholder="e.g. Peat" />
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
        <div class="field-row">
          <label class="field">
            <span>Metres per ball</span>
            <input data-f="metresPerBall" type="number" min="0" value="${e?.metresPerBall || ""}" placeholder="e.g. 175" />
          </label>
          <label class="field">
            <span>Grams per ball</span>
            <input data-f="gramsPerBall" type="number" min="0" value="${e?.gramsPerBall || ""}" placeholder="e.g. 50" />
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="Anything worth remembering about this yarn.">${escapeHtml(
            e?.notes ?? "",
          )}</textarea>
        </label>

        <div class="field">
          <span>Lots</span>
          <div class="lot-list" data-el="lots"></div>
          <div>
            <button class="ghost" data-act="add-lot" type="button">+ Add lot</button>
          </div>
          <p class="hint">Weigh a partial ball and put the grams in; the metres left are worked out from that.</p>
        </div>

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">${e ? "Save changes" : "Add to stash"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;

    this.bind();
    this.renderLots();
    void this.paintPhoto();
  }

  private bind(): void {
    this.root.addEventListener("click", this.onClick);
  }

  /**
   * The form's one click handler, kept as a field so `close` can remove it.
   *
   * The modal element is shared by every form the app opens, and a listener
   * left behind would still fire for the next form: the old instance's Save
   * would run alongside the new one's, and a yarn would be added twice.
   */
  private onClick = (e: MouseEvent): void => {
    // Clicking the backdrop dismisses, but not a stray click inside the form.
    if (e.target === this.root) {
      this.close();
      return;
    }
    const btn = closestEl(e.target, "button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "cancel") this.close();
    if (btn.dataset.act === "save") void this.save();
    if (btn.dataset.act === "add-lot") {
      this.readLots();
      this.lots.push(emptyLot());
      this.renderLots();
    }
    if (btn.dataset.act === "remove-lot") {
      this.readLots();
      this.lots.splice(Number(btn.dataset.lot), 1);
      this.renderLots();
    }
    if (btn.dataset.act === "photo-file") void this.choosePhoto();
    if (btn.dataset.act === "photo-remove") {
      this.pendingPhoto = null;
      this.photoRemoved = true;
      void this.paintPhoto();
    }
  };

  // ---------- lots ----------

  private renderLots(): void {
    const holder = this.root.querySelector('[data-el="lots"]')!;
    holder.innerHTML = this.lots
      .map(
        (lot, i) => `
          <div class="lot-row" data-lot="${i}">
            <input data-lf="dyeLot" value="${escapeAttr(lot.dyeLot)}" placeholder="Dye lot" />
            <input data-lf="balls" type="number" min="0" step="any" value="${escapeAttr(lot.balls)}" placeholder="Balls" title="Balls" />
            <input data-lf="gramsLeft" type="number" min="0" step="any" value="${escapeAttr(lot.gramsLeft)}" placeholder="Grams left" title="Grams left, weighed" />
            <input data-lf="location" value="${escapeAttr(lot.location)}" placeholder="Where it lives" />
            <input data-lf="boughtAt" type="date" value="${escapeAttr(lot.boughtAt)}" title="When it was bought" />
            <button class="ghost" data-act="remove-lot" data-lot="${i}" type="button" title="Remove this lot">×</button>
          </div>`,
      )
      .join("");
  }

  /** Copies the DOM rows back into state, before a re-render or a save. */
  private readLots(): void {
    const rows = this.root.querySelectorAll<HTMLElement>(".lot-row");
    this.lots = [...rows].map((row, i) => ({
      id: this.lots[i]?.id ?? null,
      dyeLot: field(row, "dyeLot"),
      balls: field(row, "balls"),
      gramsLeft: field(row, "gramsLeft"),
      location: field(row, "location"),
      boughtAt: field(row, "boughtAt"),
    }));
  }

  // ---------- photo ----------

  /** Shows the pending photo, else the stored one, else a placeholder. */
  private async paintPhoto(): Promise<void> {
    const box = this.root.querySelector('[data-el="photobox"]') as HTMLElement | null;
    if (!box) return;
    let url: string | null = null;
    if (this.pendingPhoto) {
      if (this.pendingPhotoUrl) URL.revokeObjectURL(this.pendingPhotoUrl);
      this.pendingPhotoUrl = URL.createObjectURL(this.pendingPhoto);
      url = this.pendingPhotoUrl;
    } else if (this.editing && this.editing.photoPath && !this.photoRemoved) {
      url = await yarnPhotoUrl(this.editing.id);
    }
    box.classList.toggle("filled", !!url);
    box.style.backgroundImage = url ? `url("${url}")` : "";
  }

  private async choosePhoto(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Downscaled here in the webview, before a byte is uploaded; a phone
      // photo should never cross the boundary at full size.
      const blob = await prepareChosenImage(file);
      if (!blob) {
        this.showError("That file could not be read as an image.");
        return;
      }
      this.pendingPhoto = blob;
      this.photoRemoved = false;
      await this.paintPhoto();
    });
    input.click();
  }

  // ---------- save ----------

  private value(fieldName: string): string {
    return (this.root.querySelector(`[data-f="${fieldName}"]`) as HTMLInputElement).value;
  }

  private async save(): Promise<void> {
    const saveBtn = this.root.querySelector('[data-act="save"]') as HTMLButtonElement;
    saveBtn.disabled = true;

    try {
      const name = this.value("name").trim();
      if (!name) throw new Error("Give the yarn a name.");
      this.readLots();

      // Numbers parse or are 0; a row with nothing in it at all is not a lot.
      const lots: YarnLotInput[] = this.lots
        .map((lot) => ({
          id: lot.id,
          dyeLot: lot.dyeLot.trim(),
          balls: num(lot.balls),
          gramsLeft: num(lot.gramsLeft),
          location: lot.location.trim(),
          boughtAt: lot.boughtAt ? Date.parse(lot.boughtAt) : null,
        }))
        .filter(
          (lot) =>
            lot.dyeLot || lot.balls > 0 || lot.gramsLeft > 0 || lot.location || lot.boughtAt != null,
        );

      const shared = {
        name,
        brand: this.value("brand").trim(),
        colourway: this.value("colourway").trim(),
        yarnWeight: this.value("yarnWeight").trim(),
        metresPerBall: num(this.value("metresPerBall")),
        gramsPerBall: num(this.value("gramsPerBall")),
        notes: this.value("notes"),
      };

      let saved: Yarn;
      if (this.editing) {
        saved = await api.updateYarn({
          ...this.editing,
          ...shared,
          // Existing lots keep their ids, which is how the backend knows what
          // to keep; a row added in this dialog has none yet.
          lots: lots.map((lot) => ({ ...lot, id: lot.id ?? "", yarnId: this.editing!.id })),
        });
      } else {
        const input: YarnInput = { ...shared, lots };
        saved = await api.addYarn(input);
      }

      // The photo goes up after the save, because it is attached by yarn id
      // and a new yarn only has one now.
      if (this.pendingPhoto) {
        await saveYarnPhoto(saved.id, this.pendingPhoto);
        forgetYarnPhoto(saved.id);
      } else if (this.photoRemoved) {
        await removeYarnPhoto(saved.id);
        forgetYarnPhoto(saved.id);
      }

      this.onDone(saved);
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
    this.root.removeEventListener("click", this.onClick);
    if (this.pendingPhotoUrl) {
      URL.revokeObjectURL(this.pendingPhotoUrl);
      this.pendingPhotoUrl = null;
    }
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function emptyLot(): LotRow {
  return { id: null, dyeLot: "", balls: "", gramsLeft: "", location: "", boughtAt: "" };
}

function field(row: HTMLElement, name: string): string {
  return (row.querySelector(`[data-lf="${name}"]`) as HTMLInputElement).value;
}

/** Parses-or-0 for the number fields. */
function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A stored timestamp as the `YYYY-MM-DD` a date input wants. */
function toDateInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
