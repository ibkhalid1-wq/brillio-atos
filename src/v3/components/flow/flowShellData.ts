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
import { getFormalArtifactContent, getFormalArtifactConfidence, FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { listFlowTracks, trackAcceptance } from "@/v3/components/flow/flowTracks";

/**
 * Find a quoted claim inside a source transcript, tolerantly: curly quotes
 * flatten to straight, whitespace runs collapse, trailing "— Speaker"
 * attributions are dropped, and shrinking prefixes retry when the tail was
 * paraphrased. Returns raw-string offsets so callers can highlight in place.
 */
export function locateQuote(haystack: string, quote: string): { start: number; end: number } | null {
  const canon = (ch: string) =>
    ch === "\u2018" || ch === "\u2019" ? "'" : ch === "\u201c" || ch === "\u201d" ? '"' : ch.toLowerCase();
  const normalize = (raw: string): { norm: string; map: number[] } => {
    let norm = "";
    const map: number[] = [];
    let pendingSpace = false;
    for (let i = 0; i < raw.length; i += 1) {
      if (/\s/.test(raw[i])) { pendingSpace = norm.length > 0; continue; }
      if (pendingSpace) { norm += " "; map.push(i); pendingSpace = false; }
      norm += canon(raw[i]);
      map.push(i);
    }
    return { norm, map };
  };
  const hay = normalize(haystack);
  const needle = normalize(
    quote.replace(/\s*[\u2014\u2013-]\s*[A-Z][\w .,'\u2019-]{2,60}$/, "").replace(/^["'\u201c\u2018\s]+|["'\u201d\u2019.\s]+$/g, ""),
  ).norm;
  if (needle.length < 12) return null;
  for (const len of [needle.length, 90, 60, 36]) {
    if (len > needle.length) continue;
    const probe = needle.slice(0, len).trim();
    if (probe.length < 16 && len !== needle.length) break;
    const at = hay.norm.indexOf(probe);
    if (at >= 0) return { start: hay.map[at], end: hay.map[at + probe.length - 1] + 1 };
  }
  return null;
}

export interface EvidenceEntry {
  movementId: string;
  fieldLabel: string;
  /** Header line when the transcript declares one ("— Maria Chen, Sales Ops, … —"). */
  who: string;
  meta: string;
  words: number;
  excerpt: string;
  kind: "transcript" | "reference" | "document";
  /** Track named in the attribution — "(Quote Automation)" in the header. */
  track?: string;
  /** The full attributed block — the drill-down's reading target. */
  text: string;
  /** Storage key of the ORIGINAL file (documents only) — the Library offers
   * it back as a native-format download instead of a preview. */
  sourceKey?: string;
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
  /** Open gaps the generator declared inside the document itself. */
  gaps: number;
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
  const headerRe = /^[—–-]{1,2}\s*(.{3,200}?)\s*[—–-]{1,2}\s*$/gm;
  const entries: EvidenceEntry[] = [];
  // Only attribution-shaped headers split the text: "Name, Role, Date" (has a
  // comma) or a "Document: …" block. Dash-wrapped lines INSIDE pasted document
  // content ("— INPUT SIGNALS —") must never mint a phantom voice.
  const matches = [...text.matchAll(headerRe)].filter((match) =>
    match[1].includes(",") || /^Document:/i.test(match[1].trim()));
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
      words: wordCount(text), excerpt: firstLine(text), text: text.trim(),
    }];
  }
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const body = text.slice(start, end);
    const trackTag = match[1].match(/\(([^)]{2,60})\)/);
    // "— Document: Q2 pricing export, provided by Dan Reyes, 2026-07-12 —"
    // is a DOCUMENT on the record, named by its title — not a voice.
    const doc = match[1].match(/^Document:\s*(.+?),\s*provided by\s+(.+?)(?:,\s*(\d{4}-\d{2}-\d{2}))?$/i);
    if (doc) {
      // An optional "[source: <storage key>]" first line carries the pointer
      // to the original file; it is metadata, never part of the reading text.
      const sourceMatch = body.match(/^\s*\[source:\s*([^\]]+)\]\s*\n?/);
      const cleanBody = sourceMatch ? body.replace(sourceMatch[0], "") : body;
      entries.push({
        movementId, fieldLabel, kind: "document",
        who: doc[1].trim(),
        meta: `document · ${doc[2].trim()}${doc[3] ? ` · ${doc[3]}` : ""} · ${wordCount(cleanBody).toLocaleString()} words`,
        words: wordCount(cleanBody),
        excerpt: firstLine(cleanBody),
        text: cleanBody.trim(),
        sourceKey: sourceMatch ? sourceMatch[1].trim() : undefined,
      });
      return;
    }
    entries.push({
      movementId, fieldLabel, kind: "transcript",
      who: match[1],
      track: trackTag ? trackTag[1].trim() : undefined,
      meta: `${wordCount(body).toLocaleString()} words`,
      words: wordCount(body),
      excerpt: firstLine(body),
      text: body.trim(),
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
        who: value.trim(), meta: field.label, words: 0, excerpt: "", text: "",
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
    // The card's excerpt leads with the document's own summary when it has
    // one — the flattened fallback alphabetizes keys, which put "gaps" first
    // and made every gapped card shout its gap instead of its content.
    const mirrorDoc = root[FORMAL_ARTIFACT_FIELD_KEYS[def.id]];
    const summaryText = mirrorDoc && typeof mirrorDoc === "object" && !Array.isArray(mirrorDoc)
      && typeof (mirrorDoc as Record<string, unknown>).summary === "string"
      ? ((mirrorDoc as Record<string, unknown>).summary as string).trim()
      : "";
    const excerpt = summaryText
      ? summaryText.replace(/\s+/g, " ").slice(0, 150)
      : content ? content.replace(/[#*`>\n-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) : null;
    const confidence = getFormalArtifactConfidence(root, def.id)
      ?? (typeof stub?.confidence === "number" ? Math.round(stub.confidence) : null);
    const present = !!content || !!stub;
    const mirror = root[FORMAL_ARTIFACT_FIELD_KEYS[def.id]];
    const gaps = present && mirror && typeof mirror === "object" && !Array.isArray(mirror)
      && Array.isArray((mirror as Record<string, unknown>).gaps)
      ? ((mirror as Record<string, unknown>).gaps as unknown[]).filter(Boolean).length
      : 0;
    return {
      id: def.id, movementId: movement.id, title: def.label, description: def.description,
      excerpt, confidence, present, gaps,
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
  /** Which facet of readiness the row belongs to; evidence when absent. */
  group?: "evidence" | "record" | "judgment";
  /** Editor field to land on when the item is worked (input:<fieldId>). */
  anchor?: string;
  /** Record rows: the artifact the row reads — click opens the document. */
  artifactId?: string;
  /** Judgment rows: the row is worked in the Inbox. */
  inbox?: boolean;
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
    label: artifact.stale ? `${artifact.title} — evidence changed since generation` : `${artifact.title} generated`,
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
      { id: "industry", label: "Industry set — grounds the ontology's shared vocabulary", done: has("industry"), anchor: "input:industry", why: whyFromValue(inputs.industry) },
      { id: "metric", label: "Success measure set", done: has("successMetric"), anchor: "input:successMetric", why: whyFromValue(inputs.successMetric) },
      { id: "demo-date", label: "First-demonstration date set", done: has("targetFirstDemoDate"), anchor: "input:targetFirstDemoDate", why: whyFromValue(inputs.targetFirstDemoDate) },
    );
  } else if (movement.id === "listen") {
    const coverage = listenCoverage(program);
    const contradictions = parseGridRows(inputs.contradictionLog);
    const personaAtlas = personasMissingFromAtlas(program);
    if (personaAtlas) {
      items.push({
        id: "personas-act",
        label: personaAtlas.missing.length
          ? `Every persona acts in the Atlas — ${personaAtlas.missing.length} of ${personaAtlas.total} missing`
          : `Every persona acts in the Atlas (${personaAtlas.total})`,
        done: personaAtlas.missing.length === 0,
        why: personaAtlas.missing.length
          ? `${personaAtlas.missing.slice(0, 3).join(", ")} — no workflow step names them; ask, then regenerate the Atlas`
          : undefined,
      });
    }
    items.push(
      { id: "mapped", label: "Voices mapped in the coverage ledger", done: coverage.total > 0, anchor: "input:interviewRoster" },
      { id: "heard", label: coverage.total ? `Every voice heard or waived (${coverage.done}/${coverage.total})` : "Every voice heard or waived", done: coverage.total > 0 && coverage.done >= coverage.total, anchor: "input:interviewRoster" },
      (() => {
        const latest = [...contradictions].reverse().find((row) => row.resolution);
        return {
          id: "contradictions",
          label: "Contradictions resolved or logged",
          done: contradictions.every((row) => !/open/i.test(row.status ?? "")),
          anchor: "input:contradictionLog",
          why: contradictions.length
            ? `${contradictions.length} logged, none open${latest ? ` — latest ruling: “${String(latest.resolution).slice(0, 70)}” (${[latest.resolvedBy, latest.resolvedAt].filter(Boolean).join(", ")})` : ""}`
            : undefined,
        };
      })(),
    );
  } else if (movement.id === "envision") {
    items.push(
      { id: "direction", label: "Direction chosen on the record", done: has("directionDecision") || has("steeringConversation"), anchor: "input:directionDecision", why: whyFromValue(inputs.directionDecision) ?? whyFromTranscript(inputs.steeringConversation) },
      { id: "tracks", label: "Track plan adopted", done: Array.isArray(inner.tracks) && (inner.tracks as unknown[]).length > 0, why: Array.isArray(inner.tracks) && (inner.tracks as unknown[]).length ? `${(inner.tracks as unknown[]).length} tracks, confirmed by you` : undefined },
    );
  } else if (movement.id === "show") {
    const tour = demoAcceptance(program);
    // Approval is BY STAKEHOLDER and BY TRACK, and both close the loop back
    // to Listen: every voice heard must watch their workflow run, and every
    // track must converge to acceptance.
    const heard = parseGridRows(readMovementInputs(program, "listen").interviewRoster)
      .filter((row) => /heard/i.test(row.status ?? ""))
      .map((row) => String(row.name ?? "").trim())
      .filter(Boolean);
    const toured = new Set(tour.rows.map((row) => (row.stakeholder ?? "").trim().toLowerCase()));
    const missingVoices = heard.filter((name) => !toured.has(name.toLowerCase()));
    const tracks = listFlowTracks(program);
    const acceptedTracks = tracks.filter((track) => trackAcceptance(track).accepted);
    const pendingTracks = tracks.filter((track) => !trackAcceptance(track).accepted);
    items.push(
      { id: "proto", label: "Prototype running somewhere named", done: has("prototypeLocation"), anchor: "input:prototypeLocation", why: whyFromValue(inputs.prototypeLocation) },
      {
        id: "tour",
        label: heard.length
          ? `A demo row for every voice heard (${heard.length - missingVoices.length}/${heard.length})`
          : "A demo row for every voice",
        done: heard.length ? missingVoices.length === 0 : tour.total > 0,
        anchor: "input:demoTour",
        why: missingVoices.length ? `still to see it: ${missingVoices.slice(0, 2).join(", ")}${missingVoices.length > 2 ? "…" : ""}` : undefined,
      },
      { id: "verdicts", label: tour.total ? `Every stakeholder accepted (${tour.accepted}/${tour.total})` : "Every stakeholder accepted", done: tour.total > 0 && tour.accepted >= tour.total, anchor: "input:demoTour" },
    );
    if (tracks.length) {
      items.push({
        id: "tracks-accepted",
        label: `Every track accepted (${acceptedTracks.length}/${tracks.length})`,
        done: pendingTracks.length === 0,
        why: pendingTracks.length
          ? `still converging: ${pendingTracks.slice(0, 2).map((track) => track.name).join(", ")}${pendingTracks.length > 2 ? "…" : ""}`
          : `all ${tracks.length} converged — two accepted passes or accepted-over-stable`,
      });
    }
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
      { id: "evals", label: "Validation & evals lane green", done: laneDone("validation") },
      { id: "cutover", label: "Cutover executed", done: laneDone("cutover") },
      { id: "go", label: "Go / no-go conversation recorded", done: has("goDecisionRef"), anchor: "input:goDecisionRef", why: whyFromValue(inputs.goDecisionRef) },
    );
  } else if (movement.id === "evolve") {
    const benefits = parseGridRows(inputs.realisedBenefits);
    items.push(
      { id: "ops", label: "An ops review on record", done: has("opsConversations"), anchor: "input:opsConversations", why: whyFromTranscript(inputs.opsConversations) },
      { id: "benefits", label: "Benefits pulse populated", done: benefits.length > 0, anchor: "input:realisedBenefits" },
    );
  } else {
    items.push(...artifactItems());
  }
  // Flow movements close the loop: after the evidence criteria come the
  // record (every document current) and the judgment facet (Inbox clear) —
  // one consistent checklist over everything readiness reads.
  if (FLOW_MOVEMENT_IDS.has(movement.id)) {
    const openIssues = movementOpenIssues(program, movement);
    items.push(
      ...artifacts.map((artifact): GateCheckItem => ({
        id: `art-${artifact.id}`,
        group: "record",
        artifactId: artifact.id,
        label: artifact.present && artifact.stale
          ? `${artifact.title} — evidence changed since generation`
          : artifact.present && artifact.gaps
            ? `${artifact.title} — ${artifact.gaps} open gap${artifact.gaps === 1 ? "" : "s"}`
            : `${artifact.title} generated`,
        done: artifact.present && !artifact.stale && artifact.gaps === 0,
        why: artifact.present && !artifact.stale && artifact.gaps === 0 && artifact.confidence != null
          ? `confidence ${artifact.confidence}%`
          : undefined,
      })),
      ...(movement.id === "frame" ? (() => {
        // Personas ≠ stakeholders: every role in the workflow — internal and
        // external — needs at least one interviewee who can speak for it.
        const personas = kitPersonas(program);
        if (personas === null) return [];
        const voiceless = personas.filter((persona) => persona.unrepresented || persona.spokenForBy.length === 0);
        return [{
          id: "kit-personas",
          group: "record" as const,
          label: personas.length === 0
            ? "Workflow personas inventoried"
            : voiceless.length
              ? `Every persona has a voice — ${voiceless.length} unrepresented`
              : `Every persona has a voice (${personas.length})`,
          done: personas.length > 0 && voiceless.length === 0,
          why: personas.length === 0
            ? "Regenerate the Discovery Kit — it now inventories every role in the workflow, internal and external"
            : voiceless.length
              ? `${voiceless.map((persona) => persona.name).slice(0, 3).join(", ")} — name who speaks for them in the Discovery Kit`
              : undefined,
        }];
      })() : []),
      ...(movement.id === "frame" ? (() => {
        // The kit is a roster the async loop SENDS to: every planned interview
        // needs an address on file. Emails come from the operator (or the
        // transcripts) — never from the generator, so this asks the human.
        const kit = dataRoot(program).discoveryKit;
        const interviews = kit && typeof kit === "object" && !Array.isArray(kit) && Array.isArray((kit as Record<string, unknown>).interviews)
          ? ((kit as Record<string, unknown>).interviews as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
          : [];
        if (!interviews.length) return [];
        const missing = interviews.filter((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(entry.email ?? "").trim())).length;
        return [{
          id: "kit-emails",
          group: "record" as const,
          label: missing ? `Stakeholder emails on file — ${missing} missing` : "Stakeholder emails on file",
          done: missing === 0,
          why: missing ? "Response links need an address — add emails in the Discovery Kit" : undefined,
        }];
      })() : []),
      ...(artifacts.some((artifact) => artifact.present) ? [{
        id: "issues",
        group: "record" as const,
        label: openIssues.length
          ? `Open questions & ambiguities — ${openIssues.length} to resolve`
          : "No open questions or ambiguities",
        done: openIssues.length === 0,
        why: openIssues.length
          ? `${openIssues[0].text.slice(0, 70)}${openIssues.length > 1 ? ` · +${openIssues.length - 1} more` : ""} — asked in the follow-up; regenerate after capturing`
          : undefined,
      }] : []),
      (() => {
        const waiting = openDecisionCount(program, movement.id);
        return {
          id: "inbox",
          group: "judgment" as const,
          inbox: true,
          label: waiting
            ? `${waiting} decision${waiting > 1 ? "s" : ""} waiting in the Inbox`
            : "Inbox clear — nothing waiting",
          done: waiting === 0,
        };
      })(),
    );
  }
  return items;
}

const FLOW_MOVEMENT_IDS = new Set(["frame", "listen", "envision", "show", "ship", "evolve"]);

/** Open Tier-2/3 decisions parked in the Inbox for a movement. */
function openDecisionCount(program: ProgramSummary, movementId: string): number {
  const list = dataRoot(program).flowDecisions;
  if (!Array.isArray(list)) return 0;
  return list.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const decision = entry as Record<string, unknown>;
    const status = decision.status === "confirmed" || decision.status === "declined" ? decision.status : "open";
    return decision.movementId === movementId && status === "open";
  }).length;
}

