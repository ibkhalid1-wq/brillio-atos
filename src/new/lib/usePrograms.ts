import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { normalizeProgram, updateDecisionInProgram } from "@/new/lib/programData";
import { ConflictError } from "@/new/lib/conflicts";
import type { ProgramSummary, DecisionSummary } from "@/new/types";
import { pushV3Toast } from "@/v3/utils";

type ProgramRow = Database["public"]["Tables"]["adam_programs"]["Row"];
type LocalProgramEntry = Record<string, unknown>;

const ACTIVE_PROGRAM_KEY = "adam:new:active-program";
const LEGACY_PROGRAM_STORAGE_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function loadLocalPrograms(): ProgramSummary[] {
  if (typeof localStorage === "undefined") return [];

  const rows = new Map<string, ProgramRow>();

  LEGACY_PROGRAM_STORAGE_KEYS.forEach((storageKey) => {
    const entries = safeJsonParse<unknown[]>(localStorage.getItem(storageKey), []);
    entries.forEach((entry) => {
      if (!isRecord(entry)) return;
      const wrapper = isRecord(entry.data) ? entry.data : entry;
      const projectMeta = isRecord(wrapper.projectMeta)
        ? wrapper.projectMeta
        : isRecord((wrapper as Record<string, unknown>).data) && isRecord(((wrapper as Record<string, unknown>).data as Record<string, unknown>).projectMeta)
          ? (((wrapper as Record<string, unknown>).data as Record<string, unknown>).projectMeta as Record<string, unknown>)
          : {};
      const id = asString(entry.id || wrapper.id);
      if (!id) return;
      const updatedAt = asString(entry.updatedAt || wrapper.updatedAt || wrapper._syncedAt || wrapper.lastActiveAt, new Date().toISOString());
      rows.set(id, {
        id,
        name: asString(entry.name || wrapper.name || projectMeta.name, "Untitled Program"),
        client: asString(entry.client || wrapper.client || projectMeta.client, "") || null,
        industry: asString(entry.industry || wrapper.industry || projectMeta.industry, "") || null,
        updated_at: updatedAt,
        is_deleted: false,
        owner_id: null,
        created_at: updatedAt,
        status: "active",
        data: (isRecord(entry.data) ? entry.data : entry) as Json,
      } as ProgramRow);
    });
  });

  return Array.from(rows.values())
    .map((row) => normalizeProgram(row))
    .sort((left, right) => (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    ));
}

/**
 * Remove a program from the legacy localStorage caches. Used to self-heal stale
 * copies of programs that were soft-deleted in the cloud (e.g. deleted before the
 * delete path purged localStorage) so they can't be re-surfaced or resurrected.
 */
function purgeLocalPrograms(programIds: Set<string>) {
  if (typeof localStorage === "undefined" || programIds.size === 0) return;
  LEGACY_PROGRAM_STORAGE_KEYS.forEach((storageKey) => {
    const entries = safeJsonParse<unknown[]>(localStorage.getItem(storageKey), []);
    if (!Array.isArray(entries) || entries.length === 0) return;
    const nextEntries = entries.filter((entry) => {
      const id = isRecord(entry) ? asString(entry.id) : "";
      return !programIds.has(id);
    });
    if (nextEntries.length !== entries.length) {
      localStorage.setItem(storageKey, JSON.stringify(nextEntries));
    }
  });
}

