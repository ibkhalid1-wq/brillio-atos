import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

type SupabaseClient = ReturnType<typeof createClient>;

type ScheduleRow = {
  id: string;
  program_id: string;
  agent_id: string;
  phase_id: string;
  cron_expression: string;
  label: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number | null;
  owner_id: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authenticateRequest(req: Request): Promise<SupabaseClient> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (token !== SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("schedule-agent requires the service role key.");
  }
  return getAdminClient();
}

function matchesCronPart(part: string, value: number): boolean {
  if (part === "*") return true;
  if (part.includes(",")) {
    return part.split(",").some((segment) => matchesCronPart(segment.trim(), value));
  }
  if (part.includes("/")) {
    const [base, stepValue] = part.split("/");
    const step = Number(stepValue);
    if (!Number.isFinite(step) || step <= 0) return false;
    if (base === "*") return value % step === 0;
    if (base.includes("-")) {
      const [start, end] = base.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return value >= start && value <= end && (value - start) % step === 0;
    }
  }
  if (part.includes("-")) {
    const [start, end] = part.split("-").map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return value >= start && value <= end;
  }
  const numeric = Number(part);
  return Number.isFinite(numeric) && numeric === value;
}

function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    matchesCronPart(minute, date.getUTCMinutes())
    && matchesCronPart(hour, date.getUTCHours())
    && matchesCronPart(dayOfMonth, date.getUTCDate())
    && matchesCronPart(month, date.getUTCMonth() + 1)
    && matchesCronPart(dayOfWeek, date.getUTCDay())
  );
}

function computeNextRunAt(expression: string, from = new Date()): string | null {
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i += 1) {
    if (cronMatches(expression, cursor)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const admin = await authenticateRequest(req);
    const { data, error } = await admin
      .from("adam_agent_schedules")
      .select("*")
      .eq("enabled", true)
      .lte("next_run_at", new Date().toISOString());

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    const dueSchedules = (data || []) as ScheduleRow[];
    const results: Array<{ scheduleId: string; label: string; triggered: boolean; error?: string }> = [];

    for (const schedule of dueSchedules) {
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            programId: schedule.program_id,
            agentId: schedule.agent_id,
            phaseId: schedule.phase_id,
            triggeredBy: "schedule",
            triggerEvent: `schedule:${schedule.id}`,
          }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(detail || `HTTP ${response.status}`);
        }

        const nextRunAt = computeNextRunAt(schedule.cron_expression, new Date());
        await admin
          .from("adam_agent_schedules")
          .update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRunAt,
            run_count: Number(schedule.run_count || 0) + 1,
          })
          .eq("id", schedule.id);

        results.push({
          scheduleId: schedule.id,
          label: schedule.label,
          triggered: true,
        });
      } catch (runError) {
        results.push({
          scheduleId: schedule.id,
          label: schedule.label,
          triggered: false,
          error: runError instanceof Error ? runError.message : "Unknown error",
        });
      }
    }

    return jsonResponse({
      triggered: results.filter((result) => result.triggered).length,
      attempted: results.length,
      results,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
