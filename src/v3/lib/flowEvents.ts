/**
 * Event journal client (design rec 2). Every programme mutation ALSO lands as
 * an append-only, server-timestamped event row — the history the blob cannot
 * rewrite. Best-effort by design: the journal table ships as a delivered-not-
 * applied migration (20260714_event_journal.sql), so until it exists inserts
 * fail quietly and the app behaves exactly as before. Once applied, the
 * journal fills in from that moment on — no code change needed.
 */
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

export interface FlowEventInput {
  programId: string;
  /** Dot-namespaced event kind — 'inputs.saved', 'gate.approved', 'decision.resolved'… */
  kind: string;
  actor?: string;
  detail?: Record<string, unknown>;
}

/** Fire-and-forget append. Never throws, never blocks the mutation it shadows. */
export function logFlowEvent({ programId, kind, actor = "", detail = {} }: FlowEventInput): void {
  if (!isSupabaseConfigured || !supabase || !programId || !kind) return;
  // The journal table ships as a delivered-not-applied migration, so it is not
  // in the generated Database types yet — call through a structural view.
  const client = supabase as unknown as {
    from(table: string): { insert(value: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }> };
  };
  void client
    .from("adam_program_events")
    .insert({ program_id: programId, kind, actor, detail })
    .then(({ error }) => {
      // Table absent until the migration is applied — stay silent, stay fast.
      if (error && !/does not exist|relation|schema cache/i.test(error.message ?? "")) {
        console.debug("[flowEvents] append skipped:", error.message);
      }
    });
}
