/**
 * Decisions & attestations — the Command Deck's spine, client side.
 *
 * The run-agent edge writes open Tier-2/3 DECISIONS (rawData.flowDecisions)
 * instead of silently applying consequential results on Flow programmes, and
 * appends an ATTESTATION entry (rawData.flowAttestations) for every applied
 * run. This module reads both, derives the "next moments" agenda, and builds
 * the full next-data blob a confirm/decline writes back (the resolver is pure —
 * the caller persists via updateProgramData, the app's standard write path).
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { readMovementInputs, parseGridRows } from "@/v3/components/flow/flowShellData";
import { listFollowUps } from "@/v3/components/flow/flowMeetings";

export interface FlowDecision {
  id: string;
  tier: 2 | 3;
  status: "open" | "confirmed" | "declined";
  agentId: string;
  movementId: string;
  title: string;
  summary: string;
  blocking: string;
  recommendation: { action: string; rationale: string; band: string } | null;
  /** Ready-to-merge payload the edge prepared (e.g. { dynamicSchema }). */
  payload: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface FlowAttestation {
  ts: string;
  agentId: string;
  phaseId: string;
  tier: 1 | 2 | 3;
  action: string;
  detail?: string;
}

export interface NextMoment {
  date: string;
  label: string;
  kind: "demo" | "session" | "target";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

export function listFlowDecisions(program: ProgramSummary): FlowDecision[] {
  const list = innerData(program).flowDecisions;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowDecision => ({
    id: String(entry.id ?? ""),
    tier: entry.tier === 3 ? 3 : 2,
    status: entry.status === "confirmed" || entry.status === "declined" ? entry.status : "open",
    agentId: String(entry.agentId ?? "agent"),
    movementId: String(entry.movementId ?? ""),
    title: String(entry.title ?? "Decision"),
    summary: String(entry.summary ?? ""),
    blocking: String(entry.blocking ?? ""),
    recommendation: isRecord(entry.recommendation)
      ? {
          action: String(entry.recommendation.action ?? ""),
          rationale: String(entry.recommendation.rationale ?? ""),
          band: String(entry.recommendation.band ?? ""),
        }
      : null,
    payload: isRecord(entry.payload) ? entry.payload : null,
    createdAt: String(entry.createdAt ?? ""),
    resolvedAt: typeof entry.resolvedAt === "string" ? entry.resolvedAt : undefined,
    resolvedBy: typeof entry.resolvedBy === "string" ? entry.resolvedBy : undefined,
  })).filter((decision) => decision.id);
}

export function listOpenFlowDecisions(program: ProgramSummary): FlowDecision[] {
  return listFlowDecisions(program).filter((decision) => decision.status === "open");
}

export function listFlowAttestations(program: ProgramSummary): FlowAttestation[] {
  const list = innerData(program).flowAttestations;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowAttestation => ({
    ts: String(entry.ts ?? ""),
    agentId: String(entry.agentId ?? "agent"),
    phaseId: String(entry.phaseId ?? ""),
    tier: entry.tier === 3 ? 3 : entry.tier === 2 ? 2 : 1,
    action: String(entry.action ?? ""),
    detail: typeof entry.detail === "string" ? entry.detail : undefined,
  })).filter((entry) => entry.ts).reverse(); // newest first
}

/**
 * Resolve a decision and return the FULL next data blob to persist via
 * updateProgramData. Confirming merges the edge-prepared payload (per-phase
 * dynamicSchema entries) additively; declining only marks the record. Both
 * append their own attestation — human resolutions are on the record too.
 */
