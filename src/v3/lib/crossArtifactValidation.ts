/**
 * Cross-artifact validation — deterministic core (Validation Layer, Layer 2).
 *
 * ATOS keeps *generation* (Layer 1) lightweight: agents produce artifacts from
 * structured inputs and do NOT cross-validate the whole program on every run.
 * This module is the separate, on-demand *validation* layer. It detects
 * coverage gaps, missing traceability, unsupported items, and governance issues
 * across already-generated artifacts.
 *
 * The bulk of enterprise validation is *structural* — "this risk has no
 * mitigation", "this KPI has no benefit", "this gate criterion has no
 * evidence". Those are set-membership facts that need NO model call, so they
 * run here for free. Only genuinely semantic checks (does the Solution Design
 * actually satisfy requirement REQ-14?) are delegated to model-backed
 * validation agents — see VALIDATION_AGENTS for that registry.
 *
 * Token strategy: this deterministic pass is the default. It is change-aware
 * (run only the domains an input touched) and gate-driven, keeping the platform
 * token increase to single digits rather than re-prompting every artifact.
 */

import type {
  BenefitsTrackingSummary,
  ChangeImpactAssessment,
  GateReview,
  Milestone,
  RAIDEntry,
  StakeholderProfile,
  Workstream,
  PhaseSummary,
  BudgetTracking,
} from "@/new/types";
import { getProgramState } from "@/new/lib/programState";

export type ValidationSeverity = "critical" | "high" | "medium" | "low";

/**
 * One cross-artifact finding. Mirrors the enterprise finding contract so the
 * same shape flows from deterministic rules and from model-backed validation
 * agents into the Action Center, Gate Reviews, and Executive Brief.
 */
export interface ValidationFinding {
  findingId: string;
  severity: ValidationSeverity;
  /** Validation domain this finding belongs to (for grouping / incremental runs). */
  domain: ValidationDomain;
  /** Phase the finding is attributable to, when derivable; omitted for program-wide gaps. */
  phaseId?: string;
  /** Artifact/field the issue originates from (e.g. "raidEntries"). */
  sourceArtifact: string;
  /** Artifact/field the issue points at; "" when intra-artifact. */
  targetArtifact: string;
  /** The specific item (id or label) the finding is about. */
  sourceItem: string;
  issue: string;
  recommendation: string;
  /** 0–1. Deterministic structural facts are 1; model findings carry model confidence. */
  confidence: number;
  /** Human-readable citations backing the finding. */
  evidence: string[];
}

export type ValidationDomain =
  | "risk-controls"
  | "stakeholder-readiness"
  | "benefits-traceability"
  | "delivery-readiness"
  | "governance"
  | "scope-coverage"
  | "requirements-coverage"
  | "architecture-consistency";

/** Minimal program surface the deterministic rules read. */
export interface ValidatableProgram {
  raidEntries?: RAIDEntry[];
  stakeholders?: StakeholderProfile[];
  changeImpact?: ChangeImpactAssessment | null;
  benefitsTracking?: BenefitsTrackingSummary | null;
  budgetTracking?: BudgetTracking | null;
  milestones?: Milestone[];
  gateReviews?: Record<string, GateReview>;
  workstreams?: Workstream[];
  phases?: PhaseSummary[];
  /** Raw programme payload; read only for phaseInputs-scoped signals (e.g. strategy KPIs). */
  rawData?: Record<string, unknown> | null;
}

const isBlank = (s: string | null | undefined): boolean => !s || s.trim().length === 0;
const SEVERE = new Set<ValidationSeverity>(["critical", "high"]);

/**
 * The strategy-phase KPI rows a programme carries in `phaseInputs.strategy.kpis`
 * (stored as an array or a JSON string, optionally under a `data` wrapper). These
 * are the canonical measurable KPIs authored in Strategy — the benefits tracker
 * mirrors them later — so a programme with strategy KPIs demonstrably *has*
 * tracked KPIs even when `benefitsTracking` has not been populated yet.
 */
