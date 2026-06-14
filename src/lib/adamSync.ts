import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type ProgramRow = Database["public"]["Tables"]["adam_programs"]["Row"];
type ProgramInsert = Database["public"]["Tables"]["adam_programs"]["Insert"];
type PortfolioRow = Database["public"]["Tables"]["adam_portfolio"]["Row"];
type AuditLogInsert = Database["public"]["Tables"]["adam_audit_log"]["Insert"];
type AgentRunRow = Database["public"]["Tables"]["adam_agent_runs"]["Row"];
type AgentRunInsert = Database["public"]["Tables"]["adam_agent_runs"]["Insert"];

type ProgramRecord = Record<string, unknown>;
type ProgramShapeRow = Pick<ProgramRow, "id" | "name" | "client" | "industry" | "updated_at" | "data">;
const LOCAL_PROGRAM_STORAGE_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"] as const;

export type AgentRun = AgentRunRow & {
  triggered_by?: "user" | "trigger" | null;
};
export type AgentRunStatus = AgentRunRow["status"];

export interface AgentTraceObservation {
  id: string;
  type: string;
  summary: string;
  payload?: Record<string, unknown> | null;
  tokens?: number | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface AgentHandoff {
  fromAgentId: string;
  fromPhaseId: string;
  toPhaseId: string;
  completedAt: string;
  summary: string;
  keyDecisions: string[];
  artifactIds: string[];
  openQuestions: string[];
  confidence: number;
  recommendedNextAction: string;
}

export interface AgentRunResponse {
  status: "queued" | "running" | "paused" | "complete" | "failed" | "cancelled";
  runId: string;
  output?: Record<string, unknown> | null;
  handoff?: AgentHandoff | null;
  decisionId?: string;
}

function normalizeProgramShape(row: ProgramShapeRow) {
  const payload = (row?.data || {}) as ProgramRecord;
  const wrapper = payload?.data ? payload : { id: row.id, data: payload };
  const wrapperData = (wrapper?.data || {}) as ProgramRecord;
  const projectMeta = (wrapperData.projectMeta || {}) as ProgramRecord;
  const name = row?.name || (wrapper as ProgramRecord)?.name || String(projectMeta.name || "Untitled Program");
  const client = row?.client || String(projectMeta.client || (wrapper as ProgramRecord)?.client || "");
  const industry = row?.industry || String(projectMeta.industry || (wrapper as ProgramRecord)?.industry || "");
  return {
    ...wrapper,
    id: row.id,
    name,
    client,
    industry,
    data: {
      ...wrapperData,
      projectMeta: {
        ...projectMeta,
        name,
        client,
        industry,
      },
      _syncedAt: row?.updated_at || new Date().toISOString(),
    },
    _syncedAt: row?.updated_at || new Date().toISOString(),
  };
}

export async function loadProgramsFromSupabase(): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("adam_programs")
    .select("id, name, client, industry, updated_at, data")
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("ADAM sync load error:", error);
    return [];
  }
  return (data || []).map(normalizeProgramShape);
}

export async function loadProgramFromSupabase(programId: string): Promise<Record<string, unknown> | null> {
  if (!isSupabaseConfigured || !supabase || !programId) return null;
  const { data, error } = await supabase
    .from("adam_programs")
    .select("id, name, client, industry, updated_at, data")
    .eq("id", programId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.error("ADAM sync single-program load error:", error);
    }
    return null;
  }
  return normalizeProgramShape(data as ProgramShapeRow);
}

export async function saveProgramToSupabase(program: Record<string, unknown>): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;
  const record = program?.data
    ? program
    : {
        id: program?.id,
        name: program?.projectMeta?.name || program?.name || "Untitled Program",
        client: program?.projectMeta?.client || program?.client || null,
        industry: program?.projectMeta?.industry || program?.industry || null,
        data: program,
      };
  const syncedAt = new Date().toISOString();
  const payload: ProgramRecord = {
    ...record,
    data: {
      ...((record?.data as Record<string, unknown>) || {}),
      _syncedAt: syncedAt,
    },
  };
  const upsertRecord: ProgramInsert = {
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" ? record.name : "Untitled",
    client: typeof record.client === "string" ? record.client : null,
    industry: typeof record.industry === "string" ? record.industry : null,
    owner_id: auth.user.id,
    data: payload as Json,
    updated_at: syncedAt,
  };
  const { error } = await supabase
    .from("adam_programs")
    .upsert(upsertRecord, { onConflict: "id" });
  if (error) {
    console.error("ADAM sync save error:", error);
    return false;
  }
  return true;
}