export function resolveFlowDecision(
  program: ProgramSummary,
  decisionId: string,
  resolution: "confirmed" | "declined",
  resolvedBy: string,
): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.flowDecisions) ? (inner.flowDecisions as unknown[]) : [];
  const target = list.filter(isRecord).find((entry) => entry.id === decisionId);
  if (!target || (target.status !== "open" && target.status !== undefined)) return null;

  const now = new Date().toISOString();
  const nextDecisions = list.map((entry) =>
    isRecord(entry) && entry.id === decisionId
      ? { ...entry, status: resolution, resolvedAt: now, resolvedBy }
      : entry,
  );

  let nextInner: Record<string, unknown> = { ...inner, flowDecisions: nextDecisions };

  // Apply the prepared payload on confirm. dynamicSchema merges per top-level
  // section, per phase — additive, never clobbering other phases' entries.
  const payload = isRecord(target.payload) ? target.payload : null;
  if (resolution === "confirmed" && payload && isRecord(payload.dynamicSchema)) {
    const incoming = payload.dynamicSchema as Record<string, unknown>;
    const current = isRecord(nextInner.dynamicSchema) ? (nextInner.dynamicSchema as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...current };
    for (const [section, value] of Object.entries(incoming)) {
      merged[section] = isRecord(value) && isRecord(current[section])
        ? { ...(current[section] as Record<string, unknown>), ...value }
        : value;
    }
    nextInner.dynamicSchema = merged;
  }

  // Track plans merge by id: new tracks append, existing ones keep their
  // show/refine record (a re-adopted plan must never erase demonstrations).
  if (resolution === "confirmed" && payload && Array.isArray(payload.tracks)) {
    const current = Array.isArray(nextInner.tracks) ? (nextInner.tracks as unknown[]) : [];
    const currentIds = new Set(current.filter(isRecord).map((t) => String(t.id ?? "")));
    const additions = payload.tracks.filter(isRecord).filter((t) => t.id && !currentIds.has(String(t.id)));
    if (additions.length) nextInner = { ...nextInner, tracks: [...current, ...additions].slice(-24) };
  }

  // Standard-vocabulary mappings merge additively by entity — re-adopting
  // never erases a previously confirmed alignment.
  if (resolution === "confirmed" && payload && Array.isArray(payload.ontologyAlignment)) {
    const current = Array.isArray(nextInner.ontologyAlignment) ? (nextInner.ontologyAlignment as unknown[]) : [];
    const known = new Set(current.filter(isRecord).map((m) => String(m.entity ?? "").toLowerCase()));
    const additions = payload.ontologyAlignment.filter(isRecord)
      .filter((m) => m.entity && !known.has(String(m.entity).toLowerCase()))
      .map((m) => ({ ...m, adoptedAt: now }));
    if (additions.length) nextInner = { ...nextInner, ontologyAlignment: [...current, ...additions].slice(-60) };
  }

  // Regenerated documents the guard held back (the mirror was hand-edited):
  // confirming REPLACES the mirror with the fresh generation — that is the
  // decision being made — and lands the matching ledger stub so presence,
  // confidence and the staleness fingerprint read as if it had been written
  // at generation time.
  if (resolution === "confirmed" && payload && isRecord(payload.artifactDocs)) {
    for (const [fieldKey, doc] of Object.entries(payload.artifactDocs as Record<string, unknown>)) {
      if (fieldKey && isRecord(doc)) nextInner = { ...nextInner, [fieldKey]: doc };
    }
  }
  if (resolution === "confirmed" && payload && Array.isArray(payload.artifactStubs)) {
    for (const stub of payload.artifactStubs.filter(isRecord)) {
      const phaseId = String(stub.phaseId ?? "");
      const artifactId = String(stub.artifactId ?? "");
      if (!phaseId || !artifactId || !isRecord(stub.record)) continue;
      const buckets = isRecord(nextInner.phaseArtifacts) ? { ...(nextInner.phaseArtifacts as Record<string, unknown>) } : {};
      const bucket = isRecord(buckets[phaseId]) ? { ...(buckets[phaseId] as Record<string, unknown>) } : {};
      const existing = isRecord(bucket[artifactId]) ? (bucket[artifactId] as Record<string, unknown>) : {};
      bucket[artifactId] = { ...existing, ...stub.record };
      buckets[phaseId] = bucket;
      nextInner = { ...nextInner, phaseArtifacts: buckets };
    }
  }

  // Governance payloads (e.g. the cap-raise the budget gate queues) merge
  // shallowly, with movement budgets folded per movement.
  if (resolution === "confirmed" && payload && isRecord(payload.flowGovernance)) {
    const incoming = payload.flowGovernance as Record<string, unknown>;
    const current = isRecord(nextInner.flowGovernance) ? (nextInner.flowGovernance as Record<string, unknown>) : {};
    const budgets = {
      ...(isRecord(current.movementBudgets) ? current.movementBudgets : {}),
      ...(isRecord(incoming.movementBudgets) ? incoming.movementBudgets : {}),
    };
    nextInner = { ...nextInner, flowGovernance: { ...current, ...incoming, movementBudgets: budgets } };
  }

  const attestation = {
    ts: now,
    agentId: resolvedBy,
    phaseId: String(target.movementId ?? ""),
    tier: target.tier === 3 ? 3 : 2,
    action: `${resolution === "confirmed" ? "Confirmed" : "Declined"}: ${String(target.title ?? "decision")}`,
  };
  const log = Array.isArray(nextInner.flowAttestations) ? (nextInner.flowAttestations as unknown[]) : [];
  nextInner = { ...nextInner, flowAttestations: [...log, attestation].slice(-200) };

  return wrapProgramState(wrapper, nextInner, usesNestedData);
}

