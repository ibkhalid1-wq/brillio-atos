/**
 * Transcript externalization — the DB sync layer (phases 2/4/5).
 *
 * Wraps the pure split/merge core (programTexts.ts) with the `adam_program_texts`
 * table I/O. Every entry point is gated by a flag that defaults OFF, so this is
 * completely inert — the app behaves exactly as before — until externalization
 * is deliberately enabled after the migration is applied and backfilled.
 * See docs/transcript-externalization.md.
 *
 * The three flags map to the phased rollout, and are independent:
 *  - DUAL_WRITE : on persist, also write the big fields to the texts table.
 *  - DUAL_READ  : on hydrate, merge the texts table back into the blob.
 *  - CUTOVER    : on persist, STOP keeping the big fields inline (blob shrinks).
 *
 * Rollout order: enable DUAL_WRITE → backfill → enable DUAL_READ → verify parity
 * → enable CUTOVER. Rollback at any point = turn the flags back off; the inline
 * copy is the source of truth until CUTOVER, so nothing is lost.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  splitExternalTexts,
  mergeExternalTexts,
  type ExternalText,
} from "@/v3/lib/programTexts";

const TEXTS_TABLE = "adam_program_texts";

/**
 * Externalization is now ON by default (the `adam_program_texts` table is
 * applied and the pipeline is verified). Each flag can still be forced OFF
 * per-browser for an instant rollback by setting its localStorage key to the
 * literal "off"; "on" forces it on; anything else uses the code default.
 * Rollback order if ever needed: cutover → dual-read (dual-write can stay on).
 */
function flag(name: string, defaultOn: boolean): boolean {
  if (typeof localStorage === "undefined") return defaultOn;
  try {
    const value = localStorage.getItem(`atos:externalize:${name}`);
    if (value === "on") return true;
    if (value === "off") return false;
    return defaultOn;
  } catch {
    return defaultOn;
  }
}

export const externalization = {
  get dualWrite(): boolean {
    return flag("dual-write", true);
  },
  get dualRead(): boolean {
    return flag("dual-read", true);
  },
  get cutover(): boolean {
    return flag("cutover", true);
  },
  /** True when any part of the pipeline is live — cheap early-out for callers. */
  get anyOn(): boolean {
    return this.dualWrite || this.dualRead || this.cutover;
  },
};

/**
 * On persist: if dual-write is on, extract the large text fields out of
 * `payload` and upsert them into the texts table, keeping the table in sync
 * (rows for fields no longer large are removed). Returns the blob that should
 * actually be written to `adam_programs.data` — the shrunk copy once CUTOVER is
 * on, otherwise the full `payload` (inline copy retained during the transition).
 *
 * Table writes never throw out to the caller: a texts-table failure must not
 * break the primary blob save. On any error we fall back to writing the full
 * inline blob, so the programme is never left without its transcripts.
 */
export async function persistExternalTexts(
  supabase: SupabaseClient,
  programId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!externalization.dualWrite) return payload;
  try {
    const { inner, texts } = splitExternalTexts(payload);
    const rows = texts.map((t) => ({
      program_id: programId,
      field_key: t.fieldKey,
      movement_id: t.movementId,
      content: t.content,
      chars: t.content.length,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await supabase.from(TEXTS_TABLE).upsert(rows, { onConflict: "program_id,field_key" });
      if (error) throw error;
    }
    // Keep the table in sync: drop rows for fields that are no longer
    // externalized (e.g. a transcript that shrank below the threshold), so a
    // stale row can't merge outdated content back on read. CRITICAL GUARD: only
    // reconcile when this payload actually CARRIES externalizable texts. A
    // payload with ZERO texts is more likely a failed hydrate (the transcripts
    // weren't merged into memory) than a genuine "all transcripts deleted" —
    // and blindly deleting would wipe the durable shadow copies. When there's
    // nothing to keep, leave the table untouched.
    if (texts.length) {
      const keptKeys = texts.map((t) => t.fieldKey);
      const { error: delError } = await supabase.from(TEXTS_TABLE)
        .delete().eq("program_id", programId)
        .not("field_key", "in", `(${keptKeys.join(",")})`);
      if (delError) throw delError;
    }
    // Only shrink the stored blob once cutover is on; until then keep the full
    // inline copy so dual-read parity can be verified and rollback stays trivial.
    return externalization.cutover ? inner : payload;
  } catch (err) {
    console.warn("[programTextsSync] persist failed — writing full inline blob", err);
    return payload;
  }
}

/**
 * On hydrate: if dual-read is on, fetch the programme's externalized texts and
 * merge them back into `data` so the synchronous readers see the full blob. An
 * inline value already present (and still large) wins over a table row, so a
 * stale row can never clobber a fresher inline edit during the transition.
 *
 * Never throws: a texts-table read failure degrades to the inline blob as-is.
 */
export async function hydrateExternalTexts(
  supabase: SupabaseClient,
  programId: string,
  data: unknown,
): Promise<unknown> {
  if (!externalization.dualRead) return data;
  if (typeof data !== "object" || data === null) return data;
  try {
    const { data: rows, error } = await supabase
      .from(TEXTS_TABLE)
      .select("field_key, movement_id, content")
      .eq("program_id", programId);
    if (error) throw error;
    if (!rows || !rows.length) return data;
    const texts: ExternalText[] = rows.map((r) => ({
      fieldKey: String(r.field_key),
      movementId: String(r.movement_id ?? ""),
      content: String(r.content ?? ""),
    }));
    return mergeExternalTexts(data as Record<string, unknown>, texts);
  } catch (err) {
    console.warn("[programTextsSync] hydrate failed — using inline blob", err);
    return data;
  }
}
