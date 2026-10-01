import { CABLE_SIZES, TOOL_KINDS, TOOL_MATERIALS, type Tool } from "../api";

/**
 * Filtering and naming needles and hooks.
 *
 * Done here rather than in SQL: a collection is a few hundred rows at the
 * very most, it is listed whole anyway, and the facet counts fall out of the
 * same list. Pure functions, so the harness checks them directly.
 */

/** Whether a tool is free: on no pattern and no named project. */
export const isFree = (t: Tool): boolean => !t.patternId && !t.project.trim();

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

/** What a tool is on: the pattern's title, the named project, or "". */
export function projectName(t: Tool): string {
  if (t.patternId) return t.patternTitle || "A pattern";
  return t.project.trim();
}

function matches(t: Tool, f: ToolFilter): boolean {
  const term = f.search?.trim().toLowerCase();
  if (term) {
    const words = [
      t.brand,
      t.notes,
      t.project,
      t.patternTitle,
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
  if (f.material?.length && !f.material.includes(t.material)) return false;
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
    material: TOOL_MATERIALS.map((m) => ({ key: m.key, label: m.label, count: count((t) => t.material === m.key) })),
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
