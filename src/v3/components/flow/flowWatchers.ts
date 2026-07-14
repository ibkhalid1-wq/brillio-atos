/**
 * Watchers — the system noticing, deterministically.
 *
 * A watcher reads the record after it changes and, when a specific
 * correctable condition holds, QUEUES a Tier-2 decision — never applies
 * anything itself. Propose-then-confirm end to end: the proposal carries the
 * ready-to-merge payload, the Inbox card shows exactly what changes, and
 * resolveFlowDecision applies it on confirm.
 *
 * First watcher: unrostered voices. Attributed transcript evidence naming
 * people the coverage ledger doesn't know means coverage reads complete
 * while voices are on record unmapped.
 *
 * Proposal ids are content-derived (the sorted names), so the same finding
 * is never asked twice — a decline permanently retires that exact set.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { flowMovements, movementEvidence, parseGridRows, readMovementInputs, evidenceStamp } from "@/v3/components/flow/flowShellData";
import { listFlowDecisions, handledContradictionStatements, isContradictionHandled } from "@/v3/components/flow/flowDecisions";
import { validateOntologyConstraints, isValidCardinality } from "@/v3/components/flow/flowOntologyConstraints";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { meetingKit } from "@/v3/components/flow/flowMeetings";

function djb2(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

export interface WatcherProposal {
  id: string;
  tier: 2;
  status: "open";
  agentId: string;
  movementId: string;
  title: string;
  summary: string;
  blocking: string;
  recommendation: { action: string; rationale: string; band: string };
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Attributed voices on record that the Listen roster doesn't know.
 * Returns a ready-to-queue proposal, or null when there is nothing to say
 * (or when this exact finding was already proposed, whatever its outcome).
 */
