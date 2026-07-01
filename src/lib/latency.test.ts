import { describe, it, expect } from "vitest";
import { summarize, pickFastest, RttWindow, type TransportLatency } from "./latency";

describe("summarize", () => {
  it("returns null when there are no usable samples", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([NaN, Infinity, -5])).toBeNull();
  });

  it("computes min / mean / median / p95 over the samples", () => {
    const s = summarize([10, 20, 30, 40, 50])!;
    expect(s.count).toBe(5);
    expect(s.min).toBe(10);
    expect(s.mean).toBe(30);
    expect(s.median).toBe(30); // middle of 1..5 => index 2
    // p95 of a 5-sample set: rank = 0.95*4 = 3.8 → 40 + 0.8*(50-40) = 48
    expect(s.p95).toBeCloseTo(48, 5);
  });

  it("drops non-finite and negative samples before summarizing", () => {
    const s = summarize([NaN, 100, -1, 200, Infinity])!;
    expect(s.count).toBe(2);
    expect(s.min).toBe(100);
    expect(s.median).toBe(150);
  });

  it("reports the lone sample for every percentile of a single-sample set", () => {
    const s = summarize([42])!;
    expect(s).toMatchObject({ count: 1, min: 42, median: 42, p95: 42, mean: 42 });
  });
});

describe("pickFastest", () => {
  const entry = (kind: TransportLatency["kind"], median: number, extra = {}): TransportLatency => ({
    kind,
    summary: { count: 10, min: median, median, p95: median, mean: median, ...extra },
  });

  it("returns null when nothing has samples", () => {
    expect(pickFastest([])).toBeNull();
    expect(
      pickFastest([{ kind: "lan", summary: { count: 0, min: 0, median: 0, p95: 0, mean: 0 } }]),
    ).toBeNull();
  });

  it("picks the transport with the lowest median RTT", () => {
    expect(pickFastest([entry("tunnel", 80), entry("lan", 20), entry("bluetooth", 120)])).toBe("lan");
  });

  it("breaks a near-tie (within epsilon) by declared preference, not noise", () => {
    // tunnel is 2ms 'faster' but that's under the 5ms tie epsilon → prefer LAN.
    expect(pickFastest([entry("tunnel", 20), entry("lan", 22)])).toBe("lan");
    // bluetooth vs tunnel tie → tunnel wins on preference.
    expect(pickFastest([entry("bluetooth", 30), entry("tunnel", 31)])).toBe("tunnel");
  });

  it("still switches when the gap is larger than the tie epsilon", () => {
    // tunnel is 10ms faster than LAN — beyond epsilon, so it wins outright.
    expect(pickFastest([entry("lan", 40), entry("tunnel", 30)])).toBe("tunnel");
  });

  it("ignores entries that have no samples", () => {
    const empty: TransportLatency = { kind: "lan", summary: { count: 0, min: 0, median: 0, p95: 0, mean: 0 } };
    expect(pickFastest([empty, entry("tunnel", 90)])).toBe("tunnel");
  });
});

describe("RttWindow", () => {
  it("summarizes recorded samples and ignores garbage", () => {
    const w = new RttWindow();
    w.record(10);
    w.record(-1); // dropped
    w.record(NaN); // dropped
    w.record(30);
    expect(w.size).toBe(2);
    expect(w.summary()).toMatchObject({ count: 2, min: 10, median: 20 });
  });

  it("caps at capacity, evicting oldest samples (recent-window semantics)", () => {
    const w = new RttWindow(3);
    w.record(100);
    w.record(100);
    w.record(100);
    w.record(10); // evicts the first 100
    w.record(10); // evicts the second 100
    expect(w.size).toBe(3);
    // window is now [100, 10, 10]
    expect(w.summary()!.median).toBe(10);
  });

  it("returns null summary and zero size after clear()", () => {
    const w = new RttWindow();
    w.record(50);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.summary()).toBeNull();
  });
});