export async function deleteProgramFromSupabase(programId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) {
    if (typeof localStorage === "undefined") return false;
    let removed = false;
    for (const storageKey of LOCAL_PROGRAM_STORAGE_KEYS) {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      try {
        const entries = JSON.parse(raw) as unknown[];
        if (!Array.isArray(entries)) continue;
        const nextEntries = entries.filter((entry) => {
          const id = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).id : null;
          return id !== programId;
        });
        if (nextEntries.length !== entries.length) {
          removed = true;
          localStorage.setItem(storageKey, JSON.stringify(nextEntries));
        }
      } catch {
        // Ignore malformed legacy caches; cloud deletion remains the source of truth.
      }
    }
    return removed;
  }
  const { error } = await supabase
    .from("adam_programs")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", programId);
  if (error) {
    console.error("ADAM sync delete error:", error);
    return false;
  }
  return true;
}

export async function loadPortfolioFromSupabase(): Promise<Record<string, unknown> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("adam_portfolio")
    .select("data")
    .single();
  if (error || !data) return null;
  return ((data as PortfolioRow).data || {}) as Record<string, unknown>;
}

export async function savePortfolioToSupabase(portfolioData: Record<string, unknown>): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;
  const { error } = await supabase
    .from("adam_portfolio")
    .upsert({
      owner_id: auth.user.id,
      data: portfolioData as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
  if (error) {
    console.error("ADAM portfolio sync error:", error);
    return false;
  }
  return true;
}

export async function writeAuditLog(entry: {
  programId: string;
  action: string;
  phaseId?: string;
  artifactId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user || !entry?.programId || !entry?.action) return;
  const auditRecord: AuditLogInsert = {
    program_id: entry.programId,
    user_id: auth.user.id,
    action: entry.action,
    phase_id: entry.phaseId || null,
    artifact_id: entry.artifactId || null,
    summary: entry.summary || null,
    metadata: (entry.metadata || {}) as Json,
  };
  try {
    const { error } = await supabase.from("adam_audit_log").insert(auditRecord);
    if (error) {
      console.warn("ADAM audit log write failed:", error.message);
      if (typeof localStorage !== "undefined") {
        const pending = JSON.parse(localStorage.getItem("adam_pending_audits") || "[]") as AuditLogInsert[];
        localStorage.setItem("adam_pending_audits", JSON.stringify([...pending, auditRecord]));
      }
    }
  } catch (err) {
    console.warn("ADAM audit log exception:", err);
  }
}

export async function saveAgentRun(run: Partial<AgentRun>): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Authentication required.");

  const payload: AgentRunInsert = {
    id: run.id,
    program_id: run.program_id || "",
    agent_id: run.agent_id || "",
    phase_id: run.phase_id || "",
    status: run.status || "queued",
    trigger_event: run.trigger_event || null,
    input_context: (run.input_context || null) as Json | null,
    output: (run.output || null) as Json | null,
    handoff: (run.handoff || null) as Json | null,
    reasoning_trace: run.reasoning_trace || null,
    confidence: typeof run.confidence === "number" ? run.confidence : null,
    tokens_used: typeof run.tokens_used === "number" ? run.tokens_used : null,
    error_message: run.error_message || null,
    awaiting_decision_id: run.awaiting_decision_id || null,
    scheduled_by: run.scheduled_by || null,
    started_at: run.started_at || null,
    completed_at: run.completed_at || null,
    owner_id: run.owner_id || auth.user.id,
  };

  const { data, error } = await supabase
    .from("adam_agent_runs")
    .upsert(payload, { onConflict: "id" })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "Failed to save agent run.");
  }

  return data.id;
}

export async function getAgentRuns(programId: string, limit = 50): Promise<AgentRun[]> {
  if (!isSupabaseConfigured || !supabase || !programId) return [];
  const { data, error } = await supabase
    .from("adam_agent_runs")
    .select("*")
    .eq("program_id", programId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("ADAM agent runs load error:", error);
    return [];
  }

  return (data || []) as AgentRun[];
}

export async function getPausedRuns(programId: string): Promise<AgentRun[]> {
  if (!isSupabaseConfigured || !supabase || !programId) return [];
  const { data, error } = await supabase
    .from("adam_agent_runs")
    .select("*")
    .eq("program_id", programId)
    .eq("status", "paused")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("ADAM paused runs load error:", error);
    return [];
  }

  return (data || []) as AgentRun[];
}
