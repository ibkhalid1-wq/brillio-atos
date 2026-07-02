/**
 * Runtime check for the user's reduced-motion preference.
 *
 * JS-driven animations (count-ups, arc tweens) can't be disabled by the CSS
 * `@media (prefers-reduced-motion: reduce)` query, so components that tween a
 * value in JavaScript consult this instead and snap straight to the target when
 * the user has asked for reduced motion. SSR/non-DOM safe (returns false).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
