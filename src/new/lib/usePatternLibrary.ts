import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { PatternLibraryEntry } from "@/new/types";

type PatternRow = Database["public"]["Tables"]["adam_pattern_library"]["Row"];

function toPatternEntry(row: PatternRow): PatternLibraryEntry {
  return {
    id: row.id,
    patternType: row.pattern_type as PatternLibraryEntry["patternType"],
    phaseId: row.phase_id,
    industry: row.industry,
    programSize: (row.program_size as PatternLibraryEntry["programSize"]) || null,
    title: row.pattern_title,
    body: typeof row.pattern_body === "object" && row.pattern_body !== null && !Array.isArray(row.pattern_body)
      ? row.pattern_body as Record<string, unknown>
      : {},
    outcome: (row.outcome as PatternLibraryEntry["outcome"]) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    sourceProgramId: row.source_program_id,
    createdAt: row.created_at,
    usedCount: typeof row.used_count === "number" ? row.used_count : 0,
  };
}

export function usePatternLibrary(programId: string, industry?: string | null) {
  const [patterns, setPatterns] = useState<PatternLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      setPatterns([]);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("adam_pattern_library")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPatterns(((data || []) as PatternRow[]).map(toPatternEntry));
    } catch (error) {
      console.warn("Pattern library load failed:", error);
      setPatterns([]);
    } finally {
      setIsLoading(false);
    }
  }, [industry, programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentProgramPatterns = useMemo(
    () => patterns.filter((entry) => entry.sourceProgramId === programId),
    [patterns, programId],
  );
  const similarPatterns = useMemo(
    () => patterns.filter((entry) => entry.sourceProgramId !== programId && (!industry || entry.industry === industry)),
    [industry, patterns, programId],
  );

  return {
    patterns,
    currentProgramPatterns,
    similarPatterns,
    isLoading,
    refresh,
  };
}
