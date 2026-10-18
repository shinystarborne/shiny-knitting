/**
 * Small drawings of how a measurement is taken, so a label is never left to
 * guess: a figure standing, with the tape round the chest or a line from the
 * underarm to the wrist; a head, a hand, a foot. Drawn in the theme's
 * colours: the body in the text's dim colour, the measuring in the accent. A
 * tape round something is drawn whole in front and dashed behind.
 */

/** A foot from above: the heel at the bottom, the toes at the top, the big toe on the left. */
const FOOT = `
  <path class="mf-body" d="M34 125 C22 125 17 115 17 100 C17 86 13 70 12 56 C11 44 15 36 24 33 C34 30 50 30 56 34 C63 39 62 50 60 60 C57 76 52 88 51 100 C50 115 46 125 34 125 Z" />
  <ellipse class="mf-body" cx="20" cy="22" rx="6" ry="8" />
  <ellipse class="mf-body" cx="31" cy="19" rx="4.4" ry="6" />
  <ellipse class="mf-body" cx="40" cy="20" rx="4" ry="5.4" />
  <ellipse class="mf-body" cx="48" cy="23" rx="3.6" ry="4.8" />
  <ellipse class="mf-body" cx="55" cy="28" rx="3.2" ry="4.2" />`;

/** One arm, the figure's right (on the left of the drawing), hanging at its side. */
const ARM = `<path class="mf-body" d="M28 38 C22 40 20 46 19 54 L16 90 C15.5 94 21 94.5 21.4 90.5 L25.5 58 C26 53 28 49 31 47 Z" /><ellipse class="mf-body" cx="18.4" cy="96" rx="3.6" ry="5.2" />`;

/** A figure standing, from the front: shoulders at y 38, underarms 54, waist 84, hips 102, the floor at 152. */
const BODY = `
  <path class="mf-body" d="M33 108 L35 152 L46 152 L49 113 L51 113 L54 152 L65 152 L67 108 Z" />
  ${ARM}
  <g transform="matrix(-1 0 0 1 100 0)">${ARM}</g>
  <path class="mf-body" d="M45 32 C38 33 31 34 28 38 L31 54 C33 66 34 76 36 84 C34 92 32 100 32 108 L68 108 C68 100 66 92 64 84 C66 76 67 66 69 54 L72 38 C69 34 62 33 55 32 Z" />
  <path class="mf-body" d="M46 24 L54 24 L55 33 L45 33 Z" />
  <ellipse class="mf-body" cx="50" cy="14" rx="9" ry="11" />`;

/** A head from the front, with its ears. */
const HEAD = `
  <path class="mf-body" d="M40 84 L42 100 L58 100 L60 84 Z" />
  <ellipse class="mf-body" cx="24" cy="54" rx="5" ry="9" />
  <ellipse class="mf-body" cx="76" cy="54" rx="5" ry="9" />
  <ellipse class="mf-body" cx="50" cy="50" rx="26" ry="34" />`;

/** A hand, palm towards us, the thumb out to the left. */
const HAND = `
  <ellipse class="mf-body" cx="16" cy="80" rx="6.5" ry="17" transform="rotate(-32 16 80)" />
  <ellipse class="mf-body" cx="27" cy="32" rx="5" ry="18" />
  <ellipse class="mf-body" cx="38" cy="26" rx="5" ry="21" />
  <ellipse class="mf-body" cx="49" cy="28" rx="5" ry="20" />
  <ellipse class="mf-body" cx="59" cy="36" rx="4.6" ry="16" />
  <path class="mf-body" d="M21 60 C21 50 23 46 27 46 L59 46 C63 46 65 50 65 60 L65 96 C65 111 57 119 43 119 C29 119 21 111 21 96 Z" />
  <path class="mf-body" d="M37 119 L37 128 L55 128 L55 116" />`;

/** A tape round a body at `y`, from x `a` to `b`, `d` deep: whole in front, dashed behind. */
function round(a: number, b: number, y: number, d: number): string {
  const r = (b - a) / 2;
  return `<path class="mf-tape mf-behind" d="M${a} ${y} A${r} ${d} 0 0 1 ${b} ${y}" /><path class="mf-tape" d="M${a} ${y} A${r} ${d} 0 0 0 ${b} ${y}" />`;
}

