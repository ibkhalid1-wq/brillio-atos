import { SANITY_SEED_PROGRAM } from "./adamSanitySeed.ts";

export type SanityStatus = "pass" | "fail" | "warn";

export interface SanityCheck {
  id: string;
  phase: string;
  gate: string;
  description: string;
  status: SanityStatus;
  expected: string;
  actual: string;
  fix?: string;
}

export interface PhaseResult {
  phase: string;
  label: string;
  icon: string;
  checks: SanityCheck[];
  passed: boolean;
  canAdvance: boolean;
}

function checkStrategy(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const baselineMetrics = d.strategy?.baselineMetrics ?? {};
  return [
    {
      id: "s-001",
      phase: "strategy",
      gate: "Business problem defined",
      description: "businessProblem field is not empty",
      status: d.strategy?.businessProblem ? "pass" : "fail",
      expected: "Non-empty string",
      actual: d.strategy?.businessProblem ? "✓ Present" : "✗ Empty",
      fix: "Fill in Strategy → Business Problem field",
    },
    {
      id: "s-002",
      phase: "strategy",
      gate: "Desired outcome defined",
      description: "desiredOutcome field is not empty",
      status: d.strategy?.desiredOutcome ? "pass" : "fail",
      expected: "Non-empty string",
      actual: d.strategy?.desiredOutcome ? "✓ Present" : "✗ Empty",
      fix: "Fill in Strategy → Desired Outcome field",
    },
    {
      id: "s-003",
      phase: "strategy",
      gate: "Sponsor identified",
      description: "sponsor field is not empty",
      status: d.strategy?.sponsor ? "pass" : "fail",
      expected: "Non-empty string",
      actual: d.strategy?.sponsor ? `✓ ${d.strategy.sponsor}` : "✗ Empty",
      fix: "Add a sponsor in Strategy → Sponsor",
    },
    {
      id: "s-004",
      phase: "strategy",
      gate: "Value hypothesis documented",
      description: "valueHypothesis field is not empty",
      status: d.strategy?.valueHypothesis ? "pass" : "fail",
      expected: "Non-empty string",
      actual: d.strategy?.valueHypothesis ? "✓ Present" : "✗ Empty",
      fix: "Document value hypothesis in Strategy",
    },
    {
      id: "s-005",
      phase: "strategy",
      gate: "Baseline metric captured",
      description: "At least 1 entry in baselineMetrics",
      status: Object.keys(baselineMetrics).length > 0 ? "pass" : "fail",
      expected: "≥ 1 baseline metric",
      actual: `${Object.keys(baselineMetrics).length} metric(s)`,
      fix: "Add at least one baseline metric in Strategy → Baseline Metrics",
    },
  ];
}

function checkMobilise(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const roles = d.mobilise?.deliveryRoles ?? [];
  const raci = d.mobilise?.raci ?? {};
  const hasAccountable = Object.values(raci).every((row: any) => row?.accountable);
  return [
    {
      id: "m-001",
      phase: "mobilise",
      gate: "Delivery roles defined",
      description: "At least 3 delivery roles in the team",
      status: roles.length >= 3 ? "pass" : "fail",
      expected: "≥ 3 roles",
      actual: `${roles.length} role(s)`,
      fix: "Add team members in Mobilise → Team Roster",
    },
    {
      id: "m-002",
      phase: "mobilise",
      gate: "RACI accountable defined",
      description: "Every capability has an Accountable role in RACI",
      status: hasAccountable ? "pass" : "fail",
      expected: "Accountable assigned for all capabilities",
      actual: hasAccountable ? "✓ All accountable roles set" : "✗ Missing accountable role",
      fix: "Assign Accountable role in Mobilise → RACI",
    },
    {
      id: "m-003",
      phase: "mobilise",
      gate: "No ML Engineer required (L2 capability)",
      description: "L2 capability does not require ML Engineer — team of 3 is valid",
      status: "pass",
      expected: "L2 autonomy — ML Engineer not required",
      actual: "✓ No L3/L4 capabilities — constraint does not apply",
    },
    {
      id: "m-004",
      phase: "mobilise",
      gate: "Governance model documented",
      description: "Escalation path and review cadence defined",
      status: d.mobilise?.governanceModel?.escalationPath ? "pass" : "fail",
      expected: "Escalation path defined",
      actual: d.mobilise?.governanceModel?.escalationPath ? "✓ Defined" : "✗ Missing",
      fix: "Define escalation path in Mobilise → Governance Model",
    },
  ];
}

