/**
 * Claims-ledger visual primitives (Phase 4.1). The interface elements the ledger
 * introduces, given a proper treatment: every signal carries a distinct GLYPH/SHAPE
 * and TEXT, never colour alone (accessibility), and the weak-vs-closed distinction —
 * the one most likely to be lost and most important to keep — is a solid ● vs a
 * half ◐, a shape difference readable in greyscale.
 *
 * Works within theLine.css / v3.css tokens (the Listen movement hue). Read-only.
 */
import type { SlotState, KitView, HeardRegister } from "@/v3/lib/ledger/projections";
import type { OwnershipClass } from "@/v3/lib/ledger/useProgramLedger";

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

// ════════════════════════════════════════════════════════════════════════════
// Shared cross-surface vocabulary (the "build once, use everywhere" layer).
// One heard readout, one convergence readout, one ownership tag, one unowned/seam
// strip — so the kit, the Design Loop, the artifact views and the stats header can
// never again show three different numbers for the same thing.
// ════════════════════════════════════════════════════════════════════════════

// ── a provisional mark — the honest interim where a figure can't yet be computed
//    truthfully in-browser (per-area, per-stakeholder, persisted). Shape + text,
//    never colour alone. ──
export function ProvisionalMark({ what }: { what: string }) {
  return (
    <span className="v3lc-prov" title={`provisional — ${what}`}>
      <span aria-hidden="true">◇</span> provisional
    </span>
  );
}

// ── ownership by SOURCE CLASS — the ledger's own encoding, not an invented
//    taxonomy. operator = decision/dispositioned · stakeholder = asserted ·
//    joint = both on one locus · draft = machine-proposed, awaiting a human. ──
const OWNERSHIP_META: Record<OwnershipClass, { icon: string; label: string; title: string }> = {
  operator: { icon: "▧", label: "operator", title: "operator-decided — a decision or disposition on record (operator owns it)" },
  stakeholder: { icon: "✍", label: "stakeholder", title: "stakeholder-asserted — a person's answer stands here (a stakeholder owns it)" },
  joint: { icon: "⋈", label: "joint", title: "joint — both an operator decision and a stakeholder assertion live on this locus" },
  draft: { icon: "✧", label: "draft", title: "machine draft — generated / exported only, awaiting a decision or an assertion" },
};
export function OwnershipTag({ cls, count, showLabel = true }: { cls: OwnershipClass; count?: number; showLabel?: boolean }) {
  const m = OWNERSHIP_META[cls];
  return (
    <span className={`v3lc-own is-${cls}`} title={m.title}>
      <span aria-hidden="true">{m.icon}</span>
      {showLabel ? <span className="v3lc-own-l">{m.label}</span> : <span className="v3lc-sr">{m.label}</span>}
      {count != null ? <span className="v3lc-own-n">{count}</span> : null}
    </span>
  );
}

// ── the ONE heard readout: attributed human closures from the ledger (not roster
//    counts). Per-area is not computable in-browser (all closures land in one band
//    here), so per-area carries a provisional mark rather than a fabricated split. ──
export function HeardReadout({ heard, perAreaProvisional = true }: { heard: HeardRegister; perAreaProvisional?: boolean }) {
  return (
    <span className="v3lc-heard" title={`${heard.total} attributed closures — the honest heard-count (a person closed the slot), distinct from ${heard.totalClosedOrWeak} machine-import closures`}>
      <span className="v3lc-heard-n">{heard.total}</span>
      <span className="v3lc-heard-l">attributed{heard.total === 1 ? " closure" : " closures"}</span>
      {perAreaProvisional ? <ProvisionalMark what="per-area heard needs the stakeholder write path; all closures read into one band today" /> : null}
    </span>
  );
}

// ── the ONE convergence readout: real ledger closures (burn-down), not demo-verdict
//    area sign-offs. Per-area convergence needs the write path → provisional. ──
export function ConvergenceReadout({ burnDown, perAreaProvisional = true }: { burnDown: KitView["burnDown"]; perAreaProvisional?: boolean }) {
  // Density: the headline is the %; the exact closed/open split is detail on hover.
  return (
    <span className="v3lc-conv" title={`${burnDown.closed} closed/weak · ${burnDown.open} open of ${burnDown.total}`}>
      <span className="v3lc-conv-bar" role="img" aria-label={`${burnDown.pctClosed}% of claims closed or weak (${burnDown.closed} of ${burnDown.total})`}>
        <span style={{ width: `${burnDown.pctClosed}%` }} />
      </span>
      <span className="v3lc-conv-l"><b>{burnDown.pctClosed}%</b> <span className="v3lc-conv-sub">closed/weak</span></span>
      {perAreaProvisional ? <ProvisionalMark what="per-area convergence is demo-verdict sign-off, gated on the stakeholder write path" /> : null}
    </span>
  );
}

// ── the loud signals: unowned pinned first, then seams (joint-owned) as their own
//    rows. A surface that shows tidy area tabs and no unowned reproduces the "0
//    unowned" fabrication — this strip exists so they can't. ──
export function UnownedSeamStrip({ unownedBands, seamBands, openTotal, unownedOpen: unownedOpenProp }: { unownedBands: KitView["bands"]; seamBands: KitView["bands"]; openTotal?: number; unownedOpen?: number }) {
  // Read the ONE canonical unowned count when the caller passes it (ledger.unownedOpen =
  // queue.counts.unowned), so this strip and the goal headline can never diverge again
  // (5 vs 6 before). Falls back to the band sum only when no canonical count is supplied.
  const unownedOpen = unownedOpenProp ?? unownedBands.reduce((n, b) => n + b.open, 0);
  if (!unownedBands.length && !seamBands.length && !unownedOpen) return null;
  // A denominator so a small orphan reads small: "5 of 600 unowned" is not the same
  // crisis as "5 of 8". Unowned is a calm orphan chip, not a red alarm; seams are a
  // to-do (a meeting to book), styled apart from unowned.
  return (
    <div className="v3lc-uss" aria-label="unowned and seam ownership">
      {unownedOpen > 0 ? (
        <span className="v3lc-uss-lead">
          <BandTag kind="unowned" label="UNOWNED" />
          <span className="v3lc-uss-n">
            <b>{unownedOpen}</b>{openTotal ? <> of {openTotal}</> : null} open unknowns nobody owns
          </span>
        </span>
      ) : null}
      {seamBands.length ? (
        // Density: show the count + the top few seams; the full list is on hover and is
        // actionable in the Discover inbox (this header strip is a summary, not the queue).
        <span className="v3lc-uss-seams" title={seamBands.map((b) => `${b.label} · ${b.open}`).join("  ·  ")}>
          <span className="v3lc-uss-seams-l">{seamBands.length} seam{seamBands.length === 1 ? "" : "s"} — joint sessions to book</span>
          {seamBands.slice(0, 3).map((b) => (
            <span key={b.key} className="v3lc-uss-seam" title={`${b.label} — ${b.open} open, jointly owned (a meeting to book, not a gap)`}>
              <span aria-hidden="true">⋈</span> {b.label}<span className="v3lc-uss-seam-n">{b.open}</span>
            </span>
          ))}
          {seamBands.length > 3 ? <span className="v3lc-uss-more">+{seamBands.length - 3} more</span> : null}
        </span>
      ) : null}
    </div>
  );
}
