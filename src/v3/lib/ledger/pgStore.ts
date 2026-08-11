/**
 * Postgres persistence adapter for the claims ledger (docs/aura/persistence-report.md).
 *
 * The shipped `LedgerStore` is SYNCHRONOUS; persistence is inherently async, so this
 * exposes an ASYNC surface (`AsyncLedgerStore`). The in-memory store is the sync mock;
 * this is the real thing. The precedence/merge logic is ported faithfully from
 * `store.ts` / `merge.ts` so behaviour matches the paper spec — verified against the DB.
 *
 * Every write is one transaction holding `pg_advisory_xact_lock(hashtext(about))` (the
 * per-locus lock — transaction-scoped so it survives the pooler's transaction mode), and
 * sets `aura.intent` so the Step 1 trigger emits the append-only audit_events row.
 */
import type { Pool, PoolClient } from "pg";
import { resolvePrecedence } from "./precedence";
import { type LedgerStore, type AssertInput } from "./store";
import { type Claim, type ClaimValue, contentId, isLive, type LedgerElement, normalizeOwner } from "./types";
// buildReadModel lives in a pg-free module so the client never bundles this persistence
// layer (which sets aura.intent); PgLedger.loadReadModel reuses it here.
import { buildReadModel } from "./readModel";

const substantive = (v: ClaimValue): boolean => v.kind !== "unknown" && v.kind !== "na";
// Order-independent canonical form: sorts object keys recursively (arrays keep their
// order — significant for ref-list). Values written by the batch and read back from
// Postgres jsonb differ only in object-key ordering (jsonb reorders keys by length),
// so a naive JSON.stringify falsely reports identical ref/ref-list/unresolved-ref
// values as different, which spuriously fires reconcile's recency rule.
const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
};
const valueEq = (a: ClaimValue, b: ClaimValue): boolean => canonical(a) === canonical(b);
const valueConflicts = (a: ClaimValue, b: ClaimValue): boolean => substantive(a) && substantive(b) && !valueEq(a, b);
const ATTRIBUTED = new Set(["asserted", "dispositioned", "document", "regulation", "precedent"]);
const isAttributedClosure = (c: Claim): boolean => ATTRIBUTED.has(c.source) && (c.status === "closed" || c.status === "weak");

const rowToClaim = (r: Record<string, unknown>): Claim => ({
  id: r.id as string, about: r.about as string, value: r.value as ClaimValue, world: r.world as Claim["world"],
  layer: r.layer as Claim["layer"], source: r.source as Claim["source"], status: r.status as Claim["status"],
  ownerWhileOpen: normalizeOwner(r.owner),   // rows written before Owner.parties carry {a,b} closedBy: (r.closed_by ?? undefined) as Claim["closedBy"],
  supersededBy: (r.superseded_by ?? undefined) as string | undefined,
  contradicts: (r.contradicts ?? []) as string[], escalateTo: (r.escalate_to ?? undefined) as Claim["escalateTo"],
  blockedReason: (r.blocked_reason ?? undefined) as string | undefined,
});

export interface MergeReport {
  applied: number; preservedClosures: number; supersededGenerated: number; filledUnknowns: number;
  newClaims: number; orphanedClosures: Array<{ about: string; by: string }>;
}

export class PgLedger {
  constructor(private pool: Pool, private programId: string, private actor = "ledger-service") {}

