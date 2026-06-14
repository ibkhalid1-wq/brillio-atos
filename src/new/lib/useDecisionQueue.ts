import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { DecisionSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export function useDecisionQueue(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const addDecision = useCallback(async (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getProgramState(rawData);
      const existing = Array.isArray(inner.decisions)
        ? [...inner.decisions as unknown[]]
        : Array.isArray(inner.decisionQueue)
          ? [...inner.decisionQueue as unknown[]]
          : [];
      const newItem = {
        ...decision,
        id: crypto.randomUUID(),
        status: "open",
        createdAt: new Date().toISOString(),
        source: "human",
      };
      const payload = wrapProgramState(
        wrapper,
        { ...inner, decisions: [newItem, ...existing], decisionQueue: [newItem, ...existing] },
        usesNestedData,
      );
      const { error } = await supabase
        .from("adam_programs")
        .update({ data: payload as Json, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) throw new Error(error.message);
      await onRefresh();
      return newItem;
    } finally {
      setIsSaving(false);
    }
  }, [onRefresh, programId, rawData]);

  return { addDecision, isSaving };
}
