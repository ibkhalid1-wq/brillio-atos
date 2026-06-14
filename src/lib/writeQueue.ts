import type { SupabaseClient } from "@supabase/supabase-js";

interface QueuedWrite {
  id: string;
  table: string;
  programId: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
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

export function enqueueWrite(table: string, programId: string, payload: Record<string, unknown>): void {
  const queue = readQueue();
  queue.push({ id: genId(), table, programId, payload, enqueuedAt: Date.now(), attempts: 0 });
  saveQueue(queue);
}

export async function flushWriteQueue(supabase: SupabaseClient): Promise<{ flushed: number; failed: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };
  let flushed = 0;
  let failed = 0;
  const remaining: QueuedWrite[] = [];
  for (const entry of queue) {
    try {
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
  return { flushed, failed };
}

export function getQueuedWriteCount(): number {
  return readQueue().length;
}
