/**
 * THE MERGE RULES — one definition, two runtimes.
 *
 * There are TWO merge implementations in this codebase and there must not be two merge
 * DEFINITIONS. `merge.ts` reconciles a batch into the synchronous in-memory `LedgerStore`;
 * `pgStore.ts` (`PgLedger.reconcile`) reconciles the same batch into Postgres, one locked
 * transaction per locus. They differ in everything that is genuinely different — sync vs
 * async, object mutation vs `update … set superseded_by`, `store.claims()` vs a `select` —
 * and in NOTHING ELSE. Every decision either of them makes about a claim is taken by a
 * predicate in this file.
 *
 * That split is not a style preference; it is the invariant. On 2026-08-11 the three
 * merge rules below (N-4, N-5, N-11 of full-validation-pass2) landed in `merge.ts` alone,
 * and for the length of that afternoon the in-memory ledger and the persisted ledger gave
 * different answers to "what does a re-uploaded dictionary mean?" — one definition per
 * number, violated across a runtime boundary. Whatever is a RULE lives here. Whatever is
 * a MECHANISM lives in the caller.
 *
 * Everything here is pure, synchronous, and free of both `LedgerStore` and `pg`, so the
 * persisted path's decisions are testable in an environment that has no database — which
 * is the only environment this repo's suite has ever had.
 *
 * ── the three rules ──────────────────────────────────────────────────────────────────
 *  1. RECENCY, generated ↔ generated — the newer generation replaces the stale one, so a
 *     regeneration does not accumulate every previous generation as a "conflict".
 *  2. RECENCY, same-provenance code-derived (N-4) — a later import from the SAME named
 *     system is a CORRECTION of its own earlier import, not a rival opinion. Two
 *     DIFFERENT systems disagreeing is a genuine conflict and still coexists.
 *  3. CORROBORATION COLLAPSE (N-5) — two writers landing the SAME value on one locus are
 *     one answer, not two. `assert` consults precedence only when values CONFLICT, so an
 *     agreeing pair would otherwise leave two live rows and inflate every live-claim
 *     ratio (`burnDown.total`, `pctClosed`, `pctSettled`).
 *  + DEVIATION (N-11) — an incoming claim standing against the OTHER world's live claims.
 *
 * Rules 1–3 EXTEND precedence rather than restate it: precedence compares (source × world)
 * and knows nothing about TIME or PROVENANCE. Below them, both callers defer to
 * `resolvePrecedence`, so there is still exactly one definition of who outranks whom.
 */
import { resolvePrecedence, type Source, type World } from "./precedence";
import type { ClaimValue, Closure } from "./types";

// ── value identity ───────────────────────────────────────────────────────────────────
/**
 * ORDER-INDEPENDENT canonical form of a value: object keys sorted recursively, array order
 * preserved (significant for `ref-list`).
 *
 * This is `pgStore`'s spelling, adopted for BOTH paths. A bare `JSON.stringify` compare —
 * which `store.ts` and `projections.ts` still use — reports two identical values as
 * different when their keys were written in a different order, and Postgres `jsonb`
 * REORDERS KEYS on write (by length, then bytewise). So a value round-tripped through the
 * database and the same value straight from the batch stringify differently while being
 * the same value. Under `JSON.stringify` that spuriously fires the recency rule (a
 * re-import "corrects" itself to the identical value) and spuriously counts a deviation.
 *
 * Where the two spellings disagree, canonical is the correct one and `JSON.stringify` is
 * the false negative — never the reverse. The frozen-core callers that should adopt it are
 * recorded as a finding, not edited here.
 */
export const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
};

export const valueEq = (a: ClaimValue, b: ClaimValue): boolean => canonical(a) === canonical(b);

/** A value that ANSWERS the slot. `unknown` is the open question; `na` is "no answer applies". */
export const substantive = (v: ClaimValue): boolean => v.kind !== "unknown" && v.kind !== "na";

/** Substantive AND unequal — the only case `assert` takes to precedence. */
export const valueConflicts = (a: ClaimValue, b: ClaimValue): boolean =>
  substantive(a) && substantive(b) && !valueEq(a, b);

/** The value kinds `buildDeviationRegister` (projections.ts) counts — kept identical so
 *  `MergeReport.deviations` and the register are ONE number, not two. */
export const devSubstantive = (v: ClaimValue): boolean =>
  v.kind === "scalar" || v.kind === "ref" || v.kind === "ref-list";

