/**
 * ONE DEFINITION OF A MERGE, ACROSS A RUNTIME BOUNDARY — finding F4.
 *
 * There are two merge implementations: `merge.reconcile` (synchronous, in-memory
 * `LedgerStore`) and `PgLedger.reconcile` (async, one locked transaction per locus). On
 * 2026-08-11 three rules — N-4 same-provenance re-import correction, N-5 the agreeing-
 * duplicate collapse, N-11 the deviation count — landed in the first and not the second.
 * For that afternoon the in-memory ledger and the persisted ledger gave different answers
 * to "what does a re-uploaded dictionary mean?", and the persisted `MergeReport` did not
 * even have a field in which to disagree. That is the one-definition-per-number invariant
 * this codebase exists to enforce, broken across the runtime boundary rather than within
 * a file — the place no existing gate was looking.
 *
 * The fix is `mergeRules.ts`: the rules are pure predicates both callers import. This file
 * proves that three ways, weakest to strongest:
 *
 *  1. THE RULES THEMSELVES, called directly. Pure and synchronous, so the decisions the
 *     PERSISTED path takes are testable in an environment with no database — which is the
 *     only environment this suite has ever had.
 *  2. SOURCE LOCKSTEP. Neither `merge.ts` nor `pgStore.ts` may re-declare a rule
 *     `mergeRules.ts` owns, and both must actually CALL each rule. Deleting the `deviates`
 *     call from one side is exactly how this drifted the first time; now it fails here.
 *  3. AN END-TO-END EQUIVALENCE RUN of `PgLedger.reconcile` against a query shim, compared
 *     field-for-field with `merge.reconcile` over the same batch.
 *
 * ── WHAT (3) DOES NOT PROVE, stated so it cannot be read as more than it is ───────────
 * `fakePool` below is NOT Postgres. It is ~100 lines that answer the exact SQL strings
 * `pgStore.ts` issues, and it throws on any statement it does not recognise, so a new
 * query fails the test loudly rather than passing silently. It models jsonb's key
 * reordering on write (which is why `valueEq` must be order-independent) and it models
 * `superseded_by is null` liveness and `coalesce` patch semantics. It does NOT model
 * concurrency, `pg_advisory_xact_lock`, transaction rollback/isolation, the audit trigger
 * on `aura.intent`, FK constraints, or jsonb's real type coercions. Those need a real
 * database and there is none here: the locking and audit halves of `PgLedger` remain
 * UNVERIFIED in this suite and are not claimed otherwise. What is verified is the MERGE
 * DECISION SEQUENCE — which rule fires, in what order, and what the report says.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLedgerStore, type AssertInput, type LedgerStore } from "@/v3/lib/ledger/store";
import { mergeDecision, reconcile } from "@/v3/lib/ledger/merge";
import { PgLedger } from "@/v3/lib/ledger/pgStore";
import {
  canonical, collapseDecision, deviates, recencySupersedes, valueEq,
  type ClaimFacts, type MergeReport,
} from "@/v3/lib/ledger/mergeRules";
import { aboutOf, type ClaimValue, type LedgerElement, type Owner } from "@/v3/lib/ledger/types";

const OWNER: Owner = { kind: "role", role: "System Owner" };
const sc = (v: string): ClaimValue => ({ kind: "scalar", value: v });
const imported = (system: string) => ({ method: "import" as const, by: system });

const facts = (over: Partial<ClaimFacts>): ClaimFacts =>
  ({ world: "to-be", source: "code-derived", value: sc("text"), ...over });

// ══ 1 · the rules, called directly ═══════════════════════════════════════════════════
describe("[F4] the merge rules are one object, callable without a database", () => {
  it("recencySupersedes: the SAME system's re-import corrects; a DIFFERENT system's does not", () => {
    const existing = facts({ value: sc("text"), closedBy: imported("dictionary:ehr") });
    const sameSystem = facts({ value: sc("number"), closedBy: imported("dictionary:ehr") });
    const otherSystem = facts({ value: sc("number"), closedBy: imported("dictionary:crm") });
    expect(recencySupersedes(existing, sameSystem)).toBe(true);
    expect(recencySupersedes(existing, otherSystem)).toBe(false);
  });

  it("recencySupersedes: absent provenance NEVER matches absent provenance", () => {
    // "I cannot tell which system this came from" must not read as "the same system" —
    // the pair falls through to precedence and coexists, so the miss stays visible.
    const a = facts({ value: sc("text") });
    const b = facts({ value: sc("number") });
    expect(recencySupersedes(a, b)).toBe(false);
    // …and a person's closure is not a system identity either, even on a code-derived row.
    const byPerson = facts({ value: sc("number"), closedBy: { method: "assertion", by: "Dana" } });
    expect(recencySupersedes(facts({ closedBy: { method: "assertion", by: "Dana" } }), byPerson)).toBe(false);
  });

  it("recencySupersedes: generated↔generated is recency; an equal value is not a supersession", () => {
    const old = facts({ source: "generated", value: sc("text") });
    expect(recencySupersedes(old, facts({ source: "generated", value: sc("number") }))).toBe(true);
    expect(recencySupersedes(old, facts({ source: "generated", value: sc("text") }))).toBe(false);
    // cross-world is a deviation, never a supersession
    expect(recencySupersedes(old, facts({ source: "generated", value: sc("number"), world: "as-is" }))).toBe(false);
  });

  it("collapseDecision: an agreeing pair collapses toward the stronger source", () => {
    const live = facts({ source: "generated", value: sc("text") });
    const incoming = facts({ source: "code-derived", value: sc("text") });
    expect(collapseDecision(incoming, live)).toBe("incoming-supersedes-live");
    expect(collapseDecision(live, incoming)).toBe("live-supersedes-incoming");
  });

  it("collapseDecision: where the lattice CANNOT decide, nothing is flattened", () => {
    // two code-derived claims agreeing → precedence says coexist → left alone, both live.
    const a = facts({ source: "code-derived", value: sc("text") });
    expect(collapseDecision(a, { ...a })).toBe("none");
    // two asserted claims agreeing → escalate → left alone.
    const h = facts({ source: "asserted", value: sc("text") });
    expect(collapseDecision(h, { ...h })).toBe("none");
    // a cross-world pair agreeing is the deviation register's evidence that the worlds
    // AGREE on the slot; collapsing it would delete that evidence.
    expect(collapseDecision(a, facts({ source: "generated", value: sc("text"), world: "as-is" }))).toBe("none");
    // an `unknown` is not an answer, so it can never be "the same answer"
    expect(collapseDecision(facts({ value: { kind: "unknown" } }), a)).toBe("none");
  });

  it("deviates: fires only against the OTHER world, and only when no value there matches", () => {
    const toBe = facts({ world: "to-be", value: sc("number") });
    expect(deviates(toBe, [facts({ world: "as-is", value: sc("text") })])).toBe(true);
    expect(deviates(toBe, [facts({ world: "as-is", value: sc("number") })])).toBe(false);
    expect(deviates(toBe, [facts({ world: "to-be", value: sc("text") })])).toBe(false); // same world ≠ deviation
    expect(deviates(toBe, [])).toBe(false);
    // multiplicity honoured: matching ANY of the other world's values is agreement
    expect(deviates(toBe, [facts({ world: "as-is", value: sc("text") }), facts({ world: "as-is", value: sc("number") })])).toBe(false);
  });

  it("valueEq is ORDER-INDEPENDENT, so a jsonb key reorder is not a correction", () => {
    // Postgres jsonb stores object keys by (length, bytewise), not insertion order. Under a
    // bare JSON.stringify compare the same value read back from the database differs from
    // the value in the batch, which spuriously fires the recency rule — the persisted path
    // would report a re-import "correcting" itself to the identical value, forever.
    const a = { kind: "unresolved-ref", name: "Deal", why: "no match" } as ClaimValue;
    const reordered = JSON.parse('{"why":"no match","kind":"unresolved-ref","name":"Deal"}') as ClaimValue;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(reordered));   // the trap
    expect(valueEq(a, reordered)).toBe(true);                        // the rule
    expect(recencySupersedes(
      { ...facts({ value: a, closedBy: imported("dictionary:ehr") }) },
      { ...facts({ value: reordered, closedBy: imported("dictionary:ehr") }) },
    )).toBe(false);
    // array ORDER still matters — ref-list is a sequence, not a set
    expect(valueEq({ kind: "ref-list", to: ["a", "b"] }, { kind: "ref-list", to: ["b", "a"] })).toBe(false);
  });
});

// ══ 2 · source lockstep ══════════════════════════════════════════════════════════════
const LEDGER = (f: string) => readFileSync(resolve(__dirname, `../lib/ledger/${f}`), "utf8");
/** Source with comments stripped — the rules are quoted in the prose of both files. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[F4] neither reconcile carries a private copy of a rule", () => {
  const RULES = ["recencySupersedes", "collapseDecision", "deviates", "valueEq", "substantive", "isAttributedClosure", "recencyKind"];

  it("both merge.ts and pgStore.ts take their decisions from mergeRules.ts", () => {
    for (const f of ["merge.ts", "pgStore.ts"]) {
      expect(codeOnly(LEDGER(f)), `${f} no longer imports the shared rules`).toMatch(/from "\.\/mergeRules"/);
    }
  });

  it("neither file RE-DECLARES a rule mergeRules.ts already owns", () => {
    for (const f of ["merge.ts", "pgStore.ts"]) {
      const code = codeOnly(LEDGER(f));
      const redeclared = RULES.filter((r) => new RegExp(`(?:const|let|function)\\s+${r}\\b`).test(code));
      expect(redeclared, `${f} declares its own ${redeclared.join(", ")} — that is how the two merges drifted`).toEqual([]);
    }
  });

  it("BOTH reconcile implementations actually CALL each of the three rules", () => {
    // The drift was not a wrong rule; it was an ABSENT one. A file can import the module
    // and still never ask it about N-5 or N-11 — which is precisely what pgStore did.
    for (const f of ["merge.ts", "pgStore.ts"]) {
      const code = codeOnly(LEDGER(f));
      for (const call of ["recencySupersedes(", "collapseDecision(", "deviates("]) {
        expect(code.includes(call), `${f} never calls ${call}) — the rule is defined but unasked`).toBe(true);
      }
    }
  });

  it("mergeDecision narrates what reconcile DOES — the `na` cell it used to get wrong", () => {
    // `mergeDecision` restated the recency arms inline: "both generated, values differ ⇒
    // supersede". `reconcile` requires BOTH sides substantive (as `store.assert` does), so
    // an `na`-valued generated claim met by a substantive generated one actually COEXISTS.
    // The narrative said one thing and the merge did another — a third copy of the rule,
    // inside the file that was supposed to be describing it.
    const store = createLedgerStore();
    store.addElement({ id: ATTR("na"), kind: "attribute", name: "na" });
    const existing = store.assert(claim("na", { value: { kind: "na" }, source: "generated" }));
    const rep = reconcile(store, [claim("na", { value: sc("text"), source: "generated" })], new Set([ATTR("na")]));
    expect(rep.supersededGenerated).toBe(0);                          // what reconcile does
    expect(store.liveClaimsAbout(LOCUS("na"))).toHaveLength(2);       // …both rows still live
    expect(mergeDecision(existing, { world: "to-be", value: sc("text"), source: "generated" }))
      .toBe("coexist-conflict");                                     // …and what the narrative now says
  });

  it("the two paths share ONE MergeReport type, so a field cannot exist on one path only", () => {
    // pgStore used to declare its own report with three of the nine fields missing.
    expect(codeOnly(LEDGER("pgStore.ts"))).not.toMatch(/interface\s+MergeReport/);
    expect(codeOnly(LEDGER("merge.ts"))).not.toMatch(/interface\s+MergeReport/);
    expect(codeOnly(LEDGER("mergeRules.ts"))).toMatch(/interface\s+MergeReport/);
  });
});

// ══ 3 · end-to-end equivalence, PgLedger vs merge ════════════════════════════════════
/**
 * A query shim standing in for `pg.Pool`. It answers only the statements `pgStore.ts`
 * issues and THROWS on anything else, so an unmodelled query is a red test, never a
 * silent pass. See this file's header for what it does and does not prove.
 */