export interface GateReadiness {
  tone: "green" | "amber" | "dim";
  /** Which state the gate is in — drives glyph and styling. */
  kind: "demonstrated" | "open" | "trails" | "gaps" | "judgment" | "ready" | "signal";
  headline: string;
  detail?: string;
}

/**
 * The gate verdict as ONE composed state over the whole checklist — the
 * evidence criteria, the record (documents current) and the judgment facet
 * (Inbox clear). Green only when the loop is closed on all three.
 */
export function gateReadiness(
  program: ProgramSummary,
  movement: PhaseDefinition,
  artifacts: ArtifactCardModel[],
  checks: GateCheckItem[],
): GateReadiness {
  if (program.gateReviews?.[movement.id]?.status === "approved") {
    return { tone: "green", kind: "demonstrated", headline: "Demonstrated — gate recorded" };
  }
  if (!checks.length) {
    const signal = gateSignal(program, movement, artifacts);
    return { tone: signal.tone, kind: "signal", headline: signal.text };
  }
  const done = checks.filter((item) => item.done).length;
  const counts = `${done} of ${checks.length} criteria met`;
  const openIn = (group: GateCheckItem["group"]) =>
    checks.some((item) => !item.done && (item.group ?? "evidence") === group);
  if (openIn("evidence")) {
    // Momentum reads off the evidence facet — trivially-met record/judgment
    // rows must not light a movement nobody has started.
    const evidenceDone = checks.some((item) => item.done && (item.group ?? "evidence") === "evidence");
    return { tone: evidenceDone ? "amber" : "dim", kind: "open", headline: counts };
  }
  if (openIn("record")) {
    // "Out of date" is reserved for documents that EXIST and trail their
    // evidence — a document never generated is simply not written yet.
    const trailing = artifacts.some((artifact) => artifact.present && artifact.stale);
    const missing = artifacts.some((artifact) => !artifact.present);
    const asking = checks.some((item) => !item.done && item.id === "issues");
    return trailing
      ? { tone: "amber", kind: "trails", headline: counts, detail: "Documents are out of date — evidence changed" }
      : asking
        ? { tone: "amber", kind: "gaps", headline: counts, detail: "The documents still have open questions" }
        : missing
          ? { tone: "amber", kind: "gaps", headline: counts, detail: "A document has not been generated yet" }
          : { tone: "amber", kind: "gaps", headline: counts, detail: "A document still lists open gaps" };
  }
  if (openIn("judgment")) {
    return { tone: "amber", kind: "judgment", headline: counts, detail: "A decision is waiting in the Inbox" };
  }
  return {
    tone: "green",
    kind: "ready",
    headline: movement.movement?.isLoop ? "Running steady" : "Ready for the gate",
    detail: `${checks.length} criteria met · documents current · Inbox clear`,
  };
}

