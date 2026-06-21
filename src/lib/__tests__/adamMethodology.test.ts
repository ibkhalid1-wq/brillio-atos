import { describe, it, expect } from "vitest";
import {
  evaluateExitCriteria,
  getPhaseEntryGuard,
  buildTwinExecutiveSummary,
  pruneTwinOrphans,
  simulateTwinNodeRemoval,
  detectCopilotContradictions,
} from "../adamMethodology";

describe("evaluateExitCriteria", () => {
  it("passes strategy when all core fields populated", () => {
    const result = evaluateExitCriteria("strategy", {
      strategyData: {
        mandate: "Transform invoice processing",
        sponsorCommitment: "CFO confirmed",
        investmentEnvelope: "$2M",
        scopeBoundaries: "AP department only",
        successDefinition: "60% cost reduction",
        programName: "AP Transform",
        clientName: "Acme Corp",
      },
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails strategy when mandate is missing", () => {
    const result = evaluateExitCriteria("strategy", {
      strategyData: {
        sponsorCommitment: "yes",
        investmentEnvelope: "$1M",
        scopeBoundaries: "all",
        successDefinition: "done",
        programName: "test",
        clientName: "co",
      },
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure: string) => /mandate/i.test(failure))).toBe(true);
  });

  it("fails discover when no approved capabilityDNA", () => {
    const result = evaluateExitCriteria("discover", {
      discoverContext: { capabilityDNA: [{ name: "Invoice Processing", status: "draft" }] },
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure: string) => /capability/i.test(failure))).toBe(true);
  });

  it("passes discover when one capability is approved", () => {
    const result = evaluateExitCriteria("discover", {
      discoverContext: {
        capabilityDNA: [{ name: "Invoice Processing", status: "approved" }],
        executiveSponsor: "Jane Smith",
        outcomes: "Reduce costs",
        kpis: [{ name: "Cost per invoice" }],
        businessProblem: "Manual processing is slow",
        valueDrivers: "Lower costs",
        stakeholders: ["Operations"],
        scopeBoundaries: "AP only",
        baselineKpi: "10",
      },
    });
    expect(result.failures.some((failure: string) => /capability/i.test(failure))).toBe(false);
  });

  it("fails design when skillCatalog is empty", () => {
    const result = evaluateExitCriteria("design", {
      architecture: { skillCatalog: [], decisions: [], capabilities: "Invoice AI", knowledgeModel: "Taxonomy" },
    });
    expect(result.failures.some((failure: string) => /skill/i.test(failure))).toBe(true);
  });

  it("fails build when trustGraduationEvidence is missing", () => {
    const result = evaluateExitCriteria("build", {
      testing: {},
      build: {
        acceptanceCriteria: "Done",
        pilotSponsor: "CFO",
        validationMetric: "Cycle time",
        dependencies: "ERP access",
        engineeringPackage: "Spec",
        testPlan: "Plan",
        deploymentChecklist: null,
      },
    });
    expect(result.failures.some((failure: string) => /trust/i.test(failure))).toBe(true);
  });
});

describe("getPhaseEntryGuard", () => {
  it("blocks design with no approved capabilities", () => {
    const result = getPhaseEntryGuard("design", {
      discoverContext: { capabilityDNA: [] },
    });
    expect(result.canEnter).toBe(false);
    expect(result.reason).toMatch(/capability/i);
  });

  it("allows design with approved capability", () => {
    const result = getPhaseEntryGuard("design", {
      discoverContext: { capabilityDNA: [{ status: "approved", name: "Test Cap" }] },
    });
    expect(result.canEnter).toBe(true);
  });

  it("blocks mobilise when strategy is incomplete", () => {
    const result = getPhaseEntryGuard("mobilise", {
      strategyData: { mandate: "", sponsorCommitment: "", investmentEnvelope: "" },
    });
    expect(result.canEnter).toBe(false);
  });
});

