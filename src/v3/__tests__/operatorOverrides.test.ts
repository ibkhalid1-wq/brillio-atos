import { describe, it, expect } from "vitest";
import { overrideNotes, appendOperatorOverrides, operatorOverrideGuidance } from "@/v3/components/flow/flowOperatorOverrides";
import type { ProgramSummary } from "@/new/types";

const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", rawData: data } as unknown as ProgramSummary);

describe("overrideNotes", () => {
  it("captures ontology entity renames, additions, removals and edits", () => {
    const previous = {
      entities: [
        { name: "Opportunity", definition: "a deal" },
        { name: "Invoice", definition: "a bill" },
        { name: "Lead", definition: "raw" },
      ],
      relations: [{ from: "Account", relation: "produces", to: "Opportunity", cardinality: "1:N" }],
      events: [],
    };
    const next = {
      entities: [
        { name: "Deal", definition: "a deal" },            // renamed (same body)
        { name: "Invoice", definition: "a client bill" },  // edited
        { name: "Escalation", definition: "" },            // added
      ],                                                    // Lead removed
      relations: [],                                        // relation removed
      events: [{ name: "Deal Closed", triggers: "", produces: "" }],
    };
    const notes = overrideNotes("domainOntology", previous, next);
    expect(notes).toContain('Entity renamed: "Opportunity" → "Deal"');
    expect(notes).toContain('Entity added: "Escalation"');
    expect(notes).toContain('Entity removed: "Lead"');
    expect(notes).toContain('Entity edited: "Invoice"');
    expect(notes).toContain('Relation removed: "Account produces Opportunity"');
    expect(notes).toContain('Business event added: "Deal Closed"');
  });

  it("captures kit and atlas deltas, and stays silent on untracked docs / no change", () => {
    const kit = overrideNotes("discoveryKit",
      { interviews: [{ stakeholder: "Finance", role: "Finance" }], personas: [], coverageMap: [] },
      { interviews: [], personas: [{ name: "Analyst" }], coverageMap: [] });
    expect(kit).toContain('Interview removed: "Finance"');
    expect(kit).toContain('Persona added: "Analyst"');
    const atlas = overrideNotes("currentStateAtlas",
      { workflows: [{ name: "Handoff", steps: [] }], painHeatmap: [] },
      { workflows: [{ name: "Handoff", steps: [{ action: "notify" }] }], painHeatmap: [] });
    expect(atlas).toEqual(['Workflow edited: "Handoff"']);
    expect(overrideNotes("domainOntology", { entities: [{ name: "X" }] }, { entities: [{ name: "X" }] })).toEqual([]);
  });

  it("captures an atlas area reassignment as an explicit move", () => {
    const notes = overrideNotes("currentStateAtlas",
      { workflows: [{ name: "Opportunity Signal Generation", area: "Sales" }] },
      { workflows: [{ name: "Opportunity Signal Generation", area: "Marketing" }] });
    expect(notes).toContain('Workflow "Opportunity Signal Generation" moved to area "Marketing"');
  });

  it("captures edits to ANY other artifact via the generic key diff", () => {
    const charter = overrideNotes("transformationCharter",
      { objectives: ["a"], mandate: "old", editedAt: "x" },
      { objectives: ["a", "b"], mandate: "new", editedAt: "y" });
    expect(charter).toContain('Section "objectives" edited');
    expect(charter).toContain('Section "mandate" edited');
    expect(charter).not.toContain('Section "editedAt" edited');
    const design = overrideNotes("experienceDesign",
      { journeys: [{ name: "Quote to Cash" }] },
      { journeys: [{ name: "Quote to Cash" }, { name: "Onboarding" }] });
    expect(design).toContain('"journeys" entry added: "Onboarding"');
    expect(overrideNotes("transformationCharter", { mandate: "same" }, { mandate: "same" })).toEqual([]);
  });
});

describe("append + guidance", () => {
  it("appends capped records and folds them into the regeneration guidance", () => {
    const log = appendOperatorOverrides(undefined, "domainOntology", ['Entity renamed: "A" → "B"'], "2026-07-24T10:00:00Z", "op");
    expect(log).toHaveLength(1);
    const guidance = operatorOverrideGuidance(prog({
      flowOperatorOverrides: log,
      domainOntology: { _curationLog: [{ at: "2026-07-24T11:00:00Z", action: "Dismissed entity “C”", reason: "not a domain object" }] },
    }), "domainOntology");
    expect(guidance).toContain("Operator overrides");
    expect(guidance).toContain('Entity renamed: "A" → "B"');
    expect(guidance).toContain("Dismissed entity");
    // Other documents' guidance stays null when nothing is recorded for them.
    expect(operatorOverrideGuidance(prog({ flowOperatorOverrides: log }), "discoveryKit")).toBeNull();
  });
});
