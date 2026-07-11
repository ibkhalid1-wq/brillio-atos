/**
 * Pure data readers for the Flow shell — the reimagined chrome for ATOS Flow
 * programmes. Everything here derives from the programme summary + methodology
 * registry; no component state, so the canvas/library/pulse views stay thin.
 *
 * The shell's colour grammar (see v3.css `v3fs-`): blue = evidence (what
 * people said), indigo = generated (what ATOS made), green = demonstrated
 * (what was accepted). These readers hand each view exactly those three kinds.
 */
import type { ProgramSummary } from "@/new/types";
import { getMethodology, type PhaseDefinition } from "@/v3/lib/methodology";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { getFormalArtifactContent, getFormalArtifactConfidence } from "@/v3/lib/formalArtifacts";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";

export interface EvidenceEntry {
  movementId: string;
  fieldLabel: string;
  /** Header line when the transcript declares one ("— Maria Chen, Sales Ops, … —"). */
  who: string;
  meta: string;
  words: number;
  excerpt: string;
  kind: "transcript" | "reference";
}

export interface ArtifactCardModel {
  id: string;
  movementId: string;
  title: string;
  description: string;
  excerpt: string | null;
  confidence: number | null;
  present: boolean;
  /** Generated from inputs that have since changed — offer a regenerate. */
  stale: boolean;
}

export interface GateSignal {
  tone: "green" | "amber" | "dim";
  text: string;
}

/** The inner data root, tolerating both persisted rawData shapes. Internal. */
function dataRoot(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null
    ? (raw.data as Record<string, unknown>)
    : raw;
}

/** Persisted phase-input bucket for one movement. */
export function readMovementInputs(program: ProgramSummary, movementId: string): Record<string, unknown> {
  const source = dataRoot(program);
  const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
    ? (source.phaseInputs as Record<string, Record<string, unknown>>)
    : {};
  return phaseInputs[movementId] ?? {};
}

export function flowMovements(): PhaseDefinition[] {
  return getMethodology("atos-flow").phases;
}

/**
 * Fingerprint of a movement's input bucket — djb2 over the key-sorted JSON,
 * `_`-prefixed keys excluded. The run-agent edge stamps this on artifact stubs
 * at generation time (`inputsFingerprint`); a mismatch here means the evidence
 * moved after the artifact was written. MIRRORS the edge implementation in
 * supabase/functions/run-agent/index.ts — keep byte-compatible.
 */
export function movementInputsFingerprint(program: ProgramSummary, movementId: string): string {
  const bucket = readMovementInputs(program, movementId);
  const keys = Object.keys(bucket).filter((key) => !key.startsWith("_")).sort();
  const text = JSON.stringify(keys.map((key) => [key, bucket[key]]));
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

/** First movement whose gate is not yet approved — the live frontier. */
export function frontierMovementId(program: ProgramSummary): string {
  const movements = flowMovements();
  for (const movement of movements) {
    if (program.gateReviews?.[movement.id]?.status !== "approved") return movement.id;
  }
  return movements[movements.length - 1]?.id ?? "frame";
}

const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Parse a grid field persisted as a JSON row array; [] on anything else. */
export function parseGridRows(value: unknown): Array<Record<string, string>> {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return [];
  try {
    const rows = JSON.parse(value);
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  } catch {
    return [];
  }
}

/**
 * Split pasted conversation text into attributed entries using the header
 * convention the transcript fields document: "— Name, Role, Date —" lines.
 * Text with no headers becomes one entry attributed to the field itself.
 */
function parseTranscript(movementId: string, fieldLabel: string, text: string): EvidenceEntry[] {
  const headerRe = /^[—–-]{1,2}\s*(.{3,90}?)\s*[—–-]{1,2}\s*$/gm;
  const entries: EvidenceEntry[] = [];
  const matches = [...text.matchAll(headerRe)];
  // The pull-quote: prefer the most QUOTABLE line — numbers, money, time, or
  // pain language land better than whatever happened to be said first.
  const quotable = /\d|%|\$|€|£|day|hour|week|month|lose|lost|manual|wait|delay|slow|only|never|every time/i;
  const firstLine = (body: string) => {
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
    return (lines.find((l) => quotable.test(l)) ?? lines[0] ?? "").slice(0, 110);
  };
  if (matches.length === 0) {
    return [{
      movementId, fieldLabel, kind: "transcript",
      who: fieldLabel, meta: `${wordCount(text).toLocaleString()} words`,
      words: wordCount(text), excerpt: firstLine(text),
    }];
  }
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const body = text.slice(start, end);
    entries.push({
      movementId, fieldLabel, kind: "transcript",
      who: match[1],
      meta: `${wordCount(body).toLocaleString()} words`,
      words: wordCount(body),
      excerpt: firstLine(body),
    });
  });
  return entries;
}

