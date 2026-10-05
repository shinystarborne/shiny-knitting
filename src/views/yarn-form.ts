import {
  api,
  YARN_WEIGHT_OPTIONS,
  type Fibre,
  type Pattern,
  type Swatch,
  type Yarn,
  type YarnInput,
  type YarnLotInput,
  type YarnPlan,
} from "../api";
import { closestEl } from "../dom";
import {
  forgetYarnPhoto,
  prepareChosenImage,
  removeYarnPhoto,
  saveYarnPhoto,
  yarnPhotoUrl,
} from "../covers";
import { makeCombo } from "./combo";
import { dialogOpen } from "../dialogs";
import { addBallBandDialog, bandKey, bandsByYarn, knownNames, openBallBand, type Band } from "./ball-bands";
import { ballBandUrl } from "../covers";
import { FIBRES, fibreTotal, parseFibres } from "./fibres";
import { canonical, mostUsedSpellings } from "./tool-filter";
import { WEIGHTS, coneCount, familyByMetres, familyOf, grouped, metresPer100g, weightLabel } from "./yarn-weight";
import type { YarnStart } from "./shopping";
import { swatchLine } from "./measure";
import { longDate } from "./project-form";

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
  /** What a finished project left over; the stash tags it. */
  leftover: boolean;
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
  /**
   * The yarn weight field was filled in from the ball band's figures rather
   * than typed, so it may follow them when they change. Typing in it stops that.
   */
  private weightAuto = false;

  private onDone: (yarn: Yarn) => void;
  /**
   * A yarn to start a new one from: another colour of the same yarn, so its
   * brand, name, weight and ball band are filled in and only the colourway is
   * new.
   */
  private template: Yarn | null;
  /**
   * What a new yarn got from the wishlist starts with: its brand, name and
   * colourway as the wishlist had them, the balls bought as its first lot, and
   * its picture.
   */
  private start: (YarnStart & { photo: Blob | null }) | null;
  /**
   * Opening a swatch of this yarn, or adding one in it. Set by whoever opens
   * the form; without them the form has no Swatches section.
   */
  swatchHooks: { open(swatch: Swatch): void; add(yarn: Yarn): void } | null = null;
  /** Every yarn in the stash, for the brand and name lists and filling in. */
  private known: Yarn[] = [];
  /** The fibre rows, as typed: a name and its share. */
  private fibres: { name: string; percent: string }[] = [];
  /** What it is planned for: patterns from the library, or titles typed. */
  private plans: YarnPlan[] = [];
  /** The library, to plan a yarn for one of its patterns. */
  private patterns: Pattern[] = [];
  /** The ball bands, by brand and name, to show this yarn's. */
  private bands = new Map<string, Band>();

  constructor(
    root: HTMLElement,
    editing: Yarn | null,
    onDone: (y: Yarn) => void,
    template: Yarn | null = null,
    start: (YarnStart & { photo: Blob | null }) | null = null,
  ) {
    this.root = root;
    this.editing = editing;
    this.onDone = onDone;
    this.template = editing ? null : template;
    this.start = editing ? null : start;
    this.pendingPhoto = this.start?.photo ?? null;
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
          leftover: lot.leftover ?? false,
        }))
      : this.start
        ? [{ ...emptyLot(), balls: this.start.balls ? String(this.start.balls) : "", boughtAt: toDateInput(this.start.boughtAt ?? Date.now()) }]
        : [emptyLot()];
    const from = editing ?? this.template;
    this.fibres = (from?.fibres ?? []).map((f) => ({ name: f.name, percent: f.percent ? String(f.percent) : "" }));
    if (!this.fibres.length) this.fibres.push({ name: "", percent: "" });
    // Plans are this colour's own: another colour of the yarn starts with none.
    this.plans = (editing?.plans ?? []).map((p) => ({ ...p }));
  }

  open(): void {
    const e = this.editing;
    // What the shared fields start from: the yarn being edited, or the one
    // this is another colour of.
    const base = e ?? this.template;
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal yarn-form" role="dialog" aria-modal="true">
        <h2>${e ? "Edit yarn" : this.template ? `Another colour of ${escapeHtml(this.template.name)}` : this.start ? "Add to the stash, from the wishlist" : "Add a yarn"}</h2>

        <div class="field">
          <span>Photo</span>
          <div class="cover-row">
            <div class="cover-preview" data-el="photobox" title="Drop a picture here, or paste one with Ctrl+V"></div>
            <div class="cover-actions">
              <button class="ghost" data-act="photo-file" type="button">Choose an image…</button>
              <button class="ghost" data-act="photo-remove" type="button">Remove</button>
              <p class="hint">Or paste one with <kbd>Ctrl</kbd>+<kbd>V</kbd> — a picture copied from a shop's page — or drop one on the box. It is scaled down before it is stored.</p>
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <span>Brand</span>
            <input data-f="brand" aria-label="Brand" value="${escapeAttr(base?.brand ?? this.start?.brand ?? "")}" placeholder="Type, or pick one you have" />
          </div>
          <div class="field yarn-name-field">
            <span>Name</span>
            <input data-f="name" aria-label="Name" value="${escapeAttr(base?.name ?? this.start?.name ?? "")}" placeholder="e.g. Felted Tweed — or pick one you have" />
          </div>
        </div>
        <p class="hint" data-el="known-hint" hidden></p>
        <div class="yarn-band" data-el="band"></div>
        <div class="field-row">
          <label class="field">
            <span>Colourway</span>
            <input data-f="colourway" value="${escapeAttr(e?.colourway ?? this.start?.colourway ?? "")}" placeholder="e.g. Peat" />
          </label>
          <label class="field">
            <span class="label-with-help">Yarn weight
              <button class="ghost help-btn" data-act="weight-help" type="button" title="Which weight is which">Weights ?</button>
            </span>
            <input
              data-f="yarnWeight"
              list="yarn-weight-options"
              value="${escapeAttr(base?.yarnWeight ?? "")}"
              placeholder="e.g. DK, 100 m/100g, or 2/28"
            />
            <datalist id="yarn-weight-options">
              ${YARN_WEIGHT_OPTIONS.map((o) => `<option value="${escapeAttr(o)}"></option>`).join("")}
            </datalist>
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>Metres per ball</span>
            <input data-f="metresPerBall" type="number" min="0" value="${base?.metresPerBall || ""}" placeholder="e.g. 175" />
          </label>
          <label class="field">
            <span>Grams per ball</span>
            <input data-f="gramsPerBall" type="number" min="0" value="${base?.gramsPerBall || ""}" placeholder="e.g. 50" />
          </label>
        </div>
        <p class="hint weight-hint" data-el="weight-hint" hidden></p>
        <div class="weight-help" data-el="weight-help" hidden>
          <table>
            <thead><tr><th>Weight</th><th>m per 100 g</th><th>Also called</th><th>Needles</th></tr></thead>
            <tbody>
              ${WEIGHTS.map(
                (w) => `<tr><td>${w.label}</td><td>${w.max === Infinity ? `${w.min}+` : w.min === 0 ? `under ${w.max}` : `${w.min}–${w.max - 1}`}</td><td>${w.aka}</td><td>${w.needles}</td></tr>`,
              ).join("")}
            </tbody>
          </table>
          <p class="hint">
            Type a name, a figure such as <em>230 m/100g</em>, or fill in metres and grams per
            ball and the weight is worked out for you. Cone yarn is labelled by its count:
            <em>2/28</em> is two strands of 28 m to the gram, so 1 400 m/100 g — a lace weight.
            <em>2/2800</em> gives the single strand per 100 g, and is the same yarn.
          </p>
        </div>
        <div class="field">
          <span>Fibre content</span>
          <div class="fibre-list" data-el="fibres"></div>
          <div class="fibre-actions">
            <button class="ghost" data-act="add-fibre" type="button">+ Add fibre</button>
            <input data-el="fibre-text" placeholder="or type it as the ball band does: 75% wool, 25% polyamide" />
          </div>
          <p class="hint" data-el="fibre-total" hidden></p>
          <label class="check superwash">
            <input type="checkbox" data-f="superwash" ${base?.superwash ? "checked" : ""} />
            <span>Superwash <em class="hint">treated, so it can go in the washing machine</em></span>
          </label>
          <label class="check share-fibres" data-el="share-fibres" hidden>
            <input type="checkbox" data-f="shareFibres" checked />
            <span data-el="share-fibres-text"></span>
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="Anything worth remembering about this yarn.">${escapeHtml(
            e?.notes ?? this.start?.notes ?? "",
          )}</textarea>
        </label>

        <div class="field yarn-plans">
          <span>Planned for</span>
          <ul class="plan-list" data-el="plans"></ul>
          <div class="plan-add">
            <input data-el="plan-input" placeholder="Search your patterns, or type a title" aria-label="Planned for" />
            <button class="ghost" data-act="add-plan" type="button">Add</button>
          </div>
          <p class="hint">A pattern from your library, or the title of one you do not have yet.</p>
        </div>

        <div class="field">
          <span>Lots</span>
          <div class="lot-list" data-el="lots"></div>
          <div>
            <button class="ghost" data-act="add-lot" type="button">+ Add lot</button>
          </div>
          <p class="hint">Weigh a partial ball and put the grams in; the metres left are worked out from that.</p>
        </div>

        ${e && this.swatchHooks ? `<div class="field"><span>Swatches</span><div class="yarn-swatches" data-el="swatches"><p class="hint">…</p></div></div>` : ""}

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="primary" data-act="save">${e ? "Save changes" : "Add to stash"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
      </div>
    `;

    this.bind();
    this.renderLots();
    this.renderFibres();
    this.renderPlans();
    void this.paintPhoto();
    this.weightHint();
    void this.renderSwatches();

    // Brand and name are typed, or picked from what is already in the stash;
    // picking a name fills in the rest of that yarn (see fillFromKnown).
    makeCombo(this.root.querySelector<HTMLInputElement>('[data-f="brand"]')!, () =>
      mostUsedSpellings(this.known.map((y) => y.brand)),
    );
    makeCombo(this.root.querySelector<HTMLInputElement>('[data-f="name"]')!, () => this.knownNames());
    // Planned for: a pattern picked from the library goes in as it is picked;
    // a title typed goes in with Enter or Add.
    const planInput = this.root.querySelector<HTMLInputElement>('[data-el="plan-input"]')!;
    makeCombo(planInput, () => this.patterns.map(patternLabel));
    planInput.addEventListener("change", () => {
      if (this.patternFor(planInput.value)) this.addPlan();
    });
    planInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.defaultPrevented) {
        e.preventDefault();
        this.addPlan();
      }
    });
    void api
      .listPatterns({})
      .then((patterns) => (this.patterns = [...patterns].sort((a, b) => a.title.localeCompare(b.title))))
      .catch(() => {});
    void api
      .listYarns({ used: "all" })
      .then((yarns) => {
        this.known = yarns.filter((y) => y.id !== this.editing?.id);
        // Yarn from the wishlist that is already in the stash in another
        // colour takes its weight, ball band and fibres from there.
        if (this.start) this.fillFromKnown();
        // A colour with no fibres yet takes them from another colour of it.
        if (this.editing) this.fillFibresFromKnown();
        void this.loadBands();
        this.shareHint();
      })
      .catch(() => {});
    if (this.start) {
      this.showKnownHint("Filled in from the wishlist. Check the name and colourway, and add what the ball band says.");
    }
    if (this.template) {
      this.showKnownHint(`Filled in from ${this.template.name}${this.template.colourway ? ` (${this.template.colourway})` : ""}. Add the colourway, and its lots.`);
      (this.root.querySelector('[data-f="colourway"]') as HTMLInputElement | null)?.focus();
    }
  }

  /** The yarn names to offer: that brand's, once a brand is given; else every one. */
  private knownNames(): string[] {
    const brand = this.value("brand").trim().toLowerCase();
    const ofBrand = brand ? this.known.filter((y) => y.brand.trim().toLowerCase() === brand) : [];
    return mostUsedSpellings((ofBrand.length ? ofBrand : this.known).map((y) => y.name));
  }

  /** The other colours of the yarn named in the form: the same brand and name, newest first. */
  private otherColours(): Yarn[] {
    const name = this.value("name").trim().toLowerCase();
    if (!name) return [];
    const brand = this.value("brand").trim().toLowerCase();
    return this.known
      .filter((y) => y.name.trim().toLowerCase() === name && y.brand.trim().toLowerCase() === brand)
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  /** Puts in the fibres and superwash of the newest of these colours that has fibres, if none are typed yet. */
  private takeFibresFrom(colours: Yarn[]): Yarn | null {
    const from = colours.find((y) => y.fibres.length);
    this.readFibres();
    if (!from || this.fibres.some((f) => f.name.trim())) return null;
    this.fibres = from.fibres.map((f) => ({ name: f.name, percent: f.percent ? String(f.percent) : "" }));
    this.renderFibres();
    const superwash = this.root.querySelector<HTMLInputElement>('[data-f="superwash"]');
    if (superwash && from.superwash) superwash.checked = true;
    return from;
  }

  /** Editing a colour that has no fibres: they come from another colour of the same yarn, to save or change. */
  private fillFibresFromKnown(): void {
    const from = this.takeFibresFrom(this.otherColours());
    if (from) this.showKnownHint(`Filled in the fibres from your ${from.name}${from.colourway ? ` (${from.colourway})` : ""}. Save to keep them.`);
  }

  /**
   * Offers to give the yarn's other colours the fibre content being saved,
   * when some of them have other fibres or none: the fibres are the yarn's,
   * whatever its colour.
   */
  private shareHint(): void {
    const label = this.root.querySelector<HTMLElement>('[data-el="share-fibres"]');
    if (!label) return;
    const fibres = this.fibreValues();
    const superwash = (this.root.querySelector('[data-f="superwash"]') as HTMLInputElement | null)?.checked ?? false;
    const differ = fibres.length ? this.otherColours().filter((y) => !sameFibres(y.fibres, fibres) || y.superwash !== superwash) : [];
    label.hidden = !differ.length;
    if (!differ.length) return;
    const yarn = `${this.value("brand").trim()} ${this.value("name").trim()}`.trim();
    const count = differ.length === 1 ? "other colour" : `${differ.length} other colours`;
    this.root.querySelector('[data-el="share-fibres-text"]')!.textContent = `Give the ${count} of ${yarn} the same fibre content and superwash`;
  }

  /**
   * A name that is already in the stash fills in the rest of that yarn --
   * brand, weight, metres and grams per ball -- so a new colour of it is only
   * its colourway. Only empty fields are filled: anything typed is kept.
   */
  private fillFromKnown(): void {
    if (this.editing) return;
    const name = this.value("name").trim().toLowerCase();
    if (!name) return;
    const brand = this.value("brand").trim().toLowerCase();
    const same = this.known
      .filter((y) => y.name.trim().toLowerCase() === name && (!brand || y.brand.trim().toLowerCase() === brand))
      .sort((a, b) => b.addedAt - a.addedAt);
    const from = same[0];
    if (!from) return;
    const filled: string[] = [];
    // Each from the newest colour that has it: an older colour may have what
    // the newest was saved without.
    const fill = (field: string, value: (y: Yarn) => string | number, what: string) => {
      const input = this.root.querySelector<HTMLInputElement>(`[data-f="${field}"]`);
      const has = same.find((y) => value(y));
      if (!input || input.value.trim() || !has) return;
      input.value = String(value(has));
      filled.push(what);
    };
    fill("brand", (y) => y.brand, "brand");
    fill("yarnWeight", (y) => y.yarnWeight, "weight");
    fill("metresPerBall", (y) => y.metresPerBall, "metres");
    fill("gramsPerBall", (y) => y.gramsPerBall, "grams per ball");
    // Its fibres and superwash too, when none are typed yet.
    if (this.takeFibresFrom(same)) filled.push("fibres");
    if (filled.length) {
      this.weightAuto = false;
      this.weightHint();
      const list = filled.length > 1 ? `${filled.slice(0, -1).join(", ")} and ${filled[filled.length - 1]}` : filled[0];
      this.showKnownHint(`Filled in the ${list} from your ${from.name}${from.colourway ? ` (${from.colourway})` : ""}.`);
    }
  }

  private showKnownHint(text: string): void {
    const hint = this.root.querySelector<HTMLElement>('[data-el="known-hint"]');
    if (!hint) return;
    hint.textContent = text;
    hint.hidden = !text;
  }

  private bind(): void {
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("input", this.onInput);
    this.root.querySelector('[data-f="name"]')?.addEventListener("change", () => this.fillFromKnown());
    const fibreText = this.root.querySelector<HTMLInputElement>('[data-el="fibre-text"]');
    fibreText?.addEventListener("change", () => this.takeFibreText());
    fibreText?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.takeFibreText();
      }
    });
    // On the document: a paste with nothing focused goes to the body, not to
    // the form, and pasting a picture should work wherever the focus is.
    document.addEventListener("paste", this.onPaste);
    const box = this.root.querySelector<HTMLElement>('[data-el="photobox"]');
    box?.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("over");
    });
    box?.addEventListener("dragleave", () => box.classList.remove("over"));
    box?.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void this.takePhoto(file);
      else this.showError("That is not a picture. Drop an image file, or paste a picture.");
    });
  }

  /**
   * A picture pasted with Ctrl+V: one copied from a shop's page, or a
   * screenshot. Only a picture is taken -- text pastes into the field it was
   * meant for, as usual.
   */
  private onPaste = (e: ClipboardEvent): void => {
    // A dialog over the form (a ball band being added) takes its own paste.
    if (dialogOpen()) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void this.takePhoto(file);
  };

  private async takePhoto(file: File): Promise<void> {
    // Downscaled here in the webview, before a byte is uploaded; a phone
    // photo should never cross the boundary at full size.
    const blob = await prepareChosenImage(file);
    if (!blob) {
      this.showError("That could not be read as a picture.");
      return;
    }
    this.pendingPhoto = blob;
    this.photoRemoved = false;
    await this.paintPhoto();
  }

  private onInput = (e: Event): void => {
    const f = (e.target as HTMLElement).dataset.f;
    if (f === "yarnWeight") this.weightAuto = false;
    if (f === "yarnWeight" || f === "metresPerBall" || f === "gramsPerBall") this.weightHint();
    if ((e.target as HTMLElement).closest(".fibre-row")) this.fibreHint();
    if (f === "superwash" || f === "name" || f === "brand" || (e.target as HTMLElement).closest(".fibre-row")) this.shareHint();
    if (f === "name" || f === "brand") this.renderBand();
  };

  /**
   * Says which weight the figures make, and fills the weight in from the ball
   * band when it has not been typed: "175 m / 50 g = 350 m/100 g: Sport". A
   * cone count typed as the weight is read the same way, and with the cone's
   * grams known gives its metres too.
   */
  private weightHint(): void {
    const hint = this.root.querySelector<HTMLElement>('[data-el="weight-hint"]');
    const weight = this.root.querySelector<HTMLInputElement>('[data-f="yarnWeight"]');
    const metresField = this.root.querySelector<HTMLInputElement>('[data-f="metresPerBall"]');
    if (!hint || !weight || !metresField) return;
    const metres = num(metresField.value);
    const grams = num(this.value("gramsPerBall"));
    const typed = weight.value.trim();
    const parts: string[] = [];

    const cone = !metresPer100g(typed) ? coneCount(typed) : null;
    if (cone) {
      parts.push(`${typed} is about ${grouped(cone)} m/100 g: ${familyByMetres(cone).label}.`);
      if (grams && !metres) parts.push(`A ${grouped(grams)} g cone is about ${grouped((cone * grams) / 100)} m.`);
    }
    if (metres && grams) {
      const per100 = (metres / grams) * 100;
      const family = familyByMetres(per100);
      parts.push(`${grouped(metres)} m / ${grouped(grams)} g = ${grouped(per100)} m/100 g: ${family.label}.`);
      if (!typed || this.weightAuto) {
        weight.value = family.label;
        this.weightAuto = true;
      } else {
        const stated = familyOf(typed);
        // The ball band and the stated weight disagree -- common at the edges:
        // Drops Paris is sold as Aran at 150 m/100 g. The stated one is kept.
        if (stated && stated !== family.key) parts.push(`It stays filed as ${weightLabel(stated)}, as you wrote it.`);
      }
    } else if (this.weightAuto) {
      weight.value = "";
    }
    hint.textContent = parts.join(" ");
    hint.hidden = !parts.length;
  }

  /**
   * The form's one click handler, kept as a field so `close` can remove it.
   *
   * The modal element is shared by every form the app opens, and a listener
   * left behind would still fire for the next form: the old instance's Save
   * would run alongside the new one's, and a yarn would be added twice.
   */
  /** This yarn's swatches, the newest first, for its Swatches section. */
  private swatchList: Swatch[] = [];

  /** Lists the swatches knitted in this yarn, each opening its own form. */
  private async renderSwatches(): Promise<void> {
    const host = this.root.querySelector<HTMLElement>('[data-el="swatches"]');
    const yarn = this.editing;
    if (!host || !yarn) return;
    const [swatches, unit] = await Promise.all([
      api.listSwatches().catch(() => [] as Swatch[]),
      api.getMeasureUnit().catch(() => "cm" as const),
    ]);
    this.swatchList = swatches.filter((s) => s.yarnId === yarn.id);
    host.innerHTML = `
      ${
        this.swatchList.length
          ? `<ul class="tool-list">${this.swatchList
              .map(
                (s) => `<li><button class="link" type="button" data-act="open-swatch" data-id="${escapeAttr(s.id)}">${escapeHtml(swatchLine(s, unit))}${s.stitch ? ` · ${escapeHtml(s.stitch)}` : ""}</button><span class="hint">${escapeHtml(longDate(s.madeAt))}</span></li>`,
              )
              .join("")}</ul>`
          : `<p class="hint">Not swatched yet.</p>`
      }
      <div><button class="ghost" type="button" data-act="add-swatch">+ Add a swatch</button></div>`;
  }

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
    // A swatch opens in its own form, in place of this one.
    if (btn.dataset.act === "open-swatch" || btn.dataset.act === "add-swatch") {
      const hooks = this.swatchHooks;
      const yarn = this.editing;
      const swatch = this.swatchList.find((s) => s.id === btn.dataset.id);
      this.close();
      if (hooks && swatch) hooks.open(swatch);
      else if (hooks && yarn) hooks.add(yarn);
    }
    if (btn.dataset.act === "add-plan") this.addPlan();
    if (btn.dataset.act === "open-band" || btn.dataset.act === "add-band") void this.bandAction(btn.dataset.act);
    if (btn.dataset.act === "remove-plan") {
      this.plans.splice(Number(btn.dataset.plan), 1);
      this.renderPlans();
    }
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
    if (btn.dataset.act === "add-fibre") {
      this.readFibres();
      this.fibres.push({ name: "", percent: "" });
      this.renderFibres();
      this.root.querySelector<HTMLInputElement>(".fibre-row:last-child [data-fibre-name]")?.focus();
    }
    if (btn.dataset.act === "remove-fibre") {
      this.readFibres();
      this.fibres.splice(Number(btn.dataset.fibre), 1);
      if (!this.fibres.length) this.fibres.push({ name: "", percent: "" });
      this.renderFibres();
    }
    if (btn.dataset.act === "photo-file") void this.choosePhoto();
    if (btn.dataset.act === "weight-help") {
      const help = this.root.querySelector<HTMLElement>('[data-el="weight-help"]');
      if (help) help.hidden = !help.hidden;
    }
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
            <label class="lot-leftover" title="What a finished project left over">
              <input type="checkbox" data-lf="leftover" ${lot.leftover ? "checked" : ""} /> Leftover
            </label>
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
      leftover: (row.querySelector('[data-lf="leftover"]') as HTMLInputElement).checked,
    }));
  }

  // ---------- its ball band ----------

  private async loadBands(): Promise<void> {
    this.bands = await bandsByYarn().catch(() => new Map<string, Band>());
    this.renderBand();
  }

  /** The yarn's ball band, small, to open big; or, for a yarn named, a button to add one. */
  private renderBand(): void {
    const host = this.root.querySelector<HTMLElement>('[data-el="band"]');
    if (!host) return;
    const brand = this.value("brand").trim();
    const name = this.value("name").trim();
    const band = name ? this.bands.get(bandKey(brand, name)) : undefined;
    if (band) {
      host.innerHTML = `
        <span class="yarn-band-label">Ball band</span>
        ${band.pictures
          .slice(0, 3)
          .map((p) => `<button type="button" class="yarn-band-pic" data-act="open-band" title="See it big"><img data-band-pic="${escapeAttr(p.id)}" alt="Ball band" /></button>`)
          .join("")}
        ${band.pictures.length > 3 ? `<span class="hint">+${band.pictures.length - 3}</span>` : ""}`;
      for (const img of host.querySelectorAll<HTMLImageElement>("img[data-band-pic]")) void ballBandUrl(img.dataset.bandPic!).then((url) => url && (img.src = url));
      return;
    }
    host.innerHTML = name
      ? `<span class="hint">No ball band for ${escapeHtml([brand, name].filter(Boolean).join(" "))} yet.</span>
         <button type="button" class="ghost" data-act="add-band">Add its ball band…</button>`
      : "";
  }

  private async bandAction(act: string): Promise<void> {
    const brand = this.value("brand").trim();
    const name = this.value("name").trim();
    const changed = act === "open-band" ? await openBallBand(brand, name) : await addBallBandDialog(brand, name, knownNames(this.known, [...this.bands.values()]));
    if (changed) await this.loadBands();
  }

  // ---------- planned for ----------

  /** The library pattern a choice or a typed title names: "Title — Designer", or the title alone if only one has it. */
  private patternFor(text: string): Pattern | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const byLabel = this.patterns.find((p) => patternLabel(p).toLowerCase() === t);
    if (byLabel) return byLabel;
    const byTitle = this.patterns.filter((p) => p.title.trim().toLowerCase() === t);
    return byTitle.length === 1 ? byTitle[0] : null;
  }

  private addPlan(): void {
    const input = this.root.querySelector<HTMLInputElement>('[data-el="plan-input"]');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const pattern = this.patternFor(text);
    const plan: YarnPlan = pattern ? { patternId: pattern.id, title: pattern.title } : { patternId: null, title: text };
    const there = this.plans.some((p) => (p.patternId || plan.patternId ? p.patternId === plan.patternId : p.title.toLowerCase() === plan.title.toLowerCase()));
    if (!there) this.plans.push(plan);
    input.value = "";
    this.renderPlans();
  }

  private renderPlans(): void {
    const list = this.root.querySelector<HTMLElement>('[data-el="plans"]');
    if (!list) return;
    list.hidden = !this.plans.length;
    list.innerHTML = this.plans
      .map(
        (p, i) => `
          <li class="plan-item">
            <span class="plan-title">${escapeHtml(p.title)}</span>
            <span class="hint">${p.patternId ? "in your library" : "not in your library"}</span>
            <button class="ghost" data-act="remove-plan" data-plan="${i}" type="button" title="Not planned for this">×</button>
          </li>`,
      )
      .join("");
  }

  // ---------- fibres ----------

  private renderFibres(): void {
    const holder = this.root.querySelector('[data-el="fibres"]')!;
    holder.innerHTML = this.fibres
      .map(
        (f, i) => `
          <div class="fibre-row" data-fibre="${i}">
            <input data-fibre-name value="${escapeAttr(f.name)}" placeholder="e.g. wool" aria-label="Fibre" />
            <span class="fibre-percent"><input data-fibre-percent type="number" min="0" max="100" step="any"
              value="${escapeAttr(f.percent)}" aria-label="Share" placeholder="%" />%</span>
            <button class="ghost" data-act="remove-fibre" data-fibre="${i}" type="button" title="Remove this fibre">×</button>
          </div>`,
      )
      .join("");
    // Each one types, or picks: the fibres already in the stash first, then the usual ones.
    for (const input of holder.querySelectorAll<HTMLInputElement>("[data-fibre-name]")) {
      makeCombo(input, () => this.fibreChoices());
    }
    this.fibreHint();
    this.shareHint();
  }

  private fibreChoices(): string[] {
    const used = mostUsedSpellings(this.known.flatMap((y) => y.fibres.map((f) => f.name)));
    const lower = new Set(used.map((u) => u.toLowerCase()));
    return [...used, ...FIBRES.map((f) => f.name).filter((n) => !lower.has(n))];
  }

  private readFibres(): void {
    const rows = this.root.querySelectorAll<HTMLElement>(".fibre-row");
    if (!rows.length) return;
    this.fibres = [...rows].map((row) => ({
      name: row.querySelector<HTMLInputElement>("[data-fibre-name]")!.value,
      percent: row.querySelector<HTMLInputElement>("[data-fibre-percent]")!.value,
    }));
  }

  /** The fibres as they will be saved. */
  private fibreValues(): Fibre[] {
    this.readFibres();
    const known = this.fibreChoices();
    return this.fibres
      .filter((f) => f.name.trim())
      .map((f) => ({ name: canonical(f.name, known), percent: num(f.percent) }));
  }

  /** Whether the shares add up to the whole yarn. */
  private fibreHint(): void {
    const hint = this.root.querySelector<HTMLElement>('[data-el="fibre-total"]');
    if (!hint) return;
    this.readFibres();
    const values = this.fibres.filter((f) => f.name.trim() || f.percent).map((f) => ({ name: f.name, percent: num(f.percent) }));
    const total = fibreTotal(values);
    hint.hidden = !values.some((v) => v.percent);
    hint.classList.toggle("bad", total !== 100);
    hint.textContent = total === 100 ? "Adds up to 100%." : `Adds up to ${total}%; a ball band's shares make 100%.`;
  }

  /** "75% wool, 25% polyamide" typed in one go becomes the rows. */
  private takeFibreText(): void {
    const field = this.root.querySelector<HTMLInputElement>('[data-el="fibre-text"]');
    if (!field || !field.value.trim()) return;
    const parsed = parseFibres(field.value);
    if (!parsed.length) return;
    this.readFibres();
    const kept = this.fibres.filter((f) => f.name.trim());
    this.fibres = [...kept, ...parsed.map((f) => ({ name: f.name, percent: f.percent ? String(f.percent) : "" }))];
    field.value = "";
    this.renderFibres();
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
          leftover: lot.leftover,
        }))
        .filter(
          (lot) =>
            lot.dyeLot || lot.balls > 0 || lot.gramsLeft > 0 || lot.location || lot.boughtAt != null,
        );

      const shared = {
        // The same brand or yarn typed in another case files with the one
        // already there, so the lists do not fill with near-twins.
        name: canonical(name, mostUsedSpellings(this.known.map((y) => y.name))),
        brand: canonical(this.value("brand"), mostUsedSpellings(this.known.map((y) => y.brand))),
        colourway: this.value("colourway").trim(),
        yarnWeight: this.value("yarnWeight").trim(),
        metresPerBall: num(this.value("metresPerBall")),
        gramsPerBall: num(this.value("gramsPerBall")),
        notes: this.value("notes"),
        fibres: this.fibreValues(),
        superwash: (this.root.querySelector('[data-f="superwash"]') as HTMLInputElement).checked,
        plans: this.plans,
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

      // The other colours of the yarn get its fibres, when that was offered and left ticked.
      const share = this.root.querySelector<HTMLElement>('[data-el="share-fibres"]');
      const shareBox = this.root.querySelector<HTMLInputElement>('[data-f="shareFibres"]');
      if (share && !share.hidden && shareBox?.checked && shared.fibres.length) {
        for (const other of this.otherColours()) {
          if (other.id === saved.id || (sameFibres(other.fibres, shared.fibres) && other.superwash === shared.superwash)) continue;
          await api.updateYarn({ ...other, fibres: shared.fibres, superwash: shared.superwash });
        }
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
    this.root.removeEventListener("input", this.onInput);
    document.removeEventListener("paste", this.onPaste);
    if (this.pendingPhotoUrl) {
      URL.revokeObjectURL(this.pendingPhotoUrl);
      this.pendingPhotoUrl = null;
    }
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

function emptyLot(): LotRow {
  return { id: null, dyeLot: "", balls: "", gramsLeft: "", location: "", boughtAt: "", leftover: false };
}

function field(row: HTMLElement, name: string): string {
  return (row.querySelector(`[data-lf="${name}"]`) as HTMLInputElement).value;
}

/** A pattern as the Planned for list offers it: its title, and its designer when there is one. */
function patternLabel(p: Pattern): string {
  return p.designer.trim() ? `${p.title} — ${p.designer.trim()}` : p.title;
}

/** Whether two fibre contents are the same, whatever the case and order. */
function sameFibres(a: Fibre[], b: Fibre[]): boolean {
  const key = (list: Fibre[]) => list.map((f) => `${f.name.trim().toLowerCase()}:${f.percent || 0}`).sort().join("|");
  return key(a) === key(b);
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
