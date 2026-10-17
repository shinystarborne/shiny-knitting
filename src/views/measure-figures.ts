/**
 * Small drawings of how a measurement is taken, so a label is never left to
 * guess: a foot seen from above, with the tape round its widest part, or an
 * arrow from the heel to the longest toe. Drawn in the theme's colours: the
 * body in the text's dim colour, the measuring in the accent.
 */

/** A foot from above: the heel at the bottom, the toes at the top, the big toe on the left. */
const FOOT = `
  <path class="mf-body" d="M34 125 C22 125 17 115 17 100 C17 86 13 70 12 56 C11 44 15 36 24 33 C34 30 50 30 56 34 C63 39 62 50 60 60 C57 76 52 88 51 100 C50 115 46 125 34 125 Z" />
  <ellipse class="mf-body" cx="20" cy="22" rx="6" ry="8" />
  <ellipse class="mf-body" cx="31" cy="19" rx="4.4" ry="6" />
  <ellipse class="mf-body" cx="40" cy="20" rx="4" ry="5.4" />
  <ellipse class="mf-body" cx="48" cy="23" rx="3.6" ry="4.8" />
  <ellipse class="mf-body" cx="55" cy="28" rx="3.2" ry="4.2" />`;

const FIGURES: Record<string, { svg: string; caption: string }> = {
  foot_around: {
    caption: "Round the widest part, just behind the toes",
    svg: `
      ${FOOT}
      <path class="mf-tape mf-behind" d="M6 47 A30 6 0 0 1 66 47" />
      <path class="mf-tape" d="M6 47 A30 6 0 0 0 66 47" />`,
  },
  foot_length: {
    caption: "From the back of the heel to the tip of the longest toe",
    svg: `
      ${FOOT}
      <path class="mf-guide" d="M30 125 H72 M20 14 H72" />
      <path class="mf-tape" d="M68 18 V121" />
      <path class="mf-tip" d="M64 21 L68 14 L72 21 Z M64 118 L68 125 L72 118 Z" />`,
  },
};

/** How a measurement is taken, as its drawing's caption says it; empty when it has none. */
export function figureCaption(key: string): string {
  return FIGURES[key]?.caption ?? "";
}

/** Whether a measurement has a drawing. */
export function hasFigure(key: string): boolean {
  return key in FIGURES;
}

/** A measurement's drawing, as SVG; empty when it has none. `size` is its height in px. */
export function measureFigure(key: string, size = 96): string {
  const f = FIGURES[key];
  if (!f) return "";
  return `<svg class="measure-figure" viewBox="0 6 76 124" height="${size}" width="${Math.round((size * 76) / 124)}" role="img" aria-label="${f.caption}">${f.svg}</svg>`;
}