function persistLocalProgram(programId: string, nextData: Record<string, unknown>) {
  if (typeof localStorage === "undefined") return;

  const nextTimestamp = new Date().toISOString();
  let updatedAny = false;

  LEGACY_PROGRAM_STORAGE_KEYS.forEach((storageKey) => {
    const entries = safeJsonParse<unknown[]>(localStorage.getItem(storageKey), []);
    const nextEntries = entries.map((entry) => {
      if (!isRecord(entry) || asString(entry.id) !== programId) return entry;
      updatedAny = true;
      const meta = isRecord(nextData.projectMeta) ? nextData.projectMeta : {};
      return {
        ...entry,
        name: asString((entry as LocalProgramEntry).name, asString(meta.name, "Untitled Program")),
        client: asString((entry as LocalProgramEntry).client, asString(meta.client)),
        industry: asString((entry as LocalProgramEntry).industry, asString(meta.industry)),
        updatedAt: nextTimestamp,
        lastActiveAt: nextTimestamp,
        data: {
          ...nextData,
          _syncedAt: nextTimestamp,
        },
      };
    });
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
  });

  if (!updatedAny) {
    const defaultKey = LEGACY_PROGRAM_STORAGE_KEYS[0];
    const entries = safeJsonParse<unknown[]>(localStorage.getItem(defaultKey), []);
    const meta = isRecord(nextData.projectMeta) ? nextData.projectMeta : {};
    entries.unshift({
      id: programId,
      name: asString(meta.name, "Untitled Program"),
      client: asString(meta.client),
      industry: asString(meta.industry),
      updatedAt: nextTimestamp,
      lastActiveAt: nextTimestamp,
      data: {
        ...nextData,
        _syncedAt: nextTimestamp,
      },
    });
    localStorage.setItem(defaultKey, JSON.stringify(entries));
  }
}

interface UseProgramsOptions {
  enabled?: boolean;
  userId?: string | null;
}

export type ProgramRole = "admin" | "editor" | "viewer";

