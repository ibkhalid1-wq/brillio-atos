import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";

interface ConfirmPopoverProps {
  children: React.ReactElement;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export function ConfirmPopover({
  children, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, variant = "default", disabled,
}: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", keyHandler); };
  }, [open, close]);

  const handleConfirm = async () => {
    setLoading(true);
    try { await onConfirm(); close(); } finally { setLoading(false); }
  };

  const trigger = React.cloneElement(children, { onClick: () => !disabled && setOpen((o) => !o) });

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      {trigger}
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)",
          boxShadow: "var(--v3-shadow-dropdown)", padding: "12px 14px", minWidth: 200, zIndex: 9999,
        }}>
          <div style={{ fontSize: 13, color: "var(--v3-text-primary)", marginBottom: 10 }}>{message}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={close}>{cancelLabel}</Button>
            <Button size="sm" variant={variant === "danger" ? "danger" : "primary"} loading={loading} onClick={handleConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
