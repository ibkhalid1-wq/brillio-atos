import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureSnapshot } from "@/v3/lib/blobSnapshots";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { normalizeProgram, updateDecisionInProgram } from "@/new/lib/programData";
import { ConflictError } from "@/new/lib/conflicts";
import type { ProgramSummary, DecisionSummary } from "@/new/types";
import { pushV3Toast } from "@/v3/utils";
import { enqueueWrite, flushWriteQueue, getQueuedWriteCount } from "@/lib/writeQueue";
import { hasSubstantiveProgramData } from "@/v3/lib/programDataGuard";
import { logFlowEvent } from "@/v3/lib/flowEvents";
import { persistExternalTexts, hydrateExternalTexts } from "@/v3/lib/programTextsSync";

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
  // Render-gating mirror of hasResolvedOnce. The ref alone can't drive a
  // re-render, so consumers (e.g. the V3 shell's empty-state gate) read this
  // state to distinguish "genuinely resolved with zero programs" (show Welcome)
  // from "not loaded yet for this signed-in user" (keep the skeleton). Without
  // it, the one frame between sign-in and the load effect flashes the Welcome
  // hero before the Today screen.
  const [hasResolvedPrograms, setHasResolvedPrograms] = useState(false);
  const localKnownUpdatedAt = useRef<Record<string, string>>({});
  const normalizationCache = useRef<Map<string, ProgramSummary>>(new Map());
  // Last authoritative (blob-hydrated) methodology per programme id. Lets a
  // blob-less metadata refresh carry the real methodology instead of reverting
  // to its default — see buildCloudSummary.
  const methodologyByIdRef = useRef<Record<string, ProgramSummary["methodology"]>>({});
  // Metadata-only list path. The list query no longer pulls every programme's
  // heavy `data` JSON blob (the dominant cost behind slow refresh/unlock); it
  // selects metadata columns only. Full blobs are fetched lazily per-id (active
  // programme up front in refreshPrograms; the rest on demand via hydratePrograms,
  // e.g. when the Portfolio surface opens) and cached here keyed by id, tagged
  // with the row's updated_at so a stale blob is re-fetched after an edit.
  const hydratedDataById = useRef<Map<string, { updatedAt: string; data: Json }>>(new Map());
  // Source rows for composePrograms: the latest live cloud metadata rows and the
  // live local-cache programs. Kept in refs so hydratePrograms can recompose the
  // list (merging freshly hydrated blobs) without re-running the whole refresh.
  const cloudMetaRowsRef = useRef<ProgramRow[]>([]);
  const localProgramsRef = useRef<ProgramSummary[]>([]);
  // Mirror of activeProgramId read inside refreshPrograms. Keeping it in a ref
  // (instead of the callback's dependency array) means refreshPrograms stays
  // referentially STABLE across active-program changes. Otherwise every selection
  // re-created the callback, re-fired the load effect, and triggered a full
  // refetch of every program's `data` blob — the dominant cost behind the slow
  // refresh/unlock — and churned every hook that takes refreshPrograms as a dep.
  const activeProgramIdRef = useRef<string>("");

  // Normalise one cloud metadata row into a ProgramSummary, hydrating it from the
  // blob cache when a fresh blob is available, otherwise producing a lightweight
  // (metadata-only) summary. Results are memoised by id+updated_at+hydration state
  // so re-composing the list after a partial hydration is cheap.
  const buildCloudSummary = useCallback((row: ProgramRow): ProgramSummary => {
    const hydrated = hydratedDataById.current.get(row.id);
    const data = hydrated && hydrated.updatedAt === row.updated_at ? hydrated.data : undefined;
    const cacheKey = `${row.id}:${row.updated_at}:${data != null ? "full" : "meta"}`;
    let base = normalizationCache.current.get(cacheKey);
    if (!base) {
      base = normalizeProgram({
        id: row.id,
        name: row.name,
        client: row.client,
        industry: row.industry,
        updated_at: row.updated_at,
        data,
      });
      normalizationCache.current.set(cacheKey, base);
      // Keep a generous cache so multiple programmes (each in meta + full variants)
      // survive a recompose without thrashing; lightweight re-normalisation is cheap.
      if (normalizationCache.current.size > 64) {
        const firstKey = normalizationCache.current.keys().next().value;
        if (firstKey) normalizationCache.current.delete(firstKey);
      }
    }
    // `methodology` lives in the data blob, which streams in a beat after the
    // metadata list on every refresh. During that beat `data` is undefined and
    // methodology falls back to its "atos-standard" default — so a programme
    // whose real methodology is another variant (e.g. atos-flow) would flip on
    // every refresh, which surfaces as a shell/UI flash for any consumer that
    // renders on methodology. A programme's methodology is immutable within a
    // session (the setup wizard re-saves the blob, and the next hydrated read
    // updates this map), so remember the last authoritative value and carry it
    // across the blob-less window rather than reverting to the default.
    if (data != null) {
      methodologyByIdRef.current[row.id] = base.methodology;
      return base;
    }
    const known = methodologyByIdRef.current[row.id];
    return known && known !== base.methodology ? { ...base, methodology: known } : base;
  }, []);

  // Recompose the effective programmes list from the cached source rows + the blob
  // cache. Used both at the end of a refresh and after a lazy hydration.
  const composePrograms = useCallback((): ProgramSummary[] => {
    const normalized = cloudMetaRowsRef.current.map(buildCloudSummary);
    normalized.forEach((program) => {
      localKnownUpdatedAt.current[program.id] = program.updatedAt;
    });
    const live = localProgramsRef.current;
    const localById = new Map(live.map((lp) => [lp.id, lp]));
    // Prefer a local copy only when it is genuinely newer (e.g. after a failed RLS
    // write that fell back to localStorage); otherwise the cloud row wins.
    const merged = normalized.map((remoteProgram) => {
      const localProgram = localById.get(remoteProgram.id);
      if (!localProgram) return remoteProgram;
      const localMs = new Date(localProgram.updatedAt).getTime();
      const remoteMs = new Date(remoteProgram.updatedAt).getTime();
      return localMs > remoteMs ? localProgram : remoteProgram;
    });
    const remoteIds = new Set(normalized.map((p) => p.id));
    const localOnly = live.filter((lp) => !remoteIds.has(lp.id));
    const all = [...merged, ...localOnly];
    return all.length ? all : live;
  }, [buildCloudSummary]);

  // Fetch + cache the full `data` blob for the given programme ids, skipping any
  // already-fresh in the cache. Returns true if the cache changed. No setState —
  // callers decide whether to recompose (refreshPrograms composes once at the end;
  // hydratePrograms recomposes immediately).
  const fetchDataRows = useCallback(async (ids: string[]): Promise<boolean> => {
    if (!isSupabaseConfigured || !supabase) return false;
    const need = [...new Set(ids)].filter((id) => {
      if (!id) return false;
      const row = cloudMetaRowsRef.current.find((r) => r.id === id);
      if (!row) return false; // not a cloud programme (local-only copies are already full)
      const have = hydratedDataById.current.get(id);
      return !have || have.updatedAt !== row.updated_at;
    });
    if (need.length === 0) return false;
    const { data: rows, error: fetchError } = await supabase
      .from("adam_programs")
      .select("id, updated_at, data")
      .in("id", need);
    if (fetchError || !rows) return false;
    // Externalization (flag-gated, default OFF): merge each programme's
    // externalized transcripts back into its blob so the synchronous readers see
    // the full record. A no-op returning `r.data` unchanged until dual-read is
    // enabled — see programTextsSync.ts / docs/transcript-externalization.md.
    for (const r of rows as Array<{ id: string; updated_at: string; data: Json }>) {
      const merged = await hydrateExternalTexts(supabase, r.id, r.data);
      hydratedDataById.current.set(r.id, { updatedAt: r.updated_at, data: merged as Json });
    }
    return true;
  }, []);

  const refreshPrograms = useCallback(async () => {
    if (!enabled) {
      setPrograms([]);
      setActiveProgramIdState("");
      setIsLoading(false);
      setError("");
      // Signed-out / disabled is NOT a resolved program state. If we marked it
      // resolved, the first real load after sign-in would keep isLoading=false
      // (see `setIsLoading(!hasResolvedOnce.current)` below) — leaving programs
      // empty for the whole fetch and flashing the "Welcome to Brillio" empty
      // state before the Today screen. Resetting here means the next enabled
      // refresh raises the skeleton instead, then resolves straight to Today.
      hasResolvedOnce.current = false;
      setHasResolvedPrograms(false);
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
      setHasResolvedPrograms(true);
      return;
    }

    setIsLoading(!hasResolvedOnce.current);
    setError("");

    try {
      // Retry any writes that were queued while offline / after a statement-timeout
      // before reading, so a successful flush is reflected in the rows we fetch below.
      if (getQueuedWriteCount() > 0) {
        await flushWriteQueue(supabase);
      }

      // No owner filter: row-level security scopes visibility to programs the
      // signed-in user owns or has been granted membership on, so collaborators
      // see shared programs too. We fetch deleted rows too (no is_deleted filter)
      // so we can reconcile stale local caches against cloud deletions below.
      // Metadata-only: `data` is deliberately NOT selected — see hydratedDataById.
      //
      // The programmes list and the per-programme role memberships are independent
      // reads, so fire them in PARALLEL. First paint then waits on a single round
      // trip (max of the two) instead of metadata → memberships → active-blob
      // chained sequentially — the latter is what made cold launch crawl.
      const [
        { data: allRows, error: loadError },
        membershipResult,
      ] = await Promise.all([
        supabase
          .from("adam_programs")
          .select("id, name, client, industry, updated_at, is_deleted, owner_id")
          .order("updated_at", { ascending: false }),
        userId
          ? supabase
              .from("adam_program_members")
              .select("program_id, role")
              .eq("user_id", userId)
          : Promise.resolve({ data: [] as Array<{ program_id: string; role: string }> }),
      ]);

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
      const liveCloudRows = ((allRows || []) as ProgramRow[]).filter((row) => !row.is_deleted);
      const liveLocalPrograms = localPrograms.filter((program) => !deletedIds.has(program.id));

      // Evict blob-cache entries for programmes that are gone or soft-deleted, so
      // the cache can't grow unbounded or resurrect a deleted blob.
      const liveCloudIds = new Set(liveCloudRows.map((row) => row.id));
      for (const cachedId of [...hydratedDataById.current.keys()]) {
        if (!liveCloudIds.has(cachedId)) hydratedDataById.current.delete(cachedId);
      }

      cloudMetaRowsRef.current = liveCloudRows;
      localProgramsRef.current = liveLocalPrograms;

      // If DB returned no programs but we have local ones, migrate them up to Supabase
      // so agent edge-function calls can find them by ID. Only migrate programs not
      // soft-deleted in the cloud, so a delete can't be undone by re-upserting.
      //
      // Guard against silent data loss: a degraded/expiring session can be accepted
      // by the server yet scope this SELECT to zero rows, making a still-existing
      // cloud row look absent. Upserting an empty / never-hydrated local blob over it
      // (onConflict: "id") would then clobber the real data. So only migrate local
      // copies that actually carry content — an empty rawData has nothing worth
      // pushing and is exactly the dangerous case.
      const migratable =
        liveCloudRows.length === 0 && userId
          ? liveLocalPrograms.filter((program) => {
              const raw = program.rawData;
              return (
                !!raw &&
                typeof raw === "object" &&
                Object.keys(raw as Record<string, unknown>).length > 0
              );
            })
          : [];
      if (migratable.length > 0 && userId) {
        const upsertRows = migratable.map((program) => ({
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
          .then(({ error: upsertErr }: { error: { message: string } | null }) => {
            if (upsertErr) console.warn("Local→DB program sync failed:", upsertErr.message);
          });
      }

      // Compose + paint the (metadata-only) list immediately — the active
      // programme's full blob is hydrated AFTER paint (below), so first paint is
      // not gated on a second round trip for a potentially large blob.
      const effectivePrograms = composePrograms();
      const storedId = typeof localStorage !== "undefined"
        ? localStorage.getItem(ACTIVE_PROGRAM_KEY) || ""
        : "";
      const currentActiveId = activeProgramIdRef.current;
      const preferredId = effectivePrograms.some((program) => program.id === currentActiveId) ? currentActiveId : storedId;
      const nextActive = effectivePrograms.find((program) => program.id === preferredId)?.id || effectivePrograms[0]?.id || "";

      setPrograms(effectivePrograms);

      // Resolve the signed-in user's role per program from the memberships fetched
      // in parallel above. The owner is always an admin; otherwise the role comes
      // from adam_program_members. Local-only programs default to admin.
      const roleMap: Record<string, ProgramRole> = {};
      const ownerById = new Map(liveCloudRows.map((row) => [row.id, row.owner_id]));
      ((membershipResult.data || []) as Array<{ program_id: string; role: string }>).forEach((m) => {
        const role = m.role as ProgramRole;
        if (role === "admin" || role === "editor" || role === "viewer") {
          roleMap[m.program_id] = role;
        }
      });
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

      setActiveProgramIdState(nextActive);
      setError("");
      hasResolvedOnce.current = true;
      setHasResolvedPrograms(true);

      // Hydrate the active programme's full blob WITHOUT blocking first paint: the
      // metadata list is already on screen; its rich data streams in a moment later
      // via a single-row fetch. If it's already cached (e.g. right after a write,
      // which primes the cache) this is a no-op and there is no flash.
      if (nextActive) {
        void fetchDataRows([nextActive]).then((changed) => {
          if (changed) setPrograms(composePrograms());
        });
      }
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
        setHasResolvedPrograms(true);
      } else {
        setPrograms([]);
        setProgramRoles({});
        setError(caughtError instanceof Error ? caughtError.message : "Failed to load programs.");
        // A failed load with no local fallback is still a resolved (empty)
        // outcome — let the empty-state render instead of leaving the shell
        // stuck on an indefinite skeleton.
        setHasResolvedPrograms(true);
      }
    } finally {
      setIsLoading(false);
    }
    // composePrograms/fetchDataRows are referentially stable (deps are stable
    // callbacks/refs), so refreshPrograms stays stable too — selecting a programme
    // does not recreate it or re-fire the load effect.
  }, [enabled, userId, composePrograms, fetchDataRows]);

  // Lazily hydrate the full `data` blobs for the given programmes and recompose the
  // list so consumers that need rich per-programme data for the WHOLE list (e.g.
  // the Portfolio surface) get it on demand, instead of every refresh paying for it.
  const hydratePrograms = useCallback(async (ids: string[]) => {
    const changed = await fetchDataRows(ids);
    if (changed) setPrograms(composePrograms());
  }, [fetchDataRows, composePrograms]);

  // Keep the ref refreshPrograms reads in sync with the live state, without
  // putting activeProgramId in the callback's dependency array (which would make
  // it unstable and re-trigger full refetches on every selection — see the ref).
  useEffect(() => {
    activeProgramIdRef.current = activeProgramId;
  }, [activeProgramId]);

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

  const setActiveProgramId = useCallback((programId: string | null) => {
    const next = programId ?? "";
    setActiveProgramIdState(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACTIVE_PROGRAM_KEY, next);
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
    // Reversibility: stash the blob's PRIOR state in the local snapshot ring
    // before this write replaces it. Fire-and-forget — history-keeping must
    // never delay or fail a save.
    void captureSnapshot(programId, (program.rawData ?? null) as Record<string, unknown> | null);
    const payload: Record<string, unknown> = {
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
    // DATA-LOSS GUARD. A content-free payload almost always means the program's
    // `data` blob hasn't finished hydrating (rawData was still `{}` when this save
    // was built). The optimistic `updated_at` check below can't catch that — the
    // in-memory timestamp still matches the row — so without this the empty blob
    // would overwrite real, unrecoverable content. Re-read the row and refuse the
    // clobber when the cloud copy still holds working content.
    if (!hasSubstantiveProgramData(payload)) {
      const { data: currentRow } = await supabase
        .from("adam_programs")
        .select("data")
        .eq("id", programId)
        .maybeSingle();
      if (currentRow && hasSubstantiveProgramData(currentRow.data)) {
        pushV3Toast(
          "Save blocked — this program is still loading. Refresh before editing so saved work isn't overwritten.",
          { tone: "error", duration: 8000 },
        );
        throw new Error("Refused to overwrite a populated program with empty data (pre-hydration guard).");
      }
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
    // Externalization (flag-gated, default OFF): split the large transcript
    // fields out into adam_program_texts so the blob shipped below stays small.
    // A no-op returning `payload` unchanged until dual-write is enabled — see
    // programTextsSync.ts / docs/transcript-externalization.md.
    const blobToStore = await persistExternalTexts(supabase, programId, payload);
    const nextUpdatedAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from("adam_programs")
      .update({
        data: blobToStore as Json,
        updated_at: nextUpdatedAt,
      })
      .eq("id", programId)
      .select("id, updated_at");
    if (updateError) {
      // A failed UPDATE here is the offline / statement-timeout case: the write
      // never reached Postgres. Queue it so the next refresh retries it, and keep
      // the change in this session's local cache so it isn't lost in the meantime.
      // Queue the (already-shrunk) blob; the texts rows were written above, so a
      // later replay + dual-read merge reconstructs the full record.
      enqueueWrite("adam_programs", programId, { data: blobToStore as Json, updated_at: nextUpdatedAt }, expectedUpdatedAt ?? currentUpdatedAt ?? undefined);
      persistLocalProgram(programId, nextData);
      pushV3Toast(
        "Couldn't reach the server — saved locally and queued to retry automatically.",
        { tone: "warning", duration: 7000 },
      );
      localKnownUpdatedAt.current[programId] = nextUpdatedAt;
      await refreshPrograms();
      return;
    }
    // Design rec 2: every successful blob write is shadowed by an append-only,
    // server-timestamped journal event — history the client cannot rewrite.
    // No-op until the delivered event-journal migration is applied.
    logFlowEvent({ programId, kind: "program.updated", detail: { at: nextUpdatedAt } });
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
          data: blobToStore as Json,
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
    // Prime the blob cache with what we just persisted so the metadata-only refresh
    // below recomposes this programme fully WITHOUT a second single-row data fetch.
    // Key it by the DB-returned updated_at (not the client ISO we sent) so the
    // string matches exactly what the next list refetch returns — Postgres can
    // round-trip a timestamptz in a different textual format, which would otherwise
    // make the cache look stale and trigger a needless re-fetch.
    const persistedUpdatedAt = (updatedRows?.[0] as { updated_at?: string } | undefined)?.updated_at || nextUpdatedAt;
    hydratedDataById.current.set(programId, { updatedAt: persistedUpdatedAt, data: payload as Json });
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
    hydratePrograms,
    updateProgramData,
    resolveDecision,
    isLoading,
    hasResolvedPrograms,
    error,
    programRoles,
    getProgramRole,
    activeProgramRole,
    canEditActiveProgram,
    isActiveProgramAdmin,
  };
}
