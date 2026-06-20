import { useEffect } from "react";

export interface ShortcutDef {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
  scope?: string;
}

export function matchesShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  const metaMatch = def.meta ? (e.metaKey || e.ctrlKey) : (!e.metaKey && !e.ctrlKey);
  const shiftMatch = def.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = def.alt ? e.altKey : !e.altKey;
  return e.key.toLowerCase() === def.key.toLowerCase() && metaMatch && shiftMatch && altMatch;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      for (const s of shortcuts) {
        if (matchesShortcut(e, s)) { e.preventDefault(); s.action(); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}

export const SHORTCUT_REGISTRY: Omit<ShortcutDef, "action">[] = [
  { key: "k", meta: true, description: "Open command palette", scope: "Global" },
  { key: "/", description: "Focus search", scope: "Global" },
  { key: "?", description: "Show keyboard shortcuts", scope: "Global" },
  { key: "g", description: "Go to Deliver", scope: "Navigation" },
  { key: "d", description: "Go to Gates", scope: "Navigation" },
  { key: "o", description: "Go to Executive", scope: "Navigation" },
  { key: "Escape", description: "Close drawer / dismiss panel", scope: "Global" },
  { key: "ArrowLeft", alt: true, description: "Go back", scope: "Navigation" },
  { key: "ArrowRight", alt: true, description: "Go forward", scope: "Navigation" },
];
