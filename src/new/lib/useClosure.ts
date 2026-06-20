import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ProgramClosure } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

async function resolveDisplayName(explicitName?: string): Promise<string> {
  if (explicitName?.trim()) return explicitName.trim();
  if (!supabase) return "Program owner";
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return "Program owner";
  return user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email
    || "Program owner";
}

export function useClosure(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getClosureState = useCallback(() => {
    const { wrapper, inner, usesNestedData } = getProgramState(rawData);
    const closure = typeof inner.closure === "object" && inner.closure !== null && !Array.isArray(inner.closure)
      ? inner.closure as ProgramClosure
      : null;
    const decisionQueue = Array.isArray(inner.decisionQueue) ? [...inner.decisionQueue] as Record<string, unknown>[] : [];
    return { wrapper, inner, closure, decisionQueue, usesNestedData };
  }, [rawData]);

  const persistClosureState = useCallback(async (
    nextInner: Record<string, unknown>,
    programStatus?: "active" | "finalized" | "archived",
  ) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, usesNestedData } = getClosureState();
      const payload = wrapProgramState(wrapper, nextInner, usesNestedData);
      const updates: Record<string, unknown> = {
        data: payload as Json,
        updated_at: new Date().toISOString(),
      };
      if (programStatus) {
        updates.status = programStatus;
      }
      const { error } = await (supabase
        .from("adam_programs") as any)
        .update(updates)
        .eq("id", programId);
      if (error) throw new Error(error.message);
      // pattern-extract agent retired — no post-closure mining invoke.
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [getClosureState, onRefresh, programId]);

  const approveClosure = useCallback(async (displayName?: string) => {
    const { inner, closure, decisionQueue } = getClosureState();
    if (!closure) throw new Error("Closure pack not found.");
    const approvedBy = await resolveDisplayName(displayName);
    const closureDecisionId = closure.closureDecisionId;
    const nextInner = {
      ...inner,
      closure: {
        ...closure,
        status: "approved" as const,
        approvedAt: new Date().toISOString(),
        approvedBy,
      },
      closurePromptDismissed: true,
      decisionQueue: decisionQueue.filter((decision) => String(decision.id || "") !== String(closureDecisionId || "")),
    };
    await persistClosureState(nextInner, "finalized");
  }, [getClosureState, persistClosureState]);

  const archiveProgram = useCallback(async () => {
    const { inner, closure } = getClosureState();
    if (!closure) throw new Error("Closure pack not found.");
    const nextInner = {
      ...inner,
      closure: {
        ...closure,
        status: "archived" as const,
        archivedAt: new Date().toISOString(),
      },
      closurePromptDismissed: true,
    };
    await persistClosureState(nextInner, "archived");
  }, [getClosureState, persistClosureState]);

  const dismissClosurePrompt = useCallback(async () => {
    const { inner } = getClosureState();
    const nextInner = {
      ...inner,
      closurePromptDismissed: true,
    };
    await persistClosureState(nextInner);
  }, [getClosureState, persistClosureState]);

  return {
    approveClosure,
    archiveProgram,
    dismissClosurePrompt,
    isSaving,
  };
}
