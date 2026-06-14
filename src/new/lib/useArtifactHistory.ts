import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { ArtifactVersionSummary } from "@/new/types";

type ArtifactRow = Database["public"]["Tables"]["adam_program_artifacts"]["Row"];

function toArtifact(row: ArtifactRow): ArtifactVersionSummary {
  return {
    id: row.id,
    programId: row.program_id,
    agentId: row.agent_id,
    phaseId: row.phase_id,
    version: row.version,
    content: typeof row.content === "object" && row.content !== null && !Array.isArray(row.content)
      ? row.content as Record<string, unknown>
      : {},
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    generatedAt: row.generated_at,
    supersededAt: row.superseded_at,
    supersededBy: row.superseded_by,
  };
}

export function useArtifactHistory(programId: string, onRestored?: () => Promise<void> | void) {
  const [artifacts, setArtifacts] = useState<ArtifactVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      setArtifacts([]);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("adam_program_artifacts")
        .select("*")
        .eq("program_id", programId)
        .order("generated_at", { ascending: false });
      if (error) throw error;
      setArtifacts(((data || []) as ArtifactRow[]).map(toArtifact));
    } catch (error) {
      console.warn("Artifact history load failed:", error);
      setArtifacts([]);
    } finally {
      setIsLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restoreArtifact = useCallback(async (artifactId: string) => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      throw new Error("Supabase is not configured.");
    }
    setIsRestoring(true);
    try {
      const { error } = await supabase.functions.invoke("restore-artifact", {
        body: {
          programId,
          artifactId,
        },
      });
      if (error) {
        throw new Error(error.message || "Failed to restore artifact.");
      }
      await refresh();
      await onRestored?.();
    } finally {
      setIsRestoring(false);
    }
  }, [onRestored, programId, refresh]);

  return {
    artifacts,
    isLoading,
    isRestoring,
    refresh,
    restoreArtifact,
  };
}
