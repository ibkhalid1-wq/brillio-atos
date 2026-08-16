/**
 * Seed data — determinism, referential consistency, synthetic marking, and the
 * assumptions list, measured on Laila's real committed ontology snapshot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSeed } from "@shared/seedData.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { joinKeyFor } from "@shared/ontologyGraph.ts";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");
const version = deriveFabric(ontology, atlas).version;

describe("seed data generation", () => {
  it("is deterministic — same version yields byte-identical records", () => {
    const a = generateSeed(ontology, version);
    const b = generateSeed(ontology, version);
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
  });

  it("every record is synthetic and classified — the real-data tripwire", () => {
    const { records } = generateSeed(ontology, version);
    const all = Object.values(records).flat();
    expect(all.length).toBeGreaterThan(50);
    for (const r of all) {
      expect(r._synthetic).toBe(true);
      expect(r._classification).toBe("SYNTHETIC-SEED");
      expect(typeof r.id).toBe("string");
    }
  });

  it("is referentially consistent — every FK points at a real parent", () => {
    const { records } = generateSeed(ontology, version);
    // Keyed by the SHARED join-key definition, not by re-lowercasing the entity
    // name. Reconstructing the key here is the same defect the generator had:
    // this lookup used `k.slice(0,-2).toLowerCase()`, which stopped resolving
    // the moment a multi-word entity's key became a legal identifier — so every
    // multi-word FK fell through the `if (set)` and was checked by nothing,
    // and the guard would have reported green on a table of dangling ids.
    // (This snapshot has no multi-word PARENT, so the multi-word key itself is
    // exercised in prototypeJoinKey.test.ts, on a fixture built for it.)
    const idsByEntity = new Map(Object.entries(records).map(([e, rows]) => [joinKeyFor(e), new Set(rows.map((r) => r.id))]));
    let checked = 0;
    for (const rows of Object.values(records)) {
      for (const rec of rows) {
        for (const [k, v] of Object.entries(rec)) {
          if (!k.endsWith("Id") || k === "id" || v == null) continue;
          expect(k, `FK column "${k}" is not a legal identifier`).toMatch(/^[A-Za-z][A-Za-z0-9]*Id$/);
          const set = idsByEntity.get(k);
          if (!set) continue;
          checked += 1;
          expect(set.has(String(v)), `dangling FK ${k}=${v}`).toBe(true);
        }
      }
    }
    expect(checked, "no foreign key was resolved at all — the lookup is broken").toBeGreaterThan(50);
  });

  it("volume makes the design testable — pagination, extremes, planted edge cases", () => {
    const { records, counts } = generateSeed(ontology, version);
    // at least one root entity paginates (>20)
    expect(Math.max(...Object.values(counts))).toBeGreaterThan(20);
    // a planted null (missing optional) exists somewhere
    const anyNull = Object.values(records).flat().some((r) => Object.values(r).some((v) => v === null));
    expect(anyNull).toBe(true);
    // a boundary monetary 0 exists somewhere
    const anyZero = Object.values(records).flat().some((r) => Object.values(r).some((v) => v === 0));
    expect(anyZero).toBe(true);
  });

  it("emits the assumptions list that feeds Listen (optionality, fan-out, verb, orphans)", () => {
    const { assumptions } = generateSeed(ontology, version);
    const kinds = new Set(assumptions.map((a) => a.kind));
    expect(kinds.has("optionality")).toBe(true);
    expect(kinds.has("fan-out")).toBe(true);
    expect(kinds.has("relation-verb")).toBe(true);
    expect(kinds.has("orphan-entity")).toBe(true);
    for (const a of assumptions) expect(a.listenQuestion.length).toBeGreaterThan(10);
    // every relation contributes at least an optionality assumption
    expect(assumptions.filter((a) => a.kind === "optionality").length).toBeGreaterThanOrEqual(30);
  });
});
