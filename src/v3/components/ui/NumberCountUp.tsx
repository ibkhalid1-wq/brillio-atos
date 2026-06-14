import React, { useEffect, useRef, useState } from "react";

interface NumberCountUpProps {
  value: number;
  duration?: number;       // ms, default 600
  decimals?: number;       // default 0
  suffix?: string;         // e.g. "%"
  prefix?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function NumberCountUp({ value, duration = 600, decimals = 0, suffix = "", prefix = "", style, className }: NumberCountUpProps) {
  const [display, setDisplay] = useState(value);  // initialize to value, not 0
  const prevValueRef = useRef(value);              // initialize to value, not 0
  const mountedRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip animation on first mount — just show the value immediately
    if (!mountedRef.current) {
      mountedRef.current = true;
      setDisplay(value);
      prevValueRef.current = value;
      return;
    }

    const from = prevValueRef.current;
    const to = value;
    if (from === to) return; // no change, skip animation

    prevValueRef.current = value;
    startRef.current = null;

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  const formatted = display.toFixed(decimals);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
        display: "inline-block",
        ...style,
      }}
    >
      {prefix}{formatted}{suffix}
    </span>
  );
}
