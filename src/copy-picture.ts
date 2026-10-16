/**
 * Copying a picture to the clipboard, to paste anywhere: a post, a message,
 * another app. Browsers put only PNG on the clipboard as a picture, so a
 * JPEG photo is drawn and copied as a PNG.
 *
 * The picture is handed to the clipboard as a promise, made at once in the
 * click: the browser only lets a page write to the clipboard straight after
 * something the user did, and reading and drawing the picture takes longer.
 */
import { say } from "./dialogs";
import { showNotice } from "./notice";

/** A picture's PNG, from its address (a blob: URL, as every picture shown is). */
export async function pngOf(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("The picture could not be made a PNG.");
  return png;
}

/**
 * Copies the picture at an address, or at one still being found; says it is
 * copied, or why not. Resolves whether it was.
 */
export async function copyPicture(url: string | null | Promise<string | null>, what = "The picture"): Promise<boolean> {
  const png = Promise.resolve(url).then((u) => {
    if (!u) throw new Error(`${what} is not there to copy.`);
    return pngOf(u);
  });
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("This window cannot put pictures on the clipboard.");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (err) {
    png.catch(() => {});
    await say(`${what} could not be copied: ${err instanceof Error ? err.message : String(err)}`, "Copy");
    return false;
  }
  showNotice(`${what} is copied: paste it anywhere.`, undefined, 3000);
  return true;
}