  private async withLockedTxn<T>(about: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [`${this.programId}#${about}`]); // per-locus lock
      await c.query("select set_config('aura.intent', $1, true)", [JSON.stringify({ action_type: "ledger.write", affected_kind: "claim", affected_id: about, actor: this.actor })]);
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }

  private async liveOnLocus(c: PoolClient, about: string): Promise<Claim[]> {
    const { rows } = await c.query("select * from ledger_claims where program_id=$1 and about=$2 and superseded_by is null", [this.programId, about]);
    return rows.map(rowToClaim);
  }
  private async persistClaim(c: PoolClient, cl: Claim): Promise<void> {
    await c.query(
      `insert into ledger_claims (id,program_id,about,world,source,status,layer,value,owner,superseded_by,closed_by,contradicts,escalate_to,blocked_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (program_id,id) do update set status=excluded.status, superseded_by=excluded.superseded_by, contradicts=excluded.contradicts, escalate_to=excluded.escalate_to, blocked_reason=excluded.blocked_reason`,
      [cl.id, this.programId, cl.about, cl.world, cl.source, cl.status, cl.layer, JSON.stringify(cl.value), JSON.stringify(cl.ownerWhileOpen),
       cl.supersededBy ?? null, cl.closedBy ? JSON.stringify(cl.closedBy) : null, cl.contradicts ?? [], cl.escalateTo ?? null, cl.blockedReason ?? null]);
  }
  private async patch(c: PoolClient, id: string, fields: Partial<Claim>): Promise<void> {
    await c.query("update ledger_claims set superseded_by=coalesce($3,superseded_by), status=coalesce($4,status), blocked_reason=coalesce($5,blocked_reason), contradicts=coalesce($6,contradicts), escalate_to=coalesce($7,escalate_to) where program_id=$1 and id=$2",
      [this.programId, id, fields.supersededBy ?? null, fields.status ?? null, fields.blockedReason ?? null, fields.contradicts ?? null, fields.escalateTo ?? null]);
  }

  /** Precedence-aware insert, mirroring the in-memory store — one locked transaction. */
  async assert(input: AssertInput): Promise<Claim> {
    const id = contentId("cl", input.about, input.world, input.source, JSON.stringify(input.value));
    return this.withLockedTxn(input.about, async (c) => {
      const ex = await c.query("select * from ledger_claims where program_id=$1 and id=$2", [this.programId, id]);
      if (ex.rows.length) return rowToClaim(ex.rows[0]); // identical claim → corroboration
      const status = input.status
        ?? (input.value.kind === "unknown" ? "open" : input.value.kind === "na" ? "n/a" : input.closedBy ? (input.closedBy.verbatim ? "closed" : "weak") : "weak");
      const claim: Claim = { id, about: input.about, value: input.value, world: input.world, layer: input.layer, source: input.source, status, ownerWhileOpen: input.ownerWhileOpen, closedBy: input.closedBy, contradicts: [] };
      for (const x of await this.liveOnLocus(c, input.about)) {
        if (x.id === claim.id) continue;
        if (x.world === claim.world) {
          if (x.value.kind === "unknown" && substantive(claim.value)) { await this.patch(c, x.id, { supersededBy: claim.id }); continue; }
          if (claim.value.kind === "unknown" && substantive(x.value)) { claim.supersededBy = x.id; continue; }
        }
        if (!valueConflicts(x.value, claim.value)) continue;
        const r = resolvePrecedence({ source: claim.source, world: claim.world }, { source: x.source, world: x.world });
        if (r.outcome === "wins") {
          if (r.winner === "a") await this.patch(c, x.id, { supersededBy: claim.id, status: r.loserDisposition === "blocked" ? "blocked" : undefined, blockedReason: r.loserDisposition === "blocked" ? r.reason : undefined });
          else { claim.supersededBy = x.id; if (r.loserDisposition === "blocked") { claim.status = "blocked"; claim.blockedReason = r.reason; } }
        } else if (r.outcome === "escalate") {
          claim.contradicts = [...new Set([...(claim.contradicts ?? []), x.id])]; claim.escalateTo = r.escalateTo;
          await this.patch(c, x.id, { contradicts: [...new Set([...(x.contradicts ?? []), claim.id])], escalateTo: r.escalateTo, ...(r.loser === "b" ? { status: "blocked", blockedReason: r.reason } : {}) });
          if (r.loser === "a") { claim.status = "blocked"; claim.blockedReason = r.reason; }
        } else if (r.outcome === "coexist" && x.world === claim.world) {
          claim.contradicts = [...new Set([...(claim.contradicts ?? []), x.id])];
          await this.patch(c, x.id, { contradicts: [...new Set([...(x.contradicts ?? []), claim.id])] });
        }
      }
      await this.persistClaim(c, claim);
      return claim;
    });
  }

  /**
   * Maintain ledger_elements to match what the regeneration produces — the claim path
   * already does this; this makes the element table catch up. Elements in the batch are
   * upserted (added if new, updated if changed, un-dropped if they returned); elements the
   * batch no longer produces are MARKED dropped, never deleted (their closures may still
   * point at them — that is the orphan case orphanedClosures() must find). Program-scoped,
   * one transaction, `aura.intent` set so the writes are audited like any other.
   */
  private async maintainElements(els: LedgerElement[]): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('aura.intent', $1, true)", [JSON.stringify({ action_type: "ledger.elements", affected_kind: "element", actor: this.actor })]);
      for (const e of els) {
        await c.query(
          `insert into ledger_elements (id,program_id,kind,name,of,refs,dropped) values ($1,$2,$3,$4,$5,$6,false)
           on conflict (program_id,id) do update set kind=excluded.kind, name=excluded.name, of=excluded.of, refs=excluded.refs, dropped=false
           where ledger_elements.kind is distinct from excluded.kind or ledger_elements.name is distinct from excluded.name
              or ledger_elements.of is distinct from excluded.of or ledger_elements.refs is distinct from excluded.refs
              or ledger_elements.dropped is distinct from false`,
          [e.id, this.programId, e.kind, e.name, e.of ?? null, JSON.stringify(e.refs ?? {})]);
      }
      // mark dropped: stored, not-yet-dropped elements the batch no longer produces (row STAYS)
      await c.query("update ledger_elements set dropped=true where program_id=$1 and not dropped and not (id = any($2::text[]))", [this.programId, els.map((e) => e.id)]);
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }

  /** Reconcile a regeneration batch into the stored ledger (recency + orphan flag); the
   *  element table is maintained to match the batch (added/changed upserted, dropped marked). */
  async reconcile(incoming: AssertInput[], incomingElements: LedgerElement[]): Promise<MergeReport> {
    const incomingElementIds = new Set(incomingElements.map((e) => e.id));
    const rep: MergeReport = { applied: 0, preservedClosures: 0, supersededGenerated: 0, filledUnknowns: 0, newClaims: 0, orphanedClosures: [] };
    for (const input of incoming) {
      await this.withLockedTxn(input.about, async (c) => {
        const live = await this.liveOnLocus(c, input.about);
        if (input.source === "generated" && substantive(input.value)) {
          for (const x of live) if (x.source === "generated" && substantive(x.value) && x.world === input.world && !valueEq(x.value, input.value)) {
            await this.patch(c, x.id, { supersededBy: contentId("cl", input.about, input.world, input.source, JSON.stringify(input.value)) }); rep.supersededGenerated += 1;
          }
        }
        const conflictingClosure = live.find((x) => isAttributedClosure(x) && substantive(x.value) && !valueEq(x.value, input.value) && x.world === input.world);
        const filledU = live.some((x) => x.value.kind === "unknown");
        if (conflictingClosure) rep.preservedClosures += 1; else if (filledU) rep.filledUnknowns += 1; else rep.newClaims += 1;
      });
      await this.assert(input); // precedence guarantees a generated claim cannot supersede an attributed closure
      rep.applied += 1;
    }
    await this.maintainElements(incomingElements); // element table catches up to what the claim path already did
    // orphans: attributed closures about elements the regeneration no longer produces
    const { rows } = await this.pool.query("select about, closed_by, source, status from ledger_claims where program_id=$1 and superseded_by is null", [this.programId]);
    for (const r of rows) {
      const el = (r.about as string).split("#")[0];
      if (ATTRIBUTED.has(r.source) && (r.status === "closed" || r.status === "weak") && !incomingElementIds.has(el)) rep.orphanedClosures.push({ about: r.about, by: (r.closed_by as { by?: string } | null)?.by ?? "?" });
    }
    return rep;
  }

  async recordRenameIntent(oldElementId: string, newElementId: string, by: string): Promise<void> {
    await this.pool.query("insert into ledger_rename_intents (program_id, old_element_id, new_element_id, by) values ($1,$2,$3,$4)", [this.programId, oldElementId, newElementId, by]);
  }

  async liveClaimsAbout(about: string): Promise<Claim[]> {
    const { rows } = await this.pool.query("select * from ledger_claims where program_id=$1 and about=$2 and superseded_by is null", [this.programId, about]);
    return rows.map(rowToClaim);
  }
  async orphanedClosures(): Promise<Array<{ about: string; by: string }>> {
    const { rows } = await this.pool.query(
      `select about, closed_by from ledger_claims where program_id=$1 and superseded_by is null and source = any($2)
       and status in ('closed','weak') and split_part(about,'#',1) not in (select id from ledger_elements where program_id=$1 and not dropped)`,
      [this.programId, [...ATTRIBUTED]]);
    return rows.map((r) => ({ about: r.about as string, by: (r.closed_by as { by?: string } | null)?.by ?? "?" }));
  }

  /** Bulk-persist an in-memory migrated store as the bootstrap (Option A) / initial load. */
  async persistFrom(mem: LedgerStore): Promise<{ elements: number; claims: number }> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      // set intent first so BOTH the element and claim bootstrap inserts are audited
      await c.query("select set_config('aura.intent', $1, true)", [JSON.stringify({ action_type: "ledger.bootstrap", affected_kind: "claim", actor: this.actor })]);
      for (const e of mem.elements()) await c.query("insert into ledger_elements (id,program_id,kind,name,of,refs) values ($1,$2,$3,$4,$5,$6) on conflict (program_id,id) do nothing", [e.id, this.programId, e.kind, e.name, e.of ?? null, JSON.stringify(e.refs ?? {})]);
      // insert claims WITHOUT re-running precedence (the mem store already resolved it)
      for (const cl of mem.claims()) {
        await c.query(
          `insert into ledger_claims (id,program_id,about,world,source,status,layer,value,owner,superseded_by,closed_by,contradicts,escalate_to,blocked_reason)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (program_id,id) do nothing`,
          [cl.id, this.programId, cl.about, cl.world, cl.source, cl.status, cl.layer, JSON.stringify(cl.value), JSON.stringify(cl.ownerWhileOpen),
           cl.supersededBy ?? null, cl.closedBy ? JSON.stringify(cl.closedBy) : null, cl.contradicts ?? [], cl.escalateTo ?? null, cl.blockedReason ?? null]);
      }
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    return { elements: mem.elements().length, claims: mem.claims().length };
  }

  /** Load the stored ledger into a read model the existing sync projections consume. */
  async loadReadModel(): Promise<LedgerStore> {
    const els = (await this.pool.query("select * from ledger_elements where program_id=$1 and not dropped", [this.programId])).rows
      .map((e) => ({ id: e.id, kind: e.kind, name: e.name, of: e.of ?? undefined, refs: e.refs } as LedgerElement));
    const cls = (await this.pool.query("select * from ledger_claims where program_id=$1", [this.programId])).rows.map(rowToClaim);
    return buildReadModel(els, cls);
  }
}

/** Re-exported for the server harnesses that build read models next to a PgLedger. */
export { buildReadModel } from "./readModel";

export const liveOnly = (cs: Claim[]): Claim[] => cs.filter(isLive);