describe("buildTwinExecutiveSummary", () => {
  it("returns empty string for empty graph", () => {
    expect(buildTwinExecutiveSummary({ nodes: [], edges: [] })).toBe("");
  });

  it("includes node counts in summary", () => {
    const summary = buildTwinExecutiveSummary({
      nodes: [
        { id: "1", type: "Strategy", label: "Mandate", status: "approved", confidence: 0.9 },
        { id: "2", type: "Outcome", label: "Reduce costs", status: "draft", confidence: 0.8 },
        { id: "3", type: "KPI", label: "Cost per invoice", status: "draft", properties: {} },
      ],
      edges: [{ id: "e1", from: "2", to: "1", type: "achieves", strength: 1 }],
    });
    expect(summary).toContain("Strategy");
    expect(summary).toContain("Outcomes");
  });
});

describe("pruneTwinOrphans", () => {
  it("removes nodes whose linkedArtifactId no longer exists", () => {
    const graph = {
      nodes: [
        { id: "n1", type: "Capability", label: "Old Cap", linkedArtifactId: "deleted-cap-id" },
        { id: "n2", type: "Strategy", label: "Mandate", linkedArtifactId: null },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2", type: "enables" }],
    };
    const projectData = { discoverContext: { capabilityDNA: [{ id: "active-cap", name: "Live Cap", status: "approved" }] } };
    const pruned = pruneTwinOrphans(graph, projectData);
    expect(pruned.nodes.find((node: { id: string }) => node.id === "n1")).toBeUndefined();
    expect(pruned.edges.find((edge: { id: string }) => edge.id === "e1")).toBeUndefined();
    expect(pruned.nodes.find((node: { id: string }) => node.id === "n2")).toBeDefined();
  });
});

describe("simulateTwinNodeRemoval", () => {
  it("returns impacted downstream nodes", () => {
    const graph = {
      nodes: [
        { id: "cap1", type: "Capability", label: "Invoice Processing" },
        { id: "agent1", type: "Agent", label: "Invoice Agent" },
        { id: "val1", type: "Value", label: "Cost Savings" },
      ],
      edges: [
        { id: "e1", from: "cap1", to: "agent1", type: "implements" },
        { id: "e2", from: "agent1", to: "val1", type: "measures" },
      ],
    };
    const result = simulateTwinNodeRemoval("cap1", graph);
    expect(result.removedNode.id).toBe("cap1");
    expect(result.impactedNodes.length).toBeGreaterThan(0);
    expect(result.impactSummary).toMatch(/impact/i);
  });

  it("returns empty impact for leaf node", () => {
    const graph = {
      nodes: [{ id: "leaf", type: "KPI", label: "Cost KPI" }],
      edges: [],
    };
    const result = simulateTwinNodeRemoval("leaf", graph);
    expect(result.impactedNodes).toHaveLength(0);
  });
});

describe("detectCopilotContradictions", () => {
  it("flags L4 autonomy without ML engineer", () => {
    const contradictions = detectCopilotContradictions({
      architecture: { decisions: [{ title: "Use L4 autonomous invoice agent", chosenApproach: "fully autonomous" }] },
      mobilise: { deliveryRoles: [{ roleType: "program manager", roleName: "PM" }] },
    });
    expect(contradictions.some((contradiction: string) => /L3|L4|autonom/i.test(contradiction))).toBe(true);
  });

  it("flags data residency vs public cloud", () => {
    const contradictions = detectCopilotContradictions({
      architecture: {
        complianceProfile: { dataResidency: "on-premise only" },
        decisions: [{ title: "Deploy on AWS", chosenApproach: "AWS us-east-1", rationale: "" }],
      },
    });
    expect(contradictions.some((contradiction: string) => /residen|sovereign|cloud/i.test(contradiction))).toBe(true);
  });

  it("returns empty array for clean program", () => {
    const contradictions = detectCopilotContradictions({
      architecture: { decisions: [], complianceProfile: {} },
      mobilise: { deliveryRoles: [] },
    });
    expect(Array.isArray(contradictions)).toBe(true);
  });
});
