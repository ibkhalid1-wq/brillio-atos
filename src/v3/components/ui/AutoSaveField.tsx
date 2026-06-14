import React, { useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

interface AutoSaveFieldProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  label?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}

export function AutoSaveField({ value, onSave, placeholder, label, rows = 4, maxLength, disabled, className }: AutoSaveFieldProps) {
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDraft(value); savedRef.current = value; }, [value]);

  const performSave = async (val: string) => {
    if (val === savedRef.current) return;
    setSaveState("saving");
    try {
      await onSave(val);
      savedRef.current = val;
      setSaveState("saved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (e.target.value === savedRef.current) return;
      await performSave(e.target.value);
    }, 1200);
  };

  const handleBlur = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await performSave(draft);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const isDirty = draft !== savedRef.current;

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--v3-text-secondary)", fontWeight: 500 }}>
          {label}
          {isDirty && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--v3-amber)", display: "inline-block" }} />}
        </div>
      )}
      <textarea
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        style={{
          width: "100%", background: "var(--v3-surface)", border: "1px solid var(--v3-border)",
          borderRadius: "var(--v3-radius)", padding: "8px 10px", fontFamily: "var(--v3-font)", fontSize: 14,
          color: "var(--v3-text-primary)", lineHeight: 1.6, resize: "vertical", outline: "none",
          transition: "border-color 0.12s, box-shadow 0.12s",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "var(--v3-accent)";
          e.target.style.boxShadow = "0 0 0 2px var(--v3-accent-soft)";
        }}
        onBlurCapture={(e) => {
          e.target.style.borderColor = "var(--v3-border)";
          e.target.style.boxShadow = "none";
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 16 }}>
        <span style={{ fontSize: 11, color: saveState === "saved" ? "var(--v3-green)" : saveState === "error" ? "var(--v3-red)" : saveState === "saving" ? "var(--v3-amber)" : "var(--v3-text-muted)" }}>
          {saveState === "saving" && <span style={{ color: "var(--v3-amber)" }}>Saving…</span>}
          {saveState === "saved" && <span style={{ color: "var(--v3-green)" }}>✓ Saved</span>}
          {saveState === "error" && <span style={{ color: "var(--v3-red)" }}>⚠ Save failed — click to retry</span>}
          {saveState === "idle" && isDirty && <span style={{ color: "var(--v3-amber)" }}>Unsaved changes</span>}
        </span>
        {maxLength && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{draft.length} / {maxLength}</span>}
      </div>
    </div>
  );
}
