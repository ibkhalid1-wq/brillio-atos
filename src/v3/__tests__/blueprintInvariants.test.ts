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
      { name: "Campaign Management", owner: "Marketing SME", steps: [
        { actor: "Marketing SME", action: "Define campaign objectives, then schedule it.", system: "Marketing Automation" },
        { actor: "Marketing SME", action: "Launch and monitor the campaign." },
      ] },
      { name: "Lead to Opportunity", owner: "Sales SME", steps: [{ actor: "Sales SME", action: "Qualify the lead." }] },
      { name: "Order Processing", owner: "Sales Operations SME", steps: [] },
      { name: "Contract Management", owner: "Legal SME", steps: [{ actor: "Legal SME", action: "Draft the agreement." }] },
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
  it("the one-journey shape is REPAIRED from the atlas, not merely reported", () => {
    // The shape measured live: one journey beside nine workflows, so eight
    // ninths of the business had no walk-through. The atlas can describe them,
    // so it does — every field transcribed from a document on the record.
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent()], journeys: [{ name: "Customer Lifecycle Orchestration", persona: "customer", stages: [] }],
      hitlPoints: [], dataContracts: [], gaps: [],
    });
    const journeys = doc.journeys as Array<Record<string, unknown>>;
    expect(journeys).toHaveLength(5);                       // the authored one + all 4 uncovered workflows
    expect(journeys[0].name).toBe("Customer Lifecycle Orchestration");
    expect(journeys[0].derived).toBeUndefined();            // the model's own is untouched
    const added = journeys.filter((j) => j.derived === true);
    expect(added.map((j) => j.name)).toEqual(["Campaign Management", "Lead to Opportunity", "Order Processing", "Contract Management"]);
    // …and each carries the workflow's own steps, actor and agent.
    const campaign = added.find((j) => j.name === "Campaign Management")!;
    const stages = campaign.stages as Array<Record<string, unknown>>;
    // the LABEL is the step's first clause; the line keeps the whole action
    expect(stages[0].name).toBe("Define campaign objectives");
    expect(stages[0].user).toBe("Marketing SME: Define campaign objectives, then schedule it");
    expect(stages[0].systems).toBe("Marketing Automation");
    expect(String(campaign.basis)).toMatch(/Transcribed from the current-state atlas/);
    // the operator is told, in the artifact's own channel
    expect((doc.gaps as string[]).join(" ")).toMatch(/4 journeys were added from the current-state atlas/);
  });

  it("a workflow an agent replaces is still not covered — an agent is not a walk-through", () => {
    // "Lead to Opportunity" IS the agent's replacesWorkflow, and it still needs
    // a journey: an agent is what does the work, a journey is how it reads.
    const { doc } = enforceBlueprintInvariants(inner, {
      agents: [agent()], journeys: [], hitlPoints: [], dataContracts: [], gaps: [],
    });
    const names = (doc.journeys as Array<Record<string, unknown>>).map((j) => j.name);
    expect(names).toContain("Lead to Opportunity");
  });

  it("with no atlas to transcribe, it reports rather than invents", () => {
    const { doc } = enforceBlueprintInvariants(
      { currentStateAtlas: { workflows: [{ name: "A" }, { name: "B" }, { name: "C" }] }, discoveryKit: { personas: [] } },
      { agents: [agent({ replacesWorkflow: "" })], journeys: [{ name: "One", persona: "user", stages: [] }], hitlPoints: [], dataContracts: [], gaps: [] },
    );
    // workflows with no steps still yield a journey — the name is evidence too
    const added = (doc.journeys as Array<Record<string, unknown>>).filter((j) => j.derived === true);
    expect(added).toHaveLength(3);
    expect((added[0].stages as unknown[])).toHaveLength(1);
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
