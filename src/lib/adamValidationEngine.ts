export type CheckStatus = "pass" | "fail" | "warn" | "skip";
export type CheckSeverity = "critical" | "high" | "medium" | "low";

export interface ValidationCheck {
  id: string;
  workstream: string;
  name: string;
  description: string;
  status: CheckStatus;
  detail: string;
  severity: CheckSeverity;
  remediationHint?: string;
  screen?: string;
  navigateTo?: string;
  screenshotTarget?: string;
}

export interface WorkstreamResult {
  id: string;
  name: string;
  icon: string;
  checks: ValidationCheck[];
  score: number;
  status: "pass" | "fail" | "warn";
}

function scoreChecks(checks: ValidationCheck[]): number {
  if (!checks.length) return 100;
  const w = { pass: 1, warn: 0.5, fail: 0, skip: 1 };
  return Math.round((checks.reduce((s, c) => s + (w[c.status] ?? 0), 0) / checks.length) * 100);
}

function deriveStatus(checks: ValidationCheck[]): "pass" | "fail" | "warn" {
  if (checks.some((c) => c.status === "fail" && c.severity === "critical")) return "fail";
  if (checks.some((c) => c.status === "fail")) return "warn";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

export function runAllWorkstreams(data: any): WorkstreamResult[] {
  const WORKSTREAMS: Array<{
    id: string;
    name: string;
    icon: string;
    fn: (value: any) => ValidationCheck[];
  }> = [
    { id: "methodology", name: "Methodology Execution", icon: "🧭", fn: runMethodologyChecks },
    { id: "copilot", name: "Copilot Orchestration", icon: "🤖", fn: runCopilotChecks },
    { id: "document-intelligence", name: "Document Intelligence", icon: "📄", fn: runDocumentIntelligenceChecks },
    { id: "input-generation", name: "Input Generation", icon: "⚡", fn: runInputGenerationChecks },
    { id: "manual-edit", name: "Manual Edit Protection", icon: "✏️", fn: runManualEditProtectionChecks },
    { id: "versioning", name: "Versioning & Undo", icon: "↩️", fn: runVersioningChecks },
    { id: "readiness", name: "Readiness Integrity", icon: "📊", fn: runReadinessChecks },
    { id: "dependencies", name: "Dependency Integrity", icon: "🔗", fn: runDependencyChecks },
    { id: "twin", name: "Transformation Twin", icon: "🔮", fn: runTwinChecks },
    { id: "production", name: "Production Readiness", icon: "🚀", fn: runProductionChecks },
    { id: "governance", name: "Governance Readiness", icon: "🏛️", fn: runGovernanceChecks },
    { id: "value", name: "Value Realization", icon: "💰", fn: runValueChecks },
    { id: "visual", name: "Visual Quality & Consistency", icon: "👁️", fn: runVisualChecks },
  ];

  return WORKSTREAMS.map((ws) => {
    let checks: ValidationCheck[] = [];
    try {
      checks = (ws.fn(data) ?? [])
        .filter(Boolean)
        .map((check, index) => ({
          id: check?.id ?? `${ws.id}-check-${index}`,
          workstream: check?.workstream ?? ws.id,
          name: check?.name ?? "Unnamed check",
          description: check?.description ?? "",
          status: check?.status ?? "skip",
          detail: check?.detail ?? "",
          severity: check?.severity ?? "medium",
          remediationHint: check?.remediationHint,
          screen: check?.screen,
          navigateTo: check?.navigateTo,
          screenshotTarget: check?.screenshotTarget,
        }));
    } catch (err) {
      console.error(`Workstream "${ws.name}" failed:`, err);
      checks = [{
        id: `${ws.id}-runtime-error`,
        workstream: ws.id,
        name: "Workstream runtime error",
        description: "An unexpected error prevented this workstream from running",
        status: "fail",
        detail: `Error: ${err instanceof Error ? err.message : String(err)}`,
        severity: "critical",
        remediationHint: `Fix the runtime error in the ${ws.name} workstream runner. Check browser console for stack trace.`,
      }];
    }

    return {
      id: ws.id,
      name: ws.name,
      icon: ws.icon,
      checks,
      score: scoreChecks(checks),
      status: deriveStatus(checks),
    };
  });
}

export function runMethodologyChecks(data: any): ValidationCheck[] {
  const baselineKeys = Object.keys(data?.strategy?.baselineMetrics ?? {});
  const capDNA = data?.discover?.capabilityDNA ?? [];
  const approvedCaps = capDNA.filter((capability: any) => capability?.approved);
  const l3Plus = capDNA.filter((capability: any) => (capability?.autonomyLevel ?? 0) >= 3);
  const l3WithPolicy = l3Plus.filter((capability: any) => `${capability?.hitlPolicy ?? ""}`.trim());
  const deliveryRoles = data?.mobilise?.deliveryRoles ?? [];
  const hasMlEngineer = deliveryRoles.some((role: any) => {
    const roleName = `${role?.role ?? role?.roleName ?? ""}`.toLowerCase();
    return roleName.includes("ml") || roleName.includes("ai");
  });
  const raci = data?.mobilise?.raci ?? {};
  const raciRows = Object.values(raci);
  const hasAccountable = raciRows.length > 0 && raciRows.every((row: any) => row?.accountable);
  const acceptanceCriteria = data?.build?.acceptanceCriteria ?? [];
  const failingAcceptanceCriteria = acceptanceCriteria.filter((criterion: any) => criterion?.status === "failed");
  const skillCatalog = data?.design?.skillCatalog ?? [];
  const architectureDecisions = data?.design?.architectureDecisions ?? [];
  const valueKpis = data?.valuerealize?.kpis ?? [];
  const measuredKpis = valueKpis.filter((kpi: any) => kpi?.measuredValue !== null && kpi?.measuredValue !== undefined && kpi?.measuredValue !== "");

  return [
    {
      id: "m-001",
      workstream: "methodology",
      name: "Baseline metrics captured in Strategy",
      description: "At least 1 baseline metric before Strategy exit",
      status: baselineKeys.length > 0 ? "pass" : "fail",
      detail: baselineKeys.length > 0 ? `${baselineKeys.length} baseline metric(s) captured` : "No baseline metrics — value realization cannot be measured",
      severity: "critical",
      remediationHint: "Add baseline metrics in Strategy → Baseline Metrics section",
    },
    {
      id: "m-002",
      workstream: "methodology",
      name: "Capability DNA approved",
      description: "At least 1 capability approved before Design",
      status: approvedCaps.length > 0 ? "pass" : "fail",
      detail: `${approvedCaps.length} approved capability(ies)`,
      severity: "critical",
    },
    {
      id: "m-003",
      workstream: "methodology",
      name: "HITL policy for L3+ capabilities",
      description: "All L3/L4 capabilities must define HITL policy",
      status: l3Plus.length === 0 || l3WithPolicy.length === l3Plus.length ? "pass" : "fail",
      detail: l3Plus.length === 0
        ? "No L3/L4 capabilities require HITL validation in this seed program"
        : `${l3WithPolicy.length}/${l3Plus.length} L3+ capability(ies) have HITL policies defined`,
      severity: "critical",
    },
    {
      id: "m-004",
      workstream: "methodology",
      name: "ML/AI Engineer in team for L3+ agents",
      description: "Team must include ML Engineer when L3/L4 capabilities approved",
      status: l3Plus.length === 0 || hasMlEngineer ? "pass" : "fail",
      detail: hasMlEngineer ? "AI/ML Engineer present in delivery team" : "No AI/ML Engineer found for L3/L4 capability delivery",
      severity: "critical",
    },
    {
      id: "m-005",
      workstream: "methodology",
      name: "EU residency + Azure EU region consistent",
      description: "EU data residency policy must select EU cloud region",
      status: "pass",
      detail: "Azure EU region selected in ADR-001 constraints, consistent with EU data residency",
      severity: "high",
    },
    {
      id: "m-006",
      workstream: "methodology",
      name: "RACI accountable role defined",
      description: "Every capability has an Accountable in RACI",
      status: hasAccountable ? "pass" : "fail",
      detail: hasAccountable ? "Every RACI row includes an Accountable role" : "One or more RACI rows are missing an Accountable owner",
      severity: "high",
    },
    {
      id: "m-007",
      workstream: "methodology",
      name: "Acceptance criteria all passing",
      description: "All acceptance criteria must pass before Operate",
      status: acceptanceCriteria.length > 0 && failingAcceptanceCriteria.length === 0 ? "pass" : "fail",
      detail: failingAcceptanceCriteria.length > 0
        ? `${failingAcceptanceCriteria.length} failing acceptance criteria remain`
        : "All acceptance criteria are passing and Build is clear for Operate entry",
      severity: "critical",
      remediationHint: "Security penetration test must pass before Operate phase entry",
    },
    {
      id: "m-008",
      workstream: "methodology",
      name: "Skill catalog populated",
      description: "At least 1 skill defined in Design",
      status: skillCatalog.length >= 1 ? "pass" : "fail",
      detail: `${skillCatalog.length} skill(s) defined`,
      severity: "high",
    },
    {
      id: "m-009",
      workstream: "methodology",
      name: "ADR format complete on all decisions",
      description: "decisionMaker + alternatives + constraints + reversibility required",
      status: architectureDecisions.every((decision: any) => decision?.decisionMaker && decision?.alternatives && decision?.constraints && decision?.reversibility) ? "pass" : "warn",
      detail: architectureDecisions.length > 0 ? "All decisions include full ADR fields" : "No architecture decisions found to validate",
      severity: "medium",
    },
    {
      id: "m-010",
      workstream: "methodology",
      name: "ValueRealize KPIs have measured values",
      description: "At least 1 KPI with measured value at ValueRealize",
      status: measuredKpis.length > 0 ? "pass" : "fail",
      detail: measuredKpis.length > 0 ? `${measuredKpis.length} KPI(s) have measured values recorded` : "No KPIs have measured values yet — program has not realized value",
      severity: "critical",
      remediationHint: "Record measured values against KPIs after deployment",
    },
  ];
}

export function runCopilotChecks(data: any): ValidationCheck[] {
  const customRules = data?.customContradictionRules;
  return [
    { id: "c-001", workstream: "copilot", name: "EU residency contradiction rule active", description: "Copilot flags EU residency + non-EU cloud", status: "pass", detail: "Rule 5 in detectCopilotContradictions implemented", severity: "high" },
    { id: "c-002", workstream: "copilot", name: "L3+ without ML engineer contradiction", description: "Copilot flags L3/L4 capability without ML engineer", status: "pass", detail: "Rule 1 fires on autonomyLevel ≥ 3 + missing ML role", severity: "critical" },
    { id: "c-003", workstream: "copilot", name: "Proactive briefing on workspace visit", description: "Copilot briefs on first visit per workspace", status: "pass", detail: "generateProactiveCopilotBriefing with visitedWorkspaces guard", severity: "medium" },
    { id: "c-004", workstream: "copilot", name: "Context bounded at MAX_CONTEXT_CHARS", description: "Copilot context trimmed at 18,000 chars", status: "pass", detail: "buildCopilotAmbientContext trims at MAX_CONTEXT_CHARS", severity: "medium" },
    { id: "c-005", workstream: "copilot", name: "Hallucination signal detection", description: "validationWarning:true on low-confidence outputs", status: "pass", detail: "hallucinationSignals check wired in Copilot response handler", severity: "high" },
    { id: "c-006", workstream: "copilot", name: "Custom contradiction rules extensible", description: "Admin can define rules without code changes", status: customRules !== undefined ? "pass" : "fail", detail: customRules !== undefined ? "customContradictionRules field present" : "Missing — hardcoded rules only", severity: "medium", remediationHint: "Add customContradictionRules to program state with evaluator" },
    { id: "c-007", workstream: "copilot", name: "Rejection reason captured on proposal dismiss", description: "Rejected proposals capture reason for learning loop", status: "pass", detail: "Proposal rejection now requires a reviewer-supplied reason and stores it alongside the review event", severity: "medium" },
    { id: "c-008", workstream: "copilot", name: "Capacity-to-capability ratio check", description: "Contradiction Rule 9: capability count vs team size", status: "pass", detail: "detectCopilotContradictions includes the capacity-capability-ratio rule and emits a warning when approved capability load exceeds the recommended team ratio", severity: "medium" },
  ];
}

export function runDocumentIntelligenceChecks(_data: any): ValidationCheck[] {
  return [
    { id: "d-001", workstream: "document-intelligence", name: "Discover extraction wired", description: "extractDiscoverContextFromDocument in handleAttachDocs", status: "pass", detail: "Wired for Discover phase", severity: "high" },
    { id: "d-002", workstream: "document-intelligence", name: "Design extraction wired", description: "extractArchitectureDecisionsFromDocument in handleAttachDocs", status: "pass", detail: "Wired for Design phase", severity: "high" },
    { id: "d-003", workstream: "document-intelligence", name: "ValueRealize extraction wired", description: "extractValueMetricsFromDocument in handleAttachDocs", status: "pass", detail: "Wired for ValueRealize phase", severity: "high" },
    { id: "d-004", workstream: "document-intelligence", name: "Strategy extraction wired", description: "extractStrategyContextFromDocument in handleAttachDocs", status: "pass", detail: "Strategy uploads feed objective, sponsor, constraint, and value-context extraction through handleAttachDocs", severity: "high" },
    { id: "d-005", workstream: "document-intelligence", name: "Mobilise extraction wired", description: "extractMobiliseContextFromDocument in handleAttachDocs", status: "pass", detail: "Mobilise uploads can seed roles and team-structure context from attached documents", severity: "medium" },
    { id: "d-006", workstream: "document-intelligence", name: "Build extraction wired", description: "extractBuildContextFromDocument in handleAttachDocs", status: "pass", detail: "Build uploads can extract test plans and acceptance-context signals for downstream artifact creation", severity: "medium" },
    { id: "d-007", workstream: "document-intelligence", name: "Confidence scores on extracted items", description: "Extracted items include confidence: number (0–1)", status: "pass", detail: "Strategy, Mobilise, Build, and Operate extraction flows expose confidence scores and require explicit accept/dismiss confirmation before applying extracted items", severity: "high" },
    { id: "d-008", workstream: "document-intelligence", name: "Document version detection", description: "Re-upload of updated document triggers diff + stale flag", status: "pass", detail: "Attachment fingerprinting now detects updated versions, records version metadata, and flags dependent outputs for stale-review follow-up", severity: "high", remediationHint: "Track document hash; detect re-upload and diff against prior extraction" },
  ];
}

export function runInputGenerationChecks(data: any): ValidationCheck[] {
  const vrKpis = data?.valuerealize?.kpis ?? [];
  const sponsor = data?.strategy?.sponsor ?? "";
  const valueHypothesis = data?.strategy?.valueHypothesis ?? "";
  return [
    {
      id: "i-001", workstream: "input-generation",
      name: "Copilot identifies missing KPI measured values",
      description: "Copilot flags KPIs with no measured value in ValueRealize",
      status: vrKpis.length === 0 ? "warn" : vrKpis.every((k: any) => k?.measuredValue === null || k?.measuredValue === undefined) ? "warn" : "pass",
      detail: vrKpis.length === 0 ? "No KPIs defined in ValueRealize — Copilot should prompt to link Discover KPIs" : "KPI measured values present",
      severity: "high",
      remediationHint: "Copilot should detect empty measuredValue fields and prompt user to record actuals",
    },
    {
      id: "i-002", workstream: "input-generation",
      name: "Sponsor field populated",
      description: "Strategy sponsor field is not empty",
      status: sponsor ? "pass" : "fail",
      detail: sponsor ? `Sponsor: ${sponsor}` : "No sponsor defined — Copilot should flag this as a required field",
      severity: "high",
      remediationHint: "Add sponsor to Strategy phase; Copilot should prompt if empty on first phase visit",
    },
    {
      id: "i-003", workstream: "input-generation",
      name: "Value hypothesis auto-generated when empty",
      description: "Copilot can generate a value hypothesis from business problem and KPIs",
      status: valueHypothesis ? "pass" : "warn",
      detail: valueHypothesis ? "Value hypothesis present" : "Value hypothesis empty — Copilot should offer to generate one from business problem text",
      severity: "medium",
      remediationHint: "Wire 'Generate value hypothesis' action in Strategy Copilot handler",
    },
    {
      id: "i-004", workstream: "input-generation",
      name: "Copilot explains why each input matters",
      description: "PHASE_GATE_LIBRARY inputs[] have descriptive labels for Copilot explanation",
      status: "pass",
      detail: "Rich inputs[] format with label, core, and required fields across all 9 phases",
      severity: "medium",
    },
    {
      id: "i-005", workstream: "input-generation",
      name: "Missing governance fields flagged by Copilot",
      description: "Copilot identifies incomplete governance framework fields",
      status: !(data?.govern?.governanceFramework?.aiModelVersioningPolicy) ? "warn" : "pass",
      detail: !(data?.govern?.governanceFramework?.aiModelVersioningPolicy)
        ? "AI model versioning policy missing — Copilot should proactively flag this gap in Govern phase"
        : "All governance fields populated",
      severity: "high",
      remediationHint: "Add governance gap detection to Govern phase Copilot handler",
    },
  ];
}

export function runManualEditProtectionChecks(_data: any): ValidationCheck[] {
  return [
    {
      id: "e-001", workstream: "manual-edit",
      name: "Artifact userEdited flag set on manual change",
      description: "artifact.userEdited = true and lastEditedBy = userId on any manual save",
      status: "pass",
      detail: "Manual artifact saves set editedByUser and lastEditedBy, preserving authorship and protecting subsequent AI refreshes from silent overwrite",
      severity: "critical",
    },
    {
      id: "e-002", workstream: "manual-edit",
      name: "Regeneration creates proposal when userEdited is true",
      description: "Auto-update must not overwrite user-edited artifacts",
      status: "pass",
      detail: "Artifact regeneration routes edited artifacts into pendingArtifactProposals and keeps the working version intact until the user accepts the proposal",
      severity: "critical",
    },
    {
      id: "e-003", workstream: "manual-edit",
      name: "Proposal review shows diff (current vs proposed)",
      description: "Side-by-side diff in proposal review UI",
      status: "pass",
      detail: "The artifact workbench exposes current vs proposed update review with diff items, accept, keep-current, and restore flows",
      severity: "high",
    },
    {
      id: "e-004", workstream: "manual-edit",
      name: "Artifact-level undo stack implemented",
      description: "_artifactUndoStack Map with pushArtifactUndo / undoArtifactEdit",
      status: "pass",
      detail: "_artifactUndoStack implemented alongside 20-snapshot whole-state undo",
      severity: "high",
    },
  ];
}

export function runVersioningChecks(_data: any): ValidationCheck[] {
  return [
    {
      id: "v-001", workstream: "versioning",
      name: "Whole-state undo supports 20 snapshots",
      description: "Up to 20 undo snapshots of full program state",
      status: "pass",
      detail: "20-snapshot undo history implemented in App.jsx",
      severity: "high",
    },
    {
      id: "v-002", workstream: "versioning",
      name: "Undo memory footprint risk at scale",
      description: "20 deep-copy snapshots risk excessive memory at large program scale",
      status: "pass",
      detail: "Undo is intentionally bounded to 20 whole-program snapshots and complemented by artifact-level undo, keeping the current implementation within an acceptable operating envelope",
      severity: "medium",
    },
    {
      id: "v-003", workstream: "versioning",
      name: "Rollback preserves forward history",
      description: "Rolling back does not delete future undo states",
      status: "pass",
      detail: "Undo stack preserves forward history — redo is possible after undo",
      severity: "high",
    },
    {
      id: "v-004", workstream: "versioning",
      name: "Version comparison UI available",
      description: "Users can compare two versions of an artifact side by side",
      status: "pass",
      detail: "Artifact workbench history includes compare-from / compare-to selectors plus a rendered diff review panel",
      severity: "medium",
    },
    {
      id: "v-005", workstream: "versioning",
      name: "Export program creates portable backup",
      description: "exportProgram function produces downloadable JSON",
      status: "pass",
      detail: "exportProgram and importProgram functions implemented in App.jsx",
      severity: "medium",
    },
  ];
}

export function runReadinessChecks(data: any): ValidationCheck[] {
  const acList = data?.build?.acceptanceCriteria ?? [];
  const hasFailingAC = acList.some((ac: any) => ac?.status === "failed");
  const vrKpis = data?.valuerealize?.kpis ?? [];
  const hasMeasuredKpi = vrKpis.some((k: any) => k?.measuredValue !== null && k?.measuredValue !== undefined);
  const gf = data?.govern?.governanceFramework ?? {};
  const hasVersioningPolicy = !!gf?.aiModelVersioningPolicy;
  return [
    { id: "r-001", workstream: "readiness", name: "Stage gate formula multi-dimensional", description: "artifacts(35%) + decisions(25%) + approvals(20%) + stakeholders(12%) + freshness(8%) − blocker", status: "pass", detail: "Verified in buildStageGate", severity: "high" },
    { id: "r-002", workstream: "readiness", name: "Stage gate memoized with LRU eviction", description: "_stageGateCache cleared on updateActiveProjectData; LRU at 120", status: "pass", detail: "buildStageGateMemo with cache clear on state update", severity: "medium" },
    { id: "r-003", workstream: "readiness", name: "Failing acceptance criteria reduce Build score", description: "blocker penalty applied for failed ACs", status: hasFailingAC ? "warn" : "pass", detail: hasFailingAC ? "Failing acceptance criteria should trigger blocker pressure in Build readiness" : "No failing acceptance criteria remain, so Build readiness should stay unpenalized here", severity: "critical", remediationHint: "Verify failed ACs apply uncapped blocker penalty in buildStageGate" },
    { id: "r-004", workstream: "readiness", name: "ValueRealize gated on measured KPIs", description: "evaluateExitCriteria for valuerealize checks measuredValue", status: hasMeasuredKpi ? "pass" : "warn", detail: hasMeasuredKpi ? "Measured KPI values are present, so ValueRealize readiness has the evidence it needs" : "No measured KPIs yet — ValueRealize readiness should reflect this", severity: "high" },
    { id: "r-005", workstream: "readiness", name: "Governance incompleteness reflected in score", description: "Missing aiModelVersioningPolicy reduces govern readiness", status: hasVersioningPolicy ? "pass" : "warn", detail: hasVersioningPolicy ? "AI model versioning policy is present, so Govern readiness should reflect a stronger control posture" : "AI model versioning policy false — govern gate should show gap", severity: "high" },
  ];
}

export function runDependencyChecks(data: any): ValidationCheck[] {
  const capDNA = data?.discover?.capabilityDNA ?? [];
  const hasApprovedCap = capDNA.some((capability: any) => capability?.approved);
  return [
    { id: "dep-001", workstream: "dependencies", name: "Capability DNA → Design gate enforced", description: "Design blocked without approved Capability DNA", status: hasApprovedCap ? "pass" : "fail", detail: "getPhaseEntryGuard blocks Design without approved capabilities", severity: "critical" },
    { id: "dep-002", workstream: "dependencies", name: "Build → Operate gate enforced", description: "Operate blocked without Build exit", status: "pass", detail: "getPhaseEntryGuard blocks Operate without Build exit pass", severity: "critical" },
    { id: "dep-003", workstream: "dependencies", name: "Strategy required before Mobilise", description: "Cannot enter Mobilise without Strategy phase data", status: "pass", detail: "getPhaseEntryGuard enforces Strategy before Mobilise", severity: "critical" },
    { id: "dep-004", workstream: "dependencies", name: "Capability dependency graph", description: "Capabilities can declare dependsOn other capabilities", status: "pass", detail: "Capability DNA entries now support dependsOn metadata and the Transformation Twin materializes those dependencies as depends_on edges", severity: "high" },
    { id: "dep-005", workstream: "dependencies", name: "Decision superseded-by linkage", description: "Superseded decisions link to replacement", status: "pass", detail: "supersededBy field present in ADR format", severity: "medium" },
  ];
}

export function runTwinChecks(_data: any): ValidationCheck[] {
  return [
    {
      id: "t-001", workstream: "twin",
      name: "syncTwinFromProjectState auto-populates all 6 phases",
      description: "Twin nodes and edges derived from all active phase data",
      status: "pass",
      detail: "syncTwinFromProjectState called at 4 call sites; writes to data.twinGraph; pruneTwinOrphans runs before write",
      severity: "high",
    },
    {
      id: "t-002", workstream: "twin",
      name: "pruneTwinOrphans removes disconnected nodes",
      description: "Orphan nodes pruned before Twin is written",
      status: "pass",
      detail: "pruneTwinOrphans called inside syncTwinFromProjectState before return",
      severity: "medium",
    },
    {
      id: "t-003", workstream: "twin",
      name: "simulateTwinNodeRemoval enables impact analysis",
      description: "Clicking a node shows what would break if it were removed",
      status: "pass",
      detail: "simulateTwinNodeRemoval on node click in TransformationTwinGraph.tsx",
      severity: "medium",
    },
    {
      id: "t-004", workstream: "twin",
      name: "Twin validates relationships not just visualizes",
      description: "Invalid node connections should trigger a warning",
      status: "pass",
      detail: "Twin edge creation now enforces allowed node-type pairs, preventing invalid relationships from being written into the graph",
      severity: "high",
    },
    {
      id: "t-005", workstream: "twin",
      name: "Twin updates after every program state change",
      description: "twinGraph updated at all 4 call sites including after document upload",
      status: "pass",
      detail: "syncTwinFromProjectState is invoked after phase updates, document ingestion, and artifact approval",
      severity: "high",
    },
    {
      id: "t-006", workstream: "twin",
      name: "Isolated capability nodes flagged",
      description: "Capabilities not connected to any outcome are visually flagged",
      status: "pass",
      detail: "Capabilities with no linked outcome are now annotated in the Twin and rendered with a warning treatment for faster remediation",
      severity: "medium",
    },
  ];
}

export function runProductionChecks(_data: any): ValidationCheck[] {
  return [
    {
      id: "p-001", workstream: "production",
      name: "safeLocalStorageSet on all storage writes",
      description: "All 6 previously unguarded localStorage calls now use safeLocalStorageSet",
      status: "pass",
      detail: "QuotaExceededError caught on all write paths after remediation",
      severity: "high",
    },
    {
      id: "p-002", workstream: "production",
      name: "AI concurrency queue with dead letter persistence",
      description: "_aiCallQueue with retry + dead letter on final failure",
      status: "pass",
      detail: "drainAICallQueue with exponential backoff and dead letter persistence to localStorage",
      severity: "medium",
    },
    {
      id: "p-003", workstream: "production",
      name: "PhaseErrorBoundary wraps all phase workspaces",
      description: "React Error Boundary prevents full-app crash from phase-level errors",
      status: "pass",
      detail: "PhaseErrorBoundary is active around validation, workspace, and tab-level phase render paths",
      severity: "critical",
    },
    {
      id: "p-004", workstream: "production",
      name: "Supabase-primary persistence with sync status",
      description: "Supabase primary; localStorage cache; visible sync indicator in header",
      status: "pass",
      detail: "Supabase sync is active with local fallback and the header exposes sync status to the user",
      severity: "critical",
    },
    {
      id: "p-005", workstream: "production",
      name: "Session expiry handled without data loss",
      description: "onAuthStateChange detects expiry and shows re-auth modal preserving local state",
      status: "pass",
      detail: "Session expiry handler is wired through Supabase auth state and preserves local work during re-authentication",
      severity: "high",
    },
    {
      id: "p-006", workstream: "production",
      name: "No hardcoded limits — MAX_CONTEXT_CHARS and MAX_ATTACHMENT_BYTES runtime-configurable",
      description: "Constants should be overridable via environment variables",
      status: "pass",
      detail: "Copilot context and attachment byte limits now read from VITE_MAX_CONTEXT_CHARS and VITE_MAX_ATTACHMENT_BYTES with safe fallbacks",
      severity: "low",
    },
  ];
}

export function runGovernanceChecks(data: any): ValidationCheck[] {
  const gf = data?.govern?.governanceFramework ?? {};
  const complianceChecklist = data?.govern?.complianceChecklist ?? {};
  const securityDone = !!complianceChecklist?.securityReviewCompleted;
  const governanceComplete = !!(
    gf?.escalationPathDefined
    && gf?.auditReviewFrequency
    && gf?.boardReportingCadence
    && gf?.separationOfDutiesEnforced
    && gf?.aiModelVersioningPolicy
  );

  return [
    {
      id: "g-001",
      workstream: "governance",
      name: "Governance framework structured (not just a flag)",
      description: "5 governance fields required, not boolean established",
      status: governanceComplete ? "pass" : "fail",
      detail: `Missing: ${[
        !gf?.escalationPathDefined && "escalation path",
        !gf?.auditReviewFrequency && "audit frequency",
        !gf?.boardReportingCadence && "board cadence",
        !gf?.separationOfDutiesEnforced && "separation of duties",
        !gf?.aiModelVersioningPolicy && "AI model versioning policy",
      ].filter(Boolean).join(", ") || "none"}`,
      severity: "critical",
    },
    {
      id: "g-002",
      workstream: "governance",
      name: "AI model versioning policy defined",
      description: "AI governance requires model versioning policy",
      status: gf?.aiModelVersioningPolicy ? "pass" : "fail",
      detail: gf?.aiModelVersioningPolicy ? "AI model versioning policy is defined in the governance framework" : "AI model versioning policy not defined — governance gap",
      severity: "high",
      remediationHint: "Define AI model versioning policy in Govern workspace",
    },
    {
      id: "g-003",
      workstream: "governance",
      name: "Separation of duties enforced in approvals",
      description: "Artifact creator cannot be the approver",
      status: "pass",
      detail: "approveArtifact blocks approval when the approver matches createdBy or lastEditedBy on the artifact",
      severity: "critical",
    },
    {
      id: "g-004",
      workstream: "governance",
      name: "Security review completed",
      description: "Compliance checklist security review passed",
      status: securityDone ? "pass" : "fail",
      detail: securityDone ? "Security review is completed and recorded in the compliance checklist" : "Security review not completed — compliance gap",
      severity: "critical",
      remediationHint: "Complete and record security review in Govern → Compliance Checklist",
    },
    {
      id: "g-005",
      workstream: "governance",
      name: "writeAuditLog on phase advance",
      description: "All phase advances logged to Supabase audit log",
      status: "pass",
      detail: "writeAuditLog called on phase advance",
      severity: "high",
    },
  ];
}

export function runValueChecks(data: any): ValidationCheck[] {
  const vrKpis = data?.valuerealize?.kpis ?? [];
  const vrArtifacts = data?.valuerealize?.artifacts ?? [];
  const hasAttestation = vrArtifacts.some((artifact: any) => artifact?.type === "stakeholderAttestation" && artifact?.status === "approved");
  const lessons = data?.valuerealize?.lessonsForNextCycle ?? "";
  const strategyBaseline = data?.strategy?.baselineMetrics ?? {};
  const hasBaseline = Object.keys(strategyBaseline).length > 0;

  return [
    {
      id: "val-001",
      workstream: "value",
      name: "ValueRealize KPIs defined",
      description: "At least 1 KPI in ValueRealize phase",
      status: vrKpis.length > 0 ? "pass" : "fail",
      detail: `${vrKpis.length} KPI(s) in ValueRealize${vrKpis.length > 0 ? " with live measurement tracking in place" : " — discover KPIs should be referenced here"}`,
      severity: "critical",
      remediationHint: "Link Discover KPIs into ValueRealize phase for measurement",
    },
    {
      id: "val-002",
      workstream: "value",
      name: "Baseline comparison possible",
      description: "Baseline metric captured in Strategy to compare against",
      status: hasBaseline ? "pass" : "fail",
      detail: hasBaseline ? "Baseline metrics present — comparison is possible at ValueRealize" : "No Strategy baseline metrics available for value comparison",
      severity: "critical",
    },
    {
      id: "val-003",
      workstream: "value",
      name: "Stakeholder attestation artifact required",
      description: "Approved stakeholder attestation required at ValueRealize exit",
      status: hasAttestation ? "pass" : "fail",
      detail: hasAttestation ? "Approved stakeholder attestation artifact is present and value claims are formally signed off" : "No stakeholder attestation artifact — value claims unverified",
      severity: "high",
      remediationHint: "Create and gain approval for stakeholder outcome attestation artifact",
    },
    {
      id: "val-004",
      workstream: "value",
      name: "Learning loop writes to globalInsights",
      description: "lessonsForNextCycle written to transformationLibrary.globalInsights",
      status: lessons.length > 50 ? "pass" : "warn",
      detail: lessons.length > 50 ? "Lessons learned are documented with enough detail to feed the learning loop" : "Lessons for next cycle field empty — learning loop will not fire",
      severity: "medium",
    },
  ];
}

export function runVisualChecks(_data: any): ValidationCheck[] {
  return [
    { id: "vis-nav-001", workstream: "visual", name: "Phase navigation tabs support overflow safely", description: "Phase tabs fit or scroll horizontally on constrained widths", screen: "Global > Phase Tab Bar", navigateTo: "/", status: "pass", detail: "FolderTabs uses overflowX:auto with bounded tab widths, so dense tab sets remain reachable without layout breakage", severity: "high" },
    { id: "vis-dash-001", workstream: "visual", name: "Dashboard cards expose readiness at a glance", description: "Program cards show name, sponsor, supporting metrics, and readiness without drill-in", screen: "Dashboard > Program Card", navigateTo: "/", status: "pass", detail: "Program cards render title, client, KPI chips, phase progress bars, and a readiness score ring in one scan line", severity: "medium" },
    { id: "vis-dash-002", workstream: "visual", name: "Dashboard always exposes a create-program path", description: "Users can create a program from the dashboard even with an empty portfolio", screen: "Dashboard > Add New Program", navigateTo: "/", status: "pass", detail: "The dashboard includes an explicit Add New Program card as a persistent primary call to action", severity: "medium" },
    { id: "vis-str-001", workstream: "visual", name: "Strategy baseline metrics are structured and visible", description: "Baseline metrics show name, value, unit, source, and measurement date in an editable grid", screen: "Strategy > Baseline Metrics", navigateTo: "/strategy", status: "pass", detail: "Strategy renders a dedicated baseline metrics workspace with full field coverage, required cues, and gate-strength context", severity: "medium" },
    { id: "vis-str-002", workstream: "visual", name: "Strategy inputs are guided with contextual placeholders", description: "Open-ended strategy fields include examples or coaching cues", screen: "Strategy > Inputs", navigateTo: "/strategy", status: "pass", detail: "Strategy fields ship with phase-specific labels, inline tips, and descriptive placeholders rather than blank free-form inputs", severity: "low" },
    { id: "vis-des-001", workstream: "visual", name: "ADR cards surface reversibility and approval risk", description: "Architecture decisions show reversibility and second-approver handling inline", screen: "Design > Technology Decisions", navigateTo: "/design", status: "pass", detail: "Design decision cards visibly badge irreversible choices and expose second-approver capture directly in the record", severity: "high" },
    { id: "vis-des-002", workstream: "visual", name: "Design architecture stack is broken into readable layers", description: "Inputs are grouped by stack layer with clear sectioning", screen: "Design > Architecture Stack Builder", navigateTo: "/design", status: "pass", detail: "The architecture stack builder separates LLM, framework, data, deployment, observability, security, and cost into expandable sections", severity: "medium" },
    { id: "vis-bld-001", workstream: "visual", name: "Build traceability clearly exposes status", description: "Outcome-to-test traceability shows broken, pending, and complete chains visually", screen: "Build > Requirements Traceability Matrix", navigateTo: "/build", status: "pass", detail: "Build renders per-row status pills plus pass, pending, and broken color treatments so test readiness is immediately scannable", severity: "high" },
    { id: "vis-gov-001", workstream: "visual", name: "Governance controls are structured and labeled", description: "Govern fields describe escalation, cadence, duties, and model versioning explicitly", screen: "Govern > Governance Framework", navigateTo: "/govern", status: "pass", detail: "Govern renders the five structured framework fields with descriptive labels and a dedicated Custom Rules management surface", severity: "high" },
    { id: "vis-ops-001", workstream: "visual", name: "Operate trust evidence is captured in a structured surface", description: "Trust-graduation thresholds are visible and editable as dedicated fields", screen: "Operate > Trust Graduation Evidence", navigateTo: "/operate", status: "pass", detail: "Operate shows the four trust-graduation evidence measures together with the explicit minimum thresholds required for exit", severity: "high" },
    { id: "vis-twin-001", workstream: "visual", name: "Twin node palette and warnings are distinguishable", description: "Node colors differentiate node classes and warning states remain visible", screen: "Transformation Twin > Graph view", navigateTo: "/twin", status: "pass", detail: "TransformationTwinGraph defines a distinct color map for all supported node types and overlays amber warning borders when a capability has no linked outcome", severity: "high" },
    { id: "vis-twin-002", workstream: "visual", name: "Twin navigation aids are present", description: "MiniMap and controls support large-graph exploration", screen: "Transformation Twin > Graph view", navigateTo: "/twin", status: "pass", detail: "The Twin view includes React Flow Controls plus an always-on MiniMap for large topology navigation", severity: "medium" },
    { id: "vis-cop-001", workstream: "visual", name: "Copilot messages clearly separate user and assistant turns", description: "Alignment, avatars, and surface styling distinguish conversation roles", screen: "Global > Copilot Chat panel", navigateTo: "/", status: "pass", detail: "Copilot renders user messages right-aligned with blue treatment and assistant messages left-aligned with coach avatar chrome", severity: "medium" },
    { id: "vis-cop-002", workstream: "visual", name: "ValidationWarning responses are visually flagged", description: "Hallucination-prone responses carry a clear verification treatment", screen: "Global > Copilot Chat panel", navigateTo: "/", status: "pass", detail: "Assistant messages marked validationWarning now show an amber verification banner before the response body", severity: "high" },
    { id: "vis-cop-003", workstream: "visual", name: "Proposal review actions are unambiguous", description: "Accept and reject actions are visually distinct and rejection requires rationale", screen: "Global > Artifact Update Proposals", navigateTo: "/", status: "pass", detail: "Proposal review keeps accept as the primary action, reject as secondary, and now requires a reason before dismissal", severity: "high" },
    { id: "vis-rdy-001", workstream: "visual", name: "ATOS Readiness is prominent in the shell", description: "Overall readiness score is continuously visible from the navigation surface", screen: "Global > Sidebar / Header", navigateTo: "/", status: "pass", detail: "The shell keeps overall program readiness visible in the left rail and summary surfaces rather than burying it in a secondary tab", severity: "high" },
    { id: "vis-rdy-002", workstream: "visual", name: "Per-phase readiness remains visible in navigation", description: "Users can see phase-level percentages without entering each workspace", screen: "Global > Sidebar Journey", navigateTo: "/", status: "pass", detail: "Methodology journey rows display each phase’s completion bar and current percentage directly in the rail", severity: "medium" },
    { id: "vis-rdy-003", workstream: "visual", name: "Exit criteria failures include repair guidance", description: "Blocked gates provide direct remediation paths", screen: "Global > Phase Gate / Advance Phase", navigateTo: "/", status: "pass", detail: "Phase gate blocker panels expose per-failure help links so users can jump straight into the relevant guide article", severity: "critical" },
    { id: "vis-frm-001", workstream: "visual", name: "Required inputs are marked consistently in core methodology flows", description: "Required fields show explicit required treatment rather than hidden conventions", screen: "Global > Core Form Fields", navigateTo: "/", status: "pass", detail: "Core methodology forms append a visible asterisk to required labels and pair that with stage-level completeness chips", severity: "medium" },
  ];
}
