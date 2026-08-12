/**
 * ASK ONLY WHAT YOU CANNOT WORK OUT.
 *
 * Measured on the live CRM: 173 open "what type of value is X?" questions, and
 * `deriveRoles` — Aura's OWN semantic-role reader — already produced a role for
 * all 173, 95 of them at confidence ≥ 0.70. The same system rendered
 * `Account.annual revenue` as a currency field in the prototype while asking a
 * person what type of value `Account.annual revenue` is.
 *
 * That was never a missing capability. It was a capability wired to one surface
 * and not the other. This module is the wire.
 *
 * WHAT IT IS NOT. A derived type is a reading of a FIELD NAME, not knowledge of
 * the client's business: `Account.segment` looks like a category and might be a
 * free-text note somebody types. So every claim here lands exactly as the
 * dictionary import's do — `code-derived · weak` — which the precedence lattice
 * guarantees loses to any human answer. It changes what the operator is asked to
 * do, from "answer 173 questions" to "correct the few we got wrong", and it never
 * decides anything a person cannot overrule.
 *
 * THREE RULES KEEP IT HONEST:
 *   1. Confidence floor. Below `DERIVED_TYPE_FLOOR` the guess is not worth the
 *      operator's attention and the question stays open, untouched.
 *   2. Gap-filling only. The caller passes the loci still OPEN after every real
 *      source has spoken, so an uploaded dictionary always wins — a heuristic
 *      never competes with a document the client actually wrote.
 *   3. Its own provenance. `derived:semantic-roles` is not a dictionary name, so
 *      the merge rules can tell a machine's reading of a name from a client's
 *      stated fact, and a surface can count them separately. They are PROPOSED,
 *      and the burn-down must say so rather than quietly shrinking.
 */
import type { AssertInput } from "./store";
import { aboutOf } from "./types";
import { attrLocusId, importedTypingClaim } from "./dictionary";

/**
 * The confidence at or above which a derived reading is worth proposing.
 *
 * 0.70 is where `semanticRoles`' own table stops describing a strong signal
 * ("revenue", "date", "status", "priority") and starts describing a weak one
 * ("owner"→person-ref at 0.55, "account|parent|lead"→parent-ref at 0.55). Below
 * it the guess costs more to check than to answer, so the question stays open.
 * ONE definition — the seeder and every count of what it proposed read this.
 */
export const DERIVED_TYPE_FLOOR = 0.7;

/** The provenance token for a claim derived from a field NAME. Deliberately not a
 *  `dictionary:` token — this is a reading, not a document. */
export const DERIVED_TYPE_PROVENANCE = "derived:semantic-roles";

/**
 * Semantic role → the data type an operator would recognise.
 *
 * Roles the ontology models as REFERENCES (`parent-ref`, `person-ref`,
 * `cross-ref`) are absent on purpose: what a reference points AT is a modelling
 * question, not a type, and answering "reference" would close the locus while
 * telling nobody which entity. Same for `identifier` and `title`, which say what
 * a field is FOR rather than what it holds.
 */
const ROLE_TYPE: Partial<Record<string, string>> = {
  monetary: "currency",
  date: "date",
  quantity: "number",
  percent: "percent",
  boolean: "boolean",
  code: "code",
  "free-text": "text",
  description: "text",
  // Enumerated by nature — which is a statement about the TYPE. The allowed
  // VALUES stay open, because a name cannot tell you them, and that open
  // valueSet question is the honest remainder.
  category: "picklist",
  status: "picklist",
  health: "picklist",
  priority: "picklist",
};

export interface DerivedTypeProposal {
  /** the `#dataType` locus this answers */
  about: string;
  entity: string;
  attribute: string;
  role: string;
  dataType: string;
  confidence: number;
}

export interface AttributeRoleLike {
  entity: string;
  attribute: string;
  role: string;
  confidence: number;
}

/**
 * The readings worth proposing, for the open loci given.
 *
 * `openDataTypeLoci` is the set of `…#dataType` abouts still unanswered. Nothing
 * outside it is touched, so this can only ever fill a gap.
 */
export function derivedTypeProposals(
  roles: readonly AttributeRoleLike[],
  openDataTypeLoci: ReadonlySet<string>,
): DerivedTypeProposal[] {
  const out: DerivedTypeProposal[] = [];
  const seen = new Set<string>();
  for (const r of roles) {
    if (r.confidence < DERIVED_TYPE_FLOOR) continue;
    const dataType = ROLE_TYPE[r.role];
    if (!dataType) continue;
    const about = aboutOf(attrLocusId(r.entity, r.attribute), "dataType");
    if (!openDataTypeLoci.has(about) || seen.has(about)) continue;
    seen.add(about);
    out.push({ about, entity: r.entity, attribute: r.attribute, role: r.role, dataType, confidence: r.confidence });
  }
  return out;
}

/** The proposals as the same `AssertInput[]` batch every other source produces —
 *  through the dictionary's own factory, so there is one shape and one owner. */
export function derivedTypeClaims(proposals: readonly DerivedTypeProposal[]): AssertInput[] {
  return proposals.map((p) => importedTypingClaim(
    p.about, { kind: "scalar", value: p.dataType }, DERIVED_TYPE_PROVENANCE,
  ));
}
