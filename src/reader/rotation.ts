/**
 * Turning a page, for a chart printed sideways to fit.
 *
 * Marks and pins are kept in the page's own upright frame and only turned on
 * the way to the screen. Stored that way, turning a page never moves what is
 * on it: a mark made upright stays on the same stitch after a turn, and one
 * made on a turned page is still in the right place if it is turned back.
 *
 * Coordinates are 0..1 fractions of the page. Turns are clockwise, in degrees.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Brings any whole number of quarter turns round to 0, 90, 180 or 270. */
export function normalRotation(degrees: number): Rotation {
  const r = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/** Where a point on the upright page shows on the page turned by `r`. */
export function pointToView(p: Point, r: Rotation): Point {
  switch (r) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return p;
  }
}

/** The point on the upright page under a point on the page turned by `r`. */
export function pointFromView(p: Point, r: Rotation): Point {
  switch (r) {
    case 90:
      return { x: p.y, y: 1 - p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: 1 - p.y, y: p.x };
    default:
      return p;
  }
}

function corners(b: Box, map: (p: Point) => Point): Box {
  const a = map({ x: b.x, y: b.y });
  const c = map({ x: b.x + b.w, y: b.y + b.h });
  return {
    x: Math.min(a.x, c.x),
    y: Math.min(a.y, c.y),
    w: Math.abs(c.x - a.x),
    h: Math.abs(c.y - a.y),
  };
}

/** A box on the upright page, as it shows on the page turned by `r`. */
export function boxToView(b: Box, r: Rotation): Box {
  return r === 0 ? b : corners(b, (p) => pointToView(p, r));
}

/** The box on the upright page under a box on the page turned by `r`. */
export function boxFromView(b: Box, r: Rotation): Box {
  return r === 0 ? b : corners(b, (p) => pointFromView(p, r));
}
