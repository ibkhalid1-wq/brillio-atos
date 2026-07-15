/**
 * The portfolio flywheel: agent designs that earned ACCEPTANCE in other
 * programmes become seeded candidates for this one's Envision. A pattern is
 * only harvested from a programme with at least one accepted track — a
 * demonstrated system — never from a programme that hasn't shown anything.
 */
import type { ProgramSummary } from "@/new/types";
import { listFlowTracks, trackAcceptance } from "@/v3/components/flow/flowTracks";

export interface AgentPattern {
  name: string;
  purpose?: string;
  autonomyLevel?: string;
  /** The programme whose stakeholders accepted the design. */
  programme: string;
}

export function acceptedAgentPatterns(programs: ProgramSummary[], excludeId?: string): AgentPattern[] {
  const out: AgentPattern[] = [];
  const seen = new Set<string>();
  for (const program of programs) {
    if (!program || program.id === excludeId) continue;
    let accepted = false;
    try { accepted = listFlowTracks(program).some((track) => trackAcceptance(track).accepted); }
    catch { accepted = false; }
    if (!accepted) continue;
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const bp = inner.agenticBlueprint;
    const agents = bp && typeof bp === "object" && !Array.isArray(bp) && Array.isArray((bp as Record<string, unknown>).agents)
      ? ((bp as Record<string, unknown>).agents as unknown[])
      : [];
    for (const entry of agents) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const agent = entry as Record<string, unknown>;
      const name = String(agent.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({
        name,
        purpose: typeof agent.purpose === "string" && agent.purpose.trim() ? agent.purpose.trim() : undefined,
        autonomyLevel: typeof agent.autonomyLevel === "string" && agent.autonomyLevel.trim() ? agent.autonomyLevel.trim() : undefined,
        programme: program.name,
      });
      if (out.length >= 8) return out;
    }
  }
  return out;
}