export function usePrograms({ enabled = true, userId = null }: UseProgramsOptions = {}) {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [programRoles, setProgramRoles] = useState<Record<string, ProgramRole>>({});
  const [activeProgramId, setActiveProgramIdState] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const hasResolvedOnce = useRef(false);
  const localKnownUpdatedAt = useRef<Record<string, string>>({});
  const normalizationCache = useRef<Map<string, ProgramSummary>>(new Map());

  const refreshPrograms = useCallback(async () => {
    if (!enabled) {
      setPrograms([]);
      setActiveProgramIdState("");
      setIsLoading(false);
      setError("");
      hasResolvedOnce.current = true;
      return;
    }

    const localPrograms = loadLocalPrograms();

    if (!isSupabaseConfigured || !supabase) {
      setPrograms(localPrograms);
      // Local-only programs are fully owned by this browser session.
      setProgramRoles(Object.fromEntries(localPrograms.map((p) => [p.id, "admin" as ProgramRole])));
      setError(localPrograms.length ? "" : "Supabase is not configured for this workspace.");
      const storedId = typeof localStorage !== "undefined"
        ? localStorage.getItem(ACTIVE_PROGRAM_KEY) || ""
        : "";
      const nextActive = localPrograms.find((program) => program.id === storedId)?.id || localPrograms[0]?.id || "";
      setActiveProgramIdState(nextActive);
      setIsLoading(false);
      hasResolvedOnce.current = true;
      return;
    }

    setIsLoading(!hasResolvedOnce.current);
    setError("");

    try {
      // No owner filter: row-level security scopes visibility to programs the
      // signed-in user owns or has been granted membership on, so collaborators
      // see shared programs too. We fetch deleted rows too (no is_deleted filter)
      // so we can reconcile stale local caches against cloud deletions below.
      const query = supabase
        .from("adam_programs")
        .select("id, name, client, industry, updated_at, data, is_deleted, owner_id")
        .order("updated_at", { ascending: false });

      const { data: allRows, error: loadError } = await query;

      if (loadError) {
        throw new Error(loadError.message || "Failed to load programs.");
      }

      // Split cloud rows into live vs soft-deleted. Purge any local cache copy of
      // a soft-deleted program so it can't be re-surfaced as "local-only" or
      // resurrected by the migration upsert below (this caused deleted programs
      // to reappear and flicker on the rail).
      const deletedIds = new Set(
        ((allRows || []) as ProgramRow[]).filter((row) => row.is_deleted).map((row) => row.id),
      );
      if (deletedIds.size) purgeLocalPrograms(deletedIds);
      const data = ((allRows || []) as ProgramRow[]).filter((row) => !row.is_deleted);
      const liveLocalPrograms = localPrograms.filter((program) => !deletedIds.has(program.id));

      const normalized = ((data || []) as ProgramRow[]).map((row) => {
        const cacheKey = `${row.id}:${row.updated_at}`;
        const cached = normalizationCache.current.get(cacheKey);
        if (cached) return cached;
        const nextValue = normalizeProgram(row);
        normalizationCache.current.set(cacheKey, nextValue);
        if (normalizationCache.current.size > 5) {
          const firstKey = normalizationCache.current.keys().next().value;
          if (firstKey) normalizationCache.current.delete(firstKey);
        }
        return nextValue;
      });
      normalized.forEach((program) => {
        localKnownUpdatedAt.current[program.id] = program.updatedAt;
      });

      // If DB returned no programs but we have local ones, migrate them up to Supabase
      // so agent edge-function calls can find them by ID. Only migrate programs not
      // soft-deleted in the cloud, so a delete can't be undone by re-upserting.
      if (normalized.length === 0 && liveLocalPrograms.length > 0 && userId) {
        const upsertRows = liveLocalPrograms.map((program) => ({
          id: program.id,
          name: program.name,
          client: program.client || null,
          industry: program.industry || null,
          owner_id: userId,
          data: (program.rawData || {}) as Json,
          is_deleted: false,
          updated_at: program.updatedAt || new Date().toISOString(),
          created_at: program.updatedAt || new Date().toISOString(),
        }));
        await supabase
          .from("adam_programs")
          .upsert(upsertRows, { onConflict: "id", ignoreDuplicates: false })
          .then(({ error: upsertErr }) => {
            if (upsertErr) console.warn("Local→DB program sync failed:", upsertErr.message);
          });
      }

      // Merge: if a local program is newer than the Supabase version (e.g. after a
      // failed RLS UPSERT that fell back to localStorage), prefer the local copy so
      // gate approvals and other saves are immediately visible in the UI.
      const localById = new Map(liveLocalPrograms.map((lp) => [lp.id, lp]));
      const mergedNormalized = normalized.map((remoteProgram) => {
        const localProgram = localById.get(remoteProgram.id);
        if (!localProgram) return remoteProgram;
        const localMs = new Date(localProgram.updatedAt).getTime();
        const remoteMs = new Date(remoteProgram.updatedAt).getTime();
        return localMs > remoteMs ? localProgram : remoteProgram;
      });
      // Include programs that exist only in localStorage (not yet in Supabase)
      const remoteIds = new Set(normalized.map((p) => p.id));
      const localOnlyPrograms = liveLocalPrograms.filter((lp) => !remoteIds.has(lp.id));
      const allEffective = [...mergedNormalized, ...localOnlyPrograms];

      const effectivePrograms = allEffective.length ? allEffective : liveLocalPrograms;
      setPrograms(effectivePrograms);

      // Resolve the signed-in user's role per program. The owner is always an
      // admin; otherwise the role comes from adam_program_members. Local-only
      // programs default to admin (full local control).
      const roleMap: Record<string, ProgramRole> = {};
      const ownerById = new Map(((data || []) as ProgramRow[]).map((row) => [row.id, row.owner_id]));
      if (userId) {
        const { data: memberships } = await supabase
          .from("adam_program_members")
          .select("program_id, role")
          .eq("user_id", userId);
        (memberships || []).forEach((m) => {
          const role = m.role as ProgramRole;
          if (role === "admin" || role === "editor" || role === "viewer") {
            roleMap[m.program_id as string] = role;
          }
        });
      }
      effectivePrograms.forEach((program) => {
        if (ownerById.get(program.id) && ownerById.get(program.id) === userId) {
          roleMap[program.id] = "admin";
        } else if (!roleMap[program.id]) {
          // Visible but no explicit membership/ownership row (e.g. local-only) →
          // treat as admin so the user retains control of their own data.
          roleMap[program.id] = ownerById.has(program.id) ? "viewer" : "admin";
        }
      });
      setProgramRoles(roleMap);

      const storedId = typeof localStorage !== "undefined"
        ? localStorage.getItem(ACTIVE_PROGRAM_KEY) || ""
        : "";
      const preferredId = effectivePrograms.some((program) => program.id === activeProgramId) ? activeProgramId : storedId;
      const nextActive = effectivePrograms.find((program) => program.id === preferredId)?.id || effectivePrograms[0]?.id || "";
      setActiveProgramIdState(nextActive);
      setError(normalized.length || !localPrograms.length ? "" : "");
      hasResolvedOnce.current = true;
    } catch (caughtError) {
      if (localPrograms.length) {
        setPrograms(localPrograms);
        setProgramRoles(Object.fromEntries(localPrograms.map((p) => [p.id, "admin" as ProgramRole])));
        const storedId = typeof localStorage !== "undefined"
          ? localStorage.getItem(ACTIVE_PROGRAM_KEY) || ""
          : "";
        const nextActive = localPrograms.find((program) => program.id === storedId)?.id || localPrograms[0]?.id || "";
        setActiveProgramIdState(nextActive);
        setError("");
        hasResolvedOnce.current = true;
      } else {
        setPrograms([]);
        setProgramRoles({});
        setError(caughtError instanceof Error ? caughtError.message : "Failed to load programs.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeProgramId, enabled, userId]);

  useEffect(() => {
    void refreshPrograms();
  }, [refreshPrograms]);

  const activeProgram = useMemo(
    () => programs.find((program) => program.id === activeProgramId) || null,
    [activeProgramId, programs],
  );

  const getProgramRole = useCallback(
    (programId: string): ProgramRole => programRoles[programId] || "admin",
    [programRoles],
  );

  const activeProgramRole = useMemo<ProgramRole>(
    () => (activeProgramId ? (programRoles[activeProgramId] || "admin") : "admin"),
    [activeProgramId, programRoles],
  );

  const canEditActiveProgram = activeProgramRole === "admin" || activeProgramRole === "editor";
  const isActiveProgramAdmin = activeProgramRole === "admin";

  const setActiveProgramId = useCallback((programId: string) => {
    setActiveProgramIdState(programId);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACTIVE_PROGRAM_KEY, programId);
    }
  }, []);

  const updateProgramData = useCallback(async (programId: string, nextData: Record<string, unknown>, expectedUpdatedAt?: string) => {
    if (!isSupabaseConfigured || !supabase) {
      persistLocalProgram(programId, nextData);
      await refreshPrograms();
      return;
    }
    // Viewers have read-only access. Block the write up front rather than letting
    // it fail at the RLS layer and fall back to a misleading local-only save.
    if (programRoles[programId] === "viewer") {
      pushV3Toast("You have read-only access to this program and cannot make changes.", { tone: "warning", duration: 6000 });
      throw new Error("Read-only access: you cannot modify this program.");
    }
    const program = programs.find((entry) => entry.id === programId);
    if (!program) {
      throw new Error("Program not found.");
    }
    const payload = {
      ...nextData,
      _syncedAt: new Date().toISOString(),
    };
    // Defensive snapshot trim. Each programSnapshot embeds a full program copy, so
    // an unbounded history bloats the `data` blob until a read-modify-write trips
    // Postgres's statement_timeout and the app fails to mount. Cap the history on
    // EVERY write (not just snapshot creation) so legacy oversized blobs self-heal.
    if (Array.isArray(payload.programSnapshots)) {
      const MAX_SNAPSHOTS = 8;
      const MAX_SNAPSHOTS_BYTES = 120_000;
      let kept = (payload.programSnapshots as Array<Record<string, unknown>>).slice(0, MAX_SNAPSHOTS);
      while (kept.length > 1) {
        let bytes = 0;
        try {
          bytes = JSON.stringify(kept).length;
        } catch {
          break;
        }
        if (bytes <= MAX_SNAPSHOTS_BYTES) break;
        kept = kept.slice(0, kept.length - 1);
      }
      payload.programSnapshots = kept;
    }
    let currentUpdatedAt: string | null = null;
    if (expectedUpdatedAt) {
      const { data: current } = await supabase
        .from("adam_programs")
        .select("updated_at")
        .eq("id", programId)
        .single();
      currentUpdatedAt = current?.updated_at || null;
      if (currentUpdatedAt && currentUpdatedAt !== expectedUpdatedAt) {
        throw new ConflictError("Program was updated by another session. Refresh to see the latest version before making changes.");
      }
    }
    const nextUpdatedAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from("adam_programs")
      .update({
        data: payload as Json,
        updated_at: nextUpdatedAt,
      })
      .eq("id", programId)
      .select("id");
    if (updateError) {
      throw new Error(updateError.message || "Failed to update program.");
    }
    // If 0 rows were updated (RLS blocked it or row doesn't exist yet), upsert with full data
    if (!updatedRows || updatedRows.length === 0) {
      console.warn("[updateProgramData] UPDATE affected 0 rows — attempting upsert for programId:", programId);
      const { error: upsertError } = await supabase
        .from("adam_programs")
        .upsert({
          id: programId,
          name: program.name,
          client: program.client || null,
          industry: program.industry || null,
          data: payload as Json,
          updated_at: nextUpdatedAt,
          is_deleted: false,
          owner_id: program.rawData && typeof (program.rawData as Record<string, unknown>).owner_id === "string"
            ? (program.rawData as Record<string, unknown>).owner_id as string
            : null,
        }, { onConflict: "id" });
      if (upsertError) {
        // Upsert also failed — persist locally so the change isn't lost from THIS
        // session, but make the degradation visible: a local-only save will not
        // survive on another device or after the browser cache is cleared, and
        // agents (which read from the cloud) can't see it.
        console.error("[updateProgramData] Upsert failed, persisting locally:", upsertError.message);
        persistLocalProgram(programId, nextData);
        pushV3Toast(
          "Saved locally only — could not sync to the cloud. This change won't appear on other devices and may be lost. Check your access to this program.",
          { tone: "warning", duration: 8000 },
        );
      }
    }
    if (!expectedUpdatedAt && currentUpdatedAt && localKnownUpdatedAt.current[programId] && currentUpdatedAt !== localKnownUpdatedAt.current[programId]) {
      pushV3Toast("Another update was made while you were saving. Your changes were applied — refresh to verify.", { tone: "warning", duration: 6000 });
    }
    localKnownUpdatedAt.current[programId] = nextUpdatedAt;
    await refreshPrograms();
  }, [programs, programRoles, refreshPrograms]);

  const resolveDecision = useCallback(async (
    programId: string,
    decisionId: string,
    resolution: "approved" | "deferred" | "rejected" | "modified",
    actorOrNote?: string,
    modifiedContent?: string,
    note?: string,
    decisionPayload?: DecisionSummary,
  ) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) throw new Error("Program not found.");
    const decision = program.decisionQueue.find((entry) => entry.id === decisionId) || null;
    const actorEmail = note
      ? actorOrNote
      : typeof actorOrNote === "string" && actorOrNote.includes("@")
        ? actorOrNote
        : undefined;
    const humanNote = note
      ?? (typeof actorOrNote === "string" && !actorOrNote.includes("@") ? actorOrNote : undefined);
    if (decision?.runId && isSupabaseConfigured && supabase && (resolution === "approved" || resolution === "deferred" || resolution === "rejected" || resolution === "modified")) {
      const resumeResolution = resolution === "deferred" ? "rejected" : resolution;
      const { error } = await supabase.functions.invoke("resume-agent", {
        body: {
          runId: decision.runId,
          decisionId,
          resolution: resumeResolution,
          modifiedContent: resolution === "modified" ? modifiedContent || "" : undefined,
        },
      });
      if (error) {
        throw new Error(error.message || "Failed to resume agent.");
      }
    }
    const nextData = updateDecisionInProgram(program, decisionId, resolution, humanNote, actorEmail, modifiedContent, decisionPayload);
    await updateProgramData(programId, nextData);
  }, [programs, updateProgramData]);

  return {
    programs,
    activeProgram,
    activeProgramId,
    setActiveProgramId,
    refreshPrograms,
    updateProgramData,
    resolveDecision,
    isLoading,
    error,
    programRoles,
    getProgramRole,
    activeProgramRole,
    canEditActiveProgram,
    isActiveProgramAdmin,
  };
}
