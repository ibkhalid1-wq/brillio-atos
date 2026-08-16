/**
 * The blueprint's "enforced" rules, actually enforced — see
 * supabase/functions/_shared/blueprintInvariants.ts. Each case reproduces a
 * breach the Laila New 2 build shipped silently.
 */
import { describe, expect, it } from "vitest";
import { enforceBlueprintInvariants } from "@shared/blueprintInvariants.ts";

const inner = {
  currentStateAtlas: {
    workflows: [
      { name: "Campaign Management" }, { name: "Lead to Opportunity" },
      { name: "Order Processing" }, { name: "Contract Management" },
    ],
  },
  discoveryKit: {
    personas: [{ name: "Marketing SME" }, { name: "Sales SME" }, { name: "Legal SME" }],
  },
};

const agent = (over: Record<string, unknown> = {}) => ({
  name: "Sales Tool Agent", purpose: "x", replacesWorkflow: "Lead to Opportunity",
  autonomyLevel: "act", reversibility: "reversible", blastRadius: "low",
  requiresHitl: false, guardrails: [{ failureMode: "tool error", detection: "d", fallback: "f" }],
  rationale: "", ...over,
});

describe("safety invariant is repaired, not requested", () => {
  it("act on irreversible work with no gate → demoted to act-with-approval, and the gap says so", () => {
    const { doc, notes } = enforceBlueprintInvariants(inner, {
      agents: [agent({ name: "Contract Agent", replacesWorkflow: "Contract Management", reversibility: "irreversible" })],
      journeys: [], hitlPoints: [], dataContracts: [], gaps: [],
    });
    const a = (doc.agents as Array<Record<string, unknown>>)[0];
    expect(a.autonomyLevel).toBe("act-with-approval");
    expect(a.requiresHitl).toBe(true);
    expect(String(a.rationale)).toMatch(/Demoted from "act"/);
    expect(notes.join(" ")).toMatch(/Contract Agent was demoted/);
    expect((doc.gaps as string[]).join(" ")).toMatch(/demoted to act-with-approval/);
  });

  it("the same agent WITH a covering hitl point keeps its autonomy", () => {
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent({ name: "Contract Agent", reversibility: "irreversible" })],
      journeys: [], hitlPoints: [{ where: "Contract Agent signs", why: "y", mechanism: "approve" }],
      dataContracts: [], gaps: [],
    });
    expect((doc.agents as Array<Record<string, unknown>>)[0].autonomyLevel).toBe("act");
  });

  it("high blast radius counts as dangerous too", () => {
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent({ blastRadius: "high" })], journeys: [], hitlPoints: [], dataContracts: [], gaps: [],
    });
    expect((doc.agents as Array<Record<string, unknown>>)[0].autonomyLevel).toBe("act-with-approval");
  });
});

describe("coverage breaches become named gaps", () => {
  it("the Laila shape — one journey beside many workflows — is called out by name", () => {
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent()], journeys: [{ name: "Customer Lifecycle Orchestration", persona: "customer", stages: [] }],
      hitlPoints: [], dataContracts: [], gaps: [],
    });
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/One journey stands beside 4 mapped workflows/);
  });

  it("a workflow no agent replaces and no journey walks is named", () => {
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent()],
      journeys: [
        { name: "Campaigns", persona: "user", stages: [{ name: "Plan", user: "Campaign Management planning" }] },
        { name: "Orders", persona: "user", stages: [{ name: "Process", user: "Order Processing" }] },
      ],
      hitlPoints: [], dataContracts: [], gaps: [],
    });
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/Contract Management/);
    expect(gaps).not.toMatch(/Order Processing.*no agent/);
  });

  it("data contracts missing the hard parts, and unguarded agents, are counted and named", () => {
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent({ guardrails: [] })],
      journeys: [], hitlPoints: [],
      dataContracts: [
        { entity: "Lead", source: "s", shape: "x", sync: "live", owner: "", piiClass: "pii", consistency: "eventual", conflictResolution: "last-write" },
        { entity: "Account", source: "s", shape: "x", sync: "live", owner: "Sales Ops", piiClass: "pii", consistency: "eventual", conflictResolution: "last-write" },
      ],
      gaps: [],
    });
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/1 data contract missing/);
    expect(gaps).toMatch(/\(Lead\)/);
    expect(gaps).toMatch(/1 agent with no guardrails \(Sales Tool Agent\)/);
  });

  it("a clean blueprint passes through byte-identical", () => {
    const clean = {
      agents: [
        agent({ name: "Campaign Agent", replacesWorkflow: "Campaign Management" }),
        agent({ name: "Sales Agent", replacesWorkflow: "Lead to Opportunity" }),
        agent({ name: "Order Agent", replacesWorkflow: "Order Processing" }),
        agent({ name: "Contract Agent", replacesWorkflow: "Contract Management", autonomyLevel: "act-with-approval" }),
      ],
      journeys: [
        { name: "Demand", persona: "user", stages: [{ name: "s", user: "Campaign Management" }] },
        { name: "Selling", persona: "user", stages: [{ name: "s", user: "Lead to Opportunity" }] },
        { name: "Fulfilment", persona: "user", stages: [{ name: "s", user: "Order Processing and Contract Management" }] },
      ],
      hitlPoints: [], dataContracts: [], gaps: [],
    };
    const { doc, notes } = enforceBlueprintInvariants(inner, clean);
    expect(notes).toEqual([]);
    expect(doc).toBe(clean);
  });
});
