/**
 * A project's card, to post: one picture with what there is to say about it
 * -- its name, the pattern and its designer, when it was knitted, a few of
 * its photos, the yarn and how much of it, the needles, the size, and lines
 * from its log. Square, 4:5 or a story's 9:16, chosen each time; copied, or
 * saved as a PNG.
 *
 * The layout is worked out apart from the drawing (`cardText`, `fitBlocks`,
 * `photoRects`), so the harness checks it directly. What does not fit is
 * shrunk a little, then left out from the end, and the screen says so.
 */
import { api, type GalleryPhoto, type LogEntry, type Pattern, type Project, type Tool, type Yarn, type YarnUse } from "../api";
import { customDialog, say } from "../dialogs";
import { closestEl } from "../dom";
import { copyPng } from "../copy-picture";
import { showNotice } from "../notice";
import { photosOf, photoUrl, shownPhotos, type Photo } from "./gallery";
import { longDate } from "./project-form";
import { describe, tipLabel } from "./tool-filter";

export const SHAPES = [
  { key: "square", label: "Square", w: 1080, h: 1080, photoH: 560 },
  { key: "portrait", label: "4:5", w: 1080, h: 1350, photoH: 740 },
  { key: "story", label: "Story 9:16", w: 1080, h: 1920, photoH: 1060 },
] as const;
export type Shape = (typeof SHAPES)[number]["key"];

export const THEMES = [
  { key: "cream", label: "Cream", bg: "#f5f0e6", ink: "#2b2622", muted: "#6f665d", accent: "#a8322d", well: "#e4dccd" },
  { key: "night", label: "Night", bg: "#1d1c21", ink: "#f3efe8", muted: "#b2aba1", accent: "#ef7a6d", well: "#2c2a31" },
  { key: "sage", label: "Sage", bg: "#e3e9dd", ink: "#23302a", muted: "#5d6b60", accent: "#4b6b47", well: "#cfd8c8" },
  { key: "rose", label: "Rose", bg: "#f6e6e4", ink: "#3a2426", muted: "#7d5f61", accent: "#b04a5a", well: "#ead2cf" },
] as const;
export type Theme = (typeof THEMES)[number]["key"];

/** What a card shows, besides its name. */
export const SHOWS = [
  { key: "pattern", label: "Pattern and designer" },
  { key: "dates", label: "When it was knitted" },
  { key: "yarn", label: "Yarn, and how much" },
  { key: "needles", label: "Needles & hooks" },
  { key: "size", label: "Size knitted" },
  { key: "person", label: "Who it is for" },
] as const;
export type Show = (typeof SHOWS)[number]["key"];

export const MAX_PHOTOS = 4;

export interface CardOptions {
  shape: Shape;
  theme: Theme;
  /** The photos, by key ("cover" or a log entry's id), in the order picked. */
  photos: string[];
  show: Show[];
  /** Log entries quoted, by id. */
  log: string[];
}

/** What a card is made from, gathered once. */
export interface CardData {
  project: Project;
  pattern: Pattern | null;
  log: LogEntry[];
  tools: Tool[];
  yarns: Yarn[];
  usage: YarnUse[];
}

/** One block of the card's words: a heading line, a fact with its label, or a quote. */
export type Block = { kind: "title" | "sub" | "dates"; text: string } | { kind: "fact"; label: string; lines: string[] } | { kind: "quote"; text: string; id: string };

