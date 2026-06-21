import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

const LEGACY_PROGRAM_STORAGE_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeParseArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useLocalProgramMigration(userId: string | null) {
  const [migrated, setMigrated] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (migrated) return;

    if (!isSupabaseConfigured || !supabase || typeof localStorage === "undefined") {
      setMigrated(true);
      return;
    }

    // Do not block the shell forever if auth has not yielded a stable user id yet.
    if (!userId) {
      setMigrated(true);
      return;
    }

    const localPrograms = LEGACY_PROGRAM_STORAGE_KEYS.flatMap((key) => safeParseArray(localStorage.getItem(key)));
    if (!localPrograms.length) {
      setMigrated(true);
      return;
    }

    const rows = localPrograms
      .filter(isRecord)
      .map((entry) => {
        const wrapper = isRecord(entry.data) ? entry.data : entry;
        const meta = isRecord(wrapper.projectMeta) ? wrapper.projectMeta : {};
        const id = typeof entry.id === "string" ? entry.id : typeof wrapper.id === "string" ? wrapper.id : "";
        if (!id) return null;
        const createdAt = typeof entry.createdAt === "string"
          ? entry.createdAt
          : typeof entry.updatedAt === "string"
            ? entry.updatedAt
            : new Date().toISOString();
        return {
          id,
          owner_id: userId,
          name: typeof entry.name === "string"
            ? entry.name
            : typeof meta.name === "string"
              ? meta.name
              : "Migrated program",
          data: (isRecord(entry.data) ? entry.data : entry) as Record<string, unknown>,
          is_deleted: false,
          created_at: createdAt,
          updated_at: typeof entry.updatedAt === "string" ? entry.updatedAt : createdAt,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);

    if (!rows.length) {
      setMigrated(true);
      return;
    }

    void supabase
      .from("adam_programs")
      .select("id")
      .in("id", rows.map((row) => row.id))
      .then(({ data }: { data: Array<{ id: string }> | null }) => {
        const existingIds = new Set((data || []).map((row) => row.id));
        const toInsert = rows.filter((row) => !existingIds.has(row.id));
        if (!toInsert.length) {
          LEGACY_PROGRAM_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
          setMigrated(true);
          return;
        }

        void supabase
          .from("adam_programs")
          .insert(toInsert)
          .then(({ error }: { error: { message: string } | null }) => {
            if (!error) {
              LEGACY_PROGRAM_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
            }
            setMigrated(true);
          });
      });
  }, [migrated, userId]);

  return migrated;
}
