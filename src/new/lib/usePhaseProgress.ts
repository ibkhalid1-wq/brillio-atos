import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getProgramState, wrapProgramState, asRecord } from "@/new/lib/programState";

export function usePhaseProgress(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const updatePct = useCallback(async (phaseId: string, pct: number) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getProgramState(rawData);
      const phases = Array.isArray(inner.phases)
        ? (inner.phases as unknown[]).map((value) => {
            const phase = asRecord(value);
            return phase.id === phaseId ? { ...phase, pct } : phase;
          })
        : [];
      const payload = wrapProgramState(wrapper, { ...inner, phases }, usesNestedData);
      const { error } = await supabase
        .from("adam_programs")
        .update({ data: payload as Json, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) throw new Error(error.message);
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [onRefresh, programId, rawData]);

  return { updatePct, isSaving };
}