function strategyKpiRows(p: ValidatableProgram): unknown[] {
  const raw = (p.rawData ?? {}) as Record<string, unknown>;
  const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
  const pi = inner.phaseInputs;
  const strategy = pi && typeof pi === "object" ? (pi as Record<string, unknown>).strategy : null;
  const kpis = strategy && typeof strategy === "object" ? (strategy as Record<string, unknown>).kpis : null;
  if (Array.isArray(kpis)) return kpis;
  if (typeof kpis === "string" && kpis.trim()) {
    try {
      const parsed = JSON.parse(kpis);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Normalise a KPI/criterion label for tolerant name matching. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Best-effort display name of a strategy KPI row. Strategy KPIs are authored as
 * loose objects (array or JSON-string sourced), so read the common name keys
 * defensively rather than assuming a fixed shape.
 */
function kpiRowName(row: unknown): string {
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    const n = r.name ?? r.title ?? r.kpi ?? r.metric;
    if (typeof n === "string") return n.trim();
  }
  return "";
}

/** A deterministic rule: pure function from program state to findings. */
interface ValidationRule {
  id: string;
  domain: ValidationDomain;
  run: (p: ValidatableProgram) => ValidationFinding[];
}

const RULES: ValidationRule[] = [
  {
    id: "risk-without-mitigation",
    domain: "risk-controls",
    run: (p) =>
      (p.raidEntries ?? [])
        .filter((e) => e.type === "risk" && e.status === "open" && SEVERE.has(e.severity) && isBlank(e.mitigation))
        .map((e) => ({
          findingId: `risk-mitigation:${e.id}`,
          severity: e.severity,
          domain: "risk-controls",
          phaseId: e.phase,
          sourceArtifact: "raidEntries",
          targetArtifact: "",
          sourceItem: e.id,
          issue: `${e.severity} risk "${e.title}" has no mitigation plan.`,
          recommendation: "Define a mitigation and assign an owner before the next gate.",
          confidence: 1,
          evidence: [`RAID ${e.id} (${e.phase}): status=open, mitigation=∅`],
        })),
  },
  {
    id: "open-item-without-owner",
    domain: "risk-controls",
    run: (p) =>
      (p.raidEntries ?? [])
        .filter((e) => (e.type === "blocker" || e.type === "dependency") && e.status === "open" && isBlank(e.owner))
        .map((e) => ({
          findingId: `owner:${e.id}`,
          severity: "medium",
          domain: "risk-controls",
          phaseId: e.phase,
          sourceArtifact: "raidEntries",
          targetArtifact: "",
          sourceItem: e.id,
          issue: `Open ${e.type} "${e.title}" has no assigned owner.`,
          recommendation: "Assign an accountable owner so the item can be actively worked.",
          confidence: 1,
          evidence: [`RAID ${e.id} (${e.phase}): type=${e.type}, owner=∅`],
        })),
  },
  {
    id: "stakeholder-without-change-actions",
    domain: "stakeholder-readiness",
    run: (p) =>
      (p.stakeholders ?? [])
        .filter(
          (s) =>
            (s.influence === "high" || s.currentEngagement === "resistant" || s.riskOfDisengagement === "high") &&
            (s.recommendedActions?.length ?? 0) === 0,
        )
        .map((s) => ({
          findingId: `stakeholder-actions:${s.id}`,
          severity: s.currentEngagement === "resistant" ? "high" : "medium",
          domain: "stakeholder-readiness",
          sourceArtifact: "stakeholders",
          targetArtifact: "changeImpact",
          sourceItem: s.id,
          issue: `Stakeholder "${s.name}" (${s.role}) has no change-management actions.`,
          recommendation: "Add engagement/communication actions to move them toward the target engagement.",
          confidence: 1,
          evidence: [`influence=${s.influence}, engagement=${s.currentEngagement}, actions=0`],
        })),
  },
  {
    id: "impacted-group-without-interventions",
    domain: "stakeholder-readiness",
    run: (p) =>
      (p.changeImpact?.impactedGroups ?? [])
        .filter((g) => SEVERE.has(g.impactLevel) && (g.interventions?.length ?? 0) === 0)
        .map((g) => ({
          findingId: `change-interventions:${g.group}`,
          severity: "high",
          domain: "stakeholder-readiness",
          sourceArtifact: "changeImpact",
          targetArtifact: "",
          sourceItem: g.group,
          issue: `${g.impactLevel} impacted group "${g.group}" has no change interventions.`,
          recommendation: "Define interventions (comms, training, support) for this group.",
          confidence: 1,
          evidence: [`impactLevel=${g.impactLevel}, interventions=0`],
        })),
  },
  {
    id: "benefits-without-kpis",
    domain: "benefits-traceability",
    run: (p) => {
      const projected = p.budgetTracking?.projectedBenefits ?? null;
      const milestones = p.budgetTracking?.benefitMilestones ?? [];
      const kpis = p.benefitsTracking?.kpis ?? [];
      // A programme with measurable strategy KPIs is not "without tracked KPIs",
      // even before the benefits tracker mirrors them — count both sources so the
      // finding is not a false positive on the common phaseInputs-only shape.
      const strategyKpis = strategyKpiRows(p);
      const benefitsAsserted = (projected != null && projected > 0) || milestones.length > 0;
      if (!benefitsAsserted || kpis.length > 0 || strategyKpis.length > 0) return [];
      return [
        {
          findingId: "benefits-no-kpis",
          severity: "high",
          domain: "benefits-traceability",
          sourceArtifact: "businessCaseDoc",
          targetArtifact: "benefitsTracking",
          sourceItem: "projectedBenefits",
          issue: "Business-case benefits are not reflected in any tracked KPI.",
          recommendation: "Define at least one measurable KPI per projected benefit, baselined against the business case.",
          confidence: 1,
          evidence: [
            `projectedBenefits=${projected ?? "n/a"}`,
            `benefitMilestones=${milestones.length}`,
            "trackedKpis=0",
          ],
        },
      ];
    },
  },
  {
    id: "kpi-without-baseline",
    domain: "benefits-traceability",
    run: (p) =>
      (p.benefitsTracking?.kpis ?? [])
        .filter((k) => isBlank(k.baseline) || isBlank(k.target))
        .map((k) => ({
          findingId: `kpi-baseline:${k.name}`,
          severity: "medium",
          domain: "benefits-traceability",
          sourceArtifact: "benefitsTracking",
          targetArtifact: "",
          sourceItem: k.name,
          issue: `KPI "${k.name}" is not measurable (missing baseline or target).`,
          recommendation: "Set a baseline and target so the KPI can demonstrate benefit realisation.",
          confidence: 1,
          evidence: [`baseline="${k.baseline}", target="${k.target}"`],
        })),
  },
  {
    // Upstream-fidelity: a KPI committed to in Strategy must be carried into the
    // benefits tracker downstream, or the measurable promise is silently dropped.
    // This is the directional "does a later phase honour the earlier phase?"
    // check — the deterministic floor beneath the model-backed benefits agent.
    id: "strategy-kpi-not-tracked-in-benefits",
    domain: "benefits-traceability",
    run: (p) => {
      const tracked = p.benefitsTracking?.kpis ?? [];
      // Only a *populated* tracker can drop a KPI. An empty/absent tracker is the
      // benefits-no-kpis concern (handled above), not a per-KPI fidelity gap — so
      // we never flag every strategy KPI merely because tracking is unbuilt.
      if (tracked.length === 0) return [];
      const trackedNames = tracked.map((k) => norm(k.name)).filter((n) => n.length > 0);
      const findings: ValidationFinding[] = [];
      for (const row of strategyKpiRows(p)) {
        const name = kpiRowName(row);
        if (!name) continue;
        const key = norm(name);
        // Tolerant match (either name contains the other) so a lightly reworded
        // benefit KPI still counts as carried forward — only true drops flag.
        const carried = trackedNames.some((t) => t === key || t.includes(key) || key.includes(t));
        if (carried) continue;
        findings.push({
          findingId: `benefits-kpi-untracked:${name}`,
          severity: "medium",
          domain: "benefits-traceability",
          sourceArtifact: "phaseInputs.strategy.kpis",
          targetArtifact: "benefitsTracking",
          sourceItem: name,
          issue: `Strategy KPI "${name}" is not carried into benefits tracking.`,
          recommendation: "Add this KPI to the benefits tracker (baselined) so its attainment is measured, or retire it in strategy.",
          confidence: 1,
          evidence: [`strategy KPI "${name}" has no matching tracked benefit KPI (${tracked.length} tracked)`],
        });
      }
      return findings;
    },
  },
  // (No "milestone has no exit criteria" rule: exit criteria are derived by the
  // methodology from artifact quality and completeness at the gate — they are never
  // authored by the user — so flagging an empty exitCriteria field as a blocker
  // asked the user to define something the system owns. See readinessModel.)
  {
    id: "milestone-broken-dependency",
    domain: "delivery-readiness",
    run: (p) => {
      const milestones = p.milestones ?? [];
      const ids = new Set(milestones.map((m) => m.id));
      const findings: ValidationFinding[] = [];
      for (const m of milestones) {
        for (const dep of m.dependsOn ?? []) {
          if (!ids.has(dep)) {
            findings.push({
              findingId: `milestone-dep:${m.id}:${dep}`,
              severity: "medium",
              domain: "delivery-readiness",
              phaseId: m.phaseId,
              sourceArtifact: "milestones",
              targetArtifact: "",
              sourceItem: m.id,
              issue: `Milestone "${m.title}" depends on unknown milestone "${dep}".`,
              recommendation: "Repair the dependency reference or add the missing milestone.",
              confidence: 1,
              evidence: [`dependsOn includes ${dep}, which is not a known milestone id`],
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: "gate-criterion-without-evidence",
    domain: "governance",
    run: (p) => {
      const findings: ValidationFinding[] = [];
      for (const review of Object.values(p.gateReviews ?? {})) {
        for (const c of review.exitCriteriaStatus ?? []) {
          if (c.met && isBlank(c.evidence)) {
            findings.push({
              findingId: `gate-evidence:${review.phaseId}:${c.criterion}`,
              severity: "high",
              domain: "governance",
              phaseId: review.phaseId,
              sourceArtifact: "gateReviews",
              targetArtifact: "",
              sourceItem: `${review.phaseId}:${c.criterion}`,
              issue: `Gate criterion "${c.criterion}" is marked met but has no supporting evidence.`,
              recommendation: "Attach evidence (artifact reference or sign-off) or mark the criterion unmet.",
              confidence: 1,
              evidence: [`phase=${review.phaseId}, met=true, evidence=∅`],
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: "phase-without-workstream",
    domain: "scope-coverage",
    run: (p) => {
      const workstreams = p.workstreams ?? [];
      if (workstreams.length === 0) return []; // workstreams not planned yet → not a gap
      const covered = new Set(workstreams.map((w) => w.phaseId));
      return (p.phases ?? [])
        .filter((ph) => ph.status === "active" && !covered.has(ph.id))
        .map((ph) => ({
          findingId: `scope-workstream:${ph.id}`,
          severity: "medium",
          domain: "scope-coverage",
          phaseId: ph.id,
          sourceArtifact: "phases",
          targetArtifact: "workstreams",
          sourceItem: ph.id,
          issue: `Active phase "${ph.displayName}" is not reflected in any delivery workstream.`,
          recommendation: "Add a workstream covering this phase's scope, or confirm it is out of delivery.",
          confidence: 1,
          evidence: [`phase ${ph.id} active, workstreams covering it = 0`],
        }));
    },
  },
];

export interface ValidationOptions {
  /** Restrict to these domains (incremental / change-aware validation). */
  domains?: ValidationDomain[];
}

/**
 * Run the deterministic, model-free validation pass. Zero token cost. Pass
 * `domains` to validate only the areas an input change impacted.
 */
export function runDeterministicValidation(
  program: ValidatableProgram,
  options: ValidationOptions = {},
): ValidationFinding[] {
  const allow = options.domains ? new Set(options.domains) : null;
  const findings: ValidationFinding[] = [];
  for (const rule of RULES) {
    if (allow && !allow.has(rule.domain)) continue;
    findings.push(...rule.run(program));
  }
  return findings;
}

export interface PhaseSelectOptions {
  /** Exclude these domains (e.g. ones already surfaced by another engine). */
  excludeDomains?: ValidationDomain[];
  /** Also include program-wide findings (no phaseId) at or above this severity. */
  includeProgramWideAtLeast?: ValidationSeverity;
}

/**
 * Select the findings relevant to a single phase: those attributed to the phase,
 * plus optionally program-wide findings above a severity floor. Used to fold
 * cross-artifact gaps into a phase's gate-blocker list without repeating
 * program-wide findings on every phase.
 */
export function selectFindingsForPhase(
  findings: ValidationFinding[],
  phaseId: string,
  options: PhaseSelectOptions = {},
): ValidationFinding[] {
  const exclude = options.excludeDomains ? new Set(options.excludeDomains) : null;
  const floor = options.includeProgramWideAtLeast ? SEVERITY_RANK[options.includeProgramWideAtLeast] : null;
  return findings.filter((f) => {
    if (exclude?.has(f.domain)) return false;
    if (f.phaseId === phaseId) return true;
    if (floor != null && f.phaseId == null && SEVERITY_RANK[f.severity] >= floor) return true;
    return false;
  });
}

const SEVERITY_RANK: Record<ValidationSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface ValidationSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** 0–100; 100 = no findings. Weighted by severity so criticals dominate. */
  coverageScore: number;
  byDomain: Partial<Record<ValidationDomain, number>>;
  recommendation: "Proceed" | "Conditional Proceed" | "Rework Required";
}

/** Roll findings up into a gate-style summary for executive and gate surfaces. */
export function summariseValidation(findings: ValidationFinding[]): ValidationSummary {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const byDomain: Partial<Record<ValidationDomain, number>> = {};
  let weighted = 0;
  for (const f of findings) {
    counts[f.severity] += 1;
    byDomain[f.domain] = (byDomain[f.domain] ?? 0) + 1;
    weighted += SEVERITY_RANK[f.severity];
  }
  const coverageScore = Math.max(0, Math.round(100 - weighted * 4));
  const recommendation =
    counts.critical > 0 || counts.high >= 3
      ? "Rework Required"
      : counts.high > 0 || counts.medium >= 3
        ? "Conditional Proceed"
        : "Proceed";
  return {
    total: findings.length,
    ...counts,
    coverageScore,
    byDomain,
    recommendation,
  };
}

// ── Triggering framework (change-aware, on-demand) ───────────────────────────

export interface ChangedInput {
  field: string;
  changeType?: "added" | "removed" | "changed";
}

/**
 * Material input fields (substrings) whose change warrants re-validation.
 * Cosmetic/wording changes that don't touch these are skipped, keeping
 * validation off the per-generation hot path.
 */
const MATERIAL_FIELD_HINTS = [
  "requirement",
  "scope",
  "objective",
  "successmetric",
  "kpi",
  "benefit",
  "budget",
  "cost",
  "architecture",
  "solution",
  "risk",
  "compliance",
  "control",
  "regulat",
  "stakeholder",
  "milestone",
  "workstream",
];

/** Maps a changed-input field to the validation domains it can invalidate. */
const FIELD_DOMAIN_HINTS: Array<[string, ValidationDomain]> = [
  ["requirement", "requirements-coverage"],
  ["scope", "scope-coverage"],
  ["workstream", "scope-coverage"],
  ["objective", "benefits-traceability"],
  ["successmetric", "benefits-traceability"],
  ["kpi", "benefits-traceability"],
  ["benefit", "benefits-traceability"],
  ["budget", "benefits-traceability"],
  ["cost", "benefits-traceability"],
  ["architecture", "architecture-consistency"],
  ["solution", "architecture-consistency"],
  ["risk", "risk-controls"],
  ["compliance", "risk-controls"],
  ["control", "risk-controls"],
  ["regulat", "risk-controls"],
  ["stakeholder", "stakeholder-readiness"],
  ["milestone", "delivery-readiness"],
];

export type ValidationTriggerEvent =
  | "gate_review"
  | "executive_review"
  | "input_change"
  | "user_requested"
  | "health_check"
  | "governance_review";

export interface ValidationTriggerDecision {
  shouldValidate: boolean;
  /** Domains to validate; empty means "all". Drives incremental scope. */
  domains: ValidationDomain[];
  reason: string;
}

/**
 * Decide whether (and how narrowly) to run validation. Gate/exec/governance/
 * user events always validate; input changes validate only on a *material*
 * change, scoped to the impacted domains.
 */
export function decideValidation(
  event: ValidationTriggerEvent,
  changedInputs: ChangedInput[] = [],
): ValidationTriggerDecision {
  if (event !== "input_change") {
    return { shouldValidate: true, domains: [], reason: `${event} always runs full validation` };
  }
  const material = changedInputs.filter((c) => {
    const f = c.field.toLowerCase();
    return MATERIAL_FIELD_HINTS.some((h) => f.includes(h));
  });
  if (material.length === 0) {
    return { shouldValidate: false, domains: [], reason: "no material input change" };
  }
  const domains = new Set<ValidationDomain>();
  for (const c of material) {
    const f = c.field.toLowerCase();
    for (const [hint, domain] of FIELD_DOMAIN_HINTS) if (f.includes(hint)) domains.add(domain);
  }
  return {
    shouldValidate: true,
    domains: [...domains],
    reason: `${material.length} material change(s); validating ${domains.size} impacted domain(s)`,
  };
}

/**
 * Registry of model-backed validation agents (Layer 2, semantic checks). These
 * are NOT implemented as prompts here — this declares the catalogue so the edge
 * function and UI can dispatch them on-demand. Each agent emits ValidationFinding[].
 */
export interface ValidationAgentSpec {
  id: string;
  title: string;
  domain: ValidationDomain;
  /** Source → target traceability the agent reasons over. */
  validates: string;
  /** Phases at whose gate this agent should run. */
  gates: string[];
}

export const VALIDATION_AGENTS: ValidationAgentSpec[] = [
  {
    id: "requirements-coverage",
    title: "Requirements Coverage",
    domain: "requirements-coverage",
    validates: "requirementsCatalog → futureStateDesign / solutionArchitecture",
    gates: ["design"],
  },
  {
    id: "architecture-consistency",
    title: "Architecture Consistency",
    domain: "architecture-consistency",
    validates: "futureStateDesign → solutionArchitecture (NFRs, integration, data, security)",
    gates: ["design"],
  },
  {
    id: "delivery-readiness",
    title: "Delivery Readiness",
    domain: "delivery-readiness",
    validates: "solutionArchitecture + futureStateDesign → plan / milestones / workstreams",
    gates: ["design", "build"],
  },
  {
    id: "benefits-traceability",
    title: "Benefits Traceability",
    domain: "benefits-traceability",
    validates: "strategy → businessCaseDoc → KPIs → benefits",
    gates: ["strategy", "operate", "valuerealize"],
  },
];

const VALID_DOMAINS = new Set<ValidationDomain>([
  "risk-controls",
  "stakeholder-readiness",
  "benefits-traceability",
  "delivery-readiness",
  "governance",
  "scope-coverage",
  "requirements-coverage",
  "architecture-consistency",
]);
const VALID_SEVERITIES = new Set<ValidationSeverity>(["critical", "high", "medium", "low"]);

/**
 * Read the model-backed validation findings the cross-artifact-validator agent
 * persisted into program data at the last gate review. These complement the
 * deterministic findings with semantic traceability gaps; both share the
 * ValidationFinding shape so callers can merge them freely.
 */
export function selectModelValidationFindings(
  program: { rawData?: Record<string, unknown> } | null,
): ValidationFinding[] {
  if (!program?.rawData) return [];
  const { inner } = getProgramState(program.rawData);
  const block = inner.crossArtifactValidation;
  if (typeof block !== "object" || block === null) return [];
  const raw = (block as Record<string, unknown>).findings;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => {
      const domain = f.domain as ValidationDomain;
      const severity = f.severity as ValidationSeverity;
      return {
        findingId: typeof f.findingId === "string" ? f.findingId : crypto.randomUUID(),
        severity: VALID_SEVERITIES.has(severity) ? severity : "medium",
        domain: VALID_DOMAINS.has(domain) ? domain : "delivery-readiness",
        phaseId: typeof f.phaseId === "string" ? f.phaseId : undefined,
        sourceArtifact: typeof f.sourceArtifact === "string" ? f.sourceArtifact : "",
        targetArtifact: typeof f.targetArtifact === "string" ? f.targetArtifact : "",
        sourceItem: typeof f.sourceItem === "string" ? f.sourceItem : "",
        issue: typeof f.issue === "string" ? f.issue : "",
        recommendation: typeof f.recommendation === "string" ? f.recommendation : "",
        confidence: typeof f.confidence === "number" ? f.confidence : 0.6,
        evidence: Array.isArray(f.evidence) ? f.evidence.filter((e): e is string => typeof e === "string") : [],
      } satisfies ValidationFinding;
    })
    .filter((f) => f.issue.length > 0);
}
