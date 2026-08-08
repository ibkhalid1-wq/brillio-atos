/**
 * Journey derivation, verified against Laila's real committed ontology + atlas.
 * Determinism (same in → same out), the structural findings (roots/sinks/orphans/
 * forks), the phase bands, and deterministic workflow placement.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveJourneys, placeWorkflows } from "@/v3/lib/journeyGraph";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

describe("journey derivation", () => {
  const jg = deriveJourneys(ontology);

  it("is deterministic — same ontology in, same journeys out", () => {
    expect(JSON.stringify(deriveJourneys(ontology))).toBe(JSON.stringify(jg));
  });

  it("counts the generic verb honestly (34 produces of 35 relations on Laila)", () => {
    expect(jg.verb.total).toBe(35);
    expect(jg.verb.produces).toBe(34);
    expect(jg.verb.other).toBe(1); // the one "is part of"
  });

  it("finds the structural facts — roots, sinks, orphans, forks", () => {
    expect(jg.roots).toEqual(["Campaign", "Partner"]);
    expect(jg.orphans).toContain("Contact");
    expect(jg.orphans.length).toBe(5); // Contact, Signal, Signal Action, Interaction, Document
    // Opportunity is the big ambiguous fork — the generic verb's fan-out
    const oppFork = jg.forks.find((f) => f.entity === "Opportunity");
    expect(oppFork).toBeDefined();
    expect(oppFork!.children.length).toBeGreaterThan(5);
  });

  it("is acyclic on Laila (no cycles)", () => {
    expect(jg.cycles).toEqual([]);
  });

  it("derives phase bands (topological depth) as the vertical axis", () => {
    // Opportunity must sit downstream of Lead/Account and upstream of Contract.
    expect(jg.entityPhase["Opportunity"]).toBeGreaterThan(jg.entityPhase["Lead"]);
    expect(jg.entityPhase["Contract"]).toBeGreaterThan(jg.entityPhase["Opportunity"]);
    expect(jg.entityPhase["Revenue Recognition"]).toBeGreaterThan(jg.entityPhase["Contract"]);
    // bands are contiguous from 0
    expect(jg.phases[0].depth).toBe(0);
  });

  it("ranks the trunk by participation — Opportunity is the busiest node", () => {
    expect(jg.trunk[0]).toBe("Opportunity");
  });

  it("reports candidate journeys, longest first, without picking one", () => {
    expect(jg.candidateJourneys.length).toBeGreaterThan(1);
    const top = jg.candidateJourneys[0];
    expect(top.path).toContain("Opportunity");
    expect(top.length).toBeGreaterThanOrEqual(4);
    expect(jg.totalMaximalPaths).toBeGreaterThan(10); // the produces fan-out
  });
});

describe("workflow phase placement", () => {
  const jg = deriveJourneys(ontology);
  const placed = placeWorkflows(atlas, jg);

  it("is deterministic and marks every placement derived", () => {
    expect(placed.length).toBe(14);
    for (const p of placed) expect(p.method).toBe("derived");
    expect(JSON.stringify(placeWorkflows(atlas, jg))).toBe(JSON.stringify(placed));
  });

  it("places the qualification workflow at the Opportunity phase, invoicing later", () => {
    const qual = placed.find((p) => p.name.includes("Qualification"));
    expect(qual?.viaEntity).toBe("Opportunity");
    const invoicing = placed.find((p) => p.name.includes("Invoicing"));
    expect(invoicing!.phase!).toBeGreaterThan(qual!.phase!);
  });

  it("places the Legal Contract workflow and the Finance Revenue workflow at adjacent phases (the seam)", () => {
    const legal = placed.find((p) => p.area === "Legal");
    const finance = placed.find((p) => p.name.includes("Invoicing"));
    expect(legal?.viaEntity).toBe("Contract");
    expect(finance!.phase!).toBeGreaterThanOrEqual(legal!.phase!); // Contract → Revenue progression across the Legal/Finance boundary
  });
});
