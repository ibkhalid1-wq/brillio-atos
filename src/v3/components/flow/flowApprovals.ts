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
import { FLOW_ATTESTATION_CAP } from "@/v3/lib/blobGuard";
import type { PhaseDefinition } from "@/v3/lib/methodology";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import {
  movementOpenIssues, evidenceStamp, flowMovements, stakeholderEmail, movementEvidence, movementArtifacts,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";
import { resolveMovementStakeholders, readDirectoryPeople } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

const APPROVAL_CAP = 40;

export interface FlowApprovalPack {
  id: string;
  token: string;
  artifactId: string;
  movementId: string;
  artifactTitle: string;
  approver: { name: string; role: string; email?: string };
  /** Plain-text render of the artifact, frozen at send — what the approver reads. */
  snapshot?: string;
  createdAt: string;
  respondedAt?: string;
  verdict?: "approved" | "changes";
  comment?: string;
}

const SNAPSHOT_CAP = 40_000;

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

/** Who the operator can pick as approver — everyone on the record with an email
 * on file (the link is emailed/sent to them). Deduped by name, sponsor first. */
export function eligibleApprovers(program: ProgramSummary): Array<{ name: string; role: string; email: string }> {
  const seen = new Map<string, { name: string; role: string; email: string }>();
  const add = (name: string, role: string) => {
    const clean = name.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    const email = stakeholderEmail(program, clean);
    if (email) seen.set(key, { name: clean, role: role.trim(), email });
  };
  for (const movement of flowMovements()) {
    for (const person of resolveMovementStakeholders(program, movement.id)) {
      if (!person.isRole) add(person.name, person.role);
    }
  }
  for (const person of readDirectoryPeople(program)) add(person.name, person.role);
  return [...seen.values()];
}

/** True while any of the movement's stakeholders still owes a response — someone
 * to reach, or a link sent but unanswered. Approval waits until the evidence is
 * in, so a document isn't signed off over an incomplete record. */
export function movementQuestionsPending(program: ProgramSummary, movement: PhaseDefinition): boolean {
  const stakeholders = resolveMovementStakeholders(program, movement.id).filter((s) => !s.isRole);
  if (!stakeholders.length) return false;
  const packs = listInterviewPacks(program);
  const evidence = movementEvidence(program, movement);
  return stakeholders.some((s) => {
    const key = s.name.trim().toLowerCase();
    const pack = [...packs].reverse().find((p) => String(p.stakeholder ?? "").trim().toLowerCase() === key
      && (movement.id === "listen" ? (!p.movementId || p.movementId === "listen") : p.movementId === movement.id));
    const heard = (key.length > 2 && evidence.some((e) => e.who.toLowerCase().includes(key))) || Boolean(pack?.respondedAt);
    return !heard;
  });
}

/** An artifact may be sent for approval once it exists, its own open questions
 * are cleared, AND no stakeholder question is still outstanding — the record is
 * complete enough to sign off. */
export function canSendForApproval(program: ProgramSummary, movement: PhaseDefinition, artifact: ArtifactCardModel): boolean {
  if (!artifact.present) return false;
  if (movementOpenIssues(program, movement).length > 0) return false;
  if (movementQuestionsPending(program, movement)) return false;
  return true;
}

/**
 * The stakeholders whose evidence FED a movement — its relevant approvers.
 * An artifact (the atlas, the ontology) is a synthesis of what these people
 * said, so THEY are who signs it off: approval is per-stakeholder, and the
 * artifact only reads approved when every contributor has approved it.
 */
export function relevantApprovers(program: ProgramSummary, movementId: string): Array<{ name: string; role: string; email?: string }> {
  const movement = flowMovements().find((m) => m.id === movementId);
  if (!movement) return [];
  const evidence = movementEvidence(program, movement);
  return resolveMovementStakeholders(program, movementId)
    .filter((s) => !s.isRole)
    .filter((s) => {
      const key = s.name.trim().toLowerCase();
      // Same attribution matching as the collect board — one source of truth
      // for "this person's evidence is on the record". Exact first-token
      // equality works at any name length; fuzzy paths keep the 3-char floor.
      return evidence.some((e) => {
        const firstToken = e.who.split(",")[0].trim().toLowerCase();
        if (firstToken && firstToken === key) return true;
        return key.length > 2 && (e.who.toLowerCase().includes(key)
          || key.includes(firstToken)
          || (e.kind === "document" && e.meta.toLowerCase().includes(key)));
      });
    })
    .map((s) => ({ name: s.name, role: s.role, email: stakeholderEmail(program, s.name) || undefined }));
}

/**
 * Backfill a responded pack's missing verdict from the artifact record.
 *
 * The edge writes an approver's verdict to BOTH the pack and
 * `phaseArtifacts[movementId][artifactId].approval`. A pack that carries
 * `respondedAt` but no `verdict` (an older pack, or one whose verdict reached
 * the artifact record but never got mirrored onto the pack) would otherwise
 * read forever as "in review, reply received" — stuck. When the recorded
 * verdict belongs to this pack's approver, adopt it so the state resolves.
 */
export function reconcilePackVerdict(
  inner: Record<string, unknown>,
  movementId: string,
  artifactId: string,
  pack: FlowApprovalPack | undefined,
): FlowApprovalPack | undefined {
  if (!pack || pack.verdict || typeof pack.respondedAt !== "string") return pack;
  const phaseArtifacts = isRecord(inner.phaseArtifacts) ? inner.phaseArtifacts as Record<string, unknown> : null;
  const bucket = phaseArtifacts && isRecord(phaseArtifacts[movementId]) ? phaseArtifacts[movementId] as Record<string, unknown> : null;
  const record = bucket && isRecord(bucket[artifactId]) ? bucket[artifactId] as Record<string, unknown> : null;
  const approval = record && isRecord(record.approval) ? record.approval as Record<string, unknown> : null;
  if (!approval) return pack;
  const verdict = approval.verdict === "approved" || approval.verdict === "changes" ? approval.verdict : undefined;
  if (!verdict) return pack;
  const recordedApprover = isRecord(approval.approver) ? String((approval.approver as Record<string, unknown>).name ?? "").trim().toLowerCase() : "";
  const packApprover = String(pack.approver?.name ?? "").trim().toLowerCase();
  // Only adopt when it's the SAME approver (or the record names no approver).
  if (recordedApprover && packApprover && recordedApprover !== packApprover) return pack;
  return {
    ...pack,
    verdict,
    comment: pack.comment ?? (typeof approval.comment === "string" ? approval.comment : undefined),
    respondedAt: pack.respondedAt ?? (typeof approval.decidedAt === "string" ? approval.decidedAt : pack.respondedAt),
  };
}

/** The LATEST approval pack per approver for one artifact — later sends
 * supersede earlier ones, answered or not, as that person's standing ask. */
function latestPacksByApprover(inner: Record<string, unknown>, movementId: string, artifactId: string): Map<string, FlowApprovalPack> {
  const map = new Map<string, FlowApprovalPack>();
  for (const pack of readPacks(inner)) {
    if (String(pack.movementId) !== movementId || String(pack.artifactId) !== artifactId) continue;
    const key = String(pack.approver?.name ?? "").trim().toLowerCase();
    if (!key) continue;
    const held = map.get(key);
    if (!held || String(pack.createdAt) > String(held.createdAt)) map.set(key, pack);
  }
  return map;
}

export interface ApproverState {
  name: string; role: string; email?: string;
  status: ApprovalStatus; token?: string; decidedAt?: string; comment?: string;
  /** The verdict predates the document's CURRENT generation — a sign-off on
   * v1 must not silently bless v3. Re-request to re-validate. */
  preDatesDocument?: boolean;
}

const packState = (pack: FlowApprovalPack | undefined, docGeneratedAt?: string): { status: ApprovalStatus; token?: string; decidedAt?: string; comment?: string; preDatesDocument?: boolean } => {
  if (!pack) return { status: "none" };
  if (pack.verdict === "approved") {
    // An approval recorded BEFORE the document's current generation is stale:
    // still on the record (history), but it cannot count toward "validated".
    const preDatesDocument = Boolean(docGeneratedAt && pack.respondedAt && Date.parse(pack.respondedAt) < Date.parse(docGeneratedAt));
    return { status: "approved", decidedAt: pack.respondedAt, preDatesDocument: preDatesDocument || undefined };
  }
  if (pack.verdict === "changes") return { status: "changes", decidedAt: pack.respondedAt, comment: pack.comment };
  // Answered but verdict-less: an old-contract response whose verdict is still
  // in the inbox awaiting (auto-)ingestion. In review — but NEVER hand the
  // used link out again; the token only rides a genuinely open ask.
  if (pack.respondedAt) return { status: "in-review" };
  return { status: "in-review", token: pack.token };
};

/** The stored document's current generation stamp — the reference point that
 * decides whether a recorded approval still covers what's on the record. */
function documentGeneratedAt(inner: Record<string, unknown>, artifactId: string): string | undefined {
  const fieldKey = FORMAL_ARTIFACT_FIELD_KEYS[artifactId];
  if (!fieldKey) return undefined;
  const doc = inner[fieldKey];
  if (!isRecord(doc)) return undefined;
  const stamp = typeof doc.editedAt === "string" && doc.editedAt ? doc.editedAt : doc.generatedAt;
  return typeof stamp === "string" && stamp ? stamp : undefined;
}

/**
 * An artifact's approval ROLLUP across its relevant stakeholders — the truth
 * the artifact card shows. Approved only when EVERY contributor approved;
 * a single changes-requested outranks everything else.
 */
export function artifactApprovalRollup(program: ProgramSummary, movementId: string, artifactId: string): {
  approvers: ApproverState[]; approvedCount: number; total: number; overall: ApprovalStatus;
} {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const byApprover = latestPacksByApprover(inner, movementId, artifactId);
  const generatedAt = documentGeneratedAt(inner, artifactId);
  const approvers: ApproverState[] = relevantApprovers(program, movementId).map((approver) => ({
    ...approver,
    ...packState(reconcilePackVerdict(inner, movementId, artifactId, byApprover.get(approver.name.trim().toLowerCase())), generatedAt),
  }));
  // A sign-off that predates the current generation is HISTORY, not
  // validation — the document changed after they read it.
  const approvedCount = approvers.filter((a) => a.status === "approved" && !a.preDatesDocument).length;
  const overall: ApprovalStatus = !approvers.length ? "none"
    : approvers.some((a) => a.status === "changes") ? "changes"
      : approvedCount === approvers.length ? "approved"
        : approvers.some((a) => a.status === "in-review") ? "in-review" : "none";
  return { approvers, approvedCount, total: approvers.length, overall };
}

export interface StakeholderApprovalItem {
  artifactId: string; artifactTitle: string;
  status: ApprovalStatus; token?: string; decidedAt?: string; comment?: string;
  /** Their approval predates the current generation — re-request to re-validate. */
  preDatesDocument?: boolean;
}

/** One stakeholder's sign-off queue for a movement — every present artifact
 * with THEIR latest ask/verdict. Drives the approval section of their card. */
export function stakeholderApprovalItems(program: ProgramSummary, movementId: string, stakeholderName: string): StakeholderApprovalItem[] {
  const movement = flowMovements().find((m) => m.id === movementId);
  if (!movement) return [];
  const key = stakeholderName.trim().toLowerCase();
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  return movementArtifacts(program, movement)
    .filter((artifact) => artifact.present)
    .map((artifact) => ({
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      ...packState(reconcilePackVerdict(inner, movementId, artifact.id, latestPacksByApprover(inner, movementId, artifact.id).get(key)), documentGeneratedAt(inner, artifact.id)),
    }));
}

/** The live approval state of an artifact — drives the card chip and the gate.
 * While in review it also carries the live pack `token` so the card can show
 * the link and let the operator copy it again to re-send. */
export function artifactApprovalState(program: ProgramSummary, movementId: string, artifactId: string): {
  status: ApprovalStatus; approver?: { name: string; role: string }; sentAt?: string; decidedAt?: string; comment?: string; token?: string;
} {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const bucket = isRecord(inner.phaseArtifacts) && isRecord((inner.phaseArtifacts as Record<string, unknown>)[movementId])
    ? ((inner.phaseArtifacts as Record<string, Record<string, unknown>>)[movementId]) : {};
  const record = isRecord(bucket[artifactId]) ? bucket[artifactId] as Record<string, unknown> : {};
  const approval = isRecord(record.approval) ? record.approval as Record<string, unknown> : null;
  // The per-contributor rollup is the SAME reconciled truth the card reads (it
  // backfills a verdict-less responded pack from the artifact record). Defer to
  // it for "approved" so the studio, the gate and the card never disagree — a
  // pack whose verdict landed on the record but not on the pack still reads
  // approved here, instead of leaving the artifact stuck "in review".
  if (artifactApprovalRollup(program, movementId, artifactId).overall === "approved") {
    return { status: "approved", approver: approval?.approver as { name: string; role: string } | undefined, decidedAt: approval?.decidedAt as string | undefined };
  }
  if (record.status === "approved") {
    return { status: "approved", approver: approval?.approver as { name: string; role: string } | undefined, decidedAt: approval?.decidedAt as string | undefined };
  }
  if (approval && approval.verdict === "changes") {
    return { status: "changes", approver: approval.approver as { name: string; role: string } | undefined, comment: approval.comment as string | undefined, decidedAt: approval.decidedAt as string | undefined };
  }
  if (approval) {
    // The live (unanswered) pack for this artifact carries the resend link.
    const pack = readPacks(inner).filter((p) => p.artifactId === artifactId && p.movementId === movementId && !p.respondedAt).slice(-1)[0];
    return { status: "in-review", approver: approval.approver as { name: string; role: string } | undefined, sentAt: approval.sentAt as string | undefined, token: pack?.token };
  }
  return { status: "none" };
}

/** Mint an approval request for an artifact. Sets the artifact `in-review`,
 * records the chosen approver, and stashes a secret-token pack. Returns the new
 * blob (the fresh token rides the LAST pack); null if the artifact is missing. */
export function mintApprovalRequest(
  program: ProgramSummary,
  input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string }; snapshot?: string },
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
    snapshot: input.snapshot ? input.snapshot.slice(0, SNAPSHOT_CAP) : undefined,
    createdAt: now,
  };
  // Supersede any earlier open pack for the same artifact AND approver — each
  // relevant stakeholder holds their own live ask, so re-sending to one person
  // never invalidates another's link.
  const packs = readPacks(inner).filter((p) => !(
    p.artifactId === input.artifactId && p.movementId === input.movementId && !p.respondedAt
    && String(p.approver?.name ?? "").trim().toLowerCase() === name.toLowerCase()
  ));

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
    }].slice(-FLOW_ATTESTATION_CAP),
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

  // Stamp the approver's pack with the verdict. Matched on MISSING VERDICT
  // (not missing respondedAt): responses that arrived under the old edge
  // contract already carry respondedAt with the verdict parked on this inbox
  // item — those packs must still receive their verdict here, or the
  // per-stakeholder rollup keeps counting them as awaiting forever.
  const approverKey = approver.name.trim().toLowerCase();
  const packs = readPacks(inner).map((p) =>
    p.artifactId === artifactId && p.movementId === movementId && !p.verdict
      && String(p.approver?.name ?? "").trim().toLowerCase() === approverKey
      ? { ...p, respondedAt: p.respondedAt ?? now, verdict, comment: comment || undefined } : p);

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
    }].slice(-FLOW_ATTESTATION_CAP),
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