// ── attributed closures ──────────────────────────────────────────────────────────────
/** Sources whose closure carries human/documentary attribution — the rows a regeneration
 *  must never overwrite, and the rows an orphan report is about. */
export const ATTRIBUTED: ReadonlySet<string> = new Set([
  "asserted", "dispositioned", "document", "regulation", "precedent",
]);

export const isAttributedClosure = (c: { source: string; status: string }): boolean =>
  ATTRIBUTED.has(c.source) && (c.status === "closed" || c.status === "weak");

// ── provenance ───────────────────────────────────────────────────────────────────────
/**
 * The FACTS a merge decision needs about a claim — deliberately NOT `Claim`, so the same
 * predicate accepts an in-memory `Claim`, a row rehydrated by `pgStore.rowToClaim`, and a
 * not-yet-written `AssertInput`. A decision that needed an id or a status would be a
 * mechanism, not a rule.
 */
export interface ClaimFacts {
  world: World;
  source: Source;
  value: ClaimValue;
  closedBy?: Closure;
}

/**
 * THE PROVENANCE TOKEN of an imported claim: which named system/dictionary produced it.
 *
 * A `Claim` has **no dedicated provenance field**. `closedBy.by` is the only place the
 * originating system is recorded, and it is only meaningful as a system identity when
 * `closedBy.method === "import"` (for `assertion`/`disposition` it is a person). Every
 * `code-derived` producer in the codebase sets both — `dictionary.ts` (`dictionary:<name>`),
 * `adapters.ts` (`sf-metadata-export`), `migrate.ts` (`prototype`) — so this is readable
 * today WITHOUT a schema change.
 *
 * It returns `null` when provenance is absent or blank, and an absent provenance NEVER
 * matches another absent one: "I cannot tell which system this came from" must not be read
 * as "the same system". Unknown provenance falls through to precedence, i.e. the two
 * readings coexist and the miss stays visible.
 *
 * IT IS ALSO WHY `pgStore.rowToClaim` DROPPING `closedBy` WAS LOAD-BEARING: with `closedBy`
 * undefined on every rehydrated row this returns `null` for both sides, rule 2 can never
 * fire, and a corrected re-upload coexists forever on the persisted path only. The rule and
 * the field that carries it must be read in the same breath — see pgRowToClaimComplete.test.ts.
 *
 * LIMIT, stated rather than guessed: this token is as fine-grained as its producer made it.
 * `dictionary:<name>` is per-dictionary (good), but `migrate.ts` stamps every one of its
 * imports `prototype`, so it identifies the PIPELINE, not a system of record. Distinguishing
 * two systems merged by one migrate pass needs a real `Claim.provenance` field — a
 * frozen-core change, reported (F3), not guessed at here.
 */
export const importProvenance = (c: { closedBy?: Closure }): string | null => {
  if (c.closedBy?.method !== "import") return null;
  const by = (c.closedBy.by ?? "").trim();
  return by ? by : null;
};

// ── rule 1 + rule 2: recency ─────────────────────────────────────────────────────────
/**
 * Does the INCOMING claim supersede this existing LIVE claim by recency?
 *
 * Two arms, both requiring same world, same source, both substantive, values differing:
 *  - `generated` ↔ `generated`: always (regeneration recency).
 *  - `code-derived` ↔ `code-derived`: ONLY when both carry the same import provenance —
 *    the same system re-uploaded a corrected export. A DIFFERENT system's reading of the
 *    same locus is a genuine disagreement and is left to precedence, which coexists it.
 *
 * Equal values return false in both arms: that is not a supersession, it is corroboration,
 * and rule 3 (`collapseDecision`) owns it.
 */
export const recencySupersedes = (existing: ClaimFacts, incoming: ClaimFacts): boolean => {
  if (existing.world !== incoming.world) return false;
  if (existing.source !== incoming.source) return false;
  if (!substantive(existing.value) || !substantive(incoming.value)) return false;
  if (valueEq(existing.value, incoming.value)) return false;
  if (incoming.source === "generated") return true;
  if (incoming.source !== "code-derived") return false;
  const p = importProvenance(incoming);
  return p !== null && p === importProvenance(existing);
};

/** Which counter a recency supersession belongs in — `supersededGenerated` (rule 1) or
 *  `correctedReimports` (rule 2, N-4). One definition so the two reports cannot label the
 *  same event differently. */
export const recencyKind = (incoming: ClaimFacts): "supersededGenerated" | "correctedReimports" =>
  incoming.source === "generated" ? "supersededGenerated" : "correctedReimports";

