/**
 * Cross-surface coherence — the invariants that keep the app telling ONE
 * story. Every surface derives from the same readers; these tests pin the
 * relationships BETWEEN surfaces (gate ↔ cards ↔ kit ↔ verdict ↔ meta), so a
 * change that makes two surfaces disagree fails here instead of waiting for
 * someone to notice on screen.
 */
import { describe, expect, it } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  flowMovements, movementArtifacts, movementOpenIssues, gateChecklist, gateReadiness,
  spineRegenerationPlan, type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { meetingKit } from "@/v3/components/flow/flowMeetings";
import { describeDecisionChanges, type FlowDecision } from "@/v3/components/flow/flowDecisions";

const programme = (inner: Record<string, unknown>): ProgramSummary => ({
  id: "p1", name: "Coherence", client: "", methodology: "atos-flow",
  rawData: { data: inner }, updatedAt: "2026-07-11",
} as unknown as ProgramSummary);

const art = (over: Partial<ArtifactCardModel>): ArtifactCardModel => ({
  id: "discovery-kit", movementId: "frame", title: "Discovery Kit", description: "",
  excerpt: null, confidence: 80, present: true, stale: false, gaps: 0, ...over,
});

const FULL_FRAME = {
  phaseInputs: { frame: {
    sponsorConversation: "— Sarah Okafor, COO —\ntext on record",
    businessObjective: "obj", sponsor: "Sarah", industry: "Banking",
    successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
  } },
};

const frame = () => flowMovements().find((m) => m.id === "frame")!;

describe("gate ↔ cards", () => {
  it("the Documents group has exactly one row per artifact card", () => {
    const artifacts = [art({}), art({ id: "charter", title: "Charter" })];
    const rows = gateChecklist(programme(FULL_FRAME), frame(), artifacts).filter((c) => c.group === "record" && c.artifactId);
    expect(rows.map((r) => r.artifactId)).toEqual(artifacts.map((a) => a.id));
  });

  it("a card showing gaps can never coexist with a green gate", () => {
    const artifacts = [art({ gaps: 1 })];
    const readiness = gateReadiness(programme(FULL_FRAME), frame(), artifacts, gateChecklist(programme(FULL_FRAME), frame(), artifacts));
    expect(readiness.tone).not.toBe("green");
  });

  it("a stale card and its gate row speak the same phrase", () => {
    const artifacts = [art({ stale: true })];
    const row = gateChecklist(programme(FULL_FRAME), frame(), artifacts).find((c) => c.artifactId === "discovery-kit")!;
    expect(row.label).toContain("evidence changed");
  });

  it("the verdict count always equals the checklist's own arithmetic", () => {
    for (const artifacts of [[art({})], [art({ stale: true })], [art({ gaps: 2 })], []]) {
      const checks = gateChecklist(programme(FULL_FRAME), frame(), artifacts);
      const readiness = gateReadiness(programme(FULL_FRAME), frame(), artifacts, checks);
      // Advisory rows don't gate, so the verdict arithmetic counts blocking rows.
      const done = checks.filter((c) => c.done && !c.advisory).length;
      if (readiness.kind !== "demonstrated" && readiness.kind !== "signal") {
        expect(readiness.kind === "ready" ? readiness.detail : readiness.headline).toContain(`${done}`);
      }
    }
  });

  it("the collapsed meta's 'documents current' predicate matches the Documents group", () => {
    const artifacts = [art({}), art({ stale: true, id: "a2", title: "A2" }), art({ gaps: 1, id: "a3", title: "A3" })];
    const metaCount = artifacts.filter((a) => a.present && !a.stale && a.gaps === 0).length;
    const groupMet = gateChecklist(programme(FULL_FRAME), frame(), artifacts)
      .filter((c) => c.group === "record" && c.artifactId && c.done).length;
    expect(metaCount).toBe(groupMet);
  });
});

describe("kit ↔ gate", () => {
  it("follow-up scripts never carry operator plumbing, whatever the gaps say", () => {
    const p = programme({
      ...FULL_FRAME,
      discoveryKit: { gaps: [
        "Add a clear objective to the Objective input.",
        "Regenerate the artifact after the ledger updates.",
        "Which regions does the discount flow cover today?",
      ] },
    });
    const kit = meetingKit(p, "frame")!;
    for (const question of kit.questions) {
      expect(question).not.toMatch(/\binputs?\b|\bledger\b|\bartifacts?\b|\bregenerat/i);
    }
  });
});

