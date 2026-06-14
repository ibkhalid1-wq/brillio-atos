import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export function useProgramNotes(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const addNote = useCallback(async (text: string, type: string, extra?: Record<string, unknown>) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getProgramState(rawData);
      const existing = Array.isArray(inner.humanNotes) ? [...inner.humanNotes as unknown[]] : [];
      const next = [...existing, { text, type, savedAt: new Date().toISOString(), ...extra }];
      const payload = wrapProgramState(wrapper, { ...inner, humanNotes: next }, usesNestedData);
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

  return { addNote, isSaving };
}
