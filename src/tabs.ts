import { api } from "./api";

/**
 * The app's tabs, in the order the tab bar shows them, and which of them are
 * hidden in Settings. Settings itself is the gear and is never one of them.
 */

export type Tab = "patterns" | "projects" | "people" | "calculators" | "charts" | "cheatsheets" | "masterclasses" | "ravelry" | "inspiration" | "stash" | "tools" | "wishlist" | "shops";

export const TABS: { tab: Tab; label: string }[] = [
  { tab: "patterns", label: "Patterns" },
  { tab: "projects", label: "Projects" },
  { tab: "people", label: "People" },
  { tab: "calculators", label: "Constructors" },
  { tab: "charts", label: "Charts" },
  { tab: "cheatsheets", label: "Cheatsheets" },
  { tab: "masterclasses", label: "Masterclasses" },
  { tab: "ravelry", label: "Ravelry" },
  { tab: "inspiration", label: "Inspiration" },
  { tab: "stash", label: "Stash" },
  { tab: "tools", label: "Needles & hooks" },
  { tab: "wishlist", label: "Wishlist" },
  { tab: "shops", label: "Shops" },
];

export function tabLabel(tab: Tab): string {
  return TABS.find((t) => t.tab === tab)?.label ?? tab;
}

/** The hidden tabs, as kept; none when they cannot be read. */
export async function hiddenTabs(): Promise<Set<Tab>> {
  const known = new Set(TABS.map((t) => t.tab));
  const kept = await api.getHiddenTabs().catch(() => [] as string[]);
  return new Set(kept.filter((t): t is Tab => known.has(t as Tab)));
}

/** Said on the document when Settings changed which tabs are hidden. */
export const HIDDEN_TABS_EVENT = "hidden-tabs";