function checkDiscover(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const capabilities = d.discover?.capabilityDNA ?? [];
  const approvedCapabilities = capabilities.filter((capability: any) => capability?.approved);
  const l3Plus = capabilities.filter((capability: any) => (capability?.autonomyLevel ?? 0) >= 3);
  const hitlMissing = l3Plus.filter((capability: any) => !capability?.hitlPolicy);
  const kpis = d.discover?.kpis ?? [];
  return [
    {
      id: "d-001",
      phase: "discover",
      gate: "At least 1 capability approved",
      description: "Minimum 1 capability in Capability DNA with approved: true",
      status: approvedCapabilities.length > 0 ? "pass" : "fail",
      expected: "≥ 1 approved capability",
      actual: `${approvedCapabilities.length} approved`,
      fix: "Approve at least one capability in Discover → Capability DNA",
    },
    {
      id: "d-002",
      phase: "discover",
      gate: "HITL policy on all L3+ capabilities",
      description: "All L3/L4 capabilities must have hitlPolicy defined",
      status: hitlMissing.length === 0 ? "pass" : "fail",
      expected: "HITL policy on all L3/L4",
      actual: hitlMissing.length === 0 ? "✓ No L3/L4 without HITL (this program is L2)" : `✗ ${hitlMissing.length} missing HITL policy`,
      fix: "Add HITL policy to L3/L4 capabilities",
    },
    {
      id: "d-003",
      phase: "discover",
      gate: "At least 1 KPI defined",
      description: "Minimum 1 KPI in discover.kpis",
      status: kpis.length > 0 ? "pass" : "fail",
      expected: "≥ 1 KPI",
      actual: `${kpis.length} KPI(s)`,
      fix: "Add at least one KPI in Discover → KPIs",
    },
    {
      id: "d-004",
      phase: "discover",
      gate: "Opportunity assessment completed",
      description: "opportunityAssessment.recommendation is set",
      status: d.discover?.opportunityAssessment?.recommendation ? "pass" : "fail",
      expected: "Recommendation set",
      actual: d.discover?.opportunityAssessment?.recommendation ? `✓ ${d.discover.opportunityAssessment.recommendation}` : "✗ Missing",
      fix: "Complete Discover → Opportunity Assessment",
    },
  ];
}

function checkDesign(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const decisions = d.design?.architectureDecisions ?? [];
  const validDecisions = decisions.filter((decision: any) => decision?.decisionMaker && decision?.alternatives && decision?.constraints && decision?.reversibility);
  const skills = d.design?.skillCatalog ?? [];
  const blueprint = d.design?.agentBlueprint;
  return [
    {
      id: "des-001",
      phase: "design",
      gate: "Architecture decision recorded in ADR format",
      description: "At least 1 decision with decisionMaker, alternatives, constraints, reversibility",
      status: validDecisions.length > 0 ? "pass" : "fail",
      expected: "≥ 1 complete ADR",
      actual: `${validDecisions.length} complete ADR(s) of ${decisions.length} total`,
      fix: "Record at least one architecture decision with full ADR fields",
    },
    {
      id: "des-002",
      phase: "design",
      gate: "Agent Blueprint completed",
      description: "agentBlueprint has name, inputs, outputs, tools, guardrails",
      status: blueprint?.agentName && blueprint?.inputs?.length && blueprint?.outputs?.length ? "pass" : "fail",
      expected: "Blueprint with name, inputs, outputs, tools, guardrails",
      actual: blueprint ? "✓ Blueprint present" : "✗ Blueprint missing",
      fix: "Complete Agent Blueprint in Design",
    },
    {
      id: "des-003",
      phase: "design",
      gate: "Skill catalog has at least 1 skill",
      description: "design.skillCatalog.length ≥ 1",
      status: skills.length >= 1 ? "pass" : "fail",
      expected: "≥ 1 skill",
      actual: `${skills.length} skill(s)`,
      fix: "Add at least one skill in Design → Skill Catalog",
    },
  ];
}

function checkBuild(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const criteria = d.build?.acceptanceCriteria ?? [];
  const failing = criteria.filter((criterion: any) => criterion?.status === "failed");
  const checklist = d.build?.deploymentChecklist ?? {};
  const securityPassed = !!(checklist as any).securityReviewPassed;
  return [
    {
      id: "b-001",
      phase: "build",
      gate: "All acceptance criteria passing",
      description: "No acceptance criteria with status: failed",
      status: failing.length === 0 ? "pass" : "fail",
      expected: "0 failing criteria",
      actual: failing.length === 0 ? `✓ All ${criteria.length} criteria passing` : `✗ ${failing.length} failing`,
      fix: "Resolve failing acceptance criteria before advancing to Operate",
    },
    {
      id: "b-002",
      phase: "build",
      gate: "Security review passed",
      description: "deploymentChecklist.securityReviewPassed is true",
      status: securityPassed ? "pass" : "fail",
      expected: "securityReviewPassed: true",
      actual: securityPassed ? "✓ Security review passed" : "✗ Security review not passed",
      fix: "Complete security review and mark in Deployment Checklist",
    },
    {
      id: "b-003",
      phase: "build",
      gate: "Test plan recorded",
      description: "testPlan.totalCases > 0",
      status: (d.build?.testPlan?.totalCases ?? 0) > 0 ? "pass" : "fail",
      expected: "At least 1 test case recorded",
      actual: `${d.build?.testPlan?.totalCases ?? 0} test cases`,
      fix: "Record test execution results in Build → Test Plan",
    },
  ];
}

