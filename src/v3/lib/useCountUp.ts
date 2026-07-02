import React from "react";
import { prefersReducedMotion } from "@/v3/lib/reducedMotion";

/**
 * Tween a number toward `target` whenever it changes, easing from the value
 * currently on screen (not from zero) so an update glides the delta rather than
 * snapping. Returns the live animated value; format it at the call site.
 *
 * First render shows `target` immediately — only *transitions* animate — so
 * there is no count-up-from-zero flash on mount. Honours reduced-motion by
 * jumping straight to the target.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = React.useState(target);
  // Mirror the on-screen value so a mid-flight target change tweens from here.
  const valueRef = React.useRef(target);
  valueRef.current = value;

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;

    let frame = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setValue(from + (target - from) * eased);
        frame = window.requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
