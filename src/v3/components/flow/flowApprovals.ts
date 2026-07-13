/**
 * Artifact approval — send a generated artifact to a chosen approver, who
 * signs off (or asks for changes) over a no-login link, and record the sign-off
 * as first-class evidence.
 *
 * The rails mirror the sponsor brief / interview pack: a secret token rides an
 * approval pack in the blob; the public flow-portal edge serves the artifact to
 * the holder and posts their verdict back into `flowPortalInbox` (kind
 * "approval"); the operator records it, which flips the artifact to `approved`
 * and derives an evidence entry from the pack. Split into a pure client core
 * (this file, phases A/B) and the edge route (phase C).
 */
import type { ProgramSummary } from "@/new/types";
import type { PhaseDefinition } from "@/v3/lib/methodology";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import {
  movementOpenIssues, evidenceStamp,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";

const APPROVAL_CAP = 40;

export interface FlowApprovalPack {
  id: string;
  token: string;
  artifactId: string;
  movementId: string;
  artifactTitle: string;
  approver: { name: string; role: string; email?: string };
  createdAt: string;
  respondedAt?: string;
  verdict?: "approved" | "changes";
  comment?: string;
}

export type ApprovalStatus = "none" | "in-review" | "approved" | "changes";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function randomSecret(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPacks(inner: Record<string, unknown>): FlowApprovalPack[] {
  return Array.isArray(inner.flowApprovalPacks)
    ? (inner.flowApprovalPacks as unknown[]).filter(isRecord) as unknown as FlowApprovalPack[]
    : [];
}

/** An artifact may be sent for approval once it exists and the movement's open
 * interview questions are cleared — the record is complete enough to sign off. */
export function canSendForApproval(program: ProgramSummary, movement: PhaseDefinition, artifact: ArtifactCardModel): boolean {
  if (!artifact.present) return false;
  return movementOpenIssues(program, movement).length === 0;
}

/** The live approval state of an artifact — drives the card chip and the gate. */
export function artifactApprovalState(program: ProgramSummary, movementId: string, artifactId: string): {
  status: ApprovalStatus; approver?: { name: string; role: string }; sentAt?: string; decidedAt?: string; comment?: string;
} {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const bucket = isRecord(inner.phaseArtifacts) && isRecord((inner.phaseArtifacts as Record<string, unknown>)[movementId])
    ? ((inner.phaseArtifacts as Record<string, Record<string, unknown>>)[movementId]) : {};
  const record = isRecord(bucket[artifactId]) ? bucket[artifactId] as Record<string, unknown> : {};
  const approval = isRecord(record.approval) ? record.approval as Record<string, unknown> : null;
  if (record.status === "approved") {
    return { status: "approved", approver: approval?.approver as { name: string; role: string } | undefined, decidedAt: approval?.decidedAt as string | undefined };
  }
  if (approval && approval.verdict === "changes") {
    return { status: "changes", approver: approval.approver as { name: string; role: string } | undefined, comment: approval.comment as string | undefined, decidedAt: approval.decidedAt as string | undefined };
  }
  if (approval) {
    return { status: "in-review", approver: approval.approver as { name: string; role: string } | undefined, sentAt: approval.sentAt as string | undefined };
  }
  return { status: "none" };
}

/** Mint an approval request for an artifact. Sets the artifact `in-review`,
 * records the chosen approver, and stashes a secret-token pack. Returns the new
 * blob (the fresh token rides the LAST pack); null if the artifact is missing. */
export function mintApprovalRequest(
  program: ProgramSummary,
  input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string } },
  actor: string,
): Record<string, unknown> | null {
  const name = input.approver.name.trim();
  if (!name || !input.artifactId || !input.movementId) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const now = new Date().toISOString();
  const approver = { name, role: input.approver.role.trim(), email: input.approver.email?.trim() || undefined };
  const pack: FlowApprovalPack = {
    id: `approval-${randomSecret().slice(0, 10)}`,
    token: randomSecret(),
    artifactId: input.artifactId,
    movementId: input.movementId,
    artifactTitle: input.artifactTitle,
    approver,
    createdAt: now,
  };
  // Supersede any earlier open pack for the same artifact (re-send after edits).
  const packs = readPacks(inner).filter((p) => !(p.artifactId === input.artifactId && p.movementId === input.movementId && !p.respondedAt));

  const phaseArtifacts = isRecord(inner.phaseArtifacts) ? { ...(inner.phaseArtifacts as Record<string, unknown>) } : {};
  const bucket = isRecord(phaseArtifacts[input.movementId]) ? { ...(phaseArtifacts[input.movementId] as Record<string, unknown>) } : {};
  const record = isRecord(bucket[input.artifactId]) ? { ...(bucket[input.artifactId] as Record<string, unknown>) } : {};
  record.status = "in-review";
  record.approval = { approver, sentAt: now };
  bucket[input.artifactId] = record;
  phaseArtifacts[input.movementId] = bucket;

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowApprovalPacks: [...packs, pack].slice(-APPROVAL_CAP),
    phaseArtifacts,
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: input.movementId, tier: 2,
      action: `Sent for approval — ${input.artifactTitle}`,
      detail: `Awaiting ${approver.name}${approver.role ? ` (${approver.role})` : ""}'s sign-off.`,
    }].slice(-200),
  }, usesNestedData);
}

