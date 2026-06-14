import React from "react";
import { cn } from "@/lib/cn";

type AdamCardAccent = "none" | "success" | "warning" | "danger" | "info" | "primary";

interface AdamCardProps {
  children: React.ReactNode;
  accent?: AdamCardAccent;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
}

const ACCENT_CLASS: Record<AdamCardAccent, string> = {
  none: "",
  success: "adam-card--success",
  warning: "adam-card--warning",
  danger: "adam-card--danger",
  info: "adam-card--info",
  primary: "adam-card--primary",
};

export function AdamCard({ children, accent = "none", className, interactive = false, onClick }: AdamCardProps) {
  const [hovered, setHovered] = React.useState(false);
  const isClickable = !!onClick;

  return (
    <div
      onClick={onClick}
      onMouseEnter={isClickable ? () => setHovered(true) : undefined}
      onMouseLeave={isClickable ? () => setHovered(false) : undefined}
      className={cn(
        "adam-card",
        ACCENT_CLASS[accent],
        interactive && "adam-card--interactive",
        isClickable && "adam-card--clickable",
        className,
      )}
      style={{
        transition: "transform 0.18s, box-shadow 0.18s",
        ...(isClickable ? {
          cursor: "pointer",
          userSelect: "none",
          WebkitUserSelect: "none",
        } as React.CSSProperties : {}),
        ...(isClickable && hovered ? {
          transform: "translateY(-1px)",
          boxShadow: "var(--v3-elev-1-hover)",
        } : {}),
      }}
    >
      {children}
    </div>
  );
}

interface AdamCardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  badge?: React.ReactNode;
}

export function AdamCardHeader({ title, subtitle, action, badge }: AdamCardHeaderProps) {
  return (
    <div className="adam-card__header">
      <div className="adam-card__header-copy">
        <div className="adam-card__header-title-row">
          <h3 className="adam-card__title">{title}</h3>
          {badge ? <div>{badge}</div> : null}
        </div>
        {subtitle ? <p className="adam-card__subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="adam-card__header-action">{action}</div> : null}
    </div>
  );
}

export function AdamCardBody({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn("adam-card__body", padded && "adam-card__body--padded", className)}>{children}</div>;
}
