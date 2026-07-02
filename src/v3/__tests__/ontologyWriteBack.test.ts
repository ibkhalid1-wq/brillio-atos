import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { buildProgramGraph } from "@/v3/lib/programGraph";
import {
  validateOntologyEntities,
  validateGeneratedArtifact,
} from "@/v3/lib/ontologyWriteBack";
import { parseOntologyEntities, type OntologyEntity } from "@/v3/lib/ontologyOutput";
import type { EntityKind } from "@/v3/ontology/ontology";

function program(over: Record<string, unknown>): ProgramSummary {
  return {
    phases: [],
    artifacts: [],
    raidEntries: [],
    decisionQueue: [],
    stakeholders: [],
    rawData: {},
    ...over,
  } as unknown as ProgramSummary;
}

const phases = [
  { id: "strategy", displayName: "Strategy", pct: 100, status: "complete", objective: "" },
  { id: "discover", displayName: "Discover", pct: 60, status: "active", objective: "" },
  { id: "design", displayName: "Design", pct: 20, status: "active", objective: "" },
];

/** Parse helper so tests exercise the same normalisation the loop uses. */
function entities(raw: unknown): OntologyEntity[] {
  return parseOntologyEntities(raw);
}

describe("validateOntologyEntities", () => {
  it("accepts a legal relation between two generated entities", () => {
    const report = validateOntologyEntities(
      entities([
        { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:arr" }] },
        { kind: "kpi", label: "ARR" },
      ]),
    );
    expect(report.violations).toEqual([]);
    // Gaps are advisory, not blocking, so the batch is still valid.
    expect(report.valid).toBe(true);
  });

  it("flags an ontology-illegal relation (objective measured-by a risk)", () => {
    const report = validateOntologyEntities(
      entities([
        { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "risk:slip" }] },
        { kind: "risk", label: "Slip" },
      ]),
    );
    const v = report.violations.find((x) => x.kind === "illegal-relation");
    expect(v?.targetId).toBe("risk:slip");
    expect(report.valid).toBe(false);
  });

  it("flags a dangling ref that resolves to no entity", () => {
    const report = validateOntologyEntities(
      entities([{ kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:ghost" }] }]),
    );
    expect(report.violations.some((v) => v.kind === "dangling-ref" && v.targetId === "kpi:ghost")).toBe(true);
  });

  it("flags a self-reference", () => {
    // A requirement that satisfies itself.
    const ents: OntologyEntity[] = [
      { id: "requirement:sso", kind: "requirement", label: "SSO", refs: [{ relation: "satisfied-by", to: "requirement:sso" }] },
    ];
    const report = validateOntologyEntities(ents);
    expect(report.violations[0].kind).toBe("self-reference");
  });

  it("reports expected-relation gaps and clears them once satisfied", () => {
    const withGaps = validateOntologyEntities(
      entities([{ kind: "objective", label: "Grow revenue" }]),
    );
    const gapRelations = withGaps.gaps.map((g) => g.relation);
    // An objective is expected to be measured-by, delivered-by and evidenced-by.
    expect(gapRelations).toEqual(expect.arrayContaining(["measured-by", "delivered-by", "evidenced-by"]));

    const satisfied = validateOntologyEntities(
      entities([
        { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:arr" }] },
        { kind: "kpi", label: "ARR" },
      ]),
    );
    expect(satisfied.gaps.some((g) => g.entityKind === "objective" && g.relation === "measured-by")).toBe(false);
  });

  it("resolves a ref against a known existing id via knownKinds", () => {
    const knownKinds = new Map<string, EntityKind>([["kpi:live", "kpi"]]);
    const report = validateOntologyEntities(
      entities([{ kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:live" }] }]),
      { knownKinds },
    );
    expect(report.violations).toEqual([]);
  });
});

describe("validateGeneratedArtifact", () => {
  it("resolves a ref to a live Program Graph node id", () => {
    const prog = program({
      phases,
      rawData: { phaseInputs: { discover: { requirements: JSON.stringify([{ id: "REQ-1", requirement: "Must support SSO" }]) } } },
    });
    const reqNode = buildProgramGraph(prog).nodes.find((n) => n.type === "requirement");
    expect(reqNode).toBeDefined();

    // A generated artifact that traces back to the existing requirement (legal).
    const { report } = validateGeneratedArtifact(
      [{ kind: "artifact", label: "Design doc", refs: [{ relation: "traces-to", to: reqNode!.id }] }],
      prog,
    );
    expect(report.violations.filter((v) => v.targetId === reqNode!.id)).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("reports a dangling ref when the target is absent from the graph", () => {
    const prog = program({ phases });
    const { report } = validateGeneratedArtifact(
      [{ kind: "artifact", label: "Design doc", refs: [{ relation: "traces-to", to: "requirement:ghost" }] }],
      prog,
    );
    expect(report.valid).toBe(false);
    expect(report.violations[0].kind).toBe("dangling-ref");
  });

  it("parses raw JSON and returns the normalised entities alongside the report", () => {
    const { entities: parsed, report } = validateGeneratedArtifact(
      '[{"kind":"kpi","label":"Adoption %"}]',
      null,
    );
    expect(parsed[0].id).toBe("kpi:adoption");
    expect(report.entityCount).toBe(1);
  });
});
