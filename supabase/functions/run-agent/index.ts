import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  streamClaudeText,
} from "../_shared/claudeClient.ts";
import { estimateCostUsd, resolveAgentTier } from "../_shared/modelCatalog.ts";
import { logger } from "../_shared/logger.ts";
import {
  splitExternalTexts,
  mergeExternalTexts,
  resolvePhaseInputsContainer,
  type ExternalText,
} from "../_shared/programTexts.ts";
import type {
  AgentHandoff,
  AgentObservationRecord,
  JsonValue,
  RunAgentRequest,
  RunAgentResponse,
  RunMode,
} from "../_shared/types.ts";

const VALID_RUN_MODES: ReadonlySet<RunMode> = new Set<RunMode>([
  "initial_generation",
  "input_change_refresh",
  "cascade_refresh",
  "gate_remediation",
  "manual_regeneration",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };
const ATOS_PHASE_SEQUENCE = [
  "strategy",
  "mobilise",
  "discover",
  "design",
  "build",
  "operate",
  "govern",
  "optimize",
  "valuerealize",
];
// ATOS Flow (methodology variant "atos-flow"): the evidence-to-system pipeline's
// movements. Disjoint ids from the stage-gate spine by design — cross-phase
// grounding picks whichever sequence contains the target phase.
const FLOW_MOVEMENT_SEQUENCE = [
  "frame",
  "listen",
  "envision",
  "show",
  "ship",
  "evolve",
];
const VALID_AGENT_IDS = new Set([
  ...ATOS_PHASE_SEQUENCE,
  ...FLOW_MOVEMENT_SEQUENCE,
  "agent_arch",
  "delivery",
  "adoption",
  "titan",
  "narrative",
  "risk",
  "milestone",
  "budget",
  "critical-path",
  "change-impact",
  "stakeholder",
  "health-heatmap",
  "retro",
  "deck",
  "scope-pcr",
  "escalation",
  "closure",
  "pattern-query",
  "artifact-reviewer",
  "exit-criteria-generator",
  "decision-advisor",
  "contradiction-detector",
  "cross-artifact-validator",
  "dependency-check",
  "benefits-tracker",
  "handoff-quality",
  "benchmark-comparator",
  "meeting-notes",
  "weekly-digest",
  "phase-completion-estimator",
  "setup-prefill",
  "discovery-guide-generator",
  "sprint-planner",
  "stakeholder-comms-drafter",
  "steerco-agenda-builder",
  "kpi-validator",
  "compliance-checker",
  "capacity-assessor",
  "lessons-synthesiser",
  "vendor-risk-assessor",
  "daily-briefing",
  "stakeholder-risk-assessor",
  "benefit-forecast",
  "meeting-notes-extractor",
  "deck-section",
  "narrative-refine",
  "board-pack",
  "phase-input-planner",
  // Formal-artifact agents (kept in lockstep with FORMAL_ARTIFACT_AGENTS below).
  "charter",
  "business-case",
  "outcome-framework",
  "strategic-roadmap",
  "governance-model",
  "raci-matrix",
  "requirements-catalog",
  "future-state-design",
  "target-operating-model",
  "solution-architecture",
  "test-plan",
  "runbook",
  "support-model",
  "optimization-backlog",
  // ATOS Flow movement generators (kept in lockstep with FORMAL_ARTIFACT_AGENTS).
  "discovery-kit",
  "current-state-atlas",
  "domain-ontology",
  "architecture-strategy",
  "agentic-blueprint",
  "prototype-pack",
  "demo-scripts",
  "hardening-plan",
  "eval-suite",
]);

// Presentation-only agent ids surfaced in the UI that map onto an implemented
// agent. Kept in lockstep with AppShellV3's resolveAgentId so both layers agree.
// (lite-gate-coach and co-pilot are intentionally absent: they are computed
// UI features, not invocable agents, and are never sent to this function.)
const AGENT_ID_ALIASES: Record<string, string> = {
  "executive-brief": "daily-briefing",
  "portfolio-intelligence": "health-heatmap",
  "steerco-prep": "steerco-agenda-builder",
};

// NOTE: the AGENT_DOWNSTREAM cascade map has been retired. Automatic agent
// fan-out multiplied LLM calls and caused state drift; the only automatic
// follow-on is now the lean plan+risk refresh in triggerDownstreamAgents.

type SupabaseClient = ReturnType<typeof createClient>;
type ProgramState = Record<string, JsonValue>;

interface AuthContext {
  admin: SupabaseClient;
  ownerId: string | null;
  isService: boolean;
}

interface ParsedAgentPayload {
  summary: string;
  reasoningTrace: string[];
  confidence: number;
  artifacts: Array<{
    id: string;
    title: string;
    content: string;
    summary?: string;
    /** 0-100 quality/confidence to surface in the artifact ledger. */
    confidence?: number;
  }>;
  decisions: Array<{
    title: string;
    question: string;
    priority?: string;
    options?: string[];
  }>;
  handoff: (AgentHandoff & { toPhaseId?: string }) | null;
}

interface PauseMarkerResult {
  hasPause: boolean;
  reason?: string;
  question?: string;
  options?: string[];
  contentBeforePause?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function getAdminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment is not configured.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authenticateRequest(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { admin, ownerId: null, isService: true };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return { admin, ownerId: data.user.id, isService: false };
}

type ProgramAccess = "none" | "viewer" | "editor" | "admin";

// Resolve the caller's access level to a program using the membership model.
// The service role always has full access. The program owner is always an admin
// even if a membership row is missing. Otherwise the role comes from
// adam_program_members. Reads use the service-role admin client (RLS-bypassing),
// so we must enforce access explicitly here.
async function resolveProgramAccess(
  auth: AuthContext,
  programOwnerId: string | null,
  programId: string,
): Promise<ProgramAccess> {
  if (auth.isService) return "admin";
  if (!auth.ownerId) return "none";
  if (programOwnerId && programOwnerId === auth.ownerId) return "admin";
  const { data, error } = await auth.admin
    .from("adam_program_members")
    .select("role")
    .eq("program_id", programId)
    .eq("user_id", auth.ownerId)
    .maybeSingle();
  if (error || !data) return "none";
  const role = data.role as string;
  if (role === "admin") return "admin";
  if (role === "editor") return "editor";
  if (role === "viewer") return "viewer";
  return "none";
}

function canWrite(access: ProgramAccess): boolean {
  return access === "admin" || access === "editor";
}

async function logObservation(
  admin: SupabaseClient,
  observation: AgentObservationRecord,
): Promise<void> {
  const { error } = await admin
    .from("adam_agent_observations")
    .insert({
      run_id: observation.runId,
      program_id: observation.programId,
      agent_id: observation.agentId,
      phase_id: observation.phaseId,
      observation_type: observation.observationType,
      payload: observation.payload ?? null,
      tokens: observation.tokens ?? null,
      latency_ms: observation.latencyMs ?? null,
    });
  if (error) {
    logger.warn("agent_observation_log_failed", {
      runId: observation.runId,
      programId: observation.programId,
      agentId: observation.agentId,
      phaseId: observation.phaseId,
      errorMessage: error.message,
    });
  }
}

async function broadcastStatus(
  admin: SupabaseClient,
  payload: {
    runId: string;
    programId: string;
    agentId: string;
    phaseId: string;
    status: string;
    confidence?: number | null;
    latestObservationType?: string;
  },
): Promise<void> {
  try {
    await admin.channel(`program-${payload.programId}-agents`).send({
      type: "broadcast",
      event: "agent_status",
      payload: {
        runId: payload.runId,
        agentId: payload.agentId,
        phaseId: payload.phaseId,
        status: payload.status,
        confidence: payload.confidence ?? null,
        latestObservationType: payload.latestObservationType ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.warn("agent_status_broadcast_failed", {
      runId: payload.runId,
      programId: payload.programId,
      agentId: payload.agentId,
      phaseId: payload.phaseId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "{}";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPhaseName(phaseId: string): string {
  return phaseId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (isRecord(entry) && typeof entry.criterion === "string") return entry.criterion.trim();
      return "";
    })
    .filter(Boolean);
}

function normalizeProgramData(raw: JsonValue | null): ProgramState {
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? { ...(raw as ProgramState) } : {};
}

/**
 * Resolve the core-team roster rows from a phase's inputs. The roster is the
 * ai-derived dynamic grid (canonical id "coreTeamRoster"), persisted as a JSON
 * string of row objects. Prefers the canonical id; otherwise the first
 * grid-shaped value whose rows carry both a name and a role column. Returns []
 * when no roster has been filled — mirrors the client `findRosterGrid` resolver.
 */
function resolveRosterRows(phaseInputs: ProgramState): Array<Record<string, unknown>> {
  const parseGrid = (value: unknown): Array<Record<string, unknown>> => {
    const arr = typeof value === "string" ? safeJsonParse<unknown>(value, null) : value;
    return Array.isArray(arr) ? arr.filter(isRecord) : [];
  };
  const hasKey = (row: Record<string, unknown>, re: RegExp) => Object.keys(row).some((k) => re.test(k));
  const canonical = parseGrid(phaseInputs.coreTeamRoster);
  if (canonical.length) return canonical;
  for (const value of Object.values(phaseInputs)) {
    const rows = parseGrid(value);
    if (rows.length && rows.some((r) => hasKey(r, /name/i) && hasKey(r, /role|title|position/i))) {
      return rows;
    }
  }
  return [];
}

/**
 * Resolve milestone rows from a phase's inputs. Build milestones are captured as
 * an ai-derived grid (rows of { milestone, targetDate }) under a per-programme
 * field id, so we match by row shape — a milestone/deliverable/gate-named column
 * — rather than a fixed key. Returns [] when no milestone grid has been filled.
 */
function resolveMilestoneRows(phaseInputs: ProgramState): Array<Record<string, unknown>> {
  const parseGrid = (value: unknown): Array<Record<string, unknown>> => {
    const arr = typeof value === "string" ? safeJsonParse<unknown>(value, null) : value;
    return Array.isArray(arr) ? arr.filter(isRecord) : [];
  };
  const hasKey = (row: Record<string, unknown>, re: RegExp) => Object.keys(row).some((k) => re.test(k));
  for (const value of Object.values(phaseInputs)) {
    const rows = parseGrid(value);
    if (rows.length && rows.some((r) => hasKey(r, /milestone|deliverable|gate/i))) {
      return rows;
    }
  }
  return [];
}

// A contradiction whose statement RESTATES a filled Frame field is agreement
// wearing the wrong label — the watcher sometimes files the newest answer
// against the very field it satisfies. Deterministic: never file those.
function contradictionFalsifiedByRecord(programData: ProgramState, statement: string): boolean {
  const inner = getInnerProgramData(programData);
  const phaseInputs = isRecord(inner.phaseInputs) ? inner.phaseInputs as Record<string, unknown> : {};
  const frame = isRecord(phaseInputs.frame) ? phaseInputs.frame as Record<string, unknown> : {};
  const tokens = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const stmt = tokens(statement);
  if (stmt.size < 4) return false;
  for (const [key, value] of Object.entries(frame)) {
    // Short structured facts only — transcript captures contain everything
    // anyone said and would suppress genuine disputes quoted from them.
    if (key.startsWith("_") || typeof value !== "string" || value.trim().length < 12 || value.length > 500) continue;
    const field = tokens(value);
    let shared = 0;
    for (const t of stmt) if (field.has(t)) shared += 1;
    if (shared / stmt.size >= 0.8) return true;
  }
  return false;
}

function getInnerProgramData(programData: ProgramState): ProgramState {
  const nested = normalizeProgramData(programData.data as JsonValue | null);
  return Object.keys(nested).length ? nested : programData;
}

function updateInnerProgramData(
  programData: ProgramState,
  updater: (inner: ProgramState) => ProgramState,
): ProgramState {
  const nested = normalizeProgramData(programData.data as JsonValue | null);
  if (Object.keys(nested).length) {
    return {
      ...programData,
      data: updater(nested) as JsonValue,
    };
  }
  return updater(programData);
}

function coerceNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function extractAgentJson(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  return safeJsonParse<unknown>(match ? match[0] : raw, {});
}

/**
 * True when the model returned a non-empty JSON object. A response that yields no
 * parseable object (empty {}, prose only, truncated stream) would otherwise let an
 * agent "complete" with zero artifacts — a silent no-op indistinguishable from
 * success. Callers use this to trigger a stricter retry, then fail loudly.
 */
function hasUsableAgentJson(raw: string): boolean {
  const parsed = extractAgentJson(raw);
  return isRecord(parsed) && Object.keys(parsed).length > 0;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string"
      ? Number(value)
      : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function truncateText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function uniqueStrings(value: unknown, maxItems = 10): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((entry) => typeof entry === "string" ? entry.trim() : "")
      .filter(Boolean),
  )).slice(0, maxItems);
}

function isProgramLevelAdoptionAgent(agentId: string, phaseId: string): boolean {
  return agentId === "adoption" && phaseId === "program";
}

function isSpecialProgramAgent(agentId: string, phaseId: string): boolean {
  return agentId === "narrative"
    || agentId === "risk"
    || agentId === "milestone"
    || agentId === "budget"
    || agentId === "critical-path"
    || agentId === "change-impact"
    || agentId === "stakeholder"
    || agentId === "health-heatmap"
    || agentId === "retro"
    || agentId === "deck"
    || agentId === "scope-pcr"
    || agentId === "escalation"
    || agentId === "closure"
    || agentId === "artifact-reviewer"
    || agentId === "exit-criteria-generator"
    || agentId === "decision-advisor"
    || agentId === "contradiction-detector"
    || agentId === "cross-artifact-validator"
    || agentId === "dependency-check"
    || agentId === "benefits-tracker"
    || agentId === "handoff-quality"
    || agentId === "benchmark-comparator"
    || agentId === "meeting-notes"
    || agentId === "weekly-digest"
    || agentId === "daily-briefing"
    || agentId === "phase-completion-estimator"
    || agentId === "setup-prefill"
    || agentId === "discovery-guide-generator"
    || agentId === "sprint-planner"
    || agentId === "stakeholder-comms-drafter"
    || agentId === "steerco-agenda-builder"
    || agentId === "kpi-validator"
    || agentId === "compliance-checker"
    || agentId === "capacity-assessor"
    || agentId === "lessons-synthesiser"
    || agentId === "vendor-risk-assessor"
    || agentId === "stakeholder-risk-assessor"
    || agentId === "benefit-forecast"
    || agentId === "meeting-notes-extractor"
    || agentId === "deck-section"
    || agentId === "narrative-refine"
    || agentId === "board-pack"
    || agentId === "phase-input-planner"
    || FORMAL_ARTIFACT_AGENTS[agentId] !== undefined
    || isProgramLevelAdoptionAgent(agentId, phaseId);
}

function getProgramPhaseContext(programData: ProgramState): Array<Record<string, unknown>> {
  const inner = getInnerProgramData(programData);
  const explicitPhases = Array.isArray(inner.phases) ? inner.phases : [];
  const phaseGuidance = normalizeProgramData(inner.phaseGuidance as JsonValue | null);
  let base: Array<Record<string, unknown>>;
  if (explicitPhases.length) {
    base = explicitPhases.map((entry, index) => {
      const record = isRecord(entry) ? entry : {};
      const id = typeof record.id === "string" ? record.id : ATOS_PHASE_SEQUENCE[index] || `phase-${index + 1}`;
      const guidance = normalizeProgramData(phaseGuidance[id] as JsonValue | null);
      return {
        id,
        name: typeof record.name === "string"
          ? record.name
          : typeof record.displayName === "string"
            ? record.displayName
            : typeof record.label === "string"
              ? record.label
              : formatPhaseName(id),
        pct: coerceNumber(record.pct, 0),
        objective: typeof record.objective === "string" ? record.objective : "",
        status: typeof record.status === "string" ? record.status : "",
        exitCriteria: extractStringList(record.exitCriteria ?? guidance.exitCriteria),
        lastUpdatedAt: typeof record.lastUpdatedAt === "string"
          ? record.lastUpdatedAt
          : typeof record.updatedAt === "string"
            ? record.updatedAt
            : typeof guidance.lastUpdatedAt === "string"
              ? guidance.lastUpdatedAt
              : "",
      };
    });
  } else {
    const phaseIds = Array.from(new Set([...ATOS_PHASE_SEQUENCE, ...Object.keys(phaseGuidance)]));
    base = phaseIds.map((phaseId) => {
      const guidance = normalizeProgramData(phaseGuidance[phaseId] as JsonValue | null);
      return {
        id: phaseId,
        name: typeof guidance.name === "string" ? guidance.name : formatPhaseName(phaseId),
        pct: coerceNumber(guidance.readiness, 0),
        objective: typeof guidance.objective === "string" ? guidance.objective : "",
        status: typeof guidance.status === "string" ? guidance.status : "",
        exitCriteria: extractStringList(guidance.exitCriteria),
        lastUpdatedAt: typeof guidance.lastUpdatedAt === "string" ? guidance.lastUpdatedAt : "",
      };
    });
  }

  // Phase status (complete/active/inactive) is not always persisted — in degraded
  // data inner.phases is empty and phaseGuidance carries no status, so every phase
  // arrives blank. Derive it from gate approvals exactly as the client does
  // (deriveActivePhaseId + reconcilePhaseStatusWithGates in programData.ts): an
  // approved gate ⇒ complete; the frontier (first phase whose gate is not approved)
  // ⇒ active; the remaining blank phases ⇒ inactive. Without this the briefing/
  // health context reads a fully-gated programme as "stalled at inception".
  const gateReviews = normalizeProgramData(inner.gateReviews as JsonValue | null);
  const isApproved = (id: string) =>
    normalizeProgramData(gateReviews[id] as JsonValue | null).status === "approved";
  const frontier = base.find((p) => !isApproved(String(p.id)));
  const activePhaseId = frontier ? String(frontier.id) : (base.length ? String(base[base.length - 1].id) : "");
  return base.map((p) => {
    const id = String(p.id);
    let status = typeof p.status === "string" ? p.status : "";
    let pct = coerceNumber(p.pct, 0);
    if (isApproved(id)) {
      status = "complete";
      if (pct <= 0) pct = 100; // an approved gate means the phase cleared its bar
    } else if (id === activePhaseId && (status === "" || status === "inactive")) {
      status = "active";
    } else if (status === "") {
      status = "inactive";
    }
    return { ...p, status, pct };
  });
}

function getProgramArtifactContext(programData: ProgramState): Array<Record<string, unknown>> {
  const inner = getInnerProgramData(programData);

  // Preferred source: flattened top-level `artifacts` array. This is the
  // canonical client-facing shape ({ id, phaseId, title, status, ... }) and the
  // only place that reliably carries the real approval status.
  const flat = Array.isArray(inner.artifacts) ? inner.artifacts : [];
  if (flat.length) {
    return flat.filter(isRecord).map((artifact) => ({
      id: typeof artifact.id === "string" ? artifact.id : "",
      phaseId: typeof artifact.phaseId === "string" ? artifact.phaseId : "",
      title: typeof artifact.title === "string" ? artifact.title : (typeof artifact.id === "string" ? artifact.id : ""),
      status: typeof artifact.status === "string" ? artifact.status : "draft",
    }));
  }

  // Fallbacks: nested phaseArtifacts may live under rawData (canonical nested
  // store) or at the inner top level (legacy). Both are keyed phaseId -> artifactId.
  const rawData = normalizeProgramData(inner.rawData as JsonValue | null);
  const nested = normalizeProgramData(
    (Object.keys(normalizeProgramData(rawData.phaseArtifacts as JsonValue | null)).length
      ? rawData.phaseArtifacts
      : inner.phaseArtifacts) as JsonValue | null,
  );
  const artifacts: Array<Record<string, unknown>> = [];

  Object.entries(nested).forEach(([phaseId, bucket]) => {
    const artifactBucket = normalizeProgramData(bucket as JsonValue | null);
    Object.entries(artifactBucket).forEach(([artifactId, artifactValue]) => {
      const artifact = normalizeProgramData(artifactValue as JsonValue | null);
      artifacts.push({
        id: artifactId,
        phaseId,
        title: typeof artifact.title === "string" ? artifact.title : artifactId,
        status: typeof artifact.status === "string" ? artifact.status : "draft",
      });
    });
  });

  return artifacts;
}

function getProgramRiskContext(programData: ProgramState): Array<Record<string, unknown>> {
  const inner = getInnerProgramData(programData);
  if (Array.isArray(inner.risks)) {
    return inner.risks.filter(isRecord).slice(0, 10);
  }
  const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
  const raidEntries = Array.isArray(raidLog.entries) ? raidLog.entries : [];
  if (raidEntries.length) {
    return raidEntries
      .filter(isRecord)
      .filter((entry) => entry.status !== "closed")
      .slice(0, 10);
  }
  const raidRisks = Array.isArray(raidLog.risks) ? raidLog.risks : [];
  return raidRisks.filter(isRecord).slice(0, 10);
}

/**
 * Lean, edge-side reconstruction of the ontology's objective knowledge graph
 * (the frontend `buildObjectiveGraph` in src/v3/ontology/objectiveGraph.ts, which
 * the Deno edge cannot import). It re-expresses the programme in the ontology's
 * delivery-chain vocabulary so the semantic validator can reason over the SAME
 * structure the Ontology view rolls up:
 *   objective --measured-by--> KPI      (weak when a baseline or target is missing)
 *   objective --delivered-by--> artifact (ordered along the phase sequence)
 *   objective --threatened-by--> risk    (open, severe risks only)
 * Surfacing this chain lets the model flag BROKEN links (an unmeasurable KPI, a
 * downstream phase that delivered nothing, a benefit traced to no artifact) — the
 * exact gaps the ontology's confidence roll-up penalises — rather than re-deriving
 * the structure from scattered context.
 */
function buildObjectiveKnowledgeGraph(programData: ProgramState): Record<string, unknown> {
  const inner = getInnerProgramData(programData);
  const projectMeta = normalizeProgramData(inner.projectMeta as JsonValue | null);
  const strategyInputs = normalizeProgramData(
    normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null,
  );
  const objective =
    typeof strategyInputs.businessObjective === "string" && strategyInputs.businessObjective.trim()
      ? strategyInputs.businessObjective.trim()
      : typeof inner.objective === "string" && inner.objective.trim()
        ? inner.objective.trim()
        : typeof inner.programObjective === "string" && inner.programObjective.trim()
          ? inner.programObjective.trim()
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "";

  // measured-by: KPIs from the Strategy inputs. A KPI missing a baseline OR a
  // target is a WEAK measure — the ontology's measured-by gap.
  const measuredBy = parseKpiBaselines(strategyInputs.kpis).map((k) => {
    const name = typeof k.name === "string" && k.name
      ? k.name
      : typeof k.metric === "string" && k.metric
        ? k.metric
        : "KPI";
    const baseline = typeof k.baseline === "string" ? k.baseline : k.baseline != null ? String(k.baseline) : "";
    const target = typeof k.target === "string" ? k.target : k.target != null ? String(k.target) : "";
    return {
      relation: "measured-by",
      name,
      baseline: baseline.trim() || null,
      target: target.trim() || null,
      weak: !baseline.trim() || !target.trim(),
    };
  });

  // delivered-by: artifacts along the programme's phase-ordered delivery chain, so
  // the model can see which downstream phases have (or have not) produced the
  // deliverables that progressively realise the objective.
  const phaseOrder = getProgramPhaseContext(programData).map((p) => (typeof p.id === "string" ? p.id : ""));
  const deliveredBy = [...getProgramArtifactContext(programData)]
    .sort((a, b) => {
      const ai = phaseOrder.indexOf(typeof a.phaseId === "string" ? a.phaseId : "");
      const bi = phaseOrder.indexOf(typeof b.phaseId === "string" ? b.phaseId : "");
      return (ai < 0 ? phaseOrder.length : ai) - (bi < 0 ? phaseOrder.length : bi);
    })
    .map((a) => ({
      relation: "delivered-by",
      phaseId: typeof a.phaseId === "string" ? a.phaseId : "",
      artifact: typeof a.title === "string" && a.title ? a.title : typeof a.id === "string" ? a.id : "",
      status: typeof a.status === "string" ? a.status : "draft",
    }));

  // threatened-by: open, severe (critical/high) risks threaten objective attainment.
  const threatenedBy = getProgramRiskContext(programData)
    .filter((r) => {
      const sev = (typeof r.severity === "string" ? r.severity : typeof r.impact === "string" ? r.impact : "").toLowerCase();
      return sev === "critical" || sev === "high";
    })
    .map((r) => ({
      relation: "threatened-by",
      risk: typeof r.title === "string" && r.title
        ? r.title
        : typeof r.description === "string" && r.description
          ? r.description
          : "Risk",
      severity: typeof r.severity === "string" ? r.severity : typeof r.impact === "string" ? r.impact : "",
    }));

  return { objective, measuredBy, deliveredBy, threatenedBy };
}

async function queryPatternContext(
  admin: SupabaseClient,
  params: {
    industry?: string | null;
    phaseId?: string | null;
    limit?: number;
  },
): Promise<Array<Record<string, unknown>>> {
  let query = admin
    .from("adam_pattern_library")
    .select("*")
    .order("used_count", { ascending: false })
    .limit(params.limit || 5);

  if (params.industry) {
    query = query.eq("industry", params.industry);
  }
  if (params.phaseId) {
    query = query.eq("phase_id", params.phaseId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("Pattern query failed:", error.message);
    return [];
  }

  return (data || []).filter(isRecord).map((entry) => ({
    id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
    patternType: typeof entry.pattern_type === "string" ? entry.pattern_type : "intervention",
    phaseId: typeof entry.phase_id === "string" ? entry.phase_id : null,
    industry: typeof entry.industry === "string" ? entry.industry : null,
    title: typeof entry.pattern_title === "string" ? entry.pattern_title : "Pattern",
    body: isRecord(entry.pattern_body) ? entry.pattern_body : {},
    outcome: typeof entry.outcome === "string" ? entry.outcome : null,
    confidence: typeof entry.confidence === "number" ? entry.confidence : 0.5,
    usedCount: typeof entry.used_count === "number" ? entry.used_count : 0,
  }));
}

/**
 * Formal-artifact agents: deterministic generators for the methodology's
 * document-style required artifacts (charter, business case, governance model,
 * requirements, designs, test plan, runbooks, etc.). Each entry is data —
 * the context builder, prompt builder and dispatch chain all read this registry
 * generically, so adding a new formal artifact is a single registry entry plus
 * its methodology slot + agentMeta label on the client.
 *
 * `phase`    — the phase whose required-artifact slot this satisfies.
 * `fieldKey` — top-level program-data mirror key (must not collide with a
 *              read-only value record such as `businessCase`).
 * `title`    — ledger title; MUST match the agent's outputArtifact in agentMeta
 *              so the client artifact model fuzzy-matches it to the slot.
 * `system`   — the full system prompt (returns one JSON document).
 */
interface FormalArtifactSpec {
  phase: string;
  fieldKey: string;
  title: string;
  system: string;
}

// Output-token right-sizing (T2). The default budget is generous (4096) so any
// long-form or unknown agent can never be truncated — truncation would only
// trigger a costly parse-failure retry, defeating the purpose. We tighten the
// budget ONLY for agents whose output is bounded structured JSON (scores,
// validations, checks, short estimates). These reliably finish well under 2048
// tokens, so the lower ceiling trims worst-case latency/cost with zero
// truncation risk. New agents inherit the safe 4096 default automatically.
const COMPACT_OUTPUT_AGENTS = new Set<string>([
  "contradiction-detector", "cross-artifact-validator",
  "health-heatmap", "change-impact", "benchmark-comparator",
  "stakeholder-risk-assessor", "benefit-forecast", "decision-advisor",
  "kpi-validator", "compliance-checker", "dependency-check", "handoff-quality",
  "capacity-assessor", "vendor-risk-assessor", "phase-completion-estimator",
  "artifact-reviewer", "scope-pcr", "critical-path",
  "exit-criteria-generator", "phase-input-planner",
]);
const COMPACT_OUTPUT_TOKENS = 2048;
const DEFAULT_OUTPUT_TOKENS = 4096;
// Roster-scaled long-form documents (a 12-interview discovery kit, per-track
// demo scripts) legitimately exceed the 4096 default once a programme's
// roster grows. A truncated stream costs MORE than the tokens it saves: the
// run fails, the repair pass fails on the same ceiling, and the operator
// retries the whole thing. Diagnosed live 2026-07-13: three consecutive
// discovery-kit runs died "no parseable output" with the JSON cut mid-object.
const LARGE_OUTPUT_AGENTS = new Set<string>(["discovery-kit", "demo-scripts"]);
const LARGE_OUTPUT_TOKENS = 16384;

/** Per-agent output-token budget — bounded JSON agents get a tighter ceiling,
 * roster-scaled documents a taller one. */
function resolveOutputTokenBudget(agentId: string): number {
  if (LARGE_OUTPUT_AGENTS.has(agentId)) return LARGE_OUTPUT_TOKENS;
  return COMPACT_OUTPUT_AGENTS.has(agentId) ? COMPACT_OUTPUT_TOKENS : DEFAULT_OUTPUT_TOKENS;
}

const FORMAL_ARTIFACT_AGENTS: Record<string, FormalArtifactSpec> = {
  "charter": {
    phase: "strategy",
    fieldKey: "transformationCharter",
    title: "Transformation Charter",
    system: `You are the ATOS Transformation Charter Agent. Produce the foundational programme mandate that authorises the transformation and sets its boundaries.

Use the provided Strategy inputs (sponsor, business objective, success metric, scope, constraints, kpiBaselines). Do NOT invent a sponsor, budget, or scope that is not supported by the context. Where a Strategy-owned input the charter itself needs is genuinely missing (e.g. no quantified budget, no sponsor), say so in "gaps" — but observe the phase-scoped gap discipline below: never list later-phase detail, content already present here or upstream, or approval/baseline state as a gap.

THE RECORD OUTRANKS THE FIELDS. If a fact the charter needs (objective, sponsor, measure, timeline) is clearly stated ANYWHERE in the captured record — including conversation transcripts — DERIVE it from there and use it; do not declare a gap asking for a field to be filled in when the answer is already on the record. When the newest statements in the record contradict an older structured input (e.g. the sponsor has since changed direction), the newer recorded statement wins: charter from it, and note the supersession in "mandate" or "keyRisks" rather than as a gap. A gap is ONLY for facts the record nowhere states.

NEVER emit a gap about the Objective/businessObjective input when the businessObjective you were given (or the one you derived) is non-empty — if you used an objective to write this charter, the objective is not a gap. The same rule applies to sponsor, success metric, and timeline: a fact you used is never simultaneously a gap.

Return ONLY valid JSON:
{
  "title": "Transformation Charter — <programme name>",
  "mandate": "2-3 sentence statement of why this programme exists and what authority it holds",
  "sponsor": "named executive sponsor or 'NOT SPECIFIED'",
  "businessObjective": "the primary objective in one sentence",
  "objectives": ["specific, outcome-oriented objectives"],
  "inScope": ["what the programme will deliver"],
  "outOfScope": ["explicit exclusions"],
  "successCriteria": ["measurable criteria, anchored to the KPIs where present"],
  "keyRisks": ["top strategic risks to the mandate"],
  "governanceSummary": "one sentence on how decisions and escalations will be governed",
  "gaps": ["inputs that are missing or too weak to charter confidently"],
  "summary": "one sentence verdict on charter readiness",
  "confidence": 0.0
}`,
  },
  "business-case": {
    phase: "strategy",
    fieldKey: "businessCaseDoc",
    title: "Business Case",
    system: `You are the ATOS Business Case Agent. Build the investment justification linking cost, benefit, and the value hypothesis.

Anchor benefits to the captured kpiBaselines (baseline → target) where present, and use valueProjected and constraints/budget for the investment side. Do NOT fabricate financial figures — when a number is unknown, mark it "TBD" and list it under "assumptions".

Return ONLY valid JSON:
{
  "valueHypothesis": "the core 'we believe that...' statement",
  "investmentAsk": "total investment required or 'TBD'",
  "expectedBenefits": [ { "benefit": "string", "kpi": "linked KPI name or null", "baseline": "string or null", "target": "string or null", "value": "quantified value or 'TBD'" } ],
  "costs": [ { "category": "string", "estimate": "string or 'TBD'" } ],
  "roiNarrative": "2-3 sentence ROI / payback rationale",
  "assumptions": ["key assumptions and unknowns"],
  "recommendation": "proceed | proceed-with-conditions | revisit",
  "summary": "one sentence verdict on the business case strength",
  "confidence": 0.0
}`,
  },
  "outcome-framework": {
    phase: "strategy",
    fieldKey: "outcomeFramework",
    title: "Outcome Framework",
    system: `You are the ATOS Outcome Framework Agent. Structure the programme's outcomes into a measurable hierarchy that makes benefits traceable from strategy to KPI.

Build directly on the captured kpiBaselines (name/baseline/target/unit). For each strategic outcome, link the measurable KPIs that evidence it and the leading indicators that predict it. Do NOT invent KPIs when kpiBaselines is non-empty — carry those through and only add leading indicators.

Return ONLY valid JSON:
{
  "strategicOutcomes": [
    {
      "outcome": "the outcome statement",
      "kpis": [ { "name": "KPI name", "baseline": "string or null", "target": "string or null", "unit": "string or null" } ],
      "leadingIndicators": ["early signals that predict this outcome"],
      "owner": "accountable role or null"
    }
  ],
  "benefitMap": "one sentence describing how outputs lead to outcomes to value",
  "gaps": ["outcomes without a measurable KPI, or KPIs without a baseline"],
  "summary": "one sentence verdict on outcome measurability",
  "confidence": 0.0
}`,
  },
  "strategic-roadmap": {
    phase: "strategy",
    fieldKey: "strategicRoadmap",
    title: "Strategic Roadmap",
    system: `You are the ATOS Strategic Roadmap Agent. Produce a phase-level roadmap sequencing the transformation from now to value realisation.

Ground the roadmap in ALL of the programme's strategy inputs provided in the context — the business objective, primary success metric, key constraints, cost assumption, industry, sponsor, and the validation approach (see "groundingFacts" plus the explicit fields) — so the sequencing reflects this programme's actual mandate, not a generic template. Bound the overall timeline by the programme start date and target end date, distributing the phases and milestones across that window. Anchor intermediate dates to existing phase ETAs/milestones where available; do NOT fabricate dates; mark unknown dates "TBD". Let the constraints and success metric shape phase ordering and the critical decisions/gaps you surface.

When a validation approach is provided, sequence the roadmap to PROVE outcomes in the order it implies: place the pilots, proof-of-concepts, experiments, or de-risking checkpoints it describes as keyMilestones and gates at the points where each assumption must be validated before the programme commits further. The critical path and decision gates should reflect this de-risking ladder, not just calendar order. If no validation approach is provided, do not invent one.

You also own the DELIVERY PLAN folded into this roadmap: the near-term actions, tracked milestones, critical path, and active blockers that turn the sequencing into work. Derive these from the phase sequencing, exit criteria, and current readiness — do not invent dates or owners. Owners are assigned later via the Mobilise RACI, so leave "owner" null unless a role is unambiguously implied by the inputs; never name individuals. For drill-down, set relatedArtifactId / relatedInputIds only to ids present in the context, else null / [].

The nextThreeActions and blockerSummary must reflect the programme's ACTUAL grounded state — never raise an action or blocker for something the inputs already provide or that this methodology does not use:
- Artifact OWNERSHIP and due dates are assigned during the Mobilise phase via the RACI. While Mobilise has not started, artifacts legitimately have no owners — do NOT raise "assign owner / assign due date" as an action or a blocker; it is expected, not a gap.
- This methodology does NOT use "phase exit criteria" / "exit gates". Never raise an action or blocker to "define / establish / approve exit criteria".
- The business objective, success metric / KPIs (health indicators) and the start/target-end timeline are supplied in the inputs. If they are present, do NOT raise actions or blockers to "define / document / establish" them. (Formally approving them at a gate is fine; (re)defining already-supplied content is not.)

Return ONLY valid JSON:
{
  "horizon": "one sentence describing the overall timeframe",
  "phases": [ { "phase": "phase id/name", "objective": "what this phase achieves", "start": "date or 'TBD'", "end": "date or 'TBD'", "keyMilestones": ["string"], "gate": "the decision gate that closes this phase" } ],
  "dependencies": [ { "from": "phase", "to": "phase", "reason": "why" } ],
  "criticalDecisions": ["decisions that gate progress along the roadmap"],
  "gaps": ["sequencing or date gaps that need resolving"],
  "deliveryPlan": {
    "summary": "one sentence on the delivery approach",
    "criticalPath": ["phase id in the sequence that must complete for value to land"],
    "nextThreeActions": [ { "action": "the immediate step", "phase": "phase id", "owner": "role or null", "rationale": "why now", "relatedArtifactId": "artifact id or null", "relatedInputIds": ["input field id"] } ],
    "milestones": [ { "id": "stable id", "title": "milestone", "phase": "phase id", "dueDate": "ISO date or null", "status": "on-track|at-risk|delayed|complete", "owner": "role or null" } ],
    "blockerSummary": [ { "blocker": "what is blocked", "phase": "phase id", "severity": "critical|high|medium|low", "resolution": "how to unblock", "relatedArtifactId": "artifact id or null", "relatedInputIds": ["input field id"] } ]
  },
  "summary": "one sentence verdict on roadmap coherence",
  "confidence": 0.0
}`,
  },
  "governance-model": {
    phase: "mobilise",
    fieldKey: "governanceModel",
    title: "Governance Model",
    system: `You are the ATOS Governance Model Agent. Propose DISTINCT governance model OPTIONS for this programme and let the user choose — do not impose a single model.

Use stakeholders, decisions, programType, scale and the programme objective to tailor every option to THIS programme. Do NOT invent named individuals not present in context — use roles where names are unknown. Do NOT return a generic menu: each option must reference the actual programme.

Propose 2-3 genuinely different options spanning the trade-off space (e.g. a lean/fast-decision model, a balanced model, and a heavyweight/high-assurance model) — only as many as are credible for this programme. Mark the one you recommend.

Return ONLY valid JSON:
{
  "options": [
    {
      "id": "kebab-case-stable-id",
      "name": "short option name (e.g. Lean Steering)",
      "summary": "one sentence on what this model optimises for and its trade-off",
      "bestFor": "the programme situation this model suits",
      "decisionBodies": [ { "name": "e.g. Steering Committee", "purpose": "string", "members": ["role or name"], "cadence": "e.g. monthly", "authority": "what it can decide" } ],
      "decisionRights": [ { "decisionType": "string", "owner": "role/body", "threshold": "e.g. >£50k to SteerCo" } ],
      "escalationPath": ["tier 1 -> tier 2 -> tier 3 with triggers"],
      "reportingCadence": ["what is reported, to whom, how often"],
      "gaps": ["governance roles or bodies not yet defined for this option"]
    }
  ],
  "recommendedOptionId": "the id of the option you recommend",
  "selectionRationale": "one sentence on why the recommended option fits this programme best",
  "confidence": 0.0
}`,
  },
  "raci-matrix": {
    phase: "mobilise",
    fieldKey: "raciMatrix",
    title: "RACI Matrix",
    system: `You are the ATOS RACI Matrix Agent. Map programme activities to roles with Responsible / Accountable / Consulted / Informed assignments.

Use stakeholders and phase activities. Every activity MUST have exactly one Accountable. Use roles where named individuals are unknown.

Return ONLY valid JSON:
{
  "roles": ["the roles/people across the columns"],
  "activities": [ { "activity": "string", "responsible": ["role"], "accountable": "single role", "consulted": ["role"], "informed": ["role"] } ],
  "gaps": ["activities missing an accountable, or roles not yet staffed"],
  "summary": "one sentence verdict on accountability coverage",
  "confidence": 0.0
}`,
  },
  "requirements-catalog": {
    phase: "discover",
    fieldKey: "requirementsCatalog",
    title: "Requirements Catalog",
    system: `You are the ATOS Requirements Catalog Agent. Capture and structure the programme requirements with priority and traceability.

Use the discover-phase inputs, scope, and objective. Prioritise with MoSCoW. Each requirement links to the outcome/KPI it serves where possible. Do NOT fabricate requirements with no basis in context — list coverage gaps instead.

Return ONLY valid JSON:
{
  "requirements": [ { "id": "REQ-001", "title": "string", "type": "functional|non-functional", "priority": "must|should|could|wont", "description": "string", "source": "where it came from", "linkedOutcome": "outcome/KPI name or null", "acceptanceCriteria": ["testable criteria"] } ],
  "gaps": ["areas of scope without requirements yet"],
  "summary": "one sentence verdict on requirements completeness",
  "confidence": 0.0
}`,
  },
  "future-state-design": {
    phase: "design",
    fieldKey: "futureStateDesign",
    title: "Future State Design",
    system: `You are the ATOS Future State Design Agent. Describe the target future state: capabilities, processes, and the change from current state.

Use requirements, objective, and design-phase inputs. Ground each future-state change in a requirement or outcome where possible.

Return ONLY valid JSON:
{
  "designPrinciples": ["principles guiding the design"],
  "futureCapabilities": [ { "capability": "string", "description": "string", "changeFromToday": "what changes", "enabledOutcome": "outcome/KPI or null" } ],
  "processChanges": [ { "process": "string", "currentState": "string or 'unknown'", "futureState": "string" } ],
  "gaps": ["design areas not yet resolved"],
  "summary": "one sentence verdict on design completeness",
  "confidence": 0.0
}`,
  },
  "target-operating-model": {
    phase: "design",
    fieldKey: "targetOperatingModel",
    title: "Target Operating Model",
    system: `You are the ATOS Target Operating Model Agent. Define the TOM across people, process, technology, and governance dimensions.

Use future-state design, stakeholders, and objective. Be specific about how the organisation runs in the future state.

Return ONLY valid JSON:
{
  "people": { "structure": "string", "roles": ["key roles"], "capabilities": ["capabilities needed"] },
  "process": { "coreProcesses": ["string"], "operatingPrinciples": ["string"] },
  "technology": { "platforms": ["string"], "dataAndIntegration": "string" },
  "governance": { "decisionRights": "string", "performanceManagement": "string" },
  "transitionImpacts": ["what must change to reach the TOM"],
  "gaps": ["TOM dimensions not yet defined"],
  "summary": "one sentence verdict on TOM readiness",
  "confidence": 0.0
}`,
  },
  "solution-architecture": {
    phase: "design",
    fieldKey: "solutionArchitecture",
    title: "Solution Architecture",
    system: `You are the ATOS Solution Architecture Agent. Produce the solution architecture: components, integrations, data flows, NFRs, and key decisions.

Use requirements, future-state design, and constraints. Do NOT invent vendor products not implied by context — describe capabilities generically where unknown.

Return ONLY valid JSON:
{
  "components": [ { "name": "string", "responsibility": "string", "type": "e.g. service|datastore|ui" } ],
  "integrations": [ { "from": "component", "to": "component", "mechanism": "e.g. REST/event", "data": "what flows" } ],
  "nonFunctionalRequirements": [ { "category": "e.g. security|performance|availability", "requirement": "string" } ],
  "architectureDecisions": [ { "decision": "string", "rationale": "string", "alternatives": ["string"] } ],
  "gaps": ["architecture areas not yet resolved"],
  "summary": "one sentence verdict on architecture completeness",
  "confidence": 0.0
}`,
  },
  "test-plan": {
    phase: "build",
    fieldKey: "testPlan",
    title: "Test Plan",
    system: `You are the ATOS Test Plan Agent. Define the test strategy: scope, types, environments, entry/exit criteria, and representative test cases.

Use requirements and acceptance criteria. Each key requirement should map to at least one test case where possible.

Return ONLY valid JSON:
{
  "scope": "what is in and out of test scope",
  "testTypes": ["e.g. unit, integration, UAT, performance, security"],
  "environments": ["test environments needed"],
  "entryCriteria": ["criteria to begin testing"],
  "exitCriteria": ["criteria to declare testing complete"],
  "keyTestCases": [ { "id": "TC-001", "title": "string", "linkedRequirement": "REQ id or null", "steps": ["string"], "expected": "string" } ],
  "gaps": ["requirements without test coverage"],
  "summary": "one sentence verdict on test readiness",
  "confidence": 0.0
}`,
  },
  "runbook": {
    phase: "operate",
    fieldKey: "runbook",
    title: "Runbook",
    system: `You are the ATOS Runbook Agent. Produce the operational runbook for running the solution in live operation.

Use the solution/operating context. Cover routine operations, monitoring, and incident response. Be concrete and actionable.

Return ONLY valid JSON:
{
  "routineOperations": [ { "task": "string", "frequency": "string", "owner": "role", "procedure": "string" } ],
  "monitoring": [ { "signal": "what to watch", "threshold": "string", "action": "what to do" } ],
  "incidentResponse": [ { "scenario": "string", "severity": "critical|high|medium", "steps": ["string"], "escalateTo": "role" } ],
  "gaps": ["operational procedures not yet defined"],
  "summary": "one sentence verdict on operational readiness",
  "confidence": 0.0
}`,
  },
  "support-model": {
    phase: "operate",
    fieldKey: "supportModel",
    title: "Support Model",
    system: `You are the ATOS Support Model Agent. Define the post-go-live support model: tiers, SLAs, roles, escalation, and knowledge.

Use stakeholders and operating context. Be specific about who supports what and to what service level.

Return ONLY valid JSON:
{
  "supportTiers": [ { "tier": "e.g. L1/L2/L3", "scope": "string", "owner": "team/role", "hours": "e.g. 9-5 / 24x7" } ],
  "slas": [ { "priority": "P1|P2|P3", "responseTime": "string", "resolutionTarget": "string" } ],
  "escalation": ["escalation path with triggers"],
  "knowledgeBase": ["key knowledge assets needed for support"],
  "gaps": ["support areas not yet defined"],
  "summary": "one sentence verdict on support readiness",
  "confidence": 0.0
}`,
  },
  "optimization-backlog": {
    phase: "optimize",
    fieldKey: "optimizationBacklog",
    title: "Optimization Backlog",
    system: `You are the ATOS Optimization Backlog Agent. Produce a prioritised backlog of continuous-improvement opportunities against baseline metrics.

Use kpiBaselines, benefits tracking, risks, and operating signals. Prioritise by value vs effort. Ground each item in evidence where possible.

Return ONLY valid JSON:
{
  "items": [ { "id": "OPT-001", "title": "string", "opportunity": "string", "linkedKpi": "KPI name or null", "value": "high|medium|low", "effort": "high|medium|low", "priority": "now|next|later" } ],
  "themes": ["recurring improvement themes"],
  "gaps": ["areas where improvement data is missing"],
  "summary": "one sentence verdict on improvement pipeline",
  "confidence": 0.0
}`,
  },

  // ─── ATOS Flow movement generators ──────────────────────────────────────────
  // The evidence-to-system pipeline's transformers. Every one of these derives
  // its content from recorded conversations and demonstrated behaviour — the
  // documentCarryForward (uploaded transcripts) and groundingFacts are the
  // primary sources, and verbatim stakeholder quotes are first-class evidence.
  // Shared rule: never invent what no stakeholder said; record it as a gap or
  // an open question instead.
  "discovery-kit": {
    phase: "frame",
    fieldKey: "discoveryKit",
    title: "Discovery Kit",
    system: `You are the ATOS Discovery Kit Agent. From the sponsor conversation and the Frame facts, produce the discovery tour: who must be heard, and a role-aware 45-minute agenda for each of them.

Use the People list carried in groundingFacts as "knownStakeholder" lines (the programme's roster — seeded by the operator, extended from a Team Roster or org chart, and grown as evidence names new voices) plus any stakeholders named in the sponsor conversation (documentCarryForward). Every named person on that roster MUST get an interview entry. Do NOT invent named individuals — where a domain clearly needs a voice but no name is known, emit a role placeholder ("Head of Fulfilment — TBC") and list it under "gaps". Questions must be specific to this objective and industry, not generic discovery boilerplate; each agenda ends by asking what artifacts (screens, reports, exports) the stakeholder can share.

Stakeholders are the voices you interview; PERSONAS are every role that takes part in the workflow — internal (reps, approvers, ops) AND external (customers, partners, vendors). They are not the same list: interviewees may or may not be personas, and external personas usually cannot be interviewed at all. Inventory every persona the objective's workflow touches, and for each name which interviewees can SPEAK FOR it — themselves, their manager, or whoever faces them (support faces the customer). When the evidence NAMES who speaks for a persona (e.g. an answer like "use <name>" to a who-can-speak-for question), record that name in spokenForBy, set unrepresented to false, and add an interview entry for them if they are not already rostered — an answered question must NEVER be re-asked. Only a persona nobody is named or able to speak for is a discovery risk: mark it unrepresented and list it under "gaps".

Return ONLY valid JSON:
{
  "title": "Discovery Kit — <programme name>",
  "interviews": [ { "stakeholder": "name or 'Role — TBC'", "role": "string", "email": "their email address ONLY if it appears in the evidence, else null — NEVER invent an address; the operator fills it in", "domain": "the workflow domain they own", "durationMinutes": 45, "objectives": ["what this conversation must surface"], "agenda": [ { "minutes": 5, "topic": "string", "questions": ["specific questions"] } ], "askForArtifacts": ["systems/screens/reports to bring"] } ],
  "personas": [ { "name": "a ROLE in the workflow, not a person — e.g. 'Sales Rep', 'End Customer'", "kind": "internal|external", "partInWorkflow": "one sentence: what they do in the process", "spokenForBy": ["interview stakeholders who can speak for this persona"], "unrepresented": false } ],
  "coverageMap": [ { "domain": "string", "coveredBy": ["stakeholders"], "thin": false } ],
  "schedulingGuidance": "sequencing and cadence recommendation for the tour",
  "consentNote": "one-paragraph recording-consent blurb to read out before each conversation",
  "gaps": ["domains with no voice, facts the sponsor conversation did not surface"],
  "summary": "one sentence verdict on discovery-tour readiness",
  "confidence": 0.0
}`,
  },
  "current-state-atlas": {
    phase: "listen",
    fieldKey: "currentStateAtlas",
    title: "Current-State Atlas",
    system: `You are the ATOS Current-State Atlas Agent. Synthesise EVERY discovery transcript into the current-state picture: the workflows as they actually run, the pain heatmap, and the contradictions between stakeholders.

Ground every workflow step and pain point in what a stakeholder actually said — carry a verbatim quote with attribution wherever possible. Never invent a step or a hand-off; where the transcripts leave one unclear, record it under "openQuestions" instead. Where two stakeholders describe the same process differently, that is a finding — record it under "contradictions" with a suggested follow-up, never silently pick a side.

Actors are PERSONAS: name steps[].actor using the Discovery Kit's personas (priorPhaseArtifacts) — internal and external alike; the customer or partner appears as an actor wherever the process touches them ("End Customer submits the request"). Every persona in the kit must act in at least one workflow, traced END TO END: from the trigger where they first touch the process to the point they hand off or leave it. A persona whose steps the transcripts do not cover is a hole — record it under "openQuestions" ("What does the <persona> do between X and Y?"), never paper over it.

Return ONLY valid JSON:
{
  "title": "Current-State Atlas — <programme name>",
  "workflows": [ { "name": "string", "owner": "role", "trigger": "what starts it", "steps": [ { "actor": "role", "action": "string", "system": "system used or null", "duration": "stated duration or null", "evidence": "verbatim quote — speaker", "entities": ["domain entities this step touches — use the ontology's names"] } ], "handoffs": ["cross-team hand-offs"], "failureModes": ["where it goes wrong today"] } ],
  // Division of record: the Atlas owns ACTIVITIES and field findings. Reference domain entities by the Ontology's names in steps[].entities — never define or describe entities here; definitions, attributes and systems-of-record belong to the Domain Ontology. systemsInventory records usage and complaints, not which entities live where.
  "painHeatmap": [ { "area": "string", "pain": "string", "severity": "high|medium|low", "voicedBy": ["stakeholders"], "quote": "the strongest verbatim expression of it" } ],
  "systemsInventory": [ { "system": "string", "usedFor": "string", "complaints": ["stakeholder complaints about it"] } ],
  "contradictions": [ { "statement": "what is disputed", "between": ["stakeholder A", "stakeholder B"], "positions": ["A's version", "B's version"] } ],
  // contradictions are ROUTED to the programme's contradiction log for the sponsor to arbitrate — they are not stored in this document. Report only genuine factual disputes between people; terminology collisions belong to the Ontology's ambiguities.
  "openQuestions": ["hand-offs or steps the transcripts left unclear"],
  "coverage": [ { "stakeholder": "string", "heard": true } ],
  "gaps": ["stakeholders not yet heard, domains with thin evidence"],
  "summary": "one sentence verdict on current-state understanding",
  "confidence": 0.0
}`,
  },
  "domain-ontology": {
    phase: "listen",
    fieldKey: "domainOntology",
    title: "Domain Ontology",
    system: `You are the ATOS Domain Ontology Agent. Build the domain ontology from the discovery conversations: the entities the business actually reasons about, their relationships, the events that move them, and the systems of record.

Use the stakeholders' own nouns — the ontology's names should be their language, not generic data-modelling vocabulary. Every entity carries at least one evidence source. Where different teams use different words for the same thing (or the same word for different things), record it under "ambiguities" — those collisions are exactly what the Blueprint's data contracts must resolve.

Return ONLY valid JSON:
{
  "title": "Domain Ontology — <programme name>",
  "entities": [ { "name": "their noun", "definition": "one sentence in their language", "attributes": ["key attributes mentioned"], "systemOfRecord": "system or null", "aliases": ["what other teams call it"], "evidence": "verbatim quote — speaker" } ],
  "relations": [ { "from": "entity", "relation": "verb phrase", "to": "entity", "cardinality": "1:1|1:N|N:M|unknown" } ],
  "events": [ { "name": "business event", "triggers": "what causes it", "produces": "what it changes" } ],
  // Division of record: the Ontology owns NOUNS and state changes. Events are facts that occur (QuoteAmended), never sequences — actors, step order, durations and systems-in-use belong to the Current-State Atlas's workflows. Ambiguities are terminology collisions (same word, different meanings); factual disputes between people are contradictions and belong to the programme's contradiction log, not here.
  "standardAlignment": [ { "entity": "ontology entity name", "standard": "full URI, e.g. https://schema.org/Order", "vocabulary": "schema.org|FIBO|GS1|FHIR", "relation": "skos:closeMatch|skos:exactMatch", "confidence": 0.0 } ],
  // Propose mappings ONLY from the vocabularies named in the input context's vocabularySteering — it is derived deterministically from the programme's industry; any other namespace is rejected before review. Only propose mappings you are confident in; omit rather than force.
  "ambiguities": [ { "term": "string", "conflictingMeanings": ["meaning per team"], "resolution": "proposed resolution or 'unresolved'" } ],
  "gaps": ["entities referenced but never defined, domains not yet mapped"],
  "summary": "one sentence verdict on ontology completeness",
  "confidence": 0.0
}`,
  },
  "architecture-strategy": {
    phase: "envision",
    fieldKey: "architectureStrategy",
    title: "Architecture Strategy",
    system: `You are the ATOS Architecture Strategy Agent. From the Current-State Atlas and the Domain Ontology (priorPhaseArtifacts), draft 2–3 genuinely distinct candidate target architectures for the agentic system, score their trade-offs against functional AND non-functional dimensions, and recommend one.

Candidates must differ in SHAPE — e.g. a single orchestrator with tools, a crew of specialist agents, agents embedded per-workflow — not merely in technology names. Anchor every candidate to the workflows and pains recorded in the Atlas. Honour the agenticFramework input: when it is "Undecided — recommend one", recommend a framework with rationale; otherwise design for the one chosen.

ROBUSTNESS RULES (enforced, not optional):
- Score EVERY candidate on the non-functional dimensions too (security, dataResidencyPII, scaleLatency, reliability), not just fit/speed/operability/cost. A blank NFR score is a gap, not a zero.
- Ground every score: cite the Atlas workflow, pain, KPI or a NAMED assumption behind it in scoresBasis, and lower the candidate/overall confidence for any score you are guessing.
- Constraints are VERIFIED, not hoped: fill constraintSatisfaction as a matrix of every hardConstraints entry × candidate (pass|partial|fail + how). The recommended candidate MUST pass every hard constraint — if none can, say so plainly in recommendation.hardConstraintsMet=false + unmetConstraints, and treat it as the headline gap.
- buildVsBuy must be honest about lock-in: every row carries an exitPath and switchingCost.
- Each candidate lists failureModes (mode · likelihood · impact · mitigation) — an architecture is only as good as how it fails.

Return ONLY valid JSON:
{
  "title": "Architecture Strategy — <programme name>",
  "candidates": [ { "name": "memorable name", "shape": "orchestrator|crew|embedded|other", "description": "2-3 sentences", "agenticPattern": "how agents divide the work", "integrationMap": [ { "system": "from the Atlas systems inventory", "direction": "read|write|both", "method": "API|export|RPA|event" } ], "buildVsBuy": [ { "capability": "string", "verdict": "build|buy|reuse", "rationale": "string", "exitPath": "how you'd migrate off it", "switchingCost": "low|medium|high" } ], "failureModes": [ { "mode": "what breaks", "likelihood": "low|medium|high", "impact": "low|medium|high", "mitigation": "how this candidate contains it" } ], "strengths": ["strings"], "risks": ["strings"], "scores": { "fitToWorkflows": 0, "timeToFirstDemo": 0, "operability": 0, "cost": 0, "security": 0, "dataResidencyPII": 0, "scaleLatency": 0, "reliability": 0 }, "scoresBasis": { "fitToWorkflows": "Atlas evidence or assumption + confidence", "security": "…", "scaleLatency": "…" } } ],
  "constraintSatisfaction": [ { "constraint": "a hardConstraints entry, verbatim", "byCandidate": [ { "candidate": "name", "verdict": "pass|partial|fail", "how": "why it passes/fails" } ] } ],
  "recommendation": { "candidate": "name", "rationale": "why this one", "tradedAway": "what choosing it gives up", "hardConstraintsMet": true, "unmetConstraints": [] },
  "frameworkRecommendation": "the chosen/confirmed agentic framework and why",
  "gaps": ["Atlas/ontology evidence too thin to architect confidently; any unmet hard constraint"],
  "summary": "one sentence verdict on the recommended direction",
  "confidence": 0.0
}`,
  },
  "agentic-blueprint": {
    phase: "envision",
    fieldKey: "agenticBlueprint",
    title: "Agentic Blueprint",
    system: `You are the ATOS Agentic Blueprint Agent. Compile the chosen architecture direction (directionDecision + the Architecture Strategy in priorPhaseArtifacts/existingArtifacts) into a buildable spec targeted at the chosen agenticFramework: agents, tools, orchestration, data contracts, human-in-the-loop points, guardrails and the eval plan.

Derive the data model from the Domain Ontology — name entities EXACTLY as the ontology does. Every agent must trace to a workflow in the Atlas; every HITL point to a risk or judgement call a stakeholder actually voiced. Sequence the build so the first slice is demoable to a named stakeholder.

ROBUSTNESS RULES (enforced, not optional):
- Autonomy has a safety envelope: every agent declares reversibility and blastRadius. HARD INVARIANT — any agent with autonomyLevel "act" acting on an irreversible / high-blast-radius workflow MUST have a matching hitlPoint; set requiresHitl=true and ensure hitlPoints covers it. List any violation in safetyInvariants.actWithoutHitl (aim: empty).
- Agents degrade gracefully: each carries guardrails — for each of {tool error, hallucination/low-confidence, rate-limit/timeout} a detection signal and a fallback. An agent with no guardrails is not production-ready.
- Data contracts cover the hard parts: every contract names owner, piiClass, consistency and conflictResolution — not just source/shape/sync. Customer/patient data without a PII class is a gap.
- Every track ships with runtime observability (logs/traces/alerts) and a rollout plan (canary + rollback) — the eval plan is offline; production needs both.
- Walking skeleton: the FIRST buildSequence slice must exercise the full path end-to-end (one ontology entity → one agent → one HITL → one eval). Describe that coverage in walkingSkeleton.

Return ONLY valid JSON:
{
  "title": "Agentic Blueprint — <programme name>",
  "targetFramework": "string",
  "agents": [ { "name": "string", "purpose": "one sentence", "replacesWorkflow": "Atlas workflow name", "tools": ["capabilities/integrations it calls"], "inputs": ["ontology entities consumed"], "outputs": ["ontology entities produced"], "autonomyLevel": "suggest|act-with-approval|act", "escalatesTo": "role", "reversibility": "reversible|partially|irreversible", "blastRadius": "low|medium|high", "requiresHitl": false, "guardrails": [ { "failureMode": "tool error|hallucination|low-confidence|rate-limit|timeout", "detection": "the signal", "fallback": "what happens instead" } ] } ],
  "journeys": [ { "name": "journey name", "persona": "customer|user", "stages": [ { "name": "stage", "customer": "what the customer does/experiences, or null", "user": "what staff do, or null", "agent": "what an agent does — name it from agents[], or null", "systems": "systems touched, or null" } ] } ],
  "orchestration": { "pattern": "string", "description": "how work flows between agents", "stateManagement": "where state lives" },
  "dataContracts": [ { "entity": "ontology entity", "source": "system of record", "shape": "brief field list", "sync": "live|batch|manual", "owner": "accountable role/team", "piiClass": "none|internal|pii|sensitive", "consistency": "eventual|strong", "conflictResolution": "how divergent writes are reconciled" } ],
  "hitlPoints": [ { "where": "step/decision", "why": "the stakeholder-voiced risk it answers", "mechanism": "approve|review|override" } ],
  "evalPlan": [ { "behaviour": "what must hold", "measure": "how it is measured", "threshold": "pass bar" } ],
  "buildSequence": ["ordered slices — the first must be the walking skeleton"],
  "walkingSkeleton": "the first slice's end-to-end path: which entity, agent, HITL and eval it exercises",
  "tracks": [ { "name": "build workstream over the shared data model", "goal": "one-sentence outcome it demonstrates", "slices": ["buildSequence slices that live in this track"], "leadStakeholder": "the REAL person who watches its demonstrations — a full name exactly as attributed in the transcripts or roster (e.g. \"Dan Reyes\"), NEVER an invented role title", "dependsOn": ["track names it waits on"], "observability": { "logs": "what is logged", "traces": "what is traced", "alerts": "what pages someone" }, "rollout": { "canary": "how it's rolled out safely", "rollback": "how it's backed out" } } ],
  "safetyInvariants": { "actWithoutHitl": ["agent names that act on irreversible/high-blast work with no HITL — should be empty"], "unmappedEntities": ["agent inputs/outputs not found in the ontology"] },
  "gaps": ["direction ambiguities, unmapped entities, unresolved framework questions, any safety invariant violation"],
  "summary": "one sentence verdict on blueprint buildability",
  "confidence": 0.0
}`,
  },
  "prototype-pack": {
    phase: "show",
    fieldKey: "prototypePack",
    title: "Prototype Build Pack",
    system: `You are the ATOS Prototype Build Pack Agent. Turn the Agentic Blueprint (priorPhaseArtifacts) into a build pack a coding agent or team can execute to a working prototype fast: scaffold, agent wiring, and seed data lifted from the discovery evidence.

Optimise for time-to-first-demo: the thinnest vertical slice that lets each stakeholder watch THEIR OWN workflow run. Seed scenarios must come from real transcript moments — their numbers, their step names, the delays they complained about — so the demo lands as recognition, not fiction. Stub what the slice does not need.

Return ONLY valid JSON:
{
  "title": "Prototype Build Pack — <programme name>",
  "scaffold": { "framework": "the Blueprint's target framework", "runtime": "language/platform", "structure": ["directories/modules"], "dependencies": ["key packages"] },
  "buildSlices": [ { "slice": "string", "demonstrates": "Atlas workflow", "forStakeholders": ["who watches this run"], "components": ["agents/tools/UI in the slice"], "estimate": "S|M|L" } ],
  "seedScenarios": [ { "stakeholder": "string", "scenario": "the concrete situation replayed", "sourceQuote": "the verbatim transcript moment it comes from", "data": "the seed values to load" } ],
  "stubbing": [ { "integration": "system", "approach": "mock|fixture|sandbox", "notes": "string" } ],
  "demoEnvironment": "how and where the prototype runs for the demo tour",
  "gaps": ["Blueprint detail too thin to scaffold, integrations with no stub path"],
  "summary": "one sentence verdict on prototype readiness",
  "confidence": 0.0
}`,
  },
  "demo-scripts": {
    phase: "show",
    fieldKey: "demoScripts",
    title: "Demo Scripts",
    system: `You are the ATOS Demo Scripts Agent. Write one walkthrough PER STAKEHOLDER, seeded from their own transcript: every person watches their own job running in the prototype.

Open each script with their own words — the pain they voiced — then the moment that pain disappears on screen. Use their scenario and their numbers ("you said the credit check takes three days; watch it take forty seconds"). End with the acceptance ask. Do NOT write generic feature tours; a script that could be shown to anyone is a failed script.

Return ONLY valid JSON:
{
  "title": "Demo Scripts — <programme name>",
  "scripts": [ { "stakeholder": "string", "role": "string", "duration": "10–15 min", "openingQuote": "their verbatim pain, attributed", "scenario": "the situation being replayed", "steps": [ { "beat": "what happens", "show": "what is on screen", "say": "the talk track", "callback": "their words being answered" } ], "watchFor": ["reactions worth recording"], "acceptanceAsk": "the closing question that records their verdict" } ],
  "tourSequence": ["recommended demo order and why"],
  "sharedOpening": "a 2-minute framing any demo can open with",
  "gaps": ["stakeholders with no transcript to seed from, workflows the prototype cannot yet show"],
  "summary": "one sentence verdict on demo-tour readiness",
  "confidence": 0.0
}`,
  },
  "hardening-plan": {
    phase: "ship",
    fieldKey: "hardeningPlan",
    title: "Hardening Plan",
    system: `You are the ATOS Hardening Plan Agent. Plan the prototype-to-production conversion: everything production requires beyond the accepted prototype.

Walk the Blueprint's surfaces systematically — authn/z, error handling, observability, rate limits, data protection, guardrails, and the HITL mechanisms at the Blueprint's marked points. Anchor priorities to the demo feedback (what stakeholders accepted with changes) and the hard constraints. Classify every item must/should; a hardening plan that marks everything "must" has not made decisions.

Return ONLY valid JSON:
{
  "title": "Hardening Plan — <programme name>",
  "workstreams": [ { "area": "authnz|errors|observability|guardrails|data|performance|hitl", "items": [ { "item": "string", "why": "string", "priority": "must|should", "effort": "S|M|L" } ] } ],
  "guardrails": [ { "risk": "what could go wrong in production", "guardrail": "the control", "mechanism": "how it is enforced" } ],
  "hitlImplementation": [ { "point": "Blueprint HITL point", "mechanism": "approve|review|override implementation", "owner": "role" } ],
  "cutoverPlan": { "approach": "big-bang|parallel-run|phased", "steps": ["ordered cutover steps"], "rollback": "how to back out" },
  "runbookSeeds": ["operational procedures the runbook must cover"],
  "gaps": ["surfaces the Blueprint left unspecified, constraints not yet answered"],
  "summary": "one sentence verdict on production readiness",
  "confidence": 0.0
}`,
  },
  "eval-suite": {
    phase: "ship",
    fieldKey: "evalSuite",
    title: "Eval Suite",
    system: `You are the ATOS Eval Suite Agent. Generate the evaluation suite that gates shipping — derived from the discovery transcripts and the demo acceptances, never from imagination.

Every eval case traces to evidence: a stakeholder-stated expectation, an accepted demo behaviour (the demoTour verdicts), or a Blueprint evalPlan entry. Include failure-mode probes for the failure modes the Atlas recorded, and guardrail probes for every guardrail the Hardening Plan declares. "Eval suite green" must be defined numerically — a suite whose pass bar is vibes cannot gate a cutover.

Return ONLY valid JSON:
{
  "title": "Eval Suite — <programme name>",
  "evalCases": [ { "id": "EV-1", "behaviour": "what must hold", "given": "setup/input", "expect": "expected outcome", "tracesTo": "verbatim quote | demo verdict | blueprint evalPlan entry", "kind": "capability|guardrail|regression|latency", "threshold": "pass bar" } ],
  "guardrailProbes": [ { "probe": "adversarial/degenerate input", "mustNot": "the behaviour that must never happen" } ],
  "runCadence": "when the suite runs — CI, pre-deploy, scheduled",
  "greenCriteria": "the numeric definition of green that clears the Ship movement",
  "gaps": ["expectations with no eval, demo objections not yet covered"],
  "summary": "one sentence verdict on shipping-gate coverage",
  "confidence": 0.0
}`,
  },
};

/**
 * Shared generation discipline appended to every formal-artifact system prompt.
 * It encodes the determinism / source-of-truth / regeneration rules (spec
 * Changes 2, 4, 5, 6, 8) once, rather than duplicating them across all 14
 * registry entries. The model reads `runMode` and `changedInputs` from the input
 * context JSON to decide how aggressively to redraw.
 */
const FORMAL_ARTIFACT_DISCIPLINE = `
## ATOS generation discipline

When the input context carries a non-null valueChainSegment, scope the output to
that value-chain segment — its workflows, entities, stakeholders and agendas —
rather than the industry at large.

Structured inputs are the system of record. This document is a generated VIEW of
the program's structured data, never an independently authored source.

### Gap phrasing — who closes it decides how it reads
When you list a gap, decide who must CLOSE it:
- Missing information a STAKEHOLDER must supply (objectives, success measures,
  magnitudes, deadlines, names, priorities, domain facts): phrase the gap as the
  QUESTION to ask that person, naming them when known — e.g. "Ask the sponsor:
  what magnitude and deadline should the objective carry?" Never phrase it as an
  instruction to edit an input field.
- Genuine operator work (generate an upstream document, regenerate after
  evidence changes, connect a system): phrase it as that instruction.
Stakeholder-phrased gaps flow into the follow-up interview script automatically;
operator-phrased gaps stay on the document and the gate. Misphrasing a
stakeholder fact as input-editing strands it where no conversation will ask it.

### Source priority order
When information conflicts, always trust the higher-priority source and never let
a lower one override it:
1. Current phase inputs
2. KPI baselines
3. Current cross-phase context
4. Upstream agent findings
5. Existing business case
6. Existing artifacts
7. Agent memory
8. Prior run history
Never allow memory or a prior artifact to override current structured inputs.

### Grounding facts
The context carries "groundingFacts": the current phase inputs as atomic,
id-tagged facts (F1, F2, …) — grid rows are split into one fact each. These ARE
the current phase inputs and rank first in the source priority order. Ground
every claim in them; never invent facts they do not support. Reference a fact by
its id where it aids precision instead of restating the full input verbatim.

### Regeneration rules
The input context carries a "runMode" (initial_generation | input_change_refresh |
cascade_refresh | gate_remediation | manual_regeneration) and, on redraws, a
"changedInputs" delta. When runMode is not initial_generation:
- Treat current structured inputs as authoritative; existing artifacts are
  reference material ONLY (for formatting, terminology, and narrative continuity).
- Where current inputs conflict with the prior artifact, update the artifact to
  reflect the current inputs. Do not preserve outdated facts or stale assumptions.
- Focus your changes on the fields named in "changedInputs" and anything that
  logically depends on them; leave unaffected sections as they were.

### Deterministic output rule
If inputs have not materially changed, reproduce the prior artifact's structure,
section ordering, naming conventions, terminology, and output shape. Repeated runs
on identical inputs must produce substantially identical output — do not rephrase
content solely for stylistic variation or introduce unnecessary rewrites.

### Cross-phase continuity
The context carries "priorPhaseArtifacts": the approved artifacts from every
earlier phase. Treat them as the established programme baseline — build on their
scope, decisions, roles, and terminology, and never contradict or silently
restate them. They rank as reference material (below current structured inputs in
the source priority order), so when current inputs conflict with a prior-phase
artifact, follow the current inputs.

### Document carry-forward
The context may carry "documentCarryForward": constraints, assumptions,
recommendations, and gaps the document extractor found in uploaded source files,
plus each document's summary ("source [phase]: …" / "insight [phase] (category):
…"). The extractor ran once at upload; these are facts the user already supplied
via documents but that never became a structured field. Use them as supporting
evidence so you never ask for, or treat as missing, information an uploaded
document already established. They rank as reference material — below current
structured inputs and KPI baselines — so when current inputs conflict, follow the
current inputs.

### Memory constraint
Agent memory and run history are supplemental context only. They may aid
continuity, terminology, and narrative consistency, but must never override
current inputs, KPI baselines, cross-phase context, or upstream findings. When
they conflict with current inputs, ignore memory.

### Gap discipline (phase-scoped)
The "gaps" you list become this artifact's own guidance — they surface directly to
the user as what to fix. Scope them strictly to THIS artifact's intent within the
CURRENT phase. Two sources tell you what the current phase owns: "phaseScope" in
the context (its objective, the artifacts it owns, and the detail owned by later
phases) and, authoritatively, the "## Phase ownership map" folded into the system
context — a registry-derived list of exactly which captured inputs and artifacts
each phase owns, with every phase marked EARLIER / CURRENT / LATER relative to
this one. Consult that map first: a missing item is only a gap when the CURRENT
phase owns it. If the map assigns the item (an input or an artifact) to a LATER
phase, or it was already established by an EARLIER phase, it is NOT a gap here —
regardless of how you phrase it. A gap is legitimate ONLY when the current phase
is responsible for the missing information AND that information is absent from
every source above (current inputs, KPI baselines, grounding facts, prior-phase
artifacts, existing artifacts, document carry-forward). Check those sources before
listing a gap. These exclusions are ABSOLUTE — a gap that matches any of them is
invalid even if the corresponding artifact is thin, unapproved, or not yet
baselined. Do NOT list as a gap:
- Detail the methodology assigns to a LATER phase — delivery/milestone schedules,
  RACI or named-role/ownership matrices, resource/staffing plans, phase exit
  criteria, UAT/go-live/run-operate plans. Those are owned downstream, not missing
  here.
- The ABSENCE, draft state, or incompleteness of a later-phase artifact, and never
  name such an artifact as the vehicle a gap should be "captured in" or "baselined
  in" — e.g. do NOT write "scope not baselined in a scope map or requirements
  catalog" (Discover), "no comprehensive stakeholder roster / full team list"
  (Mobilise), "no RACI matrix / adoption plan / test plan". If this artifact itself
  records the relevant content (e.g. inScope/outOfScope, sponsor, objectives), it is
  present — do not demand it be re-expressed in a downstream document.
- The absence of a structured INPUT that a LATER phase owns — the methodology
  collects atomic scope inclusions/exclusions and detailed requirements in Discover,
  and the named team roster / enumerated role assignments in Mobilise; they are NOT
  Strategy inputs. This artifact states scope, roles, and objectives at the HIGH
  LEVEL its own template calls for (inScope/outOfScope narrative, sponsor, objective).
  Do NOT report that "an atomic scope list is not in the inputs", "scope inclusions/
  exclusions are not provided in the structured inputs", "named stakeholder roles are
  not enumerated in the inputs", or any equivalent — reframing a later-phase artifact
  gap as a missing-INPUT gap does not make it in-scope. Those inputs are collected
  downstream, so their absence here is never a gap.
- Information already established elsewhere in the context — e.g. named roles that
  exist in a RACI matrix or stakeholder list, scope already recorded in the inputs
  or a prior-phase artifact, objectives/KPIs already captured.
- Approval, sign-off, baseline, or "recorded" STATE — e.g. "not yet approved",
  "objectives not formally approved", "no formal approval of objectives / exit
  criteria / delivery plan", "plan not signed off", "not baselined". Approval and
  baselining are governance workflows tracked by gate reviews, NOT content this
  artifact is missing. Exit criteria specifically are system-derived — never list
  their absence or non-approval as a gap.
When a gap IS legitimate, make it ACTIONABLE: phrase it so it names the specific
CURRENT-phase input field the user should update to close it, using the exact
input labels from the "## Phase ownership map" CURRENT-phase list (these are the
captured inputs that ground this document). E.g. "Add a total budget figure and
per-line estimates to the Cost assumption input", "Give the Success KPIs a
baseline and target", "Name the Executive sponsor". A gap the user cannot resolve
by updating a named current-phase input is either governance/approval state
(excluded above) or belongs to another phase — do not list it.
Prefer fewer, phase-appropriate gaps over an exhaustive wish-list of everything a
fully mature programme would eventually hold. If nothing within this phase's intent
is genuinely missing, return an empty "gaps" array.`;

/**
 * Downstream areas a formal artifact's change is most likely to impact (Change 7).
 * Surfaced on the cascade handoff so the plan / risk / gate-review agents focus on
 * what actually moved instead of redrawing everything. Keyed by producing agent id.
 */
const FORMAL_ARTIFACT_IMPACTS: Record<string, string[]> = {
  "charter": ["scope", "governance", "success criteria"],
  "business-case": ["success metrics", "benefits realization", "budget assumptions"],
  "outcome-framework": ["success metrics", "benefits realization", "KPI tracking"],
  "strategic-roadmap": ["milestones", "phase sequencing", "gate timing"],
  "governance-model": ["decision rights", "escalation path", "controls"],
  "raci-matrix": ["roles", "accountability", "stakeholders"],
  "requirements-catalog": ["scope", "design inputs", "test coverage"],
  "future-state-design": ["solution architecture", "integration points", "requirements"],
  "target-operating-model": ["roles", "support model", "adoption"],
  "solution-architecture": ["integration points", "test plan", "build scope"],
  "test-plan": ["build readiness", "go-live criteria", "quality gates"],
  "runbook": ["support model", "operational controls", "go-live readiness"],
  "support-model": ["adoption", "operational controls", "hypercare"],
  "optimization-backlog": ["benefits realization", "adoption", "continuous improvement"],
};

function parseKpiBaselines(raw: unknown): Record<string, unknown>[] {
  if (typeof raw === "string") return safeJsonParse<unknown[]>(raw, []).filter(isRecord);
  if (Array.isArray(raw)) return raw.filter(isRecord);
  return [];
}

/**
 * Declarative artifact-input flow — the deploy-side copy of the client
 * methodology's `artifactInputFlow` (src/v3/lib/methodology.ts). Maps an agent
 * id to the phase-input field ids (which may live on different phases) that must
 * feed its generation prompt. The edge cannot import the client methodology, so
 * the flow is expressed here as config rather than hard-coded inside the
 * context branches.
 */
const ARTIFACT_INPUT_FLOW: Record<string, string[]> = {
  // Kept in sync with the client methodology's artifactInputFlow. The roadmap is
  // grounded on the full strategy picture (objective, sponsor, industry,
  // constraints, cost, success metric) bounded by the start/end dates, and on the
  // validation approach so the sequencing proves outcomes in the right order. It
  // also owns the delivery plan, so it pulls the team/role/risk inputs it needs.
  "strategic-roadmap": ["businessObjective", "sponsor", "industry", "startDate", "targetEndDate", "costAssumption", "constraints", "successMetric", "validationApproach", "teamSize", "keyRisks", "keyRoles"],
  // Operate's static go-live schema. These agents fall through to the default
  // context (no dedicated context branch), so — unlike the formal artifacts, which
  // receive every phase input via buildGroundingFacts — they only see the fields
  // named here. Mirrors the Operate artifactInputFlow in the client methodology so
  // the support model, runbook and adoption reporting are grounded on the same
  // facts the UI declares feed them.
  "support-model": ["supportModel", "hyperCarePeriod"],
  "runbook": ["supportModel"],
  "adoption": ["adoptionBaseline", "goLiveDate"],
  // Optimize's static schema. optimization-backlog is a fall-through agent, so it
  // only sees the fields named here — grounds its ranking on the current baseline
  // and the captured improvement candidates.
  "optimization-backlog": ["optimisationBaseline", "improvementCandidates"],
  // Mobilise seeds the risks-and-assumptions log. `risk` is a PROGRAM-LEVEL agent
  // (it writes the shared RAID log, not a phase artifact) and falls through to the
  // default context, which ships only these named fields — not the raw phaseInputs.
  // So the Mobilise initialRisks/initialAssumptions grids are delivered here rather
  // than via a client artifactInputFlow phase edge (risk has no phase-chip artifact
  // to draw one to), letting the risk scan start from the team's own seeded view.
  "risk": ["initialRisks", "initialAssumptions"],
};

/** Stringify a phase-input value (string, number, or grid rows) for the prompt. */
function stringifyFlowValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length) return JSON.stringify(value);
  return undefined;
}

/**
 * Pulls the input fields that flow into the given agent's prompt, scanning every
 * phase's captured inputs so fields from different phases (e.g. Strategy +
 * Mobilise) can both feed one artifact.
 */
function flowedArtifactInputs(
  inner: Record<string, unknown>,
  agentId: string,
): Record<string, string> | undefined {
  const fieldIds = ARTIFACT_INPUT_FLOW[agentId];
  if (!fieldIds) return undefined;
  const phaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
  const out: Record<string, string> = {};
  for (const id of fieldIds) {
    for (const phase of Object.values(phaseInputs)) {
      const phaseRecord = normalizeProgramData(phase as JsonValue | null);
      const stringified = stringifyFlowValue(phaseRecord[id]);
      if (stringified !== undefined) {
        out[id] = stringified;
        break;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Compresses one phase's captured inputs into atomic, id-citable fact lines
 * ("F1: <field> — <value>"). Deploy-side mirror of the client Fact Graph
 * (src/v3/lib/factGraph.ts): each filled atomic field becomes one fact; a grid
 * value (a JSON array of row objects) expands to one fact per non-empty row.
 * Replaces the verbose raw phaseInputs blob in the generation context with a
 * shorter, citable form — the same grounding information, fewer tokens, and a
 * stable id the model can cite instead of restating inputs verbatim.
 */
function buildGroundingFacts(phaseRecord: Record<string, unknown>): string[] {
  const lines: string[] = [];
  let seq = 0;
  // Grounding facts are ATOMIC facts, not documents. A pasted transcript can
  // run to ~100k chars; passed verbatim it re-inflates every downstream agent's
  // prompt (charter, kit, ontology, atlas, blueprint each re-read it). The full
  // text still reaches the agents that need it via documentCarryForward — so
  // here each fact value is capped, and giant free-text fields are elided to a
  // pointer rather than dumped inline.
  const MAX_FACT_LEN = 700;
  const cap = (text: string): string => text.length <= MAX_FACT_LEN
    ? text
    : `${text.slice(0, MAX_FACT_LEN).trimEnd()} …[+${text.length - MAX_FACT_LEN} chars; full text in the attached documents]`;
  for (const [fieldId, value] of Object.entries(phaseRecord)) {
    // savedAt is autosave bookkeeping; `_`-prefixed keys (timestamps, role
    // bindings, provenance) are metadata, never facts for the model.
    if (fieldId === "savedAt" || fieldId.startsWith("_")) continue;
    // Grid value: persisted as a JSON-stringified array of row objects.
    if (typeof value === "string" && value.trim().startsWith("[")) {
      const rows = safeJsonParse<unknown[]>(value, []);
      if (Array.isArray(rows) && rows.length && rows.every(isRecord)) {
        for (const row of rows as Record<string, unknown>[]) {
          const cells = Object.entries(row)
            .filter(([key]) => key !== "id")
            .map(([, cell]) => stringifyFlowValue(cell))
            .filter((cell): cell is string => Boolean(cell));
          if (!cells.length) continue;
          seq += 1;
          lines.push(cap(`F${seq}: ${fieldId} — ${cells.join(" · ")}`));
        }
        continue;
      }
    }
    const stringified = stringifyFlowValue(value);
    if (stringified) {
      seq += 1;
      lines.push(`F${seq}: ${fieldId} — ${cap(stringified)}`);
    }
  }
  return lines;
}

/** A document's stored DocumentIntelligence, as carried into agent context. */
interface CarryForwardDocument {
  fileName: string;
  intelligence: Record<string, unknown>;
}

/**
 * Entity categories the extractor finds but that rarely map to a declared phase
 * field, so they would otherwise be lost to every downstream phase. Deploy-side
 * mirror of programGraph.ts's INSIGHT_CATEGORIES.
 */
const DOC_INSIGHT_CATEGORIES = ["constraints", "assumptions", "recommendations", "gaps"] as const;

function docEntityText(entity: unknown): string {
  if (!isRecord(entity)) return "";
  const text = typeof entity.text === "string"
    ? entity.text
    : typeof entity.description === "string"
      ? entity.description
      : "";
  return text.trim();
}

/**
 * Deploy-side mirror of selectGraphForPhase's document slice. The document
 * extractor already ran once at upload and persisted the full DocumentIntelligence
 * in adam_document_attachments.extracted_data; this surfaces the entities it found
 * but that never became phase fields (constraints, assumptions, recommendations,
 * gaps) plus each document's summary as compact citation lines, scoped to the
 * target phase and every prior phase. The agent thus inherits what earlier
 * documents established without the user re-extracting the same file at each phase.
 * A document is in scope when its primaryPhase is at or before the target phase in
 * the ATOS sequence, or when it declares no known phase (treated as programme-wide).
 */
function buildDocumentCarryForward(documents: CarryForwardDocument[], targetPhaseId: string): string {
  const targetIndex = ATOS_PHASE_SEQUENCE.indexOf(targetPhaseId);
  const lines: string[] = [];
  for (const doc of documents) {
    const intel = doc.intelligence;
    const primaryPhase = typeof intel.primaryPhase === "string" ? intel.primaryPhase : "";
    const anchorIndex = ATOS_PHASE_SEQUENCE.indexOf(primaryPhase);
    // In scope unless anchored at a phase strictly after the target.
    if (anchorIndex >= 0 && targetIndex >= 0 && anchorIndex > targetIndex) continue;
    const phaseTag = anchorIndex >= 0 ? ` [${primaryPhase}]` : "";
    const summary = typeof intel.summary === "string" ? intel.summary.replace(/\s+/g, " ").trim() : "";
    if (summary) lines.push(`source${phaseTag}: ${doc.fileName} — ${summary}`);
    const entities = isRecord(intel.entities) ? intel.entities : {};
    for (const category of DOC_INSIGHT_CATEGORIES) {
      const list = Array.isArray(entities[category]) ? entities[category] as unknown[] : [];
      for (const entity of list) {
        const text = docEntityText(entity);
        if (text) lines.push(`insight${phaseTag} (${category}): ${text}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Flattens the captured phase inputs into a readable "phase.field: value" block
 * for the artifact reviewer. The reviewer must see exactly what the user has
 * already supplied so it never recommends adding a fact that is already an input
 * (e.g. asking for a target end date when targetEndDate is populated). Values are
 * passed in full — the reviewer must be able to judge specificity against the
 * complete input, not a truncated head.
 *
 * Scoped to the target phase + all PRIOR phases: later-phase inputs cannot ground
 * a current-phase artifact, and surfacing a partially-populated downstream input
 * (e.g. mobilise.coreTeamRoster while reviewing a strategy charter) makes the
 * reviewer treat it as a fillable gap and recommend populating an out-of-scope
 * field. Mirrors collectPriorPhaseArtifacts' sequencing.
 */
function collectProvidedInputs(programData: ProgramState, targetPhaseId: string): string {
  const inner = getInnerProgramData(programData);
  const phaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
  const targetIndex = ATOS_PHASE_SEQUENCE.indexOf(targetPhaseId);
  const inScope = (phaseId: string): boolean => {
    if (targetIndex < 0) return true;
    const phaseIndex = ATOS_PHASE_SEQUENCE.indexOf(phaseId);
    // Unknown phases (not in the sequence) are kept; known later phases are dropped.
    return phaseIndex < 0 || phaseIndex <= targetIndex;
  };
  const lines: string[] = [];
  for (const [phaseId, phaseValue] of Object.entries(phaseInputs)) {
    if (!inScope(phaseId)) continue;
    const record = normalizeProgramData(phaseValue as JsonValue | null);
    for (const [fieldId, value] of Object.entries(record)) {
      if (fieldId === "savedAt") continue;
      const stringified = stringifyFlowValue(value);
      if (stringified) lines.push(`- ${phaseId}.${fieldId}: ${stringified}`);
    }
  }
  return lines.join("\n");
}

/**
 * Every artifact produced in phases BEFORE the target phase, in full and
 * regardless of approval status. The reviewer needs the complete upstream picture
 * to judge consistency and to avoid flagging as "missing" anything an earlier
 * phase already established. Mirrors getPriorPhaseContext's access pattern
 * (top-level phaseArtifacts) but drops the approved-only filter and the length
 * cap so the review sees the whole prior-phase trail verbatim.
 */
function collectPriorPhaseArtifacts(programData: ProgramState, targetPhaseId: string): string {
  const targetIndex = ATOS_PHASE_SEQUENCE.indexOf(targetPhaseId);
  if (targetIndex <= 0) return "";
  const phaseArtifacts = (programData.phaseArtifacts as Record<string, Record<string, Record<string, JsonValue>>> | undefined) || {};
  const lines: string[] = [];
  for (const phaseId of ATOS_PHASE_SEQUENCE.slice(0, targetIndex)) {
    const artifacts = phaseArtifacts[phaseId] || {};
    for (const [artifactId, artifact] of Object.entries(artifacts)) {
      const title = typeof artifact?.title === "string" ? artifact.title : artifactId;
      const status = typeof artifact?.status === "string" ? artifact.status : "draft";
      const content = typeof artifact?.content === "string" ? artifact.content.replace(/\s+/g, " ").trim() : "";
      if (!content) continue;
      lines.push(`- ${phaseId} / ${title} (${status}): ${content}`);
    }
  }
  return lines.join("\n");
}

/**
 * Methodology scope for the phase being reviewed: its name, objective, the
 * artifacts it is responsible for, its declared exit criteria, and where it sits
 * in the sequence. This is sourced entirely from the programme's own phase data
 * (driven by the methodology registry on the client), so the reviewer judges an
 * artifact against ITS phase's intent and never demands detail the methodology
 * assigns to a later phase (delivery milestones, RACI, exit criteria, go-live).
 */
function getCurrentPhaseScope(programData: ProgramState, phaseId: string): string {
  const phases = getProgramPhaseContext(programData);
  const phase = phases.find((p) => p.id === phaseId);
  const index = ATOS_PHASE_SEQUENCE.indexOf(phaseId);
  const laterPhases = index >= 0 ? ATOS_PHASE_SEQUENCE.slice(index + 1) : [];
  const ownArtifacts = getProgramArtifactContext(programData)
    .filter((a) => a.phaseId === phaseId)
    .map((a) => a.title)
    .filter((t): t is string => typeof t === "string");
  const name = typeof phase?.name === "string" && phase.name ? phase.name : formatPhaseName(phaseId);
  const objective = typeof phase?.objective === "string" ? phase.objective : "";
  const exitCriteria = Array.isArray(phase?.exitCriteria) ? (phase!.exitCriteria as string[]) : [];
  const lines = [
    `Phase under review: ${name} (${phaseId}) — step ${index + 1} of ${ATOS_PHASE_SEQUENCE.length} in the ATOS sequence.`,
  ];
  if (objective) lines.push(`Objective of this phase: ${objective}`);
  if (ownArtifacts.length) lines.push(`Artifacts this phase is responsible for: ${ownArtifacts.join(", ")}.`);
  if (exitCriteria.length) lines.push(`This phase's own exit criteria: ${exitCriteria.join("; ")}.`);
  if (laterPhases.length) {
    lines.push(
      `Detail owned by LATER phases (out of scope here): ${laterPhases.join(", ")}. Anything those phases capture — delivery/milestone schedules, RACI and ownership matrices, phase exit criteria, UAT/go-live dates, run/operate plans — must NOT be demanded of this artifact.`,
    );
  }
  return lines.join("\n");
}

function buildSpecialAgentInputContext(
  programData: ProgramState,
  meta: {
    name?: string | null;
    client?: string | null;
    industry?: string | null;
  },
  target?: {
    agentId?: string;
    phaseId?: string;
  },
  options?: {
    patternContext?: Array<Record<string, unknown>>;
    /** Effective generation intent for a formal artifact (Change 1). */
    runMode?: RunMode;
    /** Program documents' stored intelligence, for cross-phase carry-forward. */
    documents?: CarryForwardDocument[];
  },
): string {
  const inner = getInnerProgramData(programData);
  const projectMeta = normalizeProgramData(inner.projectMeta as JsonValue | null);
  const artifacts = getProgramArtifactContext(programData);
  const artifactsByPhase = artifacts.reduce<Record<string, Array<Record<string, unknown>>>>((accumulator, artifact) => {
    const phaseId = typeof artifact.phaseId === "string" ? artifact.phaseId : "strategy";
    accumulator[phaseId] = [...(accumulator[phaseId] || []), artifact];
    return accumulator;
  }, {});
  const phaseGuidance = normalizeProgramData(inner.phaseGuidance as JsonValue | null);
  const phases = getProgramPhaseContext(programData).map((phase) => {
    const phaseId = typeof phase.id === "string" ? phase.id : "strategy";
    const guidance = normalizeProgramData(phaseGuidance[phaseId] as JsonValue | null);
    return {
      ...phase,
      artifacts: artifactsByPhase[phaseId] || [],
      eta: typeof guidance.targetDate === "string"
        ? guidance.targetDate
        : typeof guidance.eta === "string"
          ? guidance.eta
          : null,
    };
  });
  const decisions = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
  const risks = getProgramRiskContext(programData);
  const businessCase = normalizeProgramData(inner.businessCase as JsonValue | null);
  const valueRealizeData = normalizeProgramData(inner.valueRealizeData as JsonValue | null);
  const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
  const raidEntries = Array.isArray(raidLog.entries) ? raidLog.entries.filter(isRecord) : [];
  const plan = isRecord(inner.plan) ? inner.plan : null;
  const milestones = Array.isArray(inner.milestones) ? inner.milestones.filter(isRecord) : [];
  const humanMilestones = milestones.filter((entry) => entry.source === "human");
  const activeRaidEntries = raidEntries.filter((entry) => entry.status !== "closed");
  const budget = isRecord(inner.budget) ? inner.budget : null;
  const changeImpact = isRecord(inner.changeImpact) ? inner.changeImpact : null;
  const healthHeatmap = isRecord(inner.healthHeatmap) ? inner.healthHeatmap : null;
  const stakeholderEntries = Array.isArray(inner.stakeholders) ? inner.stakeholders.filter(isRecord) : [];
  const adoption = isRecord(inner.adoption) ? inner.adoption : null;
  const retros = isRecord(inner.retros) ? inner.retros : null;
  const gateReviews = normalizeProgramData(inner.gateReviews as JsonValue | null);
  const budgetTracking = isRecord(inner.budgetTracking) ? inner.budgetTracking : null;
  const narrative = typeof inner.narrative === "string" ? inner.narrative : "";

  if (target?.agentId === "cross-artifact-validator") {
    // Lean structural skeleton only — the model reasons over traceability gaps
    // the deterministic layer can't see (semantics), so we ship the artifact
    // inventory + key item lists rather than full bodies to keep tokens low.
    const benefitsTracking = isRecord(inner.benefitsTracking) ? inner.benefitsTracking : null;
    const workstreams = Array.isArray(inner.workstreams) ? inner.workstreams.filter(isRecord) : [];
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      // The ontology's objective delivery chain (measured-by / delivered-by /
      // threatened-by). Validating this graph's integrity is Layer 2's core job.
      objectiveGraph: buildObjectiveKnowledgeGraph(programData),
      phases,
      artifacts,
      milestones,
      workstreams,
      stakeholders: stakeholderEntries,
      changeImpact,
      businessCase,
      benefitsTracking,
      budgetTracking,
      gateReviews,
      raidEntries: activeRaidEntries,
    }, null, 2);
  }

  if (target?.agentId === "change-impact") {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      narrative,
      phases,
      decisions,
      risks,
      raidEntries: activeRaidEntries,
    }, null, 2);
  }

  if (target?.agentId === "stakeholder") {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      narrative,
      phases,
      decisions,
      raidEntries: activeRaidEntries,
      existingStakeholders: stakeholderEntries,
    }, null, 2);
  }

  if (isProgramLevelAdoptionAgent(target?.agentId || "", target?.phaseId || "")) {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      narrative,
      phases,
      changeImpact,
      stakeholders: stakeholderEntries,
      decisions,
      raidEntries: activeRaidEntries,
      previousAdoption: adoption,
    }, null, 2);
  }

  if (target?.agentId === "health-heatmap") {
    const strategyInputs = normalizeProgramData(
      normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null,
    );
    // The Strategy inputs carry the real programme objective + KPIs; the bare
    // `inner.objective` is a short generic line, which previously led the agent
    // to grade Strategy red for "no objectives" even when they are captured.
    const objective = typeof strategyInputs.businessObjective === "string" && strategyInputs.businessObjective.trim()
      ? strategyInputs.businessObjective
      : typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "";
    // Annotate each phase with its gate decision so the agent grades on the
    // authoritative gate, not a re-derived guess.
    const phasesWithGate = phases.map((phase) => {
      const phaseId = typeof phase.id === "string" ? phase.id : "";
      const gate = normalizeProgramData(gateReviews[phaseId] as JsonValue | null);
      return { ...phase, gateStatus: typeof gate.status === "string" ? gate.status : null };
    });
    return JSON.stringify({
      objective,
      strategyInputs: {
        businessObjective: strategyInputs.businessObjective ?? null,
        successMetric: strategyInputs.successMetric ?? null,
        kpis: strategyInputs.kpis ?? null,
        startDate: strategyInputs.startDate ?? null,
        targetEndDate: strategyInputs.targetEndDate ?? null,
      },
      phases: phasesWithGate,
      gateReviews,
      raidEntries: activeRaidEntries,
      openDecisions: decisions.filter((entry) => entry.status !== "resolved"),
      milestones,
      previousHealthHeatmap: healthHeatmap,
    }, null, 2);
  }

  if (target?.agentId === "retro") {
    const phaseId = target.phaseId || "program";
    const phase = phases.find((entry) => entry.id === phaseId) || null;
    const phaseArtifacts = artifactsByPhase[phaseId] || [];
    const phaseDecisions = decisions.filter((entry) => entry.status === "resolved" && (entry.phaseId === phaseId || entry.phase_id === phaseId));
    const phaseRaidEntries = activeRaidEntries.filter((entry) => {
      const riskPhaseId = typeof entry.phase === "string"
        ? entry.phase
        : typeof entry.phaseId === "string"
          ? entry.phaseId
          : "strategy";
      return riskPhaseId === phaseId;
    });
    const phaseMilestones = milestones.filter((entry) => entry.phaseId === phaseId || entry.phase === phaseId);
    const gateReview = normalizeProgramData(gateReviews[phaseId] as JsonValue | null);

    return JSON.stringify({
      phase,
      artifacts: phaseArtifacts,
      resolvedDecisions: phaseDecisions,
      raidEntries: phaseRaidEntries,
      milestones: phaseMilestones,
      gateReview,
    }, null, 2);
  }

  if (target?.agentId === "deck") {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      narrative,
      phases,
      plan,
      budgetTracking,
      raidEntries: activeRaidEntries,
      milestones,
      closure: isRecord(inner.closure) ? inner.closure : null,
      decisions,
    }, null, 2);
  }

  if (target?.agentId === "scope-pcr") {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      narrative,
      phases,
      decisions,
      raidEntries: activeRaidEntries,
      milestones,
      changeImpact,
      stakeholders: stakeholderEntries,
      existingScopePcr: isRecord(inner.scopePcr) ? inner.scopePcr : null,
    }, null, 2);
  }

  if (target?.agentId === "escalation") {
    const existingEscalations = Array.isArray(inner.escalations)
      ? inner.escalations.filter(isRecord).filter((entry) => entry.status === "open" || entry.status === "acknowledged")
      : [];
    // Pre-filter to the items that can actually trip an escalation rule, so the
    // agent reasons over signal instead of the whole programme. This mirrors the
    // four rules in the escalation prompt: open decisions (rule 1), every phase
    // (rule 2 needs pct history), only HIGH/CRITICAL risks & blockers (rule 3),
    // and only delayed / at-risk milestones (rule 4).
    const escalatableRaid = activeRaidEntries.filter(
      (entry) => entry.severity === "critical" || entry.severity === "high",
    );
    const escalatableMilestones = milestones.filter(
      (entry) => entry.status === "delayed" || entry.status === "at-risk",
    );
    const nowMs = Date.now();
    const hoursSince = (value: unknown): number | null => {
      if (typeof value !== "string" || !value) return null;
      const ts = Date.parse(value);
      return Number.isNaN(ts) ? null : Math.max(0, Math.round((nowMs - ts) / 3_600_000));
    };
    // Surface verifiable age so the agent honours the 48h/5-day thresholds
    // instead of guessing, and artifact progress so a phase is judged by
    // artifact approval (the real signal) rather than pct.
    const escalatableDecisions = decisions
      .filter((entry) => entry.status !== "resolved")
      .map((entry) => ({ ...entry, ageHours: hoursSince(entry.createdAt ?? entry.raisedAt) }));
    const phasesWithProgress = phases.map((phase) => {
      const phaseArtifacts = Array.isArray(phase.artifacts) ? phase.artifacts.filter(isRecord) : [];
      const approvedArtifacts = phaseArtifacts.filter((a) => a.status === "approved").length;
      return {
        ...phase,
        hoursSinceUpdate: hoursSince(phase.lastUpdatedAt),
        artifactCount: phaseArtifacts.length,
        approvedArtifactCount: approvedArtifacts,
        hasArtifactProgress: phaseArtifacts.length > 0,
      };
    });
    return JSON.stringify({
      now: new Date().toISOString(),
      decisions: escalatableDecisions,
      phases: phasesWithProgress,
      raidEntries: escalatableRaid,
      milestones: escalatableMilestones,
      openEscalations: existingEscalations,
    }, null, 2);
  }

  if (target?.agentId === "closure") {
    return JSON.stringify({
      objective: typeof inner.objective === "string"
        ? inner.objective
        : typeof inner.programObjective === "string"
          ? inner.programObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
      phases,
      retros,
      budgetTracking,
      openRaidEntries: activeRaidEntries,
      milestones,
      decisions,
    }, null, 2);
  }

  if (target?.agentId === "exit-criteria-generator") {
    const phaseId = target.phaseId || "strategy";
    const phaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const humanNotes = Array.isArray(inner.humanNotes) ? inner.humanNotes.filter(isRecord) : [];
    return JSON.stringify({
      programName: meta.name || (typeof projectMeta.name === "string" ? projectMeta.name : ""),
      phaseId,
      phaseInputs: normalizeProgramData(phaseInputs[phaseId] as JsonValue | null),
      stageNotes: humanNotes.filter((entry) => entry.phaseId === phaseId),
      priorPhaseContext: target.phaseId ? getPriorPhaseContext(programData, target.phaseId) : "",
    }, null, 2);
  }

  if (target?.agentId === "decision-advisor") {
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    return JSON.stringify({
      objective: typeof inner.objective === "string" ? inner.objective : "",
      risks: activeRaidEntries,
      decisions: queue,
    }, null, 2);
  }

  if (target?.agentId === "contradiction-detector") {
    return JSON.stringify({
      narrative,
      plan,
      raidEntries: activeRaidEntries,
      gateReviews,
    }, null, 2);
  }

  if (target?.agentId === "dependency-check" || target?.agentId === "handoff-quality") {
    return JSON.stringify({
      phaseId: target.phaseId || "program",
      handoffs: normalizeProgramData(inner.phaseHandoffs as JsonValue | null),
      gateReviews,
      narrative,
      plan,
      phases,
    }, null, 2);
  }

  if (target?.agentId === "benefits-tracker") {
    const strategyInputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null);
    // Human-entered baseline/target KPIs captured at Strategy (persisted as a
    // JSON string by PhaseInputsPanel). Parse them into structured anchors so
    // benefits realisation is measured against real numbers, not estimates.
    const kpiBaselines = typeof strategyInputs.kpis === "string"
      ? safeJsonParse<unknown[]>(strategyInputs.kpis, []).filter(isRecord)
      : Array.isArray(strategyInputs.kpis)
        ? strategyInputs.kpis.filter(isRecord)
        : [];
    // Human-entered measured actuals captured at Value Realize (persisted as a
    // JSON string by PhaseInputsPanel under phaseInputs.valuerealize.kpiActuals).
    // Each record snapshots {id,name,baseline,target,unit,actual}, so the tracker
    // reports realisation against real numbers. Falls back to the legacy
    // valueRealization slot for backward compatibility.
    const valueRealizeInputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).valuerealize as JsonValue | null);
    const enteredActuals = typeof valueRealizeInputs.kpiActuals === "string"
      ? safeJsonParse<unknown[]>(valueRealizeInputs.kpiActuals, []).filter(isRecord)
      : Array.isArray(valueRealizeInputs.kpiActuals)
        ? valueRealizeInputs.kpiActuals.filter(isRecord)
        : [];
    const kpiActuals = enteredActuals.length > 0
      ? enteredActuals
      : (isRecord(inner.valueRealization) ? inner.valueRealization : inner.kpiActuals);
    return JSON.stringify({
      objective: typeof inner.objective === "string" ? inner.objective : "",
      kpiBaselines,
      phaseInputs: normalizeProgramData(inner.phaseInputs as JsonValue | null),
      milestones,
      plan,
      kpiActuals,
    }, null, 2);
  }

  if (target?.agentId === "benchmark-comparator") {
    return JSON.stringify({
      industry: meta.industry || projectMeta.industry || null,
      phases,
      risks: activeRaidEntries,
      decisions,
      phaseInputs: normalizeProgramData(inner.phaseInputs as JsonValue | null),
      patternContext: options?.patternContext || [],
    }, null, 2);
  }

  if (target?.agentId === "weekly-digest") {
    return JSON.stringify({
      narrative,
      plan,
      phases,
      decisions,
      risks: activeRaidEntries,
      previousDigest: isRecord(inner.weeklyDigest) ? inner.weeklyDigest : null,
    }, null, 2);
  }

  if (target?.agentId === "phase-completion-estimator") {
    const phaseId = target.phaseId || "strategy";
    return JSON.stringify({
      phaseId,
      phases,
      milestones,
      phaseMilestones: milestones.filter((entry) => entry.phaseId === phaseId || entry.phase === phaseId),
      exitCriteria: getExitCriteriaForPhase(inner, phaseId),
      phaseInputs: normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null)[phaseId] as JsonValue | null),
      phaseArtifacts: normalizeProgramData(normalizeProgramData(inner.phaseArtifacts as JsonValue | null)[phaseId] as JsonValue | null),
      phaseTasks: Array.isArray(inner[`phaseAgentTasks_${phaseId}`]) ? inner[`phaseAgentTasks_${phaseId}`] : [],
      readiness: computeReadinessForAgent(programData, phaseId),
    }, null, 2);
  }

  if (target?.agentId === "discovery-guide-generator") {
    return JSON.stringify({
      programName: meta.name,
      industry: meta.industry,
      programType: projectMeta.programType || inner.programType || null,
      objectives: inner.objectives || inner.objective || null,
      stakeholders: stakeholderEntries.slice(0, 10),
      scopeIn: projectMeta.scopeIn || normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).discover as JsonValue | null).scopeInclusions || null,
    }, null, 2);
  }

  if (target?.agentId === "sprint-planner") {
    const allPhaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const buildInputs = normalizeProgramData(allPhaseInputs.build as JsonValue | null);
    const mobiliseInputs = normalizeProgramData(allPhaseInputs.mobilise as JsonValue | null);
    // Build milestones live in an ai-derived grid on the Build phase inputs (rows
    // of { milestone, targetDate }) — NOT in the global `inner.milestones` array,
    // which only carries milestones promoted from earlier phases. Resolve the grid
    // by row shape so we never depend on the per-programme field id; fall back to
    // any global build-tagged milestones.
    const buildMilestoneRows = resolveMilestoneRows(buildInputs);
    const milestonesForSprints = buildMilestoneRows.length > 0
      ? buildMilestoneRows
          .map((row) => ({
            name: String(row.milestone ?? row.name ?? row.title ?? "").trim(),
            targetDate: String(row.targetDate ?? row.date ?? row.dueDate ?? "").trim() || null,
          }))
          .filter((entry) => entry.name)
      : milestones.filter((entry) => entry.phaseId === "build" || entry.phase === "build");
    // Team capacity is the named-role roster (canonical "coreTeamRoster" grid),
    // owned per-phase by Build/Mobilise — read the roster rows, not a non-existent
    // numeric `teamSize` field. Prefer the Build roster, then the Mobilise one.
    const buildRoster = resolveRosterRows(buildInputs);
    const team = buildRoster.length > 0 ? buildRoster : resolveRosterRows(mobiliseInputs);
    const workstreams = Array.isArray(inner.workstreams) && inner.workstreams.length > 0
      ? inner.workstreams
      : (Array.isArray(mobiliseInputs.workstreams) ? mobiliseInputs.workstreams : []);
    return JSON.stringify({
      milestones: milestonesForSprints,
      team,
      teamSize: team.length > 0 ? team.length : (buildInputs.teamSize || 5),
      sprintLengthWeeks: buildInputs.sprintLengthWeeks || 2,
      startDate: buildInputs.startDate || new Date().toISOString(),
      endDate: buildInputs.endDate || null,
      workstreams,
    }, null, 2);
  }

  if (target?.agentId === "stakeholder-comms-drafter") {
    return JSON.stringify({
      stakeholders: stakeholderEntries,
      decisions,
      healthHeatmap,
      activePhase: inner.activePhase || target.phaseId || null,
      gateReview: normalizeProgramData(gateReviews[String(inner.activePhase || target.phaseId || "")] as JsonValue | null),
    }, null, 2);
  }

  if (target?.agentId === "steerco-agenda-builder") {
    return JSON.stringify({
      decisions,
      risks: activeRaidEntries,
      milestones,
      activePhase: inner.activePhase || target.phaseId || null,
      gateReview: normalizeProgramData(gateReviews[String(inner.activePhase || target.phaseId || "")] as JsonValue | null),
      healthHeatmap,
    }, null, 2);
  }

  if (target?.agentId === "kpi-validator") {
    const strategyInputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null);
    return JSON.stringify({
      successMetrics: strategyInputs.successMetrics || inner.objectives || [],
      objective: inner.objective || null,
    }, null, 2);
  }

  if (target?.agentId === "compliance-checker") {
    const allPhaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const strategyInputs = normalizeProgramData(allPhaseInputs.strategy as JsonValue | null);
    const governInputs = normalizeProgramData(allPhaseInputs.govern as JsonValue | null);
    return JSON.stringify({
      programType: projectMeta.programType || inner.programType || null,
      industry: meta.industry,
      scopeIn: strategyInputs.scopeInclusions || strategyInputs.scopeIn || null,
      decisions: decisions.slice(-10),
      activePhase: inner.activePhase || target.phaseId || null,
      // The regulatory frameworks to check against are captured on the Govern static
      // spine (regulatoryFrameworks — kept in sync with the client artifactInputFlow
      // for compliance-checker). Fall back to a legacy strategy regulatoryContext for
      // programmes generated before that field existed.
      regulatoryContext: governInputs.regulatoryFrameworks || strategyInputs.regulatoryContext || null,
      // The rest of the Govern static spine (kept in sync with the client
      // artifactInputFlow for compliance-checker): the operational controls that
      // enforce the frameworks, the audit-evidence plan, and whether escalation was
      // tested. Without these the check saw only the frameworks and had to assume
      // control/audit/escalation coverage — so it could never flag an untested
      // control or a missing audit plan as a gap.
      controlMatrix: governInputs.controlMatrix || null,
      auditEvidencePlan: governInputs.auditEvidencePlan || null,
      escalationTested: governInputs.escalationTested || null,
    }, null, 2);
  }

  if (target?.agentId === "capacity-assessor") {
    const activePhase = String(inner.activePhase || target.phaseId || "strategy");
    const allPhaseInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const phaseInputs = normalizeProgramData(allPhaseInputs[activePhase] as JsonValue | null);
    // The real team roster is the ai-derived "coreTeamRoster" grid owned by
    // Mobilise; the legacy `team` key was never written. Read the canonical
    // roster and fall back to the legacy key only if it is somehow populated.
    const mobiliseInputs = normalizeProgramData(allPhaseInputs.mobilise as JsonValue | null);
    const roster = resolveRosterRows(mobiliseInputs);
    return JSON.stringify({
      team: roster.length > 0 ? roster : (phaseInputs.team || inner.team || []),
      milestones: milestones.filter((entry) => entry.status !== "complete"),
      workstreams: Array.isArray(inner.workstreams) ? inner.workstreams : [],
      timeline: { start: phaseInputs.startDate || null, end: phaseInputs.endDate || null },
      programType: projectMeta.programType || inner.programType || null,
    }, null, 2);
  }

  if (target?.agentId === "lessons-synthesiser") {
    const retrosByPhase = normalizeProgramData(inner.retros as JsonValue | null);
    return JSON.stringify({
      phaseRetros: ATOS_PHASE_SEQUENCE.map((phaseId) => ({ phase: phaseId, retro: retrosByPhase[phaseId] || null })).filter((entry) => entry.retro),
      programName: meta.name,
    }, null, 2);
  }

  if (target?.agentId === "vendor-risk-assessor") {
    const mobiliseInputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).mobilise as JsonValue | null);
    return JSON.stringify({
      vendors: [
        ...(Array.isArray(mobiliseInputs.vendors) ? mobiliseInputs.vendors : []),
        ...stakeholderEntries.filter((entry) => entry.type === "vendor" || entry.type === "partner"),
      ],
      programType: projectMeta.programType || inner.programType || null,
      activePhase: inner.activePhase || target.phaseId || null,
      milestones: milestones.filter((entry) => entry.status !== "complete").slice(0, 10),
    }, null, 2);
  }

  if (target?.agentId === "stakeholder-risk-assessor") {
    return JSON.stringify({
      stakeholders: stakeholderEntries,
      recentDecisions: decisions.slice(-15),
      raidEntries: activeRaidEntries,
      today: new Date().toISOString().slice(0, 10),
    }, null, 2);
  }

  if (target?.agentId === "benefit-forecast") {
    const strategyInputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null);
    return JSON.stringify({
      businessObjective: strategyInputs.businessObjective || typeof inner.objective === "string" ? inner.objective : "",
      successMetric: strategyInputs.successMetric || null,
      valueProjected: coerceNumber(inner.valueProjected, 0),
      valueDelivered: coerceNumber(inner.valueDelivered, 0),
      kpis: Array.isArray(inner.kpis) ? inner.kpis : [],
      phases,
      milestones,
      today: new Date().toISOString().slice(0, 10),
    }, null, 2);
  }

  if (target?.agentId === "meeting-notes-extractor") {
    return JSON.stringify({
      programName: meta.name || "",
      phases,
      stakeholders: stakeholderEntries.slice(0, 10),
      today: new Date().toISOString().slice(0, 10),
    }, null, 2);
  }

  if (target?.agentId === "deck-section") {
    const sectionType = target.phaseId || "risks"; // phaseId is repurposed as sectionType here
    const existingDeck = normalizeProgramData(inner.deck as JsonValue | null);
    const existingSlides = Array.isArray(existingDeck.slides) ? existingDeck.slides : [];
    const existingSlide = existingSlides.find((s: unknown) => isRecord(s) && (s as Record<string,unknown>).type === sectionType);
    return JSON.stringify({
      sectionType,
      existingSlide: existingSlide || null,
      phases,
      risks: activeRaidEntries,
      decisions,
      milestones,
      budget,
      stakeholders: stakeholderEntries,
      narrative,
    }, null, 2);
  }

  if (target?.agentId === "narrative-refine") {
    const instruction = target.phaseId || ""; // phaseId repurposed as instruction
    const existingNarrative = typeof inner.narrative === "string" ? inner.narrative : "";
    return JSON.stringify({
      existingNarrative,
      refinementInstruction: instruction,
      phases,
      risks: activeRaidEntries,
      decisions,
      milestones,
    }, null, 2);
  }

  if (target?.agentId === "board-pack") {
    const existingDeck = normalizeProgramData(inner.deck as JsonValue | null);
    const existingNarrative = typeof inner.narrative === "string" ? inner.narrative : "";
    const existingPlan = isRecord(inner.plan) ? inner.plan : null;
    return JSON.stringify({
      programName: meta.name,
      client: meta.client,
      narrative: existingNarrative,
      deck: existingDeck,
      plan: existingPlan,
      phases,
      risks: activeRaidEntries.slice(0, 8),
      decisions: decisions.filter((d) => d.status !== "resolved").slice(0, 6),
      milestones: milestones.slice(0, 10),
      budget,
      stakeholders: stakeholderEntries.slice(0, 8),
      healthHeatmap: isRecord(inner.healthHeatmap) ? inner.healthHeatmap : null,
    }, null, 2);
  }

  // Pattern extraction distils reusable lessons for FUTURE programmes and labels
  // each pattern's outcome (successful|failed|neutral). For that label to be
  // trustworthy it must see how the programme actually performed — not just its
  // narrative. Surface the realisation signal (baseline → target → measured
  // actual, plus the benefits-tracker assessment and gate outcomes) so outcomes
  // are judged against evidence, not guessed. This grounds the only real
  // cross-programme learning loop.
  // Formal-artifact agents draw on their phase inputs plus the shared programme
  // context. The structured Strategy KPIs (captured in PhaseInputsPanel) are
  // always surfaced as kpiBaselines so outcome/business-case/optimization agents
  // can anchor to real numbers. One block serves every registry entry.
  const formalSpec = FORMAL_ARTIFACT_AGENTS[target?.agentId || ""];
  if (formalSpec) {
    const phaseInputsAll = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const strategyInputs = normalizeProgramData(phaseInputsAll.strategy as JsonValue | null);
    // ATOS Flow captures the mandate facts (objective, sponsor, industry,
    // success metric, KPIs) on the Frame movement rather than Strategy — fall
    // back to frame inputs so Flow programmes ground exactly like stage-gate
    // ones. Stage-gate programmes have no frame bucket, so this is a no-op.
    const frameInputs = normalizeProgramData(phaseInputsAll.frame as JsonValue | null);
    const phaseInputs = normalizeProgramData(phaseInputsAll[formalSpec.phase] as JsonValue | null);
    // The Discovery Kit plans WHO to interview: fold every named person on
    // the People list (Listen's coverage roster) into its context — a Team
    // Roster the operator captured must seed the kit, wherever it landed.
    const kitRosterSeed: string[] = [];
    if (formalSpec.fieldKey === "discoveryKit") {
      const listenInputs = normalizeProgramData(phaseInputsAll.listen as JsonValue | null);
      const rosterRaw = typeof listenInputs.interviewRoster === "string" ? listenInputs.interviewRoster : "";
      const rosterRows = rosterRaw.trim().startsWith("[") ? safeJsonParse<unknown[]>(rosterRaw, []) : [];
      for (const row of rosterRows) {
        if (!isRecord(row)) continue;
        const cells = [row.name, row.role, row.domain]
          .map((cell) => (typeof cell === "string" ? cell.trim() : ""))
          .filter(Boolean);
        if (cells.length) kitRosterSeed.push(`knownStakeholder — ${cells.join(" · ")}`);
      }
    }
    const objective = typeof inner.objective === "string"
      ? inner.objective
      : typeof inner.programObjective === "string"
        ? inner.programObjective
        : typeof projectMeta.objective === "string"
          ? projectMeta.objective
          : "";
    // Run mode + input delta (Changes 1 & 3): tell the model what kind of run
    // this is and exactly which structured inputs moved since the last draft.
    const runMode = options?.runMode ?? "initial_generation";
    const changedInputs = runMode === "initial_generation"
      ? []
      : computeInputDelta(readPriorInputSnapshot(inner, formalSpec.fieldKey), buildFormalInputSnapshot(inner, formalSpec.phase));
    // Cross-phase grounding: every phase except the first generates artifacts
    // with the approved artifacts from all earlier phases in context, so later
    // artifacts build on what came before instead of contradicting it. The
    // spine is whichever sequence contains the phase — stage-gate phases walk
    // ATOS_PHASE_SEQUENCE, ATOS Flow movements walk FLOW_MOVEMENT_SEQUENCE
    // (so Envision sees the Atlas and the Ontology, Show sees the Blueprint…).
    const groundingSpine = FLOW_MOVEMENT_SEQUENCE.includes(formalSpec.phase)
      ? FLOW_MOVEMENT_SEQUENCE
      : ATOS_PHASE_SEQUENCE;
    const phaseIndex = groundingSpine.indexOf(formalSpec.phase);
    const priorPhaseArtifacts = phaseIndex > 0
      ? groundingSpine.slice(0, phaseIndex).flatMap((phaseId) =>
          (artifactsByPhase[phaseId] || []).map((artifact) => ({ ...artifact, phase: phaseId })))
      : [];
    return JSON.stringify({
      artifact: formalSpec.title,
      phase: formalSpec.phase,
      ...(target?.agentId === "domain-ontology"
        ? { vocabularySteering: ontologyVocabularySteering(
            meta.industry || strategyInputs.industry || frameInputs.industry || projectMeta.industry,
            frameInputs.segment || strategyInputs.segment,
          ) }
        : {}),
      valueChainSegment: frameInputs.segment || strategyInputs.segment || null,
      // The current phase's intent boundary: its objective, the artifacts it owns,
      // and the detail owned by LATER phases that must not be demanded here. This
      // scopes the artifact's self-reported "gaps" to what this phase is actually
      // responsible for (see the phase-scoped gap discipline).
      phaseScope: getCurrentPhaseScope(programData, formalSpec.phase),
      runMode,
      changedInputs,
      programName: meta.name || (typeof projectMeta.name === "string" ? projectMeta.name : ""),
      client: meta.client || (typeof projectMeta.client === "string" ? projectMeta.client : ""),
      industry: meta.industry || strategyInputs.industry || frameInputs.industry || (typeof projectMeta.industry === "string" ? projectMeta.industry : ""),
      objective,
      businessObjective: strategyInputs.businessObjective || frameInputs.businessObjective || objective,
      sponsor: strategyInputs.sponsor || frameInputs.sponsor || inner.sponsor || projectMeta.sponsor || projectMeta.executiveSponsor || "",
      successMetric: strategyInputs.successMetric || strategyInputs.successMetrics || frameInputs.successMetric || null,
      constraints: strategyInputs.constraints || null,
      startDate: strategyInputs.startDate || (typeof projectMeta.startDate === "string" ? projectMeta.startDate : null),
      targetEndDate: strategyInputs.targetEndDate || (typeof projectMeta.targetEndDate === "string" ? projectMeta.targetEndDate : null),
      budget: strategyInputs.budget || budget || null,
      scopeInclusions: strategyInputs.scopeInclusions || strategyInputs.scopeIn || null,
      scopeExclusions: strategyInputs.scopeExclusions || strategyInputs.scopeOut || null,
      kpiBaselines: parseKpiBaselines(strategyInputs.kpis ?? frameInputs.kpis),
      // ATOS Flow keeps the mandate CONVERSATION on Frame while the charter's
      // spec phase is Strategy — empty on Flow programmes. Grounded only in
      // that empty bucket, the model never reads the sponsor's own words, so
      // "the record outranks the fields" has no record to work with. Fall
      // back to Frame's captured inputs when the spec phase holds nothing.
      groundingFacts: [
        ...buildGroundingFacts(Object.keys(phaseInputs).length ? phaseInputs : frameInputs),
        ...kitRosterSeed,
      ],
      documentCarryForward: buildDocumentCarryForward(options?.documents || [], formalSpec.phase),
      valueProjected: coerceNumber(inner.valueProjected ?? businessCase.projectedValue ?? valueRealizeData.projectedValue, 0),
      narrative,
      phases,
      milestones: milestones.slice(0, 12),
      risks: activeRaidEntries.slice(0, 10),
      decisions: decisions.filter((d) => d.status !== "resolved").slice(0, 8),
      stakeholders: stakeholderEntries.slice(0, 12),
      existingBusinessCase: businessCase,
      existingArtifacts: artifactsByPhase[formalSpec.phase] || [],
      priorPhaseArtifacts,
    }, null, 2);
  }

  // The Phase Transition Planner plans a downstream phase's inputs/artifacts.
  // It MUST inherit the programme fundamentals established at Strategy — the
  // objective, scope, success metrics/KPIs, constraints, timeline — as STRUCTURED
  // facts, not just as artifact prose. Without these it re-requests objective,
  // scope, and success metrics at every dynamic phase and flags them "missing"
  // even though Strategy already set them (the symptom seen at Mobilise). The
  // default context below omits scope + success metrics, so the planner needs
  // its own grounding payload.
  if (target?.agentId === "phase-input-planner") {
    const phaseInputsAll = normalizeProgramData(inner.phaseInputs as JsonValue | null);
    const strategyInputs = normalizeProgramData(phaseInputsAll.strategy as JsonValue | null);
    // ATOS Flow: the mandate fundamentals live on Frame (see the formal-artifact
    // context above) — inherit them the same way so the planner never re-asks
    // objective/sponsor/KPIs on a Flow programme. No-op for stage-gate data.
    const frameInputs = normalizeProgramData(phaseInputsAll.frame as JsonValue | null);
    const targetPhaseInputs = normalizeProgramData(phaseInputsAll[target.phaseId || ""] as JsonValue | null);
    const objective = typeof inner.objective === "string"
      ? inner.objective
      : typeof inner.programObjective === "string"
        ? inner.programObjective
        : typeof strategyInputs.businessObjective === "string"
          ? strategyInputs.businessObjective
          : typeof frameInputs.businessObjective === "string"
            ? frameInputs.businessObjective
            : typeof projectMeta.objective === "string"
              ? projectMeta.objective
              : "";
    return JSON.stringify({
      programName: meta.name || (typeof projectMeta.name === "string" ? projectMeta.name : ""),
      client: meta.client || (typeof projectMeta.client === "string" ? projectMeta.client : ""),
      industry: meta.industry || strategyInputs.industry || frameInputs.industry || (typeof projectMeta.industry === "string" ? projectMeta.industry : ""),
      // Programme fundamentals — already established; INHERIT, do not re-ask.
      objective,
      businessObjective: strategyInputs.businessObjective || frameInputs.businessObjective || objective,
      successMetric: strategyInputs.successMetric || strategyInputs.successMetrics || frameInputs.successMetric || null,
      kpiBaselines: parseKpiBaselines(strategyInputs.kpis ?? frameInputs.kpis),
      scopeInclusions: strategyInputs.scopeInclusions || strategyInputs.scopeIn || null,
      scopeExclusions: strategyInputs.scopeExclusions || strategyInputs.scopeOut || null,
      constraints: strategyInputs.constraints || null,
      sponsor: strategyInputs.sponsor || frameInputs.sponsor || (typeof inner.sponsor === "string" ? inner.sponsor : "") || projectMeta.sponsor || projectMeta.executiveSponsor || "",
      startDate: strategyInputs.startDate || (typeof projectMeta.startDate === "string" ? projectMeta.startDate : null),
      targetEndDate: strategyInputs.targetEndDate || (typeof projectMeta.targetEndDate === "string" ? projectMeta.targetEndDate : null),
      budget: strategyInputs.budget || budget || null,
      // Facts already captured for the phase being planned, so the planner sees
      // what is already filled in (team roster, governance cadence, etc.) and
      // does not re-ask for them.
      groundingFacts: buildGroundingFacts(targetPhaseInputs),
      narrative,
      phases,
      milestones: milestones.slice(0, 12),
      risks: activeRaidEntries.slice(0, 10),
      decisions: decisions.filter((entry) => entry.status !== "resolved").slice(0, 8),
      stakeholders: stakeholderEntries.slice(0, 12),
    }, null, 2);
  }

  // Phase inputs that flow into this agent's prompt (e.g. the Delivery Plan
  // agent now receives businessObjective + start/end dates from Strategy plus
  // team size, known risks, and key roles from Mobilise). Sourced from the
  // declarative ARTIFACT_INPUT_FLOW config, not hard-coded here.
  const flowedInputs = flowedArtifactInputs(inner, target?.agentId || "");
  const defaultStrategyInputs = normalizeProgramData(
    normalizeProgramData(inner.phaseInputs as JsonValue | null).strategy as JsonValue | null,
  );
  // The live active phase, so generic-context agents (e.g. daily-briefing) anchor
  // their narrative on where the programme actually is — not the first phase or a
  // phase they infer from prose. Prefer the canonical `inner.activePhase` pointer,
  // but fall back to the phase statuses when it is missing/stale: a null pointer
  // (seen after a data reset) otherwise told daily-briefing there was "no active
  // phase", so it narrated the programme as "stalled at inception" though several
  // gates were already approved. Deriving from statuses keeps the context honest
  // regardless of the pointer — the in-progress phase is the one marked "active",
  // else the first phase that is neither complete nor not-yet-started.
  const pointerActiveId = typeof inner.activePhase === "string" ? inner.activePhase : "";
  const activePhaseId = (pointerActiveId && phases.some((p) => p.id === pointerActiveId))
    ? pointerActiveId
    : (phases.find((p) => p.status === "active")?.id
      ?? phases.find((p) => p.status !== "complete" && !NOT_STARTED_PHASE_STATUS.has(String(p.status ?? "").trim().toLowerCase()))?.id
      ?? "");
  const activePhase = phases.find((phase) => phase.id === activePhaseId) ?? null;
  // Progress evidence so the briefing can't claim "no progress / stalled at
  // inception": count the phases whose stakeholder gate has been approved.
  const approvedGateCount = phases.filter((p) =>
    p.status === "complete"
    || normalizeProgramData(gateReviews[p.id] as JsonValue | null).status === "approved",
  ).length;
  return JSON.stringify({
    programName: meta.name || (typeof projectMeta.name === "string" ? projectMeta.name : ""),
    client: meta.client || (typeof projectMeta.client === "string" ? projectMeta.client : ""),
    industry: meta.industry
      || (typeof defaultStrategyInputs.industry === "string" ? defaultStrategyInputs.industry : "")
      || (typeof projectMeta.industry === "string" ? projectMeta.industry : ""),
    objective: typeof inner.objective === "string"
      ? inner.objective
      : typeof inner.programObjective === "string"
        ? inner.programObjective
        : typeof defaultStrategyInputs.businessObjective === "string"
          ? defaultStrategyInputs.businessObjective
          : typeof projectMeta.objective === "string"
            ? projectMeta.objective
            : "",
    sponsor: typeof inner.sponsor === "string"
      ? inner.sponsor
      : typeof defaultStrategyInputs.sponsor === "string"
        ? defaultStrategyInputs.sponsor
        : typeof projectMeta.sponsor === "string"
          ? projectMeta.sponsor
          : typeof projectMeta.executiveSponsor === "string"
            ? projectMeta.executiveSponsor
            : "",
    ...(flowedInputs ? { flowedInputs } : {}),
    narrative,
    valueProjected: coerceNumber(inner.valueProjected ?? businessCase.projectedValue ?? valueRealizeData.projectedValue, 0),
    valueDelivered: coerceNumber(inner.valueDelivered ?? valueRealizeData.valueDelivered ?? businessCase.valueDelivered, 0),
    activePhase: activePhaseId || null,
    activePhaseName: activePhase ? activePhase.name : null,
    activePhaseProgress: activePhase ? activePhase.pct : null,
    activePhaseStatus: activePhase ? activePhase.status : null,
    gatesApproved: approvedGateCount,
    phasesComplete: phases.filter((p) => p.status === "complete").length,
    phaseCount: phases.length,
    phases,
    artifactCount: artifacts.length,
    activeArtifacts: artifacts.slice(0, 10),
    ...(target?.agentId !== "narrative" ? { plan } : {}),
    milestones,
    humanMilestones,
    decisions,
    decisionCount: decisions.length,
    openDecisions: decisions
      .filter((entry) => entry.status !== "resolved")
      .slice(0, 10),
    existingRisks: raidEntries.length,
    raidEntries: activeRaidEntries,
    risks,
    budget,
    changeImpact,
    stakeholders: stakeholderEntries,
    adoption,
    patternContext: options?.patternContext || [],
  }, null, 2);
}

function applyNarrativeResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    narrative: typeof result.narrative === "string" ? result.narrative : null,
    narrativeGeneratedAt: typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString(),
    narrativeConfidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : null,
  }));
}

function applyDeckSectionResultToProgramData(programData: ProgramState, result: Record<string, unknown>, sectionType: string): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existingDeck = normalizeProgramData(inner.deck as JsonValue | null);
    const slides = Array.isArray(existingDeck.slides) ? existingDeck.slides : [];
    const updatedSlide = isRecord(result.slide) ? result.slide : null;
    if (!updatedSlide) return inner;
    const updatedSlides = slides.map((s: unknown) => {
      if (isRecord(s) && (s as Record<string,unknown>).type === sectionType) return { ...(s as Record<string,unknown>), ...updatedSlide };
      return s;
    });
    return { ...inner, deck: { ...existingDeck, slides: updatedSlides, lastSectionUpdated: sectionType, lastSectionUpdatedAt: new Date().toISOString() } };
  });
}

function applyBoardPackResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    boardPack: {
      title: typeof result.title === "string" ? result.title : "Board Pack",
      executiveSummary: typeof result.executiveSummary === "string" ? result.executiveSummary : "",
      sections: Array.isArray(result.sections) ? result.sections : [],
      generatedAt: new Date().toISOString(),
      confidence: typeof result.confidence === "number" ? result.confidence : 0.8,
    },
  }));
}

/**
 * The Strategic Roadmap is the single folded delivery artifact: phase sequencing
 * (from the strategic-roadmap agent) plus the delivery plan (`deliveryPlan`) and
 * tracked milestones (`milestones`) folded in from the plan / milestone agents.
 * Returns a shallow copy of the existing container so callers can merge in one key
 * without clobbering the others.
 */
function getStrategicRoadmapContainer(inner: ProgramState): Record<string, JsonValue> {
  return isRecord(inner.strategicRoadmap) ? { ...(inner.strategicRoadmap as Record<string, JsonValue>) } : {};
}

// Imperative ask to assign artifact owners / due dates — a Mobilise-phase
// responsibility, so it is premature (not a real gap) before Mobilise starts.
const PLAN_OWNER_ASSIGNMENT = /\bassign(?:ing|ed)?\b[\s\S]*\b(owners?|accountable|raci|due\s*dates?)\b|\b(owners?|due\s*dates?)\b[\s\S]*\bassign/i;

/**
 * True when a delivery-plan action/blocker provably contradicts grounded state,
 * mirroring the RAID/escalation guards (the plan is generated by the same model
 * and drifts the same way):
 * - it asks to define/approve "phase exit criteria" (not part of this methodology), or
 * - it asks to assign artifact owners/due dates while owners are still deferred to
 *   the not-yet-started Mobilise phase, or
 * - it flags an already-approved artifact as unapproved / still in draft.
 */
function isPhantomPlanItem(
  text: string,
  approved: { ids: Set<string>; titles: string[] },
  ownersDeferred: boolean,
): boolean {
  const t = text.toLowerCase();
  if (RAID_EXIT_CRITERIA.test(t)) return true;
  if (ownersDeferred && PLAN_OWNER_ASSIGNMENT.test(t)) return true;
  if (RAID_APPROVAL_NEGATION.test(t) && approved.titles.some((title) => t.includes(title))) return true;
  return false;
}

/**
 * Normalize a raw deliveryPlan object (now produced by the strategic-roadmap
 * agent) into the stored shape consumers expect: sanitised actions, milestones,
 * blockers, and critical path with drill-down references and safe defaults.
 * Provably-phantom actions/blockers (exit criteria, premature owner assignment,
 * already-approved artifacts) are dropped so the Action Center / daily briefing
 * stop surfacing them.
 */
function normalizeDeliveryPlan(p: Record<string, unknown>, programData?: ProgramState): JsonValue {
  const approved = programData ? buildApprovedArtifactIndex(programData) : { ids: new Set<string>(), titles: [] };
  const ownersDeferred = programData ? isPhaseNotStarted(programData, "mobilise") : false;
  return {
    summary: typeof p.summary === "string" ? p.summary : "",
    criticalPath: Array.isArray(p.criticalPath) ? p.criticalPath.filter((v): v is string => typeof v === "string") : [],
    nextThreeActions: Array.isArray(p.nextThreeActions) ? p.nextThreeActions.filter(isRecord).map((a, i) => ({
      action: typeof a.action === "string" ? a.action : `Action ${i + 1}`,
      phase: typeof a.phase === "string" ? a.phase : "",
      owner: typeof a.owner === "string" ? a.owner : null,
      rationale: typeof a.rationale === "string" ? a.rationale : "",
      // Drill-down references to the artifact/inputs that drove this action.
      relatedArtifactId: typeof a.relatedArtifactId === "string" && a.relatedArtifactId ? a.relatedArtifactId : null,
      relatedInputIds: Array.isArray(a.relatedInputIds) ? a.relatedInputIds.filter((id): id is string => typeof id === "string" && !!id) : [],
    })).filter((a) => !isPhantomPlanItem(`${a.action} ${a.rationale}`, approved, ownersDeferred)) : [],
    milestones: Array.isArray(p.milestones) ? p.milestones.filter(isRecord).map((m) => ({
      id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
      title: typeof m.title === "string" ? m.title : "",
      phase: typeof m.phase === "string" ? m.phase : "",
      dueDate: typeof m.dueDate === "string" ? m.dueDate : null,
      status: ["on-track", "at-risk", "delayed", "complete"].includes(String(m.status)) ? m.status : "on-track",
      owner: typeof m.owner === "string" ? m.owner : null,
    })) : [],
    blockerSummary: Array.isArray(p.blockerSummary) ? p.blockerSummary.filter(isRecord).map((b) => ({
      blocker: typeof b.blocker === "string" ? b.blocker : "",
      phase: typeof b.phase === "string" ? b.phase : "",
      severity: ["critical", "high", "medium", "low"].includes(String(b.severity)) ? b.severity : "medium",
      resolution: typeof b.resolution === "string" ? b.resolution : null,
      relatedArtifactId: typeof b.relatedArtifactId === "string" && b.relatedArtifactId ? b.relatedArtifactId : null,
      relatedInputIds: Array.isArray(b.relatedInputIds) ? b.relatedInputIds.filter((id): id is string => typeof id === "string" && !!id) : [],
    })).filter((b) => !isPhantomPlanItem(`${b.blocker} ${b.resolution ?? ""}`, approved, ownersDeferred)) : [],
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
  } as JsonValue;
}

/** Collapse a RAID title to a stable dedupe key (lowercased, whitespace-normalized). */
function normalizeRaidTitle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

// The model intermittently emits RAID findings that contradict the program's
// actual state — most often claiming an already-approved artifact is unapproved
// / still in draft, or flagging the absence of "phase exit criteria" (a concept
// this methodology does not use). Prompt rules alone don't reliably suppress
// these, so we drop provably-false entries deterministically before persisting.
const RAID_APPROVAL_NEGATION =
  /\bnot\s+(been\s+)?(yet\s+)?(formally\s+)?(approved|baselined|signed[\s-]?off|finalized|finalised)\b|\bunapproved\b|\b(only|still)\s+in\s+draft\b|\bin\s+draft\s+state\b|\bdraft\s+state\b|\bpending\s+(sign[\s-]?off|approval)\b|\bawaiting\s+(approval|sign[\s-]?off)\b/i;
const RAID_EXIT_CRITERIA = /\b(phase\s+)?exit\s+criteria\b|\bexit\s+gate/i;

// The model also emits "there are no timelines / no owners" findings that are
// provably false when those inputs are actually populated: the programme window
// lives on the Strategy phase inputs (startDate/targetEndDate, from which every
// phase's roadmap dates are derived) and named owners live on the Mobilise core
// team roster. The "no X defined" phrasing slips past RAID_APPROVAL_NEGATION, so
// we detect absence-claims directly and suppress them when the input exists.
const ABSENCE_NEG = "(?:no|not|none|missing|lack(?:s|ing)?|absence|without|never|undefined|absent|isn'?t|aren'?t|hasn'?t|haven'?t)";
const ABSENCE_DEF_VERB =
  "(?:defined|established|set|provided|identified|assigned|specified|documented|baselined|in\\s+place|exist|present|available|captured)";
const TIMELINE_NOUN =
  "(?:estimated\\s+)?(?:timelines?|milestones?|target\\s+dates?|delivery\\s+dates?|schedules?|start\\s+and\\s+end\\s+dates?)";
const OWNER_NOUN = "(?:owners?|accountable\\s+(?:owners?|parties)|raci(?:\\s+matrix)?)";
const OBJECTIVE_NOUN =
  "(?:(?:program(?:me)?|business|strategic|transformation)\\s+)?(?:objectives?|goals?|vision|mandate)";
const KPI_NOUN =
  "(?:kpis?|key\\s+(?:health\\s+)?(?:indicators?|metrics?)|health\\s+indicators?|success\\s+(?:metrics?|criteria)|target\\s+(?:metrics?|outcomes?)|measures\\s+of\\s+success)";

/** True when `text` asserts the absence/undefined-ness of `nounSource`. */
function claimsMissing(text: string, nounSource: string, allowBare: boolean): boolean {
  const fill = "[\\w\\s,/'\"()-]";
  // "no <noun> ... defined"  /  "<noun> ... not defined"
  const negThenNoun = new RegExp(`\\b${ABSENCE_NEG}\\b${fill}{0,60}?\\b${nounSource}\\b${fill}{0,40}?\\b${ABSENCE_DEF_VERB}\\b`, "i");
  const nounThenNeg = new RegExp(`\\b${nounSource}\\b${fill}{0,40}?\\b${ABSENCE_NEG}\\b${fill}{0,25}?\\b${ABSENCE_DEF_VERB}\\b`, "i");
  if (negThenNoun.test(text) || nounThenNeg.test(text)) return true;
  // Unambiguous bare absence ("no owners or due dates") — strong tokens only, tight window.
  if (allowBare) {
    const bare = new RegExp(`\\b(?:no|missing|without|lack of|absence of)\\s+(?:\\w+\\s+){0,2}?${nounSource}\\b`, "i");
    if (bare.test(text)) return true;
  }
  return false;
}

/** Roster row carries a non-empty value in a name-like column. */
function rosterHasNamedOwner(rows: Array<Record<string, unknown>>): boolean {
  return rows.some((row) => {
    const nameKey = Object.keys(row).find((k) => /name/i.test(k));
    const value = nameKey ? row[nameKey] : null;
    return typeof value === "string" && value.trim().length > 0;
  });
}

/** A string input that carries real content (a few words, not a placeholder). */
function inputHasContent(value: unknown, minLen = 12): boolean {
  return typeof value === "string" && value.trim().length >= minLen;
}

/** A KPI grid (array or JSON-encoded array) with at least one populated row. */
function kpiGridHasEntries(value: unknown): boolean {
  const arr = typeof value === "string" ? safeJsonParse<unknown>(value, null) : value;
  return Array.isArray(arr) && arr.filter(isRecord).some((row) =>
    Object.values(row).some((v) => typeof v === "string" && v.trim().length > 0),
  );
}

interface PlanGrounding {
  hasTimeline: boolean;
  hasOwners: boolean;
  hasObjective: boolean;
  hasKpis: boolean;
}

/**
 * Which "absence" claims are provably false for this programme. Each flag is
 * read from the Strategy/Mobilise phase inputs (the source of truth the model's
 * context is built from), so a finding claiming the thing is missing contradicts
 * captured state: the timeline window and objective/KPIs live on Strategy inputs;
 * named owners live on the Mobilise core-team roster.
 */
function buildPlanGroundingIndex(programData: ProgramState): PlanGrounding {
  const inner = getInnerProgramData(programData);
  const phaseInputsAll = normalizeProgramData(inner.phaseInputs as JsonValue | null);
  const strategyInputs = normalizeProgramData(phaseInputsAll.strategy as JsonValue | null);
  const start = strategyInputs.startDate;
  const end = strategyInputs.targetEndDate ?? strategyInputs.endDate;
  const hasTimeline =
    typeof start === "string" && !!start.trim() && typeof end === "string" && !!end.trim();
  const mobiliseInputs = normalizeProgramData(phaseInputsAll.mobilise as JsonValue | null);
  const hasOwners = rosterHasNamedOwner(resolveRosterRows(mobiliseInputs));
  const hasObjective =
    inputHasContent(strategyInputs.businessObjective) ||
    inputHasContent(strategyInputs.objective) ||
    inputHasContent(strategyInputs.vision);
  const hasKpis =
    kpiGridHasEntries(strategyInputs.kpis) ||
    inputHasContent(strategyInputs.successMetric) ||
    inputHasContent(strategyInputs.successMetrics) ||
    inputHasContent(strategyInputs.healthIndicators);
  return { hasTimeline, hasOwners, hasObjective, hasKpis };
}

function buildApprovedArtifactIndex(programData: ProgramState): { ids: Set<string>; titles: string[] } {
  const ids = new Set<string>();
  const titles: string[] = [];
  for (const artifact of getProgramArtifactContext(programData)) {
    if (artifact.status !== "approved") continue;
    if (typeof artifact.id === "string" && artifact.id) ids.add(artifact.id);
    if (typeof artifact.title === "string" && artifact.title.trim().length >= 5) {
      titles.push(artifact.title.trim().toLowerCase());
    }
    // The delivery plan + milestones are no longer standalone artifacts — they
    // are folded into the strategic roadmap (strategicRoadmap.deliveryPlan /
    // .milestones). So when the roadmap is approved, treat those folded
    // sub-objects as approved too, otherwise the negation filter below can't
    // recognise a "delivery plan / milestones not baselined" claim as stale.
    if (artifact.id === "strategic-roadmap") {
      ids.add("plan");
      ids.add("milestone");
      titles.push("delivery plan", "milestones");
    }
  }
  return { ids, titles };
}

/**
 * True when a RAID entry provably contradicts current program state:
 * - it asserts an approved artifact is unapproved / still in draft, or
 * - its core issue is the absence of phase exit criteria (not part of this methodology).
 */
function isProvablyStaleRiskEntry(
  entry: Record<string, unknown>,
  approved: { ids: Set<string>; titles: string[] },
  grounding: PlanGrounding,
): boolean {
  const text = `${typeof entry.title === "string" ? entry.title : ""} ${typeof entry.description === "string" ? entry.description : ""}`.toLowerCase();
  if (RAID_EXIT_CRITERIA.test(text)) return true;
  // Absence claims that contradict populated Strategy/Mobilise inputs.
  if (grounding.hasTimeline && claimsMissing(text, TIMELINE_NOUN, false)) return true;
  if (grounding.hasOwners && claimsMissing(text, OWNER_NOUN, true)) return true;
  if (grounding.hasObjective && claimsMissing(text, OBJECTIVE_NOUN, true)) return true;
  if (grounding.hasKpis && claimsMissing(text, KPI_NOUN, true)) return true;
  if (!RAID_APPROVAL_NEGATION.test(text)) return false;
  const rel = typeof entry.relatedArtifactId === "string" ? entry.relatedArtifactId : "";
  if (rel && approved.ids.has(rel)) return true;
  return approved.titles.some((title) => text.includes(title));
}

function applyRiskResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
    const existingEntries = Array.isArray(raidLog.entries)
      ? raidLog.entries.filter(isRecord)
      : [];
    const humanEntries = existingEntries.filter((entry) => entry.source === "human");
    // Capacity-gap risks are owned by the capacity-assessor agent, not the risk
    // agent. Preserve them here so a risk regeneration can't silently drop them.
    const capacityEntries = existingEntries.filter(
      (entry) => entry.source !== "human" && typeof entry.id === "string" && entry.id.startsWith("capacity-gap-"),
    );
    // The capacity-assessor owns one capacity-shortfall risk per phase (its
    // capacity-gap-${phase} entry). The risk agent, unaware of that, sometimes
    // restates the same gap (e.g. "Team capacity shortfall in Change Management
    // Lead role") for a phase already covered — which then lists the same risk
    // twice. Index the covered phases + canonical titles so we can drop the
    // overlapping agent restatement below.
    const capacityPhases = new Set(
      capacityEntries.map((entry) => (typeof entry.phase === "string" ? entry.phase : "")).filter(Boolean),
    );
    const capacityTitleKeys = capacityEntries
      .map((entry) => normalizeRaidTitle(entry.title))
      .filter(Boolean);
    const overlapsCapacityEntry = (entry: Record<string, unknown>): boolean => {
      const phase = typeof entry.phase === "string" ? entry.phase : "";
      if (!capacityPhases.has(phase)) return false;
      const key = normalizeRaidTitle(entry.title);
      if (!key) return false;
      return capacityTitleKeys.some((capKey) => key.includes(capKey) || capKey.includes(key));
    };

    // Reconcile-don't-replace: index prior agent entries so regenerated risks can
    // inherit any human triage (resolve / reopen / validate) applied to the same
    // finding. Match on id first, then on normalized title.
    const priorAgentEntries = existingEntries.filter(
      (entry) => entry.source !== "human" && !(typeof entry.id === "string" && entry.id.startsWith("capacity-gap-")),
    );
    const priorById = new Map<string, Record<string, unknown>>();
    const priorByTitle = new Map<string, Record<string, unknown>>();
    for (const entry of priorAgentEntries) {
      if (typeof entry.id === "string" && entry.id) priorById.set(entry.id, entry);
      const key = normalizeRaidTitle(entry.title);
      if (key && !priorByTitle.has(key)) priorByTitle.set(key, entry);
    }

    const approvedArtifacts = buildApprovedArtifactIndex(programData);
    const planGrounding = buildPlanGroundingIndex(programData);
    const agentEntries = Array.isArray(result.raidEntries)
      ? result.raidEntries
          .filter(isRecord)
          .filter((entry) => !isProvablyStaleRiskEntry(entry, approvedArtifacts, planGrounding))
          .filter((entry) => !overlapsCapacityEntry(entry))
          .map((entry, index) => {
            const type = typeof entry.type === "string" ? entry.type : "risk";
            const severity = typeof entry.severity === "string" ? entry.severity : "medium";
            const agentConfidence = typeof entry.agentConfidence === "number" ? entry.agentConfidence : null;
            const id = typeof entry.id === "string" && entry.id
              ? entry.id
              : crypto.randomUUID?.() || `raid-agent-${Date.now()}-${index}`;
            const title = typeof entry.title === "string" ? entry.title.slice(0, 80) : `Risk ${index + 1}`;
            const prior = priorById.get(id) ?? priorByTitle.get(normalizeRaidTitle(title));
            const humanTriaged = !!prior && (
              prior.closedBy === "human"
              || (typeof prior.status === "string" && prior.status !== "open")
              || (typeof prior.validatedAt === "string" && !!prior.validatedAt)
            );
            return {
              id,
              type: ["risk", "blocker", "assumption", "dependency"].includes(type) ? type : "risk",
              title,
              description: typeof entry.description === "string" ? entry.description : "",
              severity: ["critical", "high", "medium", "low"].includes(severity) ? severity : "medium",
              phase: typeof entry.phase === "string" && entry.phase ? entry.phase : "strategy",
              owner: typeof entry.owner === "string" && entry.owner ? entry.owner : null,
              mitigation: typeof entry.mitigation === "string" && entry.mitigation ? entry.mitigation : null,
              status: humanTriaged && typeof prior!.status === "string" ? prior!.status : "open",
              source: "agent",
              // Drill-down references: which artifact/inputs this finding traces to,
              // so the UI can link the entry straight to the relevant document/field.
              relatedArtifactId: typeof entry.relatedArtifactId === "string" && entry.relatedArtifactId ? entry.relatedArtifactId : null,
              relatedInputIds: Array.isArray(entry.relatedInputIds)
                ? entry.relatedInputIds.filter((id): id is string => typeof id === "string" && !!id)
                : [],
              agentConfidence,
              createdAt: typeof entry.createdAt === "string"
                ? entry.createdAt
                : (humanTriaged && typeof prior!.createdAt === "string" ? prior!.createdAt : new Date().toISOString()),
              closedAt: humanTriaged ? (prior!.closedAt ?? null) : null,
              closedBy: humanTriaged ? (prior!.closedBy ?? null) : null,
              closureNote: humanTriaged ? (prior!.closureNote ?? null) : null,
              ...(humanTriaged && typeof prior!.validatedAt === "string" && prior!.validatedAt
                ? { validatedAt: prior!.validatedAt }
                : {}),
            } as JsonValue;
          })
      : priorAgentEntries;

    return {
      ...inner,
      raidLog: {
        ...raidLog,
        entries: [...humanEntries, ...capacityEntries, ...agentEntries] as JsonValue,
        generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString(),
        riskSummary: typeof result.summary === "string" ? result.summary : (raidLog.riskSummary ?? null),
        confidence: typeof result.confidence === "number" ? result.confidence : (raidLog.confidence ?? null),
      },
    };
  });
}

/**
 * Capacity gaps become a real risk. When the capacity assessor reports the team
 * is insufficient / at-risk (or any role gap is critical), upsert a single
 * agent-sourced RAID risk keyed per phase so re-runs replace rather than pile up.
 * When capacity recovers to sufficient, any prior capacity risk is cleared.
 */
function applyCapacityRiskToProgramData(
  programData: ProgramState,
  phaseId: string,
  result: Record<string, unknown>,
): ProgramState {
  const adequacy = typeof result.overallAdequacy === "string" ? result.overallAdequacy : "";
  const roleGaps = Array.isArray(result.roleGaps) ? result.roleGaps.filter(isRecord) : [];
  const criticalGaps = roleGaps.filter((gap) => gap.criticality === "critical");
  const insufficient = adequacy === "insufficient" || adequacy === "at-risk" || criticalGaps.length > 0;
  const entryId = `capacity-gap-${phaseId}`;

  return updateInnerProgramData(programData, (inner) => {
    const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
    const entries = Array.isArray(raidLog.entries) ? raidLog.entries.filter(isRecord) : [];
    const withoutCapacity = entries.filter((entry) => entry.id !== entryId);

    if (!insufficient) {
      // Capacity is adequate — drop any prior capacity risk.
      if (withoutCapacity.length === entries.length) return inner;
      return { ...inner, raidLog: { ...raidLog, entries: withoutCapacity as JsonValue } };
    }

    const prior = entries.find((entry) => entry.id === entryId);
    const gapNames = (criticalGaps.length ? criticalGaps : roleGaps)
      .map((gap) => (typeof gap.role === "string" ? gap.role : ""))
      .filter(Boolean)
      .slice(0, 4);
    const severity = adequacy === "insufficient" || criticalGaps.length > 0 ? "high" : "medium";
    const description = gapNames.length
      ? `Capacity assessment is ${adequacy || "at-risk"}: shortfall in ${gapNames.join(", ")}. Resourcing must be closed before the delivery load lands.`
      : `Capacity assessment is ${adequacy || "at-risk"} for this phase. Resourcing must be closed before the delivery load lands.`;
    const recommendations = Array.isArray(result.recommendations)
      ? result.recommendations.filter((r): r is string => typeof r === "string" && !!r)
      : [];

    const capacityEntry = {
      id: entryId,
      type: "risk",
      title: "Team capacity shortfall",
      description,
      severity,
      phase: phaseId,
      owner: null,
      mitigation: recommendations[0] ?? "Confirm the hiring / backfill plan and lead times for the gapped roles.",
      status: prior && typeof prior.status === "string" && prior.status !== "open" ? prior.status : "open",
      source: "agent",
      relatedArtifactId: "capacity-assessor",
      relatedInputIds: ["coreTeamRoster"],
      agentConfidence: typeof result.adequacyScore === "number" ? Math.max(0, Math.min(1, result.adequacyScore / 100)) : null,
      createdAt: prior && typeof prior.createdAt === "string" ? prior.createdAt : new Date().toISOString(),
      closedAt: null,
      closedBy: null,
      closureNote: null,
    } as JsonValue;

    return { ...inner, raidLog: { ...raidLog, entries: [...withoutCapacity, capacityEntry] as JsonValue } };
  });
}

function applyMilestoneResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const roadmap = getStrategicRoadmapContainer(inner);
    // Tracked milestones are folded into the Strategic Roadmap; fall back to the
    // legacy top-level array for programs last written before the fold.
    const milestoneSource = Array.isArray(roadmap.milestones)
      ? roadmap.milestones
      : Array.isArray(inner.milestones)
        ? inner.milestones
        : [];
    const existingMilestones = milestoneSource.filter(isRecord);
    const humanMilestones = existingMilestones.filter((entry) => entry.source === "human");
    const agentMilestones = Array.isArray(result.milestones)
      ? result.milestones
          .filter(isRecord)
          .map((entry, index) => {
            const status = typeof entry.status === "string" ? entry.status : "on-track";
            const confidence = typeof entry.confidence === "number" ? Math.max(0, Math.min(1, entry.confidence)) : 0.65;
            return {
              id: typeof entry.id === "string" && entry.id
                ? entry.id
                : `m_${typeof entry.phaseId === "string" ? entry.phaseId : "program"}_${index + 1}`,
              title: typeof entry.title === "string" ? entry.title : `Milestone ${index + 1}`,
              phaseId: typeof entry.phaseId === "string" && entry.phaseId ? entry.phaseId : "strategy",
              targetDate: typeof entry.targetDate === "string" && entry.targetDate ? entry.targetDate : null,
              status: ["on-track", "at-risk", "delayed", "complete"].includes(status) ? status : "on-track",
              dependsOn: Array.isArray(entry.dependsOn)
                ? entry.dependsOn.filter((value): value is string => typeof value === "string")
                : [],
              exitCriteria: Array.isArray(entry.exitCriteria)
                ? entry.exitCriteria.filter((value): value is string => typeof value === "string")
                : [],
              confidence,
              source: "agent",
              lastUpdatedAt: typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt : new Date().toISOString(),
            } as JsonValue;
          })
      : [];

    const agentIds = new Set(agentMilestones.map((m) => (m as Record<string, unknown>).id as string));
    const dedupedHuman = humanMilestones.filter((m) => !agentIds.has((m as Record<string, unknown>).id as string));

    return {
      ...inner,
      strategicRoadmap: {
        ...roadmap,
        milestones: [...dedupedHuman, ...agentMilestones] as JsonValue,
      } as JsonValue,
      milestonesGeneratedAt: new Date().toISOString(),
    };
  });
}

function applyBudgetResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    if (!isRecord(result)) return { ...inner, budgetTracking: null, budgetGeneratedAt: new Date().toISOString() };
    const validBurnRate = ["healthy", "at-risk", "overspend"].includes(String(result.burnRate));
    const validValueDelivery = ["ahead", "on-track", "behind"].includes(String(result.valueDeliveryRate));
    const validSignal = ["green", "amber", "red"].includes(String(result.healthSignal));
    const normalized = {
      projectedCost: typeof result.projectedCost === "number" ? result.projectedCost : null,
      actualSpend: typeof result.actualSpend === "number" ? result.actualSpend : null,
      projectedBenefits: typeof result.projectedBenefits === "number" ? result.projectedBenefits : null,
      realisedBenefits: typeof result.realisedBenefits === "number" ? result.realisedBenefits : null,
      roi: typeof result.roi === "number" ? result.roi : null,
      burnRate: validBurnRate ? result.burnRate : "at-risk",
      valueDeliveryRate: validValueDelivery ? result.valueDeliveryRate : "on-track",
      phaseSpend: Array.isArray(result.phaseSpend) ? result.phaseSpend.filter(isRecord) : [],
      benefitMilestones: Array.isArray(result.benefitMilestones) ? result.benefitMilestones.filter(isRecord) : [],
      healthSignal: validSignal ? result.healthSignal : "amber",
      healthReason: typeof result.healthReason === "string" ? result.healthReason : "",
      confidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
    };
    return { ...inner, budgetTracking: normalized as JsonValue, budgetGeneratedAt: new Date().toISOString() };
  });
}

function applyCriticalPathResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const roadmap = getStrategicRoadmapContainer(inner);
    const plan = isRecord(roadmap.deliveryPlan) ? roadmap.deliveryPlan as Record<string, JsonValue> : null;
    const sequence = isRecord(result) && Array.isArray(result.sequence)
      ? result.sequence.filter(isRecord).map((entry) => ({
          phaseId: typeof entry.phaseId === "string" ? entry.phaseId : "",
          phaseName: typeof entry.phaseName === "string" ? entry.phaseName : "",
          status: ["complete", "in-progress", "blocked", "not-started"].includes(String(entry.status))
            ? entry.status
            : "not-started",
          isBottleneck: entry.isBottleneck === true,
          blockerSummary: typeof entry.blockerSummary === "string" ? entry.blockerSummary : null,
          dependsOn: Array.isArray(entry.dependsOn) ? entry.dependsOn.filter((d) => typeof d === "string") : [],
        })).filter((n) => n.phaseId)
      : [];
    const sequenceIds = sequence.map((n) => n.phaseId);

    const criticalPathData = isRecord(result) ? {
      sequence,
      currentBottleneck: isRecord(result.currentBottleneck) ? {
        phaseId: typeof result.currentBottleneck.phaseId === "string" ? result.currentBottleneck.phaseId : "",
        phaseName: typeof result.currentBottleneck.phaseName === "string" ? result.currentBottleneck.phaseName : "",
        blockerSummary: typeof result.currentBottleneck.blockerSummary === "string" ? result.currentBottleneck.blockerSummary : null,
      } : null,
      offCriticalPath: Array.isArray(result.offCriticalPath)
        ? result.offCriticalPath.filter((v): v is string => typeof v === "string")
        : [],
      estimatedCompletionDelta: typeof result.estimatedCompletionDelta === "string" ? result.estimatedCompletionDelta : null,
      confidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
    } : null;

    return {
      ...inner,
      criticalPath: criticalPathData as JsonValue,
      criticalPathGeneratedAt: new Date().toISOString(),
      strategicRoadmap: plan
        ? {
            ...roadmap,
            deliveryPlan: {
              ...plan,
              criticalPath: sequenceIds as JsonValue,
            } as JsonValue,
          } as JsonValue
        : inner.strategicRoadmap,
    };
  });
}

function buildEscalationKey(entry: {
  type?: unknown;
  linkedDecisionId?: unknown;
  linkedPhaseId?: unknown;
  linkedRiskId?: unknown;
}): string {
  return [
    typeof entry.type === "string" ? entry.type : "unknown",
    typeof entry.linkedDecisionId === "string" && entry.linkedDecisionId ? entry.linkedDecisionId : "",
    typeof entry.linkedPhaseId === "string" && entry.linkedPhaseId ? entry.linkedPhaseId : "",
    typeof entry.linkedRiskId === "string" && entry.linkedRiskId ? entry.linkedRiskId : "",
  ].join("|");
}

function getPhaseArtifactContext(programData: ProgramState, phaseId: string): Array<Record<string, unknown>> {
  return getProgramArtifactContext(programData).filter((artifact) => artifact.phaseId === phaseId);
}

// Phase statuses that mean "hasn't begun yet". A phase can only legitimately
// stall once it is in progress; flagging a future, not-yet-started phase as
// "stalled / no progress" is a false positive that never self-clears.
const NOT_STARTED_PHASE_STATUS = new Set([
  "inactive", "not-started", "notstarted", "not_started", "upcoming",
  "pending", "planned", "todo", "queued", "",
]);

function isPhaseNotStarted(programData: ProgramState, phaseId: string): boolean {
  const phase = getProgramPhaseContext(programData).find((p) => p.id === phaseId);
  if (!phase) return false;
  const status = (typeof phase.status === "string" ? phase.status : "").trim().toLowerCase();
  return NOT_STARTED_PHASE_STATUS.has(status);
}

/**
 * True when an escalation provably contradicts current program state — the same
 * failure mode the RAID filter guards against, since escalations are raised off
 * the same risk/decision signals:
 * - it asserts an approved artifact is unapproved / still in draft, or
 * - its core issue is the absence of phase exit criteria (not part of this methodology), or
 * - it claims a timeline/owner/objective/KPI is missing that the inputs populate, or
 * - it flags a phase as "stalled" when that phase actually carries artifacts
 *   (the escalation agent's own rule: a phase with artifacts is progressing), or
 * - it flags a not-yet-started (inactive/upcoming) phase as "stalled" — a phase
 *   can only stall once it is in progress, so future phases are never stalled.
 */
function isProvablyStaleEscalation(
  entry: Record<string, unknown>,
  approved: { ids: Set<string>; titles: string[] },
  grounding: PlanGrounding,
  programData: ProgramState,
): boolean {
  const text = `${typeof entry.title === "string" ? entry.title : ""} ${typeof entry.summary === "string" ? entry.summary : ""}`.toLowerCase();
  if (RAID_EXIT_CRITERIA.test(text)) return true;
  if (RAID_APPROVAL_NEGATION.test(text) && approved.titles.some((title) => text.includes(title))) return true;
  // Same absence-claim guards the RAID filter applies — escalations are raised
  // off the same risk signals, so a phantom "no objectives/timelines/owners"
  // would otherwise re-raise (and never auto-resolve) on every escalation run.
  if (grounding.hasTimeline && claimsMissing(text, TIMELINE_NOUN, false)) return true;
  if (grounding.hasOwners && claimsMissing(text, OWNER_NOUN, true)) return true;
  if (grounding.hasObjective && claimsMissing(text, OBJECTIVE_NOUN, true)) return true;
  if (grounding.hasKpis && claimsMissing(text, KPI_NOUN, true)) return true;
  const type = typeof entry.type === "string" ? entry.type : "";
  const phaseId = typeof entry.linkedPhaseId === "string" ? entry.linkedPhaseId : "";
  if (type === "phase-stalled" && phaseId && getPhaseArtifactContext(programData, phaseId).length > 0) return true;
  if (type === "phase-stalled" && phaseId && isPhaseNotStarted(programData, phaseId)) return true;
  return false;
}

function applyEscalationResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existingEscalations = Array.isArray(inner.escalations) ? inner.escalations.filter(isRecord) : [];
    const openEscalations = existingEscalations.filter((entry) => entry.status === "open" || entry.status === "acknowledged");
    const existingKeys = new Set(openEscalations.map((entry) => buildEscalationKey(entry)));
    const approvedArtifacts = buildApprovedArtifactIndex(programData);
    const planGrounding = buildPlanGroundingIndex(programData);
    const additions = isRecord(result) && Array.isArray(result.escalations)
      ? result.escalations
          .filter(isRecord)
          .filter((entry) => !existingKeys.has(buildEscalationKey(entry)))
          .filter((entry) => !isProvablyStaleEscalation(entry, approvedArtifacts, planGrounding, programData))
          .map((entry) => ({
            id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
            type: typeof entry.type === "string" ? entry.type : "critical-blocker",
            severity: typeof entry.severity === "string" && ["high", "critical"].includes(entry.severity)
              ? entry.severity
              : "high",
            title: typeof entry.title === "string" ? entry.title : "Escalation raised",
            summary: typeof entry.summary === "string" ? entry.summary : "",
            costOfDelay: typeof entry.costOfDelay === "string" ? entry.costOfDelay : "",
            linkedDecisionId: typeof entry.linkedDecisionId === "string" ? entry.linkedDecisionId : null,
            linkedPhaseId: typeof entry.linkedPhaseId === "string" ? entry.linkedPhaseId : null,
            linkedRiskId: typeof entry.linkedRiskId === "string" ? entry.linkedRiskId : null,
            raisedAt: typeof entry.raisedAt === "string" ? entry.raisedAt : new Date().toISOString(),
            acknowledgedAt: null,
            resolvedAt: null,
            status: "open",
            source: "agent",
          }))
      : [];

    // Auto-resolve open/acknowledged escalations the agent reports as cleared,
    // so a stale "artifacts in draft" / "no milestones" / "phase stalled" entry
    // closes once its condition no longer holds instead of lingering forever.
    const resolvedIds = new Set(
      isRecord(result) && Array.isArray(result.resolvedEscalationIds)
        ? result.resolvedEscalationIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const nowIso = new Date().toISOString();
    const reconciled = existingEscalations.map((entry) => {
      const id = typeof entry.id === "string" ? entry.id : "";
      const isOpen = entry.status === "open" || entry.status === "acknowledged";
      // Auto-resolve entries the agent reported as cleared, plus any that
      // provably contradict current state (e.g. an approved artifact flagged as
      // unapproved) so stale escalations close instead of lingering forever.
      if (isOpen && (resolvedIds.has(id) || isProvablyStaleEscalation(entry, approvedArtifacts, planGrounding, programData))) {
        return { ...entry, status: "resolved", resolvedAt: nowIso };
      }
      return entry;
    });

    return {
      ...inner,
      escalations: [...reconciled, ...additions] as JsonValue,
      escalationsLastCheckedAt: nowIso,
    };
  });
}

function applyClosureResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existingClosure = normalizeProgramData(inner.closure as JsonValue | null);
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    const existingDecisionId = typeof existingClosure.closureDecisionId === "string" ? existingClosure.closureDecisionId : null;

    if (!isRecord(result)) {
      return {
        ...inner,
        closure: {
          ...existingClosure,
          status: "not-ready",
          notReadyReason: "Insufficient program data to assess closure readiness.",
          generatedAt: new Date().toISOString(),
        } as JsonValue,
        closureGeneratedAt: new Date().toISOString(),
      };
    }

    const rawStatus = typeof result.status === "string" && ["ready", "not-ready"].includes(result.status)
      ? result.status
      : "not-ready";
    const finalStatus = existingClosure.status === "approved" || existingClosure.status === "archived"
      ? existingClosure.status
      : rawStatus;

    let closureDecisionId = existingDecisionId;
    let nextQueue = queue;
    if (finalStatus === "ready" && !existingDecisionId) {
      closureDecisionId = `dec_closure_${Date.now()}`;
      nextQueue = [
        ...queue,
        {
          id: closureDecisionId,
          type: "program-closure",
          title: "Program ready to close",
          priority: "high",
          phaseId: "program",
          question: "Program is ready to close. Approve closure and archive?",
          recommendation: "All phases are at or above 90% readiness. Review the closure pack and approve the final archive decision.",
          options: ["Approve closure", "Hold for remediation"],
          createdAt: new Date().toISOString(),
          status: "pending",
        },
      ];
    }
    if (finalStatus === "not-ready") {
      nextQueue = queue.filter((decision) => String(decision.id || "") !== String(existingDecisionId || ""));
      closureDecisionId = null;
    }

    return {
      ...inner,
      closure: {
        status: finalStatus,
        readinessScore: typeof result.readinessScore === "number" ? Math.max(0, Math.min(1, Number(result.readinessScore))) : 0,
        notReadyReason: typeof result.notReadyReason === "string"
          ? result.notReadyReason
          : typeof result.reason === "string"
            ? result.reason
            : undefined,
        benefitsSummary: isRecord(result.benefitsSummary) ? {
          delivered: typeof (result.benefitsSummary as Record<string, unknown>).delivered === "string"
            ? (result.benefitsSummary as Record<string, unknown>).delivered : null,
          roi: typeof (result.benefitsSummary as Record<string, unknown>).roi === "number"
            ? (result.benefitsSummary as Record<string, unknown>).roi : null,
          qualitative: typeof (result.benefitsSummary as Record<string, unknown>).qualitative === "string"
            ? (result.benefitsSummary as Record<string, unknown>).qualitative : null,
        } as JsonValue : null,
        lessonsLearned: Array.isArray(result.lessonsLearned)
          ? result.lessonsLearned.filter(isRecord).map((l) => ({
              category: typeof l.category === "string" ? l.category : "general",
              lesson: typeof l.lesson === "string" ? l.lesson : "",
              recommendation: typeof l.recommendation === "string" ? l.recommendation : null,
            })) as JsonValue
          : [],
        keyArtifacts: Array.isArray(result.keyArtifacts)
          ? result.keyArtifacts.filter(isRecord).map((a) => ({
              name: typeof a.name === "string" ? a.name : "Unnamed",
              phaseId: typeof a.phaseId === "string" ? a.phaseId : null,
              location: typeof a.location === "string" ? a.location : null,
            })) as JsonValue
          : [],
        recommendations: Array.isArray(result.recommendations)
          ? result.recommendations.filter((v): v is string => typeof v === "string") as JsonValue
          : [],
        closureDecisionId,
        approvedAt: typeof existingClosure.approvedAt === "string" ? existingClosure.approvedAt : null,
        approvedBy: typeof existingClosure.approvedBy === "string" ? existingClosure.approvedBy : null,
        archivedAt: typeof existingClosure.archivedAt === "string" ? existingClosure.archivedAt : null,
        generatedAt: new Date().toISOString(),
        confidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, Number(result.confidence))) : 0,
      } as JsonValue,
      closureGeneratedAt: new Date().toISOString(),
      decisionQueue: nextQueue as JsonValue,
    };
  });
}

function applyChangeImpactResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    if (!isRecord(result)) {
      return {
        ...inner,
        changeImpact: null,
        changeImpactGeneratedAt: new Date().toISOString(),
      };
    }

    const impactedGroups = Array.isArray(result.impactedGroups)
      ? result.impactedGroups
          .filter(isRecord)
          .filter((entry) => typeof entry.group === "string" && entry.group.trim().length > 0)
          .map((entry) => ({
            group: String(entry.group).trim(),
            impactLevel: ["critical", "high", "medium", "low"].includes(String(entry.impactLevel))
              ? entry.impactLevel
              : "medium",
            changeType: ["process", "technology", "culture", "structural"].includes(String(entry.changeType))
              ? entry.changeType
              : "process",
            affectedHeadcount: entry.affectedHeadcount == null
              ? null
              : Math.max(0, Math.round(coerceNumber(entry.affectedHeadcount, 0))),
            readinessScore: clampNumber(entry.readinessScore, 0, 1, 0.5),
            interventions: uniqueStrings(entry.interventions, 5),
            owner: typeof entry.owner === "string" && entry.owner.trim() ? entry.owner.trim() : null,
          }))
      : [];

    return {
      ...inner,
      changeImpact: {
        impactedGroups,
        overallChangeLoad: ["high", "medium", "low"].includes(String(result.overallChangeLoad))
          ? result.overallChangeLoad
          : "medium",
        peakChangeWindow: typeof result.peakChangeWindow === "string" ? result.peakChangeWindow : "",
        resistanceRisk: ["high", "medium", "low"].includes(String(result.resistanceRisk))
          ? result.resistanceRisk
          : "medium",
        topInterventions: uniqueStrings(result.topInterventions, 5),
        confidence: clampNumber(result.confidence, 0, 1, 0.5),
        summary: truncateText(result.summary, 320),
      } as JsonValue,
      changeImpactGeneratedAt: new Date().toISOString(),
    };
  });
}

function applyStakeholderResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existingStakeholders = Array.isArray(inner.stakeholders) ? inner.stakeholders.filter(isRecord) : [];
    const humanStakeholders = existingStakeholders.filter((entry) => entry.source === "human");
    const normalizedAgentStakeholders = isRecord(result) && Array.isArray(result.stakeholders)
      ? result.stakeholders
          .filter(isRecord)
          .filter((entry) => typeof entry.id === "string" && entry.id.trim() && typeof entry.name === "string" && entry.name.trim())
          .map((entry) => ({
            id: String(entry.id).trim(),
            name: String(entry.name).trim(),
            role: typeof entry.role === "string" ? entry.role : "",
            organisation: typeof entry.organisation === "string" && entry.organisation.trim() ? entry.organisation.trim() : null,
            influence: ["high", "medium", "low"].includes(String(entry.influence)) ? entry.influence : "medium",
            interest: ["high", "medium", "low"].includes(String(entry.interest)) ? entry.interest : "medium",
            currentEngagement: ["champion", "supportive", "neutral", "resistant", "unknown"].includes(String(entry.currentEngagement))
              ? entry.currentEngagement
              : "unknown",
            targetEngagement: ["champion", "supportive", "neutral"].includes(String(entry.targetEngagement))
              ? entry.targetEngagement
              : "supportive",
            sentiment: ["positive", "neutral", "negative", "unknown"].includes(String(entry.sentiment))
              ? entry.sentiment
              : "unknown",
            riskOfDisengagement: ["high", "medium", "low"].includes(String(entry.riskOfDisengagement))
              ? entry.riskOfDisengagement
              : "medium",
            recommendedActions: uniqueStrings(entry.recommendedActions, 3),
            owner: typeof entry.owner === "string" && entry.owner.trim() ? entry.owner.trim() : null,
            source: "agent",
          }))
      : [];

    const humanById = new Map(humanStakeholders.map((entry) => [String(entry.id), entry]));
    const mergedStakeholders = [
      ...humanStakeholders.filter((entry) => !normalizedAgentStakeholders.some((agentEntry) => agentEntry.id === String(entry.id))),
      ...normalizedAgentStakeholders,
    ];

    return {
      ...inner,
      stakeholders: mergedStakeholders as JsonValue,
      stakeholderGeneratedAt: new Date().toISOString(),
      stakeholderSummary: isRecord(result)
        ? {
            engagementSummary: typeof result.engagementSummary === "string" ? result.engagementSummary : "",
            criticalRelationships: uniqueStrings(result.criticalRelationships, 6),
            confidence: clampNumber(result.confidence, 0, 1, 0.5),
            humanCount: humanById.size,
          } as JsonValue
        : inner.stakeholderSummary,
    };
  });
}

function applyAdoptionResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    if (!isRecord(result)) {
      return {
        ...inner,
        adoption: null,
        adoptionGeneratedAt: new Date().toISOString(),
      };
    }

    const adoptionGroups = Array.isArray(result.adoptionGroups)
      ? result.adoptionGroups
          .filter(isRecord)
          .filter((entry) => typeof entry.group === "string" && entry.group.trim().length > 0)
          .map((entry) => ({
            group: String(entry.group).trim(),
            adoptionRate: clampNumber(entry.adoptionRate, 0, 1, 0),
            trainingCompletion: clampNumber(entry.trainingCompletion, 0, 1, 0),
            toolUtilisation: clampNumber(entry.toolUtilisation, 0, 1, 0),
            readinessGap: ["high", "medium", "low", "none"].includes(String(entry.readinessGap))
              ? entry.readinessGap
              : "medium",
            barriers: uniqueStrings(entry.barriers, 5),
            recommendedInterventions: uniqueStrings(entry.recommendedInterventions, 3),
          }))
      : [];

    return {
      ...inner,
      adoption: {
        adoptionGroups,
        overallAdoptionRate: clampNumber(result.overallAdoptionRate, 0, 1, 0),
        adoptionTrend: ["improving", "stable", "declining", "unknown"].includes(String(result.adoptionTrend))
          ? result.adoptionTrend
          : "unknown",
        criticalAdoptionRisks: uniqueStrings(result.criticalAdoptionRisks, 6),
        goLiveReadiness: ["ready", "at-risk", "not-ready"].includes(String(result.goLiveReadiness))
          ? result.goLiveReadiness
          : "at-risk",
        confidence: clampNumber(result.confidence, 0, 1, 0.5),
        summary: truncateText(result.summary, 320),
      } as JsonValue,
      adoptionGeneratedAt: new Date().toISOString(),
    };
  });
}

function applyHealthHeatmapResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    if (!isRecord(result)) {
      return {
        ...inner,
        healthHeatmap: null,
        healthHeatmapGeneratedAt: new Date().toISOString(),
      };
    }

    // A passed stakeholder gate is authoritative: force approved/complete phases
    // green and drop any topRisk, so a model that still grades a gated phase red
    // (e.g. echoing a stale "no objectives" note) can't override the gate.
    const gateReviews = normalizeProgramData(inner.gateReviews as JsonValue | null);
    const gatedPhaseIds = new Set<string>();
    const notStartedPhaseIds = new Set<string>();
    for (const phase of getProgramPhaseContext(programData)) {
      const id = typeof phase.id === "string" ? phase.id : "";
      if (!id) continue;
      const gate = normalizeProgramData(gateReviews[id] as JsonValue | null);
      if (phase.status === "complete" || gate.status === "approved") gatedPhaseIds.add(id);
      else if (isPhaseNotStarted(programData, id)) notStartedPhaseIds.add(id);
    }

    const phaseHealth = Array.isArray(result.phaseHealth)
      ? result.phaseHealth
          .filter(isRecord)
          .filter((entry) => typeof entry.phaseId === "string" && entry.phaseId.trim().length > 0)
          .map((entry) => {
            const phaseId = String(entry.phaseId).trim();
            const isGated = gatedPhaseIds.has(phaseId);
            // A phase the programme hasn't reached yet can't be at risk or
            // blocked now: a model that grades a future phase red (e.g.
            // "Adoption Plan not approved" against an inactive Operate) presents
            // a future concern as a live one. Force it grey with no topRisk, the
            // same rule the gantt applies — gated wins if both somehow match.
            const isNotStarted = !isGated && notStartedPhaseIds.has(phaseId);
            return {
              phaseId,
              phaseName: typeof entry.phaseName === "string" && entry.phaseName.trim()
                ? entry.phaseName.trim()
                : formatPhaseName(phaseId),
              rag: isGated
                ? "green"
                : isNotStarted
                  ? "grey"
                  : ["green", "amber", "red", "grey"].includes(String(entry.rag))
                    ? entry.rag
                    : "grey",
              score: isGated
                ? Math.max(90, Math.round(clampNumber(entry.score, 0, 100, 0)))
                : isNotStarted
                  ? 0
                  : Math.round(clampNumber(entry.score, 0, 100, 0)),
              confidence: clampNumber(entry.confidence, 0, 1, 0.5),
              healthNote: truncateText(entry.healthNote, 120),
              topRisk: (isGated || isNotStarted)
                ? null
                : (typeof entry.topRisk === "string" && entry.topRisk.trim() ? entry.topRisk.trim() : null),
            };
          })
      : [];

    return {
      ...inner,
      healthHeatmap: {
        phaseHealth,
        overallHealthScore: Math.round(clampNumber(result.overallHealthScore, 0, 100, 0)),
        overallRag: ["green", "amber", "red"].includes(String(result.overallRag))
          ? result.overallRag
          : "amber",
        trend: ["improving", "stable", "declining"].includes(String(result.trend))
          ? result.trend
          : "stable",
        programMomentum: ["accelerating", "steady", "slowing", "stalled"].includes(String(result.programMomentum))
          ? result.programMomentum
          : "steady",
        confidence: clampNumber(result.confidence, 0, 1, 0.5),
        summary: truncateText(result.summary, 320),
      } as JsonValue,
      healthHeatmapGeneratedAt: new Date().toISOString(),
    };
  });
}

function hasPendingDecision(
  queue: Array<Record<string, unknown>>,
  matcher: (decision: Record<string, unknown>) => boolean,
): boolean {
  return queue.some((decision) => {
    const status = typeof decision.status === "string" ? decision.status : "pending";
    return matcher(decision) && !["resolved", "approved", "rejected"].includes(status);
  });
}

function applyRetroResultToProgramData(
  programData: ProgramState,
  phaseId: string,
  result: Record<string, unknown> | null,
): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    const existingRetros = normalizeProgramData(inner.retros as JsonValue | null);
    const existingGeneratedAt = normalizeProgramData(inner.retrosGeneratedAt as JsonValue | null);

    if (!isRecord(result)) {
      return {
        ...inner,
        retros: existingRetros,
        retrosGeneratedAt: {
          ...existingGeneratedAt,
          [phaseId]: new Date().toISOString(),
        } as JsonValue,
      };
    }

    const wentWell = Array.isArray(result.wentWell)
      ? result.wentWell
          .filter(isRecord)
          .filter((entry) => typeof entry.observation === "string" && entry.observation.trim().length > 0)
          .map((entry) => ({
            observation: String(entry.observation).trim(),
            impact: typeof entry.impact === "string" ? entry.impact.trim() : "",
            category: ["people", "process", "technology", "governance"].includes(String(entry.category))
              ? entry.category
              : "process",
          }))
      : [];
    const improvements = Array.isArray(result.improvements)
      ? result.improvements
          .filter(isRecord)
          .filter((entry) => typeof entry.observation === "string" && entry.observation.trim().length > 0)
          .map((entry) => ({
            observation: String(entry.observation).trim(),
            rootCause: typeof entry.rootCause === "string" ? entry.rootCause.trim() : "",
            category: ["people", "process", "technology", "governance"].includes(String(entry.category))
              ? entry.category
              : "process",
          }))
      : [];
    const actionItems = Array.isArray(result.actionItems)
      ? result.actionItems
          .filter(isRecord)
          .filter((entry) => typeof entry.action === "string" && entry.action.trim().length > 0)
          .map((entry) => ({
            action: String(entry.action).trim(),
            owner: typeof entry.owner === "string" && entry.owner.trim() ? entry.owner.trim() : null,
            targetPhase: typeof entry.targetPhase === "string" ? entry.targetPhase.trim() : "",
            priority: ["high", "medium", "low"].includes(String(entry.priority))
              ? entry.priority
              : "medium",
            effort: ["high", "medium", "low"].includes(String(entry.effort))
              ? entry.effort
              : "medium",
          }))
      : [];

    const normalizedRetro = {
      wentWell,
      improvements,
      actionItems,
      overallSentiment: ["positive", "mixed", "negative"].includes(String(result.overallSentiment))
        ? result.overallSentiment
        : "mixed",
      healthScore: Math.round(clampNumber(result.healthScore, 0, 100, 0)),
      keyLearning: truncateText(result.keyLearning, 150),
      confidence: clampNumber(result.confidence, 0, 1, 0.5),
    };

    const retroDecisions = actionItems
      .filter((entry) => entry.priority === "high" && entry.targetPhase)
      .filter((entry) => !hasPendingDecision(queue, (decision) =>
        decision.type === "retro-action"
        && decision.phaseId === entry.targetPhase
        && decision.title === entry.action
      ))
      .map((entry) => ({
        id: `retro_${phaseId}_${Date.now()}_${entry.action.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        type: "retro-action",
        title: entry.action,
        priority: "high",
        phaseId: entry.targetPhase,
        question: `Carry forward from ${formatPhaseName(phaseId)}: ${entry.action}`,
        recommendation: `Apply this learning in ${formatPhaseName(entry.targetPhase)}.${entry.owner ? ` Suggested owner: ${entry.owner}.` : ""}`,
        options: ["Accept action", "Defer action"],
        createdAt: new Date().toISOString(),
        status: "pending",
      }));

    return {
      ...inner,
      retros: {
        ...existingRetros,
        [phaseId]: normalizedRetro as JsonValue,
      },
      retrosGeneratedAt: {
        ...existingGeneratedAt,
        [phaseId]: new Date().toISOString(),
      } as JsonValue,
      decisionQueue: [...queue, ...retroDecisions] as JsonValue,
    };
  });
}

function applyDeckResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    if (!isRecord(result)) {
      return {
        ...inner,
        deck: null,
        deckGeneratedAt: new Date().toISOString(),
      };
    }

    const slides = Array.isArray(result.slides)
      ? result.slides
          .filter(isRecord)
          .filter((entry) => typeof entry.title === "string" && entry.title.trim().length > 0)
          .map((entry, index) => ({
            slideNumber: Math.max(1, Math.round(coerceNumber(entry.slideNumber, index + 1))),
            title: String(entry.title).trim(),
            type: [
              "title",
              "executive-summary",
              "status",
              "financials",
              "risks",
              "milestones",
              "decisions",
              "achievements",
              "next-steps",
              "appendix",
            ].includes(String(entry.type))
              ? entry.type
              : "status",
            talkingPoints: uniqueStrings(entry.talkingPoints, 4),
            dataCallouts: uniqueStrings(entry.dataCallouts, 5),
            recommendedVisual: typeof entry.recommendedVisual === "string" && entry.recommendedVisual.trim()
              ? entry.recommendedVisual.trim()
              : null,
            speakerNotes: truncateText(entry.speakerNotes, 500),
          }))
          .sort((left, right) => left.slideNumber - right.slideNumber)
      : [];

    return {
      ...inner,
      deck: {
        title: typeof result.title === "string" ? result.title : "Executive Program Update",
        audience: typeof result.audience === "string" ? result.audience : "Executive Steering Group",
        slides,
        generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString(),
        confidence: clampNumber(result.confidence, 0, 1, 0.5),
        programHealthSummary: truncateText(result.programHealthSummary, 240),
      } as JsonValue,
      deckGeneratedAt: new Date().toISOString(),
    };
  });
}

function applyScopePcrResultToProgramData(programData: ProgramState, result: Record<string, unknown> | null): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    if (!isRecord(result)) {
      return {
        ...inner,
        scopePcr: null,
        scopePcrGeneratedAt: new Date().toISOString(),
      };
    }

    const scopeSignals = Array.isArray(result.scopeSignals)
      ? result.scopeSignals
          .filter(isRecord)
          .filter((entry) => typeof entry.id === "string" && entry.id.trim() && typeof entry.description === "string" && entry.description.trim())
          .map((entry) => ({
            id: String(entry.id).trim(),
            description: String(entry.description).trim(),
            source: ["decision", "risk", "phase-evidence", "stakeholder"].includes(String(entry.source))
              ? entry.source
              : "decision",
            phase: typeof entry.phase === "string" && entry.phase.trim() ? entry.phase.trim() : "program",
            severity: ["critical", "high", "medium", "low"].includes(String(entry.severity))
              ? entry.severity
              : "medium",
            impactOnTimeline: typeof entry.impactOnTimeline === "string" && entry.impactOnTimeline.trim() ? entry.impactOnTimeline.trim() : null,
            impactOnBudget: typeof entry.impactOnBudget === "string" && entry.impactOnBudget.trim() ? entry.impactOnBudget.trim() : null,
            recommendPcr: entry.recommendPcr === true,
            pcrRationale: typeof entry.pcrRationale === "string" && entry.pcrRationale.trim() ? entry.pcrRationale.trim() : null,
          }))
      : [];

    const pcrDecisions = scopeSignals
      .filter((entry) => entry.recommendPcr)
      .filter((entry) => !hasPendingDecision(queue, (decision) =>
        decision.type === "pcr-review"
        && decision.agentId === entry.id
      ))
      .map((entry) => ({
        id: `pcr_${entry.id}_${Date.now()}`,
        type: "pcr-review",
        title: `PCR recommended · ${entry.description}`,
        priority: entry.severity === "critical" || entry.severity === "high" ? "high" : "medium",
        phaseId: entry.phase,
        question: `Raise a formal PCR for ${entry.description}?`,
        recommendation: entry.pcrRationale || "ATOS detected a scope change signal that merits sponsor review.",
        options: ["Raise PCR", "Monitor only"],
        createdAt: new Date().toISOString(),
        status: "pending",
        agentId: entry.id,
      }));

    return {
      ...inner,
      scopePcr: {
        scopeSignals,
        overallScopeRisk: ["high", "medium", "low", "contained"].includes(String(result.overallScopeRisk))
          ? result.overallScopeRisk
          : "contained",
        recommendedActions: uniqueStrings(result.recommendedActions, 5),
        openPcrCount: Math.max(0, Math.round(coerceNumber(result.openPcrCount, pcrDecisions.length))),
        confidence: clampNumber(result.confidence, 0, 1, 0.5),
        summary: truncateText(result.summary, 320),
      } as JsonValue,
      scopePcrGeneratedAt: new Date().toISOString(),
      decisionQueue: [...queue, ...pcrDecisions] as JsonValue,
    };
  });
}

function applyPatternQueryResultToProgramData(
  programData: ProgramState,
  result: Record<string, unknown> | null,
): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    patternQueryCache: isRecord(result) && Array.isArray(result.patterns)
      ? result.patterns.filter(isRecord).slice(0, 10) as JsonValue
      : (inner.patternQueryCache ?? null),
    patternQueryCachedAt: new Date().toISOString(),
  }));
}

function getPriorPhaseContext(programData: ProgramState, targetPhaseId: string): string {
  const targetIndex = ATOS_PHASE_SEQUENCE.indexOf(targetPhaseId);
  if (targetIndex <= 0) return "";
  const phaseArtifacts = (programData.phaseArtifacts as Record<string, Record<string, Record<string, JsonValue>>> | undefined) || {};
  const lines: string[] = [];
  for (const phaseId of ATOS_PHASE_SEQUENCE.slice(0, targetIndex)) {
    const artifacts = phaseArtifacts[phaseId] || {};
    for (const [artifactId, artifact] of Object.entries(artifacts)) {
      if (artifact?.status !== "approved") continue;
      const title = typeof artifact.title === "string" ? artifact.title : artifactId;
      const content = typeof artifact.content === "string" ? artifact.content.replace(/\s+/g, " ").trim() : "";
      if (!content) continue;
      lines.push(`${phaseId}: ${title} — ${content}`);
    }
  }
  return lines.length ? `Prior phase context:\n${lines.join("\n")}` : "";
}

async function getServerMemoryContext(
  admin: SupabaseClient,
  programId: string,
  agentId: string,
  phaseId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("adam_agent_runs")
    .select("status, confidence, created_at, output, error_message")
    .eq("program_id", programId)
    .eq("agent_id", agentId)
    .eq("phase_id", phaseId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !(data || []).length) return "";

  const entries = (data || []).map((run) => {
    const outputSummary = (() => {
      if (!run.output || typeof run.output !== "object" || Array.isArray(run.output)) return "";
      const summary = (run.output as Record<string, JsonValue>).summary;
      return typeof summary === "string" ? summary : "";
    })();
    const statusLabel = typeof run.status === "string" ? run.status : "unknown";
    return `- ${run.created_at}: ${statusLabel}, confidence ${Number(run.confidence ?? 0).toFixed(2)}${outputSummary ? ` — ${outputSummary}` : ""}${run.error_message ? ` — ${run.error_message}` : ""}`;
  });
  return `Recent agent memory:\n${entries.join("\n")}`.slice(0, 800);
}

function checkForPauseMarker(response: string): PauseMarkerResult {
  const markerMatch = response.match(/\[PAUSE_FOR_DECISION:\s*(\{[\s\S]*?\})\s*\]/);
  if (!markerMatch) return { hasPause: false };

  const payload = safeJsonParse<Record<string, unknown>>(markerMatch[1], {});
  return {
    hasPause: true,
    reason: typeof payload.reason === "string" ? payload.reason : "Human input required.",
    question: typeof payload.question === "string" ? payload.question : "Please review the pending agent question.",
    options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === "string") : [],
    contentBeforePause: response.slice(0, markerMatch.index).trim() || "",
  };
}

function parseAgentPayload(raw: string, phaseId: string, agentId: string): ParsedAgentPayload {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? safeJsonParse<Record<string, unknown>>(jsonMatch[0], {}) : {};
  const artifacts = Array.isArray(parsed.artifacts)
    ? parsed.artifacts.map((entry, index) => {
        const artifact = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
        const title = typeof artifact.title === "string" ? artifact.title : `Generated artifact ${index + 1}`;
        const id = typeof artifact.id === "string"
          ? artifact.id
          : title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        return {
          id: id || `${phaseId}_${agentId}_${index + 1}`,
          title,
          content: typeof artifact.content === "string" ? artifact.content : "",
          summary: typeof artifact.summary === "string" ? artifact.summary : undefined,
        };
      }).filter((artifact) => artifact.content.trim())
    : [];
  const decisions = Array.isArray(parsed.decisions)
    ? parsed.decisions.map((entry) => {
        const decision = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
        return {
          title: typeof decision.title === "string" ? decision.title : "Decision needed",
          question: typeof decision.question === "string" ? decision.question : "Review the agent recommendation.",
          priority: typeof decision.priority === "string" ? decision.priority : "medium",
          options: Array.isArray(decision.options) ? decision.options.filter((item): item is string => typeof item === "string") : [],
        };
      })
    : [];
  const handoffValue = parsed.handoff;
  const handoff = (handoffValue && typeof handoffValue === "object" && !Array.isArray(handoffValue))
    ? {
        fromAgentId: typeof (handoffValue as Record<string, unknown>).fromAgentId === "string"
          ? String((handoffValue as Record<string, unknown>).fromAgentId)
          : agentId,
        fromPhaseId: typeof (handoffValue as Record<string, unknown>).fromPhaseId === "string"
          ? String((handoffValue as Record<string, unknown>).fromPhaseId)
          : phaseId,
        toPhaseId: typeof (handoffValue as Record<string, unknown>).toPhaseId === "string"
          ? String((handoffValue as Record<string, unknown>).toPhaseId)
          : "",
        completedAt: typeof (handoffValue as Record<string, unknown>).completedAt === "string"
          ? String((handoffValue as Record<string, unknown>).completedAt)
          : new Date().toISOString(),
        summary: typeof (handoffValue as Record<string, unknown>).summary === "string"
          ? String((handoffValue as Record<string, unknown>).summary)
          : "",
        keyDecisions: Array.isArray((handoffValue as Record<string, unknown>).keyDecisions)
          ? ((handoffValue as Record<string, unknown>).keyDecisions as unknown[]).filter((item): item is string => typeof item === "string")
          : [],
        artifactIds: Array.isArray((handoffValue as Record<string, unknown>).artifactIds)
          ? ((handoffValue as Record<string, unknown>).artifactIds as unknown[]).filter((item): item is string => typeof item === "string")
          : artifacts.map((artifact) => artifact.id),
        openQuestions: Array.isArray((handoffValue as Record<string, unknown>).openQuestions)
          ? ((handoffValue as Record<string, unknown>).openQuestions as unknown[]).filter((item): item is string => typeof item === "string")
          : [],
        confidence: typeof (handoffValue as Record<string, unknown>).confidence === "number"
          ? Number((handoffValue as Record<string, unknown>).confidence)
          : 0.7,
        recommendedNextAction: typeof (handoffValue as Record<string, unknown>).recommendedNextAction === "string"
          ? String((handoffValue as Record<string, unknown>).recommendedNextAction)
          : "Review the generated artifacts and continue the next phase.",
      }
    : null;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    reasoningTrace: Array.isArray(parsed.reasoningTrace)
      ? parsed.reasoningTrace.filter((item): item is string => typeof item === "string")
      : [],
    confidence: typeof parsed.confidence === "number" ? Number(parsed.confidence) : 0.72,
    artifacts,
    decisions,
    handoff,
  };
}

function buildDefaultHandoff(
  request: RunAgentRequest,
  payload: ParsedAgentPayload,
): AgentHandoff | null {
  // Only real PHASE agents hand a phase over to the next one. Program-level
  // support agents (daily-briefing, status-report, risk-review, …) run "against"
  // the active phase but produce no phase deliverables, so a default handoff from
  // them would falsely mark the phase ready to advance. Skip them.
  if (!ATOS_PHASE_SEQUENCE.includes(request.agentId)) return null;
  const currentIndex = ATOS_PHASE_SEQUENCE.indexOf(request.phaseId);
  const nextPhaseId = payload.handoff?.toPhaseId || ATOS_PHASE_SEQUENCE[currentIndex + 1] || "";
  if (!nextPhaseId) return null;

  return {
    fromAgentId: request.agentId,
    fromPhaseId: request.phaseId,
    toPhaseId: nextPhaseId,
    completedAt: new Date().toISOString(),
    summary: payload.handoff?.summary || payload.summary || `${request.phaseId} agent completed its current run.`,
    keyDecisions: payload.handoff?.keyDecisions || payload.decisions.map((decision) => decision.title),
    artifactIds: payload.handoff?.artifactIds || payload.artifacts.map((artifact) => artifact.id),
    openQuestions: payload.handoff?.openQuestions || [],
    confidence: payload.handoff?.confidence ?? payload.confidence,
    recommendedNextAction: payload.handoff?.recommendedNextAction || `Continue into ${nextPhaseId}.`,
  };
}

/**
 * Canonical artifact titles for structured ("special program") agents. These MUST
 * match the client `AGENT_META[agentId].outputArtifact` labels so the UI artifact
 * ledger (which fuzzy-matches required slots by title) recognises agent output.
 * Without this, structured agents persist only to dedicated top-level program keys
 * and the ledger — which reads only `data.phaseArtifacts` — never sees them.
 */
const REQUIRED_ARTIFACT_LABELS: Record<string, string> = {
  narrative: "Phase Narrative",
  // Delivery Plan and Milestone Review are no longer standalone ledger artifacts:
  // both are folded into the single Strategic Roadmap artifact (their data lives
  // under strategicRoadmap.deliveryPlan / strategicRoadmap.milestones).
  risk: "Risk Register",
  budget: "Budget Report",
  "critical-path": "Critical Path",
  "change-impact": "Change Impact",
  stakeholder: "Stakeholder Map",
  "health-heatmap": "Health Heatmap",
  adoption: "Adoption Plan",
  closure: "Closure Report",
};

/**
 * Some agents run program-level but the methodology assigns their artifact to a
 * specific phase slot. Route the ledger entry to the phase the methodology
 * expects so the required-artifact slot is satisfied. (The dedicated top-level
 * program key written elsewhere is unaffected.)
 */
const ARTIFACT_LEDGER_PHASE_OVERRIDE: Record<string, string> = {
  adoption: "operate",
};

/** Normalise an agent confidence (0-1 or 0-100) to a 0-100 ledger quality score. */
function toLedgerConfidence(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function applyArtifactsToProgramData(
  programData: ProgramState,
  phaseId: string,
  artifacts: ParsedAgentPayload["artifacts"],
): ProgramState {
  const nextData = { ...programData };
  const phaseArtifacts = {
    ...((nextData.phaseArtifacts as Record<string, Record<string, JsonValue>>) || {}),
  };
  const currentPhaseArtifacts = {
    ...(phaseArtifacts[phaseId] || {}),
  };

  for (const artifact of artifacts) {
    currentPhaseArtifacts[artifact.id] = {
      ...(typeof currentPhaseArtifacts[artifact.id] === "object" && currentPhaseArtifacts[artifact.id] !== null
        ? currentPhaseArtifacts[artifact.id] as Record<string, JsonValue>
        : {}),
      title: artifact.title,
      content: artifact.content,
      status: "draft",
      agentDrafted: true,
      agentDraftedAt: new Date().toISOString(),
      ...(typeof artifact.confidence === "number"
        ? { agentConfidence: toLedgerConfidence(artifact.confidence) as JsonValue }
        : {}),
    };
  }

  phaseArtifacts[phaseId] = currentPhaseArtifacts;
  nextData.phaseArtifacts = phaseArtifacts;
  return nextData;
}

function appendDecisionQueueItems(
  programData: ProgramState,
  items: Record<string, JsonValue>[],
): ProgramState {
  const nextData = { ...programData };
  const queue = Array.isArray(nextData.decisionQueue) ? [...nextData.decisionQueue as JsonValue[]] : [];
  nextData.decisionQueue = [...queue, ...items];
  return nextData;
}

function createAgentReviewDecision(
  agentId: string,
  phaseId: string,
  result: Record<string, unknown> | null,
  reason: string,
): Record<string, JsonValue> {
  return {
    id: crypto.randomUUID(),
    type: "agent_review",
    phaseId,
    phase: phaseId,
    agentId,
    title: `Review ${agentId} output`,
    question: `ATOS has generated a ${agentId} update. Review and approve or defer.`,
    recommendation: `Confidence was below the trust threshold. Reason: ${reason}`,
    createdAt: new Date().toISOString(),
    priority: "medium",
    status: "open",
    previewContent: (result || {}) as JsonValue,
  };
}

function buildOutputSummary(agentId: string, result: Record<string, unknown> | null): string {
  if (!result) return `${agentId} completed`;
  if (agentId === "risk") {
    return `Risk scan: ${Array.isArray(result.raidEntries) ? result.raidEntries.length : 0} items`;
  }
  if (agentId === "milestone") {
    return `${Array.isArray(result.milestones) ? result.milestones.length : 0} milestones derived`;
  }
  if (agentId === "escalation") {
    return `${Array.isArray(result.escalations) ? result.escalations.length : 0} escalations raised`;
  }
  if (agentId === "cross-artifact-validator") {
    const count = Array.isArray(result.findings) ? result.findings.length : 0;
    return count === 0 ? "Cross-artifact validation: no semantic gaps" : `Cross-artifact validation: ${count} traceability gap(s)`;
  }
  if (typeof result.summary === "string" && result.summary.trim()) {
    return result.summary.trim().slice(0, 120);
  }
  return `${agentId} completed`;
}

async function emitAgentEvent(
  admin: SupabaseClient,
  params: {
    programId: string;
    agentId: string;
    phaseId?: string | null;
    eventType: "triggered" | "completed" | "failed" | "stale";
    payload?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await admin
    .from("adam_agent_events")
    .insert({
      program_id: params.programId,
      agent_id: params.agentId,
      phase_id: params.phaseId ?? null,
      event_type: params.eventType,
      payload: (params.payload || null) as JsonValue | null,
    });
  if (error) {
    throw new Error(`Failed to emit agent event: ${error.message}`);
  }
}

async function persistAgentArtifact(
  admin: SupabaseClient,
  programId: string,
  agentId: string,
  phaseId: string,
  content: Record<string, unknown> | null,
  confidence: number | null,
): Promise<void> {
  const normalizedContent = (content || {}) as JsonValue;
  const prior = await admin
    .from("adam_program_artifacts")
    .select("id, version")
    .eq("program_id", programId)
    .eq("agent_id", agentId)
    .eq("phase_id", phaseId)
    .is("superseded_at", null)
    .maybeSingle();

  if (prior.error && prior.error.code !== "PGRST116") {
    throw new Error(`Failed to read prior artifact: ${prior.error.message}`);
  }

  const inserted = await admin
    .from("adam_program_artifacts")
    .insert({
      program_id: programId,
      agent_id: agentId,
      phase_id: phaseId,
      version: (prior.data?.version || 0) + 1,
      content: normalizedContent,
      confidence,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data?.id) {
    throw new Error(inserted.error?.message || "Failed to persist agent artifact.");
  }

  if (prior.data?.id) {
    const { error } = await admin
      .from("adam_program_artifacts")
      .update({
        superseded_at: new Date().toISOString(),
        superseded_by: inserted.data.id,
      })
      .eq("id", prior.data.id);
    if (error) {
      throw new Error(`Failed to supersede prior artifact: ${error.message}`);
    }
  }
}

async function autonomyGate(
  admin: SupabaseClient,
  programId: string,
  agentId: string,
  confidence: number | null,
): Promise<{
  actAutonomously: boolean;
  applyWriteBack: boolean;
  shouldQueueReview: boolean;
  reason: string;
}> {
  const ALWAYS_HUMAN = ["closure", "escalation"];
  if (ALWAYS_HUMAN.includes(agentId)) {
    await admin.from("adam_autonomy_log").insert({
      program_id: programId,
      agent_id: agentId,
      action_type: "write-back",
      confidence,
      acted_autonomously: false,
      reason: "Agent always requires human confirmation",
    });
    return {
      actAutonomously: false,
      applyWriteBack: true,
      shouldQueueReview: false,
      reason: "Agent always requires human confirmation",
    };
  }

  const { data: settings } = await admin
    .from("adam_autonomy_settings")
    .select("*")
    .eq("program_id", programId)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (!settings) {
    await admin.from("adam_autonomy_log").insert({
      program_id: programId,
      agent_id: agentId,
      action_type: "write-back",
      confidence,
      acted_autonomously: false,
      reason: "No autonomy settings configured; using default queued behavior.",
    });
    return {
      actAutonomously: false,
      applyWriteBack: true,
      shouldQueueReview: false,
      reason: "No autonomy settings configured; using default queued behavior.",
    };
  }

  const threshold = typeof settings.trust_threshold === "number" ? settings.trust_threshold : 0.85;
  const enabled = settings.enabled === true;
  const maxDailyActions = typeof settings.max_autonomous_actions_per_day === "number" ? settings.max_autonomous_actions_per_day : 10;

  // Check daily autonomy limit
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await admin
    .from("adam_autonomy_log")
    .select("*", { count: "exact", head: true })
    .eq("program_id", programId)
    .eq("acted_autonomously", true)
    .gte("created_at", todayStart.toISOString());
  const dailyLimitExceeded = enabled && typeof todayCount === "number" && todayCount >= maxDailyActions;

  const actAutonomously = enabled && !dailyLimitExceeded && typeof confidence === "number" && confidence >= threshold;
  const reason = actAutonomously
    ? `Confidence ${confidence?.toFixed(2)} >= threshold ${threshold}`
    : dailyLimitExceeded
      ? `Daily autonomous action limit reached (${todayCount ?? 0}/${maxDailyActions})`
      : !enabled
        ? "Autonomy disabled for this agent"
        : `Confidence ${confidence?.toFixed(2) ?? "0.00"} < threshold ${threshold}`;

  await admin.from("adam_autonomy_log").insert({
    program_id: programId,
    agent_id: agentId,
    action_type: "write-back",
    confidence,
    acted_autonomously: actAutonomously,
    reason,
  });

  return {
    actAutonomously,
    applyWriteBack: actAutonomously || !enabled,
    shouldQueueReview: enabled && !actAutonomously,
    reason,
  };
}

/**
 * Three-way merge for the program-data document.
 *
 * Agents run in parallel (downstream/handoff cascades fan out as separate
 * edge-function invocations). Each loads the same `base`, mutates its own slice,
 * and would otherwise blind-overwrite the whole `data` blob — silently dropping a
 * sibling agent's concurrent write. This merge starts from `fresh` (whatever is
 * currently committed) and overlays only the changes this writer made (base→next),
 * so keys the writer didn't touch keep the latest committed value.
 *
 * The apply* functions update immutably (object spreads), so untouched subtrees
 * keep their reference identity — `base === next` is a fast, exact "unchanged" test.
 */
function mergeProgramDelta(base: JsonValue, next: JsonValue, fresh: JsonValue): JsonValue {
  if (base === next) return fresh; // writer didn't touch this subtree → keep committed value
  if (isRecord(base) && isRecord(next) && isRecord(fresh)) {
    const out: Record<string, JsonValue> = { ...(fresh as Record<string, JsonValue>) };
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    for (const key of keys) {
      const nextHas = Object.prototype.hasOwnProperty.call(next, key);
      const baseHas = Object.prototype.hasOwnProperty.call(base, key);
      if (!nextHas && baseHas) {
        // writer deleted this key
        delete out[key];
        continue;
      }
      out[key] = mergeProgramDelta(
        (base as Record<string, JsonValue>)[key],
        (next as Record<string, JsonValue>)[key],
        (fresh as Record<string, JsonValue>)[key],
      );
    }
    return out as JsonValue;
  }
  // Writer changed a scalar / array / replaced the node → writer wins.
  return next;
}

// ── Transcript externalization (phase 6) ───────────────────────────────────
// The client splits large transcripts out of the blob into adam_program_texts
// (split on write); here the edge reconstructs them so grounding/evidence see
// the full record (merge on read), and — only once cutover is deliberately
// enabled via the EXTERNALIZE_CUTOVER env flag — splits its own write-backs so
// agent runs don't re-inflate the blob. All of it is defensive: a missing table
// or empty result is a silent no-op, so this is safe to deploy before the
// migration is applied and before the client cutover flag is flipped.
const EXTERNALIZE_CUTOVER = (Deno.env.get("EXTERNALIZE_CUTOVER") || "").toLowerCase() === "on";

/** Merge the programme's externalized texts back into `programRow.data` in place,
 * preserving the blob's flat-vs-nested shape. No-op if the table is absent or
 * has no rows for this programme. */
async function mergeProgramTextsIntoRow(
  admin: SupabaseClient,
  programId: string,
  programRow: { data: JsonValue },
): Promise<void> {
  const container = resolvePhaseInputsContainer(programRow.data);
  if (!container) return;
  const { data: rows, error } = await admin
    .from("adam_program_texts")
    .select("field_key, movement_id, content")
    .eq("program_id", programId);
  if (error || !rows || !rows.length) return; // table absent / empty → inline blob
  const texts: ExternalText[] = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      fieldKey: String(row.field_key),
      movementId: String(row.movement_id ?? ""),
      content: String(row.content ?? ""),
    };
  });
  const merged = mergeExternalTexts(container, texts);
  if (container === (programRow.data as unknown)) {
    programRow.data = merged as JsonValue;
  } else {
    (programRow.data as Record<string, unknown>).data = merged;
  }
}

/** Before a write-back, split large transcripts out of `data` into the texts
 * table and return the shrunk blob. Gated on EXTERNALIZE_CUTOVER: until that is
 * set, returns `data` untouched (the transcripts stay inline). On any table
 * failure, falls back to the full inline blob so transcripts are never lost. */
async function splitProgramTextsForWrite(
  admin: SupabaseClient,
  programId: string,
  data: ProgramState,
): Promise<ProgramState> {
  if (!EXTERNALIZE_CUTOVER) return data;
  const container = resolvePhaseInputsContainer(data as unknown);
  if (!container) return data;
  try {
    const { inner, texts } = splitExternalTexts(container);
    if (texts.length) {
      const rows = texts.map((t) => ({
        program_id: programId,
        field_key: t.fieldKey,
        movement_id: t.movementId,
        content: t.content,
        chars: t.content.length,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await admin
        .from("adam_program_texts")
        .upsert(rows, { onConflict: "program_id,field_key" });
      if (error) throw error;
    }
    if (container === (data as unknown)) return inner as ProgramState;
    return { ...(data as Record<string, unknown>), data: inner } as ProgramState;
  } catch (err) {
    logger.warn("program_texts_split_failed", { programId, errorMessage: String(err) });
    return data;
  }
}

async function persistProgramData(
  admin: SupabaseClient,
  programId: string,
  data: ProgramState,
  concurrency?: { base: ProgramState; expectedUpdatedAt: string | null },
): Promise<void> {
  // Back-compat path: no concurrency token → blind last-write-wins.
  if (!concurrency) {
    const blob = await splitProgramTextsForWrite(admin, programId, data);
    const { error } = await admin
      .from("adam_programs")
      .update({ data: blob, updated_at: new Date().toISOString() })
      .eq("id", programId);
    if (error) {
      throw new Error(`Failed to persist program state: ${error.message}`);
    }
    return;
  }

  // Optimistic concurrency: only write if the row hasn't changed since we loaded it.
  // On conflict, reload the latest committed data, re-merge just our delta, and retry.
  // Postgres re-evaluates the WHERE against the freshly-committed row version under
  // READ COMMITTED, so the updated_at predicate serialises concurrent writers.
  const MAX_ATTEMPTS = 4;
  let expectedUpdatedAt = concurrency.expectedUpdatedAt;
  let toWrite: ProgramState = data;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const casBlob = await splitProgramTextsForWrite(admin, programId, toWrite);
    let update = admin
      .from("adam_programs")
      .update({ data: casBlob, updated_at: new Date().toISOString() })
      .eq("id", programId);
    update = expectedUpdatedAt
      ? update.eq("updated_at", expectedUpdatedAt)
      : update.is("updated_at", null);
    const { data: updatedRows, error } = await update.select("id");
    if (error) {
      throw new Error(`Failed to persist program state: ${error.message}`);
    }
    if (updatedRows && updatedRows.length > 0) {
      return; // CAS succeeded
    }

    // Conflict — someone wrote since we loaded. Reload, re-merge, retry.
    const { data: freshRow, error: readError } = await admin
      .from("adam_programs")
      .select("data, updated_at")
      .eq("id", programId)
      .maybeSingle();
    if (readError || !freshRow) {
      throw new Error(`Failed to reload program for merge: ${readError?.message || "row missing"}`);
    }
    const fresh = normalizeProgramData(freshRow.data as JsonValue | null);
    toWrite = mergeProgramDelta(concurrency.base as JsonValue, data as JsonValue, fresh as JsonValue) as ProgramState;
    expectedUpdatedAt = (freshRow.updated_at as string | null) ?? null;
  }

  // Exhausted retries (heavy contention) — fall back to a final merged write so the
  // run doesn't hard-fail. toWrite already reflects the most recent merge.
  const finalBlob = await splitProgramTextsForWrite(admin, programId, toWrite);
  const { error } = await admin
    .from("adam_programs")
    .update({ data: finalBlob, updated_at: new Date().toISOString() })
    .eq("id", programId);
  if (error) {
    throw new Error(`Failed to persist program state after ${MAX_ATTEMPTS} attempts: ${error.message}`);
  }
}

async function queueTriggeredRun(
  admin: SupabaseClient,
  run: {
    programId: string;
    agentId: string;
    phaseId: string;
    ownerId: string | null;
    triggerEvent: string;
    incomingHandoff?: AgentHandoff | null;
  },
): Promise<void> {
  const inserted = await admin
    .from("adam_agent_runs")
    .insert({
      program_id: run.programId,
      agent_id: run.agentId,
      phase_id: run.phaseId,
      status: "queued",
      trigger_event: run.triggerEvent,
      scheduled_by: "handoff",
      owner_id: run.ownerId,
      handoff: (run.incomingHandoff || null) as JsonValue | null,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data?.id) {
    throw new Error(inserted.error?.message || "Failed to queue triggered run.");
  }

  await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      programId: run.programId,
      agentId: run.agentId,
      phaseId: run.phaseId,
      triggeredBy: "handoff",
      triggerEvent: run.triggerEvent,
      incomingHandoff: run.incomingHandoff || null,
      runId: inserted.data.id,
    } satisfies RunAgentRequest),
  }).catch((error) => {
    console.warn("ATOS follow-on run invocation failed:", error);
  });
}

/**
 * Structured human inputs that feed a formal artifact, flattened to a stable
 * key→string map. This is the snapshot we persist alongside a generated artifact
 * (under `_generationMetadata.inputSnapshot`) so the next regeneration can diff
 * it against current inputs and tell the model exactly what changed.
 */
function buildFormalInputSnapshot(inner: Record<string, unknown>, phase: string): Record<string, string> {
  const phaseInputsAll = normalizeProgramData(inner.phaseInputs as JsonValue | null);
  const strategyInputs = normalizeProgramData(phaseInputsAll.strategy as JsonValue | null);
  const phaseInputs = normalizeProgramData(phaseInputsAll[phase] as JsonValue | null);
  const snapshot: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    snapshot[key] = typeof value === "string" ? value : JSON.stringify(value);
  };
  // Strategy-level inputs every artifact may anchor to.
  for (const key of ["businessObjective", "sponsor", "successMetric", "constraints", "budget", "scopeInclusions", "scopeExclusions", "kpis"]) {
    put(`strategy.${key}`, strategyInputs[key]);
  }
  // The artifact's own phase inputs.
  for (const [key, value] of Object.entries(phaseInputs)) {
    if (key === "savedAt") continue;
    put(`${phase}.${key}`, value);
  }
  return snapshot;
}

/** Diff a prior input snapshot against current inputs (Change 3 — delta awareness). */
function computeInputDelta(
  prev: Record<string, string> | null,
  curr: Record<string, string>,
): Array<{ field: string; previousValue: string | null; newValue: string | null }> {
  if (!prev) return [];
  const delta: Array<{ field: string; previousValue: string | null; newValue: string | null }> = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const key of keys) {
    const before = key in prev ? prev[key] : null;
    const after = key in curr ? curr[key] : null;
    if (before !== after) delta.push({ field: key, previousValue: before, newValue: after });
  }
  return delta;
}

/** The input snapshot persisted with the last generation of a formal artifact, if any. */
function readPriorInputSnapshot(inner: Record<string, unknown>, fieldKey: string): Record<string, string> | null {
  const artifact = isRecord(inner[fieldKey]) ? inner[fieldKey] as Record<string, unknown> : null;
  const meta = artifact && isRecord(artifact._generationMetadata) ? artifact._generationMetadata as Record<string, unknown> : null;
  const snap = meta && isRecord(meta.inputSnapshot) ? meta.inputSnapshot as Record<string, unknown> : null;
  if (!snap) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * Derive the effective run mode for a formal-artifact generation (Change 1).
 * An explicit request.runMode always wins; otherwise we infer from whether the
 * artifact already exists and how the run was triggered.
 */
function deriveFormalRunMode(
  request: RunAgentRequest,
  inner: Record<string, unknown>,
  fieldKey: string,
): RunMode {
  if (request.runMode) return request.runMode;
  const exists = isRecord(inner[fieldKey]) && Object.keys(inner[fieldKey] as Record<string, unknown>).length > 0;
  if (!exists) return "initial_generation";
  if (request.triggeredBy === "handoff") return "cascade_refresh";
  if (request.triggeredBy === "user") return "manual_regeneration";
  return "input_change_refresh";
}

/** Gap between consecutive downstream agent triggers, to smooth provider load. */
const DOWNSTREAM_STAGGER_MS = 1500;

/** True when a run-agent response indicates the AI provider is rate-limited. */
async function isProviderRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.ok) return false;
  // The provider rate limit surfaces as a 500 with a rate-limit message in the body
  // (the bare 429 from run-agent is the separate daily-token-budget guard).
  try {
    const body = await res.clone().json() as { error?: string };
    return typeof body?.error === "string"
      && /rate limit|temporarily busy|too many requests/i.test(body.error);
  } catch {
    return false;
  }
}

/**
 * Schedules downstream agents after a parent agent completes.
 *
 * Fires them ONE AT A TIME with a short stagger rather than all at once. The old
 * parallel fan-out (Promise.allSettled) made every downstream agent's LLM call land
 * in the same instant, so a single trigger could spawn 4-7 simultaneous provider
 * calls and trip a 429 that failed the whole chain. Sequential firing keeps the total
 * work identical while smoothing the request rate. If any downstream run reports a
 * rate limit, the remaining agents are skipped — the provider is already saturated, so
 * firing them would only produce more failures (the user can re-trigger later).
 *
 * The caller runs this in the background (see scheduleBackground) so the user's own
 * result returns immediately — downstream agents only persist follow-on intelligence
 * and are never part of the response payload.
 */
async function triggerDownstreamAgents(
  completedAgentId: string,
  programId: string,
  completedPhaseId: string,
  /** Handoff from the completing agent — passed to each downstream so they know upstream context */
  completedHandoff?: AgentHandoff | null,
  /** Post-completion program state — used to gate the capacity re-assessment on a populated roster. */
  programData?: ProgramState,
  /**
   * True when the completed run produced one or more artifacts (formal documents
   * OR dynamic-phase artifacts). Dynamic-phase artifacts go through the generic
   * agent branch, which is not in FORMAL_ARTIFACT_AGENTS, so this flag is how a
   * dynamic artifact generation also refreshes the plan + risk register.
   */
  producedArtifact = false,
): Promise<void> {
  // ── No recursive cascade ─────────────────────────────────────────────────
  // The automatic agent fan-out (AGENT_DOWNSTREAM map, gate-review/retro/
  // pattern-query/contradiction-detector/health-heatmap chains) has been
  // retired: it multiplied LLM calls and produced drift. The ONLY automatic
  // follow-on now is the lean post-artifact refresh — when an artifact is
  // (re)generated, ATOS refreshes the risk register so the risks/blockers
  // surfaces stay in sync with the latest artifact. The delivery plan rides with
  // the strategic-roadmap artifact itself, so it needs no separate refresh.
  // Everything else (gate review, contradiction checks, decks, retros, pattern
  // mining) is on-demand.
  const isFormalArtifact = !!FORMAL_ARTIFACT_AGENTS[completedAgentId];
  const shouldRefreshDerived = (isFormalArtifact || producedArtifact)
    && !!completedPhaseId && completedPhaseId !== "program";
  if (!shouldRefreshDerived) return;

  // risk runs at phaseId "program" and is not a formal artifact, so it never
  // re-enters this branch — the refresh cannot recurse.
  const downstreamAgents: { agentId: string; phaseId: string }[] = [];

  // Risk register: the app determines the INITIAL risk set (one automatic scan),
  // then leaves the register to the team — additional risks are raised manually,
  // and capacity risks are raised deterministically by the capacity check below.
  // So the auto risk-scan only runs while no agent-sourced risk exists yet; once
  // it does, we stop regenerating it on every artifact change.
  const hasAgentRisks = (() => {
    if (!programData) return false;
    const inner = getInnerProgramData(programData);
    const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
    const entries = Array.isArray(raidLog.entries) ? raidLog.entries.filter(isRecord) : [];
    // Capacity-gap risks are raised deterministically by the capacity check, not the
    // risk agent — they must not count as the "initial risk scan has run" signal.
    return entries.some(
      (entry) => entry.source === "agent" && !(typeof entry.id === "string" && entry.id.startsWith("capacity-gap-")),
    );
  })();
  if (!hasAgentRisks) {
    downstreamAgents.push({ agentId: "risk", phaseId: "program" });
  }

  // Capacity re-assessment is automatic: whenever an artifact is generated in a
  // phase where team capacity is load-bearing, refresh the capacity assessment so
  // the roster's adequacy reflects the latest plan. Gated three ways: never from
  // capacity-assessor itself (it is a support artifact, so it would not re-enter
  // this branch anyway — but the guard makes the no-recursion intent explicit);
  // only in the phases that surface a capacity card; and only once the roster
  // actually carries people, so we never burn a run on an empty grid.
  const CAPACITY_PHASES = new Set(["mobilise", "build"]);
  if (completedAgentId !== "capacity-assessor" && CAPACITY_PHASES.has(completedPhaseId)) {
    const mobiliseInputs = normalizeProgramData(
      normalizeProgramData(programData?.phaseInputs as JsonValue | null).mobilise as JsonValue | null,
    );
    if (resolveRosterRows(mobiliseInputs).length > 0) {
      downstreamAgents.push({ agentId: "capacity-assessor", phaseId: completedPhaseId });
    }
  }

  for (let i = 0; i < downstreamAgents.length; i++) {
    const target = downstreamAgents[i];
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          programId,
          agentId: target.agentId,
          phaseId: target.phaseId,
          triggeredBy: "trigger",
          triggerEvent: `downstream:${completedAgentId}`,
          // ── Cross-agent intelligence: pass upstream handoff so downstream agents
          //    know what the completing agent found, its confidence, and open questions.
          incomingHandoff: completedHandoff ?? null,
        } satisfies RunAgentRequest),
      });
      if (await isProviderRateLimited(res)) {
        console.warn(`ATOS downstream fan-out halted after ${target.agentId}: AI provider rate-limited.`);
        break;
      }
    } catch (error) {
      console.warn(`ATOS downstream run for ${target.agentId} failed:`, error);
    }
    if (i < downstreamAgents.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DOWNSTREAM_STAGGER_MS));
    }
  }
}

/**
 * Runs a follow-on task without blocking the response. Uses the Edge runtime's
 * waitUntil when available (keeps the worker alive until the task settles after the
 * response is sent); otherwise falls back to fire-and-forget so other runtimes still work.
 */
function scheduleBackground(task: Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task.catch((error) => console.warn("ATOS background task failed:", error)));
  } else {
    void task.catch((error) => console.warn("ATOS background task failed:", error));
  }
}

async function callJsonLLM(
  system: string,
  user: string,
  maxTokens = 1200,
): Promise<{ parsed: Record<string, unknown>; raw: string; inputTokens: number; outputTokens: number }> {
  const result = await streamClaudeText({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens,
    temperature: 0.2,
  });
  const parsed = extractAgentJson(result.text);
  return {
    parsed: isRecord(parsed) ? parsed : {},
    raw: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

function stringifyForReview(value: unknown): string {
  if (typeof value === "string") return value;
  return stringifyJson(value);
}

async function reviewArtifact(
  artifactLabel: string,
  artifactContent: string,
  phaseContext: string,
  priorPhaseArtifacts: string,
  providedInputs: string,
  phaseScope: string,
): Promise<{ score: number; dimensions: Record<string, number>; improvements: string[]; suggestedStakeholders: string[] }> {
  const systemPrompt = `You are an independent artifact quality reviewer for ATOS transformation programs.
Score the artifact on these dimensions (0-100 each):
- completeness: are all the sections expected FOR THIS PHASE present with substantive content?
- specificity: does it reference actual program data (names, metrics, dates) vs generic statements?
- actionability: does it tell the reader what to do next, concretely, within this phase's remit?
- consistency: is it consistent with the prior-phase artifacts provided?

PHASE SCOPE — read this first. The "Phase scope" block below states which phase this artifact belongs to, that phase's objective, the artifacts it owns, and which detail belongs to LATER phases. ATOS programmes run in sequenced phases: early phases set direction and intent; later phases add delivery detail. Judge the artifact ONLY against its own phase's purpose. NEVER recommend adding a fact, section, milestone schedule, RACI/ownership matrix, phase exit criteria, UAT/go-live date, delivery/run plan, or any other deliverable that the scope block flags as owned by a later phase — that detail is out of scope here and such a suggestion is wrong, not helpful. If a weakness only matters for a downstream phase, omit it entirely.

SOURCE OF TRUTH: The "Structured inputs already provided" and "Prior-phase artifacts" blocks below are authoritative — they are exactly what the user has already supplied or established upstream. Before writing ANY improvement, cross-check it against both blocks. NEVER recommend adding, specifying, quantifying, or clarifying a fact that already appears in them (for example, if targetEndDate is present in the inputs, do not ask for a target/end date; if a prior phase already named the sponsor or KPI, do not ask for it). Only raise inputs that are genuinely absent, empty, or too vague to act on. If a fact exists in the inputs but is simply not surfaced in the document prose, that is ATOS's job to weave in at generation — do NOT ask the user to do it.

INPUT FIELDS ARE ATOMIC, SINGLE-PURPOSE FACTS — NOT NARRATIVE. Each input field captures ONE fact for its own purpose; ATOS composes the document's narrative FROM those facts. So: (a) NEVER recommend that the user enrich one input field by restating a fact that ANOTHER input field already captures (e.g. do not say "add the budget and timeline to the business objective" when budget and timeline are their own populated fields — that is redundant data entry, and the score must not depend on it). (b) NEVER recommend turning an input field into a richer story, summary, multi-fact paragraph, or "more context" for the document's benefit — input fields exist to supply needed information, not to build deep narratives for inclusion in artifacts; that synthesis is ATOS's job at generation, not the user's. A recommendation about an input is valid ONLY when the underlying fact is missing, wrong, or too vague to act on — never to duplicate or narrate facts that already exist across the inputs.

Every entry in "improvements" must give the user precise direction on how to improve their INPUTS — the facts that ground this document — not vague edits to the prose, and not narrative expansion of an input. For each genuine gap, write one actionable sentence that:
1. names the specific grounding fact that is missing, wrong, or too vague to act on;
2. states exactly what fact to provide or correct, with a concrete worked example of the answer expected (an atomic fact, not a paragraph);
3. ties it to the score (which dimension it lifts).
Never write generic advice like "add more detail" or "be more specific" — always say WHICH fact and WHAT to write. If the document is already well-grounded by the inputs and prior artifacts, return fewer (even zero) suggestions rather than inventing gaps.

NAME THE FIELD, NEVER A PHANTOM ONE. When a recommendation is about capturing or correcting a fact, be concrete about WHERE it goes. If the fact maps to one of the inputs listed in "Structured inputs already provided", name that field exactly (e.g. "in the Sponsor input"). If NO listed input captures the fact, do NOT write "the relevant input", "the appropriate field", "the corresponding input", or any other unnamed or assumed input — that field may not exist and the user cannot find it. Instead state the fact to record plainly with its worked example (e.g. "Record the sponsor's sign-off date, e.g. '2026-04-20'"), or, when it is document-level synthesis, say it belongs in the artifact body. Never imply an input field exists unless you can name it from the provided inputs.

STAKEHOLDER SUGGESTIONS: If — and only if — this artifact is a stakeholder map, stakeholder analysis, or a scope artifact that identifies who is involved, and you can name specific stakeholder roles or people who clearly belong on the programme's stakeholder list but are NOT already captured in the inputs/prior artifacts, list each as a short role string in "suggestedStakeholders" (e.g. "VP Sales", "Delivery Manager", "Data Protection Officer"). One concise role per entry, no sentences. For any other artifact type, or when no concrete stakeholder is missing, return an empty array.

Return ONLY valid JSON:
{ "score": 0-100, "dimensions": { "completeness": 0-100, "specificity": 0-100, "actionability": 0-100, "consistency": 0-100 }, "improvements": ["Name the executive sponsor with their title in the Sponsor input (e.g. 'Jane Doe, COO') — this lifts specificity and makes accountability unambiguous", "Quantify the cost assumption (e.g. '$2.4M based on vendor quotes and a 6-person core team') so the business case can be resourced"], "suggestedStakeholders": [] }`;
  const userPrompt = `Artifact type: ${artifactLabel}

Phase scope (judge the artifact only against this phase's remit; never demand detail owned by a later phase):
${phaseScope || "Not specified"}

Structured inputs already provided (field: value) — authoritative, do not request anything already here:
${providedInputs || "None recorded"}

Prior-phase artifacts (everything established upstream) — authoritative, do not request anything already here:
${priorPhaseArtifacts || "None"}

Program context: ${phaseContext}

Artifact to review:
${artifactContent}`;
  const { parsed } = await callJsonLLM(systemPrompt, userPrompt, 400);
  return {
    score: clampNumber(parsed.score, 0, 100, 70),
    dimensions: isRecord(parsed.dimensions)
      ? Object.fromEntries(
          Object.entries(parsed.dimensions).map(([key, value]) => [key, Math.round(clampNumber(value, 0, 100, 70))]),
        )
      : {},
    improvements: uniqueStrings(parsed.improvements, 4),
    suggestedStakeholders: uniqueStrings(parsed.suggestedStakeholders, 8),
  };
}

function setInnerField(programData: ProgramState, key: string, value: JsonValue): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    [key]: value,
  }));
}

function setPhaseArtifactValue(
  programData: ProgramState,
  phaseId: string,
  artifactId: string,
  content: Record<string, unknown>,
  title: string,
  confidence?: number | null,
): ProgramState {
  // Persist the producing agent's confidence (0-1) on the ledger record so the
  // Stage view card and the phase "Artifact quality" tile show a score for the
  // document even before the independent review lands. Without this, formal
  // documents (charter, business-case, …) persist with no quality signal and
  // their cards read blank.
  const ledgerConfidence = toLedgerConfidence(confidence);
  return updateInnerProgramData(programData, (inner) => {
    const phaseArtifacts = normalizeProgramData(inner.phaseArtifacts as JsonValue | null);
    const currentPhaseArtifacts = normalizeProgramData(phaseArtifacts[phaseId] as JsonValue | null);
    return {
      ...inner,
      phaseArtifacts: {
        ...phaseArtifacts,
        [phaseId]: {
          ...currentPhaseArtifacts,
          [artifactId]: {
            ...(normalizeProgramData(currentPhaseArtifacts[artifactId] as JsonValue | null)),
            title,
            content,
            status: "draft",
            agentDrafted: true,
            agentDraftedAt: new Date().toISOString(),
            ...(typeof ledgerConfidence === "number"
              ? { confidence: ledgerConfidence / 100, agentConfidence: ledgerConfidence }
              : {}),
          } as JsonValue,
        } as JsonValue,
      } as JsonValue,
    };
  });
}

function getOpenRaidEntries(inner: ProgramState): Record<string, unknown>[] {
  const raidLog = normalizeProgramData(inner.raidLog as JsonValue | null);
  return Array.isArray(raidLog.entries)
    ? raidLog.entries.filter(isRecord).filter((entry) => entry.status !== "closed")
    : [];
}

function getExitCriteriaForPhase(inner: ProgramState, phaseId: string): Record<string, unknown>[] {
  const gateReviews = normalizeProgramData(inner.gateReviews as JsonValue | null);
  const review = normalizeProgramData(gateReviews[phaseId] as JsonValue | null);
  return Array.isArray(review.exitCriteriaStatus) ? review.exitCriteriaStatus.filter(isRecord) : [];
}

function computeReadinessForAgent(programData: ProgramState, phaseId: string): {
  score: number;
  threshold: number;
  failingChecks: Array<{ label: string; severity: "high" | "medium" | "low" }>;
} {
  const inner = getInnerProgramData(programData);
  const phases = getProgramPhaseContext(programData);
  const phase = phases.find((entry) => entry.id === phaseId);
  const threshold = 70;
  const failingChecks: Array<{ label: string; severity: "high" | "medium" | "low" }> = [];
  let score = Math.round(clampNumber(phase?.pct ?? 0, 0, 100, 0));

  const inputs = normalizeProgramData(normalizeProgramData(inner.phaseInputs as JsonValue | null)[phaseId] as JsonValue | null);
  const hasInputs = Object.keys(inputs).filter((key) => !key.startsWith("_") && String(inputs[key] || "").trim()).length > 0;
  if (!hasInputs) {
    failingChecks.push({ label: "Structured phase inputs are missing", severity: "high" });
    score -= 20;
  }

  const narrative = typeof inner.narrative === "string" ? inner.narrative.trim() : "";
  if (!narrative) {
    failingChecks.push({ label: "Narrative not generated", severity: "medium" });
    score -= 10;
  }

  const openRisks = getOpenRaidEntries(inner).filter((entry) => {
    const riskPhase = typeof entry.phase === "string" ? entry.phase : typeof entry.phaseId === "string" ? entry.phaseId : phaseId;
    return riskPhase === phaseId && ["critical", "high"].includes(String(entry.severity || ""));
  });
  if (openRisks.length) {
    failingChecks.push({ label: `${openRisks.length} unresolved high-severity risk(s)`, severity: "high" });
    score -= Math.min(20, openRisks.length * 5);
  }

  const criteria = getExitCriteriaForPhase(inner, phaseId);
  const unmetCriteria = criteria.filter((criterion) => criterion.met !== true);
  if (unmetCriteria.length) {
    failingChecks.push({ label: `${unmetCriteria.length} exit criteria still unmet`, severity: "high" });
    score -= Math.min(25, unmetCriteria.length * 6);
  }

  const openDecisions = Array.isArray(inner.decisionQueue)
    ? inner.decisionQueue.filter(isRecord).filter((entry) => (entry.phaseId === phaseId || entry.phase_id === phaseId) && entry.status !== "resolved" && entry.status !== "approved")
    : [];
  if (openDecisions.length) {
    failingChecks.push({ label: `${openDecisions.length} open decision(s) still pending`, severity: "medium" });
    score -= Math.min(15, openDecisions.length * 4);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    threshold,
    failingChecks,
  };
}

function applyGeneratedExitCriteriaToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existing = normalizeProgramData(inner.generatedExitCriteria as JsonValue | null);
    return {
      ...inner,
      generatedExitCriteria: {
        ...existing,
        [phaseId]: {
          criteria: Array.isArray(result.criteria) ? result.criteria.filter(isRecord) : [],
          confidence: clampNumber(result.confidence, 0, 1, 0.5),
          generatedAt: new Date().toISOString(),
        } as JsonValue,
      } as JsonValue,
    };
  });
}

const PLANNER_FIELD_TYPES = new Set([
  "text", "textarea", "number", "date", "select", "grid",
  // Semantic reference types — persist as a string, render as a context picker.
  "stakeholder", "organization", "document", "artifact-reference",
]);
const PLANNER_CONFIDENCE = new Set(["high", "medium", "low"]);
const PLANNER_READINESS = new Set(["green", "yellow", "red"]);
const PLANNER_ARTIFACT_READINESS = new Set(["ready", "needs_input", "blocked"]);

/**
 * Words that signal a label names a deliverable (artifact) rather than an atomic
 * fact. The Phase Transition Planner must never return these as input fields —
 * users supply facts; ATOS generates artifacts. Mirrors the client guardrail in
 * dynamicSchema.ts (ARTIFACT_LIKE_WORDS / isArtifactLikeLabel).
 */
const PLANNER_ARTIFACT_WORDS = new Set([
  "plan", "summary", "report", "register", "map", "model", "deck",
  "brief", "pack", "roadmap", "assessment", "design", "artifact",
]);
function isArtifactLikeLabel(label: string): boolean {
  const words = label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const head = words[words.length - 1];
  return head ? PLANNER_ARTIFACT_WORDS.has(head) : false;
}

function plannerStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function plannerStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => plannerStr(v)).filter(Boolean) : [];
}

const PLANNER_GRID_COLUMN_TYPES = new Set(["text", "number", "select"]);
/**
 * Validate the planner's `columns` for a `grid` field into well-formed columns.
 * Mirrors the client sanitizeGridColumns: each column needs a usable `key`;
 * duplicates collapse to the first. A grid with no valid column here is unusable
 * and the caller demotes it to a textarea so imported values are never dropped.
 */
function sanitizePlannerGridColumns(raw: unknown): Record<string, JsonValue>[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Record<string, JsonValue>[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const key = plannerStr(c.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const col: Record<string, JsonValue> = { key, label: plannerStr(c.label) || key };
    const type = plannerStr(c.type);
    if (PLANNER_GRID_COLUMN_TYPES.has(type)) col.type = type;
    const options = plannerStrArray(c.options);
    if (options.length) col.options = options;
    if (plannerStr(c.placeholder)) col.placeholder = plannerStr(c.placeholder);
    const width = Number(c.width);
    if (Number.isFinite(width) && width > 0) col.width = Math.floor(width);
    out.push(col);
  }
  return out;
}

/**
 * Sanitize planner-proposed seed rows for a grid against its sanitized columns.
 * Keeps only cells whose key is a declared column, coerces values to trimmed
 * strings, assigns each row a stable id, and drops rows that end up empty. Used
 * to pre-populate grids the planner can derive from prior context (e.g. the core
 * team roster's roles, with the name column intentionally left blank for the
 * user to fill in). Returns [] when nothing usable is proposed.
 */
function sanitizePlannerGridRows(raw: unknown, columns: Record<string, JsonValue>[]): Record<string, JsonValue>[] {
  if (!Array.isArray(raw) || columns.length === 0) return [];
  const colKeys = new Set(columns.map((c) => String(c.key)));
  const out: Record<string, JsonValue>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isRecord(r)) continue;
    const row: Record<string, JsonValue> = {};
    let hasValue = false;
    for (const [k, v] of Object.entries(r)) {
      if (k === "id" || !colKeys.has(k)) continue;
      const str = typeof v === "string" ? v.trim() : (typeof v === "number" ? String(v) : "");
      row[k] = str;
      if (str) hasValue = true;
    }
    if (!hasValue) continue;
    row.id = `seed-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    out.push(row);
  }
  return out;
}

/**
 * Union planner-seeded grid rows into an existing serialized grid value, instead
 * of discarding them when the grid is already non-empty. A thin auto-derived row
 * (e.g. one roster role lifted from an imported document) must not block the
 * planner's full role spine, yet rows a user already entered must survive. A seed
 * row is added only when no existing row already matches all of its filled cells,
 * so re-seeding is idempotent and a role someone has named is never duplicated.
 * Returns the merged JSON when rows were added, or null when there is nothing to
 * add or `existing` is not a row array (a free-text value is left untouched).
 */
function unionGridSeedRows(existing: JsonValue, seedJson: string): string | null {
  let existingRows: Record<string, JsonValue>[];
  let seedRows: Record<string, JsonValue>[];
  try {
    const e = typeof existing === "string" ? JSON.parse(existing) : existing;
    const s = JSON.parse(seedJson);
    if (!Array.isArray(e) || !Array.isArray(s)) return null;
    existingRows = e.filter(isRecord);
    seedRows = s.filter(isRecord);
  } catch {
    return null;
  }
  const cell = (r: Record<string, JsonValue>, k: string) => String(r[k] ?? "").trim().toLowerCase();
  const additions = seedRows.filter((row) => {
    const keys = Object.keys(row).filter((k) => k !== "id" && String(row[k] ?? "").trim() !== "");
    if (!keys.length) return false;
    return !existingRows.some((er) => keys.every((k) => cell(er, k) === cell(row, k)));
  });
  if (!additions.length) return null;
  return JSON.stringify([...existingRows, ...additions]);
}

/**
 * Write the Phase Transition Planner's proposal straight into the program's
 * dynamicSchema for `phaseId`, replacing any prior entries for that phase. The
 * edge is the single writer: relying on the client to persist from the HTTP
 * response was fragile (a flaky round-trip silently dropped a good proposal).
 * Sanitisation mirrors the client's sanitizePlannerProposal so persisted data
 * stays identical. Accepts both the rich planner contract (fieldId /
 * artifactsToGenerate / conflictResolutionFields / gaps / nextPhase /
 * validationSummary) and the legacy flat shape, and applies the deterministic
 * input/artifact confusion guardrail.
 */
function applyPhaseInputPlannerResultToProgramData(
  programData: ProgramState,
  phaseId: string,
  result: Record<string, unknown>,
): ProgramState {
  const fieldsIn = Array.isArray(result.inputFields) ? result.inputFields : [];
  const artifactsIn = Array.isArray(result.artifactsToGenerate)
    ? result.artifactsToGenerate
    : Array.isArray(result.artifacts) ? result.artifacts : [];
  const flowIn = isRecord(result.artifactInputFlow) ? result.artifactInputFlow : {};
  const conflictsIn = Array.isArray(result.conflictResolutionFields) ? result.conflictResolutionFields : [];
  const nextPhase = isRecord(result.nextPhase) ? result.nextPhase : {};
  const summaryIn = isRecord(result.validationSummary) ? result.validationSummary : {};

  const promotedArtifacts: Record<string, JsonValue>[] = [];
  const guardrailWarnings: string[] = [];
  // Grid values the planner can derive from prior context (e.g. roster roles),
  // keyed by field id. Seeded into phaseInputs below so the grid renders
  // pre-populated; the user fills the remaining columns (e.g. names).
  const seededGridValues: Record<string, string> = {};

  const fieldIds = new Set<string>();
  const inputFields: Record<string, JsonValue>[] = [];
  for (const f of fieldsIn) {
    if (!isRecord(f)) continue;
    const id = (plannerStr(f.fieldId) || plannerStr(f.id));
    const type = plannerStr(f.type);
    if (!id || fieldIds.has(id) || !PLANNER_FIELD_TYPES.has(type)) continue;
    const label = plannerStr(f.label) || id;
    if (isArtifactLikeLabel(label)) {
      promotedArtifacts.push({ id, label, description: plannerStr(f.description) || plannerStr(f.hint) });
      guardrailWarnings.push(`Demoted artifact-like input "${label}" to artifactsToGenerate.`);
      continue;
    }
    fieldIds.add(id);
    const field: Record<string, JsonValue> = {
      id,
      label,
      type,
      required: Boolean(f.required),
      source: "ai-derived",
    };
    if (plannerStr(f.placeholder)) field.placeholder = plannerStr(f.placeholder);
    const hint = plannerStr(f.hint) || plannerStr(f.description);
    if (hint) field.hint = hint;
    if (Array.isArray(f.options)) field.options = f.options.filter((o): o is string => typeof o === "string");
    if (plannerStr(f.reasonNeeded)) field.reasonNeeded = plannerStr(f.reasonNeeded);
    const usedBy = plannerStrArray(f.usedByArtifacts);
    if (usedBy.length) field.usedByArtifacts = usedBy;
    if (plannerStr(f.prefillValue)) field.prefillValue = plannerStr(f.prefillValue);
    if (plannerStr(f.prefillSource)) field.prefillSource = plannerStr(f.prefillSource);
    const conf = plannerStr(f.confidence).toLowerCase();
    if (PLANNER_CONFIDENCE.has(conf)) field.confidence = conf;
    if (f.needsConfirmation === true) field.needsConfirmation = true;
    if (plannerStr(f.validationRule)) field.validationRule = plannerStr(f.validationRule);
    if (plannerStr(f.example)) field.example = plannerStr(f.example);
    // A grid needs columns to render its rows. Carry the planner's columns
    // through when valid; a column-less grid is unusable, so demote it to a
    // textarea (matching the client guardrail) rather than persist empty rows.
    if (type === "grid") {
      const columns = sanitizePlannerGridColumns(f.columns);
      if (columns.length) {
        field.columns = columns as JsonValue;
        const minRows = Number(f.minRows);
        if (Number.isFinite(minRows) && minRows > 0) field.minRows = Math.floor(minRows);
        const seedRows = sanitizePlannerGridRows(f.prefillRows, columns);
        if (seedRows.length) seededGridValues[id] = JSON.stringify(seedRows);
      } else {
        field.type = "textarea";
        guardrailWarnings.push(`Demoted column-less grid "${label}" to a textarea.`);
      }
    }
    inputFields.push(field);
  }

  const artifactIds = new Set<string>();
  const artifacts: Record<string, JsonValue>[] = [];
  for (const a of artifactsIn) {
    if (!isRecord(a)) continue;
    const id = (plannerStr(a.artifactId) || plannerStr(a.id));
    if (!id || artifactIds.has(id)) continue;
    artifactIds.add(id);
    const def: Record<string, JsonValue> = {
      id,
      label: (plannerStr(a.artifactName) || plannerStr(a.label)) || id,
      description: (plannerStr(a.artifactPurpose) || plannerStr(a.description)),
    };
    const reqIn = plannerStrArray(a.requiredInputs);
    if (reqIn.length) def.requiredInputs = reqIn;
    const srcIn = plannerStrArray(a.sourceArtifactsUsed);
    if (srcIn.length) def.sourceArtifactsUsed = srcIn;
    const readiness = plannerStr(a.generationReadiness).toLowerCase();
    if (PLANNER_ARTIFACT_READINESS.has(readiness)) def.generationReadiness = readiness;
    const missingIn = plannerStrArray(a.missingInputs);
    if (missingIn.length) def.missingInputs = missingIn;
    artifacts.push(def);
  }

  // Fold in demoted artifact-like inputs unless already declared.
  const artifactLabels = new Set(artifacts.map((a) => String(a.label).toLowerCase()));
  for (const promoted of promotedArtifacts) {
    const lower = String(promoted.label).toLowerCase();
    if (artifactIds.has(String(promoted.id)) || artifactLabels.has(lower)) continue;
    artifactIds.add(String(promoted.id));
    artifactLabels.add(lower);
    artifacts.push(promoted);
  }

  const artifactInputFlow: Record<string, JsonValue> = {};
  for (const [artifactId, fields] of Object.entries(flowIn)) {
    if (!artifactIds.has(artifactId) || !Array.isArray(fields)) continue;
    const refs = (fields as unknown[]).filter((id): id is string => typeof id === "string" && fieldIds.has(id));
    if (refs.length) artifactInputFlow[artifactId] = refs;
  }
  if (Object.keys(artifactInputFlow).length === 0) {
    for (const a of artifacts) {
      const reqIn = Array.isArray(a.requiredInputs) ? (a.requiredInputs as JsonValue[]) : [];
      const refs = reqIn.filter((id): id is string => typeof id === "string" && fieldIds.has(id));
      if (refs.length) artifactInputFlow[String(a.id)] = refs;
    }
  }

  const conflicts: Record<string, JsonValue>[] = [];
  const conflictIds = new Set<string>();
  for (const c of conflictsIn) {
    if (!isRecord(c)) continue;
    const fieldId = plannerStr(c.fieldId);
    if (!fieldId || conflictIds.has(fieldId)) continue;
    conflictIds.add(fieldId);
    conflicts.push({
      fieldId,
      label: plannerStr(c.label) || fieldId,
      conflictDescription: plannerStr(c.conflictDescription),
      conflictingValues: plannerStrArray(c.conflictingValues),
      requiredResolution: c.requiredResolution !== false,
      usedByArtifacts: plannerStrArray(c.usedByArtifacts),
    });
  }

  const gaps = Array.isArray(result.gaps)
    ? result.gaps.map((g) => (isRecord(g) ? plannerStr(g.description) : plannerStr(g))).filter(Boolean)
    : [];

  const planMeta: Record<string, JsonValue> = {};
  const readiness = plannerStr(nextPhase.readiness).toLowerCase();
  if (PLANNER_READINESS.has(readiness)) planMeta.readiness = readiness;
  if (plannerStr(nextPhase.rationale)) planMeta.rationale = plannerStr(nextPhase.rationale);
  if (plannerStr(nextPhase.purpose)) planMeta.purpose = plannerStr(nextPhase.purpose);
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (Object.keys(summaryIn).length) {
    planMeta.validationSummary = {
      inputCount: num(summaryIn.inputCount),
      artifactCount: num(summaryIn.artifactCount),
      conflictCount: num(summaryIn.conflictCount),
      readyArtifacts: num(summaryIn.readyArtifacts),
      blockedArtifacts: num(summaryIn.blockedArtifacts),
    };
  }
  const warnings = [...plannerStrArray(summaryIn.warnings), ...guardrailWarnings];
  if (warnings.length) planMeta.warnings = warnings;

  if (!inputFields.length && !artifacts.length && !conflicts.length) return programData;

  return updateInnerProgramData(programData, (inner) => {
    const store = normalizeProgramData(inner.dynamicSchema as JsonValue | null);
    const prevInputs = normalizeProgramData(store.inputFields as JsonValue | null);
    const prevArtifacts = normalizeProgramData(store.artifacts as JsonValue | null);
    const prevFlow = normalizeProgramData(store.artifactInputFlow as JsonValue | null);
    const prevConflicts = normalizeProgramData(store.conflicts as JsonValue | null);
    const prevGaps = normalizeProgramData(store.gaps as JsonValue | null);
    const prevPlanMeta = normalizeProgramData(store.planMeta as JsonValue | null);
    // Seed planner-derived grid values (e.g. roster roles) into this phase's
    // inputs, but never clobber a value the user has already entered.
    let phaseInputs = inner.phaseInputs as JsonValue | null;
    if (Object.keys(seededGridValues).length) {
      const allInputs = normalizeProgramData(inner.phaseInputs as JsonValue | null);
      const phaseValues = normalizeProgramData(allInputs[phaseId] as JsonValue | null);
      const nextPhaseValues = { ...phaseValues };
      let changed = false;
      for (const [fieldId, value] of Object.entries(seededGridValues)) {
        const existing = nextPhaseValues[fieldId];
        const isEmpty = existing == null || existing === "" || existing === "[]";
        if (isEmpty) { nextPhaseValues[fieldId] = value; changed = true; continue; }
        // Rows already present (e.g. a single roster role lifted from an imported
        // document). Union the planner's full set in rather than skipping, so
        // closing the prior phase always yields the complete role spine without
        // clobbering rows a user already entered.
        const merged = unionGridSeedRows(existing, value);
        if (merged) { nextPhaseValues[fieldId] = merged; changed = true; }
      }
      if (changed) phaseInputs = { ...allInputs, [phaseId]: nextPhaseValues } as JsonValue;
    }
    return {
      ...inner,
      ...(phaseInputs !== (inner.phaseInputs as JsonValue | null) ? { phaseInputs } : {}),
      dynamicSchema: {
        ...store,
        inputFields: { ...prevInputs, [phaseId]: inputFields as JsonValue },
        artifacts: { ...prevArtifacts, [phaseId]: artifacts as JsonValue },
        artifactInputFlow: { ...prevFlow, [phaseId]: artifactInputFlow as JsonValue },
        conflicts: { ...prevConflicts, [phaseId]: conflicts as JsonValue },
        gaps: { ...prevGaps, [phaseId]: gaps as JsonValue },
        planMeta: { ...prevPlanMeta, [phaseId]: planMeta as JsonValue },
      } as JsonValue,
    };
  });
}

function applyDecisionAdvisorResultToProgramData(programData: ProgramState, decisionId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    return {
      ...inner,
      decisionQueue: queue.map((decision) => (
        String(decision.id || "") === decisionId
          ? { ...decision, advisorAnalysis: result, advisorRunAt: new Date().toISOString() }
          : decision
      )) as JsonValue,
    };
  });
}

function applyContradictionResultToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const contradictions = Array.isArray(result.contradictions) ? result.contradictions.filter(isRecord) : [];
    const queue = Array.isArray(inner.decisionQueue) ? inner.decisionQueue.filter(isRecord) : [];
    const nextQueue = [...queue];
    contradictions
      .filter((entry) => String(entry.severity || "") === "critical")
      .forEach((entry) => {
        const contradictionId = String(entry.id || "");
        const alreadyExists = nextQueue.some((decision) => String(decision.sourceContradictionId || "") === contradictionId);
        if (!alreadyExists) {
          nextQueue.push({
            id: `contradiction-${contradictionId || crypto.randomUUID()}`,
            title: `Contradiction: ${truncateText(entry.description, 80)}`,
            question: typeof entry.description === "string" ? entry.description : "Critical contradiction detected.",
            type: "other",
            priority: "critical",
            status: "open",
            recommendation: typeof entry.recommendation === "string" ? entry.recommendation : "",
            phaseId,
            source: "contradiction-detector",
            sourceContradictionId: contradictionId,
            createdAt: new Date().toISOString(),
          });
        }
      });
    return {
      ...inner,
      contradictions: contradictions as JsonValue,
      contradictionsCheckedAt: new Date().toISOString(),
      decisionQueue: nextQueue as JsonValue,
    };
  });
}

/**
 * Deterministic finding id derived from (phase, domain, source) rather than the
 * model's slug. Models are unreliable slug generators, so trusting them breaks
 * cross-run dedupe/merge; deriving server-side guarantees the SAME underlying gap
 * gets the SAME id across reruns as long as its phase/domain/source are stable.
 */
function deriveFindingId(phaseId: string, domain: string, sourceItem: string, issue: string): string {
  const scope = phaseId && phaseId.trim() ? phaseId.trim() : "program";
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const source = slug(sourceItem) || slug(issue) || "finding";
  return `${scope}:${domain}:${source}`;
}

function applyCrossArtifactValidationResultToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    // Phase-scoped runs validate ONE phase, so a full replace would wipe the
    // findings other phases earned on their own runs. Merge instead: retain every
    // prior finding NOT attributed to the validated phase, then add this run's
    // findings for it. Program-wide runs (phaseId === "program") fully refresh.
    const scoped = phaseId !== "program" && phaseId !== "";
    const incoming = (Array.isArray(result.findings) ? result.findings.filter(isRecord) : [])
      .map((entry) => {
        const domain = typeof entry.domain === "string" ? entry.domain : "delivery-readiness";
        // A scoped run's findings all belong to its phase; default a missing
        // phaseId to the scoped one so the derived id and attribution are correct.
        const entryPhaseId = typeof entry.phaseId === "string" && entry.phaseId
          ? entry.phaseId
          : (scoped ? phaseId : null);
        const sourceItem = typeof entry.sourceItem === "string" ? entry.sourceItem : "";
        const issue = typeof entry.issue === "string" ? entry.issue : "";
        return {
          findingId: deriveFindingId(entryPhaseId ?? "", domain, sourceItem, issue),
          severity: ["critical", "high", "medium", "low"].includes(String(entry.severity)) ? entry.severity : "medium",
          domain,
          phaseId: entryPhaseId,
          sourceArtifact: typeof entry.sourceArtifact === "string" ? entry.sourceArtifact : "",
          targetArtifact: typeof entry.targetArtifact === "string" ? entry.targetArtifact : "",
          sourceItem,
          issue,
          recommendation: typeof entry.recommendation === "string" ? entry.recommendation : "",
          evidence: Array.isArray(entry.evidence)
            ? entry.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : [],
          confidence: clampNumber(entry.confidence, 0, 1, 0.6),
          source: "cross-artifact-validator",
        };
      });

    let mergedFindings: Record<string, unknown>[] = incoming;
    if (scoped) {
      const priorBlock = inner.crossArtifactValidation;
      const prior = (priorBlock && typeof priorBlock === "object" && Array.isArray((priorBlock as Record<string, unknown>).findings))
        ? ((priorBlock as Record<string, unknown>).findings as unknown[]).filter(isRecord)
        : [];
      const retained = prior.filter((f) => f.phaseId !== phaseId);
      mergedFindings = [...retained, ...incoming];
    }

    // What the validator verified intact this run — the links it traced and found
    // sound. Surfaces in the audit so a "clean" verdict is evidenced, not a black box.
    const checkedChain = Array.isArray(result.checkedChain)
      ? result.checkedChain.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    return {
      ...inner,
      crossArtifactValidation: {
        findings: mergedFindings as JsonValue,
        checkedChain: checkedChain as JsonValue,
        validatedPhaseId: phaseId,
        validatedAt: new Date().toISOString(),
        clean: mergedFindings.length === 0,
      } as JsonValue,
    };
  });
}

function applyDependencyCheckResultToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existing = normalizeProgramData(inner.dependencyCheck as JsonValue | null);
    return {
      ...inner,
      dependencyCheck: {
        ...existing,
        [phaseId]: {
          passed: result.passed !== false,
          issues: Array.isArray(result.issues) ? result.issues.filter(isRecord) : [],
          summary: typeof result.summary === "string" ? result.summary : "",
          checkedAt: new Date().toISOString(),
        } as JsonValue,
      } as JsonValue,
    };
  });
}

function applyBenefitsTrackerResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return setInnerField(programData, "benefitsTracking", {
    ...result,
    trackedAt: new Date().toISOString(),
  } as JsonValue);
}

function applyHandoffQualityResultToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existing = normalizeProgramData(inner.handoffQuality as JsonValue | null);
    return {
      ...inner,
      handoffQuality: {
        ...existing,
        [phaseId]: {
          ...result,
          score: Math.round(clampNumber(result.score, 0, 100, 70)),
          passed: result.passed !== false,
          missing: uniqueStrings(result.missing, 8),
          strengths: uniqueStrings(result.strengths, 8),
          reviewedAt: new Date().toISOString(),
        } as JsonValue,
      } as JsonValue,
    };
  });
}

function applyBenchmarkComparisonResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return setInnerField(programData, "benchmarkComparison", {
    ...result,
    comparedAt: new Date().toISOString(),
  } as JsonValue);
}

function applyWeeklyDigestResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return setInnerField(programData, "weeklyDigest", {
    ...result,
    generatedAt: new Date().toISOString(),
    weekOf: new Date().toISOString().slice(0, 10),
  } as JsonValue);
}

function applyDailyBriefingResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  // A gate-approved (complete) phase's work is signed off, so a blocker pinned to
  // it is a stale agent leftover (e.g. "Transformation Charter unapproved" on a
  // complete Strategy). Drop those deterministically so the briefing can't present
  // resolved work as a live blocker even if the model regresses.
  const completePhaseIds = new Set(
    getProgramPhaseContext(programData)
      .filter((p) => typeof p.id === "string" && p.id && p.status === "complete")
      .map((p) => String(p.id)),
  );
  const blockers = Array.isArray(result.blockers)
    ? result.blockers.filter((b) => !(isRecord(b) && typeof b.phase === "string" && completePhaseIds.has(b.phase)))
    : result.blockers;
  return setInnerField(programData, "dailyBriefing", {
    ...result,
    ...(blockers !== undefined ? { blockers } : {}),
    generatedAt: new Date().toISOString(),
    dateOf: new Date().toISOString().slice(0, 10),
  } as JsonValue);
}

function applyCompletionEstimateResultToProgramData(programData: ProgramState, phaseId: string, result: Record<string, unknown>): ProgramState {
  // The estimator's only durable output is the phase progress %. It is the sole
  // writer of phasePct, which feeds the progress rings, the Gantt fill and gate
  // readiness. Progress is an internal metric, not a deliverable, so we no longer
  // persist a parallel `completion-estimate` artifact or `phaseCompletionEstimates`
  // map — both duplicated this same number (the artifact also surfaced a confusing
  // pseudo-deliverable in the phase workspace).
  const estimate = Math.round(clampNumber(result.estimate, 0, 100, 0));
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    phasePct: {
      ...(normalizeProgramData(inner.phasePct as JsonValue | null)),
      [phaseId]: estimate,
    } as JsonValue,
  }));
}

function applyProgramSupportArtifact(
  programData: ProgramState,
  phaseId: string,
  artifactId: string,
  fieldKey: string,
  result: Record<string, unknown>,
  title: string,
  /**
   * Internal traceability metadata (Change 9). Stored under the `_`-prefixed key
   * so the renderer skips it — never surfaced to users, only kept for provenance.
   */
  generationMetadata?: Record<string, unknown>,
  confidence?: number | null,
): ProgramState {
  const generatedAt = typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString();
  const payload = {
    ...result,
    generatedAt,
    ...(generationMetadata ? { _generationMetadata: generationMetadata as JsonValue } : {}),
  };
  let next = setInnerField(programData, fieldKey, payload as JsonValue);
  next = setPhaseArtifactValue(next, phaseId, artifactId, payload, title, confidence);
  return next;
}

/** Convert a kebab-case agent/artifact id to camelCase (e.g. "change-impact" → "changeImpact"). */
function toCamelCaseId(id: string): string {
  return id.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}


// ─── Ontology vocabulary steering ────────────────────────────────────────────
// Deterministic mapping from the setup wizard's industry options to the
// standards vocabulary the ontology should align to. Prose-only steering left
// the choice to model judgment; this table decides it. Only vocabularies with
// REAL public URI namespaces are named — ONTOLOGY_VOCAB_PREFIXES below rejects
// everything else, so a fabricated deep link never reaches the inbox. Sectors
// whose standards have no public linked-data namespace (TM Forum SID, ACORD)
// steer to the nearest real vocabulary instead of a fake URI.

const VOCAB_FIBO = "FIBO (URIs under https://spec.edmcouncil.org/fibo/ontology/)";
const VOCAB_FHIR = "HL7 FHIR (URIs under http://hl7.org/fhir/)";
const VOCAB_GS1 = "GS1 Web Vocabulary (URIs under https://gs1.org/voc/)";
const VOCAB_CIM = "IEC CIM (URIs under http://iec.ch/TC57/)";
const VOCAB_EBU = "EBUCore (URIs under http://www.ebu.ch/metadata/ontologies/ebucore)";
const VOCAB_ORG = "W3C Organization Ontology (URIs under http://www.w3.org/ns/org#)";
const VOCAB_SCHEMA = "schema.org (URIs under https://schema.org/)";

const INDUSTRY_VOCABULARY_STEERING: Record<string, string> = {
  "financial services": `Primary: ${VOCAB_FIBO}. Fall back to ${VOCAB_SCHEMA} for generic commerce entities.`,
  "banking": `Primary: ${VOCAB_FIBO}. Fall back to ${VOCAB_SCHEMA} for generic commerce entities.`,
  "insurance": `Primary: ${VOCAB_FIBO} — it covers insurance contracts and parties; ACORD has no public URI namespace, so align ACORD concepts by name in definitions only. Fall back to ${VOCAB_SCHEMA}.`,
  "healthcare": `Primary: ${VOCAB_FHIR}. Fall back to ${VOCAB_SCHEMA}.`,
  "life sciences & pharma": `Primary: ${VOCAB_FHIR} for clinical entities; use ${VOCAB_GS1} for product/serialisation/supply-chain entities. Fall back to ${VOCAB_SCHEMA}.`,
  "retail & consumer goods": `Primary: ${VOCAB_GS1}. Fall back to ${VOCAB_SCHEMA}.`,
  "manufacturing": `Primary: ${VOCAB_GS1} for product/logistics entities. Fall back to ${VOCAB_SCHEMA}.`,
  "automotive": `Primary: ${VOCAB_GS1} for product/logistics entities; ${VOCAB_SCHEMA} carries the automotive types (Vehicle, Car…).`,
  "energy & utilities": `Primary: ${VOCAB_CIM} for grid/asset/measurement entities. Fall back to ${VOCAB_SCHEMA}.`,
  "telecommunications": `Use ${VOCAB_SCHEMA} — TM Forum SID has no public URI namespace; align SID concepts by name in definitions only.`,
  "media & entertainment": `Primary: ${VOCAB_EBU} for content/asset/rights entities. Fall back to ${VOCAB_SCHEMA}.`,
  "technology & software": `Use ${VOCAB_SCHEMA} (SoftwareApplication, Order, Invoice, Quotation…).`,
  "transportation & logistics": `Primary: ${VOCAB_GS1} (incl. EPCIS concepts). Fall back to ${VOCAB_SCHEMA}.`,
  "public sector & government": `Primary: ${VOCAB_ORG} for organisational structures; ${VOCAB_SCHEMA} for services and generic entities (GovernmentOrganization, GovernmentService…).`,
  "education": `Use ${VOCAB_SCHEMA} (Course, EducationalOrganization, LearningResource…).`,
  "travel & hospitality": `Use ${VOCAB_SCHEMA} (Flight, LodgingBusiness, Reservation…).`,
  "professional services": `Use ${VOCAB_SCHEMA} (Service, ProfessionalService, Invoice…).`,
  "other": `Use ${VOCAB_SCHEMA}.`,
};

// Segment-level sharpening for the industries whose grounding forks. Keys are
// lowercased (industry, segment) — MIRRORS INDUSTRY_SEGMENTS in
// src/v3/lib/methodology.ts; keep the two in lockstep.
const INDUSTRY_SEGMENT_STEERING: Record<string, Record<string, string>> = {
  "life sciences & pharma": {
    "clinical": `Primary: ${VOCAB_FHIR}. Fall back to ${VOCAB_SCHEMA}.`,
    "manufacturing & supply": `Primary: ${VOCAB_GS1} (serialisation, lots, EPCIS events). Fall back to ${VOCAB_SCHEMA}.`,
    "commercial": `Use ${VOCAB_SCHEMA} (accounts, contracts, orders); ${VOCAB_GS1} only for product identifiers.`,
  },
  "banking": {
    "retail banking": `Primary: ${VOCAB_FIBO} — loans, deposits, accounts modules. Fall back to ${VOCAB_SCHEMA}.`,
    "capital markets": `Primary: ${VOCAB_FIBO} — securities, derivatives, market data modules. Fall back to ${VOCAB_SCHEMA}.`,
    "payments": `Primary: ${VOCAB_FIBO} — payments and settlement concepts; ${VOCAB_SCHEMA} for PaymentMethod/Invoice style commerce entities.`,
  },
  "energy & utilities": {
    "grid operations": `Primary: ${VOCAB_CIM} — network, asset and measurement classes. Fall back to ${VOCAB_SCHEMA}.`,
    "generation": `Primary: ${VOCAB_CIM} — generation and asset classes. Fall back to ${VOCAB_SCHEMA}.`,
    "energy retail": `Use ${VOCAB_SCHEMA} for the commerce entities (Order, Invoice, Customer); ${VOCAB_CIM} for meters, assets and readings.`,
  },
  "public sector & government": {
    "citizen services": `Primary: ${VOCAB_SCHEMA} (GovernmentService, GovernmentOrganization); ${VOCAB_ORG} for organisational structures.`,
    "organisation & governance": `Primary: ${VOCAB_ORG}. Fall back to ${VOCAB_SCHEMA}.`,
  },
  "automotive": {
    "product & supply chain": `Primary: ${VOCAB_GS1}. Fall back to ${VOCAB_SCHEMA}.`,
    "dealer & commerce": `Use ${VOCAB_SCHEMA} (Vehicle, Car, Offer, Order).`,
  },
};

function ontologyVocabularySteering(industry: unknown, segment?: unknown): string {
  const industryKey = typeof industry === "string" ? industry.trim().toLowerCase() : "";
  const segmentKey = typeof segment === "string" ? segment.trim().toLowerCase() : "";
  const forked = INDUSTRY_SEGMENT_STEERING[industryKey];
  if (forked) {
    if (segmentKey && forked[segmentKey]) return forked[segmentKey];
    const base = INDUSTRY_VOCABULARY_STEERING[industryKey] ?? `Use ${VOCAB_SCHEMA}.`;
    const segments = Object.keys(forked).join(" | ");
    return `${base} This industry's grounding forks by value-chain segment (${segments}) and none was set: infer the segment from the evidence, state the inference in the summary, and steer accordingly.`;
  }
  return INDUSTRY_VOCABULARY_STEERING[industryKey]
    ?? `Use ${VOCAB_SCHEMA}. (Industry "${typeof industry === "string" ? industry : ""}" has no dedicated public vocabulary in the manifest.)`;
}

// Namespaces the alignment validator accepts — MUST cover every vocabulary the
// steering table can name.
const ONTOLOGY_VOCAB_PREFIXES = [
  "https://schema.org/",
  "http://schema.org/",
  "https://spec.edmcouncil.org/fibo/ontology/",
  "https://gs1.org/voc/",
  "https://www.gs1.org/voc/",
  "http://hl7.org/fhir/",
  "https://hl7.org/fhir/",
  "http://iec.ch/TC57/",
  "https://iec.ch/TC57/",
  "http://www.w3.org/ns/org#",
  "https://www.w3.org/ns/org#",
  "http://www.ebu.ch/metadata/ontologies/ebucore",
  "https://www.ebu.ch/metadata/ontologies/ebucore",
];

// ─── ATOS Flow: decisions, attestations, staleness ───────────────────────────
// Flow programmes run propose-then-confirm: consequential agent results become
// Tier-2 DECISIONS a human resolves instead of silent writes, every applied run
// leaves an ATTESTATION entry, and artifact stubs carry an inputs FINGERPRINT
// so the client can mark them stale the moment the movement's evidence moves.
// All three live in the programme's data blob (rawData), like every other
// structure in this app — no new tables.

function isFlowProgramme(programData: ProgramState): boolean {
  return getInnerProgramData(programData).methodology === "atos-flow";
}

/**
 * Stable fingerprint of a movement's input bucket at generation time. djb2 over
 * a key-sorted JSON of the bucket (private `_`-keys excluded). MIRRORED in
 * src/v3/components/flow/flowShellData.ts — keep the two implementations
 * byte-compatible or staleness will false-positive everywhere.
 */
function movementInputsFingerprint(programData: ProgramState, phaseId: string): string {
  const inner = getInnerProgramData(programData);
  const buckets = isRecord(inner.phaseInputs) ? inner.phaseInputs as Record<string, unknown> : {};
  const bucket = isRecord(buckets[phaseId]) ? buckets[phaseId] as Record<string, unknown> : {};
  const keys = Object.keys(bucket).filter((key) => !key.startsWith("_")).sort();
  const text = JSON.stringify(keys.map((key) => [key, bucket[key]]));
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

/** Stamp the movement-inputs fingerprint on an artifact's ledger stub. */
function stampFlowArtifactFingerprint(programData: ProgramState, phaseId: string, artifactId: string): ProgramState {
  const fingerprint = movementInputsFingerprint(programData, phaseId);
  return updateInnerProgramData(programData, (inner) => {
    const phaseArtifacts = isRecord(inner.phaseArtifacts) ? { ...(inner.phaseArtifacts as Record<string, JsonValue>) } : {};
    const bucket = isRecord(phaseArtifacts[phaseId]) ? { ...(phaseArtifacts[phaseId] as Record<string, JsonValue>) } : {};
    const stub = isRecord(bucket[artifactId]) ? { ...(bucket[artifactId] as Record<string, JsonValue>) } : {};
    bucket[artifactId] = { ...stub, inputsFingerprint: fingerprint } as JsonValue;
    phaseArtifacts[phaseId] = bucket as JsonValue;
    return { ...inner, phaseArtifacts: phaseArtifacts as JsonValue };
  });
}

/** Append an attestation entry (capped) — every applied agent action, on the record. */
function appendFlowAttestation(
  programData: ProgramState,
  entry: { agentId: string; phaseId: string; tier: 1 | 2 | 3; action: string; detail?: string },
): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const log = Array.isArray(inner.flowAttestations) ? inner.flowAttestations as JsonValue[] : [];
    return {
      ...inner,
      flowAttestations: [...log, { ts: new Date().toISOString(), ...entry } as JsonValue].slice(-200),
    };
  });
}

/** Track id slug — MIRRORED in src/v3/components/flow/flowTracks.ts. */
function trackSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "track";
}

/**
 * Governance tier for a flow agent action: 1 acts and attests, 2 proposes and
 * waits for a confirm, 3 (reserved) gates on formal approval. The planner is
 * the only tier-2 RUN today — generators act at tier 1 and any consequential
 * part of their output (e.g. the blueprint's track plan) is carved into its
 * own tier-2 decision rather than escalating the whole run.
 */
function flowAgentTier(agentId: string): 1 | 2 | 3 {
  return agentId === "phase-input-planner" ? 2 : 1;
}

/**
 * Tokens to record on the run row: the provider's reported usage when it
 * surfaces one, else a chars/4 estimate over prompt+output — the movement
 * budget ledger controls order-of-magnitude spend and must never accumulate
 * silent zeros just because a provider's stream hides its usage frames.
 */
function tokensUsedForRun(
  usage: { inputTokens: number; outputTokens: number },
  promptChars: number,
  outputChars: number,
): number {
  const reported = usage.inputTokens + usage.outputTokens;
  return reported > 0 ? reported : Math.ceil((promptChars + outputChars) / 4);
}

/** Queue an open Tier-2/3 decision for a human to resolve in the deck's inbox. */
// Optional heads-up ping (Slack-compatible webhook). Fire-and-forget: a
// missing SLACK_WEBHOOK_URL or a failed post never blocks a run.
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";
function notifyDecisionQueued(decision: Record<string, JsonValue>): void {
  if (!SLACK_WEBHOOK_URL) return;
  const title = typeof decision.title === "string" ? decision.title : "A proposal";
  fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `ATOS Flow — waiting on you in the Inbox: ${title}` }),
  }).catch(() => { /* best effort */ });
}

function queueFlowDecision(programData: ProgramState, decision: Record<string, JsonValue>): ProgramState {
  notifyDecisionQueued(decision);
  return updateInnerProgramData(programData, (inner) => {
    const list = Array.isArray(inner.flowDecisions) ? inner.flowDecisions as JsonValue[] : [];
    const id = `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      ...inner,
      flowDecisions: [...list, { id, status: "open", createdAt: new Date().toISOString(), ...decision } as JsonValue].slice(-60),
    };
  });
}

function applyArtifactQuality(programData: ProgramState, fieldKey: string, review: Record<string, unknown>, confidenceFieldKey?: string): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    [fieldKey]: {
      score: Math.round(clampNumber(review.score, 0, 100, 70)),
      dimensions: isRecord(review.dimensions) ? review.dimensions as JsonValue : {},
      improvements: uniqueStrings(review.improvements, 4),
      suggestedStakeholders: uniqueStrings(review.suggestedStakeholders, 8),
    } as JsonValue,
    ...(confidenceFieldKey ? { [confidenceFieldKey]: clampNumber(review.score, 0, 100, 70) / 100 } : {}),
  }));
}

// Persists the extra fields setup-prefill extracts that have no home in the
// 2-field wizard (sponsor, scope in/out, team size, objectives). They are written
// into phaseInputs — which the wizard's save patch never touches — so there is no
// race with the user completing the wizard, and nothing extracted is dropped.
// Existing non-empty human inputs are never overwritten.
function applySetupPrefillResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  const asText = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).join("\n");
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  };
  // phaseId → { fieldId → extracted value }
  const mapping: Record<string, Record<string, string>> = {
    strategy: { sponsor: asText(result.sponsorName), businessObjective: asText(result.objectives) },
    discover: { scopeInclusions: asText(result.scopeIn), scopeExclusions: asText(result.scopeOut) },
    mobilise: { teamSize: asText(result.estimatedTeamSize) },
  };

  return updateInnerProgramData(programData, (inner) => {
    const phaseInputs = isRecord(inner.phaseInputs) ? { ...inner.phaseInputs } : {};
    for (const [phaseId, fields] of Object.entries(mapping)) {
      const existing = normalizeProgramData(phaseInputs[phaseId] as JsonValue | null);
      const next = { ...existing };
      let changed = false;
      for (const [fieldId, value] of Object.entries(fields)) {
        const current = typeof existing[fieldId] === "string" ? (existing[fieldId] as string).trim() : "";
        if (value && !current) { next[fieldId] = value; changed = true; }
      }
      if (changed) phaseInputs[phaseId] = next;
    }
    return { ...inner, phaseInputs };
  });
}

// Feed a generated sprint plan back into the Build phase INPUT grids so planning
// fills the user-facing fields (the prior behaviour left them blank). Two writes,
// both strictly additive so existing user input is never clobbered:
//   1. The canonical "deliveryIncrements" grid (methodology field, columns
//      increment/scope/date — what the user sees as "Delivery increments &
//      cadence") is populated from the sprints, but ONLY while it is still empty.
//      The field id and column keys mirror the client methodology registry, which
//      the edge can't import — same pattern as applySetupPrefillResultToProgramData.
//   2. Any milestone-shaped grid (e.g. the ai-derived "buildPhaseMilestoneDates")
//      has its blank target-date cells backfilled per row, matched by milestone
//      name; a date the user typed is never overwritten. Grids are matched by row
//      shape (a milestone/deliverable/gate column) so this never depends on the
//      ai-derived field id, and each grid's storage format (JSON string vs array)
//      is preserved.
// Dates are stored as YYYY-MM-DD so date inputs render them.
function applySprintPlanToBuildInputs(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  const sprints = Array.isArray(result.sprints) ? result.sprints.filter(isRecord) : [];
  if (sprints.length === 0) return programData;
  const toDay = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, 10) : "");
  const milestoneNames = (sprint: Record<string, unknown>): string[] =>
    (Array.isArray(sprint.milestones) ? sprint.milestones : [])
      .map((m) => typeof m === "string" ? m.trim() : (isRecord(m) && typeof m.name === "string" ? m.name.trim() : ""))
      .filter(Boolean);

  const dayByMilestone = new Map<string, string>();
  for (const sprint of sprints) {
    const day = toDay(sprint.endDate);
    if (!day) continue;
    for (const name of milestoneNames(sprint)) {
      const key = name.toLowerCase();
      if (!dayByMilestone.has(key)) dayByMilestone.set(key, day);
    }
  }

  const incrementRows = sprints.map((sprint, index) => {
    const number = typeof sprint.sprintNumber === "number" ? sprint.sprintNumber : index + 1;
    const names = milestoneNames(sprint);
    const goal = typeof sprint.goal === "string" ? sprint.goal.trim() : "";
    return {
      increment: `Sprint ${number}`,
      scope: names.length ? names.join(", ") : goal,
      date: toDay(sprint.endDate),
      id: `sprintplan-${number}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }).filter((row) => row.scope || row.date);

  return updateInnerProgramData(programData, (inner) => {
    const phaseInputs = isRecord(inner.phaseInputs) ? { ...inner.phaseInputs } : {};
    const buildInputs = normalizeProgramData(phaseInputs.build as JsonValue | null);
    const nextBuild = { ...buildInputs };
    let changed = false;

    // (1) deliveryIncrements — populate only while the grid is still empty.
    const existingInc = typeof buildInputs.deliveryIncrements === "string"
      ? safeJsonParse<unknown>(buildInputs.deliveryIncrements, null)
      : buildInputs.deliveryIncrements;
    const existingIncRows = Array.isArray(existingInc) ? existingInc.filter(isRecord) : [];
    const incHasContent = existingIncRows.some((row) =>
      ["increment", "scope", "date"].some((k) => typeof row[k] === "string" && (row[k] as string).trim()));
    if (!incHasContent && incrementRows.length > 0) {
      nextBuild.deliveryIncrements = JSON.stringify(incrementRows) as JsonValue;
      changed = true;
    }

    // (2) milestone-shaped grids — backfill blank target-date cells per row.
    if (dayByMilestone.size > 0) {
      for (const [fieldKey, value] of Object.entries(buildInputs)) {
        const parsed = typeof value === "string" ? safeJsonParse<unknown>(value, null) : value;
        const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
        const isMilestoneGrid = rows.length > 0
          && rows.some((row) => Object.keys(row).some((key) => /milestone|deliverable|gate/i.test(key)));
        if (!isMilestoneGrid) continue;
        let gridChanged = false;
        const nextRows = rows.map((row) => {
          const nameKey = Object.keys(row).find((key) => /milestone|name|title/i.test(key));
          const dateKey = Object.keys(row).find((key) => /targetdate|date|due/i.test(key)) || "targetDate";
          const name = nameKey && typeof row[nameKey] === "string" ? (row[nameKey] as string).trim().toLowerCase() : "";
          const current = typeof row[dateKey] === "string" ? (row[dateKey] as string).trim() : "";
          const scheduled = name ? dayByMilestone.get(name) : undefined;
          if (scheduled && !current) { gridChanged = true; return { ...row, [dateKey]: scheduled }; }
          return row;
        });
        if (gridChanged) {
          nextBuild[fieldKey] = (typeof value === "string" ? JSON.stringify(nextRows) : nextRows) as JsonValue;
          changed = true;
        }
      }
    }

    if (!changed) return inner;
    phaseInputs.build = nextBuild as JsonValue;
    return { ...inner, phaseInputs };
  });
}

function applyStakeholderRiskResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const existing = Array.isArray(inner.stakeholders) ? inner.stakeholders.filter(isRecord) : [];
    const risks = Array.isArray(result.stakeholderRisks) ? result.stakeholderRisks.filter(isRecord) : [];
    const updated = existing.map((s) => {
      const match = risks.find((r) => r.name === s.name || r.id === s.id);
      if (!match) return s;
      return { ...s, engagementRisk: typeof match.risk === "string" ? match.risk : null, engagementRiskReason: typeof match.reason === "string" ? match.reason : null };
    });
    return { ...inner, stakeholders: updated, stakeholderRiskCheckedAt: new Date().toISOString() };
  });
}

function applyBenefitForecastResultToProgramData(programData: ProgramState, result: Record<string, unknown>): ProgramState {
  return updateInnerProgramData(programData, (inner) => ({
    ...inner,
    benefitForecast: {
      forecastedRealization: typeof result.forecastedRealization === "number" ? Math.max(0, Math.min(100, result.forecastedRealization)) : null,
      trajectoryStatus: typeof result.trajectoryStatus === "string" ? result.trajectoryStatus : "unknown",
      gaps: Array.isArray(result.gaps) ? result.gaps.filter((g): g is string => typeof g === "string") : [],
      recommendation: typeof result.recommendation === "string" ? result.recommendation : null,
      projectedFinalValue: typeof result.projectedFinalValue === "number" ? result.projectedFinalValue : null,
      computedAt: new Date().toISOString(),
    },
  }));
}

function buildContextSnapshot(
  request: RunAgentRequest,
  programData: ProgramState,
  memoryContext: string,
  priorPhaseContext: string,
): Record<string, JsonValue> {
  // The generic phase-agent prompt (buildAgentPrompt's fallback branch) consumes
  // this snapshot directly. Formal/special agents get their inputs through
  // buildSpecialAgentInputContext, but a dynamic phase's captured field values
  // would otherwise never reach the model. Surface them here as citable grounding
  // facts so every artifact is generated against the inputs the user supplied.
  const inner = getInnerProgramData(programData);
  const phaseInputs = normalizeProgramData(
    normalizeProgramData(inner.phaseInputs as JsonValue | null)[request.phaseId] as JsonValue | null,
  );
  return {
    programName: typeof programData.programName === "string" ? programData.programName : "",
    programObjective: typeof programData.programObjective === "string" ? programData.programObjective : "",
    phaseId: request.phaseId,
    agentId: request.agentId,
    triggerEvent: request.triggerEvent || "",
    memoryContext,
    priorPhaseContext,
    phaseInputs: phaseInputs as JsonValue,
    groundingFacts: buildGroundingFacts(phaseInputs) as JsonValue,
    incomingHandoff: (request.incomingHandoff || null) as JsonValue | null,
    readiness: (programData.phaseGuidance as Record<string, Record<string, JsonValue>> | undefined)?.[request.phaseId]?.readiness ?? null,
  };
}

/**
 * A compact, ordered "phase timeline" for prompts whose reasoning spans the ATOS
 * sequence (change impact peaks per phase; stakeholder engagement shifts per
 * phase). Lists each STARTED phase — inactive phases carry no work yet, so they
 * would only invite speculation — with its status and objective, so the model
 * anchors its output to real phases instead of inferring the sequence from the
 * raw context JSON. Returns "" when no phase has started.
 */
function buildPhaseTimeline(programData: ProgramState): string {
  const started = getProgramPhaseContext(programData).filter(
    (p) => (typeof p.status === "string" ? p.status : "") !== "inactive",
  );
  if (!started.length) return "";
  return started
    .map((p, i) => {
      const name = typeof p.name === "string" && p.name ? p.name : String(p.id);
      const status = typeof p.status === "string" && p.status ? p.status : "active";
      const objective = typeof p.objective === "string" && p.objective.trim()
        ? p.objective.trim()
        : "(no objective recorded)";
      return `${i + 1}. ${name} (phaseId="${p.id}", ${status}) — ${objective}`;
    })
    .join("\n");
}

function buildAgentPrompt(
  request: RunAgentRequest,
  programData: ProgramState,
  contextSnapshot: Record<string, JsonValue>,
  specialAgentInputContext = "",
): { system: string; user: string } {
  if (request.agentId === "narrative") {
    return {
      system: `You are the ATOS Narrative Agent. Your job is to write a single, precise 2-3 sentence executive narrative for a transformation program.

The narrative must answer three questions in plain English:
1. Where is the transformation right now? (active phase, readiness %)
2. What is the most important thing happening or blocking it?
3. What should happen next to keep momentum?

Rules:
- Write in present tense. No jargon. No hedging.
- If the program has less than one phase with measurable progress and no artifacts, respond with: { "narrative": null, "reason": "insufficient_data" }
- Otherwise respond with: { "narrative": "<2-3 sentences>", "generatedAt": "<ISO timestamp>", "confidence": <0.0-1.0>, "dataPoints": ["<what you used>"] }

Input context will be provided as JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "risk") {
    return {
      system: `You are the ATOS Risk Agent. Your job is to scan a transformation program and identify risks and blockers that the team should be aware of.

For each item you identify, produce a structured entry. Focus on:
- Risks: things that could go wrong if not addressed (probability x impact)
- Blockers: things that are actively preventing progress right now
- Assumptions: beliefs the program is built on that haven't been validated
- Dependencies: external things the program needs that are not yet confirmed

Severity rules:
- critical: will stop the program or destroy value if not resolved in <48h
- high: will cause phase failure if not resolved in <1 week
- medium: slows down progress but has a workaround
- low: worth tracking but not time-sensitive

Confidence rules:
- Only include items where you have evidence in the program data
- Never fabricate risks that aren't supported by the context
- If a phase has <10% readiness and no artifacts, flag it as a potential blocker

State-awareness rules (avoid stale / false findings):
- Check each artifact's status field before flagging it. Treat any artifact whose status is "approved" as complete and accepted. NEVER raise a risk, blocker, assumption, or dependency claiming an approved artifact is unapproved, still in draft, pending sign-off, or not baselined.
- The delivery plan and the milestones are part of the strategic roadmap artifact (carried as strategicRoadmap.deliveryPlan and strategicRoadmap.milestones), not standalone artifacts. When the strategic roadmap is approved, the delivery plan and milestones are baselined and approved by definition. NEVER flag the delivery plan or milestones as not baselined, not approved, missing, or pending sign-off while the strategic roadmap is approved.
- Phase exit is governed solely by artifact approval and artifact quality. Do NOT flag the absence of "phase exit criteria" or "exit gates" as a risk or blocker — that concept is not part of this methodology.
- The programme timeline lives on the Strategy phase inputs (startDate and targetEndDate); every phase's roadmap window is derived from it. When those dates are present, NEVER raise a finding claiming there are no milestones, no timelines, no estimated dates, or no schedule for any/all phases.
- Phase and artifact owners live on the Mobilise core team roster (named people with roles). When that roster has named members, NEVER raise a finding claiming there are no owners or no accountable parties for the work.
- The programme objective and the key health indicators / KPIs live on the Strategy phase inputs (businessObjective, kpis, successMetric) and the approved Transformation Charter (objectives, successCriteria). When those are present, NEVER raise a finding claiming the program objective, goals, vision, KPIs, health indicators, or success metrics are missing or undefined.
- Every finding must hold against the CURRENT artifacts and phases in the input. Do not restate a finding the present state has already resolved.

Not-ready condition: if no phases have measurable progress and no artifacts exist, respond with:
{ "raidEntries": null, "reason": "insufficient_data" }

Otherwise respond with:
{
  "raidEntries": [
    {
      "id": "<uuid-style string>",
      "type": "risk" | "blocker" | "assumption" | "dependency",
      "title": "<concise title, max 80 chars>",
      "description": "<1-2 sentences explaining the issue>",
      "severity": "critical" | "high" | "medium" | "low",
      "phase": "<phase ID>",
      "owner": "<suggested owner or null>",
      "mitigation": "<recommended action or null>",
      "relatedArtifactId": "<id of the artifact this finding traces to, or null>",
      "relatedInputIds": ["<input field id this finding relates to>", "..."],
      "agentConfidence": <0.0-1.0>
    }
  ],

Drill-down rules:
- Always set relatedArtifactId to the specific artifact id that surfaced the finding when one exists (use the ids present in the input context's artifacts/phases). Set it to null only for findings not tied to any artifact.
- Populate relatedInputIds with the captured input field ids the finding depends on (e.g. a missing/weak input). Use [] when none apply.
- Use ONLY ids that appear in the provided context — never invent ids.
  "generatedAt": "<ISO timestamp>",
  "confidence": <overall confidence 0.0-1.0>,
  "summary": "<1 sentence executive summary of the risk posture>"
}

Input context will be provided as JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "milestone") {
    return {
      system: `You are the Milestone Agent for an enterprise transformation program.

Derive a milestone plan for this program. For each milestone:
- Assign a clear title tied to a phase exit or value delivery event
- Set status: "on-track" if phase pct >= 70 and no high blockers, "at-risk" if pct 40-69 or medium blocker exists, "delayed" if pct < 40 or high blocker on critical path, "complete" if phase pct >= 95
- Estimate a target date based on phase progress, known timing signals, or explicit ETA fields if present. If there is no credible basis for a date, return null.
- List exit criteria (2-4 specific conditions that must be true)
- Note dependencies on other milestones
- Assign confidence 0.0-1.0 based on phase readiness and blocker state

Rules:
- Preserve alignment with any existing plan milestones already present in the context
- Human-created milestones will be preserved separately, so do not try to rewrite them
- Return JSON only in this shape:
{
  "milestones": [
    {
      "id": "m_<phaseId>_<index>",
      "title": string,
      "phaseId": string,
      "targetDate": "YYYY-MM-DD" | null,
      "status": "on-track" | "at-risk" | "delayed" | "complete",
      "dependsOn": string[],
      "exitCriteria": string[],
      "confidence": number,
      "source": "agent"
    }
  ]
}

If the program has no phases with meaningful data (all pct = 0), return { "milestones": null }.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "budget") {
    return {
      system: `You are the Budget & Benefits Agent for an enterprise transformation program.

Assess the financial health of this program:

1. Estimate burn rate health based on phase velocity versus plan.
2. Assess value delivery rate — are benefits likely to land on schedule given current milestone status?
3. Derive an overall budget health signal: green (on track), amber (at risk), red (likely overrun).
4. Write a one-sentence health reason explaining the signal.
5. For each phase, assess whether it appears on-budget, overspend, or underspend based on phase progress versus expected duration.
6. Identify 2-4 benefit milestones tied to key phase exits.
7. Estimate ROI directionally. If projected benefits and costs are known, calculate. Otherwise use qualitative signals.

Return JSON only:
{
  "projectedCost": number | null,
  "actualSpend": number | null,
  "projectedBenefits": number | null,
  "realisedBenefits": number | null,
  "roi": number | null,
  "burnRate": "healthy" | "at-risk" | "overspend",
  "valueDeliveryRate": "ahead" | "on-track" | "behind",
  "phaseSpend": [
    {
      "phaseId": string,
      "phaseName": string,
      "budgetedEffort": string | null,
      "actualEffort": string | null,
      "status": "underspend" | "on-budget" | "overspend" | "unknown"
    }
  ],
  "benefitMilestones": [
    {
      "id": string,
      "title": string,
      "targetDate": string | null,
      "estimatedValue": string,
      "status": "pending" | "at-risk" | "realised",
      "phaseId": string
    }
  ],
  "healthSignal": "green" | "amber" | "red",
  "healthReason": string,
  "confidence": number
}

If the program has no phase data or objective, return null.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "critical-path") {
    return {
      system: `You are the Critical Path Agent for an enterprise transformation program.

Derive the critical path — the minimum ordered sequence of phases and decisions that must complete for the program's primary value to land.

Rules:
- Phases with pct >= 95 are complete — include them in the path but mark complete.
- A phase is blocked if it has a high-severity RAID entry or an unresolved critical decision.
- The bottleneck is the lowest-readiness phase on the critical path that has a blocker.
- Off-critical-path phases can slip without delaying the value delivery date.
- Estimate completion delta based on current velocity versus the number of at-risk or blocked phases.

Return JSON only:
{
  "sequence": [
    {
      "phaseId": string,
      "phaseName": string,
      "status": "complete" | "in-progress" | "blocked" | "not-started",
      "isBottleneck": boolean,
      "blockerSummary": string | null,
      "dependsOn": string[]
    }
  ],
  "currentBottleneck": {
    "phaseId": string,
    "phaseName": string,
    "reason": string,
    "linkedRiskId": string | null,
    "linkedDecisionId": string | null,
    "recommendedAction": string
  } | null,
  "offCriticalPath": string[],
  "estimatedCompletionDelta": string,
  "confidence": number
}

If no phases have meaningful data, return null.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "change-impact") {
    const timeline = buildPhaseTimeline(programData);
    const phaseWalk = timeline
      ? `\n\nThe programme moves through these phases IN ORDER. Reason phase-by-phase: anchor each impacted group's peak change window and interventions to the phase(s) that actually drive that change, and weight change load toward the active and upcoming phases:\n${timeline}`
      : "";
    return {
      system: `You are ATOS's Change Impact Intelligence agent for a Brillio transformation program.${phaseWalk}

Analyse the program context and return a JSON object with exactly this shape:
{
  "impactedGroups": [
    {
      "group": "string — team or org unit name",
      "impactLevel": "critical|high|medium|low",
      "changeType": "process|technology|culture|structural",
      "affectedHeadcount": number | null,
      "readinessScore": 0-1,
      "interventions": ["string"],
      "owner": "string | null"
    }
  ],
  "overallChangeLoad": "high|medium|low",
  "peakChangeWindow": "string — e.g. Q3 2026",
  "resistanceRisk": "high|medium|low",
  "topInterventions": ["string — max 5 cross-cutting interventions"],
  "confidence": 0-1,
  "summary": "string — 2-sentence executive summary"
}

Return ONLY valid JSON. No markdown fences.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "stakeholder") {
    const timeline = buildPhaseTimeline(programData);
    const phaseWalk = timeline
      ? `\n\nThe programme moves through these phases IN ORDER. Reason phase-by-phase: consider how each stakeholder's influence, engagement and risk of disengagement shifts across them, and set targetEngagement / recommendedActions for where the programme is now and heading next:\n${timeline}`
      : "";
    return {
      system: `You are ATOS's Stakeholder Intelligence agent for a Brillio transformation program.${phaseWalk}

Return a JSON object with exactly this shape:
{
  "stakeholders": [
    {
      "id": "string — slug",
      "name": "string",
      "role": "string",
      "organisation": "string | null",
      "influence": "high|medium|low",
      "interest": "high|medium|low",
      "currentEngagement": "champion|supportive|neutral|resistant|unknown",
      "targetEngagement": "champion|supportive|neutral",
      "sentiment": "positive|neutral|negative|unknown",
      "riskOfDisengagement": "high|medium|low",
      "recommendedActions": ["string — max 3"],
      "owner": "string | null"
    }
  ],
  "engagementSummary": "string — 2 sentences",
  "criticalRelationships": ["string — stakeholder IDs most critical to success"],
  "confidence": 0-1
}

Return ONLY valid JSON. No markdown fences.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (isProgramLevelAdoptionAgent(request.agentId, request.phaseId)) {
    const timeline = buildPhaseTimeline(programData);
    const phaseWalk = timeline
      ? `\n\nThe programme moves through these phases IN ORDER. Reason phase-by-phase: judge adoption and go-live readiness relative to where the programme is now — adoption pressure builds as it approaches and enters Operate, so do not report a not-yet-reached phase's adoption as a current shortfall:\n${timeline}`
      : "";
    return {
      system: `You are ATOS's Adoption Intelligence agent for a Brillio transformation program.${phaseWalk}

Return a JSON object with exactly this shape:
{
  "adoptionGroups": [
    {
      "group": "string",
      "adoptionRate": 0-1,
      "trainingCompletion": 0-1,
      "toolUtilisation": 0-1,
      "readinessGap": "high|medium|low|none",
      "barriers": ["string"],
      "recommendedInterventions": ["string — max 3"]
    }
  ],
  "overallAdoptionRate": 0-1,
  "adoptionTrend": "improving|stable|declining|unknown",
  "criticalAdoptionRisks": ["string"],
  "goLiveReadiness": "ready|at-risk|not-ready",
  "confidence": 0-1,
  "summary": "string"
}

Return ONLY valid JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "health-heatmap") {
    const timeline = buildPhaseTimeline(programData);
    const phaseWalk = timeline
      ? `\n\nThese are the phases that have STARTED (each with its status) — grade LIVE health only on these: a complete/approved phase is green, an in-progress one may be amber or red. EVERY other phase in the context is not-yet-reached and must be grey (score 0, topRisk null):\n${timeline}`
      : "";
    return {
      system: `You are ATOS's Health Heatmap agent for a Brillio transformation program following the ATOS 13-phase lifecycle.${phaseWalk}

Return a JSON object with exactly this shape:
{
  "phaseHealth": [
    {
      "phaseId": "string",
      "phaseName": "string",
      "rag": "green|amber|red|grey",
      "score": 0-100,
      "confidence": 0-1,
      "healthNote": "string — max 120 chars",
      "topRisk": "string | null"
    }
  ],
  "overallHealthScore": 0-100,
  "overallRag": "green|amber|red",
  "trend": "improving|stable|declining",
  "programMomentum": "accelerating|steady|slowing|stalled",
  "confidence": 0-1,
  "summary": "string"
}

Use "grey" for phases not yet started.

Grading rules (the gate is authoritative — never contradict it):
- A phase whose gateStatus is "approved" (or whose status is "complete") has passed its stakeholder gate. Grade it "green". NEVER grade an approved/complete phase red or amber, and NEVER cite missing objectives, KPIs, milestones, or exit criteria as its topRisk.
- A phase that has NOT yet started (status inactive/upcoming/pending/planned, i.e. the programme has not reached it) cannot be at risk or blocked yet. Grade it "grey" with score 0 and topRisk null. NEVER grade a not-started phase red or amber, and NEVER raise a future deliverable (e.g. an adoption plan, hypercare readiness, an operate-phase artifact) as a current risk just because the work hasn't begun — work that isn't due yet is not a live problem.
- Only phases that are in progress (started but not yet gated) may be graded amber or red. The topRisk and healthNote you report must describe an issue happening NOW in an in-progress phase, not a future one.
- The programme objective and KPIs are provided in strategyInputs (businessObjective, successMetric, kpis) and the timeline in startDate/targetEndDate. When these are present, do NOT report the objective, success metrics, KPIs, or timelines as missing — for any phase or in the overall summary.
- Base overallRag, overallHealthScore, programMomentum, trend AND the summary only on phases that are in progress or already gated. Not-started phases must NOT drag the overall score down, must NOT make momentum "stalled", and must NOT be named as blockers in the summary. The summary describes the live state of the programme today — never frame a not-yet-reached phase as blocking or stalling the programme.

Return ONLY valid JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "retro") {
    return {
      system: `You are ATOS's Retrospective agent for a Brillio ATOS transformation phase.
Analyse the phase context and return a JSON object with exactly this shape:
{
  "wentWell": [
    { "observation": "string", "impact": "string", "category": "people|process|technology|governance" }
  ],
  "improvements": [
    { "observation": "string", "rootCause": "string", "category": "people|process|technology|governance" }
  ],
  "actionItems": [
    {
      "action": "string",
      "owner": "string | null",
      "targetPhase": "string",
      "priority": "high|medium|low",
      "effort": "high|medium|low"
    }
  ],
  "overallSentiment": "positive|mixed|negative",
  "healthScore": 0-100,
  "keyLearning": "string",
  "confidence": 0-1
}
Return ONLY valid JSON. No markdown fences.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "deck") {
    return {
      system: `You are ATOS's Executive Deck agent for a Brillio transformation program.
Generate a structured executive presentation and return a JSON object with exactly this shape:
{
  "title": "string",
  "audience": "string",
  "slides": [
    {
      "slideNumber": number,
      "title": "string",
      "type": "title|executive-summary|status|financials|risks|milestones|decisions|achievements|next-steps|appendix",
      "talkingPoints": ["string"],
      "dataCallouts": ["string"],
      "recommendedVisual": "string | null",
      "speakerNotes": "string"
    }
  ],
  "generatedAt": "string",
  "confidence": 0-1,
  "programHealthSummary": "string"
}
Generate 8-12 slides. Return ONLY valid JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "deck-section") {
    return {
      system: `You are ATOS's Executive Deck section agent. Regenerate a SINGLE slide of a given type for a transformation programme.
Return ONLY valid JSON (no markdown):
{
  "slide": {
    "slideNumber": <preserve existing or use 1>,
    "title": "string",
    "type": "<same type as input sectionType>",
    "talkingPoints": ["string"],
    "dataCallouts": ["string"],
    "recommendedVisual": "string | null",
    "speakerNotes": "string"
  }
}
Rules: Keep the same slideNumber as the existing slide. Focus ONLY on the requested section type. Use the programme data provided. Max 5 talking points, 4 data callouts.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "narrative-refine") {
    return {
      system: `You are ATOS's Narrative Refinement agent. Refine an existing programme narrative based on a specific instruction.
Return ONLY valid JSON (no markdown):
{ "narrative": "string", "generatedAt": "<ISO>", "confidence": 0.0-1.0, "dataPoints": ["string"] }
Rules: Apply the refinementInstruction to the existingNarrative. Keep it 2-3 sentences. Maintain factual accuracy from the programme data. If the instruction is empty, improve clarity and conciseness.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "board-pack") {
    return {
      system: `You are ATOS's Board Pack Assembler. Synthesise all available programme data into a unified board-ready document with consistent tone and flow.
Return ONLY valid JSON (no markdown):
{
  "title": "Board Pack — <Programme Name> — <Month Year>",
  "executiveSummary": "string (3-4 sentences synthesising status, key risks, and outlook)",
  "sections": [
    {
      "id": "string",
      "title": "string",
      "type": "executive-summary|status|financials|risks|milestones|decisions|outlook",
      "content": "string (well-formatted prose, 100-300 words)",
      "highlights": ["string (max 3 bullet points)"],
      "ragStatus": "green|amber|red|null"
    }
  ],
  "confidence": 0.0-1.0
}
Rules: Always include sections: executive-summary, status, risks, outlook. Add financials only if budget data present. Add milestones only if milestone data present. Write in third person, past tense for achievements, present tense for status. Max 7 sections. Each section should flow naturally from the previous. Avoid jargon.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "scope-pcr") {
    return {
      system: `You are ATOS's Scope & PCR Intelligence agent for a Brillio transformation program.
Analyse the program for scope creep and change request signals. Return a JSON object:
{
  "scopeSignals": [
    {
      "id": "string",
      "description": "string",
      "source": "decision|risk|phase-evidence|stakeholder",
      "phase": "string",
      "severity": "critical|high|medium|low",
      "impactOnTimeline": "string | null",
      "impactOnBudget": "string | null",
      "recommendPcr": boolean,
      "pcrRationale": "string | null"
    }
  ],
  "overallScopeRisk": "high|medium|low|contained",
  "recommendedActions": ["string"],
  "openPcrCount": number,
  "confidence": 0-1,
  "summary": "string"
}
Return ONLY valid JSON.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "escalation") {
    return {
      system: `You are the Escalation Agent for an enterprise transformation program.

Apply these rules. Each input record carries verifiable fields — use them; never guess an age or assume staleness.
1. Flag a decision as "stale-decision" ONLY if its ageHours >= 48 (>= 72 for gate-approval decisions). Never flag a decision younger than that threshold, regardless of its subject. If ageHours is null you cannot establish staleness — do not flag it.
2. Flag a phase as "phase-stalled" ONLY if its status is "active" (in progress) AND hoursSinceUpdate > 120 (5 days) AND hasArtifactProgress is false. A phase can only stall once it has started: NEVER flag a phase whose status is inactive/upcoming/not-started/pending (it hasn't begun, so it cannot be "stalled" or "blocking downstream"), and never flag a completed phase. Progress is measured by artifact activity, NOT by pct: never flag a phase merely because pct is 0 or unrecorded, and never flag a phase that has artifacts (especially approved ones) — it is progressing.
3. Flag any high-severity risk or blocker older than 3 days as "critical-blocker".
4. Flag any delayed milestone with a target date inside the next 7 days as "milestone-slipping".
5. Reconcile openEscalations: for every existing open escalation, check whether its triggering condition still holds against the current input. Return the id of any escalation that is now stale — e.g. its linked decision is resolved/absent or under the age threshold, its linked phase now shows artifact progress, its linked risk/blocker is closed, or its milestone is back on track — in "resolvedEscalationIds". Do not re-raise these.

For each escalation:
- title: concise subject line
- summary: 2-3 sentences describing what is stuck and for how long
- costOfDelay: one sentence on the likely consequence if it is not resolved today
- severity: "critical" if timeline or value delivery is at risk; otherwise "high"

Do not duplicate existing open escalations. Match on type plus linked identifier.

Return JSON only:
{
  "escalations": [
    {
      "id": string,
      "type": "stale-decision" | "phase-stalled" | "critical-blocker" | "milestone-slipping",
      "severity": "high" | "critical",
      "title": string,
      "summary": string,
      "costOfDelay": string,
      "linkedDecisionId": string | null,
      "linkedPhaseId": string | null,
      "linkedRiskId": string | null,
      "raisedAt": string,
      "status": "open",
      "source": "agent"
    }
  ],
  "resolvedEscalationIds": string[]
}

If nothing meets the criteria, return { "escalations": [], "resolvedEscalationIds": [] }.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "closure") {
    return {
      system: `You are the Closure Agent generating a program closure pack.

Generate:
1. Benefits summary: planned vs realised, gap analysis, and one short paragraph of commentary.
2. Lessons learned: 6-10 lessons categorised as process, technology, people, or governance.
3. Key artifacts: the 5-8 most important artifacts at close with confidence scores.
4. Recommendations: 4-5 specific recommendations for the next similar program.
5. Readiness score: 0.0-1.0 based on phase completeness, open items, and evidence coverage.

Return JSON only:
{
  "status": "ready",
  "readinessScore": number,
  "benefitsSummary": {
    "planned": string,
    "realised": string,
    "gap": string,
    "commentary": string
  },
  "lessonsLearned": [
    {
      "category": "process"|"technology"|"people"|"governance",
      "lesson": string,
      "source": string,
      "applicability": string
    }
  ],
  "keyArtifacts": [
    { "name": string, "phaseId": string, "confidenceAtClose": number }
  ],
  "recommendations": string[],
  "confidence": number
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "artifact-reviewer") {
    return {
      system: `You are an independent artifact quality reviewer for ATOS transformation programs.
Every entry in "improvements" must give the user precise direction on how to improve their INPUTS — the facts that ground this document — not vague edits to the prose. For each weakness, write one actionable sentence that names the specific grounding fact the document lacks, states exactly what fact to add or correct with a concrete worked example, and ties it to the dimension it lifts. Never write generic advice like "add more detail" — always say WHICH fact and WHAT to write.
INPUT FIELDS ARE ATOMIC, SINGLE-PURPOSE FACTS — NOT NARRATIVE. Each input field captures one fact for its own purpose; ATOS composes the narrative FROM those facts. NEVER recommend enriching one input field by restating a fact another field already captures (e.g. do not say "add the budget and timeline to the business objective" when budget and timeline are their own fields), and NEVER recommend turning an input into a richer story or multi-fact paragraph for the document's benefit. A recommendation about an input is valid ONLY when the underlying fact is missing, wrong, or too vague to act on — never to duplicate or narrate facts that already exist across the inputs.
NAME THE FIELD, NEVER A PHANTOM ONE. When a recommendation is about capturing or correcting a fact, name the exact input it belongs to only if that input is present in the input context. If no input in the context captures the fact, do NOT write "the relevant input", "the appropriate field", or any other unnamed or assumed input — that field may not exist and the user cannot find it. Instead state the fact to record plainly with its worked example, or say it belongs in the artifact body. Never imply an input field exists unless you can name it from the input context.
Return ONLY valid JSON:
{ "score": 0-100, "dimensions": { "completeness": 0-100, "specificity": 0-100, "actionability": 0-100, "consistency": 0-100 }, "improvements": ["Name the executive sponsor with their title in the Sponsor input (e.g. 'Jane Doe, COO') — lifts specificity and makes accountability unambiguous", "Replace the open-ended timeline with a dated milestone (e.g. '2026-11-30') so the plan can sequence backwards from it"] }`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "exit-criteria-generator") {
    return {
      system: `You are an ATOS exit criteria generator for ATOS transformation programs.

Generate specific, measurable, program-tailored exit criteria for the ${request.phaseId} phase.
Each criterion must reference actual program data where possible and never be generic.

Return ONLY valid JSON:
{
  "criteria": [
    {
      "criterion": "specific measurable criterion",
      "category": "artifact|decision|approval|metric|activity",
      "owner": "role or name responsible",
      "verificationMethod": "how to verify this is met",
      "mandatory": true
    }
  ],
  "confidence": 0.0
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "decision-advisor") {
    return {
      system: `You are the ATOS Decision Advisor for transformation programs.
Analyse the decision and generate structured option analysis to help the program team decide.

Return ONLY valid JSON:
{
  "options": [
    {
      "label": "Option name",
      "description": "what this option means in practice",
      "pros": ["specific advantage 1", "specific advantage 2"],
      "cons": ["specific downside 1"],
      "effort": "low|medium|high",
      "risk": "low|medium|high",
      "timeImpactDays": 0
    }
  ],
  "recommendation": "label of recommended option",
  "recommendationRationale": "why this option is best given program context",
  "confidence": 0.0,
  "escalateTo": null
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "contradiction-detector" && isFlowProgramme(programData)) {
    return {
      system: `You are the ATOS Flow Contradiction Watcher. Compare the NEWEST evidence in the input context — the latest demonstration feedback and most recent transcript blocks — against the EARLIER record: prior transcripts, the direction decision, hard constraints, and claims the generated documents assert.

Identify only genuine DISPUTES: the new evidence says something the record asserts is otherwise. Different emphasis, added detail, or new information that extends the record is NOT a contradiction.

Return ONLY valid JSON:
{
  "contradictions": [
    {
      "statement": "<the disputed claim, one plain line>",
      "between": "<who or what vs who or what — e.g. 'Dan Reyes (demo) vs quote-table assumption'>",
      "positions": "<each side's position in one line>"
    }
  ],
  "clean": true
}

Empty contradictions with "clean": true when nothing genuinely disputes the record. Never invent disputes.`,
      // Flow programmes carry their evidence in crossPhaseContext (the classic
      // input-context builder returns empty narrative/plan for them) — when the
      // client sends the evidence record, THAT is the input to analyse.
      user: request.crossPhaseContext?.trim()
        ? `Evidence record — the input context to analyse:\n${request.crossPhaseContext}`
        : `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "contradiction-detector") {
    return {
      system: `You are the ATOS Contradiction Detector. Scan the provided program artifacts and identify logical contradictions.

Return ONLY valid JSON:
{
  "contradictions": [
    {
      "id": "unique string",
      "severity": "critical|high|medium",
      "artifactA": "narrative|plan|risk",
      "artifactB": "narrative|plan|risk",
      "description": "what specifically contradicts what",
      "recommendation": "how to resolve"
    }
  ],
  "clean": true
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "cross-artifact-validator") {
    // Walk the model phase-by-phase rather than issuing one generic "for every
    // phase" instruction: inject each STARTED phase (inactive phases carry no
    // work to validate) as a numbered step with its objective, exit criteria and
    // the ordered list of predecessors it must honour. Concrete per-phase framing
    // tightens attribution so the model sets phaseId to the right offending phase.
    const startedPhases = getProgramPhaseContext(programData).filter(
      (p) => (typeof p.status === "string" ? p.status : "") !== "inactive",
    );
    // Per-phase "Validate" scopes the run to one phase; whole-programme runs send
    // phaseId "program". When scoped, walk only the target phase and the
    // predecessors it must honour (backward fidelity needs them visible) — and
    // tell the model to emit findings only where THIS phase's work must change.
    const isPhaseScoped = !!request.phaseId && request.phaseId !== "program";
    const targetIndex = startedPhases.findIndex((p) => String(p.id) === request.phaseId);
    const targetName = targetIndex >= 0
      ? (typeof startedPhases[targetIndex].name === "string" && startedPhases[targetIndex].name
        ? String(startedPhases[targetIndex].name)
        : String(startedPhases[targetIndex].id))
      : request.phaseId;
    const walkPhases = isPhaseScoped && targetIndex >= 0
      ? startedPhases.slice(0, targetIndex + 1)
      : startedPhases;
    const phaseChecklist = walkPhases
      .map((p, i) => {
        const name = typeof p.name === "string" && p.name ? p.name : String(p.id);
        const objective = typeof p.objective === "string" && p.objective.trim()
          ? p.objective.trim()
          : "(no objective recorded)";
        const predecessors = walkPhases
          .slice(0, i)
          .map((q) => (typeof q.name === "string" && q.name ? q.name : String(q.id)));
        const exit = Array.isArray(p.exitCriteria)
          ? (p.exitCriteria as unknown[]).map((c) => String(c)).filter(Boolean)
          : [];
        const honours = predecessors.length
          ? `must honour: ${predecessors.join(", ")}`
          : "foundation — nothing precedes it; do NOT invent a backward-fidelity gap here, only flag an internal inconsistency in its own artifacts";
        const exitLine = exit.length ? `; exit criteria: ${exit.join("; ")}` : "";
        return `${i + 1}. ${name} (phaseId="${p.id}") — ${objective} [${honours}${exitLine}]`;
      })
      .join("\n");
    const phaseWalk = phaseChecklist
      ? (isPhaseScoped && targetIndex >= 0
        ? `\n\nThis run is SCOPED to ONE phase: "${targetName}" (phaseId="${request.phaseId}"). The list below gives that phase last, preceded by the phases it must honour (context only). Emit findings ONLY where the phase whose work must change is "${targetName}": set every finding's "phaseId"="${request.phaseId}". If a gap belongs to a different phase, SKIP it — that phase is validated on its own run.\n${phaseChecklist}`
        : `\n\nWalk THESE phases in order. For each, verify it honours every phase listed before it, and attribute any gap to THIS phase's id:\n${phaseChecklist}`)
      : "";
    // On a scoped rerun, show the model what it previously found for THIS phase so
    // it keeps sourceItem/domain stable (the server derives the finding id from
    // those — stable wording ⇒ stable id ⇒ clean cross-run dedupe) and does not
    // re-report a gap the artifacts have since resolved.
    let priorFindingsBlock = "";
    if (isPhaseScoped) {
      const cav = getInnerProgramData(programData).crossArtifactValidation;
      const priorList = (cav && typeof cav === "object" && Array.isArray((cav as Record<string, unknown>).findings))
        ? ((cav as Record<string, unknown>).findings as unknown[]).filter(isRecord).filter((f) => f.phaseId === request.phaseId)
        : [];
      if (priorList.length) {
        const lines = priorList.slice(0, 8).map((f) => {
          const domain = typeof f.domain === "string" ? f.domain : "";
          const sourceItem = typeof f.sourceItem === "string" ? f.sourceItem : "";
          const issue = typeof f.issue === "string" ? f.issue : "";
          return `- [${domain}] ${sourceItem ? `${sourceItem}: ` : ""}${issue}`;
        }).join("\n");
        priorFindingsBlock = `\n\nPREVIOUSLY FOUND for this phase (last run). Re-raise ONLY the ones the CURRENT artifacts still leave unaddressed; for those, keep the SAME domain and sourceItem wording so the finding keeps its identity across runs. Do NOT re-report a gap the artifacts now resolve:\n${lines}`;
      }
    }
    return {
      system: `You are the ATOS Cross-Artifact Validator — Layer 2 semantic validation.

A deterministic Layer 1 already covers structural gaps (missing owners, risks
without mitigations, milestones without exit criteria, KPIs without baselines,
gate criteria marked met without evidence) AND each formal deliverable's own
self-reported "gaps" list. DO NOT repeat any of those. Focus ONLY on semantic
traceability the deterministic layer cannot judge:
- Solution Design / Architecture that does not actually support stated requirements or NFRs.
- Business Case benefits that are not reflected in tracked KPIs.
- Milestones / workstreams that do not advance the program objective or phase objectives.
- Stakeholder change actions or interventions that do not address the stated impact.
- Scope present in objectives but absent from workstreams.

EXAMPLE of the boundary — DO NOT raise "Risk R3 has no mitigation" (that is a
Layer-1 structural gap). DO raise "R3's mitigation names a 'failover cluster' the
Solution Design never specifies" (a semantic link the structural layer cannot see).

CLOSED WORLD. Reason ONLY over what the input context contains. Reference
artifacts, KPIs, phases, milestones, workstreams, stakeholders and risks strictly
by the id/name they are given here; never assume, infer, or invent one that is not
listed. If the evidence for a gap is not present in the context, do not raise it.

OBJECTIVE KNOWLEDGE GRAPH — the input context carries an "objectiveGraph": the
programme objective and its ontology delivery chain — the KPIs that MEASURE it
(measured-by), the artifacts that DELIVER it along the phase sequence
(delivered-by), and the severe risks that THREATEN it (threatened-by). Validate
the INTEGRITY of this chain, mapping each broken link to the phase that must fix it:
- measured-by: an objective whose KPIs are absent, or a KPI flagged "weak":true
  (missing baseline or target), is not verifiably measurable — a benefits-traceability gap.
- delivered-by: a phase that has STARTED yet contributes no delivering artifact
  to the objective — or artifacts that do not trace back to the objective they
  claim to deliver — is a delivery-readiness / scope-coverage gap on THAT phase.
- threatened-by: a severe risk with no mitigation reflected in the downstream
  artifacts leaves the objective exposed — a governance / delivery-readiness gap.
Use the graph to trace the requirement→design→build chain; a link the chain
needs but the graph lacks is itself the finding.

BACKWARD PHASE FIDELITY — the phases are ordered in the ATOS sequence, each
carrying its objective, exit criteria and artifacts. For every phase, judge
whether it still HONOURS the commitments of the phases before it (the ones it
was built on). Emit a finding when a later phase:
- drops or narrows a scope item, requirement or objective an earlier phase committed to;
- contradicts a decision, constraint or design an earlier phase established;
- carries artifacts that no longer trace back to the upstream intent that justified them;
- claims readiness (gate cleared, milestone met) that its own artifacts do not substantiate.
Attribute each such finding to the LATER phase that broke fidelity: set "phaseId"
to that offending phase (NOT the upstream phase whose commitment was dropped), so
the gap lands on the phase whose work must change to close it. Name the upstream
commitment in "sourceItem" and the offending phase's artifact in "targetArtifact".${phaseWalk}${priorFindingsBlock}

SEVERITY — calibrate, do not guess:
- critical: blocks a gate, or makes a programme/phase objective unachievable as things stand.
- high: a material scope item or tracked benefit is at real risk; no viable workaround.
- medium: a genuine traceability gap that has a workaround or slack to absorb it.
- low: documentation/consistency gap with no delivery or benefit impact.

CONFIDENCE — a 0.0–1.0 estimate that the gap is BOTH real AND material given the
context. Omit any finding you would score below 0.5; prefer silence to speculation.

VOLUME — return at most 8 findings, ranked by severity then confidence. Fewer,
sharper findings beat an exhaustive list. Merge duplicates of the same root cause.
When the cap forces a cut, prefer covering distinct phases and domains over stacking
several findings on one phase — one sharp finding per phase beats eight on one.

DOMAIN — pick the one that fits the symptom:
- requirements-coverage: a requirement/NFR has no design or build that satisfies it.
- architecture-consistency: design/architecture contradicts itself or a stated constraint.
- delivery-readiness: a started phase lacks the artifact/mitigation needed to proceed.
- benefits-traceability: a benefit/objective is not measured by a sound tracked KPI.
- stakeholder-readiness: a change impact has no intervention addressing it.
- scope-coverage: scope in an objective is absent from workstreams/milestones.
- risk-controls: a tracked risk's mitigation/control is absent, or names a control the downstream artifacts never implement.
- governance: gate/decision oversight is missing or unsubstantiated (use risk-controls for risk-specific gaps).
Do NOT use artifact-completeness — missing-artifact gaps are Layer 1's job.

SHOW YOUR WORK. Every finding MUST populate "evidence" with what you checked it
against — make the basis of the check visible, not just the verdict. QUOTE the
actual text, do not paraphrase:
- the phase intent element: the phase objective, or a SPECIFIC exit criterion, you
  measured against (e.g. "checked against Design exit criterion: 'Solution
  architecture approved'");
- the knowledge-graph link you traced: the relation and node from objectiveGraph
  (e.g. "measured-by: KPI 'Win Rate' has target=null", "delivered-by: Build phase
  produced no artifact for objective", "threatened-by: risk 'Data migration'").
Where a gap is a mismatch, quote BOTH sides verbatim — the upstream commitment and
the downstream text that fails it. Keep each quote to ≤15 words; elide the middle of
longer text with "…". State at least one reference per finding; cite both intent and
graph when both apply. This surfaces in the Ontology view, so it must read as a
concrete "checked X against Y", never a bare restatement of the issue.

CLEAN CASE. Whether or not you raise findings, populate "checkedChain" with 2–5
short lines naming the links you TRACED AND FOUND INTACT (e.g. "Strategy→Design:
all 4 KPIs carry baseline+target", "Build: 3 artifacts trace to the objective").
A clean verdict must show what was verified, not be an empty result.

SELF-AUDIT before returning. Re-read each finding and DROP it unless its "evidence"
quotes text that actually appears in the input context. If you cannot point to the
exact source text, the finding is speculation — remove it. A short, fully-evidenced
list is the goal.

Output RAW JSON ONLY — no markdown, no code fences, no prose before or after. The
values below are ILLUSTRATIVE — do not copy them:
{
  "findings": [
    {
      "findingId": "deterministic slug: <phaseId>:<domain>:<short-source-slug> (reuse the SAME slug for the same underlying issue across runs)",
      "severity": "high",
      "domain": "benefits-traceability",
      "phaseId": "phase id this is attributable to, or omit for program-wide",
      "sourceArtifact": "artifact that should support something",
      "targetArtifact": "artifact it fails to support",
      "sourceItem": "specific item id/name at issue",
      "issue": "one sentence: what is not traceable/supported",
      "recommendation": "one sentence: how to close the gap",
      "evidence": ["checked against <phase intent element> / <objectiveGraph link>, quoting the text on each side"],
      "confidence": 0.82
    }
  ],
  "checkedChain": ["short line naming a link traced and found intact"],
  "clean": true
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "phase-input-planner") {
    const nextPhase = getProgramPhaseContext(programData).find((p) => p.id === request.phaseId);
    const spec = request.phaseSpec;
    const nextPhaseName = (typeof spec?.name === "string" && spec.name)
      ? spec.name
      : (typeof nextPhase?.name === "string" && nextPhase.name ? nextPhase.name : formatPhaseName(request.phaseId));
    const nextPhaseObjective = (typeof spec?.description === "string" && spec.description)
      ? spec.description
      : (typeof nextPhase?.objective === "string" ? nextPhase.objective : "");
    // The client passes the methodology's mandatory exit criteria for dynamic
    // phases (the edge can't import the methodology, and persisted phases often
    // carry no exitCriteria yet). Prefer those; fall back to anything persisted.
    const specCriteria = Array.isArray(spec?.exitCriteria) ? spec!.exitCriteria.filter((c) => typeof c === "string" && c.trim()) : [];
    const persistedCriteria = Array.isArray(nextPhase?.exitCriteria) ? (nextPhase!.exitCriteria as unknown[]).map((c) => String(c)).filter(Boolean) : [];
    const exitCriteria = specCriteria.length ? specCriteria : persistedCriteria;
    const recommendedAgents = Array.isArray(spec?.recommendedAgents) ? spec!.recommendedAgents.filter((c) => typeof c === "string" && c.trim()) : [];
    return {
      system: `You are the ATOS Phase Transition Planner.
The prior phase has just cleared its gate. For the NEXT phase ("${nextPhaseName}") identify
the inputs the team must still provide, any conflicts to resolve, and the artifacts ATOS
will generate to clear the gate.

CORE PRINCIPLE — users provide FACTS; ATOS generates ARTIFACTS.
- inputFields are ATOMIC, answerable facts (a date, a name, a number, a short list, a
  cadence, a budget range). A user can answer each in one sitting without authoring a doc.
- artifactsToGenerate are the DELIVERABLES ATOS produces FROM those facts.
- NEVER put a deliverable in inputFields. A label is a deliverable (not a fact) if it
  contains any of: plan, summary, report, register, map, model, deck, brief, pack,
  roadmap, assessment, design, artifact. Such items belong in artifactsToGenerate.
  Example — do NOT ask for "Mobilization Plan"; instead ask atomic facts (mobilization
  start date, core team members, workstream owners, governance cadence, known risks) and
  list "Mobilization Plan" under artifactsToGenerate.

Rules:
- Use facts already known from the prior-phase context; ask ONLY for what is missing,
  conflicting, or low-confidence. Do not re-ask for facts already established.
- PROGRAMME FUNDAMENTALS are inherited, never re-requested. The input context carries
  objective / businessObjective, scopeInclusions + scopeExclusions, successMetric +
  kpiBaselines, constraints, sponsor, startDate / targetEndDate and budget. When a
  fundamental is present, treat it as established context for THIS phase — do NOT add it
  as an inputField, a conflict, or a gap. Only flag a fundamental as missing if it is
  genuinely absent (empty/null) AND an artifact this phase must produce truly needs it;
  in that case prefer a single conflictResolutionField, not duplicate gaps.
- When a value can be confidently inferred from prior context, prefill it and set
  needsConfirmation:true rather than asking the user to type it from scratch.
- COVER EVERY EXIT CRITERION. Each exit criterion in the user message MUST map to at
  least one artifact in artifactsToGenerate — no criterion left uncovered, no filler.
  If NO exit criteria are recorded, do not return a thin plan: derive 3–5 concrete exit
  criteria for this phase from its objective, program type and prior-phase context, then
  propose the inputs + artifacts that satisfy each. A next phase should open with a full
  working set of artifacts (typically 4+ for a delivery phase), not a single placeholder.
- Field "type" MUST be one of: text, textarea, number, date, select, grid,
  stakeholder, organization, document, artifact-reference.
- Prefer a SEMANTIC REFERENCE type whenever the fact is a reference to a known
  entity — the UI renders these as context-aware pickers, so the captured value
  resolves to a real person/org/document/artifact instead of free text:
  • a named person (owner, sponsor, lead, approver) -> "stakeholder".
  • a named organisation, vendor, partner or department -> "organization".
  • a reference to an uploaded source document -> "document".
  • a reference to another generated artifact in this programme -> "artifact-reference".
- Otherwise choose the primitive that best fits the FACT's shape, mapping richer
  notions onto the primitives:
  • a money amount -> "number", and name the currency/unit in the label (e.g.
    "Phase budget (USD)"). • a percentage / ratio -> "number" with "%" in the label
    (e.g. "Target cost reduction (%)"). • a yes/no decision -> "select" with
    options ["Yes","No"]. • a pick-one from a known set -> "select" with options.
    • a calendar point -> "date"; for a span, use two date fields
    (e.g. "...start date" and "...end date"). Never invent a type outside the ten.
- Use "grid" for a repeating list of structured rows (e.g. team roster, RACI,
  workstream owners). A grid field MUST include a "columns" array — each column is
  { "key": "camelCaseKey", "label": "Header", "type": "text|number|select",
  "options": ["..."] (select only) }. A grid with no columns is invalid; if you
  cannot name its columns, use "textarea" instead.
- When a grid's rows can be DERIVED from the prior-phase context, pre-populate them
  with a "prefillRows" array (each row keyed by the grid's column keys). Fill only
  the columns you can ground in context and leave the columns the user must supply
  as empty strings. SPECIFICALLY for the core team roster ("coreTeamRoster"):
  derive the FULL set of core roles the programme needs — typically 5–8 distinct
  roles, NEVER just one — from the Strategy objective, scope, programType and prior
  context. Cover the spine a transformation of this type requires, e.g. Programme
  Manager, Solution Architect, Change Lead, Business Analyst, Test/QA Lead and
  Deployment/Cutover Lead, plus any role the program type clearly demands (e.g. Data
  Lead for a data migration, Integration Lead for a systems programme). Output one
  prefillRow per role with the role column set and the name column "" for the user to
  fill in. Do not invent names. Roles are AI-derived; names are user-entered.
- Use stable camelCase field ids and kebab-case artifact ids.
- EVERY input field MUST carry a concrete, programme-specific "example" showing the
  exact shape of a good answer (e.g. "2026-09-01", "USD 1.2M", "12%", "Jane Doe — CFO").
  The example must match the field's type. This is not optional.
- EVERY input field MUST carry a one-line "reasonNeeded" stating the PURPOSE — why this
  fact is needed and which decision or artifact it unblocks.
- Each artifact's "requiredInputs" lists the field ids that feed it; every input field
  must feed at least one artifact; every exit criterion must be covered by an artifact.
- Make labels specific to this programme (name the actual team, system, or market).

Return ONLY valid JSON:
{
  "nextPhase": { "readiness": "green|yellow|red", "rationale": "one sentence", "purpose": "one sentence" },
  "inputFields": [
    { "fieldId": "camelCaseId", "label": "Atomic fact label (name the unit, e.g. USD or %)", "type": "text", "required": true,
      "reasonNeeded": "PURPOSE — why this fact is needed and what it unblocks (required)", "usedByArtifacts": ["kebab-id"],
      "prefillValue": "inferred value or omit", "prefillSource": "where inferred from or omit",
      "confidence": "high|medium|low", "needsConfirmation": false,
      "example": "concrete sample answer matching the type (required)", "hint": "optional" },
    { "fieldId": "coreTeamRoster", "label": "Named individuals per core team role", "type": "grid",
      "required": true, "usedByArtifacts": ["raci-matrix"],
      "columns": [ { "key": "role", "label": "Role", "type": "text" },
                   { "key": "name", "label": "Name", "type": "text" } ],
      "prefillRows": [ { "role": "Programme Manager", "name": "" },
                       { "role": "Solution Architect", "name": "" },
                       { "role": "Change Lead", "name": "" },
                       { "role": "Business Analyst", "name": "" },
                       { "role": "Test/QA Lead", "name": "" },
                       { "role": "Deployment/Cutover Lead", "name": "" } ] }
  ],
  "artifactsToGenerate": [
    { "artifactId": "kebab-id", "artifactName": "Artifact Name",
      "artifactPurpose": "what it delivers and which exit criterion it satisfies",
      "requiredInputs": ["camelCaseId"], "generationReadiness": "ready|needs_input|blocked",
      "missingInputs": ["camelCaseId of any unmet input"] }
  ],
  "conflictResolutionFields": [
    { "fieldId": "camelCaseId", "label": "label", "conflictDescription": "what disagrees",
      "conflictingValues": ["A", "B"], "requiredResolution": true, "usedByArtifacts": ["kebab-id"] }
  ],
  "gaps": ["short description of missing information that blocks an artifact"],
  "validationSummary": { "inputCount": 0, "artifactCount": 0, "conflictCount": 0, "readyArtifacts": 0, "blockedArtifacts": 0 }
}`,
      user: `Next phase: ${nextPhaseName}${nextPhaseObjective ? `\nObjective: ${nextPhaseObjective}` : ""}
Mandatory exit criteria this phase must satisfy (every one must be covered by an artifact):
${exitCriteria.length ? exitCriteria.map((c) => `- ${c}`).join("\n") : "- (none recorded — infer from the prior-phase context and objective)"}${
        recommendedAgents.length ? `\n\nAgents that will operate in this phase (each typically needs a feeding input and produces an artifact): ${recommendedAgents.join(", ")}.` : ""
      }

Input context JSON:\n${specialAgentInputContext || "{}"}${
        typeof contextSnapshot.priorPhaseContext === "string" && contextSnapshot.priorPhaseContext
          ? `\n\nApproved artifacts from completed phases (full content — read these to ground your proposal):\n${contextSnapshot.priorPhaseContext}`
          : ""
      }`,
    };
  }

  if (request.agentId === "dependency-check") {
    return {
      system: `You are the ATOS Cross-Phase Dependency Checker.
Verify that the current phase artifacts are consistent with and build upon the prior approved phase.

Return ONLY valid JSON:
{
  "passed": true,
  "issues": [
    {
      "severity": "blocking|warning",
      "description": "what is inconsistent or missing",
      "affectedArtifact": "which artifact has the issue",
      "recommendation": "how to fix"
    }
  ],
  "summary": "one sentence verdict"
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "benefits-tracker") {
    return {
      system: `You are the ATOS Benefits Tracker for transformation programs.
Compare the original program success metrics against current evidence and rate each KPI.

When the context contains "kpiBaselines" (human-entered KPIs from the Strategy
phase, each with name/baseline/target/unit), treat those as the authoritative
baseline and target — do NOT invent or estimate baselines. Produce one output
KPI per kpiBaselines entry, carrying its name, baseline, target and unit
through, and assess current/rag/trend against that anchor. Only fall back to
inferring metrics from the objective when kpiBaselines is empty.

When the context contains "kpiActuals" (human-entered measured values recorded
at Value Realize — an array of {id,name,baseline,target,unit,actual}), use the
matching entry's "actual" verbatim as the "current" value for that KPI, matched
by name (or id). These are real measurements: do NOT estimate or override them.
Rate rag/trend by comparing that measured actual against the baseline → target.
Only estimate "current" from evidence when no actual is recorded for a KPI.

Return ONLY valid JSON:
{
  "overallRag": "green|amber|red",
  "summary": "one sentence verdict on benefits realisation progress",
  "kpis": [
    {
      "name": "KPI name",
      "baseline": "baseline value or description",
      "target": "target value",
      "unit": "unit of measure (carry through from kpiBaselines when present)",
      "current": "current value or evidence",
      "rag": "green|amber|red|unknown",
      "trend": "improving|stable|declining|unknown",
      "commentary": "one sentence"
    }
  ],
  "atRisk": ["list of KPIs at risk of not being achieved"],
  "onTrack": ["list of KPIs on track"],
  "confidence": 0.0
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "handoff-quality") {
    return {
      system: `You are the ATOS Handoff Quality Reviewer.
Assess whether this phase handoff document is complete enough to properly brief the next phase.

Return ONLY valid JSON:
{
  "score": 0-100,
  "passed": true,
  "missing": ["what is missing from the handoff"],
  "strengths": ["what is well covered"],
  "recommendation": "one sentence on what to add before passing the gate"
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "benchmark-comparator") {
    return {
      system: `You are the ATOS Benchmark Comparator.
Compare this program's profile against similar programs in the pattern library and provide calibrated assessment.

Return ONLY valid JSON:
{
  "comparisons": [
    {
      "dimension": "timeline|team size|risk count|decision velocity|phase completion",
      "programValue": "this program's value",
      "benchmarkRange": "typical range from similar programs",
      "percentile": "bottom 25%|middle 50%|top 25%",
      "signal": "concerning|normal|strong",
      "insight": "one sentence"
    }
  ],
  "overallPositioning": "below average|average|above average",
  "keyRisks": ["risk implied by the benchmark comparison"],
  "keyStrengths": ["strength implied by the comparison"],
  "summary": "two sentence benchmark verdict",
  "confidence": 0.0,
  "sampleSize": 0
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "meeting-notes") {
    return {
      system: `You are the ATOS Meeting Notes Extractor for transformation programs.
Extract structured program data from meeting notes or workshop outputs.

Return ONLY valid JSON:
{
  "decisions": [
    { "decision": "what was decided", "owner": "who owns it", "date": null, "context": "why" }
  ],
  "actions": [
    { "title": "what must be done", "owner": "role or name", "dueDate": null, "priority": "high|medium|low" }
  ],
  "risks": [
    { "title": "risk identified", "severity": "critical|high|medium|low", "owner": "role or null" }
  ],
  "openQuestions": [
    { "question": "unresolved question", "raisedBy": "role or name or null" }
  ],
  "keyInsights": ["notable insight 1", "notable insight 2"],
  "meetingType": "steering committee|team standup|workshop|client meeting|other",
  "confidence": 0.0
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "daily-briefing") {
    return {
      system: `You are the ATOS Daily Briefing Agent.
Generate a concise, actionable briefing for the programme manager at the start of each day.

Return ONLY valid JSON:
{
  "headline": "One crisp sentence summarising where the programme stands today",
  "focusItems": [
    { "item": "what needs attention today", "urgency": "now|today|this-week", "owner": "role or name", "action": "specific action to take" }
  ],
  "blockers": [
    { "description": "what is blocked", "phase": "phaseId", "impact": "what happens if not resolved" }
  ],
  "decisionsNeeded": ["decisions required today to maintain momentum"],
  "progressHighlight": "one sentence on what moved forward yesterday or most recently",
  "ragStatus": "green|amber|red",
  "generatedAt": "<ISO timestamp>",
  "confidence": 0.0
}

Rules:
- Keep focusItems to 3 or fewer. Be ruthlessly specific.
- Anchor on the live phase: the programme is in the phase named by context
  "activePhaseName" (id "activePhase"), at "activePhaseProgress"% progress. Speak
  as if that is "today". Never describe an earlier phase as current or imply the
  programme is still mobilising/starting if it has advanced past that phase.
- "activePhaseProgress" is PHASE-level, not programme-level. A freshly-entered
  active phase legitimately sits at 0% — that means the phase has just begun, NOT
  that the programme is stalled or stuck. Never call the programme "stalled",
  "stuck", or "at 0% progress" because the active phase is early; judge programme
  progress by "gatesApproved"/"phaseCount" instead.
- Progress is real and measured by context "gatesApproved" (of "phaseCount"). When
  gatesApproved > 0, the programme is NOT "at inception" and has made material
  progress — NEVER say it is "stalled" (at inception, at 0%, or otherwise), "has no
  active phase", "no progress has been made", or that foundational artifacts /
  objectives / approvals are "missing" or "unresolved". Those gatesApproved phases
  passed stakeholder sign-off, so their foundations are DONE by definition.
- A phase with status "complete" has passed its gate: its objectives, charter, exit
  criteria and roster are DONE. NEVER raise a focusItem, blocker, or decision that
  re-does completed-phase work (e.g. "define programme objectives", "assign owners
  for the Transformation Charter", "approve exit criteria") when the phase that owns
  it is complete. Focus only on the active phase and what unblocks the NEXT gate.
- Treat context fields as ground truth over your own inference: if "objective",
  "activePhaseName" or "gatesApproved" are populated, do not report them as missing
  or absent.
- If insufficient data, return { "headline": null, "reason": "insufficient_data" }`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "weekly-digest") {
    return {
      system: `You are the ATOS Weekly Digest Generator.
Produce a concise Monday morning summary for the program manager.

Return ONLY valid JSON:
{
  "weekSummary": "2-3 sentences: what is the current state of the program",
  "topPriorities": [
    { "priority": "what to focus on this week", "reason": "why this week", "owner": "role" }
  ],
  "atRisk": [
    { "item": "what is at risk", "severity": "critical|high", "mitigationSuggestion": "what to do" }
  ],
  "decisionsNeeded": ["decisions that must be made this week to maintain momentum"],
  "lastWeekHighlights": ["what was completed or progressed"],
  "weekHealthRag": "green|amber|red",
  "motivationalNote": "one encouraging sentence acknowledging progress"
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "phase-completion-estimator") {
    return {
      system: `You are the ATOS Phase Completion Estimator.
Compute an evidence-based completion estimate for the requested phase.

Return ONLY valid JSON:
{
  "estimate": 0-100,
  "signals": {
    "milestoneCompletion": 0.0,
    "exitPass": 0.0,
    "taskCompletion": 0.0,
    "artifactSignal": 0.0
  },
  "generatedAt": "ISO timestamp"
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "setup-prefill") {
    return {
      system: `Extract programme setup fields from this document.
Return JSON with keys: programName, clientName, industry, sponsorName, objectives (array of strings),
startDate (ISO), endDate (ISO), programType ("transformation"|"migration"|"implementation"|"other"),
scopeIn (array), scopeOut (array), estimatedTeamSize (number|null).
If a field cannot be determined, set it to null. Return JSON only.`,
      user: request.docText?.slice(0, 8000) || "",
    };
  }

  if (request.agentId === "discovery-guide-generator") {
    return {
      system: `You are an experienced transformation consultant.
Generate a discovery pack for this programme.
Return JSON with:
{
  "executiveInterviewGuide": { "purpose": "string", "duration": "string", "questions": ["string"] },
  "operationalInterviewGuide": { "purpose": "string", "duration": "string", "questions": ["string"] },
  "workshopAgenda": { "title": "string", "duration": "string", "objectives": ["string"], "activities": [{ "name": "string", "duration": "string", "facilitation": "string" }] },
  "documentRequestList": ["string"],
  "hypotheses": ["string"]
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "sprint-planner") {
    return {
      system: `You are an agile delivery planner.
Given Build milestones (context "milestones": rows of { name, targetDate }), the
team roster (context "team": rows naming each role, with "teamSize" as the headcount),
the sprint length (context "sprintLengthWeeks") and timeline (context "startDate"/"endDate"),
produce a sprint plan. Sequence the named milestones across sprints. When a milestone's
targetDate is blank, derive sprint dates by stepping sprintLengthWeeks forward from
startDate. Set each sprint's "capacity" from the team headcount. Never return an empty
plan when milestones are present — schedule the milestones you were given.
Return JSON:
{
  "sprints": [{ "sprintNumber": 1, "startDate": "ISO", "endDate": "ISO", "goal": "string", "milestones": ["string"], "workstreams": ["string"], "capacity": 0, "risks": ["string"] }],
  "criticalPath": ["milestone id"],
  "bufferWeeks": 0
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "stakeholder-comms-drafter") {
    return {
      system: `You are a transformation communications expert.
Draft tailored stakeholder communications.
Return JSON:
{
  "executiveSummary": { "subject": "string", "body": "string" },
  "operationalUpdate": { "subject": "string", "body": "string" },
  "talkingPoints": ["string"],
  "messagesToAvoid": ["string"]
}`,
      user: `Audience group: ${request.audienceGroup || "all"}\nInput context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "steerco-agenda-builder") {
    return {
      system: `You are a programme management expert preparing a Leadership Review (SteerCo) pack.
Produce a board-ready review, not a bare agenda. Every section must carry concrete,
data-grounded specifics — never generic placeholders. Pull names, dates, severities and
figures directly from the input context; if the data does not support a point, omit it.

Return JSON:
{
  "title": "string",
  "date": "string",
  "duration": "string",
  "attendees": ["string"],
  "executiveSummary": "2-4 sentence paragraph: where the programme stands, the headline risk posture, and the decisions this meeting must land",
  "agenda": [{
    "item": "string — the agenda line",
    "type": "information|discussion|decision|escalation",
    "owner": "string",
    "durationMins": 10,
    "materials": "string",
    "context": "1-2 sentence paragraph of framing",
    "details": ["specific bullet grounded in the data — a named risk, a dated milestone, a quantified gap"],
    "decisionRequired": "string|null — the explicit decision the board must make, if type is decision/escalation"
  }],
  "criticalBlockers": [{ "blocker": "string", "impact": "string — what slips/breaks if unresolved", "owner": "string", "neededBy": "string" }],
  "contradictions": [{ "description": "string — a conflict between two pieces of programme data (e.g. a milestone date that cannot hold given an open blocker, scope vs capacity mismatch, decisions that undercut each other)", "sources": ["string — the conflicting items"] }],
  "preReadItems": ["string"],
  "parkingLot": ["string"]
}

Rules:
- criticalBlockers: derive from open RAID blockers and high/critical risks in the context. If none, return [].
- contradictions: actively look for inconsistencies across decisions, risks, milestones and the gate review. If none are evident, return [].
- details: 2-5 bullets per agenda item, each ruthlessly specific. No filler.`,
      user: `Meeting date: ${request.meetingDate || new Date().toISOString().slice(0, 10)}\nMeeting duration: ${request.meetingDurationMins || 60}\nInput context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "kpi-validator") {
    return {
      system: `You are a measurement and evaluation expert.
Validate each KPI/success metric against SMART criteria and measurement completeness.
For each metric return:
{
  "original": "string",
  "smartScore": 0,
  "gaps": ["string"],
  "improvedVersion": "string",
  "baselineNeeded": true,
  "suggestedDataSource": "string",
  "measurementFrequency": "daily|weekly|monthly|quarterly",
  "owner": "string"
}
Return a JSON array.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "compliance-checker") {
    return {
      system: `You are a regulatory compliance expert.
Given programme context and regulatory frameworks, identify compliance gaps.
Ground every gap in the supplied context, not generic best practice:
- regulatoryContext lists the frameworks in scope — every gap must trace to one of them.
- controlMatrix lists the operational controls that enforce those frameworks, each with an owner, test status and approval status. Flag a gap when a framework has no mapping control, or a mapped control is untested or unapproved.
- auditEvidencePlan describes how compliance evidence is captured for audit. Flag a gap when it is absent or does not cover a framework in scope.
- escalationTested indicates whether escalation/breach paths have been exercised. Flag a gap when escalation has not been tested.
For each gap return:
{
  "framework": "string",
  "articleId": "string",
  "articleTitle": "string",
  "gap": "string",
  "severity": "critical|high|medium|low",
  "requiredAction": "string",
  "owner": "legal|it|programme|data-officer",
  "duePhase": "string"
}
Return a JSON array. Only flag real gaps grounded in the supplied context, not generic observations.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "capacity-assessor") {
    return {
      system: `You are a resource management expert for large transformation programmes.
Assess team capacity adequacy.
Return JSON:
{
  "overallAdequacy": "sufficient|at-risk|insufficient",
  "adequacyScore": 0,
  "roleGaps": [{ "role": "string", "currentCount": 0, "requiredCount": 0, "gap": 0, "criticality": "critical|high|medium" }],
  "skillGaps": ["string"],
  "keyPersonDependencies": ["string"],
  "recommendations": ["string"],
  "hiringLeadTimeRisk": true
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "lessons-synthesiser") {
    return {
      system: `You are a programme learning specialist.
Synthesise retrospective findings across multiple programme phases.
Return JSON:
{
  "recurringIssues": [{ "issue": "string", "phases": ["string"], "frequency": 0, "impact": "high|medium|low" }],
  "systemicProblems": ["string"],
  "consistentStrengths": ["string"],
  "programmeLearnings": ["string"],
  "recommendationsForRemainingPhases": ["string"],
  "sentimentTrend": "improving|stable|declining"
}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "vendor-risk-assessor") {
    return {
      system: `You are a vendor risk management expert.
For each vendor/partner, assess risk based on their role and programme dependency.
Return JSON array:
[{
  "vendorName": "string",
  "role": "string",
  "dependencyCriticality": "critical|high|medium|low",
  "riskFactors": ["string"],
  "mitigations": ["string"],
  "contractualCoverageAdequate": true,
  "riskScore": 0,
  "escalate": false,
  "recommendedAction": "string"
}]`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "stakeholder-risk-assessor") {
    return {
      system: `You are a stakeholder engagement analyst. Assess each stakeholder's engagement risk and return ONLY valid JSON (no markdown):
{
  "stakeholderRisks": [
    { "name": "Full Name", "risk": "high", "reason": "No decision involvement in 45 days", "lastMentioned": "2026-04-01" }
  ]
}
Rules: risk "high" | "medium" | "low". Include ALL stakeholders. Base on: decision involvement, time since last mention, number of open decisions they should be involved in.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "benefit-forecast") {
    return {
      system: `You are a benefits realisation analyst. Based on programme progress, project benefit realisation and return ONLY valid JSON (no markdown):
{
  "forecastedRealization": 73,
  "trajectoryStatus": "at-risk",
  "gaps": ["KPI tracking 8% behind schedule"],
  "recommendation": "Accelerate Build phase to recover timeline",
  "projectedFinalValue": 4200000
}
Rules: forecastedRealization 0-100 (% of projected benefits likely to be realised). trajectoryStatus: "on-track" | "at-risk" | "off-track". gaps: max 4 specific gaps. projectedFinalValue: null if insufficient data.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  if (request.agentId === "meeting-notes-extractor") {
    return {
      system: `You are a meeting notes analyst. Extract all structured information from the provided meeting transcript and return ONLY valid JSON (no markdown):
{
  "decisions": [
    { "title": "string", "description": "string", "owner": "string or null", "date": "YYYY-MM-DD or null" }
  ],
  "actionItems": [
    { "text": "string", "owner": "string or null", "dueDate": "YYYY-MM-DD or null", "priority": "high|medium|low" }
  ],
  "blockers": [
    { "description": "string", "severity": "critical|high|medium", "owner": "string or null" }
  ],
  "keyDiscussions": ["string"]
}
Rules: Extract verbatim or near-verbatim from transcript. Max 10 decisions, 15 action items, 8 blockers, 5 key discussions. If insufficient meeting content, return empty arrays with a keyDiscussions item explaining what the document contained.`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  const formalArtifactSpec = FORMAL_ARTIFACT_AGENTS[request.agentId];
  if (formalArtifactSpec) {
    return {
      system: `${formalArtifactSpec.system}\n${FORMAL_ARTIFACT_DISCIPLINE}`,
      user: `Input context JSON:\n${specialAgentInputContext || "{}"}`,
    };
  }

  const system = [
    `You are the ATOS ${request.phaseId} phase agent running server-side for the transformation program "${String(programData.programName || "Untitled Program")}".`,
    "You must produce structured, execution-ready output.",
    "If you reach a decision point where you need human input to continue, output the following marker on its own line and stop:",
    `[PAUSE_FOR_DECISION: {"reason": "...", "question": "...", "options": ["..."]}]`,
    "Do not continue generating after this marker.",
    "When you can proceed, return valid JSON only in this shape:",
    stringifyJson({
      summary: "2-3 sentence summary",
      reasoningTrace: ["step 1", "step 2"],
      confidence: 0.82,
      artifacts: [{ id: "artifact_id", title: "Artifact title", content: "Full artifact draft", summary: "2 sentence summary" }],
      decisions: [{ title: "Decision title", question: "Question", priority: "medium", options: ["option"] }],
      handoff: {
        fromAgentId: request.agentId,
        fromPhaseId: request.phaseId,
        toPhaseId: "next_phase",
        completedAt: new Date().toISOString(),
        summary: "What the next agent should know",
        keyDecisions: ["..."],
        artifactIds: ["artifact_id"],
        openQuestions: ["..."],
        confidence: 0.82,
        recommendedNextAction: "What should happen next",
      },
    }),
  ].join("\n\n");

  const user = [
    `Program context JSON: ${stringifyJson({
      objective: programData.programObjective || "",
      health: programData.currentHealthScore || null,
      phaseGuidance: (programData.phaseGuidance as Record<string, JsonValue> | undefined)?.[request.phaseId] || {},
    })}`,
    `Execution context: ${stringifyJson(contextSnapshot)}`,
    "Ground every artifact in this phase's captured inputs (see phaseInputs / groundingFacts). Use those field values directly — never restate a fact the user already supplied as an open question, and never invent details that contradict them.",
    "Perform the next meaningful unit of work for this phase. Draft artifacts only when the context supports it. Queue decisions when human review is needed.",
  ].join("\n\n");

  return { system, user };
}

function isOlderThan(timestamp: string | null | undefined, maxAgeMs: number): boolean {
  if (!timestamp) return true;
  return Date.now() - new Date(timestamp).getTime() > maxAgeMs;
}

function extractHumanNotes(programData: ProgramState, agentId: string, phaseId: string): string {
  const inner = isRecord(programData.data) ? programData.data : programData;
  const notes = Array.isArray(inner.humanNotes) ? inner.humanNotes : [];
  const relevant = (notes as Array<Record<string, unknown>>).filter((note) => {
    if (typeof note.text !== "string") return false;
    if (note.type === "narrative-correction" && agentId === "narrative") return true;
    if (note.type === "gate-note" && note.phaseId === phaseId) return true;
    if (!note.type) return true;
    return false;
  });
  if (!relevant.length) return "";
  const lines = relevant.map((note) => {
    const when = typeof note.savedAt === "string" ? new Date(note.savedAt).toLocaleDateString() : "";
    return `- [${when}] ${note.text}`;
  });
  return `\n\nHuman corrections and context (apply these when generating output):\n${lines.join("\n")}`;
}

function extractAgentServerMemory(programData: ProgramState, agentId: string): string {
  const inner = getInnerProgramData(programData);
  const memoryStore = isRecord(inner.agentServerMemory)
    ? inner.agentServerMemory as Record<string, unknown>
    : {};
  const priorMemory = Array.isArray(memoryStore[agentId]) ? memoryStore[agentId] as unknown[] : [];
  if (!priorMemory.length) return "";
  return `\n\n## Your memory from prior runs on this program\n${priorMemory.slice(-10).map((entry, index) => `${index + 1}. ${JSON.stringify(entry)}`).join("\n")}`;
}

function appendAgentServerMemory(
  programData: ProgramState,
  agentId: string,
  entry: Record<string, JsonValue>,
): ProgramState {
  return updateInnerProgramData(programData, (inner) => {
    const memoryStore = isRecord(inner.agentServerMemory)
      ? inner.agentServerMemory as Record<string, unknown>
      : {};
    const priorMemory = Array.isArray(memoryStore[agentId]) ? memoryStore[agentId] as JsonValue[] : [];
    return {
      ...inner,
      agentServerMemory: {
        ...memoryStore,
        [agentId]: [...priorMemory, entry as JsonValue].slice(-20),
      },
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let auth: AuthContext | null = null;
  let request: RunAgentRequest | null = null;
  let runId = "";

  try {
    auth = await authenticateRequest(req);
    const rawRequest = await req.json() as Partial<RunAgentRequest> & Record<string, unknown>;
    request = {
      programId: typeof rawRequest.programId === "string" ? rawRequest.programId : "",
      agentId: typeof rawRequest.agentId === "string" ? rawRequest.agentId : "",
      phaseId: typeof rawRequest.phaseId === "string" && rawRequest.phaseId
        ? rawRequest.phaseId
        : "program",
      triggeredBy: rawRequest.triggeredBy === "user"
        || rawRequest.triggeredBy === "trigger"
        || rawRequest.triggeredBy === "schedule"
        || rawRequest.triggeredBy === "handoff"
        ? rawRequest.triggeredBy
        : "schedule",
      runMode: typeof rawRequest.runMode === "string" && VALID_RUN_MODES.has(rawRequest.runMode as RunMode)
        ? rawRequest.runMode as RunMode
        : undefined,
      triggerEvent: typeof rawRequest.triggerEvent === "string" ? rawRequest.triggerEvent : undefined,
      incomingHandoff: isRecord(rawRequest.incomingHandoff) ? rawRequest.incomingHandoff as AgentHandoff : null,
      runId: typeof rawRequest.runId === "string" ? rawRequest.runId : undefined,
      crossPhaseContext: typeof rawRequest.crossPhaseContext === "string" ? rawRequest.crossPhaseContext : undefined,
      decisionId: typeof rawRequest.decisionId === "string" ? rawRequest.decisionId : undefined,
      documentId: typeof rawRequest.documentId === "string" ? rawRequest.documentId : undefined,
      artifactId: typeof rawRequest.artifactId === "string" ? rawRequest.artifactId : undefined,
      phaseSpec: isRecord(rawRequest.phaseSpec)
        ? {
            name: typeof rawRequest.phaseSpec.name === "string" ? rawRequest.phaseSpec.name : undefined,
            description: typeof rawRequest.phaseSpec.description === "string" ? rawRequest.phaseSpec.description : undefined,
            exitCriteria: Array.isArray(rawRequest.phaseSpec.exitCriteria)
              ? rawRequest.phaseSpec.exitCriteria.filter((c): c is string => typeof c === "string")
              : undefined,
            recommendedAgents: Array.isArray(rawRequest.phaseSpec.recommendedAgents)
              ? rawRequest.phaseSpec.recommendedAgents.filter((c): c is string => typeof c === "string")
              : undefined,
          }
        : undefined,
    };
    if (!request.programId || !request.agentId) {
      return jsonResponse({ error: "programId and agentId are required." }, 400);
    }

    // Server-side alias resolution (defense in depth). The client (AppShellV3
    // resolveAgentId) already remaps these "presentation" agent ids to their
    // implemented equivalents, but mirroring it here guarantees any call path —
    // direct invokes, scheduled triggers, future UI — never 400s on a known alias.
    request.agentId = AGENT_ID_ALIASES[request.agentId] ?? request.agentId;

    if (!VALID_AGENT_IDS.has(request.agentId)) {
      return jsonResponse({ error: `Unknown agentId "${request.agentId}".` }, 400);
    }

    if (request.agentId === "escalation" && request.programId === "ALL") {
      if (!auth.isService) {
        return jsonResponse({ error: "Only the service role may run escalation checks for all programs." }, 403);
      }

      const { data: programs, error: programsError } = await auth.admin
        .from("adam_programs")
        .select("id")
        .eq("is_deleted", false);
      if (programsError) {
        return jsonResponse({ error: programsError.message || "Failed to load programs." }, 500);
      }

      const results = await Promise.allSettled((programs || []).map((program) => fetch(
        `${SUPABASE_URL}/functions/v1/run-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            programId: program.id,
            agentId: "escalation",
            phaseId: "program",
            triggeredBy: "schedule",
            triggerEvent: request.triggerEvent || "cron:escalation",
          } satisfies RunAgentRequest),
        },
      )));

      return jsonResponse({
        status: "queued",
        programsProcessed: programs?.length || 0,
        successes: results.filter((result) => result.status === "fulfilled").length,
        failures: results.filter((result) => result.status === "rejected").length,
      });
    }

    // Cross-artifact validation is USER-INITIATED ONLY. It runs exclusively from
    // the Ontology view's "Validate" buttons (which send triggeredBy:"user"); it
    // must never fire from the downstream fan-out, a schedule, a handoff, or any
    // other automatic path. This is a hard backstop for that contract: reject any
    // non-user invocation before the LLM call, so no future auto-trigger can spend
    // a validation run behind the user's back.
    if (request.agentId === "cross-artifact-validator" && request.triggeredBy !== "user") {
      return jsonResponse({
        status: "skipped",
        reason: "Cross-artifact validation is user-initiated only; it runs from the Validate button, never automatically.",
        runId: null,
      });
    }

    // Coalesce redundant background runs. Tier-2/3 agents (downstream fan-out,
    // scheduled, handoff, proactive) fire far more often than needed and starve
    // user-initiated runs of provider quota. If an identical agent+program+phase
    // already completed or is running within the dedup window, skip the LLM call.
    // User runs (triggeredBy === "user") are never coalesced. The check runs
    // before this run's row is inserted, so it cannot match itself.
    const BACKGROUND_DEDUP_WINDOW_MS = 5 * 60 * 1000;
    if (request.triggeredBy !== "user") {
      const since = new Date(Date.now() - BACKGROUND_DEDUP_WINDOW_MS).toISOString();
      const { data: recentRuns } = await auth.admin
        .from("adam_agent_runs")
        .select("id")
        .eq("program_id", request.programId)
        .eq("agent_id", request.agentId)
        .eq("phase_id", request.phaseId)
        .in("status", ["complete", "running"])
        .gte("created_at", since)
        .limit(1);
      if (recentRuns && recentRuns.length > 0) {
        return jsonResponse({
          status: "skipped",
          reason: "A recent run for this agent already exists; coalesced to protect provider quota.",
          runId: null,
        });
      }
    }

    const { data: programRow, error: programError } = await auth.admin
      .from("adam_programs")
      .select("id, owner_id, name, client, industry, data, updated_at")
      .eq("id", request.programId)
      .maybeSingle();
    if (programError || !programRow) {
      return jsonResponse({
        error: programError?.message || "Program not found or not visible to this user.",
        programId: request.programId,
      }, 404);
    }

    // Membership-based access control: running an agent mutates program data, so
    // the caller must be the owner, an admin, or an editor. Viewers and
    // non-members are rejected. The service role bypasses this check.
    const programAccess = await resolveProgramAccess(
      auth,
      (programRow.owner_id as string | null) ?? null,
      request.programId,
    );
    if (programAccess === "none") {
      return jsonResponse({
        error: "Program not found or not visible to this user.",
        programId: request.programId,
      }, 404);
    }
    if (!canWrite(programAccess)) {
      return jsonResponse({
        error: "You have read-only access to this program and cannot run agents.",
        programId: request.programId,
      }, 403);
    }

    const ownerId = auth.ownerId || programRow.owner_id || null;
    const now = new Date().toISOString();
    runId = request.runId || crypto.randomUUID();
    // Phase 6 — externalization merge-on-read: reconstruct the full transcripts
    // into programRow.data before any prompt/grounding/evidence is built, so the
    // agent sees the same record the operator does. No-op if the texts table is
    // absent (pre-migration) or empty for this programme.
    await mergeProgramTextsIntoRow(auth.admin, request.programId, programRow as { data: JsonValue });
    const contextProgramData = normalizeProgramData(programRow.data as JsonValue | null);
    // Optimistic-concurrency token: every program-data write-back below uses this so
    // parallel agent cascades merge instead of clobbering each other's slices.
    const persistConcurrency = {
      base: contextProgramData,
      expectedUpdatedAt: (programRow.updated_at as string | null) ?? null,
    };
    const innerContextProgramData = getInnerProgramData(contextProgramData);
    const memoryContext = await getServerMemoryContext(auth.admin, request.programId, request.agentId, request.phaseId);
    const priorPhaseContext = getPriorPhaseContext(contextProgramData, request.phaseId);
    const contextSnapshot = buildContextSnapshot(request, contextProgramData, memoryContext, priorPhaseContext);
    const cachedPatternContext = Array.isArray(innerContextProgramData.patternQueryCache)
      ? innerContextProgramData.patternQueryCache.filter(isRecord).slice(0, 5)
      : [];
    const patternQueryCachedAt = typeof innerContextProgramData.patternQueryCachedAt === "string"
      ? innerContextProgramData.patternQueryCachedAt
      : null;
    const shouldRefreshPatternContext = isOlderThan(patternQueryCachedAt, 1000 * 60 * 60 * 6);
    // Expand pattern context to all major agents so prior-programme learning
    // influences narrative, the strategic roadmap / delivery plan, gate review,
    // and change impact (self-improvement)
    const shouldUsePatternContext = request.agentId === "risk"
      || request.agentId === "milestone"
      || request.agentId === "pattern-query"
      || request.agentId === "benchmark-comparator"
      || request.agentId === "narrative"
      || request.agentId === "strategic-roadmap"
      || request.agentId === "change-impact"
      || request.agentId === "adoption"
      || request.agentId === "health-heatmap";
    const patternContext = shouldUsePatternContext
      ? (!shouldRefreshPatternContext && cachedPatternContext.length
        ? cachedPatternContext
        : await queryPatternContext(auth.admin, {
            industry: typeof programRow.industry === "string" ? programRow.industry : null,
            phaseId: request.phaseId !== "program" ? request.phaseId : null,
            limit: 5,
          }))
      : [];
    const formalSpecForRun = FORMAL_ARTIFACT_AGENTS[request.agentId];
    const formalRunMode = formalSpecForRun
      ? deriveFormalRunMode(request, getInnerProgramData(contextProgramData), formalSpecForRun.fieldKey)
      : undefined;
    // Set when the regeneration guard turns this run's document into a Tier-2
    // decision instead of a write — the post-run stamp/attest block must not
    // record it as generated.
    let formalRegenGuarded = false;
    // Cross-phase document carry-forward: only formal-artifact agents inject the
    // stored document intelligence, so the extra read is skipped for every other
    // agent. Keep only rows whose extracted_data is a DocumentIntelligence (a
    // documentType marks the shape); meeting-notes and failed extractions differ.
    const carryForwardDocuments: CarryForwardDocument[] = [];
    if (formalSpecForRun) {
      const { data: documentRows } = await auth.admin
        .from("adam_document_attachments")
        .select("file_name, extracted_data")
        .eq("program_id", request.programId);
      for (const row of (documentRows || []) as Array<Record<string, unknown>>) {
        const intel = row.extracted_data;
        if (isRecord(intel) && "documentType" in intel) {
          carryForwardDocuments.push({
            fileName: typeof row.file_name === "string" ? row.file_name : "document",
            intelligence: intel,
          });
        }
      }
    }
    let specialAgentInputContext = isSpecialProgramAgent(request.agentId, request.phaseId)
      ? buildSpecialAgentInputContext(contextProgramData, {
          name: typeof programRow.name === "string" ? programRow.name : "",
          client: typeof programRow.client === "string" ? programRow.client : "",
          industry: typeof programRow.industry === "string" ? programRow.industry : "",
        }, {
          agentId: request.agentId,
          phaseId: request.phaseId,
        }, {
          patternContext,
          runMode: formalRunMode,
          documents: carryForwardDocuments,
        })
      : "";

    if (request.agentId === "decision-advisor" && request.decisionId) {
      const queue = Array.isArray(innerContextProgramData.decisionQueue)
        ? innerContextProgramData.decisionQueue.filter(isRecord)
        : [];
      const selectedDecision = queue.find((entry) => String(entry.id || "") === request?.decisionId) || null;
      specialAgentInputContext = JSON.stringify({
        programName: programRow.name,
        objective: innerContextProgramData.objective || "",
        selectedDecision,
        risks: getProgramRiskContext(contextProgramData),
        phaseId: request.phaseId,
      }, null, 2);
    }

    if (request.agentId === "meeting-notes" && request.documentId) {
      const { data: documentRow } = await auth.admin
        .from("adam_document_attachments")
        .select("id, raw_text, file_name, phase_context")
        .eq("id", request.documentId)
        .maybeSingle();
      specialAgentInputContext = JSON.stringify({
        programName: programRow.name,
        phaseId: request.phaseId,
        documentId: request.documentId,
        fileName: documentRow?.file_name || "",
        phaseContext: documentRow?.phase_context || request.phaseId,
        rawText: typeof documentRow?.raw_text === "string" ? documentRow.raw_text.slice(0, 4000) : "",
      }, null, 2);
    }

    // Reconciliation sweep: edge invocations are stateless and can die mid-run
    // (timeout, cold-start kill, deploy) leaving rows stuck in queued/running
    // forever. Before evaluating in-flight state, mark any run for this program
    // older than the cutoff as failed so the queue self-heals and the dedupe
    // check below never returns a dead run. Best-effort; errors are ignored.
    const inFlightCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await auth.admin
      .from("adam_agent_runs")
      .update({
        status: "failed",
        completed_at: now,
        error_message: "Reconciled: run exceeded maximum lifetime without completing.",
      })
      .eq("program_id", request.programId)
      .in("status", ["queued", "running"])
      .lt("started_at", inFlightCutoff)
      .neq("id", runId);

    // Idempotency / in-flight dedupe: if an equivalent run for this
    // (program, agent, phase) is already queued or running and was started
    // recently, return that run instead of launching a duplicate. Excludes the
    // current runId so queued/triggered runs (which reuse their own id) and
    // explicit retries of a known run are not stranded.
    const { data: inFlightRuns } = await auth.admin
      .from("adam_agent_runs")
      .select("id")
      .eq("program_id", request.programId)
      .eq("agent_id", request.agentId)
      .eq("phase_id", request.phaseId)
      .in("status", ["queued", "running"])
      .gt("started_at", inFlightCutoff)
      .neq("id", runId)
      .limit(1);
    if (inFlightRuns && inFlightRuns.length > 0) {
      return jsonResponse({
        status: "running",
        runId: inFlightRuns[0].id as string,
      } satisfies RunAgentResponse);
    }

    const { error: runUpsertError } = await auth.admin
      .from("adam_agent_runs")
      .upsert({
        id: runId,
        program_id: request.programId,
        agent_id: request.agentId,
        phase_id: request.phaseId,
        status: "running",
        trigger_event: request.triggerEvent || null,
        input_context: contextSnapshot as JsonValue,
        scheduled_by: request.triggeredBy,
        started_at: now,
        completed_at: null,
        error_message: null,
        awaiting_decision_id: null,
        owner_id: ownerId,
      }, { onConflict: "id" });

    if (runUpsertError) {
      return jsonResponse({ error: runUpsertError.message }, 500);
    }

    await emitAgentEvent(auth.admin, {
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      eventType: "triggered",
      payload: {
        triggerEvent: request.triggerEvent || null,
      },
    });

    await broadcastStatus(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      status: "running",
      latestObservationType: "context_built",
    });
    await logObservation(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      observationType: "context_built",
      payload: contextSnapshot,
    });
    await logObservation(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      observationType: "memory_retrieved",
      payload: {
        memoryContext,
        priorPhaseContext,
        hasIncomingHandoff: !!request.incomingHandoff,
      },
    });

    if (request.agentId === "pattern-query") {
      const outputPayload = {
        patterns: patternContext,
      };
      const nextProgramData = applyPatternQueryResultToProgramData(contextProgramData, outputPayload);
      await persistAgentArtifact(auth.admin, request.programId, request.agentId, request.phaseId, outputPayload, patternContext.length ? 0.75 : 0.4);
      await persistProgramData(auth.admin, request.programId, nextProgramData, persistConcurrency);
      await auth.admin
        .from("adam_agent_runs")
        .update({
          status: "complete",
          output: outputPayload as JsonValue,
          handoff: null,
          reasoning_trace: null,
          confidence: patternContext.length ? 0.75 : 0.4,
          tokens_used: 0,
          completed_at: new Date().toISOString(),
          awaiting_decision_id: null,
        })
        .eq("id", runId);
      await emitAgentEvent(auth.admin, {
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        eventType: "completed",
        payload: {
          confidence: patternContext.length ? 0.75 : 0.4,
          generatedAt: new Date().toISOString(),
          outputSummary: `${patternContext.length} patterns matched`,
        },
      });
      await broadcastStatus(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        status: "complete",
        confidence: patternContext.length ? 0.75 : 0.4,
        latestObservationType: "response_received",
      });
      return jsonResponse({
        status: "complete",
        runId,
        output: outputPayload,
      } satisfies RunAgentResponse);
    }

    if (request.agentId === "closure") {
      const phases = getProgramPhaseContext(contextProgramData);
      const allPhasesReady = phases.every((phase) => phase.pct >= 90);
      if (!allPhasesReady) {
        const readinessScore = phases.reduce((sum, phase) => sum + phase.pct, 0) / Math.max(phases.length, 1) / 100;
        const notReadyPayload = {
          status: "not-ready",
          readinessScore,
          notReadyReason: "Not all phases are at 90% readiness.",
          confidence: 1,
        };
        const nextProgramData = applyClosureResultToProgramData(contextProgramData, notReadyPayload);
        await persistAgentArtifact(auth.admin, request.programId, request.agentId, request.phaseId, notReadyPayload, readinessScore);
        await persistProgramData(auth.admin, request.programId, nextProgramData, persistConcurrency);
        await auth.admin
          .from("adam_agent_runs")
          .update({
            status: "complete",
            output: notReadyPayload as JsonValue,
            handoff: null,
            reasoning_trace: null,
            confidence: readinessScore,
            tokens_used: 0,
            completed_at: new Date().toISOString(),
            awaiting_decision_id: null,
          })
          .eq("id", runId);
        await broadcastStatus(auth.admin, {
          runId,
          programId: request.programId,
          agentId: request.agentId,
          phaseId: request.phaseId,
          status: "complete",
          confidence: readinessScore,
          latestObservationType: "context_built",
        });
        await emitAgentEvent(auth.admin, {
          programId: request.programId,
          agentId: request.agentId,
          phaseId: request.phaseId,
          eventType: "completed",
          payload: {
            confidence: readinessScore,
            generatedAt: new Date().toISOString(),
            outputSummary: "Closure pack deferred — not all phases are ready",
          },
        });
        return jsonResponse({
          status: "complete",
          runId,
          output: notReadyPayload,
        } satisfies RunAgentResponse);
      }
    }

    const prompt = buildAgentPrompt(request, contextProgramData, contextSnapshot, specialAgentInputContext);
    if (request.crossPhaseContext?.trim()) {
      prompt.system += `\n\n## Context from prior phases\n${request.crossPhaseContext}`;
    }
    // ── Upstream agent handoff — cross-agent intelligence (Priority: agent collaboration) ──
    if (request.incomingHandoff) {
      const handoff = request.incomingHandoff;
      let handoffBlock = `\n\n## Upstream agent findings (${handoff.fromAgentId} on ${handoff.fromPhaseId}, confidence ${Math.round((handoff.confidence ?? 0) * 100)}%)\n${handoff.summary}${handoff.openQuestions?.length ? `\nOpen questions from upstream: ${handoff.openQuestions.join("; ")}` : ""}`;
      // Targeted cascade refresh (Change 7): when the handoff identifies the
      // changed source artifact and its likely impacts, scope this run to only
      // the affected sections instead of redrawing everything.
      if (handoff.sourceArtifact || handoff.reason || handoff.changedSections?.length || handoff.recommendedImpacts?.length) {
        handoffBlock += `\n\n### Targeted update`;
        if (handoff.sourceArtifact) handoffBlock += `\nSource artifact changed: ${handoff.sourceArtifact}`;
        if (handoff.reason) handoffBlock += `\nReason: ${handoff.reason}`;
        if (handoff.changedSections?.length) handoffBlock += `\nChanged sections: ${handoff.changedSections.join(", ")}`;
        if (handoff.recommendedImpacts?.length) handoffBlock += `\nLikely impacted here: ${handoff.recommendedImpacts.join(", ")}`;
        handoffBlock += `\nOnly update sections impacted by this handoff. Avoid unnecessary changes to unrelated sections.`;
      }
      prompt.system += handoffBlock;
    }
    // ── Pattern context injection — self-improvement from prior programmes ──────
    // For agents not already receiving patterns via buildSpecialAgentInputContext,
    // inject the pattern context as a supplementary advisory section.
    if (patternContext.length > 0 && !isSpecialProgramAgent(request.agentId, request.phaseId)) {
      const patternSummary = patternContext
        .slice(0, 3)
        .map((p) => {
          const label = typeof p.pattern_label === "string" ? p.pattern_label : "";
          const outcome = typeof p.outcome === "string" ? p.outcome : "";
          const confidence = typeof p.confidence === "number" ? Math.round(p.confidence * 100) : "?";
          const tactic = typeof p.intervention_tactic === "string" ? p.intervention_tactic : "";
          return `- ${label} (confidence ${confidence}%, outcome: ${outcome})${tactic ? ` — recommended tactic: ${tactic}` : ""}`;
        })
        .join("\n");
      prompt.system += `\n\n## Relevant patterns from similar programmes\nThe following patterns from prior programmes of similar type are applicable to this phase. Reference them where relevant to improve the quality of your recommendations:\n${patternSummary}`;
    }
    // Formal document agents (the spine) SKIP the prior-run memory/history
    // append: feeding them their own earlier output re-surfaces stale gaps and
    // inflates the prompt. Advisory agents keep it for continuity.
    const echoesPriorOutput = FORMAL_ARTIFACT_AGENTS[request.agentId] !== undefined;
    if (!echoesPriorOutput) {
      prompt.system += extractAgentServerMemory(contextProgramData, request.agentId);
      if (memoryContext) {
        prompt.system += `\n\n## Recent run history for this agent on this programme\n${memoryContext}`;
      }
    }
    prompt.user += extractHumanNotes(contextProgramData, request.agentId, request.phaseId);
    // Persist the fully-assembled prompt (system + user, after every cross-phase,
    // handoff, pattern and memory augmentation) onto the run so the Ontology
    // validation audit can show the COMPLETE AI prompt, not just the context
    // snapshot. Scoped to the validator — the only agent the audit surfaces — so
    // large system prompts don't bloat every run row. Nested under `fullPrompt`
    // so resume-agent's context passthrough (which stringifies input_context
    // wholesale) is unaffected.
    if (request.agentId === "cross-artifact-validator") {
      await auth.admin
        .from("adam_agent_runs")
        .update({
          input_context: {
            ...contextSnapshot,
            fullPrompt: { system: prompt.system, user: prompt.user },
          } as JsonValue,
        })
        .eq("id", runId);
    }
    await logObservation(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      observationType: "prompt_sent",
      payload: {
        systemLength: prompt.system.length,
        userLength: prompt.user.length,
      },
    });

    // ── ATOS Flow governance gate ────────────────────────────────────────
    // Two guardrails before any model call on Flow programmes: halt flags
    // (the whole programme or named agents) and per-movement token budgets.
    // A blocked run fails VISIBLY — run row marked, attestation on the trail
    // — and a cap breach queues the Tier-2 decision that unblocks it, so
    // governance never becomes a silent stall.
    if (isFlowProgramme(contextProgramData)) {
      const governanceRaw = getInnerProgramData(contextProgramData).flowGovernance;
      const governance = isRecord(governanceRaw) ? governanceRaw : {};
      const haltedAgents = Array.isArray(governance.haltedAgents) ? governance.haltedAgents.map(String) : [];
      const haltAll = governance.haltAll === true;
      if (haltAll || haltedAgents.includes(request.agentId)) {
        const reason = haltAll
          ? "The programme is halted — resume it from Mission Control."
          : `${request.agentId} is halted — resume it from Mission Control.`;
        const blocked = appendFlowAttestation(contextProgramData, {
          agentId: request.agentId,
          phaseId: request.phaseId,
          tier: flowAgentTier(request.agentId),
          action: `Blocked ${request.agentId} — governance halt`,
          detail: reason,
        });
        await persistProgramData(auth.admin, request.programId, blocked, persistConcurrency);
        await auth.admin
          .from("adam_agent_runs")
          .update({ status: "failed", completed_at: new Date().toISOString(), error_message: reason })
          .eq("id", runId);
        return new Response(JSON.stringify({ error: reason, governance: "halted" }), { status: 423, headers: JSON_HEADERS });
      }

      const budgets = isRecord(governance.movementBudgets) ? governance.movementBudgets as Record<string, JsonValue> : {};
      const movementCap = Number(budgets[request.phaseId] ?? 0);
      if (movementCap > 0) {
        const { data: movementRuns } = await auth.admin
          .from("adam_agent_runs")
          .select("tokens_used")
          .eq("program_id", request.programId)
          .eq("phase_id", request.phaseId);
        const movementSpent = (movementRuns || []).reduce((sum, row) => sum + Number(row.tokens_used || 0), 0);
        if (movementSpent >= movementCap) {
          const reason = `The ${request.phaseId} movement has spent ${movementSpent.toLocaleString()} of its ${movementCap.toLocaleString()}-token budget.`;
          const raisedCap = Math.ceil((movementCap * 1.5) / 1000) * 1000;
          let blocked = appendFlowAttestation(contextProgramData, {
            agentId: request.agentId,
            phaseId: request.phaseId,
            tier: 2,
            action: `Blocked ${request.agentId} — movement budget reached`,
            detail: reason,
          });
          // One open budget decision per movement — a burst of blocked runs
          // must not flood the inbox with duplicates.
          const openBudgetDecision = (getInnerProgramData(blocked).flowDecisions as JsonValue[] | undefined ?? [])
            .filter(isRecord)
            .some((entry) => entry.status === "open" && entry.agentId === "governance" && entry.movementId === request.phaseId);
          if (!openBudgetDecision) {
            blocked = queueFlowDecision(blocked, {
              tier: 2,
              agentId: "governance",
              movementId: request.phaseId,
              title: `Raise the ${request.phaseId} budget`,
              summary: reason,
              blocking: `Every ${request.phaseId} generation stays blocked until the cap moves.`,
              recommendation: {
                action: `Raise to ${raisedCap.toLocaleString()} tokens`,
                rationale: "The cap exists to make continued spend a deliberate call, not to stop the work — raising it by half keeps the movement moving under a fresh ceiling.",
                band: "governance — raises this movement's cap by half",
              } as JsonValue,
              payload: { flowGovernance: { movementBudgets: { [request.phaseId]: raisedCap } } } as JsonValue,
            });
          }
          await persistProgramData(auth.admin, request.programId, blocked, persistConcurrency);
          await auth.admin
            .from("adam_agent_runs")
            .update({ status: "failed", completed_at: new Date().toISOString(), error_message: reason })
            .eq("id", runId);
          return new Response(JSON.stringify({ error: reason, governance: "budget", spent: movementSpent, cap: movementCap }), { status: 429, headers: JSON_HEADERS });
        }
      }
    }

    const maxDailyTokens = typeof contextProgramData.adamAutonomySettings === "object" && contextProgramData.adamAutonomySettings !== null
      ? Number((contextProgramData.adamAutonomySettings as Record<string, JsonValue>).maxDailyTokens || 0)
      : 0;
    if (maxDailyTokens > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: todayRuns } = await auth.admin
        .from("adam_agent_runs")
        .select("tokens_used")
        .eq("program_id", request.programId)
        .gte("created_at", `${today}T00:00:00Z`);
      const tokensToday = (todayRuns || []).reduce((sum, row) => sum + Number(row.tokens_used || 0), 0);
      if (tokensToday + 2000 > maxDailyTokens) {
        const escalations = Array.isArray(getInnerProgramData(contextProgramData).escalations)
          ? [...(getInnerProgramData(contextProgramData).escalations as JsonValue[])]
          : [];
        escalations.push({
          id: `budget-${Date.now()}`,
          type: "budget-exceeded",
          summary: `Daily token budget (${maxDailyTokens.toLocaleString()} tokens) reached. Agent run blocked.`,
          severity: "high",
          status: "open",
          createdAt: new Date().toISOString(),
        } as JsonValue);
        await persistProgramData(auth.admin, request.programId, updateInnerProgramData(contextProgramData, (inner) => ({
          ...inner,
          escalations: escalations as JsonValue,
        })), persistConcurrency);
        return new Response(JSON.stringify({
          error: "Daily token budget exceeded",
          tokensUsedToday: tokensToday,
          budget: maxDailyTokens,
        }), { status: 429, headers: JSON_HEADERS });
      }
    }

    const outputTokenBudget = resolveOutputTokenBudget(request.agentId);
    // Cost-first model routing (T3): downgrade only. Light agents (detection /
    // scoring / validation / extraction) run on the active provider's cheap tier1
    // model; analytical and strategic agents keep the configured model so we never
    // auto-escalate spend. Tier routing is provider-agnostic — claudeClient maps
    // the tier to the active provider's model.
    const routedTier = resolveAgentTier(request.agentId) === "tier1" ? "tier1" as const : undefined;
    let claudeResult = await streamClaudeText({
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      maxTokens: outputTokenBudget,
      temperature: 0.2,
      tier: routedTier,
    });

    // Resilience: if the model returned no parseable JSON object (prose-only,
    // truncated stream, fenced markdown that broke extraction), repair it cheaply
    // (T5). Rather than re-running the full prompt — which re-sends the entire
    // (large) system + cross-phase context and pays for it twice — we feed ONLY
    // the broken text back with a tiny "fix this into valid JSON" instruction.
    // Input tokens collapse to the size of the broken output, so the repair costs
    // a fraction of a full re-run. If the repair still fails, throw so the run is
    // recorded as failed rather than silently completing with zero artifacts.
    if (!hasUsableAgentJson(claudeResult.text)) {
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "retry_unparseable",
        payload: { preview: claudeResult.text.slice(0, 200) },
      });
      const retry = await streamClaudeText({
        system: "You are a JSON repair tool. The user message contains text that was meant to be a single valid JSON object but could not be parsed (it may be wrapped in prose, fenced in markdown, or truncated). Reconstruct and return ONLY the corrected, complete JSON object — no markdown code fences, no commentary before or after.",
        messages: [{ role: "user", content: claudeResult.text }],
        // The repair must RE-EMIT the complete object: when the original died
        // by truncation, a repair capped at the same ceiling dies the same
        // way. Give it the tall ceiling regardless of the agent's own budget.
        maxTokens: Math.max(outputTokenBudget, LARGE_OUTPUT_TOKENS),
        temperature: 0,
        tier: "tier1", // JSON repair is light fix-up work — route to the cheap model.
      });
      if (!hasUsableAgentJson(retry.text)) {
        throw new Error("AI returned no parseable output after a repair pass — the run produced no usable result.");
      }
      claudeResult = retry;
    }

    // Cost ledger: derive USD spend from the actually-served model (failover-aware)
    // and the measured token breakdown, honouring the prompt-cache discount. This is
    // the single point every agent path flows through after the model call, so the
    // admin observability surface can roll spend up per model / capability / program.
    const runCostUsd = estimateCostUsd({
      model: claudeResult.model,
      provider: claudeResult.provider,
      inputTokens: claudeResult.inputTokens,
      outputTokens: claudeResult.outputTokens,
      cachedInputTokens: claudeResult.cachedInputTokens ?? 0,
    });
    await logObservation(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      observationType: "response_received",
      payload: {
        preview: claudeResult.text.slice(0, 300),
        // Token-governance observability: full breakdown so the admin ledger can
        // attribute spend and measure prompt-cache effectiveness per run.
        inputTokens: claudeResult.inputTokens,
        outputTokens: claudeResult.outputTokens,
        cachedInputTokens: claudeResult.cachedInputTokens ?? 0,
        provider: claudeResult.provider,
        model: claudeResult.model,
        costUsd: runCostUsd,
      },
      tokens: claudeResult.inputTokens + claudeResult.outputTokens,
      latencyMs: claudeResult.latencyMs,
    });

    if (isSpecialProgramAgent(request.agentId, request.phaseId)) {
      const parsedResult = extractAgentJson(claudeResult.text);
      const result = isRecord(parsedResult) ? parsedResult : {};
      const normalizedParsedResult = isRecord(parsedResult) ? parsedResult : null;
      const outputPayload = (parsedResult ?? null) as JsonValue;
      const confidence = typeof result.confidence === "number" ? Number(result.confidence) : null;
      const outputSummary = buildOutputSummary(request.agentId, normalizedParsedResult);

      const skipAutonomyReview = [
        "artifact-reviewer",
        "exit-criteria-generator",
        "decision-advisor",
        "contradiction-detector",
        "cross-artifact-validator",
        "dependency-check",
        "benefits-tracker",
        "handoff-quality",
        "benchmark-comparator",
        "meeting-notes",
        "weekly-digest",
        "daily-briefing",
        "phase-completion-estimator",
        "setup-prefill",
        "discovery-guide-generator",
        "sprint-planner",
        "stakeholder-comms-drafter",
        "steerco-agenda-builder",
        "kpi-validator",
        "compliance-checker",
        "capacity-assessor",
        "lessons-synthesiser",
        "vendor-risk-assessor",
        "stakeholder-risk-assessor",
        "benefit-forecast",
        "meeting-notes-extractor",
        "phase-input-planner",
      ].includes(request.agentId)
        || FORMAL_ARTIFACT_AGENTS[request.agentId] !== undefined;
      const autonomy = skipAutonomyReview
        ? {
            actAutonomously: true,
            applyWriteBack: true,
            shouldQueueReview: false,
            reason: "Structured support agent writes back automatically.",
          }
        : await autonomyGate(auth.admin, request.programId, request.agentId, confidence);
      let nextProgramData = contextProgramData;

      // Formal-artifact generation metadata (Changes 1, 3, 7, 9), computed once
      // from the pre-write inputs so both the persisted `_generationMetadata` and
      // the downstream cascade handoff describe the same change.
      let formalGenChangedInputs: Array<{ field: string; previousValue: string | null; newValue: string | null }> = [];
      let formalGenRunMode: RunMode | null = null;
      if (formalSpecForRun) {
        const innerForMeta = getInnerProgramData(contextProgramData);
        formalGenRunMode = formalRunMode ?? deriveFormalRunMode(request, innerForMeta, formalSpecForRun.fieldKey);
        formalGenChangedInputs = formalGenRunMode === "initial_generation"
          ? []
          : computeInputDelta(readPriorInputSnapshot(innerForMeta, formalSpecForRun.fieldKey), buildFormalInputSnapshot(innerForMeta, formalSpecForRun.phase));
      }

      if (autonomy.shouldQueueReview) {
        nextProgramData = appendDecisionQueueItems(contextProgramData, [
          createAgentReviewDecision(request.agentId, request.phaseId, normalizedParsedResult, autonomy.reason),
        ]);
      } else if (request.agentId === "narrative") {
        nextProgramData = applyNarrativeResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "risk") {
        nextProgramData = applyRiskResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "milestone") {
        nextProgramData = applyMilestoneResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "budget") {
        nextProgramData = applyBudgetResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "critical-path") {
        nextProgramData = applyCriticalPathResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "change-impact") {
        nextProgramData = applyChangeImpactResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "stakeholder") {
        nextProgramData = applyStakeholderResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (isProgramLevelAdoptionAgent(request.agentId, request.phaseId)) {
        nextProgramData = applyAdoptionResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "health-heatmap") {
        nextProgramData = applyHealthHeatmapResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "retro") {
        nextProgramData = applyRetroResultToProgramData(contextProgramData, request.phaseId, normalizedParsedResult);
      } else if (request.agentId === "deck") {
        nextProgramData = applyDeckResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "scope-pcr") {
        nextProgramData = applyScopePcrResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "escalation") {
        nextProgramData = applyEscalationResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "closure") {
        nextProgramData = applyClosureResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "artifact-reviewer") {
        nextProgramData = applyArtifactQuality(contextProgramData, "artifactReviewerQuality", result);
      } else if (request.agentId === "exit-criteria-generator") {
        nextProgramData = applyGeneratedExitCriteriaToProgramData(contextProgramData, request.phaseId, result);
      } else if (request.agentId === "decision-advisor" && request.decisionId) {
        nextProgramData = applyDecisionAdvisorResultToProgramData(contextProgramData, request.decisionId, result);
      } else if (request.agentId === "contradiction-detector") {
        if (isFlowProgramme(contextProgramData)) {
          // ATOS Flow: the watcher PROPOSES — an open Tier-2 decision carrying
          // ready-to-file contradiction rows; the human judges in the Inbox.
          // One open proposal at a time: skip while a previous one waits.
          const parsed = isRecord(result) ? result as Record<string, unknown> : {};
          const rows = Array.isArray(parsed.contradictions) ? parsed.contradictions.filter(isRecord) : [];
          const entries = rows.map((row) => ({
            statement: String((row as Record<string, unknown>).statement ?? (row as Record<string, unknown>).description ?? "").slice(0, 140),
            between: String((row as Record<string, unknown>).between ?? "").slice(0, 90),
            positions: String((row as Record<string, unknown>).positions ?? (row as Record<string, unknown>).recommendation ?? "").slice(0, 160),
          })).filter((entry) => entry.statement)
            // A follow-up pack echoes its own script back into evidence
            // ("Q: Two accounts disagree…"); a claim that is itself dispute
            // wording is the watcher reading its own output — never file it.
            .filter((entry) => !/two accounts disagree|which is right, and what settles it|^\s*Q:/i.test(entry.statement));
          const filteredEntries = entries.filter((entry) => !contradictionFalsifiedByRecord(contextProgramData, entry.statement));
          const existing = getInnerProgramData(contextProgramData).flowDecisions;
          const hasOpenWatcher = Array.isArray(existing) && existing.some((entry) =>
            isRecord(entry) && entry.agentId === "contradiction-watcher" && (entry.status ?? "open") === "open");
          if (filteredEntries.length && !hasOpenWatcher) {
            nextProgramData = queueFlowDecision(contextProgramData, {
              tier: 2,
              agentId: "contradiction-watcher",
              movementId: "listen",
              title: `File ${filteredEntries.length} contradiction${filteredEntries.length === 1 ? "" : "s"} to the log`,
              summary: filteredEntries.map((entry) => entry.statement).join(" · ").slice(0, 220),
              blocking: "New evidence disagrees with earlier findings; until it's logged, Listen still shows everything as resolved.",
              recommendation: {
                action: "File to the contradiction log",
                rationale: "Logging it makes Listen re-ask the question, and the documents built on the disputed claim get rebuilt.",
                band: "proposal — additive, log rows only",
              } as JsonValue,
              payload: { contradictionEntries: filteredEntries as unknown as JsonValue } as JsonValue,
            });
          } else {
            nextProgramData = contextProgramData;
          }
        } else {
          nextProgramData = applyContradictionResultToProgramData(contextProgramData, request.phaseId, result);
        }
      } else if (request.agentId === "cross-artifact-validator") {
        nextProgramData = applyCrossArtifactValidationResultToProgramData(contextProgramData, request.phaseId, result);
      } else if (request.agentId === "phase-input-planner") {
        if (isFlowProgramme(contextProgramData)) {
          // ATOS Flow: propose, don't apply. The planner's plan is computed in
          // full (same sanitisation path as classic) but lands as a Tier-2
          // decision carrying the ready-to-merge dynamicSchema — a human
          // confirms it in the deck's inbox before it takes effect.
          const applied = applyPhaseInputPlannerResultToProgramData(contextProgramData, request.phaseId, result);
          const appliedSchema = getInnerProgramData(applied).dynamicSchema;
          const schema = isRecord(appliedSchema) ? appliedSchema as Record<string, JsonValue> : {};
          const fieldsByPhase = isRecord(schema.inputFields) ? schema.inputFields as Record<string, JsonValue> : {};
          const artifactsByPhaseDyn = isRecord(schema.artifacts) ? schema.artifacts as Record<string, JsonValue> : {};
          const fieldCount = Array.isArray(fieldsByPhase[request.phaseId]) ? (fieldsByPhase[request.phaseId] as JsonValue[]).length : 0;
          const artifactCount = Array.isArray(artifactsByPhaseDyn[request.phaseId]) ? (artifactsByPhaseDyn[request.phaseId] as JsonValue[]).length : 0;
          const planMetaAll = isRecord(schema.planMeta) ? schema.planMeta as Record<string, unknown> : {};
          const planMetaRaw = planMetaAll[request.phaseId];
          const planMetaEntry = Array.isArray(planMetaRaw) ? planMetaRaw[0] : planMetaRaw;
          const rationale = isRecord(planMetaEntry) && typeof planMetaEntry.rationale === "string"
            ? planMetaEntry.rationale
            : "Derived from the prior movement's approved artifacts.";
          nextProgramData = queueFlowDecision(contextProgramData, {
            tier: 2,
            agentId: "phase-input-planner",
            movementId: request.phaseId,
            title: `Adopt the proposed plan for ${request.phaseId}`,
            summary: `${fieldCount} programme-specific input${fieldCount === 1 ? "" : "s"} and ${artifactCount} artifact${artifactCount === 1 ? "" : "s"} proposed for this movement.`,
            blocking: `The ${request.phaseId} movement keeps its static inputs until this is adopted.`,
            recommendation: {
              action: "Adopt the plan",
              rationale,
              band: "proposal — reversible, additive to the static inputs",
            } as JsonValue,
            payload: { dynamicSchema: schema as JsonValue } as JsonValue,
          });
        } else {
          nextProgramData = applyPhaseInputPlannerResultToProgramData(contextProgramData, request.phaseId, result);
        }
      } else if (request.agentId === "dependency-check") {
        nextProgramData = applyDependencyCheckResultToProgramData(contextProgramData, request.phaseId, result);
      } else if (request.agentId === "benefits-tracker") {
        nextProgramData = applyBenefitsTrackerResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "handoff-quality") {
        nextProgramData = applyHandoffQualityResultToProgramData(contextProgramData, request.phaseId, result);
      } else if (request.agentId === "benchmark-comparator") {
        nextProgramData = applyBenchmarkComparisonResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "meeting-notes") {
        const documentId = request.documentId || "";
        const queue = Array.isArray(getInnerProgramData(contextProgramData).decisionQueue)
          ? getInnerProgramData(contextProgramData).decisionQueue.filter(isRecord)
          : [];
        const milestones = Array.isArray(getInnerProgramData(contextProgramData).milestones)
          ? getInnerProgramData(contextProgramData).milestones.filter(isRecord)
          : [];
        const raidLog = normalizeProgramData(getInnerProgramData(contextProgramData).raidLog as JsonValue | null);
        const raidEntries = Array.isArray(raidLog.entries) ? raidLog.entries.filter(isRecord) : [];
        const extractedDecisions = Array.isArray(result.decisions) ? result.decisions.filter(isRecord) : [];
        const extractedActions = Array.isArray(result.actions) ? result.actions.filter(isRecord) : [];
        const extractedRisks = Array.isArray(result.risks) ? result.risks.filter(isRecord) : [];
        nextProgramData = updateInnerProgramData(contextProgramData, (inner) => ({
          ...inner,
          decisionQueue: [
            ...queue,
            ...extractedDecisions.map((entry) => ({
              id: `meeting-decision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: typeof entry.decision === "string" ? entry.decision : "Meeting decision",
              question: typeof entry.decision === "string" ? entry.decision : "Meeting decision",
              type: "other",
              priority: "medium",
              status: "open",
              recommendation: "",
              phaseId: request.phaseId,
              source: "meeting-notes",
              sourceDocumentId: documentId,
              createdAt: new Date().toISOString(),
            })),
          ] as JsonValue,
          milestones: [
            ...milestones,
            ...extractedActions.map((entry) => ({
              id: `meeting-action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: typeof entry.title === "string" ? entry.title : "Meeting action",
              status: "not-started",
              phaseId: request.phaseId,
              targetDate: typeof entry.dueDate === "string" ? entry.dueDate : null,
              owner: typeof entry.owner === "string" ? entry.owner : null,
              source: "meeting-notes",
              sourceDocumentId: documentId,
              lastUpdatedAt: new Date().toISOString(),
            })),
          ] as JsonValue,
          raidLog: {
            ...raidLog,
            entries: [
              ...raidEntries,
              ...extractedRisks.map((entry) => ({
                id: `meeting-risk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: "risk",
                title: typeof entry.title === "string" ? entry.title : "Meeting risk",
                severity: ["critical", "high", "medium", "low"].includes(String(entry.severity)) ? entry.severity : "medium",
                status: "open",
                phase: request.phaseId,
                source: "meeting-notes",
                sourceDocumentId: documentId,
              })),
            ] as JsonValue,
          } as JsonValue,
          meetingNotesExtracted: {
            ...(normalizeProgramData(inner.meetingNotesExtracted as JsonValue | null)),
            [documentId]: {
              ...result,
              extractedAt: new Date().toISOString(),
              decisionCount: extractedDecisions.length,
              actionCount: extractedActions.length,
              riskCount: extractedRisks.length,
            },
          } as JsonValue,
        }));
        if (documentId) {
          await auth.admin
            .from("adam_document_attachments")
            .update({ extracted_data: result as JsonValue, extraction_status: "meeting-notes-extracted" })
            .eq("id", documentId);
        }
      } else if (request.agentId === "weekly-digest") {
        nextProgramData = applyWeeklyDigestResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "daily-briefing") {
        nextProgramData = applyDailyBriefingResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "phase-completion-estimator") {
        nextProgramData = applyCompletionEstimateResultToProgramData(contextProgramData, request.phaseId, result);
      } else if (request.agentId === "discovery-guide-generator") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, "discover", "discovery-guide-generator", "discoveryGuide", result, "Discovery pack");
      } else if (request.agentId === "sprint-planner") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, "build", "sprint-planner", "sprintPlan", result, "Sprint plan");
        nextProgramData = applySprintPlanToBuildInputs(nextProgramData, result);
      } else if (request.agentId === "stakeholder-comms-drafter") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, request.phaseId, "stakeholder-comms-drafter", "stakeholderComms", { ...result, audienceGroup: request.audienceGroup || "all" }, "Stakeholder communications");
      } else if (request.agentId === "steerco-agenda-builder") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, "program", "steerco-agenda-builder", "steercoAgenda", result, "Steering committee agenda");
      } else if (request.agentId === "kpi-validator") {
        const validatedKPIs = Array.isArray(parsedResult) ? parsedResult.filter(isRecord) : Array.isArray(result.validatedKPIs) ? result.validatedKPIs.filter(isRecord) : [];
        const avgScore = validatedKPIs.length
          ? Math.round(validatedKPIs.reduce((sum, entry) => sum + clampNumber(entry.smartScore, 0, 100, 0), 0) / validatedKPIs.length)
          : 0;
        nextProgramData = applyProgramSupportArtifact(contextProgramData, "strategy", "kpi-validator", "kpiValidation", { validatedKPIs, avgScore, generatedAt: new Date().toISOString() }, "KPI validation");
      } else if (request.agentId === "compliance-checker") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, request.phaseId, "compliance-checker", "complianceCheck", { gaps: Array.isArray(parsedResult) ? parsedResult : result.gaps || [], generatedAt: new Date().toISOString() }, "Compliance check");
      } else if (request.agentId === "capacity-assessor") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, request.phaseId, "capacity-assessor", "capacityAssessment", result, "Capacity assessment");
        nextProgramData = applyCapacityRiskToProgramData(nextProgramData, request.phaseId, result);
      } else if (request.agentId === "lessons-synthesiser") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, "program", "lessons-synthesiser", "lessonsSynthesis", result, "Programme learnings");
      } else if (request.agentId === "vendor-risk-assessor") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, request.phaseId, "vendor-risk-assessor", "vendorRiskAssessment", { vendorAssessments: Array.isArray(parsedResult) ? parsedResult : result.vendorAssessments || [], generatedAt: new Date().toISOString() }, "Vendor risk assessment");
      } else if (request.agentId === "stakeholder-risk-assessor") {
        nextProgramData = applyStakeholderRiskResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "benefit-forecast") {
        nextProgramData = applyBenefitForecastResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "meeting-notes-extractor") {
        nextProgramData = applyProgramSupportArtifact(contextProgramData, request.phaseId, "meeting-notes-extractor", "meetingNotesExtraction", result, "Meeting notes extraction");
      } else if (request.agentId === "deck-section") {
        const sectionType = request.phaseId || "risks";
        nextProgramData = applyDeckSectionResultToProgramData(contextProgramData, normalizedParsedResult, sectionType);
      } else if (request.agentId === "narrative-refine") {
        nextProgramData = applyNarrativeResultToProgramData(contextProgramData, result);
      } else if (request.agentId === "board-pack") {
        nextProgramData = applyBoardPackResultToProgramData(contextProgramData, normalizedParsedResult);
      } else if (request.agentId === "setup-prefill") {
        nextProgramData = applySetupPrefillResultToProgramData(contextProgramData, result);
      } else if (FORMAL_ARTIFACT_AGENTS[request.agentId]) {
        // Formal-artifact agents persist one document to phaseArtifacts (so the
        // methodology slot is satisfied) plus a top-level mirror under fieldKey.
        // fieldKey is chosen to avoid clobbering read-only value records such as
        // inner.businessCase (the business-case agent uses businessCaseDoc).
        const spec = FORMAL_ARTIFACT_AGENTS[request.agentId];
        // Traceability metadata + a fresh input snapshot for the NEXT regen's
        // delta (Changes 1, 3, 9). Snapshot taken pre-write from the inputs this
        // run was grounded on.
        const inputSnapshot = buildFormalInputSnapshot(getInnerProgramData(contextProgramData), spec.phase);
        const generationMetadata = {
          runMode: formalGenRunMode ?? "initial_generation",
          changedInputs: formalGenChangedInputs.map((c) => c.field),
          conflictsResolved: formalGenChangedInputs.map((c) => ({ field: c.field, sourceUsed: "currentInput", sourceIgnored: "existingArtifact" })),
          inputSnapshot,
          generatedAt: new Date().toISOString(),
        };
        // The Strategic Roadmap is the single folded delivery artifact: alongside
        // the phase sequencing it now produces the delivery plan (deliveryPlan)
        // directly. Normalize a freshly produced plan; otherwise preserve the
        // prior folded deliveryPlan / milestones so a sequencing-only regen can't
        // wipe them.
        let formalResult: Record<string, unknown> = result;
        let deliveryPlanProduced = false;
        if (request.agentId === "strategic-roadmap") {
          const prevRoadmap = getInnerProgramData(contextProgramData).strategicRoadmap;
          formalResult = { ...result };
          if (isRecord(formalResult.deliveryPlan)) {
            formalResult.deliveryPlan = normalizeDeliveryPlan(formalResult.deliveryPlan as Record<string, unknown>, contextProgramData);
            deliveryPlanProduced = true;
          } else if (isRecord(prevRoadmap) && prevRoadmap.deliveryPlan !== undefined) {
            formalResult.deliveryPlan = prevRoadmap.deliveryPlan;
          }
          if (formalResult.milestones === undefined && isRecord(prevRoadmap) && prevRoadmap.milestones !== undefined) {
            formalResult.milestones = prevRoadmap.milestones;
          }
        }
        // Division of record: the Atlas SURFACES contradictions, but the
        // contradiction log is their single home (the gate reads it, the
        // sponsor resolves through it). Strip them from the stored document;
        // on Flow they arrive as a Tier-2 "file to the log" decision — the
        // same family the contradiction watcher uses.
        let atlasContradictions: Array<Record<string, string>> = [];
        if (request.agentId === "current-state-atlas" && Array.isArray((formalResult as Record<string, unknown>).contradictions)) {
          formalResult = { ...formalResult };
          const rows = (formalResult.contradictions as unknown[]).filter(isRecord);
          delete (formalResult as Record<string, unknown>).contradictions;
          atlasContradictions = rows.map((row) => ({
            statement: String(row.statement ?? "").slice(0, 140),
            between: (Array.isArray(row.between) ? row.between.map(String).join(" vs ") : String(row.between ?? "")).slice(0, 90),
            positions: (Array.isArray(row.positions) ? row.positions.map(String).join(" · ") : String(row.positions ?? "")).slice(0, 160),
          })).filter((entry) => entry.statement)
            // Same guard as the watcher: dispute wording echoed from a script
            // is not a claim — never re-file a contradiction about one.
            .filter((entry) => !/two accounts disagree|which is right, and what settles it|^\s*Q:/i.test(entry.statement))
            .filter((entry) => !contradictionFalsifiedByRecord(contextProgramData, entry.statement));
        }
        // Discovery Kit: GUARANTEE roster coverage. The model is asked to
        // interview every rostered person, but it compresses generic roles and
        // occasionally invents names — a prompt promise is not a guarantee.
        // Deterministically union the coverage roster into interviews: every
        // rostered name that the model omitted gets a stub entry, so no known
        // stakeholder is ever silently dropped from the kit.
        if (request.agentId === "discovery-kit" && Array.isArray((formalResult as Record<string, unknown>).interviews)) {
          const allInputs = getInnerProgramData(contextProgramData).phaseInputs;
          const listenInputs = isRecord(allInputs) ? normalizeProgramData((allInputs as Record<string, unknown>).listen as JsonValue) : {};
          const rosterRaw = typeof listenInputs.interviewRoster === "string" ? listenInputs.interviewRoster : "";
          const rosterRows = rosterRaw.trim().startsWith("[") ? safeJsonParse<unknown[]>(rosterRaw, []) : [];
          const interviews = ((formalResult.interviews as unknown[]) || []).filter(isRecord);
          const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();
          const present = new Set(interviews.map((iv) => norm(iv.stakeholder)));
          const added: Record<string, unknown>[] = [];
          for (const row of rosterRows) {
            if (!isRecord(row)) continue;
            const name = String(row.name ?? "").trim();
            if (!name || present.has(norm(name))) continue;
            present.add(norm(name));
            const role = String(row.role ?? "").trim();
            added.push({
              stakeholder: name,
              role,
              email: null,
              domain: String(row.domain ?? "").trim(),
              durationMinutes: 45,
              objectives: [`Hear ${name}'s first-hand account of their workflow, the pains in it, and what "good" looks like.`],
              agenda: [{ minutes: 45, topic: "Their workflow today", questions: [
                "Walk me through your process, end to end — the systems and the hand-offs.",
                "Where does it break down, and how often? Give me the last real example.",
                "What must be true for the new way to be better, not just different?",
              ] }],
              askForArtifacts: ["Any screens, reports or exports they work from"],
            });
          }
          if (added.length) {
            formalResult = { ...formalResult, interviews: [...interviews, ...added] };
          }
        }
        // ── Regeneration guard ─────────────────────────────────────────────
        // Documents are data; the studio lets humans edit that data. A doc
        // whose editedAt postdates its generatedAt carries human work — a
        // regeneration must not silently destroy it. On Flow programmes the
        // fresh draft becomes a Tier-2 decision (propose-then-confirm, like
        // every consequential agent result); confirm applies doc + ledger
        // stub via the client resolver, decline keeps the hand-edited version.
        const priorMirror = getInnerProgramData(contextProgramData)[spec.fieldKey];
        const handEdited = isFlowProgramme(contextProgramData)
          && isRecord(priorMirror)
          && typeof priorMirror.editedAt === "string"
          && Date.parse(priorMirror.editedAt) > (typeof priorMirror.generatedAt === "string" ? Date.parse(priorMirror.generatedAt) : 0);
        if (handEdited) {
          const proposedAt = new Date().toISOString();
          const proposedDoc = {
            ...formalResult,
            generatedAt: proposedAt,
            _generationMetadata: generationMetadata as JsonValue,
          } as Record<string, JsonValue>;
          const movementId = request.phaseId || spec.phase;
          const ledgerConfidence = toLedgerConfidence(confidence);
          formalRegenGuarded = true;
          nextProgramData = queueFlowDecision(contextProgramData, {
            tier: 2,
            movementId,
            title: `Accept the regenerated ${spec.title}`,
            summary: `You hand-edited this document on ${String(priorMirror.editedAt).slice(0, 10)}. Confirming replaces your edits with the fresh generation; declining keeps your version on the record.`,
            payload: {
              artifactDocs: { [spec.fieldKey]: proposedDoc } as JsonValue,
              artifactStubs: [{
                phaseId: movementId,
                artifactId: request.agentId,
                record: {
                  title: spec.title,
                  content: proposedDoc,
                  status: "draft",
                  agentDrafted: true,
                  agentDraftedAt: proposedAt,
                  ...(typeof ledgerConfidence === "number"
                    ? { confidence: ledgerConfidence / 100, agentConfidence: ledgerConfidence }
                    : {}),
                  inputsFingerprint: movementInputsFingerprint(contextProgramData, movementId),
                } as JsonValue,
              }] as JsonValue,
            } as JsonValue,
          });
          nextProgramData = appendFlowAttestation(nextProgramData, {
            agentId: request.agentId,
            phaseId: movementId,
            tier: 2,
            action: `Proposed regenerated ${spec.title} — your hand edits are protected, awaiting your confirm`,
            detail: (outputSummary || "").slice(0, 160),
          });
        } else {
          nextProgramData = applyProgramSupportArtifact(contextProgramData, spec.phase, request.agentId, spec.fieldKey, formalResult, spec.title, generationMetadata, confidence);
        }
        if (atlasContradictions.length && isFlowProgramme(nextProgramData)) {
          const existingDecisions = getInnerProgramData(nextProgramData).flowDecisions;
          const alreadyWaiting = Array.isArray(existingDecisions) && existingDecisions.some((entry) =>
            isRecord(entry) && (entry.status ?? "open") === "open"
            && isRecord(entry.payload) && Array.isArray((entry.payload as Record<string, unknown>).contradictionEntries));
          if (!alreadyWaiting) {
            nextProgramData = queueFlowDecision(nextProgramData, {
              tier: 2,
              agentId: "current-state-atlas",
              movementId: "listen",
              title: `File ${atlasContradictions.length} contradiction${atlasContradictions.length === 1 ? "" : "s"} to the log`,
              summary: atlasContradictions.map((entry) => entry.statement).join(" · ").slice(0, 220),
              blocking: "The Atlas found accounts that disagree; until they're logged, Listen still shows everything as resolved.",
              recommendation: {
                action: "File to the contradiction log",
                rationale: "Logging routes each dispute to the sponsor's follow-up script, and the documents rebuild once it's settled.",
                band: "proposal — additive, log rows only",
              } as JsonValue,
              payload: { contradictionEntries: atlasContradictions as unknown as JsonValue } as JsonValue,
            });
          }
        }
        // Keep the top-level plan freshness/confidence mirrors in step with a
        // newly produced folded delivery plan (consumers read these as overrides).
        if (deliveryPlanProduced) {
          const planConfidence = (formalResult.deliveryPlan as Record<string, unknown>).confidence;
          nextProgramData = updateInnerProgramData(nextProgramData, (inner) => ({
            ...inner,
            planGeneratedAt: new Date().toISOString(),
            planConfidence: typeof planConfidence === "number" ? Math.max(0, Math.min(1, planConfidence)) : null,
          }));
        }
      }

      // Surface structured agent output in the artifact ledger. The UI artifact
      // model reads only `data.phaseArtifacts`, so a canonical entry (titled to
      // match the methodology's required-artifact slot) is written here in
      // addition to the dedicated top-level program keys above.
      if (!autonomy.shouldQueueReview && REQUIRED_ARTIFACT_LABELS[request.agentId]) {
        const ledgerPhase = ARTIFACT_LEDGER_PHASE_OVERRIDE[request.agentId] ?? request.phaseId;
        nextProgramData = applyArtifactsToProgramData(nextProgramData, ledgerPhase, [{
          id: request.agentId,
          title: REQUIRED_ARTIFACT_LABELS[request.agentId],
          content: outputSummary || "",
          summary: outputSummary || "",
          confidence: toLedgerConfidence(confidence),
        }]);
      }

      // ── ATOS Flow: attest + fingerprint ───────────────────────────────────
      // Every applied run leaves an attestation entry; formal artifacts get the
      // movement-inputs fingerprint stamped on their stub so the client marks
      // them stale when evidence changes. Skipped entirely when the regen
      // guard queued the document as a decision — nothing was applied, and the
      // guard already attested the proposal.
      if (!autonomy.shouldQueueReview && isFlowProgramme(nextProgramData) && !formalRegenGuarded) {
        if (formalSpecForRun) {
          // Stamp on the MOVEMENT the run was invoked for (request.phaseId),
          // not the artifact's classic ledger home (formalSpecForRun.phase may
          // be e.g. "strategy" for the charter): the Flow client reads stubs
          // from phaseArtifacts[movement] and fingerprints that movement's
          // inputs, so stamp and comparison must name the same bucket.
          nextProgramData = stampFlowArtifactFingerprint(
            nextProgramData,
            request.phaseId || formalSpecForRun.phase,
            request.agentId,
          );
        }
        nextProgramData = appendFlowAttestation(nextProgramData, {
          agentId: request.agentId,
          phaseId: request.phaseId,
          tier: flowAgentTier(request.agentId),
          action: formalSpecForRun
            ? `Generated ${formalSpecForRun.title}`
            : request.agentId === "phase-input-planner"
              ? "Proposed the movement plan — awaiting your confirm"
              : `Ran ${request.agentId}`,
          detail: (outputSummary || "").slice(0, 160),
        });

        // Standard-vocabulary mappings ground the ontology in the industry's
        // shared language — adopted only through a human confirm, like every
        // consequential proposal.
        if (request.agentId === "domain-ontology" && Array.isArray((result as Record<string, unknown>).standardAlignment)) {
          // Vocabulary manifest: a proposed URI must live under a KNOWN
          // namespace or it never reaches the inbox — models fabricate
          // plausible deep links in the long vocabularies.
          const VOCAB_PREFIXES = ONTOLOGY_VOCAB_PREFIXES;
          const mappings = ((result as Record<string, unknown>).standardAlignment as unknown[])
            .filter(isRecord)
            .filter((entry) => typeof entry.entity === "string" && typeof entry.standard === "string"
              && VOCAB_PREFIXES.some((prefix) => String(entry.standard).startsWith(prefix)))
            .slice(0, 20)
            .map((entry) => ({
              entity: String(entry.entity),
              standard: String(entry.standard),
              vocabulary: String(entry.vocabulary ?? ""),
              relation: entry.relation === "skos:exactMatch" ? "skos:exactMatch" : "skos:closeMatch",
              confidence: typeof entry.confidence === "number" ? Math.max(0, Math.min(1, entry.confidence)) : null,
            }));
          // Only what would actually merge reaches the inbox — re-proposing
          // mappings the operator already adopted is a no-op decision.
          const adoptedEntities = (() => {
            const inner = getInnerProgramData(nextProgramData);
            const rows = Array.isArray(inner.ontologyAlignment) ? inner.ontologyAlignment : [];
            return new Set(rows.filter(isRecord).map((m) => String(m.entity ?? "").toLowerCase()));
          })();
          const newMappings = mappings.filter((m) => !adoptedEntities.has(m.entity.toLowerCase()));
          if (newMappings.length) {
            nextProgramData = queueFlowDecision(nextProgramData, {
              tier: 2,
              agentId: "domain-ontology",
              movementId: request.phaseId || "listen",
              title: `Adopt ${newMappings.length} standard mapping${newMappings.length === 1 ? "" : "s"}`,
              summary: `Ontology entities aligned to industry vocabularies: ${newMappings.slice(0, 3).map((m) => `${m.entity} → ${m.standard.split("/").pop()}`).join(", ")}${newMappings.length > 3 ? "…" : ""}.`,
              blocking: "The ontology stays in the client's private language until the mappings are adopted.",
              recommendation: {
                action: "Adopt the mappings",
                rationale: "Grounding entities in the industry's shared vocabulary (SKOS mappings to standard URIs) makes every downstream contract and export interoperable.",
                band: "proposal — reversible, mappings merge additively",
              } as JsonValue,
              payload: { ontologyAlignment: newMappings as unknown as JsonValue } as JsonValue,
            });
          }
        }

        // The built system inherits the shared language: every blueprint data
        // contract whose entity has an ADOPTED mapping carries its standard
        // URI. Deterministic — no model in the loop, so it cannot drift.
        if (request.agentId === "agentic-blueprint") {
          nextProgramData = updateInnerProgramData(nextProgramData, (inner) => {
            const adopted = Array.isArray(inner.ontologyAlignment) ? (inner.ontologyAlignment as JsonValue[]).filter(isRecord) : [];
            const blueprint = isRecord(inner.agenticBlueprint) ? inner.agenticBlueprint as Record<string, JsonValue> : null;
            if (!adopted.length || !blueprint || !Array.isArray(blueprint.dataContracts)) return inner;
            const uriFor = (name: string) => {
              const hit = adopted.find((m) => String(m.entity ?? "").trim().toLowerCase() === name.trim().toLowerCase());
              return hit ? String(hit.standard) : null;
            };
            const dataContracts = (blueprint.dataContracts as JsonValue[]).map((contract) =>
              isRecord(contract) && typeof contract.entity === "string" && uriFor(contract.entity)
                ? { ...contract, standardUri: uriFor(contract.entity) } as JsonValue
                : contract,
            );
            return { ...inner, agenticBlueprint: { ...blueprint, dataContracts } as JsonValue };
          });
        }

        // The blueprint's track plan lands as its own Tier-2 decision — the
        // Tracks board adopts workstreams only through a human confirm, and
        // the payload is normalised here so the client merge stays dumb.
        if (request.agentId === "agentic-blueprint" && Array.isArray((result as Record<string, unknown>).tracks)) {
          const proposedRaw = ((result as Record<string, unknown>).tracks as unknown[]).filter(isRecord).slice(0, 12);
          const now = new Date().toISOString();
          const named = proposedRaw.map((entry) => {
            const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "Track";
            return { entry, name, id: trackSlug(name) };
          });
          const idByName = new Map(named.map((t) => [t.name.toLowerCase(), t.id]));
          const tracks = named.map(({ entry, name, id }) => ({
            id,
            name,
            goal: typeof entry.goal === "string" ? entry.goal : "",
            slices: Array.isArray(entry.slices) ? entry.slices.map(String).slice(0, 8) : [],
            leadStakeholder: typeof entry.leadStakeholder === "string" ? entry.leadStakeholder : "",
            dependsOn: Array.isArray(entry.dependsOn)
              ? entry.dependsOn.map((n) => idByName.get(String(n).toLowerCase()) ?? "").filter(Boolean)
              : [],
            createdAt: now,
            showPasses: [],
          }));
          if (tracks.length) {
            nextProgramData = queueFlowDecision(nextProgramData, {
              tier: 2,
              agentId: request.agentId,
              movementId: request.phaseId || "envision",
              title: "Adopt the track plan",
              summary: `${tracks.length} build track${tracks.length === 1 ? "" : "s"} proposed: ${tracks.map((t) => t.name).slice(0, 4).join(", ")}${tracks.length > 4 ? "…" : ""}.`,
              blocking: "The Tracks board stays empty until a plan is adopted.",
              recommendation: {
                action: "Adopt the track plan",
                rationale: "Each track is a demoable workstream over the shared data model; acceptance is earned through the show/refine loop, at least two cycles.",
                band: "proposal — reversible, tracks merge additively",
              } as JsonValue,
              payload: { tracks: tracks as unknown as JsonValue } as JsonValue,
            });
          }
        }
      }

      if (!autonomy.shouldQueueReview) {
        const reviewTargets: Record<string, { fieldKey: string; confidenceFieldKey?: string; content: string }> = {
          narrative: {
            fieldKey: "narrativeQuality",
            confidenceFieldKey: "narrativeConfidence",
            content: typeof result.narrative === "string" ? result.narrative : "",
          },
          risk: {
            fieldKey: "riskQuality",
            content: stringifyForReview({ summary: result.summary, raidEntries: result.raidEntries }),
          },
          deck: {
            fieldKey: "deckQuality",
            content: stringifyForReview({ programHealthSummary: result.programHealthSummary, slides: result.slides }),
          },
          stakeholder: {
            fieldKey: "stakeholderQuality",
            content: stringifyForReview(result),
          },
          "change-impact": {
            fieldKey: "changeImpactQuality",
            content: stringifyForReview(result),
          },
          adoption: {
            fieldKey: "adoptionQuality",
            content: stringifyForReview(result),
          },
          "critical-path": {
            fieldKey: "criticalPathQuality",
            content: stringifyForReview(result),
          },
        };
        // Formal-artifact documents (charter, business-case, outcome-framework,
        // …) carry no static review entry, but the user needs the same AI quality
        // score + improvement plan for them. Review the generated document and
        // persist under `${camelCase(agentId)}Quality` — the exact key the Stage
        // view computes from the artifact's producing-agent id (no hardcoded map).
        const formalSpec = FORMAL_ARTIFACT_AGENTS[request.agentId];
        const reviewTarget = reviewTargets[request.agentId]
          ?? (formalSpec
            ? { fieldKey: `${toCamelCaseId(request.agentId)}Quality`, content: stringifyForReview(result) }
            : undefined);
        if (reviewTarget?.content.trim()) {
          const artifactReview = await reviewArtifact(
            request.agentId,
            reviewTarget.content,
            `Program: ${programRow.name || "Unknown"}, Phase: ${request.phaseId}`,
            collectPriorPhaseArtifacts(contextProgramData, request.phaseId),
            collectProvidedInputs(contextProgramData, request.phaseId),
            getCurrentPhaseScope(contextProgramData, request.phaseId),
          );
          nextProgramData = applyArtifactQuality(nextProgramData, reviewTarget.fieldKey, artifactReview as unknown as Record<string, unknown>, reviewTarget.confidenceFieldKey);
        }
      }

      nextProgramData = appendAgentServerMemory(nextProgramData, request.agentId, {
        runAt: new Date().toISOString() as JsonValue,
        runId: runId as JsonValue,
        summary: outputSummary as JsonValue,
        confidence: confidence,
        keyFindings: Array.isArray(result.keyFindings) ? result.keyFindings.slice(0, 3) as JsonValue[] : [],
      });

      await persistAgentArtifact(auth.admin, request.programId, request.agentId, request.phaseId, normalizedParsedResult, confidence);
      await persistProgramData(auth.admin, request.programId, nextProgramData, persistConcurrency);
      await auth.admin
        .from("adam_agent_runs")
        .update({
          status: "complete",
          output: outputPayload,
          handoff: null,
          reasoning_trace: null,
          confidence,
          tokens_used: tokensUsedForRun(claudeResult, prompt.system.length + prompt.user.length, claudeResult.text.length),
          completed_at: new Date().toISOString(),
          awaiting_decision_id: null,
        })
        .eq("id", runId);

      await emitAgentEvent(auth.admin, {
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        eventType: "completed",
        payload: {
          confidence,
          generatedAt: new Date().toISOString(),
          queuedForReview: autonomy.shouldQueueReview,
          outputSummary: autonomy.shouldQueueReview
            ? `Queued for review — ${autonomy.reason}`
            : outputSummary,
        },
      });

      await broadcastStatus(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        status: "complete",
        confidence,
        latestObservationType: "response_received",
      });

      if (!autonomy.shouldQueueReview) {
        // Build and pass handoff so downstream agents know upstream confidence + findings
        const completedHandoff: AgentHandoff = {
          fromAgentId: request.agentId,
          fromPhaseId: request.phaseId,
          toPhaseId: request.phaseId,
          completedAt: new Date().toISOString(),
          summary: outputSummary,
          keyDecisions: [],
          artifactIds: [],
          openQuestions: [],
          confidence,
          recommendedNextAction: "",
        };
        // Targeted cascade enrichment (Change 7): when a formal artifact drove
        // this run, tell downstream agents which artifact changed, why, and where
        // to focus — so they update only the impacted sections.
        if (formalSpecForRun) {
          const changedFields = formalGenChangedInputs.map((c) => c.field.split(".").pop() || c.field);
          completedHandoff.sourceArtifact = formalSpecForRun.fieldKey;
          completedHandoff.reason = changedFields.length
            ? `${formalSpecForRun.title} regenerated (${formalGenRunMode ?? "manual_regeneration"}); inputs changed: ${changedFields.join(", ")}`
            : `${formalSpecForRun.title} regenerated (${formalGenRunMode ?? "initial_generation"}); no structured input changes`;
          if (changedFields.length) completedHandoff.changedSections = changedFields;
          completedHandoff.recommendedImpacts = FORMAL_ARTIFACT_IMPACTS[request.agentId] ?? [];
        }
        scheduleBackground(triggerDownstreamAgents(request.agentId, request.programId, request.phaseId, completedHandoff, nextProgramData));
      }

      return jsonResponse({
        status: "complete",
        runId,
        output: outputPayload,
      } satisfies RunAgentResponse);
    }

    const pauseMarker = checkForPauseMarker(claudeResult.text);
    if (pauseMarker.hasPause) {
      const decisionId = crypto.randomUUID();
      let nextProgramData = contextProgramData;
      if (pauseMarker.contentBeforePause) {
        nextProgramData = applyArtifactsToProgramData(nextProgramData, request.phaseId, [{
          id: `partial_${request.phaseId}_${runId.slice(0, 8)}`,
          title: `${request.phaseId} partial draft`,
          content: pauseMarker.contentBeforePause,
          summary: pauseMarker.reason,
        }]);
      }
      nextProgramData = appendDecisionQueueItems(nextProgramData, [{
        id: decisionId,
        type: "agent_clarification",
        phase: request.phaseId,
        title: `${request.agentId} needs input`,
        body: pauseMarker.reason || pauseMarker.question || "Agent needs human clarification.",
        question: pauseMarker.question || "Please clarify how the agent should proceed.",
        options: pauseMarker.options || [],
        runId,
        createdAt: Date.now(),
        status: "pending",
      }]);
      await persistProgramData(auth.admin, request.programId, nextProgramData, persistConcurrency);
      await auth.admin
        .from("adam_agent_runs")
        .update({
          status: "paused",
          output: { partialContent: pauseMarker.contentBeforePause || "" } as JsonValue,
          awaiting_decision_id: decisionId,
          tokens_used: tokensUsedForRun(claudeResult, prompt.system.length + prompt.user.length, claudeResult.text.length),
          confidence: null,
        })
        .eq("id", runId);
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "pause_requested",
        payload: {
          reason: pauseMarker.reason,
          question: pauseMarker.question,
          options: pauseMarker.options || [],
          decisionId,
        },
      });
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "decision_queued",
        payload: { decisionId, type: "agent_clarification" },
      });
      await broadcastStatus(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        status: "paused",
        latestObservationType: "pause_requested",
      });
      return jsonResponse({
        status: "paused",
        runId,
        decisionId,
      } satisfies RunAgentResponse);
    }

    const parsed = parseAgentPayload(claudeResult.text, request.phaseId, request.agentId);
    const autonomy = await autonomyGate(auth.admin, request.programId, request.agentId, parsed.confidence);
    let nextProgramData = contextProgramData;
    const handoff = autonomy.shouldQueueReview ? null : buildDefaultHandoff(request, parsed);

    if (autonomy.shouldQueueReview) {
      nextProgramData = appendDecisionQueueItems(nextProgramData, [
        createAgentReviewDecision(request.agentId, request.phaseId, {
          summary: parsed.summary,
          reasoningTrace: parsed.reasoningTrace,
          confidence: parsed.confidence,
          artifacts: parsed.artifacts,
          decisions: parsed.decisions,
          handoff: handoff as unknown as Record<string, unknown> | null,
        }, autonomy.reason),
      ]);
    } else {
      // Custom planner artifacts (no dedicated agent) are produced here by the
      // generic phase agent. Named agents get an AI quality review above; mirror
      // that for these so the Stage card shows a real score + improvement plan
      // instead of "Needs improvement" with nothing to act on. Review each
      // artifact first, then (a) stamp the review score onto the ledger record as
      // agentConfidence — the generic payload carries no per-artifact confidence,
      // so without this the ledger entry persists with no quality signal — and
      // (b) persist the score + improvements under the same
      // `${camelCase(artifactId)}Quality` key the client resolves.
      const reviewedArtifacts: ParsedAgentPayload["artifacts"] = [];
      const artifactQualityRecords: Array<{ fieldKey: string; review: Record<string, unknown> }> = [];
      for (const artifact of parsed.artifacts) {
        const content = stringifyForReview({ title: artifact.title, content: artifact.content });
        if (!content.trim()) {
          reviewedArtifacts.push(artifact);
          continue;
        }
        const artifactReview = await reviewArtifact(
          artifact.id,
          content,
          `Program: ${programRow.name || "Unknown"}, Phase: ${request.phaseId}`,
          collectPriorPhaseArtifacts(contextProgramData, request.phaseId),
          collectProvidedInputs(contextProgramData, request.phaseId),
          getCurrentPhaseScope(contextProgramData, request.phaseId),
        );
        reviewedArtifacts.push({ ...artifact, confidence: artifactReview.score });
        artifactQualityRecords.push({
          fieldKey: `${toCamelCaseId(artifact.id)}Quality`,
          review: artifactReview as unknown as Record<string, unknown>,
        });
      }
      nextProgramData = applyArtifactsToProgramData(contextProgramData, request.phaseId, reviewedArtifacts);
      for (const { fieldKey, review } of artifactQualityRecords) {
        nextProgramData = applyArtifactQuality(nextProgramData, fieldKey, review);
      }
      if (parsed.decisions.length) {
        nextProgramData = appendDecisionQueueItems(nextProgramData, parsed.decisions.map((decision) => ({
          id: crypto.randomUUID(),
          type: "agent_recommendation",
          phase: request.phaseId,
          title: decision.title,
          body: decision.question,
          options: decision.options || [],
          priority: decision.priority || "medium",
          createdAt: Date.now(),
          status: "pending",
        })));
      }

      if (handoff) {
        nextProgramData.phaseHandoffs = {
          ...((nextProgramData.phaseHandoffs as Record<string, JsonValue>) || {}),
          [request.phaseId]: handoff as JsonValue,
        };
        nextProgramData.phaseIncomingHandoffs = {
          ...((nextProgramData.phaseIncomingHandoffs as Record<string, JsonValue>) || {}),
          [handoff.toPhaseId]: handoff as JsonValue,
        };
      }
    }

    nextProgramData = appendAgentServerMemory(nextProgramData, request.agentId, {
      runAt: new Date().toISOString() as JsonValue,
      runId: runId as JsonValue,
      summary: parsed.summary as JsonValue,
      confidence: parsed.confidence,
      keyFindings: parsed.artifacts.slice(0, 3).map((artifact) => artifact.title) as JsonValue[],
    });

    await persistAgentArtifact(auth.admin, request.programId, request.agentId, request.phaseId, {
      summary: parsed.summary,
      reasoningTrace: parsed.reasoningTrace as unknown as string[],
      confidence: parsed.confidence,
      artifacts: parsed.artifacts as unknown as Array<Record<string, unknown>>,
      decisions: parsed.decisions as unknown as Array<Record<string, unknown>>,
      handoff: handoff as unknown as Record<string, unknown> | null,
    }, parsed.confidence);
    await persistProgramData(auth.admin, request.programId, nextProgramData, persistConcurrency);

    for (const artifact of parsed.artifacts) {
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "artifact_drafted",
        payload: {
          artifactId: artifact.id,
          title: artifact.title,
        },
      });
    }

    await auth.admin
      .from("adam_agent_runs")
      .update({
        status: "complete",
        output: {
          summary: parsed.summary,
          artifacts: parsed.artifacts,
          decisions: parsed.decisions,
        } as JsonValue,
        handoff: (handoff || null) as JsonValue | null,
        reasoning_trace: parsed.reasoningTrace,
        confidence: parsed.confidence,
        tokens_used: tokensUsedForRun(claudeResult, prompt.system.length + prompt.user.length, claudeResult.text.length),
        completed_at: new Date().toISOString(),
        awaiting_decision_id: null,
      })
      .eq("id", runId);

    await emitAgentEvent(auth.admin, {
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      eventType: "completed",
      payload: {
        confidence: parsed.confidence,
        generatedAt: new Date().toISOString(),
        queuedForReview: autonomy.shouldQueueReview,
        outputSummary: autonomy.shouldQueueReview
          ? `Queued for review — ${autonomy.reason}`
          : buildOutputSummary(request.agentId, { summary: parsed.summary }),
      },
    });

    if (handoff) {
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "handoff_created",
        payload: handoff as unknown as JsonValue,
      });
    }

    await broadcastStatus(auth.admin, {
      runId,
      programId: request.programId,
      agentId: request.agentId,
      phaseId: request.phaseId,
      status: "complete",
      confidence: parsed.confidence,
      latestObservationType: handoff ? "handoff_created" : "response_received",
    });

    if (handoff?.toPhaseId && !autonomy.shouldQueueReview) {
      await logObservation(auth.admin, {
        runId,
        programId: request.programId,
        agentId: request.agentId,
        phaseId: request.phaseId,
        observationType: "trigger_fired",
        payload: {
          targetPhaseId: handoff.toPhaseId,
          triggerEvent: "handoff",
        },
      });
      await queueTriggeredRun(auth.admin, {
        programId: request.programId,
        agentId: handoff.toPhaseId,
        phaseId: handoff.toPhaseId,
        ownerId,
        triggerEvent: "handoff",
        incomingHandoff: handoff,
      });
    }

    // A dynamic-phase artifact was just produced — refresh the plan's next actions
    // and the risk register so actions/risks/blockers reflect the new artifact.
    // (Formal artifacts trigger this from the special-agent branch above.)
    if (!autonomy.shouldQueueReview && parsed.artifacts.length > 0) {
      scheduleBackground(
        triggerDownstreamAgents(request.agentId, request.programId, request.phaseId, handoff, nextProgramData, true),
      );
    }

    return jsonResponse({
      status: "complete",
      runId,
      output: {
        summary: parsed.summary,
        artifacts: parsed.artifacts,
        decisions: parsed.decisions,
      },
      handoff,
    } satisfies RunAgentResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (auth && request && runId) {
      await auth.admin
        .from("adam_agent_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      try {
        await emitAgentEvent(auth.admin, {
          programId: request.programId,
          agentId: request.agentId,
          phaseId: request.phaseId,
          eventType: "failed",
          payload: { error: message },
        });
      } catch (eventError) {
        console.warn("ATOS failure event emit failed:", eventError);
      }
    }
    return jsonResponse({ error: message }, 500);
  }
});
