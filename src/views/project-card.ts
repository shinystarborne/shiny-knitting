/**
 * A project's card, to post: one picture with what there is to say about it
 * -- its name, the pattern and its designer, when it was knitted, a few of
 * its photos, the yarn and how much of it, the needles, the size, its
 * knitting time and what it cost, and lines from its log. Square, 4:5 or a story's 9:16, chosen each time; copied, or
 * saved as a PNG.
 *
 * The layout is worked out apart from the drawing (`cardText`, `fitBlocks`,
 * `photoRects`), so the harness checks it directly. What does not fit is
 * shrunk a little, then left out from the end, and the screen says so; a
 * smaller text size or a narrower font, chosen, makes room.
 */
import { api, type GalleryPhoto, type KnitSession, type LogEntry, type Pattern, type Project, type Tool, type Yarn, type YarnUse } from "../api";
import { customDialog, say } from "../dialogs";
import { closestEl } from "../dom";
import { copyPng } from "../copy-picture";
import { showNotice } from "../notice";
import { hoursText, totalMs, trueCost } from "./knit-time";
import { money, projectCost } from "./money";
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

/** The card's fonts: for its name, its words, and quotes from the log. Ones Windows has. */
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, sans-serif';
const SOFT = 'Candara, "Segoe UI", sans-serif';
export const FONTS = [
  { key: "classic", label: "Classic", title: SERIF, body: SANS, quote: SERIF },
  { key: "modern", label: "Modern", title: SANS, body: SANS, quote: SANS },
  { key: "soft", label: "Soft", title: SOFT, body: SOFT, quote: SOFT },
] as const;
export type Font = (typeof FONTS)[number]["key"];
type Fonts = (typeof FONTS)[number];

