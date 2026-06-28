// Ripple geometry
// ---------------
// Pure math for the touch-ripple on a deck key: given the button's rect and the
// pointer position, the span's size and where to anchor it. Extracted from the
// component so it's unit-testable (jsdom has no real layout) and the button stays
// thin glue.

export interface RippleStyle {
  size: number;
  left: number;
  top: number;
}

export function rippleGeometry(
  rect: { width: number; height: number; left: number; top: number },
  clientX: number,
  clientY: number,
): RippleStyle {
  return {
    size: Math.max(rect.width, rect.height) * 0.4,
    left: clientX - rect.left,
    top: clientY - rect.top,
  };
}
