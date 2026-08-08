/**
 * Claims-ledger visual primitives (Phase 4.1). The interface elements the ledger
 * introduces, given a proper treatment: every signal carries a distinct GLYPH/SHAPE
 * and TEXT, never colour alone (accessibility), and the weak-vs-closed distinction —
 * the one most likely to be lost and most important to keep — is a solid ● vs a
 * half ◐, a shape difference readable in greyscale.
 *
 * Works within theLine.css / v3.css tokens (the Listen movement hue). Read-only.
 */
import type { SlotState } from "@/v3/lib/ledger/projections";

// ── claim status — five states, distinguishable at a glance and not by colour alone ──
const STATUS_META: Record<SlotState | "closed", { glyph: string; label: string; cls: string; title: string }> = {
  closed: { glyph: "●", label: "closed", cls: "is-closed", title: "closed — on firm grounds (assertion, document, analysis)" },
  weak: { glyph: "◐", label: "weak", cls: "is-weak", title: "weak — closed on thin grounds (a touch with no verbatim, or a default)" },
  open: { glyph: "○", label: "open", cls: "is-open", title: "open — a live unknown awaiting an answer" },
  blocked: { glyph: "◮", label: "blocked", cls: "is-blocked", title: "blocked — cannot close here; held for a named authority" },
  "n/a": { glyph: "—", label: "n/a", cls: "is-na", title: "n/a — the slot does not apply to this element" },
  conflict: { glyph: "⇄", label: "conflict", cls: "is-conflict", title: "conflict — two live claims on this locus" },
};

export function ClaimStatus({ state, showLabel = true }: { state: SlotState; showLabel?: boolean }) {
  const m = STATUS_META[state] ?? STATUS_META.open;
  return (
    <span className={`v3lc-status ${m.cls}`} title={m.title}>
      <span className="v3lc-status-g" aria-hidden="true">{m.glyph}</span>
      {showLabel ? <span className="v3lc-status-l">{m.label}</span> : <span className="v3lc-sr">{m.label}</span>}
    </span>
  );
}

// ── source class — legible; external-standard & as-is-export read as strong-default-awaiting-confirmation ──
const SOURCE_META: Record<string, { icon: string; label: string; provisional: boolean }> = {
  regulation: { icon: "§", label: "regulation", provisional: false },
  asserted: { icon: "✍", label: "asserted", provisional: false },
  dispositioned: { icon: "▧", label: "dispositioned", provisional: false },
  document: { icon: "▤", label: "document", provisional: false },
  "external-standard": { icon: "⌘", label: "std", provisional: true },
  "code-derived": { icon: "⎘", label: "export", provisional: true },
  precedent: { icon: "⟲", label: "precedent", provisional: false },
  generated: { icon: "✧", label: "generated", provisional: true },
};

export function SourceTag({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? { icon: "?", label: source, provisional: true };
  return (
    <span className={`v3lc-src${m.provisional ? " is-provisional" : ""}`} title={m.provisional ? `${m.label} — a strong default awaiting confirmation` : m.label}>
      <span aria-hidden="true">{m.icon}</span> {m.label}
    </span>
  );
}

// ── contradiction badge — two live claims; reads as a routable item, not an error ──
export function ContradictionBadge({ count, escalate, onClick }: { count: number; escalate?: "slot-owner" | "legal-compliance"; onClick?: () => void }) {
  const label = escalate ? `escalate → ${escalate === "legal-compliance" ? "Legal" : "owner"}` : `${count} live claims`;
  return (
    <button type="button" className={`v3lc-contra${escalate ? " is-escalate" : ""}`} onClick={onClick} title={`${count} live claims on one locus — ${escalate ? "escalated" : "routable contradiction"}`}>
      <span aria-hidden="true">⇄</span> {label} <span className="v3lc-contra-go" aria-hidden="true">›</span>
    </button>
  );
}

// ── seam / unowned band headers ──
export function BandTag({ kind, label }: { kind: "function" | "seam" | "unowned"; label: string }) {
  if (kind === "unowned") return <span className="v3lc-band-tag is-unowned" title="unowned — nobody owns this; pinned and urgent"><span aria-hidden="true">◍</span> UNOWNED</span>;
  if (kind === "seam") return <span className="v3lc-band-tag is-seam" title="a seam — two functions own this jointly"><span aria-hidden="true">⋈</span> {label}</span>;
  return <span className="v3lc-band-tag is-func">{label}</span>;
}

// ── as-is → to-be deviation marker — deliberate vs unbacked ──
export function DeviationMarker({ classification, stillReferenced }: { classification: "document-backed" | "unbacked"; stillReferenced?: boolean }) {
  const unbacked = classification === "unbacked";
  return (
    <span className={`v3lc-dev${unbacked ? " is-unbacked" : " is-backed"}`}
      title={unbacked ? "unbacked deviation — no document justifies the change; surface for review" : "document-backed — a deliberate, justified deviation"}>
      <span aria-hidden="true">{unbacked ? "▲" : "✓"}</span> as-is<span aria-hidden="true"> → </span>to-be · {unbacked ? "unbacked" : "deliberate"}
      {stillReferenced ? <span className="v3lc-dev-ref" title="the removed element is still referenced elsewhere"> · still referenced</span> : null}
    </span>
  );
}
