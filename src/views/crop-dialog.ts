import { customDialog } from "../dialogs";

/**
 * Cropping a picture: drag a box over it -- move it by its middle, size it by
 * its corners, or drag afresh outside it -- and Crop keeps what is inside, at
 * the picture's own resolution. Resolves the cropped picture, or null when
 * cancelled.
 */
export function cropImage(url: string, title = "Crop the picture", type: "image/png" | "image/jpeg" = "image/png"): Promise<Blob | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      dialog.close();
      resolve(blob);
    };
    const dialog = customDialog(title, () => finish(null), "crop-dialog");
    const card = dialog.card;
    card.insertAdjacentHTML(
      "beforeend",
      `<p class="hint">Drag a box over the part to keep. Drag the box to move it, its corners to size it.</p>
       <div class="crop-stage" data-el="stage"><img data-el="img" alt="" draggable="false" /><div class="crop-box" data-el="box" hidden>
         <span class="crop-handle" data-corner="nw"></span><span class="crop-handle" data-corner="ne"></span>
         <span class="crop-handle" data-corner="sw"></span><span class="crop-handle" data-corner="se"></span></div></div>
       <div class="dialog-actions">
         <button type="button" class="ghost" data-act="cancel">Cancel</button>
         <button type="button" class="primary" data-act="crop" disabled>Crop</button>
       </div>`,
    );
    const stage = card.querySelector<HTMLElement>('[data-el="stage"]')!;
    const img = card.querySelector<HTMLImageElement>('[data-el="img"]')!;
    const box = card.querySelector<HTMLElement>('[data-el="box"]')!;
    const cropButton = card.querySelector<HTMLButtonElement>('[data-act="crop"]')!;
    // The box, in the shown picture's pixels.
    let rect: { x: number; y: number; w: number; h: number } | null = null;

    const paint = () => {
      box.hidden = !rect;
      cropButton.disabled = !rect || rect.w < 4 || rect.h < 4;
      if (!rect) return;
      Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    };
    const point = (e: PointerEvent) => {
      const r = img.getBoundingClientRect();
      return { x: Math.min(Math.max(0, e.clientX - r.left), r.width), y: Math.min(Math.max(0, e.clientY - r.top), r.height) };
    };

    stage.addEventListener("pointerdown", (e) => {
      if (!img.naturalWidth) return;
      e.preventDefault();
      const start = point(e);
      const corner = (e.target as HTMLElement).dataset.corner;
      const inside = !corner && rect && (e.target as HTMLElement).closest(".crop-box");
      const from = rect ? { ...rect } : null;
      stage.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = point(ev);
        const r = img.getBoundingClientRect();
        if (corner && from) {
          // The opposite corner stays where it is.
          const fx = corner.includes("w") ? from.x + from.w : from.x;
          const fy = corner.includes("n") ? from.y + from.h : from.y;
          rect = { x: Math.min(fx, p.x), y: Math.min(fy, p.y), w: Math.abs(p.x - fx), h: Math.abs(p.y - fy) };
        } else if (inside && from) {
          rect = { ...from, x: Math.min(Math.max(0, from.x + p.x - start.x), r.width - from.w), y: Math.min(Math.max(0, from.y + p.y - start.y), r.height - from.h) };
        } else {
          rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        }
        paint();
      };
      const up = () => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
        if (rect && (rect.w < 4 || rect.h < 4)) rect = null;
        paint();
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    });

    card.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]")?.dataset.act;
      if (act === "cancel") finish(null);
      if (act === "crop" && rect) {
        // From the shown size back to the picture's own pixels.
        const scale = img.naturalWidth / img.getBoundingClientRect().width;
        const sx = Math.round(rect.x * scale);
        const sy = Math.round(rect.y * scale);
        const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(rect.w * scale)));
        const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(rect.h * scale)));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        // A photo stays a JPEG; a chart or a pin keeps PNG's crisp edges.
        canvas.toBlob((b) => finish(b), type, 0.9);
      }
    });

    img.addEventListener("load", paint);
    img.src = url;
    dialog.show(cropButton);
  });
}