/** The size of the card's words, before any shrinking to fit. */
export const TEXT_SIZES = [
  { key: "large", label: "Large", scale: 1 },
  { key: "medium", label: "Medium", scale: 0.85 },
  { key: "small", label: "Small", scale: 0.7 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["key"];

/** What a card shows, besides its name. */
export const SHOWS = [
  { key: "pattern", label: "Pattern and designer" },
  { key: "dates", label: "Dates" },
  { key: "time", label: "Knitting time" },
  { key: "yarnCost", label: "Yarn cost" },
  { key: "patternCost", label: "Pattern cost" },
  { key: "totalCost", label: "Total cost" },
  { key: "costWithTime", label: "Project cost with time" },
  { key: "yarn", label: "Yarn and amount" },
  { key: "needles", label: "Needles & hooks" },
  { key: "size", label: "Size knitted" },
  { key: "person", label: "Made for" },
] as const;
export type Show = (typeof SHOWS)[number]["key"];

/** What a card shows when nothing else has been chosen. */
export const SHOWN_FIRST: Show[] = ["pattern", "dates", "time", "yarnCost", "patternCost", "totalCost", "costWithTime", "yarn", "needles", "size"];

/** The costs a card can show. */
const COSTS: Show[] = ["yarnCost", "patternCost", "totalCost", "costWithTime"];

export const MAX_PHOTOS = 4;

export interface CardOptions {
  shape: Shape;
  theme: Theme;
  /** The photos, by key ("cover" or a log entry's id), in the order picked. */
  photos: string[];
  show: Show[];
  /** Log entries quoted, by id. */
  log: string[];
  /** Its font and the size of its words: Classic and Large when not said. */
  font?: Font;
  textSize?: TextSize;
}

/** What a card is made from, gathered once. */
export interface CardData {
  project: Project;
  pattern: Pattern | null;
  log: LogEntry[];
  tools: Tool[];
  yarns: Yarn[];
  usage: YarnUse[];
  /** Its knitting time. */
  sessions: KnitSession[];
  /** The currency prices are in. */
  currency: string;
  /** What an hour of knitting is worth: the project's own, else the one in Settings; null when neither is said. */
  hourRate: number | null;
}

/** What the project cost, as the project's page sums it: the yarn, and all of it with the pattern. */
export function cardCost(d: CardData): ReturnType<typeof projectCost> {
  return projectCost(d.project, d.yarns, d.pattern ? [d.pattern] : [], d.usage);
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
    // A title that already names its designer ("Nocturnal by saskieco") is not followed by them again.
    const named = !!designer && title.toLowerCase().includes(designer.toLowerCase());
    const sub = designer && !named ? `${title} by ${designer}` : title;
    // Said once: a project named as its pattern needs no second line saying so.
    if (sub.trim().toLowerCase() !== p.name.trim().toLowerCase()) blocks.push({ kind: "sub", text: sub });
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
  // Next to the dates, before the yarn and needles: what does not fit is
  // left out from the end, and the time and cost were asked for.
  const ms = totalMs(d.sessions.filter((x) => x.projectId === p.id));
  if (on("time") && ms >= 60000) blocks.push({ kind: "fact", label: "Time", lines: [hoursText(ms)] });
  // Each cost as chosen: the yarn, the pattern and the total on one line,
  // with the knitting time at the hour cost under them, as on the project's page.
  if (COSTS.some(on)) {
    const c = cardCost(d);
    const parts = [
      on("yarnCost") && c.yarn ? `Yarn ${money(c.yarn, d.currency)}` : "",
      on("patternCost") && c.pattern ? `Pattern ${money(c.pattern, d.currency)}` : "",
      on("totalCost") && c.total ? `Total ${money(c.total, d.currency)}` : "",
    ].filter(Boolean);
    const lines = parts.length ? [parts.join(" · ")] : [];
    if (on("costWithTime") && d.hourRate != null && ms >= 60000) lines.push(`With time ${money(trueCost(c.total, ms, d.hourRate), d.currency)}`);
    if (lines.length) blocks.push({ kind: "fact", label: "Cost", lines });
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
/** A block's font and spacing, at a scale. */
function style(kind: Block["kind"], s: number, f: Fonts = FONTS[0]): { font: string; size: number; lead: number; after: number } {
  const at = (px: number) => Math.round(px * s);
  switch (kind) {
    case "title":
      return { font: `700 ${at(66)}px ${f.title}`, size: at(66), lead: at(76), after: at(14) };
    case "sub":
      return { font: `400 ${at(34)}px ${f.body}`, size: at(34), lead: at(44), after: at(6) };
    case "dates":
      return { font: `400 ${at(28)}px ${f.body}`, size: at(28), lead: at(38), after: at(26) };
    case "fact":
      return { font: `400 ${at(29)}px ${f.body}`, size: at(29), lead: at(40), after: at(14) };
    case "quote":
      return { font: `italic 400 ${at(31)}px ${f.quote}`, size: at(31), lead: at(42), after: at(14) };
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

function lay(ctx: CanvasRenderingContext2D, b: Block, width: number, s: number, f: Fonts): Laid {
  const st = style(b.kind, s, f);
  ctx.font = st.font;
  let lines: string[];
  if (b.kind === "fact") lines = b.lines.flatMap((l) => wrap(ctx, l, width - LABEL_W * s, 2));
  else if (b.kind === "quote") lines = wrap(ctx, `“${b.text}”`, width, 3);
  else lines = wrap(ctx, b.text, width, 2);
  return { block: b, lines, height: lines.length * st.lead + st.after };
}

/** The fonts and the starting size of a card's words, as chosen. */
function lookOf(o: Pick<CardOptions, "font" | "textSize">): { fonts: Fonts; size: number } {
  return { fonts: FONTS.find((f) => f.key === o.font) ?? FONTS[0], size: TEXT_SIZES.find((t) => t.key === o.textSize)?.scale ?? 1 };
}

/**
 * The blocks that fit in a height: at the size chosen, shrunk a little first
 * (to 0.7 of it at the least), then the last left out, one at a time. Says
 * the scale, and how many were left out.
 */
export function fitBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  width: number,
  height: number,
  look: Pick<CardOptions, "font" | "textSize"> = {},
): { laid: Laid[]; scale: number; left: number } {
  const { fonts, size } = lookOf(look);
  // In twentieths of the size, so the steps add up exactly.
  for (let step = 20; step >= 14; step--) {
    const s = (size * step) / 20;
    const laid = blocks.map((b) => lay(ctx, b, width, s, fonts));
    if (laid.reduce((n, l) => n + l.height, 0) <= height) return { laid, scale: s, left: 0 };
  }
  const s = size * 0.7;
  const laid = blocks.map((b) => lay(ctx, b, width, s, fonts));
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
  const { laid, scale } = fitBlocks(ctx, cardText(d, o), inner, shape.h - PAD - top, o);
  const { fonts } = lookOf(o);
  let y = top;
  ctx.textBaseline = "alphabetic";
  for (const l of laid) {
    const st = style(l.block.kind, scale, fonts);
    ctx.font = st.font;
    const kind = l.block.kind;
    if (kind === "fact") {
      ctx.save();
      ctx.font = `700 ${Math.round(22 * scale)}px ${fonts.body}`;
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

/** The choices last made for a project's card, kept in this window, with what there was to choose from then. */
function remembered(id: string): Partial<CardOptions> & { offered?: string[] } {
  try {
    return JSON.parse(localStorage.getItem(`project-card:${id}`) ?? "{}") as Partial<CardOptions> & { offered?: string[] };
  } catch {
    return {};
  }
}

function remember(id: string, o: CardOptions): void {
  try {
    localStorage.setItem(`project-card:${id}`, JSON.stringify({ ...o, offered: SHOWS.map((s) => s.key) }));
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
  const [pattern, log, tools, yarns, usage, logged, sessions, currency, standardRate] = await Promise.all([
    p.patternId ? api.getPattern(p.patternId).catch(() => null) : Promise.resolve(null),
    api.listProjectLog(p.id).catch(() => [] as LogEntry[]),
    api.listTools().catch(() => [] as Tool[]),
    api.listYarns({ used: "all" }).catch(() => [] as Yarn[]),
    api.listYarnUsage().catch(() => [] as YarnUse[]),
    api.listGalleryPhotos().catch(() => [] as GalleryPhoto[]),
    api.listKnitSessions(p.id).catch(() => [] as KnitSession[]),
    api.getCurrency().catch(() => "EUR"),
    api.getHourRate().catch(() => null),
  ]);
  const photos: Photo[] = photosOf(p, logged);
  const kept = remembered(p.id);
  const known = (keys: string[] | undefined, from: string[]) => (keys ?? []).filter((k) => from.includes(k));
  const o: CardOptions = {
    shape: SHAPES.some((s) => s.key === kept.shape) ? kept.shape! : "portrait",
    theme: THEMES.some((t) => t.key === kept.theme) ? kept.theme! : "cream",
    font: FONTS.some((f) => f.key === kept.font) ? kept.font! : "classic",
    textSize: TEXT_SIZES.some((t) => t.key === kept.textSize) ? kept.textSize! : "large",
    photos: kept.photos ? known(kept.photos, photos.map((x) => x.key)).slice(0, MAX_PHOTOS) : shownPhotos(p, photos).slice(0, 3).map((x) => x.key),
    // What was not there to choose when the card was last made is shown as at first.
    show: kept.show ? ([...known(kept.show, SHOWS.map((s) => s.key)), ...SHOWN_FIRST.filter((k) => !(kept.offered ?? ["pattern", "dates", "yarn", "needles", "size", "person"]).includes(k))] as Show[]) : [...SHOWN_FIRST],
    log: known(kept.log, log.map((e) => e.id)),
  };
  const data = (): CardData => ({ project: p, pattern, log, tools, yarns, usage, sessions, currency, hourRate: p.hourRate ?? standardRate });
  const pictures = new Map<string, ImageBitmap | null>();
  const urls = new Map<string, string | null>();

  const dialog = customDialog(`Share card: ${p.name}`, () => close(), "project-card-dialog");
  const card = dialog.card;
  const written = log.filter((e) => e.text.trim() && !e.milestone);
  card.insertAdjacentHTML(
    "beforeend",
    `
    <div class="pc-body">
      <div class="pc-preview"><canvas data-el="card" aria-label="Card preview"></canvas><p class="hint" data-el="left-out"></p><p class="hint" data-el="unpriced"></p></div>
      <aside class="pc-controls">
        <div class="field"><span>Shape</span><div class="seg pc-shapes">${SHAPES.map((s) => `<button type="button" class="ghost" data-shape="${s.key}">${s.label}</button>`).join("")}</div></div>
        <div class="field"><span>Text size</span><div class="seg pc-sizes">${TEXT_SIZES.map((t) => `<button type="button" class="ghost" data-text-size="${t.key}">${t.label}</button>`).join("")}</div></div>
        <div class="field"><span>Font</span><div class="seg pc-fonts">${FONTS.map((f) => `<button type="button" class="ghost" data-font="${f.key}" style="font-family:${esc(f.title)}">${f.label}</button>`).join("")}</div></div>
        <div class="field"><span>Colours</span><div class="pc-themes">${THEMES.map((t) => `<button type="button" class="pc-theme" data-theme="${t.key}" title="${t.label}" style="background:${t.bg};color:${t.ink};border-color:${t.accent}">${t.label}</button>`).join("")}</div></div>
        <div class="field"><span>Photos <em class="hint">up to ${MAX_PHOTOS}, in the order chosen</em></span>
          <div class="pc-photos">${
            photos.length
              ? photos.map((x) => `<button type="button" class="pc-photo" data-photo="${esc(x.key)}" title="${esc(x.caption || (x.key === "cover" ? "Cover" : longDate(x.at)))}"><img alt="" /><b></b></button>`).join("")
              : `<span class="hint">No photos yet: add a cover, or photos in the log.</span>`
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
    for (const b of card.querySelectorAll<HTMLElement>("[data-text-size]")) b.classList.toggle("on", b.dataset.textSize === o.textSize);
    for (const b of card.querySelectorAll<HTMLElement>("[data-font]")) b.classList.toggle("on", b.dataset.font === o.font);
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
      ? `${left} thing${left === 1 ? "" : "s"} at the end did not fit. Smaller text, another font, fewer photos or log lines, or a taller shape make room.`
      : "";
    // The yarn with no price or amount, a pattern with no price, and no hour cost for the cost with time.
    const costing = COSTS.some((k) => o.show.includes(k));
    const unpriced = costing ? [...cardCost(data()).unknown, ...(pattern && pattern.price == null ? [`${pattern.title} (the pattern)`] : [])] : [];
    const notes = [
      unpriced.length ? `Not counted in the cost (no price or amount): ${unpriced.join(", ")}.` : "",
      o.show.includes("costWithTime") && data().hourRate == null ? "No hour cost for the cost with time: set in Settings → Prices, or on the project's page." : "",
    ];
    card.querySelector<HTMLElement>('[data-el="unpriced"]')!.textContent = notes.filter(Boolean).join(" ");
  };

  const pngOfCard = (): Promise<Blob> =>
    new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The card could not be saved as a picture."))), "image/png"));

  card.addEventListener("click", (e) => {
    const btn = closestEl(e.target, "button");
    if (!btn) return;
    if (btn.dataset.shape) o.shape = btn.dataset.shape as Shape;
    if (btn.dataset.textSize) o.textSize = btn.dataset.textSize as TextSize;
    if (btn.dataset.font) o.font = btn.dataset.font as Font;
    if (btn.dataset.theme) o.theme = btn.dataset.theme as Theme;
    if (btn.dataset.photo) {
      const key = btn.dataset.photo;
      if (o.photos.includes(key)) o.photos = o.photos.filter((k) => k !== key);
      else if (o.photos.length < MAX_PHOTOS) o.photos = [...o.photos, key];
      else return void say(`A card holds up to ${MAX_PHOTOS} photos. Remove one first.`, "Photos");
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
      // The extension is the saving's to add.
      const path = await api.saveFile("png", `${p.name} card`, bytes);
      if (path) showNotice("Card saved.", undefined, 3000);
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