/** The card's words, in order, as chosen. */
export function cardText(d: CardData, o: CardOptions): Block[] {
  const p = d.project;
  const on = (s: Show) => o.show.includes(s);
  const blocks: Block[] = [{ kind: "title", text: p.name }];
  if (on("pattern") && (d.pattern || p.patternTitle)) {
    const title = d.pattern?.title || p.patternTitle;
    const designer = d.pattern?.designer.trim();
    blocks.push({ kind: "sub", text: designer ? `${title} by ${designer}` : title });
  }
  if (on("dates") && p.status !== "planned") {
    const text =
      p.finishedAt && p.status === "finished"
        ? `Started ${longDate(p.startedAt)} · Finished ${longDate(p.finishedAt)}`
        : p.status === "frogged"
          ? `Started ${longDate(p.startedAt)} · Frogged`
          : `On the needles since ${longDate(p.startedAt)}`;
    blocks.push({ kind: "dates", text });
  }
  if (on("yarn") && p.yarns.length) {
    const lines = p.yarns.map((y) => {
      const colourway = d.yarns.find((x) => x.id === y.yarnId)?.colourway;
      const used = d.usage.filter((u) => u.projectId === p.id && u.source === "finished" && u.yarnId === y.yarnId);
      const grams = Math.round(used.reduce((n, u) => n + u.grams, 0));
      const metres = Math.round(used.reduce((n, u) => n + u.metres, 0));
      const how = grams > 0 ? ` — ${grams} g${metres > 0 ? ` (${metres} m)` : ""}` : "";
      return `${y.yarnName}${colourway && !y.yarnName.includes(colourway) ? `, ${colourway}` : ""}${how}`;
    });
    blocks.push({ kind: "fact", label: "Yarn", lines: [...new Set(lines)] });
  }
  if (on("needles")) {
    const lines = p.toolIds.map((id) => d.tools.find((t) => t.id === id)).filter((t): t is Tool => !!t).map((t) => `${describe(t)}${p.toolTips?.[t.id] ? `, ${tipLabel(p.toolTips[t.id])}` : ""}`);
    if (lines.length) blocks.push({ kind: "fact", label: "Needles", lines });
  }
  if (on("size") && p.size.trim()) blocks.push({ kind: "fact", label: "Size", lines: [p.size.trim()] });
  if (on("person") && p.personName) blocks.push({ kind: "fact", label: "For", lines: [p.personName] });
  for (const id of o.log) {
    const e = d.log.find((x) => x.id === id);
    if (e?.text.trim()) blocks.push({ kind: "quote", text: e.text.trim(), id });
  }
  return blocks;
}

/** Where each photo goes in their box: one whole, two side by side, three with one big, four in a square. */
export function photoRects(n: number, x: number, y: number, w: number, h: number, gap = 14): { x: number; y: number; w: number; h: number }[] {
  const half = (w - gap) / 2;
  const halfH = (h - gap) / 2;
  if (n <= 0) return [];
  if (n === 1) return [{ x, y, w, h }];
  if (n === 2) return [{ x, y, w: half, h }, { x: x + half + gap, y, w: half, h }];
  if (n === 3) {
    const big = Math.round(w * 0.6);
    const rest = w - big - gap;
    return [{ x, y, w: big, h }, { x: x + big + gap, y, w: rest, h: halfH }, { x: x + big + gap, y: y + halfH + gap, w: rest, h: halfH }];
  }
  return [
    { x, y, w: half, h: halfH },
    { x: x + half + gap, y, w: half, h: halfH },
    { x, y: y + halfH + gap, w: half, h: halfH },
    { x: x + half + gap, y: y + halfH + gap, w: half, h: halfH },
  ];
}

const PAD = 64;
const LABEL_W = 170;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, sans-serif';

/** A block's font and spacing, at a scale. */
function style(kind: Block["kind"], s: number): { font: string; size: number; lead: number; after: number } {
  const at = (px: number) => Math.round(px * s);
  switch (kind) {
    case "title":
      return { font: `700 ${at(66)}px ${SERIF}`, size: at(66), lead: at(76), after: at(14) };
    case "sub":
      return { font: `400 ${at(34)}px ${SANS}`, size: at(34), lead: at(44), after: at(6) };
    case "dates":
      return { font: `400 ${at(28)}px ${SANS}`, size: at(28), lead: at(38), after: at(26) };
    case "fact":
      return { font: `400 ${at(29)}px ${SANS}`, size: at(29), lead: at(40), after: at(14) };
    case "quote":
      return { font: `italic 400 ${at(31)}px ${SERIF}`, size: at(31), lead: at(42), after: at(14) };
  }
}

/** Lines of words no wider than `width` in the context's font; at most `most`, the last cut with … when there is more. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, most = 99): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > most) {
    const kept = lines.slice(0, most);
    let last = kept[most - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    kept[most - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

/** A block laid out: its lines, and how tall it is with the space after it. */
interface Laid {
  block: Block;
  lines: string[];
  height: number;
}

function lay(ctx: CanvasRenderingContext2D, b: Block, width: number, s: number): Laid {
  const st = style(b.kind, s);
  ctx.font = st.font;
  let lines: string[];
  if (b.kind === "fact") lines = b.lines.flatMap((l) => wrap(ctx, l, width - LABEL_W * s, 2));
  else if (b.kind === "quote") lines = wrap(ctx, `“${b.text}”`, width, 3);
  else lines = wrap(ctx, b.text, width, b.kind === "title" ? 2 : 2);
  return { block: b, lines, height: lines.length * st.lead + st.after };
}

