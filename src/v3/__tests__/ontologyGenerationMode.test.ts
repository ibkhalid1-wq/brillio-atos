import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  buildOntologyGenerationRequest,
  isOntologyGenerationRequest,
  receiveOntologyGeneration,
  ONTOLOGY_RESPONSE_FORMAT,
} from "@/v3/lib/ontologyGenerationMode";

function program(over: Record<string, unknown> = {}): ProgramSummary {
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

describe("buildOntologyGenerationRequest", () => {
  it("stamps the mode marker and attaches the contract without mutating the base", () => {
    const base = { programId: "p1", agentId: "design" };
    const req = buildOntologyGenerationRequest(base);
    expect(req.responseFormat).toBe(ONTOLOGY_RESPONSE_FORMAT);
    expect(req.ontologyContract).toContain("ontology-native");
    // Base untouched — new object.
    expect(base).not.toHaveProperty("responseFormat");
    expect(req.programId).toBe("p1");
    expect(req.agentId).toBe("design");
  });

  it("appends the contract to existing guidance", () => {
    const req = buildOntologyGenerationRequest({ guidance: "Focus on the target architecture." });
    expect(req.guidance).toContain("Focus on the target architecture.");
    expect(req.guidance).toContain("ontology-native");
  });

  it("does not create a guidance field when none was present", () => {
    const req = buildOntologyGenerationRequest({ programId: "p1" });
    expect(req).not.toHaveProperty("guidance");
  });

  it("honours a custom guidance key and contract budget", () => {
    const req = buildOntologyGenerationRequest(
      { instructions: "Do the thing." },
      { guidanceKey: "instructions", contractMaxChars: 400 },
    );
    expect(req.instructions).toContain("Do the thing.");
    expect(req.instructions).toContain("ontology-native");
    // Budgeted contract drops the tail relation lines.
    expect(req.ontologyContract).not.toContain("depends-on");
  });
});

describe("isOntologyGenerationRequest", () => {
  it("detects the marker and rejects everything else", () => {
    expect(isOntologyGenerationRequest(buildOntologyGenerationRequest({ a: 1 }))).toBe(true);
    expect(isOntologyGenerationRequest({ responseFormat: "prose" })).toBe(false);
    expect(isOntologyGenerationRequest(null)).toBe(false);
    expect(isOntologyGenerationRequest("x")).toBe(false);
  });
});

describe("receiveOntologyGeneration", () => {
  it("accepts a clean, complete generation", () => {
    const outcome = receiveOntologyGeneration(
      [
        { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:arr" }] },
        { kind: "kpi", label: "ARR", refs: [{ relation: "reported-by", to: "artifact:board-pack" }] },
        { kind: "artifact", label: "Board pack" },
      ],
      program(),
    );
    // The objective still lacks delivered-by/evidenced-by, so it's accept-with-gaps.
    expect(outcome.decision).toBe("accept-with-gaps");
    expect(outcome.acceptable).toBe(true);
    expect(outcome.summary).toContain("advisory gap");
  });

  it("rejects a generation with a structural violation", () => {
    const outcome = receiveOntologyGeneration(
      [{ kind: "artifact", label: "Design doc", refs: [{ relation: "traces-to", to: "requirement:ghost" }] }],
      program(),
    );
    expect(outcome.decision).toBe("reject");
    expect(outcome.acceptable).toBe(false);
    expect(outcome.report.violations[0].kind).toBe("dangling-ref");
    expect(outcome.summary).toContain("Rejected");
  });

  it("treats gaps as blocking when blockOnGaps is set", () => {
    const outcome = receiveOntologyGeneration(
      [{ kind: "objective", label: "Grow revenue" }],
      program(),
      { blockOnGaps: true },
    );
    expect(outcome.decision).toBe("accept-with-gaps");
    expect(outcome.acceptable).toBe(false);
  });

  it("parses raw JSON string output", () => {
    const outcome = receiveOntologyGeneration('[{"kind":"kpi","label":"Adoption %"}]', null);
    expect(outcome.entities[0].id).toBe("kpi:adoption");
    expect(outcome.report.entityCount).toBe(1);
  });
});
