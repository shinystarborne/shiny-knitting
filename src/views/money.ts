import type { Pattern, Project, Yarn, YarnLot, YarnUse } from "../api";

/**
 * Prices: what yarn and patterns cost, and the sums -- what the stash is
 * worth now, what was spent month by month, what a project cost. A price is
 * a plain number in the one currency of the settings, so they add up.
 * Pure functions, so the harness checks them directly.
 */

/** A sum of money as the system writes it in the currency: "4,95 €", "€4.95". */
export function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * A price from what was typed: "4,95", "4.95", "€4.95 a ball", "1.234,50",
 * "12 EUR". Null when there is no number in it.
 */
export function parsePrice(text: string): number | null {
  const m = /\d[\d.,\s]*/.exec(text.replace(/ /g, " "));
  if (!m) return null;
  let t = m[0].trim().replace(/\s/g, "");
  const comma = t.lastIndexOf(",");
  const dot = t.lastIndexOf(".");
  const last = Math.max(comma, dot);
  // The last separator is the decimal one when two digits or one follow it;
  // three are thousands ("1,000"), and the other separator is thousands too.
  if (last >= 0 && t.length - last - 1 <= 2 && t.length - last - 1 > 0) t = `${t.slice(0, last).replace(/[.,]/g, "")}.${t.slice(last + 1)}`;
  else t = t.replace(/[.,]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * A wishlist price as a ball's: as typed when it says it is for one ("a
 * ball", "each", "per", "/"), else what was paid shared out over the balls
 * bought, when there were several.
 */
export function pricePerBall(text: string, balls: number): number | null {
  const n = parsePrice(text);
  if (n === null) return null;
  const each = /\b(a|per|each|je|pro|stück|stk)\b|ball|knäuel|skein|\//i.test(text);
  return each || !(balls > 1) ? n : Math.round((n / balls) * 100) / 100;
}

/** What a lot cost: its balls at its price; null when its price is not said. */
export function lotCost(lot: YarnLot): number | null {
  return lot.price == null ? null : Math.round(lot.price * (lot.balls || 0) * 100) / 100;
}

/** What is left of a lot is worth: its balls whole, or the share of a ball weighed. */
export function lotWorth(lot: YarnLot, y: Yarn): number | null {
  if (lot.price == null) return null;
  const balls = lot.weighed ? (y.gramsPerBall ? lot.gramsLeft / y.gramsPerBall : lot.balls) : lot.balls;
  return lot.price * (balls || 0);
}

/** What the yarn in the stash is worth now, and how many of its lots have no price. */
export function stashWorth(yarns: Yarn[]): { worth: number; unpriced: number } {
  let worth = 0;
  let unpriced = 0;
  for (const y of yarns.filter((x) => !x.usedUpAt)) {
    for (const lot of y.lots) {
      const w = lotWorth(lot, y);
      if (w === null) unpriced++;
      else worth += w;
    }
  }
  return { worth: Math.round(worth * 100) / 100, unpriced };
}

/** One thing bought, as the spending lists it. */
export interface Spend {
  at: number;
  kind: "yarn" | "pattern";
  name: string;
  amount: number;
}

/** Everything bought with a price: the yarn by its lots, dated when bought; patterns when added. */
export function spending(yarns: Yarn[], patterns: Pattern[]): Spend[] {
  const out: Spend[] = [];
  for (const y of yarns) {
    const name = [y.brand, y.name].filter(Boolean).join(" ") + (y.colourway ? ` (${y.colourway})` : "");
    for (const lot of y.lots) {
      const cost = lotCost(lot);
      if (cost) out.push({ at: lot.boughtAt ?? y.addedAt, kind: "yarn", name: `${name}${lot.balls ? `, ${lot.balls} ball${lot.balls === 1 ? "" : "s"}` : ""}`, amount: cost });
    }
  }
  for (const p of patterns) if (p.price) out.push({ at: p.addedAt, kind: "pattern", name: p.title, amount: p.price });
  return out.sort((a, b) => b.at - a.at);
}

/** What was spent in each of the last `count` calendar months, the oldest first. */
export function spentByMonth(spends: Spend[], now = Date.now(), count = 12): { start: number; label: string; yarn: number; patterns: number; items: Spend[] }[] {
  const today = new Date(now);
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(today.getFullYear(), today.getMonth() - (count - 1 - i), 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const items = spends.filter((s) => s.at >= from.getTime() && s.at < to.getTime());
    const sum = (kind: Spend["kind"]) => Math.round(items.filter((s) => s.kind === kind).reduce((n, s) => n + s.amount, 0) * 100) / 100;
    return { start: from.getTime(), label: from.toLocaleDateString(undefined, { month: "long", year: "numeric" }), yarn: sum("yarn"), patterns: sum("pattern"), items };
  });
}

/**
 * What a project cost: its pattern, and its yarn by what it took -- what a
 * finished one used, else what it plans to take -- at its lot's price a
 * ball. Tools are not counted. Says what is not known.
 */
export function projectCost(p: Project, yarns: Yarn[], patterns: Pattern[], uses: YarnUse[]): { yarn: number; pattern: number; total: number; unknown: string[] } {
  const unknown: string[] = [];
  let yarn = 0;
  for (const py of p.yarns) {
    const y = yarns.find((x) => x.id === py.yarnId);
    const lot = y?.lots.find((l) => l.id === py.lotId) ?? y?.lots.find((l) => l.price != null);
    const used = uses.filter((u) => u.projectId === p.id && u.yarnId === py.yarnId && u.source === "finished").reduce((n, u) => n + u.grams, 0);
    const grams = used || py.plannedGrams || 0;
    if (!y || lot?.price == null || !y.gramsPerBall || !grams) {
      unknown.push(py.yarnName);
      continue;
    }
    yarn += (grams / y.gramsPerBall) * lot.price;
  }
  const pattern = p.patternId ? (patterns.find((x) => x.id === p.patternId)?.price ?? 0) : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { yarn: round(yarn), pattern: round(pattern), total: round(yarn + pattern), unknown };
}
