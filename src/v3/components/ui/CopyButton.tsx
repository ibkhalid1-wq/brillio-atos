import React, { useState } from "react";
import { Button } from "./Button";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary";
  className?: string;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function CopyButton({ text, label = "Copy", copiedLabel = "Copied ✓", size = "sm", variant = "ghost", className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const handleClick = async () => {
    const ok = await copyToClipboard(text);
    setState(ok ? "copied" : "error");
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <Button
      className={className}
      size={size}
      variant={variant}
      disabled={state !== "idle"}
      onClick={handleClick}
      style={state === "copied" ? { color: "var(--v3-green)" } : state === "error" ? { color: "var(--v3-red)" } : undefined}
    >
      {state === "copied" ? copiedLabel : state === "error" ? "Failed" : label}
    </Button>
  );
}
