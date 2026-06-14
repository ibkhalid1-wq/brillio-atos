import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Escalation } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export function useEscalations(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getEscalationState = useCallback(() => {
    const { wrapper, inner, usesNestedData } = getProgramState(rawData);
    const escalations = Array.isArray(inner.escalations) ? inner.escalations as Escalation[] : [];
    return { wrapper, inner, escalations, usesNestedData };
  }, [rawData]);

  const persistEscalations = useCallback(async (updatedEscalations: Escalation[]) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getEscalationState();
      const nextInner = {
        ...inner,
        escalations: updatedEscalations,
      };
      const payload = wrapProgramState(wrapper, nextInner, usesNestedData);
      const { error } = await supabase
        .from("adam_programs")
        .update({ data: payload as Json, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) throw new Error(error.message);
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [getEscalationState, onRefresh, programId]);

  const acknowledgeEscalation = useCallback(async (id: string) => {
    const { escalations } = getEscalationState();
    const updated = escalations.map((entry) => (
      entry.id === id
        ? {
            ...entry,
            status: "acknowledged" as const,
            acknowledgedAt: new Date().toISOString(),
          }
        : entry
    ));
    await persistEscalations(updated);
  }, [getEscalationState, persistEscalations]);

  const resolveEscalation = useCallback(async (id: string) => {
    const { escalations } = getEscalationState();
    const updated = escalations.map((entry) => (
      entry.id === id
        ? {
            ...entry,
            status: "resolved" as const,
            resolvedAt: new Date().toISOString(),
          }
        : entry
    ));
    await persistEscalations(updated);
  }, [getEscalationState, persistEscalations]);

  return {
    acknowledgeEscalation,
    resolveEscalation,
    isSaving,
  };
}
