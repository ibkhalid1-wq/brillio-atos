import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getProgramState, wrapProgramState, asRecord } from "@/new/lib/programState";

export interface ProgramSetupPatch {
  name: string;
  client: string;
  /** Selected programme archetype, persisted to projectMeta when chosen. */
  archetype?: string;
  /** Methodology variant derived from the archetype, persisted to program data. */
  methodology?: "atos-standard" | "atos-lite" | "atos-regulated" | "atos-flow";
  /** Baseline mandate facts written into Frame's inputs at setup. */
  frameBaseline?: { industry?: string; sponsor?: string; targetFirstDemoDate?: string };
  phases: Array<{ id: string; pct: number; targetDate: string }>;
}

// ─── Local-storage fallback ───────────────────────────────────────────────────
const LEGACY_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"] as const;

function persistSetupLocally(programId: string, patch: ProgramSetupPatch, nextData: Record<string, unknown>) {
  if (typeof localStorage === "undefined") return;
  const now = new Date().toISOString();
  LEGACY_KEYS.forEach((storageKey) => {
    try {
      const entries: unknown[] = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      const nextEntries = entries.map((entry) => {
        if (typeof entry !== "object" || entry === null) return entry;
        const e = entry as Record<string, unknown>;
        if (e.id !== programId) return entry;
        return { ...e, name: patch.name, client: patch.client, updatedAt: now, lastActiveAt: now, data: { ...nextData, _syncedAt: now } };
      });
      localStorage.setItem(storageKey, JSON.stringify(nextEntries));
    } catch { /* ignore */ }
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProgramSetup(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async (patch: ProgramSetupPatch) => {
    if (!programId) throw new Error("No programme selected.");
    setIsSaving(true);
    try {
      const { wrapper, inner, usesNestedData } = getProgramState(rawData);
      const existingMeta = asRecord(inner.projectMeta);
      const existingPhases = Array.isArray(inner.phases)
        ? (inner.phases as unknown[]).map((value) => asRecord(value))
        : [];
      const existingById = new Map(existingPhases.map((phase) => [String(phase.id ?? ""), phase]));
      // When every patched phase already exists we're editing details — merge the
      // overrides onto the stored entries (previous behaviour, preserves whatever
      // else the entries carry). When the patch carries a DIFFERENT spine — an
      // archetype pick that changes methodology, e.g. ATOS Flow's movements —
      // rebuild from the patch: same-id entries keep their stored extras, removed
      // phases drop, new ones seed at their patched values. Without this, movement
      // ids matched nothing and were silently discarded.
      const spineUnchanged = existingPhases.length > 0
        && patch.phases.every((item) => existingById.has(item.id));
      const updatedPhases = spineUnchanged
        ? existingPhases.map((phase) => {
            const override = patch.phases.find((item) => item.id === phase.id);
            return override ? { ...phase, pct: override.pct, targetDate: override.targetDate } : phase;
          })
        : patch.phases.map((item) => ({ ...(existingById.get(item.id) ?? {}), id: item.id, pct: item.pct, targetDate: item.targetDate }));
      const nextInner = {
        ...inner,
        phases: updatedPhases,
        // A re-seeded spine also re-keys the phasePct map — stale keys from the
        // previous spine would otherwise linger beside ids that no longer render.
        ...(spineUnchanged ? {} : { phasePct: Object.fromEntries(patch.phases.map((item) => [item.id, item.pct])) }),
        // Only override methodology when the user explicitly selected an archetype,
        // so editing details without re-picking a type never clobbers the variant.
        ...(patch.methodology ? { methodology: patch.methodology } : {}),
        // Baseline facts land in Frame's input bucket — early evidence with a
        // setup provenance, so gate criteria tick and generator grounding is
        // in place before the first conversation is even booked.
        ...(patch.frameBaseline && Object.keys(patch.frameBaseline).length
          ? (() => {
              const buckets = asRecord(inner.phaseInputs);
              const frame = asRecord(buckets.frame);
              const cleaned = Object.fromEntries(
                Object.entries(patch.frameBaseline).filter(([, value]) => typeof value === "string" && value.trim()),
              );
              return { phaseInputs: { ...buckets, frame: { ...frame, ...cleaned, savedAt: new Date().toISOString() } } };
            })()
          : {}),
        projectMeta: {
          ...existingMeta,
          name: patch.name,
          client: patch.client,
          ...(patch.archetype ? { archetype: patch.archetype } : {}),
        },
      };
      const payload = wrapProgramState(wrapper, nextInner, usesNestedData);

      // ── Supabase path ──────────────────────────────────────────────────────
      if (isSupabaseConfigured && supabase) {
        const now = new Date().toISOString();
        const { data: updatedRows, error } = await supabase
          .from("adam_programs")
          .update({ data: payload as Json, name: patch.name, updated_at: now })
          .eq("id", programId)
          .select("id");

        if (error) throw new Error(error.message);

        // Fallback: if RLS blocked the UPDATE (0 rows affected), try UPSERT
        if (!updatedRows || updatedRows.length === 0) {
          console.warn("[useProgramSetup] UPDATE affected 0 rows — attempting upsert for programId:", programId);
          const { error: upsertError } = await supabase
            .from("adam_programs")
            .upsert({
              id: programId,
              name: patch.name,
              client: patch.client || null,
              data: payload as Json,
              updated_at: now,
              is_deleted: false,
              owner_id: null,
            }, { onConflict: "id" });
          if (upsertError) {
            // UPSERT also failed — persist locally so data isn't lost
            console.error("[useProgramSetup] Upsert failed, persisting locally:", upsertError.message);
            persistSetupLocally(programId, patch, payload);
          }
        }
      } else {
        // ── localStorage-only path ─────────────────────────────────────────
        persistSetupLocally(programId, patch, payload);
      }

      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [onRefresh, programId, rawData]);

  return { save, isSaving };
}
