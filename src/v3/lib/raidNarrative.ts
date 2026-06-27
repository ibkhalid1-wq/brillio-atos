/**
 * raidNarrative — the LLM layer over the deterministic RAID synthesis.
 *
 * raidSynthesis.ts infers the cross-type edges (risk → decision, blocker →
 * decision, …) deterministically and emits a factual one-line rollup. That
 * rollup is accurate but terse; it states *that* N decisions trace to open
 * risks, not the causal story a programme lead actually needs to read.
 *
 * This module narrates that story — but the model is never the source of the
 * links. The deterministic linkages are passed in as ground truth and the
 * prompt forbids inventing, dropping, or re-weighting any edge, so the prose can
 * only ever explain edges that programRaid already counts. The narrative is
 * therefore safe to show next to the chips: it can elaborate, never contradict.
 *
 * buildRaidNarrativePrompt is the pure, testable core (synthesis → prompt);
 * narrateRaidSynthesis is the thin wrapper that runs the synthesis and calls the
 * registered AI runtime. It is entirely client-side — no edge function, no
 * deploy — reusing the same requestAIText path the copilot extractors use.
 */
import type { ProgramSummary } from "@/new/types";
import { requestAIText } from "@/lib/adamCopilot";
import type { RaidScope } from "@/v3/lib/programRaid";
import { synthesizeRaid, type RaidSynthesis } from "@/v3/lib/raidSynthesis";

const PERSONA_LENS: Record<string, string> = {
  executive: "an executive sponsor who needs the business consequence and the single decision that unblocks the most",
  architect: "a solution architect who needs the technical dependency chain and which artifact each risk threatens",
  delivery_lead: "a delivery lead who needs what to action first and who owns it",
};

/**
 * Build the (system, user) prompt pair for narrating a RAID synthesis. Pure:
 * given the same synthesis and persona it returns the same strings. Returns null
 * when there is nothing to narrate (no linkages), so callers skip the AI call.
 */
export function buildRaidNarrativePrompt(
  synthesis: RaidSynthesis,
  personaId = "delivery_lead",
): { system: string; user: string } | null {
  if (!synthesis.linkages.length) return null;

  const lens = PERSONA_LENS[personaId] ?? PERSONA_LENS.delivery_lead;
  const system = [
    "You are the RAID synthesis analyst for a transformation programme.",
    `You are writing for ${lens}.`,
    "You are given a set of ALREADY-INFERRED, deterministic causal links between",
    "risks, blockers, and decisions. These links are ground truth.",
    "Rules:",
    "- Use ONLY the links provided. Never invent, drop, merge, or re-rank a link.",
    "- Never introduce a risk, blocker, or decision that is not named in the links.",
    "- Refer to items by their labels, not their ids.",
    "- Write 2–4 short sentences of plain prose — the causal story, then the one",
    "  thing to do next. No headings, no bullet lists, no preamble.",
  ].join("\n");

  const edges = synthesis.linkages
    .map((link, index) => {
      const conf = `${Math.round(link.confidence * 100)}%`;
      return (
        `${index + 1}. ${link.from.kind} "${link.from.label}" ${link.relation} ` +
        `${link.to.kind} "${link.to.label}" — grounded in ${link.basis} (${conf}); ${link.rationale}`
      );
    })
    .join("\n");

  const user = [
    `Facts: ${synthesis.rollup}`,
    "",
    "Causal links (ground truth):",
    edges,
  ].join("\n");

  return { system, user };
}

/**
 * Run the deterministic synthesis, then narrate it via the registered AI runtime.
 * Returns the narrative prose, or "" when there is nothing to narrate or the call
 * fails — callers fall back to the deterministic rollup. Never throws.
 */
export async function narrateRaidSynthesis(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
  personaId = "delivery_lead",
): Promise<string> {
  const synthesis = synthesizeRaid(program, scope, personaId);
  const prompt = buildRaidNarrativePrompt(synthesis, personaId);
  if (!prompt) return "";
  try {
    const raw = await requestAIText(prompt.system, prompt.user, {
      max_tokens: 320,
      description: "raid-synthesis-narrative",
    });
    return String(raw || "").trim();
  } catch {
    return "";
  }
}