/** One step of the spine plan: a stale document, in movement order. */
export interface SpineStep {
  artifactId: string;
  movementId: string;
  title: string;
}

/**
 * The regeneration plan the dependency spine implies: every PRESENT document
 * whose evidence moved after it was written, upstream movements first — the
 * order that lets each regeneration read its refreshed upstream context.
 * (Gap-only documents are excluded: regenerating over unchanged inputs
 * reproduces the same gaps; gaps close through capture, not re-runs.)
 */
export function spineRegenerationPlan(program: ProgramSummary): SpineStep[] {
  const steps: SpineStep[] = [];
  for (const movement of flowMovements()) {
    for (const artifact of movementArtifacts(program, movement)) {
      if (artifact.present && artifact.stale) {
        steps.push({ artifactId: artifact.id, movementId: movement.id, title: artifact.title });
      }
    }
  }
  return steps;
}

/** The Discovery Kit's persona inventory — every role in the workflow,
 * internal and external, distinct from the interview roster. */
export interface KitPersona {
  name: string;
  kind: string;
  spokenForBy: string[];
  unrepresented: boolean;
}
export function kitPersonas(program: ProgramSummary): KitPersona[] | null {
  const kit = dataRoot(program).discoveryKit;
  if (!kit || typeof kit !== "object" || Array.isArray(kit)) return null;
  const list = (kit as Record<string, unknown>).personas;
  if (!Array.isArray(list)) return null;
  return list
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      name: String(entry.name ?? "").trim(),
      kind: String(entry.kind ?? "internal"),
      spokenForBy: Array.isArray(entry.spokenForBy) ? entry.spokenForBy.map(String).filter(Boolean) : [],
      unrepresented: entry.unrepresented === true,
    }))
    .filter((persona) => persona.name);
}