/** Every piece of evidence a movement holds (transcripts + document references). */
export function movementEvidence(program: ProgramSummary, movement: PhaseDefinition): EvidenceEntry[] {
  const inputs = readMovementInputs(program, movement.id);
  const out: EvidenceEntry[] = [];
  for (const field of movement.inputFields ?? []) {
    if (field.type !== "transcript" && field.type !== "document") continue;
    const value = inputs[field.id];
    if (typeof value !== "string" || !value.trim()) continue;
    if (value.includes("\n") || value.length > 200) {
      out.push(...parseTranscript(movement.id, field.label, value));
    } else {
      out.push({
        movementId: movement.id, fieldLabel: field.label, kind: "reference",
        who: value.trim(), meta: field.label, words: 0, excerpt: "",
      });
    }
  }
  return out;
}

/** Artifact cards for one movement — presence, confidence, readable excerpt. */
export function movementArtifacts(program: ProgramSummary, movement: PhaseDefinition): ArtifactCardModel[] {
  const root = dataRoot(program);
  const stubs = (root.phaseArtifacts as Record<string, Record<string, { confidence?: number; inputsFingerprint?: string }>> | undefined)?.[movement.id] ?? {};
  const currentFingerprint = movementInputsFingerprint(program, movement.id);
  return getPhaseArtifactDefs(movement.id).map((def) => {
    const content = getFormalArtifactContent(root, def.id);
    const stub = stubs[def.id];
    const excerpt = content ? content.replace(/[#*`>\n-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) : null;
    const confidence = getFormalArtifactConfidence(root, def.id)
      ?? (typeof stub?.confidence === "number" ? Math.round(stub.confidence) : null);
    const present = !!content || !!stub;
    return {
      id: def.id, movementId: movement.id, title: def.label, description: def.description,
      excerpt, confidence, present,
      stale: present && typeof stub?.inputsFingerprint === "string" && stub.inputsFingerprint !== currentFingerprint,
    };
  });
}

/** The full readable body of a generated artifact — the drill-down target. */
export function artifactDocument(program: ProgramSummary, artifactId: string): string | null {
  const content = getFormalArtifactContent(dataRoot(program), artifactId);
  return content && content.trim() ? content : null;
}

/** Listen's coverage ledger: heard-or-waived over total mapped voices. */
export function listenCoverage(program: ProgramSummary): { done: number; total: number } {
  const rows = parseGridRows(readMovementInputs(program, "listen").interviewRoster);
  const done = rows.filter((r) => /heard|waived/i.test(r.status ?? "")).length;
  return { done, total: rows.length };
}

/** Show's demo tour: accepted (incl. with changes) over total demo rows. */
export function demoAcceptance(program: ProgramSummary): { accepted: number; total: number; rows: Array<Record<string, string>> } {
  const rows = parseGridRows(readMovementInputs(program, "show").demoTour);
  const accepted = rows.filter((r) => /accepted/i.test(r.verdict ?? "")).length;
  return { accepted, total: rows.length, rows };
}

/** The gate column's one-line signal for a movement. */
export function gateSignal(program: ProgramSummary, movement: PhaseDefinition, artifacts: ArtifactCardModel[]): GateSignal {
  if (program.gateReviews?.[movement.id]?.status === "approved") {
    return { tone: "green", text: "Demonstrated — gate recorded" };
  }
  if (movement.id === "listen") {
    const { done, total } = listenCoverage(program);
    if (total === 0) return { tone: "dim", text: "Map the voices — the coverage ledger is empty" };
    return done < total
      ? { tone: "amber", text: `${total - done} of ${total} voices still to hear` }
      : { tone: "green", text: `All ${total} voices heard or waived` };
  }
  if (movement.id === "show") {
    const { accepted, total } = demoAcceptance(program);
    if (total === 0) return { tone: "dim", text: "The demo tour ledger is empty" };
    return accepted < total
      ? { tone: "amber", text: `${accepted}/${total} demos accepted` }
      : { tone: "green", text: `Every stakeholder accepted` };
  }
  if (movement.id === "ship") {
    const lanes = listShipLanes(program);
    if (lanes.length) {
      const progress = shipLaneProgress(lanes);
      if (progress.validationDone && progress.cutoverDone) {
        return { tone: "green", text: "Eval suite green and cutover executed" };
      }
      return { tone: "amber", text: `${progress.done}/${progress.total} ship items done` };
    }
  }
  const present = artifacts.filter((a) => a.present).length;
  if (present === 0) return { tone: "dim", text: "Nothing generated yet" };
  return present < artifacts.length
    ? { tone: "amber", text: `${present}/${artifacts.length} artifacts generated` }
    : { tone: "green", text: `All ${artifacts.length} artifacts generated` };
}

export interface GateCheckItem {
  id: string;
  label: string;
  done: boolean;
  /** Editor field to land on when the item is worked (input:<fieldId>). */
  anchor?: string;
  /** Provenance for a met criterion — what on the record satisfies it. */
  why?: string;
}

/** One terse provenance line for a captured value. */
function whyFromValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const flat = value.trim().replace(/\s+/g, " ");
  return flat.length > 56 ? `${flat.slice(0, 56)}…` : flat;
}

/** Provenance for a transcript field: last attributed voice + size. */
function whyFromTranscript(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const words = value.trim().split(/\s+/).length;
  const headers = [...value.matchAll(/—\s*(?:Document:\s*)?([^,—\n]+)[^—\n]*—/g)];
  const who = headers.length ? headers[headers.length - 1][1].trim() : null;
  return who ? `${who} · ${words.toLocaleString()} words` : `${words.toLocaleString()} words`;
}

/**
 * The gate as a CHECKLIST — every criterion a discrete element that checks
 * itself off as the data lands. Derived, never hand-ticked: the list reads
 * from the same state the artifacts and ledgers write.
 */
export function gateChecklist(program: ProgramSummary, movement: PhaseDefinition, artifacts: ArtifactCardModel[]): GateCheckItem[] {
  const inputs = readMovementInputs(program, movement.id);
  const has = (fieldId: string) => typeof inputs[fieldId] === "string" && (inputs[fieldId] as string).trim().length > 0;
  const inner = dataRoot(program);
  const items: GateCheckItem[] = [];
  const artifactItems = () => artifacts.map((artifact) => ({
    id: `art-${artifact.id}`,
    label: artifact.stale ? `${artifact.title} regenerated after the latest evidence` : `${artifact.title} generated`,
    done: artifact.present && !artifact.stale,
    why: artifact.present && !artifact.stale && artifact.confidence != null
      ? `confidence ${artifact.confidence}%`
      : undefined,
  }));

  if (movement.id === "frame") {
    items.push(
      { id: "conv", label: "Sponsor conversation on record", done: has("sponsorConversation"), anchor: "input:sponsorConversation", why: whyFromTranscript(inputs.sponsorConversation) },
      { id: "objective", label: "Business objective captured", done: has("businessObjective"), anchor: "input:businessObjective", why: whyFromValue(inputs.businessObjective) },
      { id: "sponsor", label: "Sponsor named", done: has("sponsor"), anchor: "input:sponsor", why: whyFromValue(inputs.sponsor) },
      { id: "metric", label: "Success measure set", done: has("successMetric"), anchor: "input:successMetric", why: whyFromValue(inputs.successMetric) },
      { id: "demo-date", label: "First-demonstration date set", done: has("targetFirstDemoDate"), anchor: "input:targetFirstDemoDate", why: whyFromValue(inputs.targetFirstDemoDate) },
      ...artifactItems(),
    );
  } else if (movement.id === "listen") {
    const coverage = listenCoverage(program);
    const contradictions = parseGridRows(inputs.contradictionLog);
    items.push(
      { id: "mapped", label: "Voices mapped in the coverage ledger", done: coverage.total > 0, anchor: "input:interviewRoster" },
      { id: "heard", label: coverage.total ? `Every voice heard or waived (${coverage.done}/${coverage.total})` : "Every voice heard or waived", done: coverage.total > 0 && coverage.done >= coverage.total, anchor: "input:interviewRoster" },
      { id: "contradictions", label: "Contradictions resolved or logged", done: contradictions.every((row) => !/open/i.test(row.status ?? "")), anchor: "input:contradictionLog", why: contradictions.length ? `${contradictions.length} logged, none open` : undefined },
      ...artifactItems(),
    );
  } else if (movement.id === "envision") {
    items.push(
      ...artifactItems(),
      { id: "direction", label: "Direction chosen on the record", done: has("directionDecision") || has("steeringConversation"), anchor: "input:directionDecision", why: whyFromValue(inputs.directionDecision) ?? whyFromTranscript(inputs.steeringConversation) },
      { id: "tracks", label: "Track plan adopted", done: Array.isArray(inner.tracks) && (inner.tracks as unknown[]).length > 0, why: Array.isArray(inner.tracks) && (inner.tracks as unknown[]).length ? `${(inner.tracks as unknown[]).length} tracks, confirmed by you` : undefined },
    );
  } else if (movement.id === "show") {
    const tour = demoAcceptance(program);
    items.push(
      { id: "proto", label: "Prototype running somewhere named", done: has("prototypeLocation"), anchor: "input:prototypeLocation", why: whyFromValue(inputs.prototypeLocation) },
      ...artifactItems(),
      { id: "tour", label: "A demo row for every voice", done: tour.total > 0, anchor: "input:demoTour" },
      { id: "verdicts", label: tour.total ? `Every stakeholder accepted (${tour.accepted}/${tour.total})` : "Every stakeholder accepted", done: tour.total > 0 && tour.accepted >= tour.total, anchor: "input:demoTour" },
    );
  } else if (movement.id === "ship") {
    const lanesDoc = inner.shipLanes;
    const lanes = lanesDoc && typeof lanesDoc === "object" && Array.isArray((lanesDoc as Record<string, unknown>).lanes)
      ? ((lanesDoc as Record<string, unknown>).lanes as Array<Record<string, unknown>>)
      : [];
    const laneDone = (id: string) => {
      const lane = lanes.find((entry) => entry?.id === id);
      const laneItems = lane && Array.isArray(lane.items) ? lane.items as Array<Record<string, unknown>> : [];
      return laneItems.length > 0 && laneItems.every((entry) => entry.done === true);
    };
    items.push(
      { id: "plan", label: "Ship plan adopted", done: lanes.length > 0, why: lanes.length ? `${lanes.length} lanes, ${lanes.reduce((s, lane) => s + (Array.isArray(lane.items) ? lane.items.length : 0), 0)} items — compiled from the Blueprint` : undefined },
      ...artifactItems(),
      { id: "evals", label: "Validation & evals lane green", done: laneDone("validation") },
      { id: "cutover", label: "Cutover executed", done: laneDone("cutover") },
      { id: "go", label: "Go / no-go conversation recorded", done: has("goDecisionRef"), anchor: "input:goDecisionRef", why: whyFromValue(inputs.goDecisionRef) },
    );
  } else if (movement.id === "evolve") {
    const benefits = parseGridRows(inputs.realisedBenefits);
    items.push(
      { id: "ops", label: "An ops review on record", done: has("opsConversations"), anchor: "input:opsConversations", why: whyFromTranscript(inputs.opsConversations) },
      { id: "benefits", label: "Benefits pulse populated", done: benefits.length > 0, anchor: "input:realisedBenefits" },
      ...artifactItems(),
    );
  } else {
    items.push(...artifactItems());
  }
  return items;
}

/** Days until the Frame-declared first-demo date; null when unset. */
export function daysToFirstDemo(program: ProgramSummary): number | null {
  const value = readMovementInputs(program, "frame").targetFirstDemoDate;
  if (typeof value !== "string" || !value) return null;
  const target = new Date(`${value}T12:00:00`).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/** Total words of pasted evidence across every movement — Pulse's counter. */
export function wordsOfEvidence(program: ProgramSummary): number {
  return flowMovements().reduce(
    (sum, movement) => sum + movementEvidence(program, movement).reduce((s, e) => s + e.words, 0),
    0,
  );
}

/**
 * A movement's captured scalar facts (objective, sponsor, chosen framework…) —
 * the inputs that aren't conversations but still tell the chapter's story.
 */
export function movementFacts(program: ProgramSummary, movement: PhaseDefinition): Array<{ label: string; value: string }> {
  const inputs = readMovementInputs(program, movement.id);
  const out: Array<{ label: string; value: string }> = [];
  for (const field of movement.inputFields ?? []) {
    if (field.type === "transcript" || field.type === "document" || field.type === "grid") continue;
    const value = inputs[field.id];
    if (typeof value !== "string" || !value.trim()) continue;
    out.push({ label: field.label, value: value.trim().replace(/\s+/g, " ").slice(0, 72) });
    if (out.length >= 3) break;
  }
  return out;
}

/** Frame's Success KPIs grid, for the Pulse outcome rivers. */
export function frameKpis(program: ProgramSummary): Array<Record<string, string>> {
  return parseGridRows(readMovementInputs(program, "frame").kpis).filter((r) => (r.name ?? "").trim());
}
