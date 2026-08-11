/**
 * The DESIGN REVIEW ROUND — the Design Loop's closing act, as data.
 *
 * The operator builds the architecture, the blueprint and the prototype; then the
 * prototype (and the demo scripts cut from it) go to the stakeholders — jointly in a
 * meeting, or each on their own link — and the phase closes when every one of them has
 * approved. A ROUND is that ask, made first-class: which design it is about, who was
 * asked, and what each of them said. Rounds are ORDERED, so round 2 supersedes round 1
 * and the iteration is visible instead of overwriting the history.
 *
 * WHY IT LIVES HERE and not under `lib/ledger/`: nothing in this module touches the
 * frozen ledger core (`store`/`types`/`precedence`/`projections`). It is a pure blob
 * transform over the programme's rawData, exactly like its siblings `flowApprovals.ts`
 * and `flowPortal.ts`, and it reuses their rails (`flowInterviewPacks` for the links,
 * `flowPortalInbox` for quarantined responses, `flowAttestations` for the log). Putting
 * it beside them keeps the dependency arrow pointing one way: this module imports NO
 * runtime from `flowShellData`, so `flowShellData` can import the gate from here
 * without a cycle.
 *
 * TWO INVARIANTS carry this file. Read them before changing anything:
 *
 *   (a) SELF-ATTESTED ≠ OPERATOR-ATTESTED. "Priya clicked approve on her link" and
 *       "Priya approved in the meeting" are both legitimate, and they are NOT the same
 *       evidence. Every recorded verdict carries `attestation`, it is never defaulted,
 *       an operator capture can never overwrite a self-attested answer, and the two are
 *       counted separately in the rollup so no surface can report a total that hides
 *       the split. Conflating them fabricates consent. (This module writes NOTHING to
 *       the Listen roster — only a genuine stakeholder answer ticks `heard`, and that
 *       stays the portal ingest's job.)
 *
 *   (b) "EVERYONE APPROVED" HAS A DEFINED FAILURE STATE. One unreachable person must
 *       not stall the phase silently forever. The escape is on the record: WAIVE with a
 *       reason, or DELEGATE to a named other (who joins the roster and must answer in
 *       their place). Both stay visible in the rollup. There is deliberately no verb
 *       that REMOVES a participant — the roster only ever grows — so the gate can never
 *       be reached by quietly dropping the person who hasn't replied.
 */
import type { ProgramSummary } from "@/new/types";
import { FLOW_ATTESTATION_CAP } from "@/v3/lib/blobGuard";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";
// TYPE-ONLY: the link a round hands out is the SAME durable review link every other
// share uses (`mintReviewPack`), never a second link type. Type-only import, so no
// runtime edge is added between the two modules.
import type { FlowInterviewPack } from "@/v3/components/flow/flowPortal";

/** The two methodology phases the Design Loop band renders as one. */
export const DESIGN_LOOP_MOVEMENT_IDS: readonly string[] = ["envision", "show"];

/** The movement a round's links are stamped with — the loop's client-facing half. */
export const DESIGN_ROUND_MOVEMENT_ID = "show";

/** `reviewKind` carried by a round's links, so a response can be told apart from an
 * ontology or agentify review on the same durable token. */
export const DESIGN_ROUND_REVIEW_KIND = "design-round";

const ROUND_CAP = 12;
const ROSTER_CAP = 40;
const TEXT_CAP = 2_000;
const HISTORY_CAP = 20;
const REASON_MIN = 4;

