import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Premium replacements for the native <select> and <input list=…> controls used
// by phase inputs. Native controls render with OS chrome that breaks the v3
// design language; these render a styled trigger + a portalled popover so the menu
// escapes any `overflow:hidden` ancestor (which a native popup does for free) and
// carries the platform's elevation, motion and focus affordances.

type Anchor = { top: number; left: number; width: number; below: boolean; maxHeight: number };

// Anchor a portalled menu to a trigger with fixed coordinates, flipping above
// when there isn't room below. Recomputes on open, scroll and resize so the menu
// tracks the trigger while the page moves.
function useAnchor(triggerRef: React.RefObject<HTMLElement>, open: boolean): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const below = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const room = (below ? spaceBelow : spaceAbove) - 12;
      setAnchor({
        top: below ? r.bottom + 6 : r.top - 6,
        left: r.left,
        width: r.width,
        below,
        maxHeight: Math.max(140, Math.min(280, room)),
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, triggerRef]);
  return anchor;
}

// Close when a pointer lands outside both the trigger and the menu.
function useDismiss(
  open: boolean,
  close: () => void,
  refs: React.RefObject<HTMLElement>[],
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close, refs]);
}

const AFFIRMATIVE = /^(yes|approved|confirmed|complete[d]?|ready|true|on)$/i;
const NEGATIVE = /^(no|rejected|declined|blocked|incomplete|false|off)$/i;

// A small status dot for binary/approval option sets (Yes/No, Approved/…), so an
// approval question reads at a glance rather than as anonymous menu text.
function OptionDot({ label }: { label: string }) {
  const tone = AFFIRMATIVE.test(label.trim()) ? "affirm" : NEGATIVE.test(label.trim()) ? "negative" : null;
  if (!tone) return null;
  return <span className={`v3-dropdown-dot v3-dropdown-dot--${tone}`} aria-hidden />;
}

function Chevron() {
  return (
    <svg className="v3-select-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="v3-dropdown-check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface V3SelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Premium single-select listbox — a drop-in replacement for a native <select>. */
export function V3Select({ value, options, onChange, ariaLabel, placeholder = "Select…", disabled }: V3SelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const anchor = useAnchor(triggerRef, open);
  useDismiss(open, close, [triggerRef, menuRef]);

  // Surface an off-list current value (e.g. an AI-extracted option the schema
  // doesn't list) as its own entry so it stays visible and selected.
  const items = useMemo(() => {
    const list = [...options];
    if (value && !list.includes(value)) list.unshift(value);
    return list;
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const idx = items.findIndex((opt) => opt === value);
    setActive(idx >= 0 ? idx : 0);
  }, [open, items, value]);

  // Keep the active option scrolled into view as the keyboard moves it.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const commit = (opt: string) => {
    onChange(opt);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (items[active] != null) commit(items[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="v3-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={`v3-select-value${value ? "" : " v3-select-value--placeholder"}`}>
          {value ? <OptionDot label={value} /> : null}
          {value || placeholder}
        </span>
        <Chevron />
      </button>
      {open && anchor
        ? createPortal(
            <div
              ref={menuRef}
              id={`${id}-menu`}
              role="listbox"
              aria-label={ariaLabel}
              className={`v3-dropdown-menu${anchor.below ? "" : " v3-dropdown-menu--above"}`}
              style={{
                position: "fixed",
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
                ...(anchor.below ? { top: anchor.top } : { bottom: window.innerHeight - anchor.top }),
              }}
            >
              {items.length === 0 ? (
                <div className="v3-dropdown-empty">No options</div>
              ) : (
                items.map((opt, index) => (
                  <div
                    key={opt}
                    data-index={index}
                    role="option"
                    aria-selected={opt === value}
                    data-active={index === active}
                    className="v3-dropdown-option"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => commit(opt)}
                  >
                    <OptionDot label={opt} />
                    <span className="v3-dropdown-option-label">{opt}</span>
                    {opt === value ? <Check /> : null}
                  </div>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export interface V3ComboboxProps {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}

/**
 * Premium editable combobox — replaces a native text input backed by a <datalist>.
 * Free text is allowed (the value persists as a plain string), but a filterable,
 * styled suggestion list makes resolving to a real programme entity the easy path.
 */
export function V3Combobox({ value, suggestions, onChange, ariaLabel, placeholder }: V3ComboboxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const anchor = useAnchor(wrapRef, open);
  useDismiss(open, close, [wrapRef, menuRef]);

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return suggestions;
    return suggestions.filter((opt) => opt.toLowerCase().includes(query));
  }, [value, suggestions]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const commit = (opt: string) => {
    onChange(opt);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && active >= 0 && filtered[active] != null) {
        event.preventDefault();
        commit(filtered[active]);
      }
    } else if (event.key === "Escape") {
      if (open) { event.preventDefault(); setOpen(false); }
    }
  };

  return (
    <div ref={wrapRef} className="v3-combobox-wrap">
      <input
        ref={inputRef}
        type="text"
        className="v3-input v3-combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 ? (
        <button
          type="button"
          className="v3-combobox-toggle"
          tabIndex={-1}
          aria-hidden
          aria-expanded={open}
          onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}
        >
          <Chevron />
        </button>
      ) : null}
      {open && anchor && filtered.length > 0
        ? createPortal(
            <div
              ref={menuRef}
              id={`${id}-menu`}
              role="listbox"
              aria-label={ariaLabel}
              className={`v3-dropdown-menu${anchor.below ? "" : " v3-dropdown-menu--above"}`}
              style={{
                position: "fixed",
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
                ...(anchor.below ? { top: anchor.top } : { bottom: window.innerHeight - anchor.top }),
              }}
            >
              {filtered.map((opt, index) => (
                <div
                  key={opt}
                  data-index={index}
                  role="option"
                  aria-selected={opt === value}
                  data-active={index === active}
                  className="v3-dropdown-option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(opt)}
                >
                  <span className="v3-dropdown-option-label">{opt}</span>
                  {opt === value ? <Check /> : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