/** Personas that never act in any Atlas workflow — loose token match so
 * "Sales Rep" finds an actor written "sales rep" or "Sales Representative". */
export function personasMissingFromAtlas(program: ProgramSummary): { missing: string[]; total: number } | null {
  const personas = kitPersonas(program);
  const atlas = dataRoot(program).currentStateAtlas;
  if (!personas || !personas.length || !atlas || typeof atlas !== "object" || Array.isArray(atlas)) return null;
  const workflows = Array.isArray((atlas as Record<string, unknown>).workflows)
    ? ((atlas as Record<string, unknown>).workflows as unknown[]).filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
    : [];
  if (!workflows.length) return null;
  const actorTokens = new Set<string>();
  for (const workflow of workflows) {
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    for (const step of steps) {
      if (typeof step === "object" && step !== null) {
        for (const token of String((step as Record<string, unknown>).actor ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
          if (token.length >= 3) actorTokens.add(token.replace(/s$/, ""));
        }
      }
    }
  }
  const missing = personas
    .filter((persona) => {
      const tokens = persona.name.toLowerCase().split(/[^a-z0-9]+/)
        .map((token) => token.replace(/s$/, "")).filter((token) => token.length >= 3);
      return tokens.length > 0 && !tokens.some((token) => actorTokens.has(token));
    })
    .map((persona) => persona.name);
  return { missing, total: personas.length };
}

/** One unresolved question the record is carrying. */
export interface OpenIssue {
  artifactId: string;
  artifactTitle: string;
  kind: "ambiguity" | "open-question";
  text: string;
}

/**
 * Everything a movement's documents still ASK: unresolved ambiguities
 * (terminology collisions with no adopted meaning) and open questions. These
 * resolve through evidence — they flow into the follow-up scripts, and the
 * gate holds until the record stops asking.
 */
export function movementOpenIssues(program: ProgramSummary, movement: PhaseDefinition): OpenIssue[] {
  const root = dataRoot(program);
  const issues: OpenIssue[] = [];
  for (const def of getPhaseArtifactDefs(movement.id)) {
    const mirror = root[FORMAL_ARTIFACT_FIELD_KEYS[def.id]];
    if (!mirror || typeof mirror !== "object" || Array.isArray(mirror)) continue;
    const doc = mirror as Record<string, unknown>;
    if (Array.isArray(doc.ambiguities)) {
      for (const row of doc.ambiguities) {
        if (!row || typeof row !== "object") continue;
        const entry = row as Record<string, unknown>;
        const resolution = String(entry.resolution ?? "").trim();
        if (resolution && !/unresolved/i.test(resolution)) continue;
        const meanings = Array.isArray(entry.conflictingMeanings) ? entry.conflictingMeanings.map(String).join(" vs ") : "";
        issues.push({
          artifactId: def.id,
          artifactTitle: def.label,
          kind: "ambiguity",
          text: `Two teams use “${String(entry.term ?? "")}” differently${meanings ? ` (${meanings})` : ""} — which meaning should the record adopt?`,
        });
      }
    }
    if (Array.isArray(doc.openQuestions)) {
      for (const question of doc.openQuestions) {
        const text = String(question ?? "").trim();
        if (text) issues.push({ artifactId: def.id, artifactTitle: def.label, kind: "open-question", text });
      }
    }
  }
  return issues;
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