type Row = Record<string, unknown>;
/** Model jsonb: re-serialised, object keys stored by (length, bytewise) — NOT insertion order. */
const jsonb = (v: unknown): unknown => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(jsonb);
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))) out[k] = jsonb(o[k]);
  return out;
};
const asJsonb = (s: unknown): unknown => (typeof s === "string" ? jsonb(JSON.parse(s)) : s ?? null);

function fakePool() {
  const claims: Row[] = [];
  const elements: Row[] = [];
  const unhandled: string[] = [];
  const find = (program: unknown, id: unknown) => claims.find((r) => r.program_id === program && r.id === id);

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> => {
    const q = sql.replace(/\s+/g, " ").trim();
    const rows = (r: Row[]) => ({ rows: r });
    if (/^(begin|commit|rollback)$/i.test(q)) return rows([]);
    if (q.startsWith("select pg_advisory_xact_lock") || q.startsWith("select set_config")) return rows([{}]);
    if (q.startsWith("select * from ledger_claims where program_id=$1 and about=$2 and superseded_by is null")) {
      return rows(claims.filter((r) => r.program_id === params[0] && r.about === params[1] && r.superseded_by == null));
    }
    if (q.startsWith("select * from ledger_claims where program_id=$1 and id=$2")) {
      return rows(claims.filter((r) => r.program_id === params[0] && r.id === params[1]));
    }
    if (q.startsWith("select 1 from ledger_claims where program_id=$1 and id=$2")) {
      return rows(find(params[0], params[1]) ? [{ "?column?": 1 }] : []);
    }
    if (q.startsWith("select about, closed_by, source, status from ledger_claims")) {
      return rows(claims.filter((r) => r.program_id === params[0] && r.superseded_by == null));
    }
    if (q.startsWith("insert into ledger_claims")) {
      const [id, program_id, about, world, source, status, layer, value, owner, superseded_by, closed_by, contradicts, escalate_to, blocked_reason] = params;
      const existing = find(program_id, id);
      if (existing) {
        if (q.includes("do nothing")) return rows([]);
        Object.assign(existing, { status, superseded_by: superseded_by ?? null, contradicts, escalate_to: escalate_to ?? null, blocked_reason: blocked_reason ?? null });
        return rows([]);
      }
      claims.push({
        id, program_id, about, world, source, status, layer,
        value: asJsonb(value), owner: asJsonb(owner), closed_by: asJsonb(closed_by),
        superseded_by: superseded_by ?? null, contradicts: contradicts ?? [],
        escalate_to: escalate_to ?? null, blocked_reason: blocked_reason ?? null,
      });
      return rows([]);
    }
    if (q.startsWith("update ledger_claims set superseded_by=coalesce")) {
      const [program_id, id, superseded_by, status, blocked_reason, contradicts, escalate_to] = params;
      const r = find(program_id, id);
      if (r) {                                              // coalesce: null leaves the column alone
        if (superseded_by != null) r.superseded_by = superseded_by;
        if (status != null) r.status = status;
        if (blocked_reason != null) r.blocked_reason = blocked_reason;
        if (contradicts != null) r.contradicts = contradicts;
        if (escalate_to != null) r.escalate_to = escalate_to;
      }
      return rows([]);
    }
    if (q.startsWith("insert into ledger_elements")) {
      const [id, program_id, kind, name, of, refs] = params;
      const e = elements.find((x) => x.program_id === program_id && x.id === id);
      if (e) Object.assign(e, { kind, name, of: of ?? null, refs: asJsonb(refs), dropped: false });
      else elements.push({ id, program_id, kind, name, of: of ?? null, refs: asJsonb(refs), dropped: false });
      return rows([]);
    }
    if (q.startsWith("update ledger_elements set dropped=true")) {
      const keep = new Set(params[1] as string[]);
      for (const e of elements) if (e.program_id === params[0] && !e.dropped && !keep.has(e.id as string)) e.dropped = true;
      return rows([]);
    }
    unhandled.push(q);
    throw new Error(`fakePool: unmodelled SQL — the shim must be extended or the test is lying:\n  ${q}`);
  };

  const client = { query, release: () => {} };
  return { pool: { connect: async () => client, query } as never, claims, elements, unhandled };
}

