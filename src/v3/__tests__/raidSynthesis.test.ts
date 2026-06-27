import type { DecisionSummary, RAIDEntry } from "@/new/types";
import { inferRaidLinkages } from "@/v3/lib/raidSynthesis";

/**
 * raidSynthesis infers the cross-type edges the per-type selectors structurally
 * cannot see. These tests pin the grounding rules: a shared artifact is the
 * strongest basis, overlapping input fields the next, phase co-location only for
 * serious entries — and that the overlay never invents same-kind edges or
 * re-counts entries. inferRaidLinkages is the pure core, fed typed arrays.
 */
function risk(over: Partial<RAIDEntry> & { id: string }): RAIDEntry {
  return {
    type: "risk",
    title: `Risk ${over.id}`,
    description: "",
    severity: "high",
    phase: "strategy",
    owner: null,
    mitigation: null,
    status: "open",
    source: "agent",
    createdAt: "2026-06-01T00:00:00.000Z",
    closedAt: null,
    closedBy: null,
    closureNote: null,
    ...over,
  };
}

function blocker(over: Partial<RAIDEntry> & { id: string }): RAIDEntry {
  return risk({ ...over, type: "blocker", title: over.title ?? `Blocker ${over.id}` });
}

function decision(over: Partial<DecisionSummary> & { id: string }): DecisionSummary {
  return {
    title: `Decision ${over.id}`,
    type: "decision",
    priority: "medium",
    phaseId: "strategy",
    question: "Decide?",
    options: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    status: "open",
    ...over,
  };
}

describe("inferRaidLinkages", () => {
  it("links a risk and a decision that reference the same artifact (strongest basis)", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", relatedArtifactId: "art-1" })],
      [],
      [decision({ id: "d1", relatedArtifactId: "art-1" })],
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      from: { kind: "risk", id: "r1" },
      to: { kind: "decision", id: "d1" },
      relation: "causes",
      basis: "artifact",
      confidence: 0.9,
    });
  });

  it("directs edges by kind precedence: risk → blocker → decision", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", relatedArtifactId: "art-1" })],
      [blocker({ id: "b1", relatedArtifactId: "art-1" })],
      [],
    );
    expect(links).toHaveLength(1);
    expect(links[0].from.kind).toBe("risk");
    expect(links[0].to.kind).toBe("blocker");
    expect(links[0].relation).toBe("causes");
  });

  it("marks risk → decision as 'escalates' when the decision is escalated", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", relatedArtifactId: "art-1" })],
      [],
      [decision({ id: "d1", priority: "critical", relatedArtifactId: "art-1" })],
      new Set(["d1"]),
    );
    expect(links[0].relation).toBe("escalates");
  });

  it("uses overlapping input fields when no shared artifact", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", relatedInputIds: ["objective", "scope"] })],
      [],
      [decision({ id: "d1", relatedInputIds: ["scope"] })],
    );
    expect(links).toHaveLength(1);
    expect(links[0].basis).toBe("input");
    expect(links[0].rationale).toContain("scope");
  });

  it("falls back to phase co-location only when a serious entry is involved", () => {
    const serious = inferRaidLinkages(
      [risk({ id: "r1", severity: "critical", phase: "design" })],
      [],
      [decision({ id: "d1", phaseId: "design" })],
    );
    expect(serious).toHaveLength(1);
    expect(serious[0].basis).toBe("phase");

    const trivial = inferRaidLinkages(
      [risk({ id: "r1", severity: "low", phase: "design" })],
      [],
      [decision({ id: "d1", priority: "low", phaseId: "design" })],
    );
    expect(trivial).toHaveLength(0);
  });

  it("never links entries of the same kind", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", relatedArtifactId: "art-1" }), risk({ id: "r2", relatedArtifactId: "art-1" })],
      [],
      [],
    );
    expect(links).toHaveLength(0);
  });

  it("emits one edge per pair, strongest basis wins over weaker co-location", () => {
    const links = inferRaidLinkages(
      [risk({ id: "r1", severity: "critical", phase: "strategy", relatedArtifactId: "art-1" })],
      [],
      [decision({ id: "d1", phaseId: "strategy", relatedArtifactId: "art-1" })],
    );
    expect(links).toHaveLength(1);
    expect(links[0].basis).toBe("artifact");
  });

  it("sorts strongest links first", () => {
    const links = inferRaidLinkages(
      [
        risk({ id: "r1", severity: "critical", phase: "strategy" }), // phase basis (0.4)
        risk({ id: "r2", relatedArtifactId: "art-1" }), // artifact basis (0.9)
      ],
      [],
      [decision({ id: "d1", phaseId: "strategy", relatedArtifactId: "art-1" })],
    );
    expect(links[0].confidence).toBeGreaterThanOrEqual(links[links.length - 1].confidence);
    expect(links[0].basis).toBe("artifact");
  });
});
