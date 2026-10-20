/**
 * A plain calculator, + − × ÷, for a card on a project's board: worked as a
 * phone's is -- × and ÷ before + and −, so 2 + 3 × 4 is 14; a % after + or −
 * a share of what comes before it, so 200 + 10 % is 220 -- with the decimal
 * comma or point as this computer writes numbers. No DOM, so the harness
 * checks it directly.
 */

export type SumOp = "+" | "−" | "×" | "÷";

export interface SumState {
  /** Numbers and operators so far, before the one being typed. */
  terms: (number | SumOp)[];
  /** The number being typed, as typed ("12", "0,5", "-3"); "" before one is. */
  entry: string;
  /** What = came to, shown until the next key; null when none. */
  result: number | null;
  /** Said instead of a number: dividing by nothing. */
  error: string | null;
  /** The sums done, newest last: "12 × 4 = 48". */
  tape: string[];
}

/** How many sums the tape keeps. */
export const TAPE = 20;

/** The decimal sign this computer writes: "," or ".". */
export function decimalSign(): string {
  return (1.5).toLocaleString().includes(",") ? "," : ".";
}

export function emptySum(tape: string[] = []): SumState {
  return { terms: [], entry: "", result: null, error: null, tape };
}

/** A number as the calculator shows it: twelve figures at most, the decimal sign of this computer. */
export function showNumber(n: number, sign = decimalSign()): string {
  if (!Number.isFinite(n)) return "—";
  const tidy = Number(n.toPrecision(12));
  const text = Math.abs(tidy) >= 1e12 || (tidy !== 0 && Math.abs(tidy) < 1e-9) ? tidy.toExponential(6) : String(tidy);
  return text.replace(".", sign);
}

function entryValue(entry: string): number {
  const n = Number(entry.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** × and ÷ first, then + and −, left to right; null when something is divided by nothing. */
export function evaluate(terms: (number | SumOp)[]): number | null {
  if (!terms.length) return 0;
  // Ends on an operator: as far as it goes.
  const t = typeof terms[terms.length - 1] === "number" ? terms : terms.slice(0, -1);
  const sums: number[] = [t[0] as number];
  const signs: SumOp[] = [];
  for (let i = 1; i < t.length; i += 2) {
    const op = t[i] as SumOp;
    const n = t[i + 1] as number;
    if (op === "×" || op === "÷") {
      if (op === "÷" && n === 0) return null;
      sums[sums.length - 1] = op === "×" ? sums[sums.length - 1] * n : sums[sums.length - 1] / n;
    } else {
      signs.push(op);
      sums.push(n);
    }
  }
  return sums.reduce((all, n, i) => (i === 0 ? n : signs[i - 1] === "+" ? all + n : all - n), 0);
}

/** The sum as it reads so far: "12 × 4 −". */
export function expression(s: SumState, sign = decimalSign()): string {
  return s.terms.map((t) => (typeof t === "number" ? showNumber(t, sign) : t)).join(" ");
}

/** What the display shows: the number being typed, what = came to, or what went wrong. */
export function display(s: SumState, sign = decimalSign()): string {
  if (s.error) return s.error;
  if (s.entry) return s.entry.replace(/[.,]/, sign);
  if (s.result !== null) return showNumber(s.result, sign);
  const last = [...s.terms].reverse().find((t) => typeof t === "number");
  return typeof last === "number" ? showNumber(last, sign) : "0";
}

/**
 * A key pressed: a figure, the decimal sign ("," or "."), an operator, "=",
 * "%", "±" (the sign of the number typed), "⌫" (its last figure) or "C".
 */
export function press(s: SumState, key: string, sign = decimalSign()): SumState {
  const next: SumState = { ...s, terms: [...s.terms], tape: [...s.tape] };
  if (key === "C") return emptySum(s.tape);
  if (next.error) Object.assign(next, emptySum(s.tape));
  if (/^\d$/.test(key)) {
    // After =, a figure starts a new sum.
    if (next.result !== null) next.result = null;
    if (next.entry.replace(/[-.,]/g, "").length >= 15) return next;
    next.entry = next.entry === "0" ? key : next.entry === "-0" ? `-${key}` : next.entry + key;
    return next;
  }
  if (key === "," || key === ".") {
    if (next.result !== null) next.result = null;
    if (/[.,]/.test(next.entry)) return next;
    next.entry = (next.entry === "" || next.entry === "-" ? `${next.entry}0` : next.entry) + sign;
    return next;
  }
  if (key === "⌫") {
    if (next.result !== null) return next;
    next.entry = next.entry.slice(0, -1);
    if (next.entry === "-") next.entry = "";
    return next;
  }
  if (key === "±") {
    if (next.result !== null) {
      next.entry = showNumber(-next.result, sign);
      next.result = null;
      return next;
    }
    next.entry = next.entry.startsWith("-") ? next.entry.slice(1) : `-${next.entry || "0"}`;
    return next;
  }
  if (key === "%") {
    const n = next.result !== null ? next.result : entryValue(next.entry);
    const before = next.terms.length >= 2 ? next.terms[next.terms.length - 1] : null;
    // After + or −: that share of what comes before; otherwise a hundredth.
    const base = before === "+" || before === "−" ? evaluate(next.terms.slice(0, -1)) ?? 0 : 1;
    next.entry = showNumber(before === "+" || before === "−" ? (base * n) / 100 : n / 100, sign);
    next.result = null;
    return next;
  }
  if (key === "+" || key === "−" || key === "×" || key === "÷") {
    if (next.result !== null) {
      next.terms = [next.result, key];
      next.result = null;
      return next;
    }
    if (next.entry !== "" && next.entry !== "-") {
      next.terms.push(entryValue(next.entry), key);
      next.entry = "";
    } else if (next.terms.length && typeof next.terms[next.terms.length - 1] !== "number") {
      // Another operator, changing one's mind.
      next.terms[next.terms.length - 1] = key;
    } else {
      next.terms.push(0, key);
    }
    return next;
  }
  if (key === "=") {
    const terms = [...next.terms];
    if (next.entry !== "" && next.entry !== "-") terms.push(entryValue(next.entry));
    if (terms.length < 3 || typeof terms[terms.length - 1] !== "number") return next;
    const value = evaluate(terms);
    if (value === null) return { ...emptySum(next.tape), error: "Can't divide by 0" };
    const written = terms.map((t) => (typeof t === "number" ? showNumber(t, sign) : t)).join(" ");
    return { terms: [], entry: "", result: value, error: null, tape: [...next.tape, `${written} = ${showNumber(value, sign)}`].slice(-TAPE) };
  }
  return next;
}

/** A key on the keyboard, as the calculator's key; null when it is none of them. */
export function keyOf(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const map: Record<string, string> = { "+": "+", "-": "−", "*": "×", x: "×", X: "×", "/": "÷", "=": "=", Enter: "=", "%": "%", ",": ",", ".": ".", Backspace: "⌫", Escape: "C", Delete: "C" };
  if (/^\d$/.test(e.key)) return e.key;
  return map[e.key] ?? null;
}
