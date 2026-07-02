import React, { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows vertically to fit its content so the full value is always
 * visible without an inner scrollbar. Resizes on every value change — including
 * programmatic ones (e.g. AI field-assist, or a grid cell adopting a projected
 * draft) — not just on keystrokes.
 *
 * When the host enables a resize handle (`resize: vertical`), a height the user
 * drags to is remembered as a floor: auto-grow still expands past it to fit
 * longer content, but never shrinks the box below the size the user chose. This
 * lets the manual drag handle and content-fitting coexist instead of the next
 * keystroke snapping the box back. Fields with `resize: none` (e.g. grid cells)
 * simply never trigger the drag path and keep pure content-fit behaviour.
 *
 * Shared by the free-text phase inputs (PhaseInputsPanel) and the structured-grid
 * text cells (StructuredGrid) so both scale to their content identically.
 */
export default function AutoGrowTextarea({
  value,
  onPointerDown,
  onPointerUp,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Height the user has explicitly dragged to, if any. Once set it becomes a
  // floor — never shrinks below it — but content taller than it still grows.
  const userHeightRef = useRef<number | null>(null);
  // Height captured on pointer-down so pointer-up can tell a resize-handle drag
  // (height changed) apart from an ordinary click (height unchanged).
  const pressHeightRef = useRef<number | null>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const content = el.scrollHeight;
    const floor = userHeightRef.current;
    el.style.height = `${floor != null ? Math.max(content, floor) : content}px`;
  }, []);

  useLayoutEffect(() => {
    fit();
  }, [value, fit]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLTextAreaElement>) => {
      pressHeightRef.current = ref.current?.offsetHeight ?? null;
      onPointerDown?.(event);
    },
    [onPointerDown],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLTextAreaElement>) => {
      const el = ref.current;
      if (el && pressHeightRef.current != null && el.offsetHeight !== pressHeightRef.current) {
        // Height changed while the pointer was held — a resize-handle drag.
        // Remember it as the floor, then re-fit so a shrink below content snaps
        // back to the content height rather than clipping.
        userHeightRef.current = el.offsetHeight;
        fit();
      }
      pressHeightRef.current = null;
      onPointerUp?.(event);
    },
    [fit, onPointerUp],
  );

  return (
    <textarea
      ref={ref}
      value={value}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      {...props}
    />
  );
}
