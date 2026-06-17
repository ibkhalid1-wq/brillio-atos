import type { ExitCriterion, ProgramSummary } from "@/new/types";
import { getGateThreshold, computeInputQualityScore } from "@/v3/lib/confidenceScore";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { getDynamicSchemaStore, dynamicArtifactDefs } from "@/v3/lib/dynamicSchema";
import { resolveArtifactQualityScore } from "@/v3/lib/artifactReview";

// ─── Readiness Action ─────────────────────────────────────────────────────────
// Ranked action with estimated readiness impact — powers the "what to do next"
// guidance across StageView, InsightFeedView, and ProgrammeHealthView.
export interface ReadinessAction {
  id: string;
  label: string;
  description: string;
  estimatedImpact: number;   // Approximate readiness points this action could add
  effort: "quick" | "hours" | "days";
  agentId?: string;           // If an agent can execute this
  workspaceId?: string;       // If user should navigate to a workspace
  priority: "critical" | "high" | "medium";
}

export interface PhaseReadinessResult {
  score: number;
  gateScore: number | null;
  artifactScore: number;
  inputScore: number;
  /**
   * 0-100 artifact completeness: share of the phase's resolved required artifact
   * set that is present. For dynamic-only phases (no static required set) this is
   * 100 once ≥1 artifact has been produced, else 0. Gate locking requires 100.
   */
  artifactsComplete: number;
  canApproveGate: boolean;
  threshold: number;
  missing: string[];
  mandatoryExitsPassing: boolean;
  mandatoryExitsTotal: number;
  mandatoryExitsMet: number;
  reviewScoresCount: number;
  /** Ranked actions to improve readiness, highest impact first. */
  recommendedActions: ReadinessAction[];
  /** How many library exit criteria exist for this phase (including unmet). */
  libraryExitCriteriaCount: number;
  /** How many library mandatory criteria are not yet in the gate review. */
  missingLibraryCriteria: number;
  /**
   * Persisted cross-phase dependency-check verdict: true = consistent with the
   * prior approved phase, false = blocked, null = not yet run. Read from stored
   * agent output, so it costs no model tokens to evaluate here.
   */
  dependencyCheckPassed: boolean | null;
  /** Count of blocking-severity cross-phase dependency issues. */
  dependencyBlockingIssues: number;
}

