import { describe, it, expect, vi, afterEach } from "vitest";
import { tapFeedback } from "./haptics";

describe("tapFeedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("buzzes a short tick when the tap landed", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(tapFeedback(true)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("uses a distinct double-pulse when the tap didn't land", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    tapFeedback(false);
    expect(vibrate).toHaveBeenCalledWith([4, 30, 4]);
  });

  it("no-ops (returns false) where the Vibration API is absent, e.g. iOS Safari", () => {
    vi.stubGlobal("navigator", {});
    expect(tapFeedback(true)).toBe(false);
  });
});
