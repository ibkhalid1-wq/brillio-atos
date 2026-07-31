/**
 * A generated map must not silence the discovery agenda.
 *
 * Listen drops a stakeholder's discovery questions once their area's agenda is
 * "addressed", so the programme stops re-asking what the record already holds.
 * That test was areaHasModel — is this area on the Atlas and in the Ontology —
 * which was sound while an Atlas could only exist after evidence.
 *
 * The provisional path broke that assumption: it generates an ontology and an
 * atlas from published standards BEFORE anyone is interviewed. On the surgery
 * cancellations programme every area read "map confirmed" at 0/3 voices heard,
 * so every agenda was dropped and Listen showed no discovery questions for any
 * stakeholder — while reporting each area settled.
 */
import { describe, expect, it } from "vitest";
import { areaHasEvidence, areaHasModel } from "@/v3/components/flow/flowAreas";
import type { ProgramSummary } from "@/new/types";

/** An area that is fully modelled: one workflow with an actor, one entity. */
const modelled = (evidence: Array<Record<string, unknown>> = []): ProgramSummary => ({
  id: "p", name: "Surgery cancellations",
  rawData: {
    data: {
      currentStateAtlas: {
        workflows: [{ name: "Pre-op checks", area: "Anesthesiology", steps: [{ actor: "Anesthesiology Lead" }] }],
      },
      domainOntology: { entities: [{ name: "Case", area: "Anesthesiology" }] },
      phaseInputs: { listen: {} },
      evidence,
    },
  },
} as unknown as ProgramSummary);

describe("a generated map is not evidence", () => {
  it("an area generated with no voices heard IS modelled", () => {
    // The badge is right: the area really is mapped.
    expect(areaHasModel(modelled(), "Anesthesiology")).toBe(true);
  });

  it("…but it has NO evidence, so its agenda must survive", () => {
    // This is the whole bug: model true, evidence false. Before the fix these
    // were the same question, and the agenda was dropped on the strength of a
    // map nobody had spoken to.
    expect(areaHasEvidence(modelled(), "Anesthesiology")).toBe(false);
  });

  it("an unmapped area has neither", () => {
    expect(areaHasModel(modelled(), "Scheduling")).toBe(false);
    expect(areaHasEvidence(modelled(), "Scheduling")).toBe(false);
  });

  it("General never counts as modelled or evidenced", () => {
    expect(areaHasModel(modelled(), "General")).toBe(false);
    expect(areaHasEvidence(modelled(), "General")).toBe(false);
  });
});
