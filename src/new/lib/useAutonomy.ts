import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AutonomyLogEntry, AutonomySettingSummary, AutonomyLevel } from "@/new/types";

type SettingRow = Database["public"]["Tables"]["adam_autonomy_settings"]["Row"];
type LogRow = Database["public"]["Tables"]["adam_autonomy_log"]["Row"];

function toSetting(row: SettingRow): AutonomySettingSummary {
  return {
    id: row.id,
    programId: row.program_id,
    agentId: row.agent_id,
    trustThreshold: typeof row.trust_threshold === "number" ? row.trust_threshold : 0.85,
    maxAutonomousActionsPerDay: typeof row.max_autonomous_actions_per_day === "number" ? row.max_autonomous_actions_per_day : 10,
    requiresHumanAboveRisk: row.requires_human_above_risk || "high",
    enabled: row.enabled === true,
    updatedAt: row.updated_at,
  };
}

function toLog(row: LogRow): AutonomyLogEntry {
  return {
    id: row.id,
    programId: row.program_id,
    agentId: row.agent_id,
    actionType: row.action_type,
    actionPayload: typeof row.action_payload === "object" && row.action_payload !== null && !Array.isArray(row.action_payload)
      ? row.action_payload as Record<string, unknown>
      : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    actedAutonomously: row.acted_autonomously,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function getAutonomyLevel(
  agentId: string,
  confidence: number | undefined,
  settings: AutonomySettingSummary[],
): AutonomyLevel {
  if (["gate-review", "closure", "escalation"].includes(agentId)) {
    return "manual";
  }
  const setting = settings.find((entry) => entry.agentId === agentId);
  if (!setting || !setting.enabled) {
    return "queued";
  }
  if (typeof confidence === "number" && confidence >= setting.trustThreshold) {
    return "autonomous";
  }
  return "supervised";
}

export function useAutonomy(programId: string) {
  const [settings, setSettings] = useState<AutonomySettingSummary[]>([]);
  const [log, setLog] = useState<AutonomyLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      setSettings([]);
      setLog([]);
      return;
    }
    setIsLoading(true);
    try {
      const [{ data: settingsData, error: settingsError }, { data: logData, error: logError }] = await Promise.all([
        supabase
          .from("adam_autonomy_settings")
          .select("*")
          .eq("program_id", programId)
          .order("agent_id", { ascending: true }),
        supabase
          .from("adam_autonomy_log")
          .select("*")
          .eq("program_id", programId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (settingsError) throw settingsError;
      if (logError) throw logError;
      setSettings(((settingsData || []) as SettingRow[]).map(toSetting));
      setLog(((logData || []) as LogRow[]).map(toLog));
    } catch (error) {
      console.warn("Autonomy state load failed:", error);
      setSettings([]);
      setLog([]);
    } finally {
      setIsLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertSetting = useCallback(async (agentId: string, patch: Partial<AutonomySettingSummary>) => {
    if (!isSupabaseConfigured || !supabase || !programId) return;
    setSaveError(null);
    const current = settings.find((entry) => entry.agentId === agentId);
    try {
      const { error } = await supabase
        .from("adam_autonomy_settings")
        .upsert(
          {
            id: current?.id,
            program_id: programId,
            agent_id: agentId,
            trust_threshold: patch.trustThreshold ?? current?.trustThreshold ?? 0.85,
            max_autonomous_actions_per_day: patch.maxAutonomousActionsPerDay ?? current?.maxAutonomousActionsPerDay ?? 10,
            requires_human_above_risk: patch.requiresHumanAboveRisk ?? current?.requiresHumanAboveRisk ?? "high",
            enabled: patch.enabled ?? current?.enabled ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "program_id,agent_id" },
        );
      if (error) {
        console.warn("Autonomy setting save failed:", error.message);
        setSaveError(error.message);
        return;
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn("Autonomy setting save error:", message);
      setSaveError(message);
    }
  }, [programId, refresh, settings]);

  const autonomousActionsToday = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return log.filter((entry) => entry.actedAutonomously && new Date(entry.createdAt).getTime() >= startOfDay.getTime()).length;
  }, [log]);

  return {
    settings,
    log,
    isLoading,
    saveError,
    refresh,
    upsertSetting,
    autonomousActionsToday,
  };
}
