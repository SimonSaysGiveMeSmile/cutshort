// Tactile feedback for a deck tap
// --------------------------------
// On a pocket shortcut deck a tiny buzz is the most natural confirmation that a
// keystroke actually went out — and a distinct pattern when it didn't land tells
// the thumb something's wrong without the eyes leaving the key. Uses the
// Vibration API, which is absent on iOS Safari; there it silently no-ops and the
// visual toast carries the feedback alone.

/**
 * Buzz to confirm a tap. `ok` = the keystroke reached the agent (short tick) vs.
 * not (a longer double-pulse "nope"). Returns whether a vibration was issued.
 */
export function tapFeedback(ok: boolean): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  return navigator.vibrate(ok ? 8 : [4, 30, 4]);
}
