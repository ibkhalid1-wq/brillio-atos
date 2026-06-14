import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AgentSchedule = Database["public"]["Tables"]["adam_agent_schedules"]["Row"];

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
      return Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end && (value - start) % step === 0;
    }
  }
  if (part.includes("-")) {
    const [start, end] = part.split("-").map(Number);
    return Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end;
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
    if (cronMatches(expression, cursor)) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

async function getCurrentUserId(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) {
    throw new Error("Authentication required.");
  }
  return data.user.id;
}

export function useAgentSchedules(programId: string) {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);

  const refreshSchedules = useCallback(async () => {
    if (!programId || !isSupabaseConfigured || !supabase) {
      setSchedules([]);
      return;
    }
    const { data, error } = await supabase
      .from("adam_agent_schedules")
      .select("*")
      .eq("program_id", programId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("ADAM schedules load failed:", error.message);
      setSchedules([]);
      return;
    }
    setSchedules((data || []) as AgentSchedule[]);
  }, [programId]);

  useEffect(() => {
    void refreshSchedules();
  }, [refreshSchedules]);

  const createSchedule = useCallback(async (params: {
    agentId: string;
    phaseId: string;
    cronExpression: string;
    label: string;
  }) => {
    if (!programId || !isSupabaseConfigured || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    const ownerId = await getCurrentUserId();
    const nextRunAt = computeNextRunAt(params.cronExpression);
    const { error } = await supabase
      .from("adam_agent_schedules")
      .insert({
        program_id: programId,
        agent_id: params.agentId,
        phase_id: params.phaseId,
        cron_expression: params.cronExpression,
        label: params.label,
        enabled: true,
        next_run_at: nextRunAt,
        owner_id: ownerId,
      });
    if (error) {
      throw new Error(error.message || "Failed to create schedule.");
    }
    await refreshSchedules();
  }, [programId, refreshSchedules]);

  const toggleSchedule = useCallback(async (scheduleId: string, enabled: boolean) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    const { error } = await supabase
      .from("adam_agent_schedules")
      .update({ enabled })
      .eq("id", scheduleId);
    if (error) {
      throw new Error(error.message || "Failed to update schedule.");
    }
    await refreshSchedules();
  }, [refreshSchedules]);

  const deleteSchedule = useCallback(async (scheduleId: string) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    const { error } = await supabase
      .from("adam_agent_schedules")
      .delete()
      .eq("id", scheduleId);
    if (error) {
      throw new Error(error.message || "Failed to delete schedule.");
    }
    await refreshSchedules();
  }, [refreshSchedules]);

  return useMemo(() => ({
    schedules,
    createSchedule,
    toggleSchedule,
    deleteSchedule,
  }), [createSchedule, deleteSchedule, schedules, toggleSchedule]);
}
