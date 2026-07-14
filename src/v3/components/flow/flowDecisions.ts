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
import { buildDemoInviteFromScript } from "@/v3/components/flow/flowPortal";

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

  // Track plans merge by id: new tracks append; existing ones REFRESH their
  // metadata (name, goal, slices, lead) from the incoming plan while keeping
  // their show/refine record — a re-adopted plan must never erase
  // demonstrations, but it should correct what a better generation knows.
  if (resolution === "confirmed" && payload && Array.isArray(payload.tracks)) {
    const current = Array.isArray(nextInner.tracks) ? (nextInner.tracks as unknown[]) : [];
    const incomingById = new Map(payload.tracks.filter(isRecord).filter((t) => t.id).map((t) => [String(t.id), t]));
    const refreshed = current.map((track) => {
      if (!isRecord(track)) return track;
      const incoming = incomingById.get(String(track.id ?? ""));
      if (!incoming) return track;
      incomingById.delete(String(track.id ?? ""));
      return {
        ...track,
        name: incoming.name ?? track.name,
        goal: incoming.goal ?? track.goal,
        slices: Array.isArray(incoming.slices) ? incoming.slices : track.slices,
        dependsOn: Array.isArray(incoming.dependsOn) ? incoming.dependsOn : track.dependsOn,
        leadStakeholder: incoming.leadStakeholder ?? track.leadStakeholder,
      };
    });
    const additions = [...incomingById.values()];
    if (additions.length || payload.tracks.length) {
      nextInner = { ...nextInner, tracks: [...refreshed, ...additions].slice(-24) };
    }
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

  // Watcher roster additions: voices the record quotes join the coverage
  // ledger as Heard — their words are already on the record. Additive and
  // deduped by name; existing rows are never touched.
  if (resolution === "confirmed" && payload && Array.isArray(payload.rosterAdditions)) {
    const phaseInputs = isRecord(nextInner.phaseInputs) ? { ...(nextInner.phaseInputs as Record<string, unknown>) } : {};
    const bucket = isRecord(phaseInputs.listen) ? { ...(phaseInputs.listen as Record<string, unknown>) } : {};
    const rows = parseGridRows(bucket.interviewRoster);
    const known = new Set(rows.map((row) => String(row.name ?? "").trim().toLowerCase()));
    const additions = payload.rosterAdditions.filter(isRecord)
      .filter((entry) => entry.name && !known.has(String(entry.name).trim().toLowerCase()))
      .map((entry) => ({ name: String(entry.name), role: String(entry.role ?? ""), status: "Heard" }));
    if (additions.length) {
      bucket.interviewRoster = JSON.stringify([...rows, ...additions]);
      phaseInputs.listen = bucket;
      nextInner = { ...nextInner, phaseInputs };
    }
  }

  // Re-demo invites: iterate-until-approval's engine. For each named
  // stakeholder, retire their unanswered invite (the old link dies) and mint
  // a fresh one from their current demo script — so a rework verdict always
  // has a road back to the room.
  if (resolution === "confirmed" && payload && Array.isArray(payload.reDemoStakeholders)) {
    const doc = isRecord(nextInner.demoScripts) ? nextInner.demoScripts : null;
    const scripts = doc && Array.isArray((doc as Record<string, unknown>).scripts)
      ? ((doc as Record<string, unknown>).scripts as unknown[]).filter(isRecord)
      : [];
    const names = payload.reDemoStakeholders.map((name) => String(name).trim().toLowerCase()).filter(Boolean);
    if (scripts.length && names.length) {
      const invites = Array.isArray(nextInner.flowDemoInvites) ? (nextInner.flowDemoInvites as unknown[]) : [];
      const kept = invites.filter((invite) => !(isRecord(invite)
        && names.includes(String(invite.stakeholder ?? "").trim().toLowerCase())
        && typeof invite.respondedAt !== "string"));
      const fresh = names
        .map((name) => scripts.find((script) => String(script.stakeholder ?? "").trim().toLowerCase() === name))
        .filter((script): script is Record<string, unknown> => !!script)
        .map((script) => buildDemoInviteFromScript(script, now));
      if (fresh.length) nextInner = { ...nextInner, flowDemoInvites: [...kept, ...fresh].slice(-30) };
    }
  }

  // Contradiction entries file as OPEN rows in Listen's log — the gate
  // re-asks the question; the disputed documents re-derive on regeneration.
  if (resolution === "confirmed" && payload && Array.isArray(payload.contradictionEntries)) {
    const phaseInputs = isRecord(nextInner.phaseInputs) ? { ...(nextInner.phaseInputs as Record<string, unknown>) } : {};
    const bucket = isRecord(phaseInputs.listen) ? { ...(phaseInputs.listen as Record<string, unknown>) } : {};
    const rows = parseGridRows(bucket.contradictionLog);
    // Don't file a contradiction that's already logged — the detector can
    // re-propose the same dispute across runs, and appending it again would
    // grow duplicate "Open" rows that the gate keeps re-asking.
    const loggedStatements = rows.map((row) => String(row.statement ?? "").trim().toLowerCase()).filter((s) => s.length >= 8);
    const isLogged = (statement: string): boolean => {
      const s = statement.trim().toLowerCase();
      return s.length >= 8 && loggedStatements.some((logged) => logged.includes(s) || s.includes(logged));
    };
    const additions = payload.contradictionEntries.filter(isRecord)
      .filter((entry) => entry.statement && !isLogged(String(entry.statement)))
      .map((entry) => ({
        statement: String(entry.statement),
        between: String(entry.between ?? ""),
        positions: String(entry.positions ?? ""),
        status: `Open — filed ${now.slice(0, 10)}`,
      }));
    if (additions.length) {
      bucket.contradictionLog = JSON.stringify([...rows, ...additions]);
      phaseInputs.listen = bucket;
      nextInner = { ...nextInner, phaseInputs };
    }
  }

  // Evidence appends: attributed blocks landing on a movement's capture field
  // (the retro-attribution watcher's payload — a late-added stakeholder's
  // voice, lifted out of already-attached documents on confirm).
  if (resolution === "confirmed" && payload && Array.isArray(payload.evidenceAppends)) {
    const phaseInputs = isRecord(nextInner.phaseInputs) ? { ...(nextInner.phaseInputs as Record<string, unknown>) } : {};
    let touched = false;
    for (const append of payload.evidenceAppends.filter(isRecord)) {
      const movementId = String(append.movementId ?? "");
      const field = String(append.field ?? "");
      const block = String(append.block ?? "");
      if (!movementId || !field || !block.trim()) continue;
      const bucket = isRecord(phaseInputs[movementId]) ? { ...(phaseInputs[movementId] as Record<string, unknown>) } : {};
      const existing = typeof bucket[field] === "string" ? (bucket[field] as string) : "";
      bucket[field] = [existing.trimEnd(), block].filter(Boolean).join("\n\n");
      phaseInputs[movementId] = bucket;
      touched = true;
    }
    if (touched) nextInner = { ...nextInner, phaseInputs };
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

/**
 * Per-section difference between two versions of a structured document —
 * the same rows the Inbox previews and the studio's what-changed band show.
 */
export function docSectionDiff(prev: Record<string, unknown> | null, next: Record<string, unknown>): string[] {
  const sections = (record: Record<string, unknown>) => Object.keys(record).filter((k) => !CHANGE_META_KEYS.has(k) && !k.startsWith("_"));
  if (!prev) return ["New document"];
  const nextKeys = sections(next);
  const prevKeys = sections(prev);
  const rows: string[] = [];
  for (const key of nextKeys) {
    if (!prevKeys.includes(key)) rows.push(`${humanizeKey(key)} — added`);
    else if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) rows.push(`${humanizeKey(key)} — rewritten`);
  }
  for (const key of prevKeys) {
    if (!nextKeys.includes(key)) rows.push(`${humanizeKey(key)} — removed`);
  }
  return rows;
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

  if (Array.isArray(payload.rosterAdditions)) {
    const rows = parseGridRows(readMovementInputs(program, "listen").interviewRoster);
    const known = new Set(rows.map((row) => String(row.name ?? "").trim().toLowerCase()));
    const incoming = payload.rosterAdditions.filter(isRecord);
    const additions = incoming.filter((entry) => entry.name && !known.has(String(entry.name).trim().toLowerCase()));
    const skipped = incoming.length - additions.length;
    changes.push({
      target: "Coverage ledger",
      effect: additions.length
        ? `${additions.length} voice${additions.length === 1 ? "" : "s"} join as Heard${skipped ? ` · ${skipped} already mapped, untouched` : ""}`
        : "every voice is already mapped — nothing changes",
      rows: additions.slice(0, 8).map((entry) => [String(entry.name), String(entry.role ?? "")].filter(Boolean).join(" — ")),
    });
  }

  if (Array.isArray(payload.reDemoStakeholders)) {
    const names = payload.reDemoStakeholders.map(String).filter(Boolean);
    changes.push({
      target: "Demo links",
      effect: `${names.length} fresh link${names.length === 1 ? "" : "s"} mint from the current scripts — old unanswered links stop working`,
      rows: names.slice(0, 8),
    });
  }

  if (Array.isArray(payload.contradictionEntries)) {
    const entries = payload.contradictionEntries.filter(isRecord).filter((entry) => entry.statement);
    changes.push({
      target: "Contradiction log (Listen)",
      effect: `${entries.length} open row${entries.length === 1 ? "" : "s"} file — Listen's gate re-asks until resolved`,
      rows: entries.slice(0, 6).map((entry) => `${String(entry.statement)}${entry.between ? ` (${String(entry.between)})` : ""}`.slice(0, 110)),
    });
  }

  if (Array.isArray(payload.evidenceAppends)) {
    const appends = payload.evidenceAppends.filter(isRecord);
    changes.push({
      target: "Stakeholder evidence",
      effect: `${appends.length} attributed passage${appends.length === 1 ? "" : "s"} lift out of already-attached documents`,
      rows: appends.slice(0, 6).map((append) => `${String(append.movementId)}: ${String(append.block ?? "").split("\n")[0].slice(0, 96)}`),
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
