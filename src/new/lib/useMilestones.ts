import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Milestone } from "@/new/types";

function generateId(phaseId: string): string {
  return `milestone-${phaseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function useMilestones(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getMilestoneState = useCallback(() => {
    const wrapper = asRecord(rawData);
    const nested = asRecord(wrapper.data);
    const usesNestedData = Object.keys(nested).length > 0;
    const inner = usesNestedData ? nested : wrapper;
    const milestones = Array.isArray(inner.milestones) ? inner.milestones as Milestone[] : [];
    return { wrapper, inner, milestones, usesNestedData };
  }, [rawData]);

  const persistMilestones = useCallback(async (updatedMilestones: Milestone[]) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getMilestoneState();
      const nextInner = {
        ...inner,
        milestones: updatedMilestones,
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
  }, [getMilestoneState, onRefresh, programId]);

  const addMilestone = useCallback(async (
    milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">,
  ) => {
    const { milestones } = getMilestoneState();
    const nextMilestone: Milestone = {
      ...milestone,
      id: generateId(milestone.phaseId || "program"),
      source: "human",
      lastUpdatedAt: new Date().toISOString(),
    };
    await persistMilestones([...milestones, nextMilestone]);
  }, [getMilestoneState, persistMilestones]);

  const updateMilestone = useCallback(async (
    milestoneId: string,
    patch: Partial<Omit<Milestone, "id" | "source">>,
  ) => {
    const { milestones } = getMilestoneState();
    const updatedMilestones = milestones.map((milestone) => (
      milestone.id === milestoneId
        ? {
            ...milestone,
            ...patch,
            lastUpdatedAt: new Date().toISOString(),
          }
        : milestone
    ));
    await persistMilestones(updatedMilestones);
  }, [getMilestoneState, persistMilestones]);

  const completeMilestone = useCallback(async (milestoneId: string) => {
    await updateMilestone(milestoneId, { status: "complete" });
  }, [updateMilestone]);

  return {
    addMilestone,
    updateMilestone,
    completeMilestone,
    isSaving,
  };
}
