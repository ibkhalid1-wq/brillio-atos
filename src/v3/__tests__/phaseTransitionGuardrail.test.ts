import { describe, it, expect } from "vitest";
import { sanitizePlannerProposal, isArtifactLikeLabel, isRosterOwnerLabel } from "@/v3/lib/dynamicSchema";

const ARTIFACT_WORDS = [
  "plan", "summary", "report", "register", "map", "model", "deck",
  "brief", "pack", "roadmap", "assessment", "design", "artifact",
];

describe("isArtifactLikeLabel", () => {
  it("flags labels whose words name a deliverable", () => {
    expect(isArtifactLikeLabel("Mobilization Plan")).toBe(true);
    expect(isArtifactLikeLabel("Stakeholder Map")).toBe(true);
    expect(isArtifactLikeLabel("Risk Register")).toBe(true);
    expect(isArtifactLikeLabel("Executive Brief")).toBe(true);
    expect(isArtifactLikeLabel("Governance Model")).toBe(true);
  });

  it("does not flag atomic fact labels", () => {
    expect(isArtifactLikeLabel("Mobilization start date")).toBe(false);
    expect(isArtifactLikeLabel("Core team members")).toBe(false);
    expect(isArtifactLikeLabel("Workstream owners")).toBe(false);
    expect(isArtifactLikeLabel("Steering committee cadence")).toBe(false);
    expect(isArtifactLikeLabel("Mobilization budget range")).toBe(false);
    expect(isArtifactLikeLabel("Confirmed delivery lead")).toBe(false);
  });
});

describe("isRosterOwnerLabel", () => {
  it("flags 'Named <role>' owner assignments", () => {
    expect(isRosterOwnerLabel("Named Engineering Lead / Architect for Design phase")).toBe(true);
    expect(isRosterOwnerLabel("Named Change Management Lead for Design phase")).toBe(true);
    expect(isRosterOwnerLabel("Named QA/Test Lead for Design phase")).toBe(true);
    expect(isRosterOwnerLabel("Named owner for critical path definition")).toBe(true);
    expect(isRosterOwnerLabel("Named Solution Architect")).toBe(true);
  });

  it("does not flag atomic facts or non-prefixed role mentions", () => {
    expect(isRosterOwnerLabel("Target date for solution design approval")).toBe(false);
    expect(isRosterOwnerLabel("Workstream owners")).toBe(false);
    expect(isRosterOwnerLabel("Confirmed delivery lead")).toBe(false);
    expect(isRosterOwnerLabel("Solution approach & design principles")).toBe(false);
    expect(isRosterOwnerLabel("Named product")).toBe(false);
  });
});

describe("Phase Transition Planner guardrail — roster-owner fields dropped", () => {
  const result = sanitizePlannerProposal({
    nextPhase: { readiness: "yellow", rationale: "design facts still unknown", purpose: "produce the solution design" },
    inputFields: [
      { fieldId: "solutionApproach", label: "Solution approach", type: "textarea", required: true },
      { fieldId: "designApprovalDate", label: "Target date for solution design approval", type: "date", required: false },
      { fieldId: "engLead", label: "Named Engineering Lead / Architect for Design phase", type: "text", required: true },
      { fieldId: "qaLead", label: "Named QA/Test Lead for Design phase", type: "text", required: true },
      { fieldId: "critPathOwner", label: "Named owner for critical path definition", type: "text", required: true },
    ],
    artifactsToGenerate: [],
  });

  it("keeps only the atomic facts, dropping every roster-owner field", () => {
    expect(result).not.toBeNull();
    expect(result!.inputFields.map((f) => f.label)).toEqual([
      "Solution approach",
      "Target date for solution design approval",
    ]);
  });

  it("records a guardrail warning for each dropped roster-owner field", () => {
    const warnings = (result!.planMeta.warnings ?? []).filter((w) => w.includes("Dropped roster-owner input"));
    expect(warnings.length).toBe(3);
  });
});

/**
 * Golden scenario from the orchestration spec: Strategy complete → Mobilize.
 * A misbehaving planner returns several artifact-like labels as input fields.
 * The deterministic guardrail must demote every one of them into
 * artifactsToGenerate, leaving only atomic facts as inputs.
 */
describe("Phase Transition Planner guardrail — Strategy → Mobilize", () => {
  const plannerOutput = {
    nextPhase: { readiness: "yellow", rationale: "core team and cadence still unknown", purpose: "stand up the programme" },
    inputFields: [
      // Atomic facts — should survive as inputs.
      { fieldId: "mobilizationStartDate", label: "Mobilization start date", type: "date", required: true },
      { fieldId: "coreTeamMembers", label: "Core team members", type: "textarea", required: true },
      { fieldId: "workstreamOwners", label: "Workstream owners", type: "textarea", required: true },
      { fieldId: "steeringCadence", label: "Steering committee cadence", type: "text", required: false },
      { fieldId: "mobilizationBudget", label: "Mobilization budget range", type: "text", required: false },
      { fieldId: "deliveryLead", label: "Confirmed delivery lead", type: "text", required: true },
      // Deliverables wrongly sent as inputs — must be demoted.
      { fieldId: "mobilizationPlan", label: "Mobilization Plan", type: "textarea", required: true },
      { fieldId: "stakeholderMap", label: "Stakeholder Map", type: "textarea", required: true },
      { fieldId: "governancePlan", label: "Governance Plan", type: "textarea", required: true },
      { fieldId: "riskRegister", label: "Risk Register", type: "textarea", required: true },
      { fieldId: "executiveBrief", label: "Executive Brief", type: "textarea", required: true },
    ],
    artifactsToGenerate: [
      { artifactId: "mobilization-plan", artifactName: "Mobilization Plan", artifactPurpose: "sequence the standup", requiredInputs: ["mobilizationStartDate", "coreTeamMembers"] },
    ],
  };

  const result = sanitizePlannerProposal(plannerOutput);

  it("returns a usable proposal", () => {
    expect(result).not.toBeNull();
  });

  it("keeps only atomic facts as input fields", () => {
    const labels = result!.inputFields.map((f) => f.label);
    expect(labels).toEqual([
      "Mobilization start date",
      "Core team members",
      "Workstream owners",
      "Steering committee cadence",
      "Mobilization budget range",
      "Confirmed delivery lead",
    ]);
  });

  it("never leaves an artifact-like label in input fields", () => {
    for (const f of result!.inputFields) {
      expect(isArtifactLikeLabel(f.label)).toBe(false);
    }
  });

  it("routes every demoted deliverable into artifactsToGenerate", () => {
    const artifactLabels = result!.artifacts.map((a) => a.label);
    for (const name of ["Mobilization Plan", "Stakeholder Map", "Governance Plan", "Risk Register", "Executive Brief"]) {
      expect(artifactLabels).toContain(name);
    }
  });

  it("does not duplicate an artifact the planner already declared", () => {
    const mobPlans = result!.artifacts.filter((a) => a.label === "Mobilization Plan");
    expect(mobPlans).toHaveLength(1);
  });

  it("records a guardrail warning for each demotion", () => {
    const warnings = result!.planMeta.warnings ?? [];
    expect(warnings.length).toBe(5);
    expect(warnings.every((w) => w.includes("Demoted artifact-like input"))).toBe(true);
  });

  it("each artifact word is individually caught", () => {
    for (const word of ARTIFACT_WORDS) {
      expect(isArtifactLikeLabel(`Programme ${word}`)).toBe(true);
    }
  });
});