export function isDesignLoopMovement(movementId: string): boolean {
  return DESIGN_LOOP_MOVEMENT_IDS.includes(movementId);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normName = (value: unknown): string => String(value ?? "").trim().toLowerCase();

function randomSecret(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ *
 * The DESIGN a round is about
 * ------------------------------------------------------------------ */

/**
 * The version of the design under review: the prototype build, and the demo scripts
 * cut from it. `key` changes whenever either document is regenerated or edited — that
 * is what makes an approval attributable to a VERSION rather than to "the design",
 * and what lets a later regeneration say which feedback it answered.
 */
export interface DesignVersion {
  /** Stable identity of this pair of documents. Empty-ish when nothing is built. */
  key: string;
  hasPrototype: boolean;
  hasDemoScripts: boolean;
  prototypeTitle?: string;
  prototypeBuildAt?: string;
  demoScriptsAt?: string;
}

function docStamp(doc: unknown): { present: boolean; at?: string; title?: string } {
  if (!isRecord(doc)) return { present: false };
  const edited = typeof doc.editedAt === "string" && doc.editedAt ? doc.editedAt : undefined;
  const generated = typeof doc.generatedAt === "string" && doc.generatedAt ? doc.generatedAt : undefined;
  return {
    present: true,
    at: edited ?? generated,
    title: typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : undefined,
  };
}

/** The design as it stands RIGHT NOW — the reference a round is opened against and
 * later compared to, so approvals on a superseded build cannot read as current. */
export function readDesignVersion(program: ProgramSummary): DesignVersion {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const build = docStamp(inner[FORMAL_ARTIFACT_FIELD_KEYS["prototype-build"]]);
  const scripts = docStamp(inner[FORMAL_ARTIFACT_FIELD_KEYS["demo-scripts"]]);
  return {
    key: `${build.present ? build.at ?? "built" : ""}|${scripts.present ? scripts.at ?? "scripted" : ""}`,
    hasPrototype: build.present,
    hasDemoScripts: scripts.present,
    prototypeTitle: build.title,
    prototypeBuildAt: build.at,
    demoScriptsAt: scripts.at,
  };
}

/* ------------------------------------------------------------------ *
 * The ROUND
 * ------------------------------------------------------------------ */

/** WHO SAID IT. Never defaulted, never promoted — see invariant (a). */
export type DesignAttestation =
  /** The stakeholder answered on their own link. Their word, first-hand. */
  | "self"
  /** An operator recorded what the stakeholder said (a meeting, a call). Legitimate
   * evidence, permanently distinguishable from the person's own answer. */
  | "operator";

export type DesignVerdict = "approved" | "changes";

export type DesignParticipantState =
  | "asked"       // link out / invited, nothing back
  | "responded"   // feedback landed, but no verdict — still outstanding
  | "accepted"
  | "objected"
  | "waived"
  | "delegated";

/** One recorded answer. Kept in full on `history` — a later answer never erases an
 * earlier one, so "what did they say the first time" stays answerable. */
export interface DesignRoundResponse {
  at: string;
  attestation: DesignAttestation;
  verdict?: DesignVerdict;
  /** Free text: their words, or (for an operator capture) what was said and where. */
  text?: string;
  /** A recording of the response — reference only; this module stores no media. */
  recordingRef?: string;
  /** The design version this answer was ABOUT — what a regeneration answers. */
  designVersion: string;
  /** Operator captures: who wrote it down. Absent on self-attested answers. */
  recordedBy?: string;
  /** Where it came from — "portal", "meeting", "call"… */
  source?: string;
}

/** The recorded escape from a stakeholder who will not answer — invariant (b). */
export interface DesignRoundResolution {
  kind: "waived" | "delegated";
  /** Required, and kept: an escape with no stated reason is not on the record. */
  reason: string;
  /** Delegations only: the named other who now answers in their place. */
  to?: { name: string; role: string; email?: string };
  by: string;
  at: string;
}

export interface DesignRoundParticipant {
  name: string;
  role: string;
  email?: string;
  askedAt: string;
  /** The durable review link minted for this person for THIS round. */
  packId?: string;
  /** The standing answer — the last entry of `history`. */
  response?: DesignRoundResponse;
  history?: DesignRoundResponse[];
  resolution?: DesignRoundResolution;
  /** This person is on the roster because `delegatedFrom` handed their review over. */
  delegatedFrom?: string;
}

export interface DesignRound {
  id: string;
  /** 1-based. Round N+1 supersedes round N. */
  ordinal: number;
  openedAt: string;
  openedBy: string;
  /** The design this round is about, frozen at open. */
  design: DesignVersion;
  participants: DesignRoundParticipant[];
  /** Stamped by `closeDesignRound`, which refuses unless the rollup says complete. */
  closedAt?: string;
  /** The id of the round that replaced this one. */
  supersededBy?: string;
  note?: string;
}

function readRounds(inner: Record<string, unknown>): DesignRound[] {
  const list = Array.isArray(inner.flowDesignRounds) ? (inner.flowDesignRounds as unknown[]) : [];
  return list.filter(isRecord)
    .map((entry) => entry as unknown as DesignRound)
    .filter((round) => typeof round.id === "string" && round.id.length > 0)
    .map((round) => ({ ...round, participants: Array.isArray(round.participants) ? round.participants.filter(isRecord) as unknown as DesignRoundParticipant[] : [] }))
    .sort((a, b) => (Number(a.ordinal) || 0) - (Number(b.ordinal) || 0));
}

/** Every round, oldest first. */
export function listDesignRounds(program: ProgramSummary): DesignRound[] {
  return readRounds(getProgramState((program.rawData ?? {}) as Record<string, unknown>).inner);
}

/** The round in force — the highest ordinal. Null when none has been opened. */
export function currentDesignRound(program: ProgramSummary): DesignRound | null {
  const rounds = listDesignRounds(program);
  return rounds.length ? rounds[rounds.length - 1] : null;
}

export function designRoundById(program: ProgramSummary, roundId: string): DesignRound | null {
  return listDesignRounds(program).find((round) => round.id === roundId) ?? null;
}

/* ------------------------------------------------------------------ *
 * Opening a round
 * ------------------------------------------------------------------ */

export interface DesignRoundRosterEntry {
  name: string;
  role?: string;
  email?: string;
}

/**
 * OPEN a review round over the design as it stands, with N stakeholders asked at once.
 *
 * Null (nothing written) when there is no prototype build to review, or the roster is
 * empty after trimming — a round about nothing, or asking nobody, is not a round.
 *
 * Any earlier open round is SUPERSEDED, not edited: it keeps its verdicts and gains
 * `supersededBy`, so "what did round 1 say" survives round 2.
 */
export function openDesignRound(
  program: ProgramSummary,
  input: { roster: DesignRoundRosterEntry[]; note?: string },
  actor: string,
): Record<string, unknown> | null {
  const design = readDesignVersion(program);
  if (!design.hasPrototype) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const now = new Date().toISOString();

  const seen = new Set<string>();
  const participants: DesignRoundParticipant[] = [];
  for (const entry of input.roster ?? []) {
    const name = String(entry?.name ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    participants.push({
      name,
      role: String(entry?.role ?? "").trim(),
      email: String(entry?.email ?? "").trim() || undefined,
      askedAt: now,
    });
    if (participants.length >= ROSTER_CAP) break;
  }
  if (!participants.length) return null;

  const rounds = readRounds(inner);
  const ordinal = rounds.reduce((max, round) => Math.max(max, Number(round.ordinal) || 0), 0) + 1;
  const round: DesignRound = {
    id: `round-${randomSecret()}`,
    ordinal,
    openedAt: now,
    openedBy: actor,
    design,
    participants,
    note: input.note?.trim() ? input.note.trim().slice(0, TEXT_CAP) : undefined,
  };
  const superseded = rounds.map((prior) => (prior.closedAt || prior.supersededBy
    ? prior
    : { ...prior, supersededBy: round.id }));

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: [...superseded, round].slice(-ROUND_CAP),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Opened design review round ${ordinal}`,
      detail: `${participants.length} stakeholder${participants.length === 1 ? "" : "s"} asked to approve the design — ${participants.map((p) => p.name).join(", ").slice(0, 160)}`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/* ------------------------------------------------------------------ *
 * The links — minted through `mintReviewPack`, stamped with the round
 * ------------------------------------------------------------------ */

/** The exact input to hand `mintReviewPack` for one participant, carrying the round's
 * id so whatever comes back can be attributed to this round and this design version.
 * Null when the round or the person is unknown. */
export function designRoundReviewInput(
  program: ProgramSummary,
  roundId: string,
  who: string,
): {
  movementId: string; who: string; role: string; captureField: string;
  reviewKind: string; review: Record<string, unknown>; questions: string[]; intro: string;
  designRoundId: string;
} | null {
  const round = designRoundById(program, roundId);
  if (!round) return null;
  const person = round.participants.find((p) => normName(p.name) === normName(who));
  if (!person) return null;
  return {
    movementId: DESIGN_ROUND_MOVEMENT_ID,
    who: person.name,
    role: person.role || "Reviewer",
    captureField: "demoFeedback",
    reviewKind: DESIGN_ROUND_REVIEW_KIND,
    review: {
      kind: DESIGN_ROUND_REVIEW_KIND,
      roundId: round.id,
      ordinal: round.ordinal,
      designVersion: round.design.key,
      prototypeTitle: round.design.prototypeTitle,
      hasDemoScripts: round.design.hasDemoScripts,
    },
    questions: [
      "Walk the prototype for your own workflow — does it do what you described?",
      "What is wrong, missing, or in the wrong order?",
      "Do you approve this design as the one we build on?",
    ],
    intro: `Round ${round.ordinal} of the design review. Have a look at the prototype and the demo script for your workflow, then tell us — in writing or a recording — whether you approve it.`,
    designRoundId: round.id,
  };
}

/** The links minted for a round — packs stamped with its id. */
export function designRoundPacks(program: ProgramSummary, roundId: string): FlowInterviewPack[] {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const packs = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]).filter(isRecord) : [];
  return packs.filter((pack) => String(pack.designRoundId ?? "") === roundId) as unknown as FlowInterviewPack[];
}

/** One participant's round link, if it has been minted. */
export function designRoundLinkFor(program: ProgramSummary, roundId: string, who: string): FlowInterviewPack | null {
  const key = normName(who);
  return designRoundPacks(program, roundId).find((pack) => normName(pack.stakeholder) === key) ?? null;
}

/** Record which pack carries a participant's ask — the round's back-reference to the
 * link. Idempotent; null when nothing changes. */
export function attachDesignRoundLinks(program: ProgramSummary, roundId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const rounds = readRounds(inner);
  const round = rounds.find((entry) => entry.id === roundId);
  if (!round) return null;
  const packs = designRoundPacks(program, roundId);
  let changed = 0;
  const participants = round.participants.map((person) => {
    const pack = packs.find((entry) => normName(entry.stakeholder) === normName(person.name));
    const packId = pack ? String(pack.id ?? "") : "";
    if (!packId || person.packId === packId) return person;
    changed += 1;
    return { ...person, packId };
  });
  if (!changed) return null;
  const now = new Date().toISOString();
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: rounds.map((entry) => (entry.id === roundId ? { ...round, participants } : entry)),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Design review round ${round.ordinal} — ${changed} link${changed === 1 ? "" : "s"} out`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/* ------------------------------------------------------------------ *
 * Recording an answer — invariant (a)
 * ------------------------------------------------------------------ */

/** Replace one round in the ordered list, leaving every other round untouched. */
function writeRound(rounds: DesignRound[], next: DesignRound): DesignRound[] {
  return rounds.map((round) => (round.id === next.id ? next : round));
}

function liveRound(rounds: DesignRound[], roundId?: string): DesignRound | null {
  if (roundId) {
    const found = rounds.find((round) => round.id === roundId) ?? null;
    return found;
  }
  return rounds.length ? rounds[rounds.length - 1] : null;
}

export interface RecordVerdictInput {
  /** Defaults to the current round. */
  roundId?: string;
  who: string;
  verdict?: DesignVerdict;
  /** REQUIRED, never defaulted — invariant (a). */
  attestation: DesignAttestation;
  text?: string;
  recordingRef?: string;
  source?: string;
}

/**
 * Record what a stakeholder said about the design.
 *
 * Refused (null, nothing written) when:
 *   · the round is unknown, superseded or closed — a superseded round is history;
 *   · the person is not on the round's roster — answers never grow the roster
 *     sideways, so "who was asked" cannot drift after the fact;
 *   · attestation is "self" but no round LINK was ever minted for that person —
 *     nobody can be said to have answered for themselves on an ask they never got;
 *   · attestation is "operator" and no `text` says what was said and where — an
 *     operator capture with no basis is not evidence;
 *   · attestation is "operator" and the standing answer is SELF-attested. The
 *     person's own word is not overwritable by a second-hand note. (The reverse IS
 *     allowed: their own later answer supersedes an operator capture, and the
 *     capture stays on `history`.)
 *
 * Neither direction ever REWRITES `attestation` on a stored response: a new answer is
 * a new entry, so an operator capture can never become self-attested.
 */
export function recordDesignRoundVerdict(
  program: ProgramSummary,
  input: RecordVerdictInput,
  actor: string,
): Record<string, unknown> | null {
  if (input.attestation !== "self" && input.attestation !== "operator") return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const rounds = readRounds(inner);
  const round = liveRound(rounds, input.roundId);
  if (!round || round.closedAt || round.supersededBy) return null;
  const key = normName(input.who);
  const person = round.participants.find((p) => normName(p.name) === key);
  if (!person) return null;

  const text = String(input.text ?? "").trim().slice(0, TEXT_CAP);
  if (input.attestation === "operator" && !text) return null;
  if (input.attestation === "self" && !designRoundLinkFor(program, round.id, person.name)) return null;
  // THE GUARD. An operator's note never lands on top of the person's own answer.
  if (input.attestation === "operator" && person.response?.attestation === "self") return null;

  const now = new Date().toISOString();
  const response: DesignRoundResponse = {
    at: now,
    attestation: input.attestation,
    verdict: input.verdict,
    text: text || undefined,
    recordingRef: String(input.recordingRef ?? "").trim() || undefined,
    designVersion: round.design.key,
    recordedBy: input.attestation === "operator" ? actor : undefined,
    source: String(input.source ?? "").trim() || (input.attestation === "self" ? "portal" : "meeting"),
  };
  const history = [...(person.history ?? []), response].slice(-HISTORY_CAP);
  const participants = round.participants.map((p) => (normName(p.name) === key
    ? { ...p, response, history }
    : p));

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const said = input.verdict === "approved" ? "approved the design"
    : input.verdict === "changes" ? "asked for changes"
      : "sent feedback";
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: writeRound(rounds, { ...round, participants }),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Design round ${round.ordinal} — ${person.name} ${said}`,
      detail: input.attestation === "self"
        ? `Self-attested on their own link.${text ? ` “${text.slice(0, 120)}”` : ""}`
        : `Recorded by ${actor} — attested by the operator, not by ${person.name}. “${text.slice(0, 120)}”`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/* ------------------------------------------------------------------ *
 * The escape — invariant (b)
 * ------------------------------------------------------------------ */

/**
 * WAIVE a participant: they will not answer, and the round proceeds without them —
 * with the reason permanently on the record and counted in the rollup.
 *
 * They stay on the roster. There is no verb that removes them.
 * Null when the round or person is unknown, the reason is empty/too short, or they
 * have already answered for themselves (a waiver cannot erase a real answer).
 */
export function waiveDesignRoundParticipant(
  program: ProgramSummary,
  input: { roundId?: string; who: string; reason: string },
  actor: string,
): Record<string, unknown> | null {
  const reason = String(input.reason ?? "").trim().slice(0, TEXT_CAP);
  if (reason.length < REASON_MIN) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const rounds = readRounds(inner);
  const round = liveRound(rounds, input.roundId);
  if (!round || round.closedAt || round.supersededBy) return null;
  const key = normName(input.who);
  const person = round.participants.find((p) => normName(p.name) === key);
  if (!person || person.resolution) return null;
  if (person.response?.attestation === "self") return null;

  const now = new Date().toISOString();
  const participants = round.participants.map((p) => (normName(p.name) === key
    ? { ...p, resolution: { kind: "waived" as const, reason, by: actor, at: now } }
    : p));
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: writeRound(rounds, { ...round, participants }),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Design round ${round.ordinal} — waived ${person.name}`,
      detail: `Not an approval. The design closes without their word: “${reason.slice(0, 160)}”`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/**
 * DELEGATE a participant's review to a named other. The original stays on the roster
 * (state "delegated", reason kept) and the delegate is ADDED to it — so the number of
 * people who must answer never falls below what was asked. If the delegate is already
 * on the roster they are not duplicated; their own ask stands.
 *
 * Null when the round or person is unknown, the reason is empty/too short, no delegate
 * is named, the delegate is the same person, or they have already self-attested.
 */
export function delegateDesignRoundParticipant(
  program: ProgramSummary,
  input: { roundId?: string; who: string; to: { name: string; role?: string; email?: string }; reason: string },
  actor: string,
): Record<string, unknown> | null {
  const reason = String(input.reason ?? "").trim().slice(0, TEXT_CAP);
  const toName = String(input.to?.name ?? "").trim();
  if (reason.length < REASON_MIN || !toName) return null;
  const key = normName(input.who);
  if (normName(toName) === key) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const rounds = readRounds(inner);
  const round = liveRound(rounds, input.roundId);
  if (!round || round.closedAt || round.supersededBy) return null;
  const person = round.participants.find((p) => normName(p.name) === key);
  if (!person || person.resolution) return null;
  if (person.response?.attestation === "self") return null;

  const now = new Date().toISOString();
  const to = { name: toName, role: String(input.to?.role ?? "").trim(), email: String(input.to?.email ?? "").trim() || undefined };
  const participants = round.participants.map((p) => (normName(p.name) === key
    ? { ...p, resolution: { kind: "delegated" as const, reason, to, by: actor, at: now } }
    : p));
  const alreadyOnRoster = participants.some((p) => normName(p.name) === normName(toName));
  const grown = alreadyOnRoster
    ? participants
    : [...participants, { name: to.name, role: to.role, email: to.email, askedAt: now, delegatedFrom: person.name }];

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: writeRound(rounds, { ...round, participants: grown.slice(0, ROSTER_CAP) }),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Design round ${round.ordinal} — ${person.name} delegated to ${to.name}`,
      detail: `${to.name} now answers in their place and is on the roster. “${reason.slice(0, 160)}”`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/* ------------------------------------------------------------------ *
 * The ROLLUP — the round's own truth
 * ------------------------------------------------------------------ */

export interface DesignRoundPerson {
  name: string;
  role: string;
  email?: string;
  state: DesignParticipantState;
  /** Present only where a verdict/feedback was recorded. Never inferred. */
  attestation?: DesignAttestation;
  respondedAt?: string;
  text?: string;
  recordingRef?: string;
  resolution?: DesignRoundResolution;
  delegatedFrom?: string;
  /** The design version their answer was about. */
  answeredVersion?: string;
  /** Their answer was about an EARLIER version of the design than the round's. */
  versionStale: boolean;
  /** Their round link has been minted (the ask genuinely went out). */
  linked: boolean;
}

export type DesignRoundState = "not-started" | "in-flight" | "objections" | "complete";

export interface DesignRoundRollup {
  round: DesignRound | null;
  ordinal: number;
  state: DesignRoundState;
  /** N stakeholders in this round, reviewing at the same time. */
  asked: number;
  responded: number;
  accepted: number;
  /** The split invariant (a) exists to protect — reported, never merged away. */
  acceptedSelfAttested: number;
  acceptedOperatorAttested: number;
  objected: number;
  waived: number;
  delegated: number;
  /** Asked or fed back, but no verdict and no resolution — who the phase waits on. */
  outstanding: number;
  outstandingNames: string[];
  objectedNames: string[];
  waivedNames: string[];
  delegatedNames: string[];
  people: DesignRoundPerson[];
  /** The prototype/demo scripts have moved since this round was opened — its
   * approvals are about a design that no longer exists. */
  designMoved: boolean;
  design: DesignVersion | null;
}

const EMPTY_ROLLUP: DesignRoundRollup = {
  round: null, ordinal: 0, state: "not-started",
  asked: 0, responded: 0, accepted: 0, acceptedSelfAttested: 0, acceptedOperatorAttested: 0,
  objected: 0, waived: 0, delegated: 0, outstanding: 0,
  outstandingNames: [], objectedNames: [], waivedNames: [], delegatedNames: [],
  people: [], designMoved: false, design: null,
};

function participantState(person: DesignRoundParticipant): DesignParticipantState {
  if (person.resolution?.kind === "waived") return "waived";
  if (person.resolution?.kind === "delegated") return "delegated";
  if (person.response?.verdict === "approved") return "accepted";
  if (person.response?.verdict === "changes") return "objected";
  if (person.response) return "responded";
  return "asked";
}

/**
 * The round's own rollup — N stakeholders asked at once, and where each of them got
 * to. `accepted` is deliberately reported ALONGSIDE its attestation split so no
 * surface can print a total that hides who actually said it.
 */
export function designRoundRollup(program: ProgramSummary, roundId?: string): DesignRoundRollup {
  const round = roundId ? designRoundById(program, roundId) : currentDesignRound(program);
  if (!round) return EMPTY_ROLLUP;
  const current = readDesignVersion(program);
  const packs = designRoundPacks(program, round.id);
  const linked = new Set(packs.map((pack) => normName(pack.stakeholder)));

  const people: DesignRoundPerson[] = round.participants.map((person) => {
    const state = participantState(person);
    return {
      name: person.name,
      role: person.role,
      email: person.email,
      state,
      attestation: person.response?.attestation,
      respondedAt: person.response?.at,
      text: person.response?.text,
      recordingRef: person.response?.recordingRef,
      resolution: person.resolution,
      delegatedFrom: person.delegatedFrom,
      answeredVersion: person.response?.designVersion,
      versionStale: Boolean(person.response && person.response.designVersion !== round.design.key),
      linked: linked.has(normName(person.name)) || Boolean(person.packId),
    };
  });

  const of = (state: DesignParticipantState) => people.filter((p) => p.state === state);
  const accepted = of("accepted");
  const objected = of("objected");
  const waived = of("waived");
  const delegated = of("delegated");
  const outstanding = people.filter((p) => p.state === "asked" || p.state === "responded");
  const designMoved = round.design.key !== current.key;
  const state: DesignRoundState = objected.length ? "objections"
    : outstanding.length ? "in-flight"
      : "complete";

  return {
    round,
    ordinal: Number(round.ordinal) || 0,
    state,
    asked: people.length,
    responded: people.filter((p) => Boolean(p.respondedAt)).length,
    accepted: accepted.length,
    acceptedSelfAttested: accepted.filter((p) => p.attestation === "self").length,
    acceptedOperatorAttested: accepted.filter((p) => p.attestation === "operator").length,
    objected: objected.length,
    waived: waived.length,
    delegated: delegated.length,
    outstanding: outstanding.length,
    outstandingNames: outstanding.map((p) => p.name),
    objectedNames: objected.map((p) => p.name),
    waivedNames: waived.map((p) => p.name),
    delegatedNames: delegated.map((p) => p.name),
    people,
    designMoved,
    design: round.design,
  };
}

/**
 * CLOSE the round. Refused unless the rollup already says every participant is
 * resolved with no objections and the design has not moved underneath it — closing
 * records a fact, it never creates one. There is no argument that lets it skip
 * someone: the only ways past an unresponsive stakeholder are waive and delegate,
 * both of which stay on the record.
 */
export function closeDesignRound(program: ProgramSummary, roundId: string, actor: string): Record<string, unknown> | null {
  const rollup = designRoundRollup(program, roundId);
  if (!rollup.round || rollup.round.closedAt) return null;
  if (rollup.state !== "complete" || rollup.designMoved || !rollup.asked) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const rounds = readRounds(inner);
  const round = rounds.find((entry) => entry.id === roundId);
  if (!round) return null;
  const now = new Date().toISOString();
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDesignRounds: writeRound(rounds, { ...round, closedAt: now }),
    flowAttestations: [...log, {
      ts: now, agentId: actor, phaseId: DESIGN_ROUND_MOVEMENT_ID, tier: 2,
      action: `Design review round ${round.ordinal} closed`,
      detail: `${rollup.accepted} approved (${rollup.acceptedSelfAttested} self-attested · ${rollup.acceptedOperatorAttested} recorded by the operator)`
        + `${rollup.waived ? ` · ${rollup.waived} waived` : ""}${rollup.delegated ? ` · ${rollup.delegated} delegated` : ""}`,
    }].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/* ------------------------------------------------------------------ *
 * The GATE
 * ------------------------------------------------------------------ */

export interface DesignRoundGate {
  tone: "green" | "amber" | "dim";
  /** The Design Loop's closing criterion. */
  done: boolean;
  label: string;
  /** Why — naming the people, never a bare amber. */
  detail?: string;
  rollup: DesignRoundRollup;
}

function nameList(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

/** Invariant (a), in words: an approval count is never printed without saying who
 * actually said it. Empty only when nobody has approved yet. */
function attestationSplit(rollup: DesignRoundRollup): string {
  if (!rollup.accepted) return "";
  return ` (${rollup.acceptedSelfAttested} self-attested · ${rollup.acceptedOperatorAttested} recorded by the operator)`;
}

/**
 * How the Design Loop's gate reads. THE gate criterion for `envision`/`show`: the
 * loop closes when every stakeholder in the current round has approved, or has been
 * waived/delegated on the record.
 *
 *   · NO ROUND        → dim, not done, "Design review round not opened". A programme
 *     that has never asked anybody reads as NOT STARTED. It is never green, and it
 *     never invents a round or a count it does not have.
 *   · IN FLIGHT       → amber, not done, naming who is still outstanding.
 *   · OBJECTIONS      → amber, not done, naming who asked for changes.
 *   · DESIGN MOVED    → amber, not done: the approvals are about an earlier build.
 *   · ALL RESOLVED    → green, done, with the attestation split stated.
 */
export function designRoundGate(program: ProgramSummary): DesignRoundGate {
  const rollup = designRoundRollup(program);
  if (!rollup.round) {
    const design = readDesignVersion(program);
    return {
      tone: "dim",
      done: false,
      label: "Design review round not opened — no stakeholder has been asked to approve the design",
      detail: design.hasPrototype
        ? `The prototype is built${design.hasDemoScripts ? " and the demo scripts are cut" : " — the demo scripts are not cut yet"}. Open a round and share it.`
        : "Build the prototype first — a round is about a design version.",
      rollup,
    };
  }
  const round = `Round ${rollup.ordinal}`;
  if (rollup.state === "objections") {
    return {
      tone: "amber", done: false,
      label: `${round} — changes requested by ${nameList(rollup.objectedNames)}`,
      detail: `${rollup.accepted}/${rollup.asked} approved · refine the design and open the next round.`,
      rollup,
    };
  }
  if (rollup.state === "in-flight") {
    return {
      tone: "amber", done: false,
      label: `${round} — waiting on ${nameList(rollup.outstandingNames)}`,
      detail: `${rollup.accepted} of ${rollup.asked} approved${attestationSplit(rollup)}`
        + `${rollup.waived ? ` · ${rollup.waived} waived` : ""}${rollup.delegated ? ` · ${rollup.delegated} delegated` : ""}`
        + ". Waive with a reason or delegate to a named other if someone will not answer.",
      rollup,
    };
  }
  if (rollup.designMoved) {
    return {
      tone: "amber", done: false,
      label: `${round} approved an earlier version of the design`,
      detail: "The prototype or demo scripts changed after the round was opened — open the next round on what is built now.",
      rollup,
    };
  }
  return {
    tone: "green", done: true,
    label: `${round} — all ${rollup.asked} stakeholders resolved`,
    detail: `${rollup.accepted} approved${attestationSplit(rollup)}`
      + `${rollup.waived ? ` · ${rollup.waived} waived` : ""}${rollup.delegated ? ` · ${rollup.delegated} delegated` : ""}`,
    rollup,
  };
}

/* ------------------------------------------------------------------ *
 * Feedback in from the quarantine inbox
 * ------------------------------------------------------------------ */

export interface InboxRoundAttribution {
  roundId: string;
  ordinal: number;
  who: string;
  role: string;
  /** The design version the round is about — what the feedback answers. */
  designVersion: string;
  verdict?: DesignVerdict;
  text: string;
}

/**
 * Attribute a QUARANTINED portal response to a round, a stakeholder and the design
 * version it was about — the model half of "feedback refines the design". The
 * quarantine discipline is untouched: this reads the inbox, records nothing, and the
 * operator still ingests the item through the existing portal path.
 *
 * The link is the attribution: the item's sender holds a pack stamped with the round
 * id (`mintReviewPack(..., designRoundId)`), so nothing is guessed from names alone.
 * Null when the item is unknown or its sender holds no link for the current round.
 */
export function inboxItemRoundAttribution(program: ProgramSummary, itemId: string): InboxRoundAttribution | null {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]).filter(isRecord) : [];
  const item = inbox.find((entry) => String(entry.id ?? "") === itemId);
  if (!item) return null;
  const who = String(item.stakeholder ?? "").trim();
  if (!who) return null;
  const round = currentDesignRound(program);
  if (!round) return null;
  const pack = designRoundLinkFor(program, round.id, who);
  if (!pack) return null;
  const person = round.participants.find((p) => normName(p.name) === normName(who));
  if (!person) return null;
  const raw = String(item.verdict ?? "").trim().toLowerCase();
  const verdict: DesignVerdict | undefined = raw === "accepted" ? "approved"
    : raw === "rework" || raw === "accepted-with-changes" ? "changes"
      : undefined;
  return {
    roundId: round.id,
    ordinal: round.ordinal,
    who: person.name,
    role: person.role,
    designVersion: round.design.key,
    verdict,
    text: String(item.text ?? "").trim().slice(0, TEXT_CAP),
  };
}

/**
 * Record a quarantined response against the round as the STAKEHOLDER'S OWN answer.
 * Self-attested by construction: it only resolves through a link the round minted for
 * that person. Does NOT consume the inbox item — the existing portal ingest still owns
 * that, so the evidence path and the quarantine discipline are unchanged.
 */
export function recordInboxResponseOnRound(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const attribution = inboxItemRoundAttribution(program, itemId);
  if (!attribution) return null;
  return recordDesignRoundVerdict(program, {
    roundId: attribution.roundId,
    who: attribution.who,
    verdict: attribution.verdict,
    attestation: "self",
    text: attribution.text,
    source: "portal",
  }, actor);
}
