/**
 * Write-model merge (docs/aura/ledger-write-model.md) — the decision table and the
 * regeneration case, run against the real store/migrate and the committed Laila snapshot.
 * Proves both options preserve attributed closures where the current migrate() loses them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AssertInput } from "@/v3/lib/ledger/store";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { reconcile, mergeDecision } from "@/v3/lib/ledger/merge";
import type { Claim, ClaimValue } from "@/v3/lib/ledger/types";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const claim = (over: Partial<Claim>): Claim => ({ id: "x", about: "el:e#s", value: { kind: "scalar", value: "v" }, world: "to-be", layer: "domain", source: "generated", status: "weak", ownerWhileOpen: { kind: "role", role: "R" }, ...over });
const sc = (v: string): ClaimValue => ({ kind: "scalar", value: v });
/** the to-be claims of a store, as regeneration-style inputs. */
const toBeInputs = (store: ReturnType<typeof migrate>): AssertInput[] => store.claims().filter((c) => c.world === "to-be" && !c.supersededBy)
  .map((c) => ({ about: c.about, value: c.value, world: c.world, layer: c.layer, source: c.source, ownerWhileOpen: c.ownerWhileOpen, status: c.status, closedBy: c.closedBy }));
const elementIds = (store: ReturnType<typeof migrate>): Set<string> => new Set(store.elements().map((e) => e.id));

describe("merge decision table (incoming = generated)", () => {
  it("every non-generated existing source is preserved (no overwrite)", () => {
    for (const src of ["asserted", "dispositioned", "document", "regulation", "precedent", "external-standard", "code-derived"] as const) {
      expect(mergeDecision(claim({ source: src, status: "closed", value: sc("KEEP") }), { world: "to-be", value: sc("NEW") })).toBe("preserve-existing");
    }
  });
  it("generated-vs-generated: same value corroborates, different value → newer supersedes (recency)", () => {
    expect(mergeDecision(claim({ source: "generated", value: sc("X") }), { world: "to-be", value: sc("X") })).toBe("corroborate");
    expect(mergeDecision(claim({ source: "generated", value: sc("OLD") }), { world: "to-be", value: sc("NEW") })).toBe("supersede-existing");
  });
  it("an open unknown is filled; a cross-world existing is a deviation, never overwritten", () => {
    expect(mergeDecision(claim({ value: { kind: "unknown" }, status: "open" }), { world: "to-be", value: sc("NEW") })).toBe("fill-unknown");
    expect(mergeDecision(claim({ world: "as-is", source: "code-derived", value: sc("AS-IS") }), { world: "to-be", value: sc("NEW") })).toBe("coexist-deviation");
  });
});

describe("the regeneration case, on real Laila", () => {
  const about = "el:attr:opportunity.stage#valueSet";
  it("current migrate() LOSES a store-side asserted closure across regeneration; reconcile PRESERVES it", () => {
    // 1. migrate + a stakeholder closes the stage set through the store
    const store = migrate(S);
    store.assert({ about, value: { kind: "ref-list", to: ["Prospecting", "Qualification", "Proposal", "Closed Won", "Closed Lost"] },
      world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "vp-sales", verbatim: "our five stages" } });
    const closedNow = store.liveClaimsAbout(about).some((c) => c.source === "asserted" && c.status === "closed");
    expect(closedNow).toBe(true);

    // 2a. current behaviour: an artifact regenerates → migrate() re-runs fresh from the blob
    const naive = migrate(S);
    const survivesNaive = naive.liveClaimsAbout(about).some((c) => c.source === "asserted");
    expect(survivesNaive).toBe(false); // LOST — the exact overwrite the project exists to prevent

    // 2b. the merge: reconcile the regeneration's to-be claims INTO the existing ledger
    const incoming = toBeInputs(migrate(S)); // regeneration output (here, re-migrated blob)
    const report = reconcile(store, incoming, elementIds(migrate(S)));
    const survivesMerge = store.liveClaimsAbout(about).some((c) => c.source === "asserted" && c.status === "closed" && c.closedBy?.by === "vp-sales");
    expect(survivesMerge).toBe(true); // PRESERVED
    expect(report.preservedClosures).toBeGreaterThanOrEqual(1);
  });

  it("recency prevents stale-generation accumulation across repeated regenerations", () => {
    const store = migrate(S);
    const defAbout = "el:entity:opportunity#definition";
    const genBefore = store.liveClaimsAbout(defAbout).filter((c) => c.source === "generated").length;
    // regenerate twice with a changed definition each time
    for (const text of ["A new definition", "A different definition"]) {
      reconcile(store, [{ about: defAbout, value: sc(text), world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "weak" }], elementIds(store));
    }
    const genLive = store.liveClaimsAbout(defAbout).filter((c) => c.source === "generated").length;
    expect(genLive).toBe(1); // exactly one live generated definition — old ones superseded, not accumulated
    expect(genBefore).toBe(1);
  });

  it("a closure about an element the regeneration DROPPED is preserved AND flagged orphan (never silently deleted)", () => {
    const store = migrate(S);
    // stakeholder asserts something about Opportunity
    store.assert({ about: "el:entity:opportunity#definition", value: sc("A durable business definition"), world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "vp-sales", verbatim: "…" } });
    // regeneration output that NO LONGER contains Opportunity (element dropped upstream)
    const droppedBlob = { ...S, ontology: { ...S.ontology, entities: (S.ontology.entities as Array<{ name: string }>).filter((e) => e.name !== "Opportunity") } };
    const incoming = toBeInputs(migrate(droppedBlob));
    const report = reconcile(store, incoming, elementIds(migrate(droppedBlob)));
    const stillThere = store.liveClaimsAbout("el:entity:opportunity#definition").some((c) => c.source === "asserted");
    expect(stillThere).toBe(true); // preserved
    expect(report.orphanedClosures.some((o) => o.about === "el:entity:opportunity#definition")).toBe(true); // and flagged
  });
});