const ATTR = (n: string) => `el:attr:${n}`;
const LOCUS = (n: string) => aboutOf(ATTR(n), "dataType");
const LOCI = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
const ELEMENTS: LedgerElement[] = LOCI.map((n) => ({ id: ATTR(n), kind: "attribute", name: n }));
const KEPT = ELEMENTS.filter((e) => e.id !== ATTR("g"));   // the regeneration drops `g`

const claim = (n: string, over: Partial<AssertInput>): AssertInput => ({
  about: LOCUS(n), value: sc("text"), world: "to-be", layer: "configuration",
  source: "code-derived", ownerWhileOpen: OWNER, ...over,
});

/** The state both ledgers start from — one claim per locus, seven loci. */
const SEED: AssertInput[] = [
  claim("a", { value: sc("text"), closedBy: imported("dictionary:ehr") }),                    // N-4 subject
  claim("b", { value: sc("text"), closedBy: imported("dictionary:ehr") }),                    // N-4 control
  claim("c", { value: sc("text"), source: "generated" }),                                     // N-5 subject
  claim("d", { value: sc("text"), world: "as-is", closedBy: imported("dictionary:ehr") }),    // N-11 subject
  claim("e", { value: sc("text"), source: "generated" }),                                     // recency rule 1
  claim("f", { value: { kind: "unknown" }, source: "generated", status: "open" }),            // fill-unknown
  claim("g", { value: sc("text"), source: "asserted", closedBy: { method: "assertion", by: "Dana", verbatim: "priority is text" } }), // orphan-to-be
  claim("h", { value: { kind: "unknown" }, world: "as-is", source: "generated", status: "open" }), // an unknown in the OTHER world
  claim("i", { value: sc("text"), closedBy: imported("dictionary:ehr") }),                    // re-uploaded unchanged
];

