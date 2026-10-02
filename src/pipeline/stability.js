/**
 * Stable read: accept a value only after it has been read identically N times, so
 * animation or a half-painted frame cannot fill a wrong number.
 *
 * Pure so the streak logic can be tested without a browser.
 */
export function stableRead(previous, text, needed) {
  const streak = previous && previous.text === text ? (previous.streak || 1) + 1 : 1;

  return {
    text,
    streak,
    accepted: streak >= Math.max(1, needed),
  };
}
