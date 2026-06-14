export interface AgentMemoryEntry {
  agentId: string;
  phaseId: string;
  programId: string;
  timestamp: string;
  type: "decision" | "feedback" | "artifact_outcome" | "escalation";
  summary: string;
  outcome: "accepted" | "rejected" | "modified" | "escalated";
  confidence: number;
  learningNote?: string;
}

const MEMORY_KEY_PREFIX = "adam_agent_memory_";
const MAX_MEMORY_ENTRIES = 20;
const MAX_CONTEXT_CHARS = 800;

function getMemoryKey(programId: string, agentId: string): string {
  return `${MEMORY_KEY_PREFIX}${programId}_${agentId}`;
}

function readMemoryEntries(programId: string, agentId: string): AgentMemoryEntry[] {
  if (typeof localStorage === "undefined" || !programId || !agentId) return [];
  try {
    const raw = localStorage.getItem(getMemoryKey(programId, agentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is AgentMemoryEntry => {
      if (!entry || typeof entry !== "object") return false;
      return typeof entry.agentId === "string"
        && typeof entry.phaseId === "string"
        && typeof entry.programId === "string"
        && typeof entry.timestamp === "string"
        && typeof entry.type === "string"
        && typeof entry.summary === "string"
        && typeof entry.outcome === "string"
        && typeof entry.confidence === "number";
    });
  } catch {
    return [];
  }
}

function writeMemoryEntries(programId: string, agentId: string, entries: AgentMemoryEntry[]): void {
  if (typeof localStorage === "undefined" || !programId || !agentId) return;
  try {
    localStorage.setItem(
      getMemoryKey(programId, agentId),
      JSON.stringify(entries.slice(-MAX_MEMORY_ENTRIES)),
    );
  } catch {
    // Ignore storage write failures and keep the agent flow moving.
  }
}

export function saveAgentMemory(entry: AgentMemoryEntry): void {
  if (!entry?.agentId || !entry?.programId) return;
  const entries = readMemoryEntries(entry.programId, entry.agentId);
  entries.push(entry);
  writeMemoryEntries(entry.programId, entry.agentId, entries);
}

export function getAgentMemory(agentId: string, programId: string): AgentMemoryEntry[] {
  return readMemoryEntries(programId, agentId)
    .slice()
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

export function buildMemoryContext(agentId: string, programId: string): string {
  const recentEntries = getAgentMemory(agentId, programId).slice(0, 5);
  if (!recentEntries.length) return "";

  const lines: string[] = ["Recent agent memory:"];
  for (const entry of recentEntries) {
    const baseLine = `- ${entry.phaseId}: ${entry.summary} Outcome=${entry.outcome}. Confidence=${Math.round(entry.confidence * 100)}%.`;
    const learningLine = entry.learningNote ? ` Learning: ${entry.learningNote}` : "";
    const candidate = `${baseLine}${learningLine}`;
    const nextText = [...lines, candidate].join("\n");
    if (nextText.length > MAX_CONTEXT_CHARS) break;
    lines.push(candidate);
  }

  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}
