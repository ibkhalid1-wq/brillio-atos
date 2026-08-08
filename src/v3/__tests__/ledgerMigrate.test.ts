/**
 * Migration on Laila's real committed snapshot — measured counts (replace the
 * ~450 estimate) and the removed-entity world split the deviation register needs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, migrationStats, type Snapshot } from "@/v3/lib/ledger/migrate";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const snapshot: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };

describe("ledger migration on Laila", () => {
  const store = migrate(snapshot);
  const stats = migrationStats(store);

  it("is deterministic — same snapshot in, same ledger out", () => {
    const a = migrationStats(migrate(snapshot));
    expect(a).toEqual(stats);
  });

  it("produces measured counts (printed for the report)", () => {
    // eslint-disable-next-line no-console
    console.log("MIGRATION STATS", JSON.stringify(stats, null, 2));
    expect(stats.elements).toBeGreaterThan(100);
    expect(stats.claims).toBeGreaterThan(300);
    expect(stats.openUnknowns).toBeGreaterThan(50);
    expect(stats.byWorld["to-be"]).toBeGreaterThan(stats.byWorld["as-is"] ?? 0); // as-is is sparse (C5)
  });

  it("splits a removed entity across worlds (User existed as-is, removed in to-be)", () => {
    const asIs = store.liveClaimsAbout("el:removed:user.exists").filter((c) => c.world === "as-is");
    const toBe = store.liveClaimsAbout("el:removed:user.exists").filter((c) => c.world === "to-be");
    expect(asIs.length).toBe(1); expect(asIs[0].value).toEqual({ kind: "scalar", value: true });
    expect(toBe.length).toBe(1); expect(toBe[0].value).toEqual({ kind: "scalar", value: false });
  });

  it("carries operator corrections as weak, closed-without-verbatim closures", () => {
    expect(stats.closedWithoutVerbatim).toBeGreaterThan(10); // the touched-not-confirmed elements
  });

  it("surfaces unresolved references (steps naming entities the ontology lacks)", () => {
    expect(stats.unresolvedRefs).toBeGreaterThan(0);
  });
});
