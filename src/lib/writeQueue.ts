import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSubstantiveProgramData } from "@/v3/lib/programDataGuard";

interface QueuedWrite {
  id: string;
  table: string;
  programId: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
  /** The row's `updated_at` this write was based on. Lets the flush drop a
   * write whose row has since moved on, rather than blindly clobbering it. */
  baseUpdatedAt?: string;
}

const QUEUE_KEY = "adam_write_queue";

function readQueue(): QueuedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as QueuedWrite[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedWrite[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueWrite(
  table: string,
  programId: string,
  payload: Record<string, unknown>,
  baseUpdatedAt?: string,
): void {
  const queue = readQueue();
  queue.push({ id: genId(), table, programId, payload, enqueuedAt: Date.now(), attempts: 0, baseUpdatedAt });
  saveQueue(queue);
}

export async function flushWriteQueue(supabase: SupabaseClient): Promise<{ flushed: number; failed: number; dropped: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0, dropped: 0 };
  let flushed = 0;
  let failed = 0;
  let dropped = 0;
  const remaining: QueuedWrite[] = [];
  for (const entry of queue) {
    try {
      // DATA-LOSS GUARD. A queued programme write carries the in-memory `data`
      // blob captured when the original write failed (offline / statement
      // timeout / CAS conflict during a regeneration race). That snapshot can
      // be a skeleton or stale copy, and this replay is a BLIND update — so
      // without a guard it silently overwrites the live, populated record.
      // Before applying, read the live row and refuse to clobber it.
      if (entry.table === "adam_programs") {
        const queuedData = (entry.payload as { data?: unknown }).data;
        const { data: current } = await supabase
          .from("adam_programs")
          .select("data, updated_at")
          .eq("id", entry.programId)
          .maybeSingle();
        if (current) {
          // Never let an empty/skeleton queued blob overwrite real content.
          if (!hasSubstantiveProgramData(queuedData) && hasSubstantiveProgramData((current as { data?: unknown }).data)) {
            dropped++;
            continue;
          }
          // The row has moved since this write was based → the queued write is
          // stale; dropping it avoids clobbering the newer server state.
          const liveUpdatedAt = (current as { updated_at?: string }).updated_at;
          if (entry.baseUpdatedAt && liveUpdatedAt && liveUpdatedAt !== entry.baseUpdatedAt) {
            dropped++;
            continue;
          }
        }
      }
      const { error } = await supabase.from(entry.table).update(entry.payload).eq("id", entry.programId);
      if (error) throw new Error(error.message);
      flushed++;
    } catch {
      entry.attempts++;
      if (entry.attempts <= 3) remaining.push(entry);
      else failed++;
    }
  }
  saveQueue(remaining);
  return { flushed, failed, dropped };
}

export function getQueuedWriteCount(): number {
  return readQueue().length;
}
