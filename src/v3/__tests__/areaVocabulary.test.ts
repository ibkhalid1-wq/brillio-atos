/**
 * One vocabulary across the phases.
 *
 * kitCoverageDomains calls the Discovery Kit's domains "the SOURCE OF TRUTH the
 * phases align to", but programAreas used to add MODELLED labels first and let
 * them win. So an ontology writing "Pre-Operative Care" beside a kit domain of
 * "Pre-Op Nursing" produced two areas for one thing, and Discovery, the Domain
 * Ontology and the Current-State Atlas each named areas the kit had never heard
 * of. Prototype inherited the same raw labels through flowFutureState.
 *
 * These drive the real programAreas and futureState with a kit whose labels
 * deliberately differ in wording from the generated ones.
 */
import { describe, expect, it } from "vitest";
import { programAreas } from "@/v3/components/flow/flowAreas";
import { projectFutureState } from "@/v3/components/flow/flowFutureState";
import type { ProgramSummary } from "@/new/types";

const KIT = ["Pre-Op Nursing", "Scheduling", "Quality & Risk"];

const program = (opts: { atlasArea?: string; entityArea?: string; kit?: string[] } = {}): ProgramSummary => ({
  id: "p", name: "Surgery cancellations",
  rawData: {
    data: {
      discoveryKit: { coverageMap: (opts.kit ?? KIT).map((domain) => ({ domain, coveredBy: ["Someone"] })) },
      currentStateAtlas: {
        workflows: [{ name: "Pre-op checks", area: opts.atlasArea ?? "Pre-Operative Care", steps: [{ actor: "Nurse" }] }],
      },
      domainOntology: { entities: [{ name: "Case", area: opts.entityArea ?? "Pre-Operative Care" }] },
    },
  },
} as unknown as ProgramSummary);

describe("phases speak the Discovery Kit's vocabulary", () => {
  it("a modelled label folds onto the kit's wording instead of forking it", () => {
    const areas = programAreas(program());
    expect(areas).toContain("Pre-Op Nursing");
    expect(areas).not.toContain("Pre-Operative Care");
  });

  it("the kit's domains all survive", () => {
    const areas = programAreas(program());
    for (const domain of KIT) expect(areas).toContain(domain);
  });

  it("a genuinely new area the model found is NOT swallowed", () => {
    // The kit never mentions Pharmacy. Folding it into General would hide a
    // real finding, so it stands on its own.
    const areas = programAreas(program({ atlasArea: "Pharmacy", entityArea: "Pharmacy" }));
    expect(areas).toContain("Pharmacy");
  });

  it("an exact match is left exactly alone", () => {
    const areas = programAreas(program({ atlasArea: "Scheduling", entityArea: "Scheduling" }));
    expect(areas.filter((a) => a.toLowerCase() === "scheduling")).toHaveLength(1);
  });

  it("with no kit, modelled labels stand unchanged", () => {
    const areas = programAreas(program({ kit: [] }));
    expect(areas).toContain("Pre-Operative Care");
  });

  it("Prototype inherits the kit's wording too", () => {
    // flowFutureState reads the Atlas directly, so it needed the same
    // alignment — otherwise the build studio names areas Listen does not.
    const fs = projectFutureState(program());
    expect(fs.workflows.map((w) => w.area)).toContain("Pre-Op Nursing");
    expect(fs.areas).not.toContain("Pre-Operative Care");
  });

  it("Prototype keeps a new area as well", () => {
    const fs = projectFutureState(program({ atlasArea: "Pharmacy" }));
    expect(fs.workflows.map((w) => w.area)).toContain("Pharmacy");
  });
});