/** A measured line from one point to another, with an arrow's tip at each end. */
function line(x1: number, y1: number, x2: number, y2: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const tip = (x: number, y: number, dx: number, dy: number) => `M${x} ${y} L${x - dx * 6 - dy * 3.5} ${y - dy * 6 + dx * 3.5} L${x - dx * 6 + dy * 3.5} ${y - dy * 6 - dx * 3.5} Z`;
  return `<path class="mf-tape" d="M${x1 + ux * 3} ${y1 + uy * 3} L${x2 - ux * 3} ${y2 - uy * 3}" /><path class="mf-tip" d="${tip(x2, y2, ux, uy)} ${tip(x1, y1, -ux, -uy)}" />`;
}

/** Faint lines showing where a measurement starts or ends. */
function guide(d: string): string {
  return `<path class="mf-guide" d="${d}" />`;
}

type Figure = { svg: string; caption: string; view: [number, number, number, number] };

const BODY_VIEW: [number, number, number, number] = [6, 0, 92, 156];
const body = (marks: string, caption: string): Figure => ({ svg: BODY + marks, caption, view: BODY_VIEW });

const FIGURES: Record<string, Figure> = {
  height: body(`${guide("M50 3 H92 M22 152 H92")}${line(88, 3, 88, 152)}`, "Standing straight, without shoes: from the floor to the top of the head"),
  chest: body(round(30, 70, 48, 4), "Round the fullest part of the chest, under the arms"),
  waist: body(round(36, 64, 82, 3.4), "Round the narrowest part of the body"),
  hips: body(round(31, 69, 102, 4), "Round the fullest part of the hips"),
  neck: body(round(44, 56, 30, 2), "Round the base of the neck"),
  shoulders: body(`${guide("M28 38 V27 M72 38 V27")}${line(28, 30, 72, 30)}`, "Across the back, from one shoulder point to the other"),
  upper_arm: body(round(17.5, 28, 52, 2.4), "Round the fullest part of the upper arm"),
  wrist: body(round(14.5, 22.5, 88, 2), "Round the wrist, over the wrist bone"),
  arm_length: body(`${guide("M31 54 H24 M15 90 H24")}${line(25, 55, 19.5, 89)}`, "From the underarm to the wrist, the arm straight"),
  armhole_depth: body(`${guide("M30 54 H42")}${line(36, 36, 36, 54)}`, "From the top of the shoulder straight down to the underarm"),
  back_length: body(`${guide("M44 32 H56 M38 84 H62")}${line(50, 32, 50, 84)}`, "Down the back, from the bone at the nape of the neck to the waist"),
  // Not one kept in People: the calculators' body, underarm to hem.
  body_length: body(`${guide("M58 54 H69 M58 104 H68")}${line(62, 54, 62, 104)}`, "From the underarm down to where the hem will come"),
  head: { svg: HEAD + round(22, 78, 38, 9), caption: "Round the forehead, just above the ears", view: [10, 10, 80, 94] },
  hand: { svg: HAND + round(19, 67, 52, 6), caption: "Round the knuckles, without the thumb", view: [0, 4, 72, 128] },
  foot_around: {
    caption: "Round the widest part, just behind the toes",
    svg: `
      ${FOOT}
      <path class="mf-tape mf-behind" d="M6 47 A30 6 0 0 1 66 47" />
      <path class="mf-tape" d="M6 47 A30 6 0 0 0 66 47" />`,
    view: [0, 6, 76, 124],
  },
  foot_length: {
    caption: "From the back of the heel to the tip of the longest toe",
    svg: `
      ${FOOT}
      <path class="mf-guide" d="M30 125 H72 M20 14 H72" />
      <path class="mf-tape" d="M68 18 V121" />
      <path class="mf-tip" d="M64 21 L68 14 L72 21 Z M64 118 L68 125 L72 118 Z" />`,
    view: [0, 6, 76, 124],
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
  const [x, y, w, h] = f.view;
  return `<svg class="measure-figure" data-figure="${key}" viewBox="${x} ${y} ${w} ${h}" height="${size}" width="${Math.round((size * w) / h)}" role="img" aria-label="${f.caption}">${f.svg}</svg>`;
}
