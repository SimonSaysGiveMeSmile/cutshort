// Transport latency A/B
// ----------------------
// The README promises the winning transport (lan / tunnel / bluetooth) is
// "decided by test results". This is that decision layer: it turns a stream of
// round-trip-time samples per transport into a comparable summary, then picks
// the fastest. It is deliberately pure — no timers, no sockets — so the wiring
// (which records real RTTs off the existing ping/pong heartbeat) can stay thin
// and this can be unit-tested without hardware.

import type { Transport } from "./connection";

export type TransportKind = Transport["kind"]; // "lan" | "tunnel" | "bluetooth"

export interface LatencySummary {
  /** How many valid samples fed this summary. */
  count: number;
  min: number;
  /** 50th percentile — the headline number we rank transports by. */
  median: number;
  /** 95th percentile — tail latency; a low median with a bad p95 still janks. */
  p95: number;
  mean: number;
}

export interface TransportLatency {
  kind: TransportKind;
  summary: LatencySummary;
}

// When two medians are within this many milliseconds we treat them as tied and
// fall back to the roadmap's declared preference rather than chasing noise: a
// 1ms edge over WiFi is measurement jitter, not a reason to switch pipes.
const TIE_EPSILON_MS = 5;

// Preference when latencies tie: LAN (primary) beats tunnel (fallback) beats
// bluetooth (supplementary). Lower index wins. Mirrors the README table.
const PREFERENCE: readonly TransportKind[] = ["lan", "tunnel", "bluetooth"];

/**
 * Reduce raw RTT samples (milliseconds) to a comparable summary. Non-finite and
 * negative samples are dropped (a clock skew or a lost pong shouldn't poison the
 * stats). Returns null when nothing usable remains.
 */
export function summarize(samples: readonly number[]): LatencySummary | null {
  const clean = samples.filter((n) => Number.isFinite(n) && n >= 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count,
    min: sorted[0],
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean: sum / count,
  };
}

/**
 * Linear-interpolated percentile over an ascending-sorted array. `p` is 0–100.
 * Single-sample arrays return that sample for every percentile.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Pick the fastest transport from per-transport summaries. Primary key is the
 * median RTT; medians within TIE_EPSILON_MS are considered equal and broken by
 * the declared preference order (lan > tunnel > bluetooth). Entries without a
 * summary are ignored; returns null when there's nothing to choose from.
 */
export function pickFastest(entries: readonly TransportLatency[]): TransportKind | null {
  const ranked = entries.filter((e) => e && e.summary && e.summary.count > 0);
  if (ranked.length === 0) return null;
  let best = ranked[0];
  for (const e of ranked.slice(1)) {
    if (isFaster(e, best)) best = e;
  }
  return best.kind;
}

/** Is `a` a better choice than `b`? Median first, then preference on a tie. */
function isFaster(a: TransportLatency, b: TransportLatency): boolean {
  const delta = a.summary.median - b.summary.median;
  if (Math.abs(delta) > TIE_EPSILON_MS) return delta < 0;
  // Median tie → defer to the declared preference order.
  return prefIndex(a.kind) < prefIndex(b.kind);
}

function prefIndex(kind: TransportKind): number {
  const i = PREFERENCE.indexOf(kind);
  return i === -1 ? PREFERENCE.length : i;
}

/**
 * A fixed-capacity ring of RTT samples for one transport. The wiring records a
 * timestamp when it sends a ping and calls `record(now - sentAt)` on the pong;
 * `summary()` collapses the ring for the A/B. Bounded so a long-lived session
 * doesn't grow without limit and so the summary reflects *recent* conditions.
 */
export class RttWindow {
  private readonly samples: number[] = [];
  constructor(private readonly cap = 50) {}

  record(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return; // ignore garbage samples
    this.samples.push(rttMs);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  summary(): LatencySummary | null {
    return summarize(this.samples);
  }

  clear(): void {
    this.samples.length = 0;
  }
}
