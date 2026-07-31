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
import { areaHasModel, areaProgress, programAreas } from "@/v3/components/flow/flowAreas";
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

/**
 * The regression this file exists to prevent recurring.
 *
 * Canonicalising programAreas onto the kit put a KIT label on one side of every
 * area equality while workflowArea/entityArea still returned the RAW model
 * label on the other. Nothing matched, and the Current-State Atlas reported
 * most areas UNMAPPED on programmes whose atlas was fully populated.
 *
 * Both sides must be aligned. These drive areaHasModel and areaProgress with a
 * kit whose wording deliberately differs from the atlas's.
 */
describe("both sides of an area comparison are aligned", () => {
  it("a mapped area reads as mapped even when the atlas words it differently", () => {
    // Atlas says "Pre-Operative Care", kit says "Pre-Op Nursing" — one area.
    expect(areaHasModel(program(), "Pre-Op Nursing")).toBe(true);
  });

  it("the raw model label is NOT separately mapped", () => {
    // It folded into the kit's label; treating it as its own area is the fork
    // that produced two entries for one thing.
    expect(areaHasModel(program(), "Pre-Operative Care")).toBe(false);
  });

  it("areaProgress counts the workflow and entity under the kit's label", () => {
    const row = areaProgress(program()).find((r) => r.area === "Pre-Op Nursing");
    expect(row?.workflows).toBe(1);
    expect(row?.entities).toBe(1);
  });

  it("an area with no model still reads unmapped", () => {
    expect(areaHasModel(program(), "Quality & Risk")).toBe(false);
  });

  it("an unrecognised label keeps its own identity", () => {
    const p = program({ atlasArea: "Pharmacy", entityArea: "Pharmacy" });
    expect(areaHasModel(p, "Pharmacy")).toBe(true);
  });
});
