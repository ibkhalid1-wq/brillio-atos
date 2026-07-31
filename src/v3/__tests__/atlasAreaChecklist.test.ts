/**
 * The atlas checklist owes EVERY frame area, not the ontology's subset.
 *
 * atlasAreaEntityGuidance used to filter its AREA CHECKLIST to areas holding
 * ontology entities. On the surgery-cancellations programme the provisional
 * ontology covered 3 of the kit's 8 domains, so the checklist demanded 3, the
 * atlas obliged with 5, and IT & Systems, Quality & Risk and Scheduling
 * rendered "NOT MAPPED YET" — a thin ontology starving the atlas even though
 * the kit plainly declared all eight areas in scope.
 */
import { describe, expect, it } from "vitest";
import { atlasAreaEntityGuidance, kitAreaEntityGuidance } from "@/v3/components/flow/listenCoverage";
import type { ProgramSummary } from "@/new/types";

const KIT = [
  "Anesthesiology", "Executive Oversight", "IT & Systems", "Patient Access",
  "Pre-Operative Care", "Quality & Risk", "Scheduling", "Surgical Operations",
];

const program = (): ProgramSummary => ({
  id: "p", name: "Surgery cancellations",
  rawData: {
    data: {
      discoveryKit: { coverageMap: KIT.map((domain) => ({ domain, coveredBy: ["Someone"] })) },
      domainOntology: {
        entities: [
          { name: "Patient", area: "Patient Access" },
          { name: "Practitioner", area: "Surgical Operations" },
          { name: "Organization", area: "Executive Oversight" },
        ],
      },
    },
  },
} as unknown as ProgramSummary);

describe("atlas area checklist", () => {
  it("the checklist names every kit domain, entities or not", () => {
    const g = atlasAreaEntityGuidance(program())!;
    const checklist = g.slice(g.indexOf("AREA CHECKLIST"));
    for (const area of KIT) expect(checklist).toContain(area);
  });

  it("entity lists appear only for areas that have entities", () => {
    const g = atlasAreaEntityGuidance(program())!;
    expect(g).toContain("- Patient Access: Patient");
    expect(g).not.toContain("- Scheduling:");
  });

  it("kit guidance names the entity-less areas rather than hiding them", () => {
    const g = kitAreaEntityGuidance(program())!;
    expect(g).toContain("Areas with no ontology entities yet");
    expect(g).toContain("Scheduling");
  });
});
