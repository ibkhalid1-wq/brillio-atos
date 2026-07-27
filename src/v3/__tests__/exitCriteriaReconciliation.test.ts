import {
  ATOS_STANDARD,
  ATOS_LITE,
  METHODOLOGY_REGISTRY,
  getPhaseDefinition,
} from "@/v3/lib/methodology";
import { getMandatoryCriteria, EXIT_CRITERIA_LIBRARY } from "@/v3/lib/exitCriteriaLibrary";

/**
 * `EXIT_CRITERIA_LIBRARY` is the single source of truth for mandatory exit
 * criteria. The gate criteria seeded at each phase boundary come from
 * `mandatoryExitCriteriaTemplates`, and `objectiveConfidence` later evidences a
 * phase against `getMandatoryCriteria(phaseId)`. If the two ever drift, a stored
 * gate criterion stops matching its library label and the evidence score
 * silently degrades to the approved-gate proxy. These tests pin the invariant so
 * the two vocabularies can never diverge again.
 */
describe("exit-criteria library reconciliation", () => {
  it("derives every AURA phase's exit-criteria templates from the library", () => {
    for (const phase of ATOS_STANDARD.phases) {
      const derived = getMandatoryCriteria(phase.id).map((c) => c.label);
      expect(phase.mandatoryExitCriteriaTemplates).toEqual(derived);
    }
  });

  it("covers every AURA phase with at least one mandatory library criterion", () => {
    for (const phase of ATOS_STANDARD.phases) {
      expect(getMandatoryCriteria(phase.id).length).toBeGreaterThan(0);
      expect(phase.mandatoryExitCriteriaTemplates.length).toBeGreaterThan(0);
    }
  });

  it("keeps the templates aligned across every methodology variant", () => {
    for (const variant of Object.keys(METHODOLOGY_REGISTRY) as Array<keyof typeof METHODOLOGY_REGISTRY>) {
      for (const phase of METHODOLOGY_REGISTRY[variant].phases) {
        const derived = getMandatoryCriteria(phase.id).map((c) => c.label);
        if (derived.length > 0) {
          expect(phase.mandatoryExitCriteriaTemplates).toEqual(derived);
        }
      }
    }
  });

  it("keeps the ATOS_LITE subset in sync (reuses the same phase objects)", () => {
    for (const phase of ATOS_LITE.phases) {
      const derived = getMandatoryCriteria(phase.id).map((c) => c.label);
      expect(phase.mandatoryExitCriteriaTemplates).toEqual(derived);
    }
  });

  it("aligns getPhaseDefinition templates with the library for each phase", () => {
    const phaseIds = [...new Set(EXIT_CRITERIA_LIBRARY.map((c) => c.phaseId))];
    for (const phaseId of phaseIds) {
      const def = getPhaseDefinition(phaseId, "atos-standard");
      expect(def).toBeDefined();
      expect(def!.mandatoryExitCriteriaTemplates).toEqual(
        getMandatoryCriteria(phaseId).map((c) => c.label),
      );
    }
  });
});
