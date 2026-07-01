/**
 * ATOS Ontology workspace — the semantic layer that connects the methodology's
 * ontology across all phases and turns it into objective-attainment confidence.
 *
 * Layers:
 *   ontology.ts            — the vocabulary: entity kinds + constrained relations.
 *   ontologyConfig.ts      — the declarative model tunables (weights, bars, bands).
 *   objectiveGraph.ts      — the vocabulary applied to a live programme, with
 *                            validation findings folded in as typed gap edges.
 *   objectiveConfidence.ts — per-objective confidence + ranked recommendations.
 *
 * Primary entry point: `assessObjectives(program, { findings, documents })`.
 */
export * from "@/v3/ontology/ontology";
export * from "@/v3/ontology/ontologyConfig";
export * from "@/v3/ontology/objectiveGraph";
export * from "@/v3/ontology/objectiveConfidence";
