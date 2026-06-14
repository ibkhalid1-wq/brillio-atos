import { supabase } from "@/integrations/supabase/client";

export interface ProgramVelocity {
  changesLast24h: number;
  agentRunsLast24h: number;
  activePhaseId: string;
  daysSinceLastGate: number;
}

function daysBetween(now: number, iso: string | null | undefined): number {
  if (!iso) return 999;
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) return 999;
  return Math.max(0, Math.round((now - parsed) / 86_400_000));
}

export async function computeProgramVelocity(
  programId: string,
  activePhaseId: string,
): Promise<ProgramVelocity> {
  const fallback: ProgramVelocity = {
    changesLast24h: 0,
    agentRunsLast24h: 0,
    activePhaseId,
    daysSinceLastGate: 999,
  };

  if (!supabase || !programId) return fallback;

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [programResult, runResult] = await Promise.all([
    supabase
      .from("adam_programs")
      .select("updated_at, data")
      .eq("id", programId)
      .maybeSingle(),
    supabase
      .from("adam_agent_runs")
      .select("status, created_at")
      .eq("program_id", programId)
      .gte("created_at", since),
  ]);

  const now = Date.now();
  const updatedAt = programResult.data?.updated_at || null;
  const inner = (programResult.data?.data && typeof programResult.data.data === "object")
    ? programResult.data.data as Record<string, unknown>
    : {};
  const gateReviews = inner.gateReviews && typeof inner.gateReviews === "object"
    ? inner.gateReviews as Record<string, { approvedAt?: string | null }>
    : {};
  const latestGateApprovedAt = Object.values(gateReviews)
    .map((entry) => entry?.approvedAt || null)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1) || null;
  const completedRuns = (runResult.data || []).filter((row) => row.status === "complete").length;

  return {
    changesLast24h: updatedAt && new Date(updatedAt).getTime() >= new Date(since).getTime() ? Math.max(1, completedRuns) : 0,
    agentRunsLast24h: completedRuns,
    activePhaseId,
    daysSinceLastGate: daysBetween(now, latestGateApprovedAt),
  };
}