/** The regeneration/re-upload batch: one input per rule. */
const BATCH: AssertInput[] = [
  claim("a", { value: sc("number"), closedBy: imported("dictionary:ehr") }),                  // N-4  corrects
  claim("b", { value: sc("number"), closedBy: imported("dictionary:crm") }),                  // N-4  coexists
  claim("c", { value: sc("text"), closedBy: imported("dictionary:ehr") }),                    // N-5  agrees → collapse
  claim("d", { value: sc("number"), source: "generated" }),                                   // N-11 deviates from as-is
  claim("e", { value: sc("number"), source: "generated" }),                                   // rule 1 supersedes
  claim("f", { value: sc("text"), closedBy: imported("dictionary:ehr") }),                    // fills the unknown
  // `h` — the unknown on this locus is in the OTHER world, so this fills NOTHING. It is a
  // new claim. pgStore used to test `filledUnknowns` against the unfiltered live set and
  // would have called this a fill; merge.reconcile filters `liveBefore` to the input world.
  claim("h", { value: sc("text"), closedBy: imported("dictionary:ehr") }),
  // `i` — the same dictionary re-uploaded UNCHANGED: a byte-identical no-op. `assert`
  // returns the existing row and adds nothing, so it is not a new claim. pgStore used to
  // count every applied input as `newClaims` and would have reported one here.
  claim("i", { value: sc("text"), closedBy: imported("dictionary:ehr") }),
];