describe("Listen → Show approval chain", () => {
  const show = () => flowMovements().find((m) => m.id === "show")!;

  it("every heard voice must hold a demo row — coverage counts against the roster", () => {
    const p = programme({ phaseInputs: {
      listen: { interviewRoster: JSON.stringify([
        { name: "Dan Reyes", status: "Heard" }, { name: "Priya Nair", status: "Heard" }, { name: "Alex", status: "Waived" },
      ]) },
      show: { demoTour: JSON.stringify([{ stakeholder: "Dan Reyes", verdict: "Accepted" }]) },
    } });
    const row = gateChecklist(p, show(), []).find((c) => c.id === "tour")!;
    expect(row.label).toBe("A demo row for every voice heard (1/2)");
    expect(row.done).toBe(false);
    expect(row.why).toContain("Priya Nair");
  });

  it("the Show gate counts track convergence when tracks exist", () => {
    const p = programme({
      tracks: [
        { id: "t1", name: "Quote Automation", showPasses: [{ ts: "a", verdict: "accepted" }, { ts: "b", verdict: "accepted" }], createdAt: "x" },
        { id: "t2", name: "Contract Drafting", showPasses: [{ ts: "a", verdict: "rework" }], createdAt: "x" },
      ],
      phaseInputs: { show: { demoTour: JSON.stringify([]) } },
    });
    const row = gateChecklist(p, show(), []).find((c) => c.id === "tracks-accepted")!;
    expect(row.label).toBe("Every track accepted (1/2)");
    expect(row.done).toBe(false);
    expect(row.why).toContain("Contract Drafting");
  });

  it("no tracks → no track criterion (nothing phantom to satisfy)", () => {
    expect(gateChecklist(programme({}), show(), []).some((c) => c.id === "tracks-accepted")).toBe(false);
  });
});

describe("the record's questions hold the gate and reach the script", () => {
  const listenP = () => programme({
    discoveryKit: { interviews: [{ stakeholder: "Dan Reyes", role: "RevOps", agenda: [] }] },
    domainOntology: {
      entities: [{ name: "Quote" }],
      ambiguities: [
        { term: "Order", conflictingMeanings: ["sales order", "purchase order"], resolution: "unresolved" },
        { term: "Account", conflictingMeanings: ["billing", "CRM"], resolution: "CRM account adopted" },
      ],
    },
    currentStateAtlas: { openQuestions: ["Who owns credit-memo approval?"] },
    phaseInputs: { listen: {
      interviewRoster: JSON.stringify([{ name: "Dan Reyes", status: "Heard" }]),
      interviewTranscripts: "— Dan Reyes, RevOps —\nplenty of words here on the record",
      contradictionLog: JSON.stringify([]),
    } },
  });
  const listen = () => flowMovements().find((m) => m.id === "listen")!;

  it("unresolved ambiguities and open questions are counted; resolved ones are not", () => {
    const issues = movementOpenIssues(listenP(), listen());
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.kind).sort()).toEqual(["ambiguity", "open-question"]);
    expect(issues[0].text).toContain("Order");
  });

  it("open questions are ADVISORY — surfaced and named, but they no longer hold the gate", () => {
    const row = gateChecklist(listenP(), listen(), [art({ id: "domain-ontology", title: "Domain Ontology" })])
      .find((c) => c.id === "issues")!;
    expect(row.done).toBe(false);
    expect(row.advisory).toBe(true);
    expect(row.label).toBe("Open questions & ambiguities — 2 to resolve");
    expect(row.why).toContain("Order");
    // With the structural criteria met, the advisory row does NOT block readiness.
    const readiness = gateReadiness(listenP(), listen(), [art({ id: "domain-ontology", title: "Domain Ontology" })],
      gateChecklist(listenP(), listen(), [art({ id: "domain-ontology", title: "Domain Ontology" })]));
    expect(readiness.tone).toBe("green");
  });

  it("the same questions land on the follow-up script for stakeholders", () => {
    const kit = meetingKit(listenP(), "listen")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions.some((q) => q.includes("Order") && /which meaning/i.test(q))).toBe(true);
    expect(kit.questions).toContain("Who owns credit-memo approval?");
  });

  it("no artifacts generated → no phantom issues criterion", () => {
    expect(gateChecklist(programme({}), listen(), []).some((c) => c.id === "issues")).toBe(false);
  });
});

describe("spine ↔ cards", () => {
  it("the spine plan is exactly the stale-and-present cards, in movement order", () => {
    const p = programme(FULL_FRAME);
    const plan = spineRegenerationPlan(p);
    const staleIds = flowMovements().flatMap((m) =>
      movementArtifacts(p, m).filter((a) => a.present && a.stale).map((a) => a.id));
    expect(plan.map((s) => s.artifactId)).toEqual(staleIds);
  });
});

describe("Inbox previews ↔ resolver families (no silent confirms)", () => {
  const decision = (payload: Record<string, unknown>): FlowDecision => ({
    id: "d", tier: 2, status: "open", agentId: "a", movementId: "listen",
    title: "t", summary: "", blocking: "", recommendation: null, payload, createdAt: "2026-07-11",
  });

  it("every payload family the resolver applies has a what-changes preview", () => {
    const samples: Array<Record<string, unknown>> = [
      { ontologyAlignment: [{ entity: "Quote", standard: "https://schema.org/Quotation" }] },
      { artifactDocs: { discoveryKit: { scope: "x" } } },
      { dynamicSchema: { inputFields: {} } },
      { tracks: [{ id: "t1", name: "Track" }] },
      { flowGovernance: { haltAll: false } },
      { rosterAdditions: [{ name: "Alex Kim", role: "CFO" }] },
      { contradictionEntries: [{ statement: "s", between: "a vs b", positions: "p" }] },
    ];
    for (const payload of samples) {
      const changes = describeDecisionChanges(programme({}), decision(payload));
      expect(changes.length, `no preview for ${Object.keys(payload)[0]}`).toBeGreaterThan(0);
    }
  });
});
