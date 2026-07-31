/**
 * The kit's domains, supplied to the generators as facts.
 *
 * Neither the ontology nor the atlas prompt ever named the programme's areas.
 * Each declared "area" only inside a JSON field description carrying hardcoded
 * generic examples ("e.g. Sales, Marketing, Finance"), and the ontology was
 * told to reuse the ATLAS's labels — so the ontology anchored to the atlas and
 * the atlas anchored to nothing. Neither end was tied to the Discovery Kit,
 * which is where the operator agreed the areas, so every generation invented
 * its own vocabulary.
 */
import { describe, expect, it } from "vitest";
import { areaVocabularyGuidance } from "@/v3/components/flow/listenCoverage";
import type { ProgramSummary } from "@/new/types";

const program = (domains: string[]): ProgramSummary => ({
  id: "p", name: "Surgery cancellations",
  rawData: { data: { discoveryKit: { coverageMap: domains.map((domain) => ({ domain, coveredBy: ["Someone"] })) } } },
} as unknown as ProgramSummary);

const KIT = ["Pre-Op Nursing", "Scheduling", "Quality & Risk", "Patient Access"];

describe("area vocabulary guidance", () => {
  it("names every kit domain verbatim", () => {
    const g = areaVocabularyGuidance(program(KIT))!;
    for (const d of KIT) expect(g).toContain(d);
  });

  it("tells the model the list supersedes the field-description examples", () => {
    // Those examples are hardcoded and generic; on a hospital programme they
    // actively mislead, and they are the only concrete vocabulary in the prompt.
    expect(areaVocabularyGuidance(program(KIT))!.toLowerCase()).toContain("supersedes");
  });

  it("gives General as the escape hatch rather than a coined label", () => {
    const g = areaVocabularyGuidance(program(KIT))!;
    expect(g).toContain("General");
  });

  it("omits compound spanning tags — they are not areas", () => {
    const g = areaVocabularyGuidance(program([...KIT, "Scheduling / Patient Access"]))!;
    expect(g).not.toContain("Scheduling / Patient Access");
  });

  it("stays silent when the kit has nothing useful to say", () => {
    // One area (or none) is no vocabulary at all — better to leave the prompt
    // alone than to constrain it to a single label.
    expect(areaVocabularyGuidance(program([]))).toBeNull();
    expect(areaVocabularyGuidance(program(["Scheduling"]))).toBeNull();
  });
});