function checkGovern(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const governanceFramework = d.govern?.governanceFramework ?? {};
  const compliance = d.govern?.complianceChecklist ?? {};
  const risks = d.govern?.riskRegister ?? [];
  const governanceGaps = [
    !(governanceFramework as any).escalationPathDefined && "escalation path",
    !(governanceFramework as any).auditReviewFrequency && "audit frequency",
    !(governanceFramework as any).boardReportingCadence && "board cadence",
    !(governanceFramework as any).separationOfDutiesEnforced && "separation of duties",
    !(governanceFramework as any).aiModelVersioningPolicy && "AI model versioning policy",
  ].filter(Boolean);
  return [
    {
      id: "g-001",
      phase: "govern",
      gate: "Governance framework complete",
      description: "All 5 governance framework fields populated",
      status: governanceGaps.length === 0 ? "pass" : "fail",
      expected: "All 5 fields set",
      actual: governanceGaps.length === 0 ? "✓ All 5 fields complete" : `✗ Missing: ${governanceGaps.join(", ")}`,
      fix: "Complete all 5 governance framework fields in Govern",
    },
    {
      id: "g-002",
      phase: "govern",
      gate: "Risk register has at least 1 risk",
      description: "riskRegister.length ≥ 1",
      status: risks.length >= 1 ? "pass" : "fail",
      expected: "≥ 1 risk documented",
      actual: `${risks.length} risk(s)`,
      fix: "Add at least one risk to the Risk Register in Govern",
    },
    {
      id: "g-003",
      phase: "govern",
      gate: "Compliance checklist complete",
      description: "All compliance items checked",
      status: (compliance as any).securityReviewCompleted && (compliance as any).gdprAssessed ? "pass" : "fail",
      expected: "Security review and GDPR assessed",
      actual: (compliance as any).securityReviewCompleted ? "✓ Security review complete" : "✗ Security review missing",
      fix: "Complete all items in Govern → Compliance Checklist",
    },
  ];
}

function checkOperate(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const trustEvidence = d.operate?.trustGraduationEvidence ?? {};
  const runbook = d.operate?.runbookItems ?? [];
  const evidence = trustEvidence as any;
  const evidencePass = (evidence.testCasesPassed ?? 0) >= 10
    && (evidence.userValidationCount ?? 0) >= 3
    && (evidence.monitoredHours ?? 0) >= 24
    && (evidence.hitlComplianceRate ?? 0) >= 0.95;
  return [
    {
      id: "o-001",
      phase: "operate",
      gate: "Trust graduation evidence meets thresholds",
      description: "testCasesPassed ≥ 10, userValidationCount ≥ 3, monitoredHours ≥ 24, hitlComplianceRate ≥ 0.95",
      status: evidencePass ? "pass" : "fail",
      expected: "All 4 thresholds met",
      actual: `Tests: ${evidence.testCasesPassed ?? 0}/10, Users: ${evidence.userValidationCount ?? 0}/3, Hours: ${evidence.monitoredHours ?? 0}/24, HITL: ${((evidence.hitlComplianceRate ?? 0) * 100).toFixed(0)}%/95%`,
      fix: "Record trust graduation evidence meeting all 4 minimum thresholds",
    },
    {
      id: "o-002",
      phase: "operate",
      gate: "Runbook has at least 2 scenarios",
      description: "operationalRunbook has at least 2 failure scenarios",
      status: runbook.length >= 2 ? "pass" : "fail",
      expected: "≥ 2 runbook scenarios",
      actual: `${runbook.length} scenario(s)`,
      fix: "Add at least 2 failure scenarios to the Operate runbook",
    },
  ];
}

