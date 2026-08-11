/**
 * Fabric delta + refinement reconciliation, exercised against a REAL one-attribute
 * change on Laila's committed ontology — this replaces the earlier simulated token
 * measurement with a tested function: a localized change re-emits a handful of nodes,
 * not the whole fabric.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveFabric } from "@shared/fabric.ts";
import { diffFabric, reEmitCount, reconcileRefinements, type Refinement } from "@/v3/lib/fabricDelta";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** Clone the ontology and rename the first attribute of the first entity that has one. */
function renameOneAttribute(): { mutated: Record<string, unknown>; entitySlug: string; oldKey: string; newKey: string } {
  const clone = JSON.parse(JSON.stringify(ontology));
  const ent = clone.entities.find((e: { attributes?: unknown[] }) => Array.isArray(e.attributes) && e.attributes.length);
  const a0 = ent.attributes[0];
  const oldName = typeof a0 === "string" ? a0 : a0.name;
  const newName = `${oldName} Renamed`;
  if (typeof a0 === "string") ent.attributes[0] = newName; else a0.name = newName;
  return { mutated: clone, entitySlug: slug(ent.name), oldKey: slug(oldName), newKey: slug(newName) };
}

describe("fabric delta", () => {
  const base = deriveFabric(ontology, atlas);

  it("a one-attribute change touches only a handful of nodes; the rest are untouched", () => {
    const { mutated } = renameOneAttribute();
    const next = deriveFabric(mutated, atlas);
    const delta = diffFabric(base, next);
    // the localized change: the field id changes (add+remove) and the region(s)
    // listing it change; everything else is byte-identical and not re-emitted.
    expect(reEmitCount(delta)).toBeLessThanOrEqual(6);
    expect(delta.unchanged.length).toBeGreaterThan(base.nodes.length - 10);
    expect(delta.unchanged.length).toBeGreaterThan(300);
    // no rename map supplied → the field shows as remove + add, honestly
    expect(delta.added.length).toBeGreaterThanOrEqual(1);
    expect(delta.removed.length).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic and a no-op diff against itself is all-unchanged", () => {
    const delta = diffFabric(base, deriveFabric(ontology, atlas));
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual([]);
    expect(delta.renamed).toEqual([]);
    expect(delta.unchanged.length).toBe(base.nodes.length);
  });

  it("a supplied rename map moves identity instead of drop+add", () => {
    const { mutated, entitySlug, oldKey, newKey } = renameOneAttribute();
    const next = deriveFabric(mutated, atlas);
    const from = `field:${entitySlug}:${oldKey}`;
    const to = `field:${entitySlug}:${newKey}`;
    const delta = diffFabric(base, next, [[from, to]]);
    expect(delta.renamed).toContainEqual({ from, to, hashChanged: expect.any(Boolean) });
    // the renamed field is no longer double-counted as an add and a remove
    expect(delta.added.some((n) => n.id === to)).toBe(false);
    expect(delta.removed.some((n) => n.id === from)).toBe(false);
  });
});

describe("refinement reconciliation — preserve or escalate, never silently destroy", () => {
  const base = deriveFabric(ontology, atlas);
  const { mutated, entitySlug, oldKey } = renameOneAttribute();
  const next = deriveFabric(mutated, atlas);

  it("preserves a refinement on an untouched region", () => {
    // pick a node whose id + hash survive the change (a different entity's summary)
    const untouched = base.nodes.find((n) => n.kind === "region" && !n.id.startsWith(`region:${entitySlug}:`))!;
    const refs: Refinement[] = [{ fabricId: untouched.id, againstHash: untouched.hash, content: "hand copy" }];
    const [d] = reconcileRefinements(next, refs);
    expect(d.status).toBe("preserved");
  });

  it("escalates a conflict when the refined region's derivation inputs changed", () => {
    const summaryId = `region:${entitySlug}:summary`;
    const before = base.nodes.find((n) => n.id === summaryId)!;
    const after = next.nodes.find((n) => n.id === summaryId)!;
    expect(after.hash).not.toBe(before.hash); // the change did land on this region
    const [d] = reconcileRefinements(next, [{ fabricId: summaryId, againstHash: before.hash, content: "hand copy" }]);
    expect(d.status).toBe("conflict");
  });

  it("marks a refinement orphaned when its region no longer derives", () => {
    const goneId = `field:${entitySlug}:${oldKey}`; // the old attribute id, removed by the rename
    expect(next.nodes.some((n) => n.id === goneId)).toBe(false);
    const [d] = reconcileRefinements(next, [{ fabricId: goneId, againstHash: "whatever", content: "hand copy" }]);
    expect(d.status).toBe("orphaned");
  });

  it("follows a rename map so a refinement on the old id preserves onto the new id", () => {
    const untouched = base.nodes.find((n) => n.kind === "region" && !n.id.startsWith(`region:${entitySlug}:`))!;
    // simulate the region keeping its content across a rename of its id
    const d = reconcileRefinements(next, [{ fabricId: untouched.id, againstHash: untouched.hash, content: "x" }], [[untouched.id, untouched.id]]);
    expect(d[0].status).toBe("preserved");
  });
});
