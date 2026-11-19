/** For the checks: equal but for floating-point rounding (a price, a length). */
export const near = (a: number | null | undefined, b: number): boolean => a != null && Math.abs(a - b) < 1e-9;
