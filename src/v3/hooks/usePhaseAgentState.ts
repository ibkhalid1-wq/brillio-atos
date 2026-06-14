import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";

export function usePhaseAgentState(programId: string | null, phaseId: string | null) {
  const [tasks, setTasks] = useState<PhaseAgentTask[]>([]);
  const [loading, setLoading] = useState(false);

  const loadState = useCallback(async () => {
    if (!programId || !phaseId || !isSupabaseConfigured || !supabase) {
      const key = `adam_phase_agent_${programId}_${phaseId}`;
      try {
        const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        const parsed = stored ? JSON.parse(stored) as { tasks?: PhaseAgentTask[] } : {};
        setTasks(Array.isArray(parsed.tasks) ? parsed.tasks : []);
      } catch {
        setTasks([]);
      }
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from("adam_phase_agent_states")
      .select("state")
      .eq("program_id", programId)
      .eq("phase_id", phaseId)
      .maybeSingle();

    const state = (data?.state as { tasks?: PhaseAgentTask[] } | null) ?? {};
    setTasks(Array.isArray(state.tasks) ? state.tasks : []);
    setLoading(false);
  }, [phaseId, programId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const updateTask = useCallback(async (taskId: string, patch: Partial<PhaseAgentTask>) => {
    if (!programId || !phaseId) return;
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));

    if (!isSupabaseConfigured || !supabase) {
      const key = `adam_phase_agent_${programId}_${phaseId}`;
      const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      const parsed = stored ? JSON.parse(stored) as { tasks?: PhaseAgentTask[] } : { tasks: [] };
      const currentTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
      localStorage.setItem(key, JSON.stringify({ ...parsed, tasks: nextTasks }));
      return;
    }

    const current = await supabase
      .from("adam_phase_agent_states")
      .select("state")
      .eq("program_id", programId)
      .eq("phase_id", phaseId)
      .maybeSingle();

    const currentState = (current.data?.state as { tasks?: PhaseAgentTask[] } | null) ?? { tasks: [] };
    const updatedTasks = (currentState.tasks || []).map((task) =>
      task.id === taskId ? { ...task, ...patch } : task
    );

    await supabase.from("adam_phase_agent_states").upsert({
      program_id: programId,
      phase_id: phaseId,
      state: { ...currentState, tasks: updatedTasks },
      updated_at: new Date().toISOString(),
    }, { onConflict: "program_id,phase_id" });
  }, [phaseId, programId]);

  return { tasks, loading, updateTask, refresh: loadState };
}

