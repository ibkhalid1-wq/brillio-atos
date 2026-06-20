import React, { useCallback, useEffect, useRef, useState } from "react";

interface DelayedConfirmButtonProps {
  onConfirm: () => void | Promise<void>;
  label: string;
  confirmingLabel?: string;
  delayMs?: number;
  disabled?: boolean;
  className?: string;
}

export function DelayedConfirmButton({
  onConfirm, label, confirmingLabel = "Hold to confirm…", delayMs = 2000, disabled, className,
}: DelayedConfirmButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    setHolding(false);
    setProgress(0);
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const tick = useCallback(() => {
    if (startRef.current === null) return;
    const elapsed = Date.now() - startRef.current;
    const pct = Math.min(100, (elapsed / delayMs) * 100);
    setProgress(pct);
    if (pct < 100) { rafRef.current = requestAnimationFrame(tick); }
    else {
      setHolding(false);
      setDone(true);
      setLoading(true);
      Promise.resolve(onConfirm()).finally(() => setLoading(false));
    }
  }, [delayMs, onConfirm]);

  const start = useCallback(() => {
    if (disabled || loading || done) return;
    setHolding(true);
    startRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, loading, done, tick]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <button
      className={className}
      disabled={disabled || loading || done}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      style={{
        position: "relative", overflow: "hidden", cursor: disabled ? "not-allowed" : "pointer",
        background: "var(--v3-red-soft)", color: "var(--v3-red)", border: "1px solid var(--v3-red)",
        borderRadius: "var(--v3-radius)", padding: "7px 16px", fontSize: 13, fontWeight: 500,
        fontFamily: "var(--v3-font)", userSelect: "none",
      }}
    >
      <span style={{
        position: "absolute", inset: 0, background: "var(--v3-red)", opacity: 0.2,
        width: `${progress}%`, transition: "none", pointerEvents: "none",
      }} />
      <span style={{ position: "relative", zIndex: 1 }}>
        {loading ? "…" : done ? "Done" : holding ? confirmingLabel : label}
      </span>
    </button>
  );
}