/** The no-login approval link the operator sends. */
export function approvalLinkFor(programId: string, pack: { token: string }): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?flowApprove=${encodeURIComponent(`${programId}.${pack.token}`)}`;
}

/** Incoming approver verdicts waiting in the quarantine inbox. */
export function listApprovalResponses(program: ProgramSummary): Array<Record<string, unknown>> {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]).filter(isRecord) : [];
  return inbox.filter((item) => item.kind === "approval");
}

/**
 * Record an approver's verdict from the quarantine inbox. On approval, the
 * artifact flips to `approved` (feeding the gate) and the sign-off is stamped on
 * its pack — the source `approvalEvidenceEntries` derives evidence from. A
 * changes verdict returns the artifact to draft with the approver's note. The
 * inbox item is consumed either way. Returns the new blob, or null if not found.
 */
export function ingestApprovalResponse(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]).filter(isRecord) : [];
  const item = inbox.find((entry) => entry.id === itemId && entry.kind === "approval");
  if (!item) return null;
  const artifactId = String(item.artifactId ?? "");
  const movementId = String(item.movementId ?? "");
  const artifactTitle = String(item.artifactTitle ?? artifactId);
  const verdict = item.verdict === "approved" ? "approved" : "changes";
  const comment = String(item.comment ?? "").trim();
  const approver = isRecord(item.approver)
    ? { name: String((item.approver as Record<string, unknown>).name ?? "Approver"), role: String((item.approver as Record<string, unknown>).role ?? "") }
    : { name: "Approver", role: "" };
  const now = new Date().toISOString();

  const phaseArtifacts = isRecord(inner.phaseArtifacts) ? { ...(inner.phaseArtifacts as Record<string, unknown>) } : {};
  const bucket = isRecord(phaseArtifacts[movementId]) ? { ...(phaseArtifacts[movementId] as Record<string, unknown>) } : {};
  const record = isRecord(bucket[artifactId]) ? { ...(bucket[artifactId] as Record<string, unknown>) } : {};
  record.status = verdict === "approved" ? "approved" : "draft";
  record.approval = { approver, verdict, decidedAt: now, comment: comment || undefined };
  bucket[artifactId] = record;
  phaseArtifacts[movementId] = bucket;

  const packs = readPacks(inner).map((p) =>
    p.artifactId === artifactId && p.movementId === movementId && !p.respondedAt
      ? { ...p, respondedAt: now, verdict, comment: comment || undefined } : p);

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    phaseArtifacts,
    flowApprovalPacks: packs,
    flowPortalInbox: inbox.filter((entry) => entry.id !== itemId),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: movementId, tier: 2,
      action: verdict === "approved" ? `Approved — ${artifactTitle}` : `Changes requested — ${artifactTitle}`,
      detail: `${approver.name}${approver.role ? ` (${approver.role})` : ""}${comment ? ` — “${comment.slice(0, 120)}”` : ""}`,
    }].slice(-200),
  }, usesNestedData);
}

/**
 * Approved sign-offs, projected as evidence — the approval "recorded as
 * evidence". Derived from the packs (not a transcript field), so it stays a
 * first-class record without polluting the movement's conversation capture.
 */
export function approvalEvidenceEntries(program: ProgramSummary, movementId: string): EvidenceEntry[] {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  return readPacks(inner)
    .filter((p) => p.movementId === movementId && p.verdict === "approved")
    .map((p) => {
      const when = evidenceStamp(p.respondedAt ? new Date(p.respondedAt) : undefined);
      const statement = `${p.approver.name}${p.approver.role ? ` (${p.approver.role})` : ""} approved “${p.artifactTitle}”.${p.comment ? ` ${p.comment}` : ""}`;
      return {
        id: `ev-approval-${p.id}`,
        movementId,
        fieldLabel: "Approval",
        who: `${p.approver.name}, ${p.approver.role || "Approver"}`,
        meta: `sign-off · ${when}`,
        words: statement.split(/\s+/).length,
        excerpt: statement.slice(0, 160),
        kind: "reference",
        text: `— ${p.approver.name}, ${p.approver.role || "Approver"} (Approver), ${when} —\n${statement}`,
        capturedAt: when,
      } satisfies EvidenceEntry;
    });
}
