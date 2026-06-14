import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { background: "var(--v3-gradient-primary)", color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" },
  secondary: { background: "var(--v3-surface-2)", color: "var(--v3-text-primary)", border: "1px solid var(--v3-border)" },
  ghost:     { background: "transparent", color: "var(--v3-text-secondary)", border: "1px solid transparent" },
  danger:    { background: "var(--v3-red-soft)", color: "var(--v3-red)", border: "1px solid var(--v3-red)" },
};

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "4px 10px", fontSize: 11, borderRadius: "var(--v3-radius-sm)" },
  md: { padding: "7px 14px", fontSize: 13, borderRadius: "var(--v3-radius)" },
  lg: { padding: "10px 20px", fontSize: 14, borderRadius: "var(--v3-radius-lg)" },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, leftIcon, rightIcon, children, style, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, cursor: disabled || loading ? "not-allowed" : "pointer",
        fontFamily: "var(--v3-font)", fontWeight: 500, transition: "opacity 0.12s, background 0.12s, filter 0.12s",
        opacity: disabled || loading ? 0.6 : 1, userSelect: "none", WebkitUserSelect: "none",
        whiteSpace: "nowrap", letterSpacing: "0.01em",
        ...VARIANT_STYLES[variant], ...SIZE_STYLES[size], ...style,
      }}
      data-variant={variant}
      {...rest}
    >
      {loading ? <span style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "v3-spin 0.6s linear infinite" }} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

interface IconButtonProps extends ButtonProps {
  "aria-label": string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", style, ...rest }, ref
) {
  const s = SIZE_STYLES[size];
  const pad = size === "sm" ? "4px" : size === "lg" ? "10px" : "7px";
  return <Button ref={ref} size={size} style={{ padding: pad, ...style }} {...rest} />;
});
