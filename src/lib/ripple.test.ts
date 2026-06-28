import { describe, it, expect } from "vitest";
import { rippleGeometry } from "./ripple";

// Pure geometry for the deck-key ripple — testable without layout.
describe("rippleGeometry", () => {
  it("sizes the ripple to 40% of the longer edge", () => {
    expect(rippleGeometry({ width: 100, height: 60, left: 0, top: 0 }, 0, 0).size).toBe(40);
    expect(rippleGeometry({ width: 50, height: 80, left: 0, top: 0 }, 0, 0).size).toBe(32);
  });

  it("anchors the ripple at the pointer position relative to the button's box", () => {
    const g = rippleGeometry({ width: 100, height: 100, left: 20, top: 10 }, 70, 60);
    expect(g.left).toBe(50); // 70 - 20
    expect(g.top).toBe(50); // 60 - 10
  });
});
