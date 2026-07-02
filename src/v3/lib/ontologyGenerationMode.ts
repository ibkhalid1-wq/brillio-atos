/**
 * Ontology-native generation mode — the dedicated request/response pairing that
 * turns free-text generation into structured, validated, write-back-safe output.
 *
 * ontologyOutput.ts supplies the *contract* (the entity/relation vocabulary the
 * generator must emit) and the *parser*; ontologyWriteBack.ts supplies the
 * *validator* that reconciles a generation against the live Program Graph. On
 * their own each is a building block. This module composes them into a single
 * opt-in mode with two halves:
 *
 *   • request half  — `buildOntologyGenerationRequest` augments a run-agent body
 *     with the output contract and a `responseFormat: "ontology-entities"` marker,
 *     so the generator is *asked* for ontology-native output.
 *   • response half — `receiveOntologyGeneration` parses + validates the returned
 *     output and returns a gated decision (accept / accept-with-gaps / reject) the
 *     caller uses to decide whether the generation may be written back.
 *
 * Deliberately pure and side-effect-free: it shapes a request object and grades a
 * response object. It never invokes the edge function and never writes programme
 * data — the caller owns the transport and the write-back, and gates the write on
 * `outcome.decision`. This keeps the mode adoptable incrementally (a single call
 * site can opt in) without changing the behaviour of prose-generating agents that
 * do not opt in.
 */
import type { ProgramSummary } from "@/new/types";
import type { ProgramDocument } from "@/v3/lib/programGraph";
import { describeOntologyOutputContract, type OntologyEntity } from "@/v3/lib/ontologyOutput";
import {
  validateGeneratedArtifact,
  type OntologyValidationReport,
} from "@/v3/lib/ontologyWriteBack";

/** Marker value stamped on a request body that has opted into the mode. */
export const ONTOLOGY_RESPONSE_FORMAT = "ontology-entities" as const;

export interface OntologyGenerationRequestOptions {
  /** Character budget for the injected contract (passed to the contract builder). */
  contractMaxChars?: number;
  /**
   * Body key holding free-text guidance the edge already forwards to the model.
   * When present and a string, the contract is appended to it so agents keyed only
   * on guidance still receive the vocabulary. Defaults to "guidance".
   */
  guidanceKey?: string;
}

/**
 * Augment a run-agent request body to opt into ontology-native generation. Adds a
 * `responseFormat` marker and an `ontologyContract` string the edge can inject
 * into the system prompt, and appends the contract to the body's guidance field
 * when one is present. Returns a new object — the input body is not mutated.
 */
export function buildOntologyGenerationRequest<T extends Record<string, unknown>>(
  base: T,
  opts: OntologyGenerationRequestOptions = {},
): T & { responseFormat: typeof ONTOLOGY_RESPONSE_FORMAT; ontologyContract: string } {
  const contract = describeOntologyOutputContract(opts.contractMaxChars);
  const guidanceKey = opts.guidanceKey ?? "guidance";
  const existingGuidance = base[guidanceKey];
  const mergedGuidance =
    typeof existingGuidance === "string" && existingGuidance.trim()
      ? `${existingGuidance.trim()}\n\n${contract}`
      : undefined;

  return {
    ...base,
    ...(mergedGuidance !== undefined ? { [guidanceKey]: mergedGuidance } : {}),
    responseFormat: ONTOLOGY_RESPONSE_FORMAT,
    ontologyContract: contract,
  };
}

/** True when a request/response body carries the ontology-native mode marker. */
export function isOntologyGenerationRequest(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    (body as Record<string, unknown>).responseFormat === ONTOLOGY_RESPONSE_FORMAT
  );
}

/**
 * Write-back gate:
 *   • `reject`            — structural violations exist; do not write back.
 *   • `accept-with-gaps`  — structurally valid but has advisory relation gaps.
 *   • `accept`            — valid and complete.
 */
export type OntologyGenerationDecision = "accept" | "accept-with-gaps" | "reject";

export interface OntologyGenerationOutcome {
  decision: OntologyGenerationDecision;
  /** True when the generation may be written back under the caller's policy. */
  acceptable: boolean;
  entities: OntologyEntity[];
  report: OntologyValidationReport;
  /** One-line human summary of the outcome for toasts/logs. */
  summary: string;
}

export interface ReceiveOntologyGenerationOptions {
  /** Live documents, forwarded to the graph so refs can resolve to source nodes. */
  documents?: ProgramDocument[];
  /**
   * When true, advisory gaps also block write-back (decision stays
   * `accept-with-gaps` but `acceptable` becomes false). Defaults to false —
   * gaps are advisory and do not block.
   */
  blockOnGaps?: boolean;
}

function summarise(report: OntologyValidationReport, decision: OntologyGenerationDecision): string {
  if (decision === "reject") {
    const n = report.violations.length;
    const first = report.violations[0];
    return `Rejected: ${n} structural violation${n === 1 ? "" : "s"}${first ? ` — ${first.detail}` : ""}`;
  }
  if (decision === "accept-with-gaps") {
    const n = report.gaps.length;
    return `Accepted with ${n} advisory gap${n === 1 ? "" : "s"} across ${report.entityCount} entit${report.entityCount === 1 ? "y" : "ies"}.`;
  }
  return `Accepted: ${report.entityCount} entit${report.entityCount === 1 ? "y" : "ies"}, no violations or gaps.`;
}

/**
 * Grade a raw ontology-native generation for write-back. Parses and validates the
 * output against the live Program Graph, then maps the validation report to a
 * gate decision. Violations always reject; gaps yield `accept-with-gaps` and are
 * advisory unless `blockOnGaps` is set. Pure — writes nothing; the caller decides
 * whether to persist based on `outcome.acceptable`.
 */
export function receiveOntologyGeneration(
  raw: unknown,
  program: ProgramSummary | null | undefined,
  opts: ReceiveOntologyGenerationOptions = {},
): OntologyGenerationOutcome {
  const { entities, report } = validateGeneratedArtifact(raw, program, opts.documents ?? []);

  let decision: OntologyGenerationDecision;
  if (!report.valid) decision = "reject";
  else if (report.gaps.length > 0) decision = "accept-with-gaps";
  else decision = "accept";

  const acceptable = decision === "accept" || (decision === "accept-with-gaps" && !opts.blockOnGaps);

  return { decision, acceptable, entities, report, summary: summarise(report, decision) };
}
