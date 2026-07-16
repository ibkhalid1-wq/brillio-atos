/**
 * The prototype refine-and-polish command bar — shared by BOTH prototype views:
 * the Design-side Prototype Build studio and the Validate-side Prototype tab.
 * The delivery team types a plain-language polish instruction; `onRefine`
 * stashes it on Envision's inputs and re-runs the prototype-build agent, so the
 * refined build replaces the current one.
 */
import { useState } from "react";

export default function PrototypeCommandBar({ onRefine, regenerating, compact, placeholder, busyLabel }: {
  onRefine: (instruction: string) => Promise<void> | void;
  regenerating?: boolean;
  /** Tighter padding for the in-studio bar. */
  compact?: boolean;
  /** Override the input placeholder (design tabs word it per artifact). */
  placeholder?: string;
  /** Override the regenerating-state button label (default "Polishing…"). */
  busyLabel?: string;
}) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const instruction = cmd.trim();
    if (!instruction || busy || regenerating) return;
    setBusy(true);
    try { await onRefine(instruction); setCmd(""); } finally { setBusy(false); }
  };
  return (
    <form className={`v3fs-protocmd${compact ? " compact" : ""}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <span className="v3fs-protocmd-caret" aria-hidden="true">›</span>
      <input className="v3fs-protocmd-in" value={cmd} disabled={busy || regenerating}
        placeholder={placeholder ?? "Refine & polish — e.g. “make the dashboard a card grid, add a sticky header, tighten the spacing”"}
        onChange={(e) => setCmd(e.target.value)} aria-label="Refine this document with an instruction" />
      <button type="submit" className="v3fs-protocmd-btn" disabled={busy || regenerating || !cmd.trim()}>
        {regenerating ? (busyLabel ?? "Polishing…") : busy ? "Sending…" : "Refine ↵"}
      </button>
    </form>
  );
}
