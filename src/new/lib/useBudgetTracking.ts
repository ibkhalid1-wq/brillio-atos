import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function useBudgetTracking(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getBudgetState = useCallback(() => {
    const wrapper = asRecord(rawData);
    const nested = asRecord(wrapper.data);
    const usesNestedData = Object.keys(nested).length > 0;
    const inner = usesNestedData ? nested : wrapper;
    const budget = asRecord(inner.budget);
    return { wrapper, inner, budget, usesNestedData };
  }, [rawData]);

  const saveBudgetInputs = useCallback(async (patch: {
    projectedCost: number | null;
    actualSpend: number | null;
    projectedBenefits: number | null;
    realisedBenefits: number | null;
    phaseActuals?: Record<string, number>;
  }) => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      throw new Error("Not configured.");
    }

    setIsSaving(true);
    try {
      const { wrapper, inner, budget, usesNestedData } = getBudgetState();
      const nextInner = {
        ...inner,
        budget: {
          ...budget,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
      const payload = usesNestedData
        ? {
            ...wrapper,
            data: nextInner,
          }
        : nextInner;

      const { error } = await supabase
        .from("adam_programs")
        .update({ data: payload as Json, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) throw new Error(error.message);
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [getBudgetState, onRefresh, programId]);

  return {
    saveBudgetInputs,
    isSaving,
  };
}
