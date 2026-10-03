import { prepareChosenImage } from "../covers";

/**
 * A photo field in a form: a box showing the photo, which takes a picture
 * dropped on it, pasted with Ctrl+V anywhere while the form is open, or
 * chosen from a file. The picture is downscaled at once but only stored when
 * the form saves, since a new thing has no id to store it against before.
 *
 * `stored` gives the address of the photo already saved, if there is one.
 */
export class PhotoBox {
  /** A picture waiting for the save, already downscaled. */
  pending: Blob | null = null;
  /** The stored photo was taken away, and the save should remove it. */
  removed = false;
  private pendingUrl: string | null = null;

  constructor(
    private box: HTMLElement,
    private stored: () => Promise<string | null>,
    private onError: (message: string) => void,
  ) {
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("over");
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void this.take(file);
      else onError("That is not a picture. Drop an image file, or paste a picture.");
    });
    // On the document: a paste with nothing focused goes to the body.
    document.addEventListener("paste", this.onPaste);
    void this.paint();
  }

  /** Whether there is a photo, waiting or stored. */
  async has(): Promise<boolean> {
    return !!this.pending || (!this.removed && !!(await this.stored()));
  }

  private onPaste = (e: ClipboardEvent): void => {
    if (!this.box.isConnected) return this.destroy();
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void this.take(file);
  };

  async take(file: Blob): Promise<void> {
    const blob = await prepareChosenImage(file);
    if (!blob) return this.onError("That could not be read as a picture.");
    this.pending = blob;
    this.removed = false;
    await this.paint();
  }

  choose(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.take(file);
    });
    input.click();
  }

  remove(): void {
    this.pending = null;
    this.removed = true;
    void this.paint();
  }

  /** Forgets a waiting picture, for a form that starts again. */
  reset(): void {
    this.pending = null;
    this.removed = false;
    void this.paint();
  }

  private async paint(): Promise<void> {
    let url: string | null = null;
    if (this.pending) {
      if (this.pendingUrl) URL.revokeObjectURL(this.pendingUrl);
      this.pendingUrl = URL.createObjectURL(this.pending);
      url = this.pendingUrl;
    } else if (!this.removed) {
      url = await this.stored();
    }
    this.box.classList.toggle("filled", !!url);
    this.box.style.backgroundImage = url ? `url("${url}")` : "";
  }

  destroy(): void {
    document.removeEventListener("paste", this.onPaste);
    if (this.pendingUrl) URL.revokeObjectURL(this.pendingUrl);
    this.pendingUrl = null;
  }
}