/** One concrete effect a confirm applies — target, effect, entries. */
export interface DecisionChange {
  target: string;
  effect: string;
  rows: string[];
}

const CHANGE_META_KEYS = new Set(["generatedAt", "inputsFingerprint", "confidence", "editedAt", "editedBy", "summary"]);

function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function shortUri(value: unknown): string {
  const uri = String(value ?? "");
  return uri.replace(/^https?:\/\/(www\.)?/, "");
}

/**
 * What a confirm ACTUALLY changes — derived from the payload with the same
 * semantics resolveFlowDecision applies (additive merges skip what's already
 * adopted; document payloads replace the mirror). Keep the two in lockstep:
 * this is the preview of that function, shown before the user judges.
 */
export function describeDecisionChanges(program: ProgramSummary, decision: FlowDecision): DecisionChange[] {
  const payload = decision.payload;
  if (!payload) return [];
  const inner = innerData(program);
  const changes: DecisionChange[] = [];

  if (Array.isArray(payload.ontologyAlignment)) {
    const current = Array.isArray(inner.ontologyAlignment) ? (inner.ontologyAlignment as unknown[]) : [];
    const known = new Set(current.filter(isRecord).map((m) => String(m.entity ?? "").toLowerCase()));
    const incoming = payload.ontologyAlignment.filter(isRecord);
    const additions = incoming.filter((m) => m.entity && !known.has(String(m.entity).toLowerCase()));
    const skipped = incoming.length - additions.length;
    changes.push({
      target: "Domain Ontology — standard mappings",
      effect: additions.length
        ? `${additions.length} mapping${additions.length === 1 ? " merges" : "s merge"} additively${skipped ? ` · ${skipped} already adopted, untouched` : ""}`
        : "every mapping is already adopted — nothing changes",
      rows: additions.slice(0, 8).map((m) => {
        const pct = typeof m.confidence === "number" ? ` · ${Math.round(m.confidence * 100)}%` : "";
        return `${String(m.entity)} → ${shortUri(m.standard)} (${String(m.relation ?? "").replace(/^skos:/, "")}${pct})`;
      }),
    });
  }

  if (isRecord(payload.artifactDocs)) {
    for (const [fieldKey, doc] of Object.entries(payload.artifactDocs as Record<string, unknown>)) {
      if (!isRecord(doc)) continue;
      const existing = isRecord(inner[fieldKey]) ? (inner[fieldKey] as Record<string, unknown>) : null;
      const sections = (record: Record<string, unknown>) => Object.keys(record).filter((k) => !CHANGE_META_KEYS.has(k));
      if (!existing) {
        changes.push({ target: humanizeKey(fieldKey), effect: "lands as a new document", rows: [] });
        continue;
      }
      const nextKeys = sections(doc);
      const prevKeys = sections(existing);
      const rows: string[] = [];
      for (const key of nextKeys) {
        if (!prevKeys.includes(key)) rows.push(`${humanizeKey(key)} — added`);
        else if (JSON.stringify(existing[key]) !== JSON.stringify(doc[key])) rows.push(`${humanizeKey(key)} — rewritten`);
      }
      for (const key of prevKeys) {
        if (!nextKeys.includes(key)) rows.push(`${humanizeKey(key)} — removed (the current section, hand edits included, goes)`);
      }
      changes.push({
        target: humanizeKey(fieldKey),
        effect: rows.length
          ? `replaces the current document — ${rows.length} section${rows.length === 1 ? "" : "s"} differ`
          : "replaces the current document — sections identical, provenance re-stamped",
        rows: rows.slice(0, 8),
      });
    }
  }

  if (isRecord(payload.dynamicSchema)) {
    const incoming = payload.dynamicSchema as Record<string, unknown>;
    changes.push({
      target: "Working schema",
      effect: "sections merge — existing fields keep their values",
      rows: Object.entries(incoming).slice(0, 8).map(([section, value]) =>
        `${humanizeKey(section)} — ${isRecord(value) ? `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"} merge` : "replaced"}`),
    });
  }

  if (Array.isArray(payload.tracks)) {
    const current = Array.isArray(inner.tracks) ? (inner.tracks as unknown[]) : [];
    const currentIds = new Set(current.filter(isRecord).map((t) => String(t.id ?? "")));
    const additions = payload.tracks.filter(isRecord).filter((t) => t.id && !currentIds.has(String(t.id)));
    changes.push({
      target: "Track plan",
      effect: additions.length
        ? `${additions.length} track${additions.length === 1 ? "" : "s"} append — adopted tracks keep their record`
        : "every track already adopted — nothing changes",
      rows: additions.slice(0, 8).map((t) => String(t.name ?? t.title ?? t.id)),
    });
  }

  if (isRecord(payload.flowGovernance)) {
    const incoming = payload.flowGovernance as Record<string, unknown>;
    const budgets = isRecord(incoming.movementBudgets) ? (incoming.movementBudgets as Record<string, unknown>) : {};
    changes.push({
      target: "Governance",
      effect: "settings merge",
      rows: [
        ...Object.entries(incoming).filter(([k]) => k !== "movementBudgets").map(([k, v]) => `${humanizeKey(k)} → ${String(v)}`),
        ...Object.entries(budgets).map(([movement, v]) => `${humanizeKey(movement)} budget → ${String(v)}`),
      ].slice(0, 8),
    });
  }

  return changes;
}

/** The human moments ahead: booked sessions, pending demos, the demo target. */
export function listNextMoments(program: ProgramSummary): NextMoment[] {
  const moments: NextMoment[] = [];
  const frame = readMovementInputs(program, "frame");
  if (typeof frame.targetFirstDemoDate === "string" && frame.targetFirstDemoDate) {
    moments.push({ date: frame.targetFirstDemoDate, label: "First-demonstration target", kind: "target" });
  }
  for (const row of parseGridRows(readMovementInputs(program, "listen").interviewRoster)) {
    if (/booked/i.test(row.status ?? "") && row.date) {
      moments.push({ date: row.date, label: `${row.name || "Stakeholder"} — discovery session`, kind: "session" });
    }
  }
  for (const row of parseGridRows(readMovementInputs(program, "show").demoTour)) {
    if (/pending/i.test(row.verdict ?? "Pending") && row.date) {
      moments.push({ date: row.date, label: `${row.stakeholder || "Stakeholder"} — demonstration`, kind: "demo" });
    }
  }
  for (const followUp of listFollowUps(program)) {
    moments.push({ date: followUp.date, label: `${followUp.who} — follow-up (${followUp.movementId})`, kind: "session" });
  }
  return moments.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
}
