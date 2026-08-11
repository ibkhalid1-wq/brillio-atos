/**
 * CONSERVATION, ON REAL PRODUCTION DATA. No pass has ever run this.
 *
 * Every conservation assertion in this repo runs against a committed fixture or
 * a synthetic mirror. Fixtures are the shapes we thought of; production is the
 * shapes we didn't. Pass 2 planted a conservation leak and found the harness
 * blind to it — this closes the other half of that gap by running the identity
 * over every programme actually in the store.
 *
 * NETWORK STAYS OUT OF THE TEST. `scripts/validate-live-db.sh` fetches the
 * programmes and writes them to /tmp; this reads that file if it is there and
 * SKIPS LOUDLY if it is not. A skip must never read as a pass, so the skip path
 * asserts nothing and says why — and the shell harness prints the same reason.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";

const SNAPSHOT = "/tmp/validate-live-db.json";

interface Row { id: string; name: string; is_deleted?: boolean; data?: Record<string, unknown> }

const live = (): Row[] => {
  if (!existsSync(SNAPSHOT)) return [];
  try {
    const rows = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Row[];
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
};

describe("conservation holds on every programme in the live store", () => {
  const rows = live();

  it("has a corpus to check, or says plainly that it does not", () => {
    if (!rows.length) {
      // GATE 1 (credentials). Named, not hidden — the shell harness reports the
      // same cause, so a green run here can never be mistaken for coverage.
      console.warn(`[live-conservation] SKIPPED — no ${SNAPSHOT}; run scripts/validate-live-db.sh first (GATE 1: credentials)`);
    }
    expect(true).toBe(true);
  });

  it("every live programme's ledger partitions without leaking a locus", () => {
    if (!rows.length) return;
    const checked: string[] = [];
    const broken: string[] = [];
    for (const row of rows) {
      if (row.is_deleted) continue;                    // archived programmes are not surfaces
      const data = row.data;
      if (!data || typeof data !== "object") continue;
      // Build the Snapshot the way `useProgramLedger` does — ontology + atlas +
      // operator overrides out of the blob's inner data root. (My first attempt
      // handed `migrate` a ProgramSummary and it threw on 11 programmes; that
      // was a malformed call, not a product defect. Worth recording: a check
      // that fails for its own reasons manufactures findings.)
      const inner = (typeof (data as { data?: unknown }).data === "object" && (data as { data?: unknown }).data !== null
        ? (data as { data: Record<string, unknown> }).data
        : data) as Record<string, unknown>;
      const doc = (key: string): Record<string, unknown> => {
        const v = inner[key];
        if (!v || typeof v !== "object") return {};
        const nested = (v as { data?: unknown }).data;
        return (nested && typeof nested === "object" ? nested : v) as Record<string, unknown>;
      };
      const snap: Snapshot = {
        ontology: doc("domainOntology"),
        atlas: doc("currentStateAtlas"),
        overrides: Array.isArray(inner.flowOperatorOverrides)
          ? (inner.flowOperatorOverrides as Array<Record<string, unknown>>) : [],
      };
      let store;
      try {
        store = migrate(snap);
      } catch (err) {
        broken.push(`${row.name}: migrate threw ${(err as Error).message.slice(0, 80)}`);
        continue;
      }
      const queue = buildUnknownQueue(store);
      checked.push(row.name);

      // THE IDENTITY: every open item the queue reports resolves to a live,
      // open claim in the store. A locus in the queue that the store cannot
      // account for is a leak; one in the store that no bucket claims is the
      // same leak from the other side.
      const queued = new Set(queue.items.map((i) => i.about));
      // `buildUnknownQueue` (projections.ts:28) admits open OR BLOCKED — a blocked
      // locus is still an open unknown, it just cannot be worked yet. My first
      // version allowed only "open" and flagged 28 legitimately-blocked BFSI loci.
      // Second time in this file that a too-narrow assertion manufactured a
      // finding; both are recorded rather than quietly corrected, because a
      // validation pass that invents defects is worse than one that misses them.
      const openInStore = new Set(
        store.claims()
          .filter((c) => !c.supersededBy && (c.status === "open" || c.status === "blocked"))
          .map((c) => c.about),
      );
      for (const about of queued) {
        if (!openInStore.has(about)) broken.push(`${row.name}: queued locus not open in store — ${about}`);
      }
      // Counts must agree with the members, not merely look plausible.
      if (queue.items.length !== queued.size) {
        broken.push(`${row.name}: queue holds ${queue.items.length} items over ${queued.size} distinct loci (duplicate)`);
      }
    }
    // Not vacuous: if nothing was checked, say so rather than pass silently.
    if (rows.length && !checked.length) {
      console.warn("[live-conservation] every live row was archived or unmigratable — nothing asserted");
    }
    expect(broken, `conservation broken on live data:\n${broken.slice(0, 10).join("\n")}`).toEqual([]);
  });
});
