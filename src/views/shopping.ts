import { WISH_KINDS, type Shop, type ToolInput, type ToolKind, type Wish } from "../api";

/**
 * What the Shops and Wishlist tabs share: searching, the wishlist's filters,
 * and telling which shop a link is from. No DOM here, so the harness checks
 * it directly.
 */

export interface Facet {
  key: string;
  label: string;
  count: number;
}

/** The wishlist's filters. A group left empty filters nothing. */
export interface WishFilter {
  search?: string;
  kind?: string[];
  /** Shop ids; "" is no shop. */
  shop?: string[];
  /** Project ids; "" is for nothing in particular. */
  project?: string[];
}

/** The key that stands for "none" in the shop and project filters. */
export const NONE = "";

/** Lower case, without accents, so "rodel" finds "Rödel". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Whether every word searched for is somewhere in the text. */
export function matches(text: string, search: string | undefined): boolean {
  const words = fold(search ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

/**
 * A link's site, as a person would say it: `https://www.drops.com/en/x` is
 * `drops.com`. Empty for no link, or one that does not parse.
 */
export function siteOf(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The shop a link is from: the one whose address is on the same site, or on
 * a site the link's is part of (a shop at `drops.com` owns `garnstudio.drops.com`).
 * The closest match wins, so a shop listed for a subdomain is preferred.
 */
export function shopForUrl(url: string, shops: Shop[]): Shop | undefined {
  const site = siteOf(url);
  if (!site) return undefined;
  let best: Shop | undefined;
  let bestLength = 0;
  for (const shop of shops) {
    const own = siteOf(shop.url);
    if (!own) continue;
    if ((site === own || site.endsWith(`.${own}`)) && own.length > bestLength) {
      best = shop;
      bestLength = own.length;
    }
  }
  return best;
}

/**
 * Shops whose name, address, comment or tags have every word searched for,
 * and that have every tag ticked (tags compared without case).
 */
export function filterShops(shops: Shop[], search: string | undefined, tags: string[] = []): Shop[] {
  const wanted = tags.map((t) => t.toLowerCase());
  return shops.filter((s) => {
    const own = s.tags.map((t) => t.toLowerCase());
    return wanted.every((t) => own.includes(t)) && matches(`${s.name} ${s.url} ${s.comment} ${s.tags.join(" ")}`, search);
  });
}

/**
 * Every tag on a shop, keyed without case and spelled as it was first, with
 * how many shops have it: most used first.
 */
export function shopTagFacets(shops: Shop[]): Facet[] {
  const by = new Map<string, Facet>();
  for (const shop of shops) {
    for (const tag of shop.tags) {
      const key = tag.toLowerCase();
      const facet = by.get(key) ?? { key, label: tag, count: 0 };
      facet.count++;
      by.set(key, facet);
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function kindLabel(kind: string): string {
  return WISH_KINDS.find((k) => k.key === kind)?.label ?? "Other";
}

/** Everything a wishlist search looks through. */
function wishText(w: Wish): string {
  return [w.name, w.amount, w.price, w.url, w.shopName, w.projectName, w.notes, kindLabel(w.kind)].join(" ");
}

export function filterWishes(wishes: Wish[], filter: WishFilter): Wish[] {
  const within = (chosen: string[] | undefined, value: string) => !chosen?.length || chosen.includes(value);
  return wishes.filter(
    (w) =>
      within(filter.kind, w.kind) &&
      within(filter.shop, w.shopId ?? NONE) &&
      within(filter.project, w.projectId ?? NONE) &&
      matches(wishText(w), filter.search),
  );
}

export function isFiltering(filter: WishFilter): boolean {
  return !!(filter.search?.trim() || filter.kind?.length || filter.shop?.length || filter.project?.length);
}

/**
 * The filter boxes, each with how many things still wanted it holds. Every
 * kind is listed; shops and projects only once something is for them, most
 * wanted first, with "none" last.
 */
export function wishFacets(wishes: Wish[]): { kind: Facet[]; shop: Facet[]; project: Facet[] } {
  const wanted = wishes.filter((w) => w.gotAt === null);
  const tally = (key: (w: Wish) => string, label: (w: Wish) => string, none: string): Facet[] => {
    const by = new Map<string, Facet>();
    for (const w of wishes) {
      const k = key(w);
      if (!by.has(k)) by.set(k, { key: k, label: k === NONE ? none : label(w), count: 0 });
    }
    for (const w of wanted) by.get(key(w))!.count++;
    return [...by.values()].sort(
      (a, b) => Number(a.key === NONE) - Number(b.key === NONE) || b.count - a.count || a.label.localeCompare(b.label),
    );
  };
  const shop = tally((w) => w.shopId ?? NONE, (w) => w.shopName, "No shop");
  const project = tally((w) => w.projectId ?? NONE, (w) => w.projectName, "Nothing in particular");
  return {
    kind: WISH_KINDS.map((k) => ({ key: k.key, label: k.label, count: wanted.filter((w) => w.kind === k.key).length })),
    // A lone "No shop" or "Nothing in particular" filters nothing out.
    shop: shop.length === 1 && shop[0].key === NONE ? [] : shop,
    project: project.length === 1 && project[0].key === NONE ? [] : project,
  };
}

// ---------- from the wishlist into the stash ----------

/** What the yarn form starts with, for yarn got from the wishlist. */
export interface YarnStart {
  brand: string;
  name: string;
  colourway: string;
  /** Balls bought, from the amount; 0 when it does not say. */
  balls: number;
  notes: string;
  /** When it was got, for the lot's bought date. */
  boughtAt: number | null;
}

/**
 * Reads a wishlist item as a yarn: "Drops Alpaca, light grey mix" from
 * DROPS is the yarn Alpaca in light grey mix. Only what is there to read is
 * filled; the form shows the rest to be checked.
 */
export function yarnStart(w: Wish): YarnStart {
  let name = w.name.trim();
  let colourway = "";
  const comma = name.indexOf(",");
  // "Alpaca, light grey mix" as typed, or "Air – Off White" as a shop titles
  // it. A long last part after a dash is more of the name, not a colour.
  const dash = Math.max(name.lastIndexOf(" – "), name.lastIndexOf(" - "), name.lastIndexOf(" — "));
  if (comma > 0) {
    colourway = name.slice(comma + 1).trim();
    name = name.slice(0, comma).trim();
  } else if (dash > 0 && name.length - dash - 3 <= 40) {
    colourway = name.slice(dash + 3).trim();
    name = name.slice(0, dash).trim();
  }
  const brand = w.brand.trim();
  // The brand is its own field, so it is not said twice.
  if (brand && name.toLowerCase().startsWith(`${brand.toLowerCase()} `)) name = name.slice(brand.length).trim();
  return { brand, name: name || w.name.trim(), colourway, balls: ballsIn(w.amount), notes: w.notes, boughtAt: w.gotAt };
}

/** How many balls an amount says: "6 balls", "6 x 50 g", "6 Knäuel", or just "6". */
export function ballsIn(amount: string): number {
  const text = amount.trim().toLowerCase();
  const n = (v: string) => Number(v.replace(",", "."));
  const counted = /(\d+(?:[.,]\d+)?)\s*(?:balls?|skeins?|hanks?|cakes?|knäuel|knaeuel|stück|stk\.?)(?![a-z])/.exec(text);
  if (counted) return n(counted[1]);
  const times = /(\d+)\s*[x×]\s*\d+\s*g\b/.exec(text);
  if (times) return n(times[1]);
  return /^\d+(?:[.,]\d+)?$/.test(text) ? n(text) : 0;
}

/**
 * Reads a wishlist item as a needle or hook: "4 mm circular, 60 cm" is a
 * 4 mm circular needle with a 60 cm cable. Words in English or German.
 */
export function toolStart(w: Wish): Partial<ToolInput> {
  const text = `${w.name} ${w.amount}`.toLowerCase();
  // In this order: "circular needle, 80 cm cable" is a circular, not a cable.
  const kinds: [ToolKind, RegExp][] = [
    ["hook", /hook|häkel|crochet/],
    ["dpn", /\bdpns?\b|double[- ]?pointed|nadelspiel|strumpfstrick/],
    ["tips", /\btips?\b|spitzen/],
    ["circular", /circular|rundstrick|\bfixed\b/],
    ["cable", /\bcables?\b|\bseil/],
    ["straight", /straight|jackenstrick|single[- ]?point/],
  ];
  const kind = kinds.find(([, re]) => re.test(text))?.[0] ?? "circular";
  const mm = /(\d+(?:[.,]\d+)?)\s*mm\b/.exec(text);
  const cm = /(\d+(?:[.,]\d+)?)\s*cm\b/.exec(text);
  const length = cm ? Number(cm[1].replace(",", ".")) : 0;
  const longCable = kind === "circular" || kind === "cable";
  return {
    kind,
    sizeMm: mm ? Number(mm[1].replace(",", ".")) : 0,
    lengthCm: longCable ? 0 : length,
    cableCm: longCable ? length : 0,
    brand: w.brand.trim(),
    notes: w.notes,
  };
}

