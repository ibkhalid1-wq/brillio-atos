/**
 * The ledger store (docs/aura/ledger-spec.md). Storage-agnostic: an in-memory
 * implementation behind `LedgerStore` a Supabase adapter can later satisfy
 * (persistence is gated — build against memory).
 *
 * Insertion is PRECEDENCE-AWARE: `resolvePrecedence` decides what happens when a
 * new claim conflicts with a live one on the same locus. This is where the core
 * promise lives — a `generated` claim can never supersede an `asserted` closure,
 * because precedence guarantees generated loses to asserted (tested).
 */
import { resolvePrecedence, type Source, type World } from "./precedence";
import {
  type Claim, type ClaimValue, type Closure, type Layer, type Owner, type Status,
  type LedgerElement, type ShapeDecl, contentId, isLive,
} from "./types";

const substantive = (v: ClaimValue): boolean => v.kind !== "unknown" && v.kind !== "na";
const valueEq = (a: ClaimValue, b: ClaimValue): boolean => JSON.stringify(a) === JSON.stringify(b);
const valueConflicts = (a: ClaimValue, b: ClaimValue): boolean => substantive(a) && substantive(b) && !valueEq(a, b);

export interface AssertInput {
  about: string;
  value: ClaimValue;
  world: World;
  layer: Layer;
  source: Source;
  ownerWhileOpen: Owner;
  status?: Status;      // default derived: closed if closedBy present, else open/weak
  closedBy?: Closure;
  createdAt?: string;
}

export interface ConflictItem {
  about: string;
  world: World;
  claims: string[];                 // the live conflicting claim ids
  kind: "coexist" | "escalate";
  escalateTo?: "slot-owner" | "legal-compliance";
}

export interface LedgerStore {
  elements(): LedgerElement[];
  claims(): Claim[];
  shapes(): ShapeDecl[];
  addElement(e: LedgerElement): void;
  addShape(s: ShapeDecl): void;
  claimsAbout(about: string): Claim[];
  liveClaimsAbout(about: string): Claim[];
  /** Insert a claim; resolves precedence against live claims on the same locus. */
  assert(input: AssertInput): Claim;
  /** Close an existing claim with a closure (assertion/disposition/document/…). */
  close(claimId: string, closure: Closure): Claim;
  /** Convenience: an owner accepts a value as a (weak) disposition. */
  disposition(about: string, value: ClaimValue, world: World, layer: Layer, owner: Owner, by: string, at?: string): Claim;
  /** Mark two live claims a visible contradiction. */
  contradict(aId: string, bId: string): void;
  /** Resolve the live set + conflicts for a locus (what a projection reads). */
  resolve(about: string): { live: Claim[]; conflicts: ConflictItem[] };
  allConflicts(): ConflictItem[];
}

