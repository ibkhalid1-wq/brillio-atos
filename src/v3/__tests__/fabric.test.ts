/**
 * Fabric derivation — idempotency, non-positional identity, and the derived-vs-
 * heuristic role split measured on Laila's real committed ontology snapshot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveFabric } from "@shared/fabric.ts";
import { deriveRoles, roleDerivationSplit } from "@shared/semanticRoles.ts";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

describe("fabric derivation", () => {
  it("is idempotent — same ontology in, byte-identical fabric out", () => {
    const a = deriveFabric(ontology, atlas);
    const b = deriveFabric(ontology, atlas);
    expect(a.version).toBe(b.version);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.nodes.length).toBeGreaterThan(30);
  });

  it("uses name-based, non-positional identity (no bare index ids)", () => {
    const { nodes } = deriveFabric(ontology, atlas);
    for (const n of nodes) {
      expect(n.id).toMatch(/^(screen|region|field|nav|flow):[a-z0-9-]/);
      // an id segment that is a pure integer would signal a positional key
      const segs = n.id.split(":").slice(1);
      expect(segs.some((s) => /^\d+$/.test(s)), `positional id: ${n.id}`).toBe(false);
      // every node carries its ontology source reference
      expect(Object.keys(n.source).length).toBeGreaterThan(0);
    }
  });

  it("carries the role METHOD so a guessed role is distinguishable from a known one", () => {
    const { nodes } = deriveFabric(ontology, atlas);
    const fields = nodes.filter((n) => n.kind === "field" && n.role);
    expect(fields.length).toBeGreaterThan(0);
    // on Laila (untyped attributes) every value role is heuristic; relationship
    // roles on region/nav nodes are derived
    expect(fields.every((f) => f.roleMethod === "heuristic")).toBe(true);
    const rel = nodes.filter((n) => (n.kind === "region" || n.kind === "nav") && n.role);
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.every((r) => r.roleMethod === "derived")).toBe(true);
  });

  it("Laila split: relationship roles 100% derived, value roles 0% derived (untyped)", () => {
    const split = roleDerivationSplit(deriveRoles(ontology));
    expect(split.relations.derived).toBe(split.relations.total); // 100%
    expect(split.attributes.derivedPct).toBe(0); // untyped everywhere → all heuristic
    expect(split.attributes.total).toBeGreaterThan(100);
  });

  it("uses a real attribute type when the ontology has one (derived, not heuristic)", () => {
    const typed = { entities: [{ name: "Invoice", attributes: [{ name: "amount", type: "monetary" }, "notes"] }], relations: [] };
    const roles = deriveRoles(typed as never);
    const amount = roles.attributeRoles.find((r) => r.attribute === "amount")!;
    expect(amount.role).toBe("monetary");
    expect(amount.method).toBe("derived");
    expect(amount.confidence).toBe(1);
    const notes = roles.attributeRoles.find((r) => r.attribute === "notes")!;
    expect(notes.method).toBe("heuristic"); // untyped → heuristic
  });
});
