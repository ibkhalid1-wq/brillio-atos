import React, { useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows vertically to fit its content so the full value is always
 * visible without an inner scrollbar. Resizes on every value change — including
 * programmatic ones (e.g. AI field-assist, or a grid cell adopting a projected
 * draft) — not just on keystrokes.
 *
 * Shared by the free-text phase inputs (PhaseInputsPanel) and the structured-grid
 * text cells (StructuredGrid) so both scale to their content identically.
 */
export default function AutoGrowTextarea({
  value,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} {...props} />;
}
