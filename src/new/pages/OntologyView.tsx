import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import {
  assessObjectives,
  type ConfidenceBand,
  type ConfidenceBlocker,
} from "@/v3/ontology";
import {
  runDeterministicValidation,
  selectModelValidationFindings,
  assessPhaseFidelity,
  getSemanticValidationMeta,
  type PhaseFidelity,
} from "@/v3/lib/crossArtifactValidation";

/**
 * Ontology workspace surface — objective-attainment confidence.
 *
 * The unified confidence model answers "is the programme being run well?"
 * (process health). This view answers the *other* question: "will the original
 * business objectives actually be met?" It walks each objective's semantic
 * delivery chain (KPIs, artifacts, exit-criteria evidence, risks, progress),
 * folds in cross-artifact validation gaps, and ranks the highest-leverage
 * actions for raising that confidence.
 *
 * Pure and derived: reads the program (+ its validation findings), writes
 * nothing. The findings feeding gaps are the deterministic pass plus any
 * persisted semantic-validator output already on the program.
 */

const BAND_COLOR: Record<ConfidenceBand, string> = {
  Strong: "#6366f1",
  "On Track": "#22c55e",
  "At Risk": "#f59e0b",
  Critical: "#ef4444",
};

const SEVERITY_COLOR: Record<ConfidenceBlocker["severity"], string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#94a3b8",
};

function BandChip({ band }: { band: ConfidenceBand }) {
  return (
    <span
      className="v3-chip"
      style={{ fontSize: 11, fontWeight: 600, color: BAND_COLOR[band], borderColor: BAND_COLOR[band] }}
    >
      {band}
    </span>
  );
}

/**
 * Per-phase "supports its foundations" strip. Each tile scores one phase from the
 * fidelity gaps attributed to it — an upstream KPI dropped, a gate signed off out
 * of sequence, a broken dependency — so the user can see *where* in the chain the
 * confidence erodes, not just the programme-level number.
 */
