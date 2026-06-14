import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import type { AgentRunRow, JsonValue } from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

type SupabaseClient = ReturnType<typeof createClient>;

type ObservationRow = {
  id: string;
  run_id: string;
  program_id: string;
  agent_id: string;
  phase_id: string;
  observation_type: string;
  payload: JsonValue | null;
  tokens: number | null;
  latency_ms: number | null;
  created_at: string;
};

function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function authenticateRequest(req: Request): Promise<SupabaseClient> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return admin;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return admin;
}

function buildSummary(observation: ObservationRow): string {
  const payload = (observation.payload && typeof observation.payload === "object" && !Array.isArray(observation.payload))
    ? observation.payload as Record<string, JsonValue>
    : {};
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.preview === "string") return payload.preview;
  if (typeof payload.question === "string") return payload.question;
  if (typeof payload.targetPhaseId === "string") return `Triggered ${payload.targetPhaseId}`;
  return observation.observation_type.replace(/_/g, " ");
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const admin = await authenticateRequest(req);
    const url = new URL(req.url);
    const runId = url.searchParams.get("runId") || "";
    if (!runId) {
      return jsonResponse({ error: "runId query param is required." }, 400);
    }

    const { data: run, error: runError } = await admin
      .from("adam_agent_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runError || !run) {
      return jsonResponse({ error: runError?.message || "Run not found." }, 404);
    }

    const { data: observations, error: observationError } = await admin
      .from("adam_agent_observations")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (observationError) {
      return jsonResponse({ error: observationError.message }, 500);
    }

    const runRow = run as AgentRunRow;
    const observationRows = (observations || []) as ObservationRow[];
    const startedAtMs = runRow.started_at ? new Date(runRow.started_at).getTime() : null;

    const timeline = observationRows.map((observation) => {
      const eventMs = new Date(observation.created_at).getTime();
      return {
        event: observation.observation_type,
        timestamp: observation.created_at,
        durationMs: startedAtMs ? Math.max(0, eventMs - startedAtMs) : undefined,
        summary: buildSummary(observation),
      };
    });

    return jsonResponse({
      run: runRow,
      observations: observationRows,
      timeline,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