export function unrosteredVoicesProposal(program: ProgramSummary): WatcherProposal | null {
  const listen = flowMovements().find((movement) => movement.id === "listen");
  if (!listen) return null;
  const roster = parseGridRows(readMovementInputs(program, "listen").interviewRoster);
  const known = new Set(roster.map((row) => String(row.name ?? "").trim().toLowerCase()).filter(Boolean));

  const additions: Array<{ name: string; role: string }> = [];
  const seen = new Set<string>();
  for (const entry of movementEvidence(program, listen)) {
    if (entry.kind !== "transcript" || entry.who === entry.fieldLabel) continue;
    // "Dan Reyes, RevOps Lead, 2026-07-14" → name + role; document refs excluded.
    if (/^document:/i.test(entry.who)) continue;
    // Operator bookkeeping ("— Operator resolution, 2026-07-13 —") reads like
    // a speaker header but is the OPERATOR's pen, not a voice to roster.
    if (/^operator\b|resolution/i.test(entry.who)) continue;
    const parts = entry.who.split(",").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (!name || name.split(/\s+/).length > 4) continue;
    const key = name.toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    additions.push({ name, role: parts[1] && !/^\d{4}-/.test(parts[1]) ? parts[1] : "" });
  }
  if (!additions.length) return null;

  const id = `watch-roster-${djb2(additions.map((a) => a.name.toLowerCase()).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  const names = additions.map((a) => a.name).join(", ");
  return {
    id,
    tier: 2,
    status: "open",
    agentId: "voice-watcher",
    movementId: "listen",
    title: `Add ${additions.length} voice${additions.length === 1 ? "" : "s"} to the coverage ledger`,
    summary: `${names} ${additions.length === 1 ? "is" : "are"} quoted in the evidence but not on the roster.`,
    blocking: "Coverage looks complete while people who spoke are missing from the list.",
    recommendation: {
      action: "Add them to the roster",
      rationale: "Everyone quoted in the evidence should be counted — they have spoken already, so they join as Heard.",
      band: "proposal — additive, roster rows only",
    },
    payload: { rosterAdditions: additions },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rework verdicts with no live re-invite: the iterate-until-approval engine.
 * When a stakeholder said "needs rework", their change asks are on the
 * record and no unanswered demo link is waiting on them, propose fresh
 * links — one confirm re-opens the loop until they accept.
 */
export function reDemoProposal(program: ProgramSummary): WatcherProposal | null {
  const inner = ((program.rawData ?? {}) as Record<string, unknown>);
  const root = typeof inner.data === "object" && inner.data !== null ? (inner.data as Record<string, unknown>) : inner;
  const doc = root.demoScripts;
  const scripts = doc && typeof doc === "object" && !Array.isArray(doc) && Array.isArray((doc as Record<string, unknown>).scripts)
    ? ((doc as Record<string, unknown>).scripts as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  if (!scripts.length) return null;
  const scripted = new Set(scripts.map((script) => String(script.stakeholder ?? "").trim().toLowerCase()));

  const tour = parseGridRows(readMovementInputs(program, "show").demoTour);
  const invites = Array.isArray(root.flowDemoInvites) ? (root.flowDemoInvites as unknown[]) : [];
  const waitingOn = new Set(invites
    .filter((invite): invite is Record<string, unknown> => typeof invite === "object" && invite !== null)
    .filter((invite) => typeof invite.respondedAt !== "string")
    .map((invite) => String(invite.stakeholder ?? "").trim().toLowerCase()));

  const names = [...new Set(tour
    .filter((row) => /rework|not yet/i.test(row.verdict ?? ""))
    .map((row) => String(row.stakeholder ?? "").trim())
    .filter((name) => name
      && scripted.has(name.toLowerCase())
      && !waitingOn.has(name.toLowerCase())))];
  if (!names.length) return null;

  const id = `watch-redemo-${djb2(names.map((name) => name.toLowerCase()).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  return {
    id,
    tier: 2,
    status: "open",
    agentId: "redemo-watcher",
    movementId: "show",
    title: `Invite ${names.length} stakeholder${names.length === 1 ? "" : "s"} to re-demonstrate`,
    summary: `${names.join(", ")} said "needs rework" and no new demo link is waiting on them.`,
    blocking: "Show cannot reach every-stakeholder-accepted while a rework verdict has no road back to the room.",
    recommendation: {
      action: "Send fresh demo links",
      rationale: "Their change asks are on the record — a fresh link against the current build lets them re-judge it.",
      band: "proposal — old unanswered links retire, fresh ones mint",
    },
    payload: { reDemoStakeholders: names },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Structurally invalid domain ontology → an evidence-grounded repair proposal.
 *
 * The app never fixes the ontology silently: a repair changes what every
 * downstream generator grounds on, so it rides the same propose-then-confirm
 * rail as every other agent action. What IS automatic is the diagnosis and the
 * ready-to-apply fix, each derived deterministically and grounded in evidence:
 *
 *   - dangling relation whose missing entity IS NAMED in the evidence corpus →
 *     declare the entity, quoting the line that names it (evidence-grounded add);
 *   - dangling relation with NO evidence for the name → remove the relation
 *     (an assertion no stakeholder made has no business in the schema);
 *   - malformed cardinality → "unknown" (the least-claim repair);
 *   - duplicate entity names → fold the later duplicate's aliases/attributes
 *     into the first (relations resolve by name, so they keep working).
 *
 * The payload is the fully repaired document on the artifactDocs path, so the
 * existing confirm resolver applies it — and it is only proposed at all when
 * the repaired document passes the constraint gate cleanly.
 */
export function ontologyRepairProposal(program: ProgramSummary): WatcherProposal | null {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const root = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
  const doc = root.domainOntology;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const source = doc as Record<string, unknown>;
  const blocking = validateOntologyConstraints(source).filter((v) => v.severity === "blocking");
  if (!blocking.length) return null;

  // The evidence corpus: every captured line across the movements' inputs.
  const corpusLines: string[] = [];
  const buckets = typeof root.phaseInputs === "object" && root.phaseInputs !== null ? (root.phaseInputs as Record<string, unknown>) : {};
  for (const bucket of Object.values(buckets)) {
    if (typeof bucket !== "object" || bucket === null) continue;
    for (const value of Object.values(bucket as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 40) corpusLines.push(...value.split(/\n+/));
    }
  }
  const evidenceLineFor = (name: string): string | null => {
    const needle = name.trim().toLowerCase();
    if (!needle) return null;
    const line = corpusLines.find((l) => l.toLowerCase().includes(needle));
    return line ? line.trim().slice(0, 140) : null;
  };

  const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  let entities = (Array.isArray(source.entities) ? source.entities : []).map(asRec);
  let relations = (Array.isArray(source.relations) ? source.relations : []).map(asRec);
  const changes: string[] = [];

  // 1) Duplicate entities: fold later duplicates into the first occurrence.
  const seenNames = new Map<string, number>();
  const folded: Array<Record<string, unknown>> = [];
  entities.forEach((entity) => {
    const key = String(entity.name ?? "").trim().toLowerCase();
    if (key && seenNames.has(key)) {
      const first = folded[seenNames.get(key)!];
      first.aliases = [...new Set([...(Array.isArray(first.aliases) ? first.aliases : []), ...(Array.isArray(entity.aliases) ? entity.aliases : [])])];
      first.attributes = [...new Set([...(Array.isArray(first.attributes) ? first.attributes : []), ...(Array.isArray(entity.attributes) ? entity.attributes : [])])];
      changes.push(`Merged duplicate entity "${entity.name}" into its first declaration`);
      return;
    }
    if (key) seenNames.set(key, folded.length);
    folded.push({ ...entity });
  });
  entities = folded;

  // 2) Dangling relations: declare the entity if the evidence names it, else drop the relation.
  const resolvable = new Set<string>();
  for (const entity of entities) {
    const name = String(entity.name ?? "").trim().toLowerCase();
    if (name) resolvable.add(name);
    for (const alias of Array.isArray(entity.aliases) ? entity.aliases : []) {
      const a = String(alias ?? "").trim().toLowerCase();
      if (a) resolvable.add(a);
    }
  }
  relations = relations.filter((relation) => {
    const endpoints = [String(relation.from ?? "").trim(), String(relation.to ?? "").trim()];
    if (endpoints.some((endpoint) => !endpoint)) {
      changes.push(`Removed relation "${endpoints[0] || "?"} → ${endpoints[1] || "?"}" — a missing endpoint`);
      return false;
    }
    for (const endpoint of endpoints) {
      if (resolvable.has(endpoint.toLowerCase())) continue;
      const evidence = evidenceLineFor(endpoint);
      if (evidence) {
        entities.push({ name: endpoint, definition: "", attributes: [], aliases: [], systemOfRecord: null, evidence });
        resolvable.add(endpoint.toLowerCase());
        changes.push(`Declared "${endpoint}" — named in the evidence: "${evidence.slice(0, 80)}"`);
      } else {
        changes.push(`Removed relation "${endpoints[0]} → ${endpoints[1]}" — "${endpoint}" appears nowhere in the evidence`);
        return false;
      }
    }
    return true;
  });

  // 3) Malformed cardinality → unknown, the least-claim repair.
  relations = relations.map((relation) => {
    const card = String(relation.cardinality ?? "").trim();
    if (isValidCardinality(card)) return relation;
    changes.push(`Reset cardinality "${card}" on "${relation.from} → ${relation.to}" to unknown`);
    return { ...relation, cardinality: "unknown" };
  });

  if (!changes.length) return null;
  const repaired = { ...source, entities, relations };
  // Only propose a repair that actually passes the gate — never trade one
  // invalid document for another.
  if (validateOntologyConstraints(repaired).some((v) => v.severity === "blocking")) return null;

  const id = `watch-ontology-${djb2(blocking.map((v) => v.message).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  return {
    id,
    tier: 2,
    status: "open",
    agentId: "ontology-watcher",
    movementId: "listen",
    title: `Repair ${blocking.length} ontology constraint${blocking.length === 1 ? "" : "s"}`,
    summary: changes.slice(0, 4).join(" · ") + (changes.length > 4 ? ` · +${changes.length - 4} more` : ""),
    blocking: "The Domain Ontology has structural violations — downstream grounding and the blueprint read from it.",
    recommendation: {
      action: "Apply the evidence-grounded repair",
      rationale: "Entities named in the evidence are declared with their quote; assertions with no evidence are removed; nothing is invented.",
      band: "proposal — the repaired document replaces the current one on confirm",
    },
    payload: { artifactDocs: { domainOntology: repaired } },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Retro-attribution: a stakeholder added AFTER documents were attached.
 *
 * Their voice may already be on the record — speaker turns inside attached
 * meeting transcripts that were filed before the person joined the roster, so
 * nothing is attributed to them and their card reads "to reach" while their
 * words sit unclaimed in document blocks. This watcher triages the captured
 * evidence for exactly those voices and PROPOSES the attribution: each found
 * passage becomes the person's own attributed block in the right movement on
 * confirm (the evidenceAppends payload). Deterministic — the same speaker
 * mapper the live attach uses, pointed backwards.
 */
export function retroAttributionProposal(program: ProgramSummary): WatcherProposal | null {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const root = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
  const buckets = typeof root.phaseInputs === "object" && root.phaseInputs !== null
    ? (root.phaseInputs as Record<string, Record<string, unknown>>) : {};

  const appends: Array<{ movementId: string; field: string; block: string; who: string }> = [];
  const day = evidenceStamp();

  for (const movementId of ["frame", "listen"]) {
    const field = meetingKit(program, movementId)?.captureField
      ?? (movementId === "frame" ? "sponsorConversation" : "interviewTranscripts");
    const captured = typeof buckets[movementId]?.[field] === "string" ? (buckets[movementId][field] as string) : "";
    if (captured.length < 80) continue;
    for (const person of resolveMovementStakeholders(program, movementId)) {
      const name = person.name.trim();
      if (!name || person.isRole) continue;
      // Already attributed? Their canonical block header exists — nothing to lift.
      if (captured.includes(`— ${name},`) || captured.includes(`— ${name} —`)) continue;
      const mapping = mapTranscriptSpeakers(captured, [{ name, role: person.role }]);
      if (!mapping || !mapping.blocks.length) continue;
      for (const block of mapping.blocks) {
        appends.push({
          movementId, field, who: name,
          block: `— ${[block.name, block.role, day].filter(Boolean).join(", ")} —\n${block.text}`,
        });
      }
    }
  }
  if (!appends.length) return null;

  const people = [...new Set(appends.map((append) => append.who))];
  const id = `watch-retro-${djb2(appends.map((append) => `${append.movementId}:${append.who}`).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  return {
    id,
    tier: 2,
    status: "open",
    agentId: "attribution-watcher",
    movementId: appends[0].movementId,
    title: `Attribute ${people.length === 1 ? `${people[0]}'s` : `${people.length} people's`} words from attached documents`,
    summary: `${people.join(", ")} ${people.length === 1 ? "is" : "are"} on the roster, and ${people.length === 1 ? "their" : "their"} speaker turns already sit inside attached documents — unattributed.`,
    blocking: "Their card reads \"to reach\" while what they said is on the record — coverage under-counts and their voice grounds nothing.",
    recommendation: {
      action: "Lift their passages into attributed evidence",
      rationale: "The words are already captured; attribution only changes WHOSE they are. Each person gets their own dated block in the movement that holds the document.",
      band: "proposal — additive evidence blocks only, documents stay untouched",
    },
    payload: { evidenceAppends: appends.map(({ movementId, field, block }) => ({ movementId, field, block })) },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Deterministic negated-claim detector — the contradiction the record can
 * prove without a model.
 *
 * The LLM contradiction watcher casts a wide semantic net, but one class of
 * conflict is mechanically detectable and too important to leave to a model's
 * judgement: NEW evidence that plainly NEGATES a standing claim ("we are no
 * longer using X" while the charter still builds on X). This watcher scans the
 * newest evidence for negation sentences, checks their subject against the
 * charter's standing claims by significant-token overlap, and queues the
 * standard Tier-2 contradiction proposal — same Inbox card, same confirm path
 * into the contradiction log, same routing onward to the sponsor's and the
 * involved stakeholders' follow-up scripts.
 */
const NEGATION = /\b(no longer|not (?:be )?using|instead of|won'?t (?:be )?(?:using|building)|moving away from|dropp(?:ed|ing)|abandon(?:ed|ing)|scrapp(?:ed|ing)|decided against)\b/i;
const STOPWORDS = new Set(["their", "there", "these", "those", "which", "about", "would", "should", "could", "using", "instead", "longer", "going", "still", "every", "other", "because"]);

export function negatedClaimProposal(program: ProgramSummary): WatcherProposal | null {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const root = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
  const charter = root.transformationCharter;
  const claims: Array<{ key: string; text: string }> = [];
  if (charter && typeof charter === "object" && !Array.isArray(charter)) {
    const c = charter as Record<string, unknown>;
    for (const key of ["businessObjective", "approach", "scope"]) {
      if (typeof c[key] === "string" && (c[key] as string).length > 20) claims.push({ key, text: (c[key] as string) });
    }
  }
  if (!claims.length) return null;

  const entries = flowMovements().flatMap((movement) => movementEvidence(program, movement))
    .filter((entry) => entry.text && entry.text.length > 40)
    .filter((entry) => !/^operator\b|resolution/i.test(entry.who));
  const collected: Array<{ statement: string; between: string; positions: string }> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const sentence of entry.text.split(/(?<=[.!?])\s+|\n+/)) {
      const line = sentence.trim();
      if (line.length < 15 || line.length > 300 || !NEGATION.test(line)) continue;
      // Dispute bookkeeping is not evidence: script echoes ("Q: Two accounts
      // disagree…") and operator resolution notes both QUOTE the claims they
      // settle — mining them refiles every dispute the moment it closes.
      if (/^\s*Q:|two accounts disagree|which is right|^dispute \(|operator resolution|the dispute is closed/i.test(line)) continue;
      // Significant tokens of the negation sentence vs each standing claim.
      const tokens = [...new Set((line.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []).filter((t) => !STOPWORDS.has(t)))];
      const hit = claims.find((claim) => {
        const hay = claim.text.toLowerCase();
        return tokens.some((token) => hay.includes(token));
      });
      if (!hit) continue;
      const key = line.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        statement: line.slice(0, 140),
        between: `${entry.who.split(",")[0].trim() || "new evidence"} vs Transformation Charter (${hit.key})`,
        positions: `Evidence: "${line.slice(0, 90)}" · Charter still asserts: "${hit.text.replace(/\s+/g, " ").slice(0, 90)}"`,
      });
      if (collected.length >= 4) break;
    }
    if (collected.length >= 4) break;
  }
  // A dispute already filed OR already judged (even declined) must not re-surface
  // — filter per statement, so a fresh negation doesn't drag settled ones back
  // in with it. Handled centrally with the edge detector via the same set.
  const handled = handledContradictionStatements(program);
  const found = collected.filter((entry) => !isContradictionHandled(handled, entry.statement));
  if (!found.length) return null;

  const id = `watch-negated-${djb2(found.map((f) => f.statement.toLowerCase()).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  return {
    id,
    tier: 2,
    status: "open",
    agentId: "contradiction-watcher",
    movementId: "listen",
    title: `File ${found.length} contradiction${found.length === 1 ? "" : "s"} to the log`,
    summary: found.map((f) => f.statement).join(" · ").slice(0, 220),
    blocking: "New evidence plainly negates a standing charter claim — documents built on the disputed claim keep asserting it until this is logged.",
    recommendation: {
      action: "File to the contradiction log",
      rationale: "Logging it makes Listen re-ask the question, routes the dispute to the sponsor's and the involved stakeholders' follow-ups, and the affected documents rebuild on regeneration.",
      band: "proposal — additive, log rows only",
    },
    payload: { contradictionEntries: found },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Evidence digest for the contradiction detector.
 *
 * The edge builds the detector's input from CLASSIC fields (narrative/plan),
 * which are empty for flow programmes — so the model was asked to compare
 * transcripts it never received, and real conflicts sailed past it. The client
 * fixes this without an edge deploy: this digest rides `crossPhaseContext`
 * (which the edge folds into the prompt) and carries exactly what the flow
 * prompt promises — the NEWEST evidence blocks vs the EARLIER record, plus the
 * charter's standing claims. Deterministic, bounded, newest-last.
 */
export function contradictionEvidenceDigest(program: ProgramSummary, movementId: string): string | null {
  const movements = flowMovements();
  const upTo = movements.findIndex((movement) => movement.id === movementId);
  const inScope = movements.slice(0, upTo >= 0 ? upTo + 1 : movements.length);
  const entries = inScope.flatMap((movement) => movementEvidence(program, movement))
    .filter((entry) => entry.text && entry.text.length > 40);
  if (entries.length < 2) return null;

  // Head-only slices bury the lede: a Q&A follow-up answers at the END, a plan
  // states its approach mid-document. Short entries go in FULL; long ones keep
  // head + tail so late answers and closing decisions survive the cut.
  const excerpt = (text: string): string => {
    const flat = text.trim().replace(/\s+/g, " ");
    if (flat.length <= 1200) return flat;
    return `${flat.slice(0, 600)} […] ${flat.slice(-500)}`;
  };
  const line = (entry: (typeof entries)[number]) =>
    `- [${entry.who}${entry.meta ? ` · ${entry.meta}` : ""}] "${excerpt(entry.text)}"`;
  const newest = entries.slice(-4);
  const earlier = entries.slice(0, -4).slice(-10);

  const inner = ((program.rawData ?? {}) as Record<string, unknown>);
  const root = typeof inner.data === "object" && inner.data !== null ? (inner.data as Record<string, unknown>) : inner;
  const charter = root.transformationCharter;
  const claims: string[] = [];
  if (charter && typeof charter === "object" && !Array.isArray(charter)) {
    const c = charter as Record<string, unknown>;
    for (const key of ["businessObjective", "approach", "scope"]) {
      if (typeof c[key] === "string" && (c[key] as string).length > 20) claims.push(`- [charter.${key}] "${(c[key] as string).replace(/\s+/g, " ").slice(0, 240)}"`);
    }
  }

  return [
    "## Evidence record for contradiction check",
    "IMPORTANT: for this programme the Input context JSON is empty — THIS evidence record IS the input context. Compare the NEWEST evidence against the EARLIER record and the standing claims below.",
    earlier.length ? `EARLIER record:\n${earlier.map(line).join("\n")}` : null,
    claims.length ? `STANDING CLAIMS (generated documents):\n${claims.join("\n")}` : null,
    `NEWEST evidence:\n${newest.map(line).join("\n")}`,
  ].filter(Boolean).join("\n\n").slice(0, 16000);
}

/**
 * Queue a watcher proposal into flowDecisions (idempotent on id), with the
 * attestation the trail expects. Returns the next raw blob, or null when the
 * proposal already exists — the caller's persist skips a no-op.
 */
export function queueWatcherProposal(program: ProgramSummary, proposal: WatcherProposal): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.flowDecisions) ? (inner.flowDecisions as unknown[]) : [];
  if (list.some((entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).id === proposal.id)) {
    return null;
  }
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDecisions: [...list, proposal].slice(-40),
    flowAttestations: [...log, {
      ts: proposal.createdAt, agentId: proposal.agentId, phaseId: proposal.movementId, tier: 2,
      action: `Proposed: ${proposal.title}`, detail: proposal.summary.slice(0, 160),
    }].slice(-200),
  }, usesNestedData);
}
