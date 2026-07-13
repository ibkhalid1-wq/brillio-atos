/**
 * Document routing — the Library attach that reads what it was given.
 *
 * When a file lands in the Library the app should not file it blind: it can
 * DETERMINE what the document is (a meeting transcript vs. source material),
 * WHO spoke or is discussed (matched against each movement's own roster), and
 * WHERE it belongs (the movement whose people it involves) — then attach it as
 * those stakeholders' evidence, each matched speaker getting their own
 * attributed block exactly as a card attachment would.
 *
 * Everything here is deterministic — transcript structure detection and
 * name/alias matching, no model call — and PURE: it returns a proposed route
 * plus ready-to-write blocks; the Library shows the inference and the operator
 * confirms with one click before anything lands. Inference is visible, the
 * record only changes on confirm.
 */
import type { ProgramSummary } from "@/new/types";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { meetingKit } from "@/v3/components/flow/flowMeetings";
import { evidenceStamp } from "@/v3/components/flow/flowShellData";

/** The movements that collect stakeholder evidence, in spine order. */
const EVIDENCE_MOVEMENTS = ["frame", "listen", "show"] as const;

export interface DocRoute {
  kind: "transcript" | "document";
  /** Where to file — the movement whose roster the content matched. */
  movementId: string;
  /** The phase-input field the movement captures evidence into. */
  captureField: string;
  /** Roster names the content matched (speakers for transcripts, mentions for documents). */
  matched: string[];
  /** Transcript speakers that matched no roster (surfaced, never invented). */
  unmatched: string[];
  /** Per-speaker attributed blocks, ready to write (transcripts only). */
  speakerBlocks: Array<{ name: string; role?: string; text: string }>;
  /** One line explaining the inference — shown to the operator to confirm. */
  summary: string;
}

const fallbackField = (program: ProgramSummary, movementId: string): string =>
  meetingKit(program, movementId)?.captureField
    ?? (movementId === "frame" ? "sponsorConversation" : movementId === "show" ? "steeringConversation" : "interviewTranscripts");

/** Count how many of a movement's roster names appear anywhere in the text. */
function mentionMatches(text: string, roster: Array<{ name: string }>): string[] {
  const hay = text.toLowerCase();
  return roster
    .map((person) => person.name.trim())
    .filter((name) => name.length > 2 && hay.includes(name.toLowerCase()));
}

/**
 * Read an attached document and propose where it belongs. Never returns null —
 * a document that matches nothing still routes (as unattributed source
 * material in Listen), it just says so honestly in the summary. Pass
 * `forceMovement` to recompute the same inference for an operator-chosen
 * movement (the confirm panel's retarget).
 */
export function routeAttachedDocument(program: ProgramSummary, text: string, forceMovement?: string): DocRoute {
  // 1) Transcript? Auto-pick tries LISTEN first (discovery is the canonical
  //    home of multi-voice evidence), then FRAME (the sponsor conversation).
  //    SHOW never auto-wins: its roster is listen + sponsor, a superset that
  //    would outbid the true home of every mixed conversation — it competes
  //    only when the operator retargets, or nothing else has a roster. Voices
  //    that match no roster stay in the document block and are surfaced as
  //    unmatched — the unrostered-voices watcher picks them up from there.
  const order = forceMovement
    ? [forceMovement]
    : (["listen", "frame"] as string[]).concat(
        resolveMovementStakeholders(program, "listen").length || resolveMovementStakeholders(program, "frame").length ? [] : ["show"]);
  let best: { movementId: string; mapping: NonNullable<ReturnType<typeof mapTranscriptSpeakers>> } | null = null;
  for (const movementId of order) {
    const roster = resolveMovementStakeholders(program, movementId).map((s) => ({ name: s.name, role: s.role }));
    if (!roster.length) continue;
    const mapping = mapTranscriptSpeakers(text, roster);
    if (mapping && mapping.matched.length > (best?.mapping.matched.length ?? 0)) {
      best = { movementId, mapping };
    }
  }
  if (best) {
    const { movementId, mapping } = best;
    const label = movementId.charAt(0).toUpperCase() + movementId.slice(1);
    return {
      kind: "transcript",
      movementId,
      captureField: fallbackField(program, movementId),
      matched: mapping.matched,
      unmatched: mapping.unmatched,
      speakerBlocks: mapping.blocks,
      summary: `Reads as a meeting transcript — ${mapping.matched.length} voice${mapping.matched.length === 1 ? "" : "s"} match the ${label} roster (${mapping.matched.join(", ")})${mapping.unmatched.length ? `; unmatched: ${mapping.unmatched.join(", ")}` : ""}.`,
    };
  }

  // 2) Not transcript-shaped: file as source material where its people are.
  //    A document that NAMES a movement's stakeholders lands as their context.
  let mentionBest: { movementId: string; names: string[] } = { movementId: forceMovement ?? "listen", names: [] };
  for (const movementId of forceMovement ? [forceMovement] : EVIDENCE_MOVEMENTS) {
    const roster = resolveMovementStakeholders(program, movementId);
    const names = mentionMatches(text, roster);
    if (names.length > mentionBest.names.length) mentionBest = { movementId, names };
  }
  const label = mentionBest.movementId.charAt(0).toUpperCase() + mentionBest.movementId.slice(1);
  return {
    kind: "document",
    movementId: mentionBest.movementId,
    captureField: fallbackField(program, mentionBest.movementId),
    matched: mentionBest.names,
    unmatched: [],
    speakerBlocks: [],
    summary: mentionBest.names.length
      ? `Reads as source material mentioning ${mentionBest.names.join(", ")} — filing with the ${label} evidence.`
      : "Reads as source material — no roster names found; filing as unattributed Listen evidence.",
  };
}

/**
 * The ready-to-write phase-input patch for a confirmed route: the canonical
 * document block (full text + the [source:] pointer so the original stays
 * downloadable), plus each matched speaker's own attributed block.
 */
export function buildRoutedBlocks(route: DocRoute, docTitle: string, text: string, existing: string, sourceKey?: string, attributeSpeakers = true): string {
  const day = evidenceStamp();
  const docBlock = `— Document: ${docTitle}, provided by the programme team, ${day} —\n${sourceKey ? `[source: ${sourceKey}]\n` : ""}${text}`;
  const speakerBlocks = attributeSpeakers
    ? route.speakerBlocks.map((block) => `— ${[block.name, block.role, day].filter(Boolean).join(", ")} —\n${block.text}`)
    : [];
  return [existing.trimEnd(), docBlock, ...speakerBlocks].filter(Boolean).join("\n\n");
}
