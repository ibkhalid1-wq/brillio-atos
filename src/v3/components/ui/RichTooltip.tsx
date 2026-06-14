import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

interface RichTooltipProps {
  children: React.ReactElement;
  title: string;
  description?: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
}

export function RichTooltip({ children, title, description, shortcut, side = "top", disabled }: RichTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        const offset = 8;
        let top = 0, left = 0;
        if (side === "top") { top = r.top - offset; left = r.left + r.width / 2; }
        else if (side === "bottom") { top = r.bottom + offset; left = r.left + r.width / 2; }
        else if (side === "left") { top = r.top + r.height / 2; left = r.left - offset; }
        else { top = r.top + r.height / 2; left = r.right + offset; }
        setPos({ top, left });
        setVisible(true);
      }
    }, 400);
  }, [side]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (disabled) return children;

  const trigger = React.cloneElement(children as React.ReactElement<any>, {
    ref: triggerRef,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  });

  const transformMap = { top: "translate(-50%, -100%)", bottom: "translate(-50%, 0)", left: "translate(-100%, -50%)", right: "translate(0, -50%)" };

  return (
    <>
      {trigger}
      {visible && ReactDOM.createPortal(
        <div style={{
          position: "fixed", top: pos.top, left: pos.left, transform: transformMap[side], zIndex: 99999,
          background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)",
          boxShadow: "var(--v3-shadow-dropdown)", padding: "8px 12px", maxWidth: 260,
          animation: "v3-fadein 0.12s ease", pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>{title}</span>
            {shortcut && (
              <span style={{ fontSize: 11, fontFamily: "var(--v3-font-mono)", background: "var(--v3-surface-3)", border: "1px solid var(--v3-border)", borderRadius: 4, padding: "1px 5px", color: "var(--v3-text-secondary)", whiteSpace: "nowrap" }}>{shortcut}</span>
            )}
          </div>
          {description && <div style={{ fontSize: 11, color: "var(--v3-text-secondary)", marginTop: 3, lineHeight: 1.5 }}>{description}</div>}
        </div>,
        document.body
      )}
    </>
  );
}
