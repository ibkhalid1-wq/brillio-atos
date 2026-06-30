/**
 * Time-recency primitives — "is this timestamp still fresh?".
 *
 * Centralises the freshness rules the daily-briefing flow depends on so its
 * same-day staleness guard and its auto-trigger throttle can never drift apart,
 * and so the semantics (an empty or legacy/unparseable stamp counts as NOT
 * fresh) are unit-testable instead of being inlined twice inside a component.
 *
 * Pure, deterministic. `now` is injectable for tests.
 */

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when `stamp` falls on the same UTC calendar day as `now`. Compares the
 * leading YYYY-MM-DD, so a date-only stamp ("2026-06-30") and a full ISO
 * instant ("2026-06-30T08:00:00Z") are treated identically. An empty/nullish
 * stamp is never "today".
 */
export function isSameUtcDay(stamp: string | null | undefined, now: Date = new Date()): boolean {
  if (!stamp) return false;
  return stamp.slice(0, 10) === now.toISOString().slice(0, 10);
}

/**
 * True when `stamp` parses to an instant within `windowMs` before `nowMs`. A
 * stamp that doesn't parse — null, empty, or a legacy epoch-millis value written
 * before stamps were ISO — yields NaN and is treated as NOT fresh, so a stale or
 * garbage marker can never suppress a refresh.
 */
export function isWithinMs(
  stamp: string | null | undefined,
  windowMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!stamp) return false;
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed < windowMs;
}