function checkValueRealize(d: typeof SANITY_SEED_PROGRAM): SanityCheck[] {
  const kpis = d.valuerealize?.kpis ?? [];
  const measured = kpis.filter((kpi: any) => kpi?.measuredValue !== null && kpi?.measuredValue !== undefined);
  const lessons = d.valuerealize?.lessonsForNextCycle ?? "";
  const artifacts = d.valuerealize?.artifacts ?? [];
  const hasAttestation = artifacts.some((artifact: any) => artifact?.type === "stakeholderAttestation" && artifact?.status === "approved");
  const baselinePresent = Object.keys(d.strategy?.baselineMetrics ?? {}).length > 0;
  return [
    {
      id: "vr-001",
      phase: "valuerealize",
      gate: "At least 1 KPI has measured value",
      description: "measuredValue field populated on at least 1 KPI",
      status: measured.length > 0 ? "pass" : "fail",
      expected: "≥ 1 KPI with measuredValue",
      actual: `${measured.length} measured KPI(s)`,
      fix: "Record actual measured values in ValueRealize → KPIs",
    },
    {
      id: "vr-002",
      phase: "valuerealize",
      gate: "Baseline comparison possible",
      description: "strategy.baselineMetrics is not empty",
      status: baselinePresent ? "pass" : "fail",
      expected: "Baseline captured in Strategy",
      actual: baselinePresent ? "✓ Baseline present" : "✗ No baseline — delta cannot be calculated",
      fix: "Capture baseline metrics in Strategy phase",
    },
    {
      id: "vr-003",
      phase: "valuerealize",
      gate: "Stakeholder attestation approved",
      description: "Approved stakeholder attestation artifact present",
      status: hasAttestation ? "pass" : "fail",
      expected: "Approved attestation artifact",
      actual: hasAttestation ? "✓ Attestation approved" : "✗ No approved attestation",
      fix: "Create and gain approval for Stakeholder Outcome Attestation artifact",
    },
    {
      id: "vr-004",
      phase: "valuerealize",
      gate: "Lessons learned documented",
      description: "lessonsForNextCycle length ≥ 50 characters",
      status: lessons.length >= 50 ? "pass" : "fail",
      expected: "≥ 50 characters",
      actual: `${lessons.length} characters`,
      fix: "Document lessons learned in ValueRealize",
    },
  ];
}

const PHASE_RUNNERS: Array<{
  id: string;
  label: string;
  icon: string;
  fn: (d: typeof SANITY_SEED_PROGRAM) => SanityCheck[];
}> = [
  { id: "strategy", label: "Strategy", icon: "🎯", fn: checkStrategy },
  { id: "mobilise", label: "Mobilise", icon: "👥", fn: checkMobilise },
  { id: "discover", label: "Discover", icon: "🔍", fn: checkDiscover },
  { id: "design", label: "Design", icon: "🏗️", fn: checkDesign },
  { id: "build", label: "Build", icon: "🔨", fn: checkBuild },
  { id: "govern", label: "Govern", icon: "🏛️", fn: checkGovern },
  { id: "operate", label: "Operate", icon: "⚙️", fn: checkOperate },
  { id: "valuerealize", label: "Value Realize", icon: "💰", fn: checkValueRealize },
];

export function runSanityTest(): PhaseResult[] {
  const data = SANITY_SEED_PROGRAM;
  let previousPhasesPassed = true;

  return PHASE_RUNNERS.map((runner) => {
    let checks: SanityCheck[] = [];
    try {
      checks = runner.fn(data);
    } catch (err) {
      checks = [{
        id: `${runner.id}-error`,
        phase: runner.id,
        gate: "Runner error",
        description: "An error occurred running this phase check",
        status: "fail",
        expected: "No error",
        actual: err instanceof Error ? err.message : String(err),
        fix: "Check browser console for stack trace",
      }];
    }

    const allPass = checks.every((check) => check.status === "pass");
    const canAdvance = previousPhasesPassed && allPass;
    if (!allPass) previousPhasesPassed = false;

    return {
      phase: runner.id,
      label: runner.label,
      icon: runner.icon,
      checks,
      passed: allPass,
      canAdvance,
    };
  });
}

export function getSanityVerdict(results: PhaseResult[]) {
  const allChecks = results.flatMap((result) => result.checks);
  const passed = allChecks.filter((check) => check.status === "pass").length;
  const failed = allChecks.filter((check) => check.status === "fail").length;
  const totalChecks = allChecks.length;
  const allPhasesPassed = results.every((result) => result.passed);
  const blockedPhase = results.find((result) => !result.passed);

  return {
    label: allPhasesPassed ? "END-TO-END PASS" : "BLOCKED",
    color: allPhasesPassed ? "#16A34A" : "#DC2626",
    background: allPhasesPassed ? "#F0FDF4" : "#FEF2F2",
    border: allPhasesPassed ? "#BBF7D0" : "#FECACA",
    description: allPhasesPassed
      ? `All ${totalChecks} methodology gates passed. Program can advance from Strategy through Value Realize.`
      : `Blocked at ${blockedPhase?.label ?? "unknown"} phase. ${failed} gate(s) failing.`,
    totalChecks,
    passed,
    failed,
  };
}
