import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import {
  assessObjectives,
  type ConfidenceBand,
  type ConfidenceComponent,
  type ConfidenceBlocker,
  type Citation,
} from "@/v3/ontology";
import {
  runDeterministicValidation,
  selectModelValidationFindings,
  assessPhaseFidelity,
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

const STATUS_COLOR: Record<ConfidenceComponent["status"], string> = {
  good: "#22c55e",
  warn: "#f59e0b",
  poor: "#ef4444",
};

const SEVERITY_COLOR: Record<ConfidenceBlocker["severity"], string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#94a3b8",
};

const CITATION_ICON: Record<Citation["kind"], string> = {
  kpi: "📊",
  artifact: "📄",
  risk: "⚠︎",
  phase: "◧",
  finding: "🔗",
};

/**
 * The evidence trail behind a score or blocker — every number can be audited to
 * the KPI, artifact, risk, phase, or validation finding that produced it.
 */
function CitationTrail({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {citations.map((c, i) => (
        <span
          key={`${c.kind}:${c.ref}:${i}`}
          title={`${c.kind}: ${c.label}`}
          className="v3-chip muted"
          style={{ fontSize: 10, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {CITATION_ICON[c.kind]} {c.label}
        </span>
      ))}
    </div>
  );
}

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

function ComponentBar({ component }: { component: ConfidenceComponent }) {
  const pct = Math.round(component.score * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
      <div style={{ width: 96, fontSize: 12, color: "var(--v3-text-secondary)" }}>{component.label}</div>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--v3-surface-3)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: STATUS_COLOR[component.status], transition: "width 0.3s" }} />
      </div>
      <div style={{ width: 84, textAlign: "right", fontSize: 11, color: "var(--v3-text-muted)" }}>
        {component.contribution}/{Math.round(component.weight * 100)} pts
      </div>
    </div>
  );
}

function ObjectiveCard({ objective }: { objective: ReturnType<typeof assessObjectives>["objectives"][number] }) {
  return (
    <AdamCard>
      <AdamCardHeader
        title={objective.label}
        subtitle={`${objective.confidence}% objective-attainment confidence`}
        badge={<BandChip band={objective.band} />}
      />
      <AdamCardBody>
        <div style={{ marginBottom: objective.drivers.length || objective.blockers.length ? 16 : 0 }}>
          {objective.components.map((c) => (
            <ComponentBar key={c.key} component={c} />
          ))}
        </div>

        {objective.drivers.length > 0 && (
          <div style={{ marginBottom: objective.blockers.length ? 16 : 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--v3-text-muted)", marginBottom: 6 }}>
              Strengths
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {objective.drivers.map((d, i) => (
                <span key={i} className="v3-chip" style={{ fontSize: 11, color: "#22c55e", borderColor: "#22c55e" }}>{d}</span>
              ))}
            </div>
          </div>
        )}

        {objective.blockers.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--v3-text-muted)", marginBottom: 6 }}>
              Blockers to attainment
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {objective.blockers.map((b) => (
                <BlockerRow key={b.id} blocker={b} />
              ))}
            </div>
          </div>
        )}
      </AdamCardBody>
    </AdamCard>
  );
}

function BlockerRow({ blocker }: { blocker: ConfidenceBlocker }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)" }}>
      <span
        title={`${blocker.severity} severity`}
        style={{ marginTop: 2, flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: SEVERITY_COLOR[blocker.severity] }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{blocker.label}</div>
        <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 2 }}>{blocker.detail}</div>
        <div style={{ fontSize: 12, color: "var(--v3-accent)", marginTop: 4 }}>→ {blocker.recommendation}</div>
        <CitationTrail citations={blocker.citations} />
      </div>
      <span className="v3-chip muted" style={{ fontSize: 11, flexShrink: 0, whiteSpace: "nowrap" }}>+{blocker.expectedGain} pts</span>
    </div>
  );
}

/**
 * Per-phase "supports its foundations" strip. Each tile scores one phase from the
 * fidelity gaps attributed to it — an upstream KPI dropped, a gate signed off out
 * of sequence, a broken dependency — so the user can see *where* in the chain the
 * confidence erodes, not just the programme-level number.
 */
function PhaseFidelityCard({ phases }: { phases: PhaseFidelity[] }) {
  return (
    <AdamCard>
      <AdamCardHeader
        title="Phase fidelity"
        subtitle="Does each phase hold up the ones around it? Scored from the fidelity gaps attributed to the phase — upstream commitments dropped, gates jumped, dependencies broken."
      />
      <AdamCardBody>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phases.map((p) => {
            const accent = p.assessed && p.band ? BAND_COLOR[p.band] : "var(--v3-text-muted)";
            return (
              <div
                key={p.phaseId}
                title={
                  !p.assessed
                    ? "Phase has not started — nothing to assess yet"
                    : p.topIssue
                      ? p.topIssue.issue
                      : "No fidelity gap attributed to this phase"
                }
                style={{
                  display: "flex", flexDirection: "column", gap: 4, minWidth: 116,
                  padding: "8px 10px", borderRadius: 8, background: "var(--v3-surface-2)",
                  border: `1px solid ${p.assessed && p.summary.total && p.band ? BAND_COLOR[p.band] : "var(--v3-border)"}`,
                  opacity: p.assessed ? 1 : 0.7,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.label}
                </div>
                {p.assessed ? (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: accent }}>{p.score}</span>
                    <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                      {p.summary.total ? `${p.summary.total} gap${p.summary.total > 1 ? "s" : ""}` : "clean"}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: accent }}>–</span>
                    <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>not started</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AdamCardBody>
    </AdamCard>
  );
}

export function OntologyView({ program }: { program: ProgramSummary | null }) {
  const { assessment, phaseFidelity } = useMemo(() => {
    if (!program) return { assessment: null, phaseFidelity: [] as PhaseFidelity[] };
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

      {phaseFidelity.length > 0 && <PhaseFidelityCard phases={phaseFidelity} />}

      {assessment.recommendations.length > 0 && (
        <AdamCard>
          <AdamCardHeader
            title="Recommended actions"
            subtitle="Ranked by the confidence points each would recover, de-duplicated across objectives."
            badge={<span className="v3-chip muted" style={{ fontSize: 11 }}>{assessment.recommendations.length}</span>}
          />
          <AdamCardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {assessment.recommendations.map((r) => (
                <BlockerRow key={r.id} blocker={r} />
              ))}
            </div>
          </AdamCardBody>
        </AdamCard>
      )}

      {assessment.objectives.map((objective) => (
        <ObjectiveCard key={objective.objectiveId} objective={objective} />
      ))}
    </div>
  );
}

export default OntologyView;