function PhaseFidelityCard({
  phases,
  semanticValidated,
  onRunValidation,
  validationIsRunning = false,
  validatingPhaseId = null,
}: {
  phases: PhaseFidelity[];
  semanticValidated: boolean;
  onRunValidation?: (phaseId?: string) => void;
  validationIsRunning?: boolean;
  validatingPhaseId?: string | null;
}) {
  return (
    <AdamCard>
      <AdamCardHeader
        title="Phase fidelity"
        subtitle="Does each phase hold up the ones around it? Scored from the gaps attributed to the phase — upstream commitments dropped, gates jumped, dependencies broken — plus the gaps the phase's own deliverables declare about themselves."
      />
      <AdamCardBody>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phases.map((p) => {
            const hasGaps = p.summary.total > 0;
            // The foundation (first phase) is unscorable by backward fidelity —
            // nothing precedes it to honour — so a clean read is vacuous, not 100.
            // It surfaces as "foundation" unless a concrete gap lands on it.
            const isFoundationClean = p.foundational && !hasGaps;
            // A phase gets a real score only when we actually have a fidelity
            // verdict: either the semantic validator has run, or the
            // deterministic floor attributed a concrete gap. A clean phase that
            // has never been semantically checked is UNKNOWN, not 100 — backward
            // fidelity is a semantic question the structural floor can't confirm.
            // The foundation, having no upstream, never earns a backward-fidelity
            // verdict at all (score is null there), so it's never "scored" clean.
            const scored = p.assessed && p.score !== null && (semanticValidated || hasGaps);
            const accent = scored && p.band ? BAND_COLOR[p.band] : "var(--v3-text-muted)";
            const statusLabel = !p.assessed
              ? "not started"
              : hasGaps
                ? `${p.summary.total} gap${p.summary.total > 1 ? "s" : ""}`
                : isFoundationClean
                  ? "foundation"
                  : semanticValidated
                    ? "clean"
                    : "not validated";
            const tileTitle = !p.assessed
              ? "Phase has not started — nothing to assess yet"
              : hasGaps
                ? p.topIssue!.issue
                : isFoundationClean
                  ? "This is the foundation phase — backward fidelity can't score it (nothing precedes it to honour). It's assessed only if a concrete gap is attributed to it; whether later phases honour ITS commitments shows up as gaps on those later phases."
                  : semanticValidated
                    ? "No fidelity gap attributed to this phase"
                    : "Fidelity not verified yet — the deterministic floor found no structural gap, but semantic validation (does this phase honour the phases before it?) has not run.";
            return (
              <div
                key={p.phaseId}
                style={{
                  display: "flex", flexDirection: "column",
                  borderRadius: 8, background: "var(--v3-surface-2)",
                  border: `1px solid ${scored && hasGaps && p.band ? BAND_COLOR[p.band] : "var(--v3-border)"}`,
                  opacity: scored ? 1 : 0.7, overflow: "hidden",
                }}
              >
                <div
                  title={tileTitle}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 12px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: accent }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.label}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {onRunValidation && p.assessed && (
                      <button
                        type="button"
                        onClick={() => onRunValidation(p.phaseId)}
                        disabled={validationIsRunning}
                        title={`Run cross-artifact validation from "${p.label}"`}
                        style={{
                          fontSize: 11, fontWeight: 600,
                          padding: "3px 9px", borderRadius: 6,
                          border: "1px solid var(--v3-border)",
                          background: "var(--v3-surface-1)",
                          color: validatingPhaseId === p.phaseId ? "var(--v3-accent)" : "var(--v3-text-secondary)",
                          cursor: validationIsRunning ? "default" : "pointer",
                          // Dim the other rows while one phase validates; keep the
                          // running row fully lit so its "Validating…" stands out.
                          opacity: validationIsRunning && validatingPhaseId !== p.phaseId ? 0.5 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {validatingPhaseId === p.phaseId ? "Validating…" : "Validate"}
                      </button>
                    )}
                    <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{statusLabel}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: accent, minWidth: 28, textAlign: "right" }}>
                      {scored ? p.score : "–"}
                    </span>
                  </div>
                </div>
                {p.gaps.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 12px 10px 12px" }}>
                    {p.gaps.map((g) => (
                      <div key={g.findingId} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span
                          title={`${g.severity} severity`}
                          style={{ marginTop: 5, flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: SEVERITY_COLOR[g.severity] }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>{g.issue}</div>
                          {g.recommendation && (
                            <div style={{ fontSize: 12, color: "var(--v3-accent)", marginTop: 1 }}>→ {g.recommendation}</div>
                          )}
                          {/* What the finding was checked against — the phase intent
                              element and/or the ontology delivery-chain link the
                              validator traced. Makes the basis of each gap visible. */}
                          {g.evidence.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
                              checked against: {g.evidence.join("; ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!semanticValidated && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
              “Not validated” = the zero-cost structural floor found no gap, but backward fidelity (does each phase honour the phases it builds on?) is a semantic question that has not been checked yet. Run validation to turn these into a real score.
            </div>
            {onRunValidation && (
              <button
                type="button"
                onClick={() => onRunValidation()}
                disabled={validationIsRunning}
                style={{
                  alignSelf: "flex-start",
                  fontSize: 12, fontWeight: 600,
                  padding: "6px 12px", borderRadius: 6,
                  border: "1px solid var(--v3-border)",
                  background: validationIsRunning ? "var(--v3-surface-2)" : "var(--v3-accent)",
                  color: validationIsRunning ? "var(--v3-text-muted)" : "var(--v3-accent-contrast, #fff)",
                  cursor: validationIsRunning ? "default" : "pointer",
                  opacity: validationIsRunning ? 0.7 : 1,
                }}
              >
                {validationIsRunning ? "Validating…" : "Validate all phases"}
              </button>
            )}
          </div>
        )}
        {phases.some((p) => p.foundational && p.summary.total === 0) && (
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 10 }}>
            “Foundation” = the first phase has nothing before it to honour, so backward fidelity can't score it. Whether it holds up shows as gaps on the later phases that depend on it — not as a mark against the foundation itself.
          </div>
        )}
      </AdamCardBody>
    </AdamCard>
  );
}

export function OntologyView({
  program,
  onRunValidation,
  validationIsRunning = false,
  validatingPhaseId = null,
}: {
  program: ProgramSummary | null;
  // User-initiated trigger for the semantic cross-artifact validator. Optional so
  // the view still renders in contexts (tests, previews) with no agent wiring; the
  // validation affordances only appear when a handler is threaded in. The optional
  // phaseId scopes the run to a phase (the per-row button); omit it to validate the
  // whole programme (the footnote button).
  onRunValidation?: (phaseId?: string) => void;
  validationIsRunning?: boolean;
  // The phase whose validation is currently in flight, so its row button reads
  // "Validating…" while the others merely disable. Null when none is running.
  validatingPhaseId?: string | null;
}) {
  const { assessment, phaseFidelity, semanticValidated } = useMemo(() => {
    if (!program) return { assessment: null, phaseFidelity: [] as PhaseFidelity[], semanticValidated: false };
    // Feed the roll-up both the zero-cost deterministic findings and any persisted
    // semantic-validator findings already on the program, so requirement/design
    // gaps show up on the objective's delivery chain.
    const findings = [
      ...runDeterministicValidation(program),
      ...selectModelValidationFindings(program),
    ];
    return {
      assessment: assessObjectives(program, { findings }),
      // Per-phase "supports its foundations" score, scoped to each phase's own
      // attributed gaps (program-wide findings are not double-counted per phase).
      phaseFidelity: assessPhaseFidelity(program.phases ?? [], findings),
      // Whether the Layer-2 semantic validator has run — decides if a clean
      // phase reads "clean" (both layers) or "structural only" (deterministic).
      semanticValidated: getSemanticValidationMeta(program).hasRun,
    };
  }, [program]);

  if (!assessment || assessment.objectives.length === 0) {
    return (
      <div className="v3-section">
        <EmptyState
          illustration="gates"
          title="No business objective to assess yet"
          description="Capture a business objective in the Strategy phase. This workspace then scores how likely that objective is to be achieved and ranks the actions that would raise the confidence."
        />
      </div>
    );
  }

  return (
    <div className="v3-section" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdamCard accent="primary">
        <AdamCardBody>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--v3-text-muted)" }}>
                Objective-attainment confidence
              </div>
              <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginTop: 4, maxWidth: 560 }}>
                Will the original business objectives be met? Derived from each objective's semantic delivery chain — measurability, delivery, evidence, threats and progress — with cross-artifact gaps folded in.
              </div>
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: BAND_COLOR[assessment.band] }}>
                {assessment.overall}
                <span style={{ fontSize: 16, fontWeight: 500, color: "var(--v3-text-muted)" }}>%</span>
              </div>
              <BandChip band={assessment.band} />
            </div>
          </div>
        </AdamCardBody>
      </AdamCard>

      {phaseFidelity.length > 0 && (
        <PhaseFidelityCard
          phases={phaseFidelity}
          semanticValidated={semanticValidated}
          onRunValidation={onRunValidation}
          validationIsRunning={validationIsRunning}
          validatingPhaseId={validatingPhaseId}
        />
      )}
    </div>
  );
}

export default OntologyView;