// ── rule 3: the corroboration collapse (N-5) ─────────────────────────────────────────
export type CollapseDecision =
  | "none"                        // not an agreeing pair, or the lattice cannot decide
  | "incoming-supersedes-live"    // the incoming row wins; the agreeing live row becomes history
  | "live-supersedes-incoming";   // the existing row wins; the incoming row becomes history

/**
 * Two live claims on ONE locus carrying the SAME substantive value are one answer. Since
 * agreement is not a conflict, `assert` never asks precedence about it — so precedence is
 * asked here the question it would have been asked had they disagreed: the stronger source
 * stays live, the agreeing weaker row is kept as HISTORY (never deleted).
 *
 * `escalate` and `coexist` return "none" deliberately: where the lattice cannot decide,
 * both rows stay visible. Flattening an undecidable pair would hide a real contradiction,
 * which is the failure this whole ledger exists to prevent — worse than a duplicate row.
 *
 * Cross-world pairs return "none" for the same reason from the other direction: an
 * as-is/to-be pair with the same value is the deviation register's evidence that the two
 * worlds AGREE on that slot, and collapsing it would delete that evidence.
 */
export const collapseDecision = (incoming: ClaimFacts, live: ClaimFacts): CollapseDecision => {
  if (incoming.world !== live.world) return "none";
  if (!substantive(incoming.value) || !substantive(live.value)) return "none";
  if (!valueEq(incoming.value, live.value)) return "none";
  const r = resolvePrecedence(
    { source: incoming.source, world: incoming.world },
    { source: live.source, world: live.world },
  );
  if (r.outcome !== "wins") return "none";
  return r.winner === "a" ? "incoming-supersedes-live" : "live-supersedes-incoming";
};

// ── N-11: the deviation predicate ────────────────────────────────────────────────────
/**
 * Does this claim, now live, stand in a CROSS-WORLD deviation on its locus?
 *
 * Same predicate `buildDeviationRegister` applies: substantive-for-deviation on both sides,
 * at least one live claim in the OTHER world, and the incoming value matching NONE of them.
 * `liveOnLocus` is every live claim on the locus in BOTH worlds — the caller does no
 * filtering, because which rows are eligible is part of the rule, not of the mechanism.
 *
 * The old spelling filtered to `input.world` and THEN asked whether the list held an
 * `as-is` claim while `input.world === "to-be"` — unsatisfiable, so the field could only
 * ever read `0` while `buildDeviationRegister` reported the same event as non-zero: two
 * readers, two contradictory numbers.
 */
export const deviates = (incoming: ClaimFacts, liveOnLocus: ClaimFacts[]): boolean => {
  if (!devSubstantive(incoming.value)) return false;
  const other = liveOnLocus.filter((x) => x.world !== incoming.world && devSubstantive(x.value));
  return other.length > 0 && !other.some((x) => valueEq(x.value, incoming.value));
};

// ── the report both paths fill ───────────────────────────────────────────────────────
/**
 * The caller's ONLY evidence of what a reconcile actually did — and one shape for both
 * runtimes, so a field cannot exist on one path and be silently absent on the other. The
 * persisted path had no `correctedReimports`, `collapsedDuplicates` or `deviations` at all
 * until this file existed: three rules the in-memory ledger applied and reported, and the
 * database neither applied nor mentioned.
 */
export interface MergeReport {
  /** rows processed from the batch */
  applied: number;
  /** attributed closures that survived an incoming conflict (the no-overwrite guarantee, counted) */
  preservedClosures: number;
  /** rule 1 — stale generations replaced by newer ones */
  supersededGenerated: number;
  /** rule 2 (N-4) — earlier `code-derived` rows superseded by a LATER import from the SAME
   *  provenance: a corrected re-upload. Never counts a different system's disagreement. */
  correctedReimports: number;
  /** rule 3 (N-5) — live rows collapsed because a second writer landed the SAME value */
  collapsedDuplicates: number;
  /** open `?unknown` slots the batch answered */
  filledUnknowns: number;
  /** rows added that neither filled an unknown nor met a closure */
  newClaims: number;
  /** N-11 — incoming claims that, once live, stand in a cross-world deviation on their locus */
  deviations: number;
  /** attributed closures about elements the regeneration DROPPED */
  orphanedClosures: Array<{ about: string; by: string }>;
}

export const emptyMergeReport = (): MergeReport => ({
  applied: 0, preservedClosures: 0, supersededGenerated: 0, correctedReimports: 0,
  collapsedDuplicates: 0, filledUnknowns: 0, newClaims: 0, deviations: 0, orphanedClosures: [],
});
