/**
 * The read-only in-memory ledger view — pg-free, client-safe.
 *
 * Extracted from pgStore.ts so the CLIENT (useProgramLedger → the surfaces) can build a
 * read model from raw element/claim arrays WITHOUT importing the Postgres persistence
 * layer (`PgLedger`, which writes the server-side audit intent). Keeping `buildReadModel`
 * here means no client-reachable module pulls the audit-write code into the browser
 * bundle. `PgLedger.loadReadModel` imports this too.
 */
import { type LedgerStore } from "./store";
import { type Claim, isLive, type LedgerElement } from "./types";

/** A read-only, in-memory view over pre-loaded rows, satisfying the subset of
 *  LedgerStore the projections call. Mutators throw — this is a read model. */
export function buildReadModel(elements: LedgerElement[], claims: Claim[]): LedgerStore {
  const claimsAbout = (about: string) => claims.filter((c) => c.about === about);
  const liveClaimsAbout = (about: string) => claimsAbout(about).filter(isLive);
  const conflictsFor = (about: string) => {
    const live = liveClaimsAbout(about); const seen = new Set<string>(); const out: Array<{ about: string; world: Claim["world"]; claims: string[]; kind: "coexist" | "escalate"; escalateTo?: "slot-owner" | "legal-compliance" }> = [];
    for (const c of live) for (const otherId of c.contradicts ?? []) {
      const other = claims.find((x) => x.id === otherId);
      if (!other || !isLive(other)) continue;
      const key = [c.id, otherId].sort().join("|"); if (seen.has(key)) continue; seen.add(key);
      const escalateTo = c.escalateTo ?? other.escalateTo;
      out.push({ about, world: c.world, claims: [c.id, otherId], kind: escalateTo ? "escalate" : "coexist", escalateTo });
    }
    return out;
  };
  const throwRO = () => { throw new Error("read model is read-only"); };
  return {
    elements: () => elements, claims: () => claims, shapes: () => [],
    addElement: throwRO, addShape: throwRO, assert: throwRO as never, close: throwRO as never,
    disposition: throwRO as never, contradict: throwRO,
    claimsAbout, liveClaimsAbout,
    resolve: (about) => ({ live: liveClaimsAbout(about), conflicts: conflictsFor(about) }),
    allConflicts: () => [...new Set(claims.map((c) => c.about))].flatMap(conflictsFor),
  };
}
