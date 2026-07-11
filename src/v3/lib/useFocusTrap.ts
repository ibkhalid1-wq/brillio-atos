/**
 * Focus containment for the overlay layers (document studio, evidence
 * reader). On mount: remember the opener and move focus inside. While open:
 * Tab cycles within the dialog instead of escaping into the page beneath.
 * On unmount: hand focus back to the opener, so keyboard flow resumes where
 * the drill-down began.
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = node.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node).focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || !node.contains(active))) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (active === lastEl || !node.contains(active))) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [container]);
}
