/**
 * Copilot grounding pack — the evidence and design context the Copilot needs to
 * answer questions ABOUT THE DESIGN with citations (who said what, when). The
 * Copilot edge only ever saw a PMO digest (decisions/risks/milestones), never
 * the Experience Design nor the discovery transcripts behind it, so it could not
 * attribute a screen or a decision to a stakeholder. This assembles that pack
 * client-side — reusing movementEvidence (which already parses speaker + date
 * out of the transcripts) and the Experience Design doc — and the sidebar sends
 * it with each message. The edge folds it into the prompt and echoes back the
 * [E#] citations the answer actually used.
 */
import type { ProgramSummary } from "@/new/types";
import { flowMovements, movementEvidence } from "@/v3/components/flow/flowShellData";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";

/** One citable piece of evidence — a transcript/document block with attribution. */
export interface CopilotCitation {
  /** Stable tag the model cites inline, e.g. "E3". */
  id: string;
  /** Who it came from — the speaker/stakeholder, first name(s) + role. */
  who: string;
  /** When it was captured — ISO date (or date+time), empty if unknown. */
  when: string;
  /** The pull quote / excerpt. */
  quote: string;
  /** transcript | document | reference. */
  kind: string;
}

export interface CopilotGrounding {
  /** A compact prose summary of the Experience Design under discussion. */
  design: string;
  /** The discovery evidence, tagged E1..En, that the design rests on. */
  evidence: CopilotCitation[];
}

const asText = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const clip = (s: string, n: number): string => { const t = s.trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** Build the design summary string from the Experience Design artifact. */
function designSummary(program: ProgramSummary): string {
  const ed = readArtifactDoc(program, "experienceDesign");
  if (!ed) return "";
  const parts: string[] = [];
  const intent = asRec(ed.designIntent);
  if (asText(intent.personality)) parts.push(`Design intent: ${clip(asText(intent.personality), 220)}`);

  const screens = asArr(ed.screens).map(asRec).filter((s) => asText(s.name));
  if (screens.length) {
    const rows = screens.slice(0, 12).map((s) => `  - ${asText(s.name)}${asText(s.purpose) ? ` — ${clip(asText(s.purpose), 100)}` : ""}`);
    parts.push(`Screens (${screens.length}):\n${rows.join("\n")}`);
  }

  // Flows carry painAnswered {quote, who} — the design decision's own evidence link.
  const flows = asArr(ed.flows).map(asRec).filter((f) => asText(f.name));
  const painRows = flows.map((f) => {
    const pain = asRec(f.painAnswered);
    const q = asText(pain.quote);
    return q ? `  - ${asText(f.name)} answers: "${clip(q, 120)}"${asText(pain.who) ? ` — ${asText(pain.who)}` : ""}` : "";
  }).filter(Boolean);
  if (painRows.length) parts.push(`Flows and the pain each dissolves:\n${painRows.slice(0, 8).join("\n")}`);

  return parts.join("\n\n");
}

/**
 * Assemble the grounding pack for a programme. Evidence is drawn from the
 * Collect movements (Frame + Listen) — where the transcripts with speaker and
 * date live — capped and quote-truncated to bound the token cost. Returns null
 * when there is neither a design nor any attributable evidence to cite.
 */
export function buildCopilotGrounding(program: ProgramSummary): CopilotGrounding | null {
  const design = designSummary(program);

  const collect = flowMovements().filter((m) => m.id === "frame" || m.id === "listen");
  const seen = new Set<string>();
  const evidence: CopilotCitation[] = [];
  for (const movement of collect) {
    for (const entry of movementEvidence(program, movement)) {
      const who = asText(entry.who).trim();
      const quote = clip(asText(entry.excerpt) || asText(entry.text), 240);
      if (!who || !quote || seen.has(entry.id)) continue;
      seen.add(entry.id);
      evidence.push({
        id: `E${evidence.length + 1}`,
        who,
        when: asText(entry.capturedAt).trim(),
        quote,
        kind: asText(entry.kind) || "transcript",
      });
      if (evidence.length >= 12) break;
    }
    if (evidence.length >= 12) break;
  }

  if (!design && !evidence.length) return null;
  return { design, evidence };
}
