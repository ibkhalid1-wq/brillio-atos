/**
 * Snapshot ring — reversibility for the programme blob.
 *
 * Every server write captures the blob's PRIOR state into IndexedDB (local,
 * zero-infra, survives reloads), keeping the last 10 per programme. The
 * attestation trail says who did what; this says what the record looked like
 * just before — so gate recordings, decision confirms and regenerations stop
 * being one-way doors. Restore is an ordinary write through the same
 * chokepoint, so it snapshots itself too.
 *
 * All capture paths are fire-and-forget and swallow errors: a browser
 * without IndexedDB (or a full quota) must never block a save.
 */

export interface BlobSnapshot {
  id: number;
  programId: string;
  ts: string;
  /** Approximate serialized size, for the picker. */
  bytes: number;
  data: Record<string, unknown>;
}

const DB_NAME = "atos-flow-snapshots";
const STORE = "snapshots";
const KEEP_PER_PROGRAM = 10;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("programId", "programId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Capture the blob's current state before a write replaces it. */
export async function captureSnapshot(programId: string, data: Record<string, unknown> | null | undefined): Promise<void> {
  try {
    if (!programId || !data || Object.keys(data).length === 0) return;
    const db = await openDb();
    if (!db) return;
    let bytes = 0;
    try { bytes = JSON.stringify(data).length; } catch { return; }
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.add({ programId, ts: new Date().toISOString(), bytes, data });
    // Prune beyond the ring size — oldest first.
    const index = store.index("programId");
    const keys = index.getAllKeys(programId);
    keys.onsuccess = () => {
      const all = keys.result as number[];
      if (all.length > KEEP_PER_PROGRAM) {
        for (const key of all.slice(0, all.length - KEEP_PER_PROGRAM)) store.delete(key);
      }
    };
    await done(tx);
    db.close();
  } catch {
    // Never let history-keeping break the write itself.
  }
}

/** Snapshots for one programme, newest first. */
export async function listSnapshots(programId: string): Promise<BlobSnapshot[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).index("programId").getAll(programId);
    const rows = await new Promise<BlobSnapshot[]>((resolve) => {
      request.onsuccess = () => resolve((request.result as BlobSnapshot[]) ?? []);
      request.onerror = () => resolve([]);
    });
    db.close();
    return rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  } catch {
    return [];
  }
}
