/**
 * A calculator's steps as a checklist on a project's board: each ticked when
 * done, the first not done being the one knitted now, and a step that
 * repeats ("every other round 10 times") counted as it is knitted. Pure
 * functions, so the harness checks them directly; the board draws the card.
 */

/** One step: its words, whether done, and for one that repeats, how many times and how many so far. */
export interface Step {
  text: string;
  done: boolean;
  /** How many times it is worked; 0 for a step done once. */
  times: number;
  count: number;
}

/** What a board's checklist card holds. */
export interface StepList {
  title: string;
  /** What it is knitted at and from: the gauge, the size, the yarn. */
  intro: string;
  steps: Step[];
}

/**
 * How many times a step is worked, from its words: each "every … N times"
 * added up, so "every other round 5 times, then every round 3 times" is 8.
 * A repeat across a round ("*K6, M1* 4 times") or a chart's ("8 times
 * round") is not one: it is not worked round after round.
 */
export function repeatsIn(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/\bevery\b[^.;:]*?\b(\d+) times\b(?! round)/gi)) n += Number(m[1]);
  return n;
}

export function stepList(title: string, intro: string, steps: string[]): StepList {
  return { title, intro, steps: steps.map((text) => ({ text, done: false, times: repeatsIn(text), count: 0 })) };
}

/** A board item's data read as a checklist, whatever was stored. */
export function readStepList(data: Record<string, unknown>): StepList {
  const steps = Array.isArray(data.steps) ? (data.steps as Partial<Step>[]) : [];
  return {
    title: String(data.title ?? ""),
    intro: String(data.intro ?? ""),
    steps: steps.map((s) => ({ text: String(s.text ?? ""), done: !!s.done, times: Math.max(0, Number(s.times) || 0), count: Math.max(0, Number(s.count) || 0) })),
  };
}

/** The step being knitted: the first not done; -1 when all are. */
export function nowAt(list: StepList): number {
  return list.steps.findIndex((s) => !s.done);
}

/** Ticked, or not. A repeating step ticked is counted to the end; unticked, it keeps its count. */
export function tick(list: StepList, i: number): StepList {
  return {
    ...list,
    steps: list.steps.map((s, j) => (j !== i ? s : s.done ? { ...s, done: false, count: s.times && s.count >= s.times ? s.times - 1 : s.count } : { ...s, done: true, count: s.times || s.count })),
  };
}

/** One more time done (or one fewer): the step ticked when its last is done. */
export function countStep(list: StepList, i: number, by: 1 | -1): StepList {
  return {
    ...list,
    steps: list.steps.map((s, j) => {
      if (j !== i || !s.times) return s;
      const count = Math.max(0, Math.min(s.times, s.count + by));
      return { ...s, count, done: count >= s.times };
    }),
  };
}

/** How far along: steps done of steps. */
export function progress(list: StepList): { done: number; total: number } {
  return { done: list.steps.filter((s) => s.done).length, total: list.steps.length };
}