export function createLedgerStore(seed?: { elements?: LedgerElement[]; shapes?: ShapeDecl[] }): LedgerStore {
  const els = new Map<string, LedgerElement>();
  const cls = new Map<string, Claim>();
  const shp: ShapeDecl[] = [...(seed?.shapes ?? [])];
  for (const e of seed?.elements ?? []) els.set(e.id, e);

  const claimsAbout = (about: string) => [...cls.values()].filter((c) => c.about === about);
  const liveClaimsAbout = (about: string) => claimsAbout(about).filter(isLive);

  const link = (a: Claim, b: Claim) => {
    a.contradicts = [...new Set([...(a.contradicts ?? []), b.id])];
    b.contradicts = [...new Set([...(b.contradicts ?? []), a.id])];
  };

  const assert = (input: AssertInput): Claim => {
    const id = contentId("cl", input.about, input.world, input.source, JSON.stringify(input.value));
    const existing = cls.get(id);
    if (existing) return existing; // identical claim → corroboration, one row
    const status: Status = input.status
      ?? (input.value.kind === "unknown" ? "open"
        : input.value.kind === "na" ? "n/a"
          : input.closedBy ? (input.closedBy.verbatim ? "closed" : "weak") : "weak");
    const claim: Claim = {
      id, about: input.about, value: input.value, world: input.world, layer: input.layer,
      source: input.source, status, ownerWhileOpen: input.ownerWhileOpen,
      closedBy: input.closedBy, createdAt: input.createdAt,
    };
    // resolve vs each live claim on the same locus
    for (const x of liveClaimsAbout(input.about)) {
      if (x.id === claim.id) continue;
      // an incoming substantive value fills an open unknown of the SAME world (and vice-versa)
      if (x.world === claim.world) {
        if (x.value.kind === "unknown" && substantive(claim.value)) { x.supersededBy = claim.id; continue; }
        if (claim.value.kind === "unknown" && substantive(x.value)) { claim.supersededBy = x.id; continue; }
      }
      if (!valueConflicts(x.value, claim.value)) continue;
      const r = resolvePrecedence({ source: claim.source, world: claim.world }, { source: x.source, world: x.world });
      if (r.outcome === "wins") {
        if (r.winner === "a") { x.supersededBy = claim.id; if (r.loserDisposition === "blocked") { x.status = "blocked"; x.blockedReason = r.reason; } }
        else { claim.supersededBy = x.id; if (r.loserDisposition === "blocked") { claim.status = "blocked"; claim.blockedReason = r.reason; } }
      } else if (r.outcome === "escalate") {
        link(claim, x);
        claim.escalateTo = r.escalateTo; x.escalateTo = r.escalateTo;
        if (r.loser === "a") { claim.status = "blocked"; claim.blockedReason = r.reason; }
        if (r.loser === "b") { x.status = "blocked"; x.blockedReason = r.reason; }
      } else if (r.outcome === "coexist" && x.world === claim.world) {
        link(claim, x); // cross-world coexist is a deviation, not a stored contradiction
      }
    }
    cls.set(id, claim);
    return claim;
  };

  const close = (claimId: string, closure: Closure): Claim => {
    const c = cls.get(claimId);
    if (!c) throw new Error(`no claim ${claimId}`);
    c.closedBy = closure;
    c.status = closure.verbatim ? "closed" : "weak";
    return c;
  };

  const disposition = (about: string, value: ClaimValue, world: World, layer: Layer, owner: Owner, by: string, at?: string): Claim =>
    assert({ about, value, world, layer, source: "dispositioned", ownerWhileOpen: owner, status: "weak", closedBy: { method: "disposition", by, at }, createdAt: at });

  const contradict = (aId: string, bId: string): void => {
    const a = cls.get(aId), b = cls.get(bId);
    if (a && b) link(a, b);
  };

  const conflictsFor = (about: string): ConflictItem[] => {
    const live = liveClaimsAbout(about);
    const seen = new Set<string>();
    const out: ConflictItem[] = [];
    for (const c of live) {
      for (const otherId of c.contradicts ?? []) {
        const other = cls.get(otherId);
        if (!other || !isLive(other)) continue;
        const key = [c.id, otherId].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const escalateTo = c.escalateTo ?? other.escalateTo;
        out.push({ about, world: c.world, claims: [c.id, otherId], kind: escalateTo ? "escalate" : "coexist", escalateTo });
      }
    }
    return out;
  };

  const resolve = (about: string) => ({ live: liveClaimsAbout(about), conflicts: conflictsFor(about) });
  const allConflicts = (): ConflictItem[] => [...new Set([...cls.values()].map((c) => c.about))].flatMap(conflictsFor);

  return {
    elements: () => [...els.values()],
    claims: () => [...cls.values()],
    shapes: () => [...shp],
    addElement: (e) => { els.set(e.id, e); },
    addShape: (s) => { shp.push(s); },
    claimsAbout, liveClaimsAbout, assert, close, disposition, contradict, resolve, allConflicts,
  };
}