/**
 * The blocks that fit in a height: shrunk a little first (to 0.7 of the size
 * at the least), then the last left out, one at a time. Says the scale, and
 * how many were left out.
 */
export function fitBlocks(ctx: CanvasRenderingContext2D, blocks: Block[], width: number, height: number): { laid: Laid[]; scale: number; left: number } {
  for (let s = 1; s >= 0.7; s -= 0.05) {
    const laid = blocks.map((b) => lay(ctx, b, width, s));
    if (laid.reduce((n, l) => n + l.height, 0) <= height) return { laid, scale: s, left: 0 };
  }
  const s = 0.7;
  const laid = blocks.map((b) => lay(ctx, b, width, s));
  let left = 0;
  // The name stays, whatever else goes.
  while (laid.length > 1 && laid.reduce((n, l) => n + l.height, 0) > height) {
    laid.pop();
    left++;
  }
  return { laid, scale: s, left };
}

/** A picture drawn to fill a box, its middle kept, with rounded corners. */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, r: { x: number; y: number; w: number; h: number }, well: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 22);
  ctx.clip();
  ctx.fillStyle = well;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (img) {
    const k = Math.max(r.w / img.width, r.h / img.height);
    const w = img.width * k;
    const h = img.height * k;
    ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  }
  ctx.restore();
}

/** Draws the card. Says how many blocks were left out for want of room. */
export function drawCard(canvas: HTMLCanvasElement, d: CardData, o: CardOptions, pictures: Map<string, ImageBitmap | null>): number {
  const shape = SHAPES.find((s) => s.key === o.shape) ?? SHAPES[1];
  const t = THEMES.find((x) => x.key === o.theme) ?? THEMES[0];
  canvas.width = shape.w;
  canvas.height = shape.h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, shape.w, shape.h);
  const photos = o.photos.slice(0, MAX_PHOTOS);
  const inner = shape.w - 2 * PAD;
  const photoH = photos.length ? shape.photoH : 0;
  photoRects(photos.length, PAD, PAD, inner, photoH).forEach((r, i) => drawCover(ctx, pictures.get(photos[i]) ?? null, r, t.well));
  const top = PAD + photoH + (photoH ? 48 : 16);
  const { laid, scale } = fitBlocks(ctx, cardText(d, o), inner, shape.h - PAD - top);
  let y = top;
  ctx.textBaseline = "alphabetic";
  for (const l of laid) {
    const st = style(l.block.kind, scale);
    ctx.font = st.font;
    const kind = l.block.kind;
    if (kind === "fact") {
      ctx.save();
      ctx.font = `700 ${Math.round(22 * scale)}px ${SANS}`;
      ctx.fillStyle = t.accent;
      ctx.fillText((l.block as { label: string }).label.toUpperCase(), PAD, y + st.size);
      ctx.restore();
    }
    if (kind === "quote") {
      ctx.fillStyle = t.accent;
      ctx.fillRect(PAD, y + 6, 5, l.lines.length * st.lead - 6);
    }
    ctx.fillStyle = kind === "title" || kind === "fact" || kind === "quote" ? t.ink : t.muted;
    const x = kind === "fact" ? PAD + LABEL_W * scale : kind === "quote" ? PAD + 26 : PAD;
    l.lines.forEach((line, i) => ctx.fillText(line, x, y + st.size + i * st.lead));
    y += l.height;
  }
  return cardText(d, o).length - laid.length;
}

// ---------- the screen ----------

/** The choices last made for a project's card, kept in this window. */
function remembered(id: string): Partial<CardOptions> {
  try {
    return JSON.parse(localStorage.getItem(`project-card:${id}`) ?? "{}") as Partial<CardOptions>;
  } catch {
    return {};
  }
}

function remember(id: string, o: CardOptions): void {
  try {
    localStorage.setItem(`project-card:${id}`, JSON.stringify(o));
  } catch {
    // Chosen again next time.
  }
}

export interface CardHooks {
  /** The project changed: its size said here. */
  changed?(p: Project): void;
}

