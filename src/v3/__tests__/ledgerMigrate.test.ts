/**
 * Migration on Laila's real committed snapshot — measured counts (replace the
 * ~450 estimate) and the removed-entity world split the deviation register needs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, migrationStats, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";

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
    console.log("MIGRATION STATS", JSON.stringify(stats, null, 2));
    expect(stats.elements).toBeGreaterThan(100);
    expect(stats.claims).toBeGreaterThan(300);
    expect(stats.openUnknowns).toBeGreaterThan(50);
    expect(stats.byWorld["to-be"]).toBeGreaterThan(stats.byWorld["as-is"] ?? 0); // as-is is sparse (C5)
  });

  it("splits a removed entity across worlds (User existed as-is, removed in to-be)", () => {
    const asIs = store.liveClaimsAbout("el:removed:user#exists").filter((c) => c.world === "as-is");
    const toBe = store.liveClaimsAbout("el:removed:user#exists").filter((c) => c.world === "to-be");
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

/**
 * AMBIGUITIES ARE LOCI. The ontology's `ambiguities[]` used to live only in the blob,
 * where the only thing that could ever mark one resolved was the model rewriting the
 * document on a regeneration. Each collision is a `#semantics` unknown on the element
 * its term names, so it routes, renders and closes like every other question.
 *
 * The conservation halves are pinned against a migration of the SAME snapshot with the
 * collisions removed, so the deltas are arithmetic rather than copied constants.
 */
describe("ambiguities migrate to real #semantics loci", () => {
  const store = migrate(snapshot);
  const stats = migrationStats(store);
  const ontologyWith = (ambiguities: unknown[]): Snapshot =>
    ({ ...snapshot, ontology: { ...snapshot.ontology, ambiguities } });
  const without = migrationStats(migrate(ontologyWith([])));

  it("each recorded collision lands on the ENTITY its term names, readings beside it", () => {
    // Laila records two: "Account" and "Engagement", both ontology entities.
    for (const id of ["el:entity:account", "el:entity:engagement"]) {
      expect(store.liveClaimsAbout(`${id}#semantics`)).toHaveLength(1);
      const readings = store.claims().filter((c) => c.about.startsWith(`${id}#semantics.reading.`));
      expect(readings).toHaveLength(2);
      for (const r of readings) { expect(r.status).toBe("weak"); expect(r.value.kind).toBe("scalar"); }
    }
  });

  it("a PROPOSED resolution settles the locus WEAKLY — never a closure, never an open unknown", () => {
    const live = store.liveClaimsAbout("el:entity:account#semantics");
    expect(live[0].status).toBe("weak");
    expect(live[0].closedBy).toBeUndefined();       // the generator proposed it; nobody confirmed it
    // the born-unknown is kept as HISTORY, superseded by precedence — not omitted
    const unknowns = store.claimsAbout("el:entity:account#semantics").filter((c) => c.value.kind === "unknown");
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0].supersededBy).toBe(live[0].id);
  });

  it("CONSERVATION: Laila's two collisions both carry a proposed resolution, so the OPEN population is unmoved", () => {
    expect(stats.openUnknowns).toBe(without.openUnknowns);   // +0 open — the same rows the old gate skipped
    expect(stats.weak).toBe(without.weak + 6);               // 2 settled meanings + 4 rival readings
    expect(stats.live).toBe(without.live + 6);
    expect(stats.claims).toBe(without.claims + 8);           // + the 2 superseded born-unknowns kept as history
    expect(buildUnknownQueue(migrate(snapshot)).counts).toEqual(buildUnknownQueue(migrate(ontologyWith([]))).counts);
  });

  it("an UNRESOLVED collision moves the burn-down denominator by exactly ONE open question per term", () => {
    const asked = migrate(ontologyWith([
      { term: "Account", conflictingMeanings: ["the client", "the partner"], resolution: "unresolved" },
    ]));
    expect(migrationStats(asked).openUnknowns).toBe(without.openUnknowns + 1);
    const q = buildUnknownQueue(asked);
    expect(q.counts.total).toBe(buildUnknownQueue(migrate(ontologyWith([]))).counts.total + 1);
    const item = q.items.find((i) => i.about === "el:entity:account#semantics")!;
    expect(item.status).toBe("open");
    // owned by the entity's OWN area, like every other claim on it — not a constant
    expect(item.ownerLabel).toBe("Sales Leaders");
  });
});
