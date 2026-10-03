import { api, isLive, toBytes, WISH_KINDS, type LinkPreview, type Project, type Shop, type Wish, type WishInput, type WishKind } from "../api";
import { forgetWishPhoto, prepareChosenImage, wishPhotoUrl } from "../covers";
import { askText } from "../dialogs";
import { closestEl } from "../dom";
import { shopForUrl, siteOf } from "./shopping";

/** The shop picker's "no shop" choice, and the one that adds a shop. */
const NO_SHOP = "";
const NEW_SHOP = "__new__";

/** What a wish can be started with, from wherever it is added. */
export type WishTemplate = Partial<Pick<WishInput, "kind" | "shopId" | "projectId">>;

/**
 * The add/edit dialog for something on the wishlist.
 *
 * Pasting a link reads the shop's page for the name, brand, price and
 * picture, and fills in whichever of those are still empty: nothing typed is
 * ever replaced. The link also picks its shop, when it is on one in the Shops
 * tab and no shop was chosen yet. A picture can be pasted, dropped or chosen
 * as well, like a yarn's. "Save and add another" keeps the kind, shop and
 * project, since a shopping trip is usually several things from one place.
 */
export class WishForm {
  private root: HTMLElement;
  private editing: Wish | null;
  private template: WishTemplate;
  private onDone: (wish: Wish) => void;
  private shops: Shop[] = [];
  /** The projects a wish can be for: those not finished or frogged, and its own. */
  private projects: Project[] = [];
  /** The shop was chosen by hand, so a pasted link leaves it alone. */
  private shopChosen = false;
  /** A picture waiting for the save, already downscaled. */
  private pendingPhoto: Blob | null = null;
  private pendingPhotoUrl: string | null = null;
  private photoRemoved = false;
  /** The link last read, so the same one is not read twice. */
  private fetchedUrl = "";
  /** Counts reads, so one overtaken by a newer link fills nothing in. */
  private fetchToken = 0;

  constructor(root: HTMLElement, editing: Wish | null, onDone: (wish: Wish) => void, template: WishTemplate = {}) {
    this.root = root;
    this.editing = editing;
    this.template = template;
    this.onDone = onDone;
  }

  async open(): Promise<void> {
    const [shops, projects] = await Promise.all([
      api.listShops().catch(() => [] as Shop[]),
      api.listProjects().catch(() => [] as Project[]),
    ]);
    const e = this.editing;
    this.shops = shops;
    this.projects = projects.filter((p) => isLive(p.status) || p.id === e?.projectId);
    this.shopChosen = !!(e?.shopId ?? this.template.shopId);
    this.fetchedUrl = e?.url ?? "";

    const kind: WishKind = e?.kind ?? this.template.kind ?? "yarn";
    const projectId = e?.projectId ?? this.template.projectId ?? "";
    this.root.className = "modal-backdrop";
    this.root.innerHTML = `
      <div class="modal wish-form" role="dialog" aria-modal="true">
        <h2>${e ? "Edit wishlist item" : "Add to the wishlist"}</h2>

        <label class="field">
          <span>Link</span>
          <div class="wish-link-row">
            <input data-f="url" value="${escapeAttr(e?.url ?? "")}" placeholder="Paste the page from the shop: the rest fills itself in" autocomplete="off" spellcheck="false" />
            <button class="ghost" type="button" data-act="fetch" title="Read the name, brand, price and picture from the page">Fetch details</button>
          </div>
          <span class="hint" data-el="fetch-status" hidden></span>
        </label>

        <div class="wish-main-row">
          <div class="field">
            <span>Picture</span>
            <div class="wish-photo-box" data-el="photobox" title="Fetched from the link, or paste one with Ctrl+V, or drop one here"></div>
            <div class="wish-photo-actions">
              <button class="ghost" data-act="photo-file" type="button">Choose…</button>
              <button class="ghost" data-act="photo-remove" type="button">Remove</button>
            </div>
          </div>
          <div class="wish-main-fields">
            <div class="field-row wish-what">
              <label class="field">
                <span>Kind</span>
                <select data-f="kind">
                  ${WISH_KINDS.map((k) => `<option value="${k.key}" ${k.key === kind ? "selected" : ""}>${escapeHtml(k.label)}</option>`).join("")}
                </select>
              </label>
              <label class="field">
                <span>What</span>
                <input data-f="name" value="${escapeAttr(e?.name ?? "")}" placeholder="e.g. Alpaca, light grey mix" />
              </label>
            </div>
            <div class="field-row wish-three">
              <label class="field">
                <span>Brand</span>
                <input data-f="brand" value="${escapeAttr(e?.brand ?? "")}" placeholder="e.g. DROPS" />
              </label>
              <label class="field">
                <span>How much</span>
                <input data-f="amount" value="${escapeAttr(e?.amount ?? "")}" placeholder="e.g. 6 balls" />
              </label>
              <label class="field">
                <span>Price</span>
                <input data-f="price" value="${escapeAttr(e?.price ?? "")}" placeholder="e.g. €3.95 a ball" />
              </label>
            </div>
          </div>
        </div>

        <div class="field-row">
          <label class="field">
            <span>Shop</span>
            <select data-f="shop">${this.shopOptions(e?.shopId ?? this.template.shopId ?? NO_SHOP)}</select>
          </label>
          <label class="field">
            <span>For</span>
            <select data-f="project">
              <option value="">Nothing in particular</option>
              ${this.projects
                .map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === projectId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
                .join("")}
            </select>
          </label>
        </div>
        <p class="hint" data-el="shop-hint" hidden></p>

        <label class="field">
          <span>Notes</span>
          <textarea data-f="notes" placeholder="A colour number, a size, wait for the sale…">${escapeHtml(e?.notes ?? "")}</textarea>
        </label>

        <div class="modal-actions">
          <button class="ghost" data-act="cancel">Cancel</button>
          ${e ? "" : `<button class="ghost" data-act="save-another" title="Save this one and start the next, from the same shop">Save and add another</button>`}
          <button class="primary" data-act="save">${e ? "Save changes" : "Add"}</button>
        </div>
        <p class="form-error" data-el="error" hidden></p>
        <p class="form-saved" data-el="saved" hidden></p>
      </div>
    `;
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("change", this.onChange);
    this.root.addEventListener("keydown", this.onKey);
    document.addEventListener("paste", this.onPaste);
    const url = this.field("url");
    url.addEventListener("input", () => this.shopFromLink());
    // A pasted link is read at once; a typed one when it is left.
    url.addEventListener("paste", () => window.setTimeout(() => void this.fetchDetails(false), 0));
    url.addEventListener("change", () => void this.fetchDetails(false));
    this.bindPhotoBox();
    void this.paintPhoto();
    (e ? this.field("name") : url).focus();
  }

