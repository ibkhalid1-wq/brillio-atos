/**
 * REGRESSION — convergence counts REAL closures only (verbatim, attributed).
 *
 * The bug: the Design Loop read "57.2% closed/weak" convergence beside "0 attributed
 * closures" — the 57.2% was born-weak generated pre-fill (prototype defaults nobody
 * confirmed), not convergence. Split: pctClosed = closed only (the convergence number);
 * pctSettled = closed + weak (the claims-settlement bar). Convergence can never again
 * exceed what HEARD supports.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildKitView } from "@/v3/lib/ledger/projections";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const store = migrate({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") } as Snapshot);

describe("burn-down split — convergence = real closures, pre-fill stays out of the headline", () => {
  const bd = buildKitView(store).burnDown;

  it("Laila has ZERO real closures (nothing closed yet) → convergence 0%, not 57%", () => {
    expect(bd.closed).toBe(0);
    expect(bd.pctClosed).toBe(0);
  });

  it("the weak pre-fill is visible but separate (it was the old fake 57%)", () => {
    expect(bd.weak).toBeGreaterThan(0);
    expect(bd.pctSettled).toBeGreaterThan(50); // the pre-fill share the old number showed
  });

  it("accounting: total = closed + weak + open; pctClosed ≤ pctSettled", () => {
    expect(bd.closed + bd.weak + bd.open).toBe(bd.total);
    expect(bd.pctClosed).toBeLessThanOrEqual(bd.pctSettled);
  });

  it("a REAL (verbatim, attributed) closure moves convergence", () => {
    const openClaim = store.claims().find((c) => c.status === "open")!;
    store.assert({
      about: openClaim.about, value: { kind: "scalar", value: "confirmed" },
      world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "unowned" },
      status: "closed", closedBy: { method: "assertion", by: "stakeholder:test", verbatim: "they said so" },
    });
    const after = buildKitView(store).burnDown;
    expect(after.closed).toBe(1);
    expect(after.pctClosed).toBeGreaterThan(0);
  });
});
