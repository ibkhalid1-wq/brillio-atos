/**
 * The prototype a STAKEHOLDER is shown — one derivation, stated provenance,
 * visible gaps.
 *
 * What a stakeholder validates on their link is the DETERMINISTIC assembly of the
 * committed domain ontology + current-state atlas (fabric → semantic roles →
 * Meridian → seed data). It is byte-identical to what the operator's Prototype
 * studio renders by default, because both call the same `assemblePrototype` —
 * `_shared` is importable from Deno (relative path) and from Vite/vitest (the
 * `@shared` alias), so there is one copy of the assembler and no lockstep to keep.
 *
 * THE MODEL-AUTHORED BUILD IS NOT A FALLBACK. `prototypeBuild.html` is written by
 * the Prototype Build agent and refined by the Experience Designer; it keeps its
 * place in the app (the refine loop, the source editor, the project export) and it
 * is operator-only. Substituting it here when the assembly can't be derived would
 * hand a stakeholder model-written HTML while the programme believes they are
 * looking at the record — the exact confusion that serving the assembly exists to
 * end, and undetectable from the outside.
 *
 * So when the record cannot produce an assembly, the answer is a GAP: `pilotGap`
 * names the missing piece in the stakeholder's own words and the page prints it.
 * No invented content, no quiet swap.
 *
 * Lives here rather than inside `flow-portal/index.ts` so it is reachable by the
 * test suite: the entrypoint imports remote modules and reads `Deno.env` at load,
 * which vitest cannot execute. This module is pure.
 */
import { assemblePrototype } from "./prototypeAssembly.ts";

export interface PilotSlice {
  /** The assembled prototype, self-contained. Absent when it can't be derived. */
  pilotHtml?: string;
  /** Provenance, stated: derived from the record, not written by a model. */
  pilotSource?: "assembled";
  /** Why there is no prototype. Shown to the stakeholder verbatim. */
  pilotGap?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Build the stakeholder's pilot slice from a programme's stored inner blob. */
export function pilotSliceFor(inner: Record<string, unknown>): PilotSlice {
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : null;
  const missing = [ontology ? "" : "the domain ontology", atlas ? "" : "the current-state atlas"].filter(Boolean);
  if (missing.length) {
    return {
      pilotGap: `The prototype is assembled from ${missing.join(" and ")} — `
        + `${missing.length > 1 ? "neither is" : "which is not"} on the record yet, `
        + `so there is nothing to show you here.`,
    };
  }
  try {
    const { html, regionCount } = assemblePrototype(ontology!, atlas!);
    // regionCount 0 means the ontology carries no entities: an empty shell, not a
    // prototype. Say so rather than sending a blank app that just reads as broken.
    if (!regionCount) {
      return { pilotGap: "The domain ontology holds no entities yet, so there is nothing to assemble a prototype from." };
    }
    return { pilotHtml: html, pilotSource: "assembled" };
  } catch (error) {
    // The real reason goes to the server log; the public page gets the gap, not a
    // stack trace. Still a gap — never the stored model build.
    console.error("[prototypePilot] assembly failed", error);
    return { pilotGap: "The prototype could not be assembled from the record. The programme team has been notified." };
  }
}