  private shopOptions(chosen: string): string {
    return `
      <option value="${NO_SHOP}" ${chosen === NO_SHOP ? "selected" : ""}>No shop</option>
      ${this.shops.map((s) => `<option value="${escapeAttr(s.id)}" ${s.id === chosen ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      <option value="${NEW_SHOP}">+ New shop…</option>`;
  }

  /** A link picks its shop, unless one was chosen by hand. */
  private shopFromLink(): void {
    if (this.shopChosen) return;
    const hint = this.root.querySelector<HTMLElement>('[data-el="shop-hint"]')!;
    const select = this.field<HTMLSelectElement>("shop");
    const shop = shopForUrl(normalised(this.field("url").value), this.shops);
    select.value = shop?.id ?? NO_SHOP;
    hint.textContent = shop ? `${shop.name}, from the link.` : "";
    hint.hidden = !shop;
  }

  // ---------- reading the link ----------

  /**
   * Reads the shop's page and fills in what is still empty. `again` is the
   * Fetch details button, which reads a link even if it was read already.
   */
  private async fetchDetails(again: boolean): Promise<void> {
    const url = normalised(this.field("url").value);
    if (!url) {
      if (again) this.status("Paste a link first.", "bad");
      return;
    }
    if (url === this.fetchedUrl && !again) return;
    this.fetchedUrl = url;
    const token = ++this.fetchToken;
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="fetch"]');
    if (button) button.disabled = true;
    this.status("Reading the page…");
    try {
      const preview = await api.fetchLinkPreview(url);
      if (token !== this.fetchToken || !this.root.isConnected) return;
      const filled = this.fill(preview);
      // The picture comes after: the words are there to check meanwhile.
      if (preview.imageUrl && !this.hasPhoto()) {
        this.status(filled.length ? `Filled in the ${list(filled)}. Getting the picture…` : "Getting the picture…");
        if (await this.takeRemotePhoto(preview.imageUrl, token)) filled.push("picture");
      }
      if (token !== this.fetchToken) return;
      this.status(
        filled.length
          ? `Filled in the ${list(filled)} from the page.`
          : preview.title || preview.price
            ? "Nothing new on the page: what it says is filled in already."
            : "The page did not say what is on it. Fill the details in yourself.",
        filled.length ? "ok" : "",
      );
    } catch (err) {
      if (token !== this.fetchToken) return;
      this.status(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      if (token === this.fetchToken && button) button.disabled = false;
    }
  }

  /** Fills the empty fields from a page; returns what was filled. */
  private fill(preview: LinkPreview): string[] {
    const filled: string[] = [];
    const put = (name: string, value: string, what: string) => {
      const input = this.field(name);
      if (!value || input.value.trim()) return;
      input.value = value;
      filled.push(what);
    };
    put("brand", preview.brand, "brand");
    put("name", withoutBrand(preview.title, this.field("brand").value), "name");
    put("price", preview.price, "price");
    // The link stays as pasted, even when the shop redirected it: a shop
    // sends a sold-out item to its category page, which is not the item.
    this.shopFromLink();
    return filled;
  }

  /** Fetches the page's picture and takes it, downscaled; false when it could not be. */
  private async takeRemotePhoto(imageUrl: string, token: number): Promise<boolean> {
    try {
      const raw = await api.fetchLinkImage(imageUrl);
      if (token !== this.fetchToken || this.hasPhoto()) return false;
      const blob = await prepareChosenImage(new Blob([toBytes(raw)]));
      if (!blob || token !== this.fetchToken) return false;
      this.pendingPhoto = blob;
      this.photoRemoved = false;
      await this.paintPhoto();
      return true;
    } catch {
      // Words without a picture are still worth having.
      return false;
    }
  }

  private status(text: string, tone: "" | "ok" | "bad" = ""): void {
    const el = this.root.querySelector<HTMLElement>('[data-el="fetch-status"]');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("ok", tone === "ok");
    el.classList.toggle("bad", tone === "bad");
  }

  // ---------- the picture ----------

  private hasPhoto(): boolean {
    return !!this.pendingPhoto || (!!this.editing?.photoPath && !this.photoRemoved);
  }

  private bindPhotoBox(): void {
    const box = this.root.querySelector<HTMLElement>('[data-el="photobox"]')!;
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void this.takePhoto(file);
      else this.showError("That is not a picture. Drop an image file, or paste a picture.");
    });
  }

  /** A picture pasted with Ctrl+V, wherever the focus is; text pastes as usual. */
  private onPaste = (e: ClipboardEvent): void => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void this.takePhoto(file);
  };

  private async takePhoto(file: Blob): Promise<void> {
    const blob = await prepareChosenImage(file);
    if (!blob) return this.showError("That could not be read as a picture.");
    this.pendingPhoto = blob;
    this.photoRemoved = false;
    await this.paintPhoto();
  }

  private choosePhoto(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.takePhoto(file);
    });
    input.click();
  }

  /** Shows the waiting picture, else the stored one, else an empty box. */
  private async paintPhoto(): Promise<void> {
    const box = this.root.querySelector<HTMLElement>('[data-el="photobox"]');
    if (!box) return;
    let url: string | null = null;
    if (this.pendingPhoto) {
      if (this.pendingPhotoUrl) URL.revokeObjectURL(this.pendingPhotoUrl);
      this.pendingPhotoUrl = URL.createObjectURL(this.pendingPhoto);
      url = this.pendingPhotoUrl;
    } else if (this.editing?.photoPath && !this.photoRemoved) {
      url = await wishPhotoUrl(this.editing.id);
    }
    box.classList.toggle("filled", !!url);
    box.style.backgroundImage = url ? `url("${url}")` : "";
  }

  // ---------- the shop picker ----------

  private onChange = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (target.dataset.f !== "shop") return;
    const select = target as HTMLSelectElement;
    if (select.value === NEW_SHOP) {
      void this.newShop();
      return;
    }
    this.shopChosen = select.value !== NO_SHOP;
    this.root.querySelector<HTMLElement>('[data-el="shop-hint"]')!.hidden = true;
  };

  /**
   * Adds a shop from the picker. Its address is the link's site, when there is
   * a link, and its name is asked, starting from that site.
   */
  private async newShop(): Promise<void> {
    const select = this.field<HTMLSelectElement>("shop");
    const site = siteOf(normalised(this.field("url").value));
    // The question starts from what the shop calls itself, when its page says.
    let suggested = site;
    if (site) {
      this.status("Looking up the shop's name…");
      suggested = (await api.fetchShopName(normalised(this.field("url").value)).catch(() => "")) || site;
      this.status("");
    }
    const name = await askText("What is the shop called?", {
      title: "New shop",
      value: suggested,
      placeholder: "e.g. Wolle Rödel",
      okLabel: "Add the shop",
    });
    if (name === null || (!name.trim() && !site)) {
      select.value = NO_SHOP;
      return;
    }
    try {
      const shop = await api.addShop({ name, url: site ? `https://${site}` : "", comment: "", tags: [] });
      this.shops = [...this.shops, shop].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      select.innerHTML = this.shopOptions(shop.id);
      this.shopChosen = true;
    } catch (err) {
      select.value = NO_SHOP;
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------- saving ----------

  private onClick = (e: MouseEvent): void => {
    if (e.target === this.root) return this.close();
    const act = closestEl(e.target, "button[data-act]")?.dataset.act;
    if (act === "cancel") this.close();
    if (act === "save") void this.save(false);
    if (act === "save-another") void this.save(true);
    if (act === "fetch") void this.fetchDetails(true);
    if (act === "photo-file") this.choosePhoto();
    if (act === "photo-remove") {
      this.pendingPhoto = null;
      this.photoRemoved = true;
      void this.paintPhoto();
    }
  };

  /** Enter in a one-line field saves, as it would in any form; in the link, it reads the page. */
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || (e.target as HTMLElement).tagName !== "INPUT") return;
    e.preventDefault();
    if ((e.target as HTMLElement).dataset.f === "url") void this.fetchDetails(false);
    else void this.save(false);
  };

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.root.querySelector<T>(`[data-f="${name}"]`)!;
  }

  private input(): WishInput {
    const value = (name: string) => this.field<HTMLInputElement>(name).value;
    const shop = value("shop");
    return {
      kind: value("kind") as WishKind,
      name: value("name"),
      brand: value("brand"),
      amount: value("amount"),
      price: value("price"),
      url: value("url"),
      shopId: shop && shop !== NEW_SHOP ? shop : null,
      projectId: value("project") || null,
      notes: value("notes"),
    };
  }

  private async save(another: boolean): Promise<void> {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".modal-actions button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const saved = this.editing ? await api.updateWish(this.editing.id, this.input()) : await api.addWish(this.input());
      // The picture goes up after the save: a new item has no id until then.
      if (this.pendingPhoto) {
        await api.setWishPhoto(saved.id, Array.from(new Uint8Array(await this.pendingPhoto.arrayBuffer())));
        forgetWishPhoto(saved.id);
      } else if (this.photoRemoved && this.editing?.photoPath) {
        await api.removeWishPhoto(saved.id);
        forgetWishPhoto(saved.id);
      }
      if (another) {
        // The kind, shop and project stay; the rest is the next thing's.
        for (const name of ["name", "brand", "amount", "price", "url", "notes"]) this.field(name).value = "";
        this.pendingPhoto = null;
        this.photoRemoved = false;
        this.fetchedUrl = "";
        this.fetchToken++;
        void this.paintPhoto();
        this.status("");
        this.root.querySelector<HTMLElement>('[data-el="shop-hint"]')!.hidden = true;
        this.showSaved(`Added ${saved.name}. Now the next one.`);
        this.field("url").focus();
        this.onDone(saved);
      } else {
        this.close();
        this.onDone(saved);
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  private showError(message: string): void {
    this.root.querySelector<HTMLElement>('[data-el="saved"]')!.hidden = true;
    const el = this.root.querySelector<HTMLElement>('[data-el="error"]')!;
    el.textContent = message;
    el.hidden = false;
  }

  private showSaved(message: string): void {
    this.root.querySelector<HTMLElement>('[data-el="error"]')!.hidden = true;
    const el = this.root.querySelector<HTMLElement>('[data-el="saved"]')!;
    el.textContent = message;
    el.hidden = false;
  }

  private close(): void {
    this.fetchToken++;
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("change", this.onChange);
    this.root.removeEventListener("keydown", this.onKey);
    document.removeEventListener("paste", this.onPaste);
    if (this.pendingPhotoUrl) URL.revokeObjectURL(this.pendingPhotoUrl);
    this.pendingPhotoUrl = null;
    this.root.className = "modal-backdrop hidden";
    this.root.innerHTML = "";
  }
}

/** A link as typed, with https:// added as the backend would, so its site can be read. */
function normalised(url: string): string {
  const typed = url.trim();
  if (!typed) return "";
  return /^https?:\/\//i.test(typed) ? typed : `https://${typed.replace(/^\/+/, "")}`;
}

/** A page's title without its brand in front, since the brand has a field of its own. */
export function withoutBrand(title: string, brand: string): string {
  const b = brand.trim().toLowerCase();
  const t = title.trim();
  if (b && t.toLowerCase().startsWith(`${b} `)) return t.slice(b.length).replace(/^[\s\-–—:|]+/, "");
  return t;
}

/** "name, brand and price". */
function list(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(v: string): string {
  return escapeHtml(v).replace(/"/g, "&quot;");
}