/** Opens a project's card: chosen, seen as it will look, copied or saved. */
export async function openProjectCard(project: Project, hooks: CardHooks = {}): Promise<void> {
  let p = project;
  const [pattern, log, tools, yarns, usage, logged] = await Promise.all([
    p.patternId ? api.getPattern(p.patternId).catch(() => null) : Promise.resolve(null),
    api.listProjectLog(p.id).catch(() => [] as LogEntry[]),
    api.listTools().catch(() => [] as Tool[]),
    api.listYarns({ used: "all" }).catch(() => [] as Yarn[]),
    api.listYarnUsage().catch(() => [] as YarnUse[]),
    api.listGalleryPhotos().catch(() => [] as GalleryPhoto[]),
  ]);
  const photos: Photo[] = photosOf(p, logged);
  const kept = remembered(p.id);
  const known = (keys: string[] | undefined, from: string[]) => (keys ?? []).filter((k) => from.includes(k));
  const o: CardOptions = {
    shape: SHAPES.some((s) => s.key === kept.shape) ? kept.shape! : "portrait",
    theme: THEMES.some((t) => t.key === kept.theme) ? kept.theme! : "cream",
    photos: kept.photos ? known(kept.photos, photos.map((x) => x.key)).slice(0, MAX_PHOTOS) : shownPhotos(p, photos).slice(0, 3).map((x) => x.key),
    show: kept.show ? (known(kept.show, SHOWS.map((s) => s.key)) as Show[]) : ["pattern", "dates", "yarn", "needles", "size"],
    log: known(kept.log, log.map((e) => e.id)),
  };
  const data = (): CardData => ({ project: p, pattern, log, tools, yarns, usage });
  const pictures = new Map<string, ImageBitmap | null>();
  const urls = new Map<string, string | null>();

  const dialog = customDialog(`A card for ${p.name}`, () => close(), "project-card-dialog");
  const card = dialog.card;
  const written = log.filter((e) => e.text.trim() && !e.milestone);
  card.insertAdjacentHTML(
    "beforeend",
    `
    <div class="pc-body">
      <div class="pc-preview"><canvas data-el="card" aria-label="The card, as it will look"></canvas><p class="hint" data-el="left-out"></p></div>
      <aside class="pc-controls">
        <div class="field"><span>Shape</span><div class="seg pc-shapes">${SHAPES.map((s) => `<button type="button" class="ghost" data-shape="${s.key}">${s.label}</button>`).join("")}</div></div>
        <div class="field"><span>Colours</span><div class="pc-themes">${THEMES.map((t) => `<button type="button" class="pc-theme" data-theme="${t.key}" title="${t.label}" style="background:${t.bg};color:${t.ink};border-color:${t.accent}">${t.label}</button>`).join("")}</div></div>
        <div class="field"><span>Photos <em class="hint">up to ${MAX_PHOTOS}, in the order picked</em></span>
          <div class="pc-photos">${
            photos.length
              ? photos.map((x) => `<button type="button" class="pc-photo" data-photo="${esc(x.key)}" title="${esc(x.caption || (x.key === "cover" ? "Its cover" : longDate(x.at)))}"><img alt="" /><b></b></button>`).join("")
              : `<span class="hint">No photos yet: a cover, or a photo in its log.</span>`
          }</div></div>
        <div class="field"><span>Show</span><div class="pc-shows">${SHOWS.map((s) => `<label class="dialog-checkfield"><input type="checkbox" data-show="${s.key}" /><span>${s.label}</span></label>`).join("")}</div></div>
        <label class="field"><span>Size knitted</span><input data-f="size" value="${esc(p.size)}" placeholder="e.g. M, or the 2nd size" maxlength="100" /></label>
        ${
          written.length
            ? `<div class="field"><span>From the log</span><div class="pc-log">${written
                .map((e) => `<label class="dialog-checkfield"><input type="checkbox" data-log="${esc(e.id)}" /><span>${esc(e.text.length > 90 ? `${e.text.slice(0, 90)}…` : e.text)} <em class="hint">${esc(longDate(e.at))}</em></span></label>`)
                .join("")}</div></div>`
            : ""
        }
      </aside>
    </div>
    <div class="dialog-actions">
      <button type="button" class="ghost" data-act="close">Close</button>
      <button type="button" class="ghost" data-act="save">Save as PNG…</button>
      <button type="button" class="primary" data-act="copy">Copy</button>
    </div>`,
  );
  const canvas = card.querySelector<HTMLCanvasElement>('[data-el="card"]')!;
  let closed = false;
  const close = () => {
    closed = true;
    remember(p.id, o);
    dialog.close();
  };

  const picture = async (key: string): Promise<ImageBitmap | null> => {
    if (pictures.has(key)) return pictures.get(key)!;
    const url = await photoUrl(p, key);
    urls.set(key, url);
    let bitmap: ImageBitmap | null = null;
    try {
      if (url) bitmap = await createImageBitmap(await (await fetch(url)).blob());
    } catch {
      // Drawn as an empty well.
    }
    pictures.set(key, bitmap);
    return bitmap;
  };

  const paint = async (): Promise<void> => {
    for (const b of card.querySelectorAll<HTMLElement>("[data-shape]")) b.classList.toggle("on", b.dataset.shape === o.shape);
    for (const b of card.querySelectorAll<HTMLElement>("[data-theme]")) b.classList.toggle("on", b.dataset.theme === o.theme);
    for (const b of card.querySelectorAll<HTMLElement>("[data-photo]")) {
      const at = o.photos.indexOf(b.dataset.photo!);
      b.classList.toggle("on", at >= 0);
      b.querySelector("b")!.textContent = at >= 0 ? String(at + 1) : "";
    }
    for (const c of card.querySelectorAll<HTMLInputElement>("[data-show]")) c.checked = o.show.includes(c.dataset.show as Show);
    for (const c of card.querySelectorAll<HTMLInputElement>("[data-log]")) c.checked = o.log.includes(c.dataset.log!);
    await Promise.all(o.photos.map(picture));
    if (closed) return;
    const left = drawCard(canvas, data(), o, pictures);
    canvas.dataset.shape = o.shape;
    card.querySelector<HTMLElement>('[data-el="left-out"]')!.textContent = left
      ? `${left} thing${left === 1 ? "" : "s"} at the end did not fit: fewer lines from the log, fewer photos, or a taller shape makes room.`
      : "";
  };

  const pngOfCard = (): Promise<Blob> =>
    new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The card could not be made a picture."))), "image/png"));

  card.addEventListener("click", (e) => {
    const btn = closestEl(e.target, "button");
    if (!btn) return;
    if (btn.dataset.shape) o.shape = btn.dataset.shape as Shape;
    if (btn.dataset.theme) o.theme = btn.dataset.theme as Theme;
    if (btn.dataset.photo) {
      const key = btn.dataset.photo;
      if (o.photos.includes(key)) o.photos = o.photos.filter((k) => k !== key);
      else if (o.photos.length < MAX_PHOTOS) o.photos = [...o.photos, key];
      else return void say(`A card has room for ${MAX_PHOTOS} photos: take one out first.`, "Photos");
    }
    const act = btn.dataset.act;
    if (act === "close") return close();
    if (act === "copy") return void copyPng(pngOfCard(), "The card");
    if (act === "save") return void save();
    void paint();
  });
  card.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.show) o.show = el.checked ? [...o.show, el.dataset.show as Show] : o.show.filter((s) => s !== el.dataset.show);
    if (el.dataset.log) o.log = el.checked ? [...o.log, el.dataset.log] : o.log.filter((id) => id !== el.dataset.log);
    if (el.dataset.f === "size") return void saveSize(el.value);
    void paint();
  });

  const saveSize = async (size: string): Promise<void> => {
    try {
      p = await api.setProjectSize(p.id, size);
      hooks.changed?.(p);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Size knitted");
    }
    void paint();
  };

  const save = async (): Promise<void> => {
    try {
      const bytes = new Uint8Array(await (await pngOfCard()).arrayBuffer());
      const path = await api.saveFile("png", `${p.name} card.png`, bytes);
      if (path) showNotice("The card is saved.", undefined, 3000);
    } catch (err) {
      await say(err instanceof Error ? err.message : String(err), "Save the card");
    }
  };

  // The photos' thumbnails, as they load.
  for (const thumb of card.querySelectorAll<HTMLElement>("[data-photo]")) {
    void photoUrl(p, thumb.dataset.photo!).then((url) => {
      const img = thumb.querySelector("img");
      if (url && img) img.src = url;
    });
  }
  dialog.show(card.querySelector<HTMLElement>('[data-act="copy"]')!);
  await paint();
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
