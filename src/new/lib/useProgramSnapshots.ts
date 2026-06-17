import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface ProgramSnapshotMeta {
  id: string;
  label: string;
  kind: string;
  createdAt: string;
}

export type SnapshotKind = "manual" | "lock" | "auto";

// How many restore points to keep per programme. Snapshots live in their own
// table now (not the hot data blob), so this can be generous — it's only here so
// a long-running programme doesn't accumulate restore points without bound.
const MAX_SNAPSHOTS_PER_PROGRAM = 20;

const LOCAL_KEY_PREFIX = "adam:snapshots:";

function localKey(programId: string): string {
  return `${LOCAL_KEY_PREFIX}${programId}`;
}

interface LocalSnapshot extends ProgramSnapshotMeta {
  data: Record<string, unknown>;
}

function readLocal(programId: string): LocalSnapshot[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(localKey(programId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LocalSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(programId: string, snapshots: LocalSnapshot[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(localKey(programId), JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS_PER_PROGRAM)));
  } catch {
    // localStorage full or unavailable — drop silently; the cloud table is the
    // authoritative store when configured.
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Restore points for a programme, stored in adam_program_snapshots (or, when
 * Supabase is unavailable, mirrored to localStorage so local-only programmes
 * still get backup/recovery). Listing only fetches metadata — the full snapshot
 * payload is read lazily on revert, so the snapshot history never weighs down
 * either the programme load or this hook.
 */
export function useProgramSnapshots(programId: string | null, opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [snapshots, setSnapshots] = useState<ProgramSnapshotMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const programIdRef = useRef(programId);
  programIdRef.current = programId;

  const refresh = useCallback(async () => {
    if (!enabled || !programId) {
      setSnapshots([]);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setSnapshots(readLocal(programId).map(({ data: _data, ...meta }) => meta));
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("adam_program_snapshots")
        .select("id, label, kind, created_at")
        .eq("program_id", programId)
        .order("created_at", { ascending: false })
        .limit(MAX_SNAPSHOTS_PER_PROGRAM);
      if (error) throw error;
      if (programIdRef.current !== programId) return;
      setSnapshots(
        (data ?? []).map((row) => ({
          id: row.id as string,
          label: (row.label as string) || "Untitled save",
          kind: (row.kind as string) || "manual",
          createdAt: (row.created_at as string) || "",
        })),
      );
    } catch {
      // Cloud read failed — fall back to any locally mirrored restore points.
      if (programIdRef.current === programId) {
        setSnapshots(readLocal(programId).map(({ data: _data, ...meta }) => meta));
      }
    } finally {
      setIsLoading(false);
    }
  }, [enabled, programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSnapshot = useCallback(
    async (label: string, kind: SnapshotKind, data: Record<string, unknown>): Promise<void> => {
      if (!programId) return;
      const createdAt = new Date().toISOString();
      if (!isSupabaseConfigured || !supabase) {
        const entry: LocalSnapshot = { id: newId(), label, kind, createdAt, data };
        writeLocal(programId, [entry, ...readLocal(programId)]);
        await refresh();
        return;
      }
      const { error } = await supabase
        .from("adam_program_snapshots")
        .insert({ program_id: programId, label, kind, data: data as Json, created_at: createdAt });
      if (error) throw new Error(error.message || "Failed to save snapshot.");
      // Prune beyond the retention budget, oldest first. Best-effort: a failed
      // prune just leaves extra history, which is harmless.
      const { data: rows } = await supabase
        .from("adam_program_snapshots")
        .select("id")
        .eq("program_id", programId)
        .order("created_at", { ascending: false });
      const excess = (rows ?? []).slice(MAX_SNAPSHOTS_PER_PROGRAM).map((r) => r.id as string);
      if (excess.length) {
        await supabase.from("adam_program_snapshots").delete().in("id", excess);
      }
      await refresh();
    },
    [programId, refresh],
  );

  const getSnapshotData = useCallback(
    async (snapshotId: string): Promise<Record<string, unknown> | null> => {
      if (!programId) return null;
      if (!isSupabaseConfigured || !supabase) {
        const found = readLocal(programId).find((s) => s.id === snapshotId);
        return found?.data ?? null;
      }
      const { data, error } = await supabase
        .from("adam_program_snapshots")
        .select("data")
        .eq("id", snapshotId)
        .single();
      if (error || !data) return null;
      const payload = data.data;
      return payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    },
    [programId],
  );

  return { snapshots, isLoading, refresh, createSnapshot, getSnapshotData };
}
