import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { RAIDEntry, RAIDEntryType } from "@/new/types";

function generateId(): string {
  return `raid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function useRaidLog(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getRaidLog = useCallback(() => {
    const wrapper = asRecord(rawData);
    const nested = asRecord(wrapper.data);
    const usesNestedData = Object.keys(nested).length > 0;
    const inner = usesNestedData ? nested : wrapper;
    const log = asRecord(inner.raidLog);
    const entries = Array.isArray(log.entries) ? log.entries as RAIDEntry[] : [];
    return { wrapper, inner, log, entries, usesNestedData };
  }, [rawData]);

  const persistRaidLog = useCallback(async (
    updatedEntries: RAIDEntry[],
    extra?: Record<string, unknown>,
  ) => {
    if (!isSupabaseConfigured || !supabase || !programId) throw new Error("Not configured.");
    setIsSaving(true);
    try {
      const { wrapper, inner, log, usesNestedData } = getRaidLog();
      const nextInner = {
        ...inner,
        raidLog: {
          ...log,
          entries: updatedEntries,
          ...extra,
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
  }, [getRaidLog, onRefresh, programId]);

  const closeEntry = useCallback(async (entryId: string, note?: string) => {
    const { entries } = getRaidLog();
    const updated = entries.map((entry) => (
      entry.id === entryId
        ? {
            ...entry,
            status: "closed" as const,
            closedAt: new Date().toISOString(),
            closedBy: "human" as const,
            closureNote: note ?? null,
          }
        : entry
    ));
    await persistRaidLog(updated);
  }, [getRaidLog, persistRaidLog]);

  const reopenEntry = useCallback(async (entryId: string) => {
    const { entries } = getRaidLog();
    const updated = entries.map((entry) => (
      entry.id === entryId
        ? {
            ...entry,
            status: "open" as const,
            closedAt: null,
            closedBy: null,
            closureNote: null,
          }
        : entry
    ));
    await persistRaidLog(updated);
  }, [getRaidLog, persistRaidLog]);

  const validateAssumption = useCallback(async (entryId: string) => {
    const { entries } = getRaidLog();
    const updated = entries.map((entry) => (
      entry.id === entryId
        ? {
            ...entry,
            validatedAt: new Date().toISOString(),
            status: "monitoring" as const,
          }
        : entry
    ));
    await persistRaidLog(updated);
  }, [getRaidLog, persistRaidLog]);

  const addEntry = useCallback(async (draft: {
    type: RAIDEntryType;
    title: string;
    description: string;
    severity: RAIDEntry["severity"];
    phase: string;
    owner?: string;
    mitigation?: string;
  }) => {
    const { entries } = getRaidLog();
    const newEntry: RAIDEntry = {
      id: generateId(),
      type: draft.type,
      title: draft.title,
      description: draft.description,
      severity: draft.severity,
      phase: draft.phase,
      owner: draft.owner ?? null,
      mitigation: draft.mitigation ?? null,
      status: "open",
      source: "human",
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null,
      closureNote: null,
    };
    await persistRaidLog([...entries, newEntry]);
  }, [getRaidLog, persistRaidLog]);

  return { closeEntry, reopenEntry, addEntry, validateAssumption, isSaving };
}
