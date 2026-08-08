/**
 * Ledger store — precedence-aware insertion and the core promise
 * (a generated claim can never supersede an asserted closure).
 */
import { describe, it, expect } from "vitest";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { isLive, type ClaimValue, type Owner } from "@/v3/lib/ledger/types";

const scalar = (v: string | number | boolean): ClaimValue => ({ kind: "scalar", value: v });
const unknown: ClaimValue = { kind: "unknown" };
const salesOps: Owner = { kind: "role", role: "Sales Ops" };
const jointMS: Owner = { kind: "joint", a: "Marketing", b: "Sales" };

describe("ledger store", () => {
  it("asserts, and an incoming value fills an open unknown on the same locus", () => {
    const s = createLedgerStore();
    const q = s.assert({ about: "opportunity.stage.valueSet", value: unknown, world: "as-is", layer: "domain", source: "generated", ownerWhileOpen: salesOps });
    expect(q.status).toBe("open");
    const v = s.assert({ about: "opportunity.stage.valueSet", value: scalar("Prospecting;Qualification;Proposal;Closed Won"), world: "as-is", layer: "domain", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "sales-leader", verbatim: "our stages are…" } });
    expect(s.liveClaimsAbout("opportunity.stage.valueSet")).toEqual([v]); // the unknown is superseded
    expect(v.status).toBe("closed");
  });

  it("CORE PROMISE — a generated claim cannot supersede an asserted closure", () => {
    const s = createLedgerStore();
    const asserted = s.assert({ about: "opportunity.owner", value: scalar("Account Executive"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "ops-lead", verbatim: "the owner is the AE" } });
    const gen = s.assert({ about: "opportunity.owner", value: scalar("Sales Manager"), world: "to-be", layer: "configuration", source: "generated", ownerWhileOpen: salesOps });
    expect(isLive(asserted)).toBe(true);      // the asserted closure survives
    expect(gen.supersededBy).toBe(asserted.id); // the generation loses, kept as history
    expect(s.liveClaimsAbout("opportunity.owner").map((c) => c.id)).toEqual([asserted.id]);
  });

  it("an asserted correction supersedes a code-derived as-is export (hard case 1)", () => {
    const s = createLedgerStore();
    const exp = s.assert({ about: "opportunity.stage", value: scalar("Discovery"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: salesOps, closedBy: { method: "import", by: "sf-export" } });
    const corr = s.assert({ about: "opportunity.stage", value: scalar("Qualification"), world: "as-is", layer: "configuration", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "rep", verbatim: "we never use Discovery" } });
    expect(exp.supersededBy).toBe(corr.id);
    expect(s.liveClaimsAbout("opportunity.stage")).toEqual([corr]);
  });

  it("two conflicting assertions coexist as a routable contradiction, then escalate", () => {
    const s = createLedgerStore();
    const a = s.assert({ about: "account.isClientOrPartner", value: scalar("client-only"), world: "as-is", layer: "domain", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "exec-1", verbatim: "always the client" } });
    const b = s.assert({ about: "account.isClientOrPartner", value: scalar("client-or-partner"), world: "as-is", layer: "domain", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "exec-2", verbatim: "partners too" } });
    expect(isLive(a) && isLive(b)).toBe(true); // both live
    const { conflicts } = s.resolve("account.isClientOrPartner");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].kind).toBe("escalate");
  });

  it("cross-world claims do not supersede each other (deviation, not conflict)", () => {
    const s = createLedgerStore();
    const asIs = s.assert({ about: "opportunity.stage", value: scalar("Discovery"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: salesOps });
    const toBe = s.assert({ about: "opportunity.stage", value: scalar("Qualification"), world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: salesOps });
    expect(isLive(asIs) && isLive(toBe)).toBe(true);
    expect(s.resolve("opportunity.stage").conflicts.length).toBe(0); // not a stored contradiction
  });

  it("disposition is a weak closure attributed to an owner; joint owners are first-class", () => {
    const s = createLedgerStore();
    const d = s.disposition("rel:lead-opportunity.handoffRule", scalar("MQL score ≥ 80"), "to-be", "domain", jointMS, "ops");
    expect(d.status).toBe("weak");
    expect(d.source).toBe("dispositioned");
    expect(d.ownerWhileOpen).toEqual(jointMS);
  });
});
