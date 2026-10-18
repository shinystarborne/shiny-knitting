/**
 * A PDF's text layer in the PDF's own fonts.
 *
 * pdf.js lays its invisible text over the page in a stand-in font
 * (sans-serif, serif), stretched so each line is as wide as the printed one.
 * The line's ends then sit right, but every letter between them sits where
 * the stand-in font would put it: in a wide font like Montserrat, a number
 * in the middle of a line comes out a letter or so off. What is marked on
 * the text (a size, a search, a highlight) is measured from those letters,
 * so it lands beside the word instead of on it.
 *
 * pdf.js has loaded each font of the page into the document by then, by the
 * name its text items carry. Set in that font and stretched again to the
 * same width, every letter sits where it is printed.
 */

interface TextItem {
  str?: string;
  fontName?: string;
}

let ctx: CanvasRenderingContext2D | null = null;

function widthOf(text: string, family: string): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `100px ${family}`;
  return ctx.measureText(text).width;
}

/**
 * Sets the spans of a rendered text layer (`divs`, as pdf.js keeps them, one
 * per text item) in the fonts of their `items`, where the font is loaded;
 * returns how many were. A turned span is left as it is.
 */
export function fitTextToPdfFonts(divs: HTMLElement[], items: TextItem[]): number {
  const loaded = new Set<string>();
  document.fonts.forEach((f) => {
    if (f.status === "loaded") loaded.add(f.family.replace(/^["']|["']$/g, ""));
  });
  let fitted = 0;
  let i = 0;
  for (const item of items) {
    // Marked content has no span of its own.
    if (item.str === undefined) continue;
    const div = divs[i++];
    if (!div || div.dataset.pdfFont || !item.str.trim() || !item.fontName || !loaded.has(item.fontName)) continue;
    const transform = div.style.transform;
    if (/rotate/.test(transform)) continue;
    const standIn = div.style.fontFamily;
    const own = `"${item.fontName}", ${standIn}`;
    const before = widthOf(item.str, standIn);
    const after = widthOf(item.str, own);
    if (!(before > 0) || !(after > 0)) continue;
    div.style.fontFamily = own;
    div.dataset.pdfFont = item.fontName;
    // Stretched as before, to the printed width: by as much more as the own font is narrower.
    const m = /scaleX\(([^)]+)\)/.exec(transform);
    if (m) div.style.transform = transform.replace(m[0], `scaleX(${(Number(m[1]) * before) / after})`);
    fitted++;
  }
  return fitted;
}
