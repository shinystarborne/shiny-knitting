import { CABLE_SIZES, TOOL_KINDS, TOOL_MATERIALS, type Tool } from "../api";

/**
 * Filtering and naming needles and hooks.
 *
 * Done here rather than in SQL: a collection is a few hundred rows at the
 * very most, it is listed whole anyway, and the facet counts fall out of the
 * same list. Pure functions, so the harness checks them directly.
 */

/** Whether a tool is free: on no active project. */
export const isFree = (t: Tool): boolean => !t.projectId;

/**
 * Ticked boxes per group. Within a group they are OR (4 mm or 4.5 mm), and
 * the groups are AND (4 mm, and free), the same as the library's filters.
 */
export interface ToolFilter {
  search?: string;
  use?: ("free" | "in-use")[];
  kind?: string[];
  size?: string[];
  material?: string[];
  cableSize?: string[];
  brand?: string[];
}

export interface Facet {
  key: string;
  label: string;
  count: number;
}

/** A size as written on a needle: "4 mm", "3.75 mm". */
export function sizeLabel(mm: number): string {
  return `${trim(mm)} mm`;
}

/** The key a size is filtered on, so 4 and 4.0 are the same box. */
export const sizeKey = (mm: number): string => trim(mm);

export function kindLabel(kind: string): string {
  return TOOL_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export function materialLabel(material: string): string {
  return TOOL_MATERIALS.find((m) => m.key === material)?.label ?? material;
}

/** A material as a filter key: a typed one in any case is one box. */
export const materialKey = (material: string): string => material.trim().toLowerCase();

/**
 * Brands already used, one spelling each: the one used most, so a brand
 * typed once in lower case does not become the suggestion.
 */
export function knownBrands(tools: Tool[]): string[] {
  return mostUsedSpellings(tools.map((t) => t.brand));
}

/**
 * Materials to suggest: the known ones, then any typed ones already used.
 * "Other" is not suggested; a typed material says more.
 */
export function knownMaterials(tools: Tool[]): string[] {
  const known = TOOL_MATERIALS.filter((m) => m.key !== "other").map((m) => m.label);
  const typed = mostUsedSpellings(
    tools.map((t) => t.material).filter((m) => !TOOL_MATERIALS.some((k) => k.key === materialKey(m))),
  );
  return [...known, ...typed];
}

/**
 * What a typed material is stored as: a known one's key, whichever way it was
 * written, or the text itself. The backend does the same, and also tidies.
 */
export function materialValue(typed: string): string {
  const t = typed.trim();
  const known = TOOL_MATERIALS.find((m) => m.key === t.toLowerCase() || m.label.toLowerCase() === t.toLowerCase());
  return known ? known.key : t;
}

/** One spelling per word compared without case, the most used first in a tie. */
function mostUsedSpellings(values: string[]): string[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    const spellings = byKey.get(key) ?? new Map<string, number>();
    spellings.set(v, (spellings.get(v) ?? 0) + 1);
    byKey.set(key, spellings);
  }
  return [...byKey.values()]
    .map((spellings) => [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The spelling already in use for a typed value, when it is the same word in
 * another case: typing "chiaogoo" files the needle under "ChiaoGoo".
 */
export function canonical(typed: string, known: string[]): string {
  const t = typed.trim();
  return known.find((k) => k.toLowerCase() === t.toLowerCase()) ?? t;
}

export function cableSizeLabel(size: string): string {
  return CABLE_SIZES.find((c) => c.key === size)?.label ?? size;
}

/** The brand as a filter key: the same brand typed two ways is one box. */
const brandKey = (brand: string): string => brand.trim().toLowerCase();

/**
 * The headline of a card: the size, or for a cable, which has none, its
 * length.
 */
export function headline(t: Tool): string {
  if (t.kind === "cable") return t.cableCm ? `${trim(t.cableCm)} cm` : "Cable";
  return sizeLabel(t.sizeMm);
}

/** The measurements under the headline: "80 cm cable", "20 cm · Small connector". */
export function measurements(t: Tool): string {
  const parts: string[] = [];
  if (t.kind === "circular" && t.cableCm) parts.push(`${trim(t.cableCm)} cm cable`);
  if (t.lengthCm) parts.push(`${trim(t.lengthCm)} cm long`);
  if (t.cableSize) parts.push(`${cableSizeLabel(t.cableSize)} connector`);
  return parts.join(" · ");
}

/** A one-line name for a tool, for lists and pickers: "4 mm circular needle, 80 cm". */
export function describe(t: Tool): string {
  const kind = kindLabel(t.kind).toLowerCase();
  const name = t.kind === "cable" ? `${kindLabel(t.kind)}` : `${sizeLabel(t.sizeMm)} ${kind}`;
  const size =
    t.kind === "cable" || t.kind === "circular"
      ? t.cableCm
        ? `, ${trim(t.cableCm)} cm`
        : ""
      : t.lengthCm
        ? `, ${trim(t.lengthCm)} cm`
        : "";
  const connector = t.cableSize ? `, ${cableSizeLabel(t.cableSize).toLowerCase()}` : "";
  const brand = t.brand ? ` (${t.brand})` : "";
  return `${name}${size}${connector}${brand}`;
}

/** The project a tool is on, or "". */
export function projectName(t: Tool): string {
  return t.projectId ? t.projectName || "A project" : "";
}

function matches(t: Tool, f: ToolFilter): boolean {
  const term = f.search?.trim().toLowerCase();
  if (term) {
    const words = [
      t.brand,
      t.notes,
      t.projectName,
      kindLabel(t.kind),
      materialLabel(t.material),
      t.kind === "cable" ? "" : `${sizeLabel(t.sizeMm)} ${trim(t.sizeMm)}mm`,
    ]
      .join(" ")
      .toLowerCase();
    if (!term.split(/\s+/).every((w) => words.includes(w))) return false;
  }
  if (f.use?.length) {
    const state = isFree(t) ? "free" : "in-use";
    if (!f.use.includes(state)) return false;
  }
  if (f.kind?.length && !f.kind.includes(t.kind)) return false;
  if (f.size?.length && (t.kind === "cable" || !f.size.includes(sizeKey(t.sizeMm)))) return false;
  if (f.material?.length && !f.material.includes(materialKey(t.material))) return false;
  if (f.cableSize?.length && !f.cableSize.includes(t.cableSize)) return false;
  if (f.brand?.length && !f.brand.includes(brandKey(t.brand))) return false;
  return true;
}

export function filterTools(tools: Tool[], f: ToolFilter): Tool[] {
  return tools.filter((t) => matches(t, f));
}

export function isFiltering(f: ToolFilter): boolean {
  return !!(
    f.search?.trim() ||
    f.use?.length ||
    f.kind?.length ||
    f.size?.length ||
    f.material?.length ||
    f.cableSize?.length ||
    f.brand?.length
  );
}

/**
 * The boxes for each filter group, with how many tools each would show.
 *
 * Fixed groups (kind, material, connector) list every choice, so the list
 * does not shift as the collection grows; sizes and brands list only what is
 * owned, since the possible values are endless.
 */
export function toolFacets(tools: Tool[]): Record<"use" | "kind" | "size" | "material" | "cableSize" | "brand", Facet[]> {
  const count = (pred: (t: Tool) => boolean) => tools.filter(pred).length;

  const sizes = new Map<string, number>();
  for (const t of tools) {
    if (t.kind === "cable" || !t.sizeMm) continue;
    sizes.set(sizeKey(t.sizeMm), t.sizeMm);
  }
  const brands = new Map<string, string>();
  for (const t of tools) {
    const key = brandKey(t.brand);
    if (key && !brands.has(key)) brands.set(key, t.brand.trim());
  }

  return {
    use: [
      { key: "free", label: "Free", count: count(isFree) },
      { key: "in-use", label: "In use", count: count((t) => !isFree(t)) },
    ],
    kind: TOOL_KINDS.map((k) => ({ key: k.key, label: k.label, count: count((t) => t.kind === k.key) })),
    size: [...sizes.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([key, mm]) => ({ key, label: sizeLabel(mm), count: count((t) => t.kind !== "cable" && sizeKey(t.sizeMm) === key) })),
    // The known materials always ("Other" only once something uses it), then
    // any typed ones, so carbon or casein gets its own box.
    material: [
      ...TOOL_MATERIALS.map((m) => ({ key: m.key as string, label: m.label as string })).filter(
        (m) => m.key !== "other" || tools.some((t) => t.material === "other"),
      ),
      ...knownMaterials(tools)
        .filter((label) => !TOOL_MATERIALS.some((m) => m.label === label))
        .map((label) => ({ key: materialKey(label), label })),
    ].map((m) => ({ ...m, count: count((t) => materialKey(t.material) === m.key) })),
    cableSize: CABLE_SIZES.map((c) => ({ key: c.key, label: c.label, count: count((t) => t.cableSize === c.key) })),
    brand: [...brands.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label, count: count((t) => brandKey(t.brand) === key) })),
  };
}

/** A number without trailing zeros: 4, 3.75, 2.5. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The sizes typed into the size field: one ("4"), or a set ("2.5, 3, 3.5").
 *
 * Sizes are separated by spaces, semicolons or commas. A lone comma between
 * digits ("3,5", "3,75") is read as a decimal comma, which is how most of
 * Europe writes 3.5: a list of whole sizes written without spaces ("3,4,5")
 * has more than one comma, so it still reads as a list. Duplicates are
 * dropped and the sizes sorted; anything that is not a size comes back in
 * `bad`, to be named in an error.
 */
export function parseSizes(text: string): { sizes: number[]; bad: string[] } {
  const sizes = new Set<number>();
  const bad: string[] = [];
  for (const piece of text.split(/[\s;]+/)) {
    const parts = /^\d+,\d{1,2}$/.test(piece) ? [piece.replace(",", ".")] : piece.split(",");
    for (const part of parts) {
      if (!part) continue;
      const n = Number(part);
      if (Number.isFinite(n) && n > 0 && /^\d*\.?\d+$/.test(part)) sizes.add(Math.round(n * 100) / 100);
      else bad.push(part);
    }
  }
  return { sizes: [...sizes].sort((a, b) => a - b), bad };
}

/**
 * One change of connector within a set: from this size up, the tips take
 * this cable size. A ChiaoGoo set is two -- small from 2.75 mm, large from
 * 5.5 mm -- and a complete set with mini tips is three.
 */
export interface ConnectorStep {
  from: number;
  size: string;
}

/** The connector a size gets: that of the last step it has reached. */
export function connectorFor(size: number, steps: ConnectorStep[]): string {
  const sorted = [...steps].sort((a, b) => a.from - b.from);
  let found = sorted[0]?.size ?? "";
  for (const step of sorted) if (size >= step.from) found = step.size;
  return found;
}

/** "2.75–5 mm small, 5.5–10 mm large": the sizes grouped by connector. */
export function connectorSummary(sizes: number[], steps: ConnectorStep[]): string {
  const groups: { size: string; first: number; last: number }[] = [];
  for (const mm of [...sizes].sort((a, b) => a - b)) {
    const size = connectorFor(mm, steps);
    const last = groups[groups.length - 1];
    if (last && last.size === size) last.last = mm;
    else groups.push({ size, first: mm, last: mm });
  }
  return groups
    .map((g) => `${g.first === g.last ? trim(g.first) : `${trim(g.first)}–${trim(g.last)}`} mm ${g.size ? cableSizeLabel(g.size).toLowerCase() : "not sure"}`)
    .join(", ");
}
