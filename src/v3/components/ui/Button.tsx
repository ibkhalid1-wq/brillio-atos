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

// Size → canonical class modifier ("md" is the .v3-button base, no modifier).
const SIZE_CLASS: Record<ButtonSize, string> = { sm: "sm", md: "", lg: "lg" };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, leftIcon, rightIcon, children, style, disabled, className, ...rest },
  ref
) {
  const classes = ["v3-button", variant, SIZE_CLASS[size], className].filter(Boolean).join(" ");
  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      style={style}
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
  const pad = size === "sm" ? "4px" : size === "lg" ? "10px" : "7px";
  return <Button ref={ref} size={size} style={{ padding: pad, ...style }} {...rest} />;
});
