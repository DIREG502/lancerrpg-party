/**
 * @file SVG geometry for progress clocks. Pure.
 * @module lancer-party/logic/clock
 */

const round = n => Math.round(n * 1000) / 1000;

/**
 * Pie segments for a clock drawn in a `-50 -50 100 100` viewBox, starting at 12 o'clock and
 * going clockwise.
 * @param {number} segments
 * @param {number} value      Filled segments.
 * @param {number} [radius=46]
 * @returns {Array<{d: string, filled: boolean, index: number}>}
 */
export function clockSegments(segments, value, radius = 46) {
  const n = Math.max(1, Math.trunc(Number(segments) || 1));
  const v = Math.max(0, Math.min(n, Math.trunc(Number(value) || 0)));
  const step = (2 * Math.PI) / n;
  const point = angle => `${round(radius * Math.cos(angle))} ${round(radius * Math.sin(angle))}`;
  const result = [];
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step;
    const a1 = a0 + step;
    const large = step > Math.PI ? 1 : 0;
    const d = n === 1
      ? `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius} Z`
      : `M 0 0 L ${point(a0)} A ${radius} ${radius} 0 ${large} 1 ${point(a1)} Z`;
    result.push({ d, filled: i < v, index: i });
  }
  return result;
}