export function computePhaseReadiness(
  program: ProgramSummary,
  phaseId: string,
  threshold?: number,
): PhaseReadinessResult {
  // Use phase-calibrated threshold (Priority 1 — phase-specific confidence thresholds)
  const resolvedThreshold = threshold ?? getGateThreshold(phaseId);

  const missing: string[] = [];
  const recommendedActions: ReadinessAction[] = [];

  const gateReview = program.gateReviews?.[phaseId] ?? null;
  const gateScore = typeof gateReview?.readinessScore === "number" ? gateReview.readinessScore : null;

  // Fast-path: gate already approved
  if (gateReview?.status === "approved" && gateScore !== null) {
    return {
      score: gateScore,
      gateScore,
      artifactScore: 0,
      inputScore: 100,
      artifactsComplete: 100,
      canApproveGate: true,
      threshold: resolvedThreshold,
      missing: [],
      mandatoryExitsPassing: true,
      mandatoryExitsTotal: 0,
      mandatoryExitsMet: 0,
      reviewScoresCount: 0,
      recommendedActions: [],
      libraryExitCriteriaCount: getMandatoryCriteria(phaseId).length,
      missingLibraryCriteria: 0,
      dependencyCheckPassed: true,
      dependencyBlockingIssues: 0,
    };
  }

  const source = (() => {
    const raw = program.rawData as Record<string, unknown>;
    if (!raw) return null;
    return typeof raw.data === "object" && raw.data !== null
      ? raw.data as Record<string, unknown>
      : raw;
  })();

  const phaseArtifacts = source && typeof source.phaseArtifacts === "object" && source.phaseArtifacts !== null
    ? source.phaseArtifacts as Record<string, Record<string, { confidence?: number; status?: string }>>
    : {};
  const phaseArtifactRecords = phaseArtifacts[phaseId] ?? {};
  const artifactsForPhase = Object.values(phaseArtifactRecords);

  // ── Resolved required artifact set ──────────────────────────────────────────
  // The phase's required artifact set = the methodology's static requiredArtifacts
  // (Strategy) merged with any ai-derived dynamic artifacts the programme has
  // accrued for this phase. A dynamic-only phase has no static required set.
  const phaseDef = ATOS_STANDARD.phases.find((p) => p.id === phaseId);
  const dynamicStore = getDynamicSchemaStore(program.rawData);
  const requiredArtifactIds = [
    ...(phaseDef?.requiredArtifacts ?? []),
    ...dynamicArtifactDefs(phaseId, dynamicStore).map((d) => d.id),
  ];
  const presentArtifactIds = new Set(Object.keys(phaseArtifactRecords));

  // ── Artifact quality score ──────────────────────────────────────────────────
  // Quality is scored over THIS phase's own artifacts only — its required set
  // plus anything actually produced — never a fixed programme-wide review pool.
  // Each artifact resolves through the same single source of truth the Stage
  // view cards use (AI review score, else the ledger's stored confidence), so
  // the header tile equals the average of the visible card scores. Reading a
  // fixed programme-wide key list instead leaked later-phase quality into a
  // phase (e.g. Strategy reading 57% off plan/risk/adoption reviews that belong
  // to Build/Operate) and diverged from the per-artifact card scores.
  const qualityArtifactIds = Array.from(new Set([...requiredArtifactIds, ...presentArtifactIds]));
  const phaseQualityScores = qualityArtifactIds
    .map((id) => resolveArtifactQualityScore(source, id, phaseId, phaseArtifactRecords[id]?.confidence ?? null))
    .filter((value): value is number => value !== null);

  // Quality is only meaningful once the phase has actually produced a required
  // artifact (or, for dynamic-only phases with no required spine, any artifact).
  const hasProducedArtifact = requiredArtifactIds.length > 0
    ? requiredArtifactIds.some((id) => presentArtifactIds.has(id))
    : presentArtifactIds.size > 0;
  const artifactScore = !hasProducedArtifact || !phaseQualityScores.length
    ? 0
    : Math.round(phaseQualityScores.reduce((sum, value) => sum + value, 0) / phaseQualityScores.length);

  // ── Artifact completeness ───────────────────────────────────────────────────
  // Completeness is the share of the required set that has been APPROVED — merely
  // producing a draft does not count it as complete; a PM must review and approve
  // each document. A dynamic-only phase is complete once ≥1 artifact is approved.
  // This is also the gate-lock bar: the gate auto-runs when the last required
  // document is approved, so completeness reaching 100% and the gate becoming
  // lockable are the same event.
  const isArtifactApproved = (id: string) => phaseArtifactRecords[id]?.status === "approved";
  const artifactsComplete = requiredArtifactIds.length > 0
    ? Math.round(
        (requiredArtifactIds.filter(isArtifactApproved).length / requiredArtifactIds.length) * 100,
      )
    : artifactsForPhase.some((record) => record.status === "approved") ? 100 : 0;

  if (!phaseQualityScores.length && !artifactsForPhase.length) {
    missing.push("No artifacts generated yet");
    // Highest-impact action: run the phase narrative agent
    recommendedActions.push({
      id: "run-narrative",
      label: "Generate phase narrative",
      description: "Running the narrative agent produces the primary phase artifact and lifts artifact score by up to 20 readiness points.",
      estimatedImpact: 20,
      effort: "quick",
      agentId: "narrative",
      priority: "critical",
    });
  } else if (artifactScore < 60) {
    recommendedActions.push({
      id: "improve-artifacts",
      label: "Improve artifact quality",
      description: `Artifact quality is ${artifactScore}%. Re-running phase agents after adding more inputs can improve this significantly.`,
      estimatedImpact: Math.round((70 - artifactScore) * 0.3),
      effort: "hours",
      agentId: "narrative",
      priority: "high",
    });
  }

  // ── Input quality score (Priority 1 — replaces binary 0/100) ──────────────
  const humanNotes = Array.isArray(source?.humanNotes) ? source.humanNotes as Record<string, unknown>[] : [];
  const hasStageNote = humanNotes.some(
    (note) => note.phaseId === phaseId && (note.type === "stage-note" || note.type === "gate-note"),
  );
  const phaseInputs = source && typeof source.phaseInputs === "object" && source.phaseInputs !== null
    ? source.phaseInputs as Record<string, Record<string, unknown>>
    : {};
  const phaseInputData = phaseInputs[phaseId] ?? {};
  const extractionConfidence = typeof phaseInputData._extractionConfidence === "number"
    ? Number(phaseInputData._extractionConfidence)
    : 1.0;
  const hasStructuredInputs = Object.keys(phaseInputData).filter((k) => !k.startsWith("_")).length > 0;

  // Quality-weighted input score. The schema-grounded derivePhaseInputQuality is
  // the single source of truth for phases that declare a static input schema, and
  // is exactly what the phase screen's "Input quality" tile renders — so reading
  // it here keeps the status rings (inner = input) consistent with the metrics.
  // Dynamic-only phases declare no static schema (it returns null); there we fall
  // back to counting the stored dynamic fields so produced inputs still register.
  const schemaInputQuality = derivePhaseInputQuality(phaseId, phaseInputData, dynamicStore);
  const inputScore = schemaInputQuality
    ? schemaInputQuality.overallScore
    : hasStructuredInputs
      ? computeInputQualityScore(phaseInputData, extractionConfidence, hasStageNote)
      : hasStageNote ? 30 : 0;

  if (!hasStructuredInputs && !hasStageNote) {
    missing.push("No inputs provided for this phase");
    recommendedActions.push({
      id: "add-inputs",
      label: "Complete phase inputs",
      description: "Adding structured inputs for this phase lifts the input score from 0% and improves artifact quality when agents run.",
      estimatedImpact: 10,
      effort: "hours",
      priority: "high",
    });
  } else if (inputScore < 50) {
    recommendedActions.push({
      id: "expand-inputs",
      label: "Expand phase inputs",
      description: `Input quality is low (${inputScore}%). Expanding field responses to at least 20 words each will improve the quality score.`,
      estimatedImpact: 5,
      effort: "hours",
      priority: "medium",
    });
  }

  // ── Exit criteria (Priority 4 — auto-populate from library if empty) ────────
  const storedExitCriteria = Array.isArray(gateReview?.exitCriteriaStatus)
    ? gateReview.exitCriteriaStatus as ExitCriterion[]
    : [];

  // Auto-seed from exit criteria library if no stored criteria exist yet
  const libraryCriteria = getMandatoryCriteria(phaseId);
  const effectiveExitCriteria: ExitCriterion[] =
    storedExitCriteria.length > 0
      ? storedExitCriteria
      : libraryCriteria.map((lc) => ({
          criterion: lc.label,
          met: false,
          evidence: null,
          mandatory: true,
        } as ExitCriterion));

  const mandatoryExits = effectiveExitCriteria.filter(
    (criterion) => (criterion as Record<string, unknown>).mandatory !== false,
  );
  const mandatoryExitsMet = mandatoryExits.filter((criterion) => criterion.met).length;
  const mandatoryExitsTotal = mandatoryExits.length;
  const mandatoryExitsPassing = mandatoryExitsTotal === 0 || mandatoryExitsMet === mandatoryExitsTotal;
  const missingLibraryCriteria = libraryCriteria.length - Math.min(libraryCriteria.length, storedExitCriteria.length);

  if (!mandatoryExitsPassing) {
    const unmet = mandatoryExits
      .filter((criterion) => !criterion.met)
      .map((criterion) => criterion.criterion);
    missing.push(`${unmet.length} mandatory exit criteria unmet: ${unmet.slice(0, 2).join("; ")}`);
    recommendedActions.push({
      id: "gate-review",
      label: "Run gate review to assess exit criteria",
      description: `${unmet.length} mandatory exit criteria are not yet met. The gate-review agent evaluates evidence and marks criteria met.`,
      estimatedImpact: Math.round(unmet.length * 3),
      effort: "quick",
      agentId: "gate-review",
      priority: "critical",
    });
  }

  // ── Open decisions blocking gate (Priority 8 — decision-to-readiness linkage) ─
  const openPhaseDecisions = (program.decisionQueue ?? []).filter(
    (d) => (!d.status || d.status === "open") && (!d.phaseId || d.phaseId === phaseId),
  );
  if (openPhaseDecisions.length > 0) {
    missing.push(`${openPhaseDecisions.length} unresolved decision(s) must be resolved before gate approval`);
    recommendedActions.push({
      id: "resolve-decisions",
      label: `Resolve ${openPhaseDecisions.length} open decision${openPhaseDecisions.length > 1 ? "s" : ""}`,
      description: `Open decisions create risk and uncertainty. Resolving them lifts gate confidence by approximately ${openPhaseDecisions.length * 4} readiness points.`,
      estimatedImpact: Math.min(20, openPhaseDecisions.length * 4),
      effort: openPhaseDecisions.length > 3 ? "days" : "hours",
      workspaceId: "decision-audit",
      priority: openPhaseDecisions.length >= 3 ? "critical" : "high",
    });
  }

  // ── Unvalidated critical assumptions ─────────────────────────────────────────
  // Read the canonical normalized RAID entries (derived from data.raidLog.entries —
  // where useRaidLog actually writes), keyed on the persisted `severity` and the
  // `validatedAt` flag set by validateAssumption. The old read of raw
  // `data.raidEntries` / `criticality` never matched real data, so this gate never
  // fired in production. Scope to this phase (consistent with how risks/decisions
  // gate) and ignore closed entries — closeEntry resolves an assumption without
  // stamping validatedAt, so an unscoped/closed-blind check would let a single
  // closed assumption deadlock every gate.
  const unvalidatedCriticalAssumptions = (program.raidEntries ?? []).filter(
    (entry) =>
      entry.type === "assumption" &&
      entry.severity === "critical" &&
      entry.phase === phaseId &&
      entry.status !== "closed" &&
      !entry.validatedAt,
  );

  if (unvalidatedCriticalAssumptions.length) {
    missing.push(`${unvalidatedCriticalAssumptions.length} critical assumption(s) not yet validated`);
    recommendedActions.push({
      id: "validate-assumptions",
      label: "Validate critical assumptions",
      description: `${unvalidatedCriticalAssumptions.length} critical assumption(s) are blocking gate approval. Add evidence to mark them validated.`,
      estimatedImpact: 8,
      effort: "hours",
      workspaceId: "risks",
      priority: "critical",
    });
  }

  // ── Cross-phase dependency check (hard gate condition) ───────────────────────
  // Read the PERSISTED dependency-check verdict (the agent auto-runs downstream of
  // gate-review) instead of invoking the model here — so enforcing cross-phase
  // consistency costs zero tokens. A failing verdict with a blocking-severity
  // issue hard-blocks the gate, ensuring a phase cannot pass while its artifacts
  // contradict or fail to build on the prior approved phase. An absent verdict
  // (never run) does not block here — the approve handler guarantees a check runs.
  // The first phase has no prior approved phase, so a cross-phase dependency check
  // is meaningless there — never let it block (the agent can still emit a spurious
  // "inconsistent with prior phase" verdict when given empty prior context).
  const isFirstPhase = (program.phases?.[0]?.id ?? null) === phaseId;
  const dependencyCheckResult = source && typeof source.dependencyCheck === "object" && source.dependencyCheck !== null
    ? (source.dependencyCheck as Record<string, { passed?: boolean; issues?: Array<{ severity?: string; description?: string }> }>)[phaseId]
    : undefined;
  const dependencyBlockingIssues = isFirstPhase || !Array.isArray(dependencyCheckResult?.issues)
    ? []
    : dependencyCheckResult.issues.filter((issue) => issue?.severity === "blocking");
  const dependencyCheckPassed: boolean | null = isFirstPhase
    ? true
    : dependencyCheckResult
      ? dependencyCheckResult.passed !== false && dependencyBlockingIssues.length === 0
      : null;
  const dependencyCheckBlocking = dependencyCheckPassed === false;

  if (dependencyCheckBlocking) {
    const firstIssue = dependencyBlockingIssues[0]?.description;
    const count = dependencyBlockingIssues.length || 1;
    missing.push(`Cross-phase dependency check failed${firstIssue ? `: ${firstIssue}` : ""}`);
    recommendedActions.push({
      id: "dependency-check",
      label: "Resolve cross-phase dependency issues",
      description: `${count} blocking dependency issue${count > 1 ? "s" : ""} mean this phase's artifacts are not consistent with the prior approved phase. Resolve them, then re-run the dependency check.`,
      estimatedImpact: 10,
      effort: "hours",
      agentId: "dependency-check",
      priority: "critical",
    });
  }

  // ── RACI gaps ─────────────────────────────────────────────────────────────────
  const raciGaps = (source?.raciGaps as Record<string, Array<{ artifact: string; missingRole: string }>> | undefined)?.[phaseId] ?? [];
  const accountableGaps = raciGaps.filter((gap) => gap.missingRole === "Accountable");
  if (accountableGaps.length) {
    missing.push(`${accountableGaps.length} artifact(s) have no accountable owner`);
    recommendedActions.push({
      id: "assign-raci",
      label: "Assign accountable owners",
      description: `${accountableGaps.length} artifact(s) lack an accountable owner. Gate approval requires all artefacts to be owned.`,
      estimatedImpact: 5,
      effort: "quick",
      priority: "high",
    });
  }

  // ── Compute headline score and gate-lock eligibility ──────────────────────────
  // Headline score is always the average of input quality and artifact quality —
  // the two things a PM controls. Gate locking is a stricter, separate bar:
  // artifacts fully present (100%) AND artifact quality above 90%, with all hard
  // gate conditions (exit criteria, critical assumptions, cross-phase dependency)
  // satisfied. The headline score is informational; it does not gate the lock.
  const score = Math.min(100, Math.max(0, Math.round((inputScore + artifactScore) / 2)));
  const canApproveGate =
    artifactsComplete === 100 &&
    artifactScore > 90 &&
    mandatoryExitsPassing &&
    unvalidatedCriticalAssumptions.length === 0 &&
    !dependencyCheckBlocking;

  if (!canApproveGate && artifactsComplete < 100 && (phaseQualityScores.length || artifactsForPhase.length)) {
    missing.push(`Artifacts are ${artifactsComplete}% complete — every required artifact must be approved before the gate can be locked`);
  }

  if (!canApproveGate && artifactsComplete === 100 && artifactScore <= 90) {
    missing.push(`Artifact quality is ${artifactScore}% — it must exceed 90% before the gate can be locked`);
    if (!recommendedActions.some((a) => a.agentId === "gate-readiness-coach")) {
      recommendedActions.push({
        id: "gate-coach",
        label: "Run gate readiness coach",
        description: `Artifact quality is ${91 - artifactScore} point${91 - artifactScore === 1 ? "" : "s"} short of the 90% lock bar. The gate readiness coach identifies the fastest path to approval.`,
        estimatedImpact: Math.min(15, 91 - artifactScore),
        effort: "quick",
        agentId: "gate-readiness-coach",
        priority: artifactScore < 70 ? "critical" : "high",
      });
    }
  }

  // Sort actions: critical first, then by estimated impact descending
  recommendedActions.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2 };
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    return pd !== 0 ? pd : b.estimatedImpact - a.estimatedImpact;
  });

  return {
    score,
    gateScore,
    artifactScore,
    inputScore,
    artifactsComplete,
    canApproveGate,
    threshold: resolvedThreshold,
    missing,
    mandatoryExitsPassing,
    mandatoryExitsTotal,
    mandatoryExitsMet,
    reviewScoresCount: phaseQualityScores.length,
    recommendedActions,
    libraryExitCriteriaCount: libraryCriteria.length,
    missingLibraryCriteria,
    dependencyCheckPassed,
    dependencyBlockingIssues: dependencyBlockingIssues.length,
  };
}

export function getLockedPhaseIds(program: ProgramSummary): Set<string> {
  const locked = new Set<string>();
  const phases = program.phases || [];

  // Strict sequential gating: a phase is reachable only once its immediate
  // predecessor's gate has been approved (locked). The first phase is always
  // open; the moment we reach a phase whose own gate is not yet approved, that
  // phase stays the active frontier but EVERY phase after it is locked — you
  // cannot enter Mobilise until Strategy is locked, Discover until Mobilise is
  // locked, and so on. This stops a phase being started before the prior gate
  // clears, rather than letting the next phase open speculatively.
  for (let index = 0; index < phases.length - 1; index += 1) {
    const gate = program.gateReviews?.[phases[index].id];
    if (gate?.status !== "approved") {
      for (let remaining = index + 1; remaining < phases.length; remaining += 1) {
        locked.add(phases[remaining].id);
      }
      break;
    }
  }

  return locked;
}
