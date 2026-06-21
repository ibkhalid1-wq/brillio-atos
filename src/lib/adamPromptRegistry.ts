import {
  ADAM_AGENT_PROMPTS,
  type AdamAgentId,
} from "@/lib/adamAgentPrompts";

export interface PromptVersion {
  agentId: string;
  version: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  changelog: string;
  publishedAt: string;
  publishedBy: string;
  evalScores?: {
    overallScore: number;
    byDimension: Record<string, number>;
    sampleSize: number;
    evalRunId: string;
  };
  status: "draft" | "active" | "deprecated";
}

const STORAGE_KEY = "adam_prompt_registry_v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cloneRegistry(input: Record<string, PromptVersion[]>): Record<string, PromptVersion[]> {
  return JSON.parse(JSON.stringify(input)) as Record<string, PromptVersion[]>;
}

function buildDefaultRegistry(): Record<string, PromptVersion[]> {
  const publishedAt = "2026-06-11T00:00:00.000Z";
  return Object.fromEntries(
    Object.entries(ADAM_AGENT_PROMPTS).map(([agentId, bundle]) => [
      agentId,
      [
        {
          agentId,
          version: "1.0.0",
          prompt: bundle.prompt,
          outputSchema: bundle.outputSchema as unknown as Record<string, unknown>,
          changelog: "Initial production prompt with typed output schema, confidence calibration, pause protocol, and quality bar.",
          publishedAt,
          publishedBy: "system",
          status: "active" as const,
        } as PromptVersion,
      ],
    ]),
  );
}

function readStoredRegistry(): Record<string, PromptVersion[]> | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, PromptVersion[]>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function persistRegistry(nextRegistry: Record<string, PromptVersion[]>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRegistry));
  } catch {
    return;
  }
}

export let PROMPT_REGISTRY: Record<string, PromptVersion[]> = readStoredRegistry() || buildDefaultRegistry();

function updateRegistry(nextRegistry: Record<string, PromptVersion[]>): void {
  PROMPT_REGISTRY = cloneRegistry(nextRegistry);
  persistRegistry(PROMPT_REGISTRY);
}

function getAgentVersions(agentId: string): PromptVersion[] {
  const versions = PROMPT_REGISTRY[agentId];
  if (!versions?.length) {
    throw new Error(`No prompt versions registered for agent ${agentId}`);
  }
  return versions;
}

export function getActivePrompt(agentId: string): PromptVersion {
  const versions = getAgentVersions(agentId);
  const active = versions.find((version) => version.status === "active");
  if (!active) {
    throw new Error(`No active prompt found for agent ${agentId}`);
  }
  return { ...active };
}

export function getPromptVersion(agentId: string, version: string): PromptVersion {
  const versions = getAgentVersions(agentId);
  const match = versions.find((entry) => entry.version === version);
  if (!match) {
    throw new Error(`Prompt version ${version} not found for agent ${agentId}`);
  }
  return { ...match };
}

export function promotePromptVersion(agentId: string, version: string): void {
  const versions = getAgentVersions(agentId);
  if (!versions.some((entry) => entry.version === version)) {
    throw new Error(`Prompt version ${version} not found for agent ${agentId}`);
  }
  const next = cloneRegistry(PROMPT_REGISTRY);
  next[agentId] = next[agentId].map((entry) => ({
    ...entry,
    status: entry.version === version ? "active" : entry.status === "active" ? "deprecated" : entry.status,
  }));
  updateRegistry(next);
}

export function deprecatePromptVersion(agentId: string, version: string): void {
  const versions = getAgentVersions(agentId);
  const target = versions.find((entry) => entry.version === version);
  if (!target) {
    throw new Error(`Prompt version ${version} not found for agent ${agentId}`);
  }
  if (target.status === "active") {
    const fallback = versions.find((entry) => entry.version !== version && entry.status !== "deprecated");
    if (!fallback) {
      throw new Error(`Cannot deprecate the only active prompt for agent ${agentId}`);
    }
  }

  const next = cloneRegistry(PROMPT_REGISTRY);
  next[agentId] = next[agentId].map((entry) => {
    if (entry.version === version) return { ...entry, status: "deprecated" as const };
    if (target.status === "active" && entry.status !== "deprecated") return { ...entry, status: "active" as const };
    return entry;
  });
  updateRegistry(next);
}

export function updatePromptEvalScores(
  agentId: AdamAgentId,
  version: string,
  evalScores: NonNullable<PromptVersion["evalScores"]>,
): void {
  const versions = getAgentVersions(agentId);
  if (!versions.some((entry) => entry.version === version)) {
    throw new Error(`Prompt version ${version} not found for agent ${agentId}`);
  }
  const next = cloneRegistry(PROMPT_REGISTRY);
  next[agentId] = next[agentId].map((entry) => (
    entry.version === version
      ? { ...entry, evalScores: { ...evalScores } }
      : entry
  ));
  updateRegistry(next);
}

export function resetPromptRegistry(): void {
  updateRegistry(buildDefaultRegistry());
}
