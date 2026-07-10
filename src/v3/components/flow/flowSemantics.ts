/**
 * Semantic referencing — SPAR/PROV over what ATOS already records.
 *
 * The evidence→artifact chain (attributed transcripts, ingested documents,
 * generated artifacts, fingerprints) IS a citation graph; this module gives
 * it standard identifiers and vocabulary without touching the write paths:
 * URIs are deterministic URNs over stable ids, links are typed with CiTO,
 * works with FaBiO, derivation with PROV-O, bib fields with DCTERMS. Users
 * never see any of this in prompts — it derives, renders as plain language
 * in the reading pane, and exports as JSON-LD for integrators.
 */
import type { ProgramSummary } from "@/new/types";
import { flowMovements, movementEvidence, movementArtifacts } from "@/v3/components/flow/flowShellData";

export const SEMANTIC_CONTEXT = {
  fabio: "http://purl.org/spar/fabio/",
  cito: "http://purl.org/spar/cito/",
  prov: "http://www.w3.org/ns/prov#",
  dcterms: "http://purl.org/dc/terms/",
  skos: "http://www.w3.org/2004/02/skos/core#",
} as const;

/** Deterministic, stable identifier for any knowledge object ATOS holds. */
export function resourceUri(programId: string, kind: string, id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return `urn:atos:${programId}:${kind}:${slug || "item"}`;
}

/** FaBiO work type per generator — the bibliographic class of each artifact. */
const FABIO_TYPES: Record<string, string> = {
  "charter": "fabio:Report",
  "discovery-kit": "fabio:Manual",
  "current-state-atlas": "fabio:Report",
  "domain-ontology": "fabio:OntologyDocument",
  "architecture-strategy": "fabio:Proposal",
  "agentic-blueprint": "fabio:Specification",
  "prototype-pack": "fabio:Specification",
  "demo-scripts": "fabio:Script",
  "hardening-plan": "fabio:WorkPlan",
  "eval-suite": "fabio:Protocol",
};
export const artifactFabioType = (artifactId: string): string => FABIO_TYPES[artifactId] ?? "fabio:Expression";

export interface GroundingEntry {
  uri: string;
  label: string;
  kind: "conversation" | "document";
  relation: "cito:citesAsEvidence" | "cito:obtainsBackgroundFrom";
  attributedTo: string;
}

/**
 * What one artifact is grounded in — its movement's conversations and
 * documents, CiTO-typed. Human-readable labels front; URIs beneath.
 */
export function groundingFor(program: ProgramSummary, artifactId: string, movementId: string): GroundingEntry[] {
  const movement = flowMovements().find((entry) => entry.id === movementId);
  if (!movement) return [];
  return movementEvidence(program, movement).map((entry, index) => {
    const isDoc = entry.who.startsWith("Document:") || entry.kind === "reference";
    return {
      uri: resourceUri(program.id, isDoc ? "doc" : "evidence", `${movementId}-${index}-${entry.who}`),
      label: entry.who,
      kind: isDoc ? "document" : "conversation",
      relation: isDoc ? "cito:obtainsBackgroundFrom" : "cito:citesAsEvidence",
      attributedTo: entry.who.split(",")[0].replace(/^Document:\s*/, "").trim(),
    };
  });
}

/** The programme's full citation graph as JSON-LD — the integrator export. */
export function citationGraph(program: ProgramSummary): Record<string, unknown> {
  const graph: Array<Record<string, unknown>> = [];
  for (const movement of flowMovements()) {
    const evidence = groundingFor(program, "*", movement.id);
    for (const entry of evidence) {
      graph.push({
        "@id": entry.uri,
        "@type": "prov:Entity",
        "dcterms:title": entry.label,
        "prov:wasAttributedTo": entry.attributedTo,
      });
    }
    for (const artifact of movementArtifacts(program, movement)) {
      if (!artifact.present) continue;
      graph.push({
        "@id": resourceUri(program.id, "artifact", artifact.id),
        "@type": artifactFabioType(artifact.id),
        "dcterms:title": artifact.title,
        "prov:wasAttributedTo": "ATOS",
        ...(artifact.stale ? { "cito:updates": "pending — evidence changed" } : {}),
        "cito:citesAsEvidence": evidence.filter((e) => e.relation === "cito:citesAsEvidence").map((e) => e.uri),
        "cito:obtainsBackgroundFrom": evidence.filter((e) => e.relation === "cito:obtainsBackgroundFrom").map((e) => e.uri),
      });
    }
  }
  return { "@context": SEMANTIC_CONTEXT, "@graph": graph };
}