const memoryRun = (): { seed: MergeReport; batch: MergeReport; store: LedgerStore } => {
  const store = createLedgerStore();
  for (const e of ELEMENTS) store.addElement(e);
  const seed = reconcile(store, SEED, new Set(ELEMENTS.map((e) => e.id)));
  const batch = reconcile(store, BATCH, new Set(KEPT.map((e) => e.id)));
  return { seed, batch, store };
};

const pgRun = async (): Promise<{ seed: MergeReport; batch: MergeReport; live: (about: string) => Promise<Row[]> }> => {
  const { pool, claims } = fakePool();
  const pg = new PgLedger(pool, "prog-1");
  const seed = await pg.reconcile(SEED, ELEMENTS);
  const batch = await pg.reconcile(BATCH, KEPT);
  return { seed, batch, live: async (about) => claims.filter((r) => r.about === about && r.superseded_by == null) };
};

/** Live rows on a locus, reduced to what a merge decides — id, source, world, value. */
const memLive = (store: LedgerStore, about: string) =>
  store.liveClaimsAbout(about).map((c) => `${c.id}|${c.source}|${c.world}|${canonical(c.value)}`).sort();
const pgLive = (rows: Row[]) =>
  rows.map((r) => `${r.id}|${r.source}|${r.world}|${canonical(r.value)}`).sort();

