/**
 * The care symbols a ball band shows, drawn and named: washing, bleaching,
 * drying, ironing and dry cleaning, in the order a label is read. Mirrors
 * `models.rs::CARE_SYMBOLS`; a yarn keeps their ids, for every colour of it.
 */

export interface CareSymbol {
  id: string;
  /** What it says, in words, beside the symbol. */
  label: string;
  /** Symbols of one group exclude each other: a label has one way to wash. */
  group: "wash" | "bleach" | "tumble" | "flat" | "iron" | "clean";
  /** The drawing, inside a 24 × 24 box. */
  shape: string;
}

const TUB = `<path d="M2.5 6.5q2.4-2.4 4.75 0t4.75 0 4.75 0 4.75 0M2.8 6.5l2 11h14.4l2-11"/>`;
const temp = (t: string) => `<text x="12" y="15.3" text-anchor="middle" font-size="6.6" font-weight="600" fill="currentColor" stroke="none">${t}</text>`;
const BAR = `<path d="M5 20.3h14"/>`;
const BARS = `<path d="M5 20.3h14M5 22.8h14"/>`;
const HAND = `<path d="M9.2 15.6v-4.4M10.9 15.6v-5.4M12.6 15.6v-5M14.3 15.6v-3.8M9.2 15.6q2.6 1.5 5.1 0"/>`;
const CROSS = `<path d="M3 3l18 18M21 3 3 21"/>`;
const TRIANGLE = `<path d="M12 3.5 21.5 20h-19z"/>`;
const SQUARE = `<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>`;
const IRON = `<path d="M3 18.5 6 10.5h11.5q3.5 0 3.5 3.5v4.5zM8 10.5V7.5h8.5"/>`;
const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.1" fill="currentColor" stroke="none"/>`;
const CIRCLE = `<circle cx="12" cy="12" r="8.5"/>`;

export const CARE_SYMBOLS: CareSymbol[] = [
  { id: "wash-30", group: "wash", label: "Machine wash 30°", shape: TUB + temp("30") },
  { id: "wash-30-gentle", group: "wash", label: "Machine wash 30°, gentle", shape: TUB + temp("30") + BAR },
  { id: "wash-30-wool", group: "wash", label: "Machine wash 30°, wool cycle", shape: TUB + temp("30") + BARS },
  { id: "wash-40", group: "wash", label: "Machine wash 40°", shape: TUB + temp("40") },
  { id: "wash-40-gentle", group: "wash", label: "Machine wash 40°, gentle", shape: TUB + temp("40") + BAR },
  { id: "wash-60", group: "wash", label: "Machine wash 60°", shape: TUB + temp("60") },
  { id: "hand-wash", group: "wash", label: "Hand wash only", shape: TUB + HAND },
  { id: "no-wash", group: "wash", label: "Do not wash", shape: TUB + CROSS },
  { id: "no-bleach", group: "bleach", label: "Do not bleach", shape: TRIANGLE + CROSS },
  { id: "tumble-low", group: "tumble", label: "Tumble dry, low heat", shape: SQUARE + `<circle cx="12" cy="12" r="6"/>` + dot(12, 12) },
  { id: "no-tumble", group: "tumble", label: "Do not tumble dry", shape: SQUARE + `<circle cx="12" cy="12" r="6"/>` + CROSS },
  { id: "dry-flat", group: "flat", label: "Dry flat", shape: SQUARE + `<path d="M7 12h10"/>` },
  { id: "iron-low", group: "iron", label: "Iron on low (110°)", shape: IRON + dot(12.5, 14.8) },
  { id: "iron-medium", group: "iron", label: "Iron on medium (150°)", shape: IRON + dot(10.8, 14.8) + dot(14.4, 14.8) },
  { id: "no-iron", group: "iron", label: "Do not iron", shape: IRON + CROSS },
  { id: "dry-clean", group: "clean", label: "Dry clean", shape: CIRCLE + `<text x="12" y="15.4" text-anchor="middle" font-size="9.5" font-weight="600" fill="currentColor" stroke="none">P</text>` },
  { id: "no-dry-clean", group: "clean", label: "Do not dry clean", shape: CIRCLE + CROSS },
];

export function careSymbol(id: string): CareSymbol | undefined {
  return CARE_SYMBOLS.find((c) => c.id === id);
}

/** A symbol as an icon, sized by CSS; its meaning is the label beside it. */
export function careIcon(c: CareSymbol): string {
  return `<svg class="care-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c.shape}</svg>`;
}

/** The ids chosen, in the order a label is read. */
export function careOrder(ids: string[]): string[] {
  return CARE_SYMBOLS.map((c) => c.id).filter((id) => ids.includes(id));
}

/** One choice in a group: picking a symbol takes the others of its group away. */
export function toggleCare(ids: string[], id: string): string[] {
  const c = careSymbol(id);
  if (!c) return ids;
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return careOrder([...ids.filter((x) => careSymbol(x)?.group !== c.group), id]);
}
