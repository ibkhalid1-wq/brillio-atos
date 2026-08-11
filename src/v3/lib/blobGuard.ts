/**
 * Blob schema guard — the validation boundary for the programme blob.
 *
 * Everything the app stores lives in one JSONB blob; until now its shape was
 * enforced by convention only, so one malformed key could take a surface (or
 * the whole shell) down with it. This module validates the KNOWN keys with
 * zod, reports issues without mutating anything (readers are already
 * defensive one by one — this makes the whole picture inspectable), and
 * stamps a data version so future shape changes migrate explicitly instead
 * of by accident.
 *
 * Validation is advisory by design: an unknown key is fine (forward
 * compatible), a malformed known key is reported and left in place for the
 * defensive readers — never deleted, never rewritten.
 */
import { z } from "zod";

/** Bump when a migration in MIGRATIONS changes the blob's shape. */
export const BLOB_VERSION = 2;

/**
 * The append-only attestation log is bounded to the most recent N entries at
 * every writer. It was a bare `200` literal at ~20 call sites, so one writer
 * drifting to a different number would silently widen or narrow the bound with
 * nothing to catch it. This is the single source of truth — every writer slices
 * to `-FLOW_ATTESTATION_CAP`. (Client-side only: the edge does not cap this log.)
 */
export const FLOW_ATTESTATION_CAP = 200;

/**
 * Portal answer length cap. A shared client↔edge numeric contract: the client
 * `maxLength` on the stakeholder answer fields must match the edge's
 * `MAX_ANSWER_CHARS` in `supabase/functions/flow-portal/index.ts`, or a client
 * that allows MORE than the edge lets the user type text the server silently
 * truncates on submit (data loss, no notice). Kept in lockstep by
 * `answerCapLockstep.test.ts`, since the boundary prevents a shared import.
 */
export const MAX_ANSWER_CHARS = 20_000;

const record = z.record(z.string(), z.unknown());

const decision = z.object({
  id: z.string(),
  tier: z.number().optional(),
  status: z.enum(["open", "confirmed", "declined"]).optional(),
  agentId: z.string().optional(),
  movementId: z.string().optional(),
  title: z.string().optional(),
  payload: record.nullable().optional(),
}).loose();

const portalPack = z.object({
  id: z.string(),
  token: z.string(),
  stakeholder: z.string().optional(),
  respondedAt: z.string().optional(),
}).loose();

const followUp = z.object({
  id: z.string(),
  movementId: z.string(),
  who: z.string(),
  date: z.string(),
}).loose();

/** Known key → schema. Anything not listed is passed through untouched. */
const KNOWN_KEYS: Record<string, z.ZodTypeAny> = {
  phaseInputs: z.record(z.string(), record),
  phaseArtifacts: z.record(z.string(), z.record(z.string(), record)),
  flowDecisions: z.array(decision),
  // The attestation LOG is append-only and non-load-bearing — every reader is
  // defensive and the app works around a partial entry. A historical row that
  // predates the current shape (e.g. missing tier/agentId) must not raise a
  // "malformed" flag, so validate only that each row is an object.
  flowAttestations: z.array(record),
  flowFollowUps: z.array(followUp),
  flowInterviewPacks: z.array(portalPack),
  flowDemoInvites: z.array(portalPack),
  flowPortalInbox: z.array(z.object({ id: z.string() }).loose()),
  flowGovernance: record,
  ontologyAlignment: z.array(z.object({ entity: z.string() }).loose()),
  tracks: z.array(z.object({ id: z.string() }).loose()),
  shipLanes: z.object({ lanes: z.array(record) }).loose(),
  dynamicSchema: record,
  gateReviews: z.record(z.string(), record),
  flowBriefs: z.array(z.object({ id: z.string(), token: z.string(), snapshot: record }).loose()),
  // Curated claims — a quoted evidence span tagged to an entity/KPI/track.
  claimTags: z.array(z.object({ id: z.string(), quote: z.string() }).loose()),
  // Anchored comments — discussion attached to an artifact, on the record.
  flowComments: z.array(z.object({ id: z.string(), text: z.string() }).loose()),
};

export interface BlobIssue {
  key: string;
  reason: string;
}