describe("[F4] PgLedger.reconcile and merge.reconcile report the SAME merge", () => {
  it("the seed pass agrees field-for-field (both ledgers start from one state)", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    expect(pg.seed).toEqual(mem.seed);
    expect(mem.seed.newClaims).toBe(LOCI.length);  // the state is real, not an empty agreement
    expect(mem.seed.orphanedClosures).toEqual([]);
  });

  it("the regeneration pass agrees field-for-field, INCLUDING the three rules pgStore lacked", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    expect(pg.batch).toEqual(mem.batch);
    // and the agreement is not agreement-on-zero: each of the three rules actually fired.
    expect(mem.batch.correctedReimports).toBe(1);   // N-4  `a` — the same dictionary corrected itself
    expect(mem.batch.collapsedDuplicates).toBe(1);  // N-5  `c` — two writers, one value
    expect(mem.batch.deviations).toBe(1);           // N-11 `d` — to-be stands against as-is
    expect(mem.batch.supersededGenerated).toBe(1);  // rule 1 `e`
    expect(mem.batch.filledUnknowns).toBe(1);       // `f` ONLY — `h`'s unknown is another world's
    expect(mem.batch.newClaims).toBe(6);            // a,b,c,d,e,h — NOT `f` (a fill) and NOT `i` (added no row)
    expect(mem.batch.orphanedClosures).toEqual([{ about: LOCUS("g"), by: "Dana" }]);
  });

  it("an unchanged re-upload is a no-op on BOTH paths, and an unknown in the OTHER world is not a fill", async () => {
    // Two counting divergences that had nothing to do with the three named rules: pgStore
    // asked `filledUnknowns` of the whole locus rather than the input's world, and counted
    // every applied input as a new claim even when `assert` added no row. Same batch, same
    // report — so `newClaims` and `filledUnknowns` mean one thing across the boundary too.
    const mem = memoryRun();
    const pg = await pgRun();
    expect(pg.batch.filledUnknowns).toBe(mem.batch.filledUnknowns);
    expect(pg.batch.newClaims).toBe(mem.batch.newClaims);
    expect(memLive(mem.store, LOCUS("i"))).toEqual(pgLive(await pg.live(LOCUS("i"))));
    expect(memLive(mem.store, LOCUS("i"))).toHaveLength(1);   // the no-op stayed a no-op
  });

  it("N-4 · the corrected re-upload leaves ONE live row on BOTH paths, and it is the correction", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    expect(memLive(mem.store, LOCUS("a"))).toEqual(pgLive(await pg.live(LOCUS("a"))));
    expect(memLive(mem.store, LOCUS("a"))).toHaveLength(1);
    expect(memLive(mem.store, LOCUS("a"))[0]).toContain('"value":"number"');
  });

  it("N-4 · a DIFFERENT system's disagreement still coexists on BOTH paths", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    expect(memLive(mem.store, LOCUS("b"))).toEqual(pgLive(await pg.live(LOCUS("b"))));
    expect(memLive(mem.store, LOCUS("b"))).toHaveLength(2);   // the genuine conflict is NOT flattened
  });

  it("N-5 · the agreeing duplicate collapses to one row on BOTH paths, stronger source surviving", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    const live = memLive(mem.store, LOCUS("c"));
    expect(live).toEqual(pgLive(await pg.live(LOCUS("c"))));
    expect(live).toHaveLength(1);
    expect(live[0]).toContain("code-derived");   // code-derived outranks generated for to-be
  });

  it("N-11 · the cross-world pair stays live on BOTH paths — a deviation is counted, not resolved", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    expect(memLive(mem.store, LOCUS("d"))).toEqual(pgLive(await pg.live(LOCUS("d"))));
    expect(memLive(mem.store, LOCUS("d"))).toHaveLength(2);   // as-is + to-be, both live
  });

  it("every locus ends in the same live state — not just the same counters", async () => {
    const mem = memoryRun();
    const pg = await pgRun();
    for (const n of LOCI) {
      expect(memLive(mem.store, LOCUS(n)), `locus ${n} diverged`).toEqual(pgLive(await pg.live(LOCUS(n))));
    }
  });

  it("the shim answered every statement pgStore issued (no query was silently skipped)", async () => {
    const { pool, unhandled } = fakePool();
    const pg = new PgLedger(pool, "prog-2");
    await pg.reconcile(SEED, ELEMENTS);
    await pg.reconcile(BATCH, KEPT);
    expect(unhandled, "an unmodelled query would have thrown; this pins that it did not happen").toEqual([]);
  });
});