/**
 * Validate the inner data root. Returns issues — never throws, never
 * mutates. An empty list means every known key parses.
 */
export function validateProgramBlob(inner: Record<string, unknown>): BlobIssue[] {
  const issues: BlobIssue[] = [];
  for (const [key, schema] of Object.entries(KNOWN_KEYS)) {
    if (!(key in inner) || inner[key] == null) continue;
    const parsed = schema.safeParse(inner[key]);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issues.push({
        key,
        reason: first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "invalid shape",
      });
    }
  }
  return issues;
}

/**
 * The issues as readable lines — the ONE definition of how a blob issue is
 * written down, so the toast's promise ("details are in the console") is
 * actually kept. Logging the raw array put `[object Object]` in front of the
 * operator: the toast named a place to look, and the place held nothing
 * legible. Each line names the key and the first failing path.
 */
export function formatBlobIssues(issues: readonly BlobIssue[]): string {
  return issues.map((issue) => `  • ${issue.key} — ${issue.reason}`).join("\n");
}

/**
 * Ordered migrations, applied once each on read when the blob's stamped
 * version is behind BLOB_VERSION. Each entry receives the inner root and
 * returns the migrated root. v1 is the baseline — no transforms yet; the
 * scaffold exists so the NEXT shape change is an explicit, tested step.
 */
const MIGRATIONS: Array<(inner: Record<string, unknown>) => Record<string, unknown>> = [
  // v0 → v1: baseline stamp; shapes already match.
  (inner) => inner,
  // v1 → v2: the Frame "stakeholders you already know" seed and the Listen
  // coverage roster were one concept split across two grids. Fold the seed
  // into the roster (the single People list) — deduped by name, existing
  // roster rows and their statuses preserved — then drop the seed.
  (inner) => {
    const phaseInputs = inner.phaseInputs;
    if (typeof phaseInputs !== "object" || phaseInputs === null) return inner;
    const pi = phaseInputs as Record<string, unknown>;
    const frame = typeof pi.frame === "object" && pi.frame !== null ? { ...(pi.frame as Record<string, unknown>) } : null;
    if (!frame || typeof frame.stakeholderSeed !== "string") return inner;
    const parseGrid = (value: unknown): Array<Record<string, unknown>> => {
      if (typeof value !== "string" || !value.trim().startsWith("[")) return [];
      try {
        const rows = JSON.parse(value);
        return Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
      } catch { return []; }
    };
    const seedRows = parseGrid(frame.stakeholderSeed);
    const listen = typeof pi.listen === "object" && pi.listen !== null ? { ...(pi.listen as Record<string, unknown>) } : {};
    const rosterRows = parseGrid((listen as Record<string, unknown>).interviewRoster);
    const seen = new Set(rosterRows.map((r) => String((r as Record<string, unknown>).name ?? "").trim().toLowerCase()).filter(Boolean));
    const additions = seedRows
      .map((row) => row as Record<string, unknown>)
      .filter((row) => {
        const name = String(row.name ?? "").trim();
        return name && !seen.has(name.toLowerCase());
      })
      .map((row) => ({
        name: String(row.name ?? "").trim(),
        role: String(row.role ?? row.domain ?? "").trim(),
        status: "To book",
      }));
    delete frame.stakeholderSeed;
    const nextListen = additions.length || rosterRows.length
      ? { ...(listen as Record<string, unknown>), interviewRoster: JSON.stringify([...rosterRows, ...additions]) }
      : listen;
    return { ...inner, phaseInputs: { ...pi, frame, listen: nextListen } };
  },
];

/** Migrate an inner root to the current version. Pure — returns a new object
 * only when a migration ran or the stamp is missing. */
export function migrateProgramBlob(inner: Record<string, unknown>): { inner: Record<string, unknown>; migrated: boolean } {
  const stamped = typeof inner._blobVersion === "number" ? inner._blobVersion : 0;
  if (stamped >= BLOB_VERSION) return { inner, migrated: false };
  let next = inner;
  for (let version = stamped; version < BLOB_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (step) next = step(next);
  }
  return { inner: { ...next, _blobVersion: BLOB_VERSION }, migrated: true };
}
