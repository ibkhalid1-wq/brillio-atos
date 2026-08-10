/**
 * Artifact asks — the dictionary ask, PREVENTIVE by default, remedial fallback.
 *
 * One ask PER SYSTEM OF RECORD, born the moment the SoR is named (naming a SoR and
 * creating its artifact ask are one act — the ask EXISTS by derivation, no write
 * needed). It is projected, one item one count, to: the Frame readiness check, the
 * Discover card, the kit artifact-ask section, and the operator inbox — which shows
 * it only while unprovided (self-clearing on import).
 *
 * States (honest, never fabricated):
 *  · unrequested — SoR named, nothing done yet. A Frame-incomplete signal.
 *  · requested   — operator asked the system owner (persisted, aged from that moment
 *                  — the same operator-tracked ageing rule as people).
 *  · provided    — a dictionary is on file and no typing question remains for this SoR.
 *  · reopened    — a dictionary is on file but typing questions (re)accumulated —
 *                  ontology growth after import attaches HERE, never a second ask.
 *  · has-none    — the operator explicitly recorded the SoR has no dictionary.
 *
 * Owner: the SoR's system owner from the roster (one shared detection), else null —
 * rendered as TBC, never fabricated. Weight: the open typing questions this artifact
 * would close; Σ weights + the unattributed bucket === the dictionary bucket
 * (conservation, asserted in tests).
 *
 * Read-model only; the persisted marks ride the same fingerprint-safe underscore
 * field pattern as the data dictionary itself.
 */
import type { LedgerStore } from "./store";
import { elementIdOf, isLive } from "./types";
import { buildUnknownQueue, dictionaryBucket } from "./projections";

export type ArtifactAskState = "unrequested" | "requested" | "provided" | "reopened" | "has-none";

/** A persisted operator mark on a SoR's ask (underscore-field `_artifactAsks`). */
export interface ArtifactAskMark { sor: string; mark: "requested" | "has-none"; by?: string; at: string; }

export interface ArtifactAsk {
  sor: string;                 // the system of record, verbatim from the data
  state: ArtifactAskState;
  owner: string | null;        // system-owner label from the roster, or null → renders TBC
  ownerRole: string | null;
  weight: number;              // open typing questions this artifact would close
  abouts: string[];            // the loci behind the weight (the one count, traceable)
  entityCount: number;         // entities recorded against this SoR
  requestedAt: string | null;  // ageing anchor — set only by the explicit request mark
}

export interface ArtifactAskView {
  asks: ArtifactAsk[];
  /** Typing questions whose element has NO named SoR — a Frame gap, not an ask. */
  unattributed: { weight: number; abouts: string[] };
  /** Frame completeness: every named SoR is provided / requested / has-none. */
  frameComplete: boolean;
}

/** The ONE system-owner detection, shared by every surface that names the owner. */
export const isSystemOwner = (label: string, role: string): boolean =>
  /\b(it|ehr|emr|system|systems|admin|data|platform|technolog|salesforce|crm)\b/i.test(`${label} ${role}`);

/**
 * Derive the artifact asks from the ledger + roster + persisted marks.
 * `dictionaryName` is the currently-imported dictionary (null when none).
 */
export function deriveArtifactAsks(
  store: LedgerStore,
  opts: {
    roster?: ReadonlyArray<{ label: string; role: string }>;
    marks?: ReadonlyArray<ArtifactAskMark>;
    dictionaryName?: string | null;
  } = {},
): ArtifactAskView {
  const { roster = [], marks = [], dictionaryName = null } = opts;

  // ── SoR per entity, from the RESOLVED live claim (asserted beats generated) ──
  const sorByEntity = new Map<string, string>();
  const entityCountBySor = new Map<string, number>();
  for (const c of store.claims()) {
    if (!isLive(c) || !c.about.endsWith("#systemOfRecord")) continue;
    const eid = elementIdOf(c.about);
    if (sorByEntity.has(eid)) continue;
    // the LIVE resolution for this locus (precedence already applied by the store)
    const live = store.resolve(c.about).live.find((lc) => lc.value.kind === "scalar");
    const v = live ? String((live.value as { value: unknown }).value).trim() : "";
    if (!v) continue;
    sorByEntity.set(eid, v);
    entityCountBySor.set(v, (entityCountBySor.get(v) ?? 0) + 1);
  }

  // ── attribute → parent entity, so a typing locus finds its SoR ──
  const parentOf = new Map(store.elements().map((e) => [e.id, e.of ?? null] as const));
  const sorOfElement = (id: string): string | null => {
    let cur: string | null = id;
    for (let hops = 0; cur && hops < 4; hops += 1) {
      const sor = sorByEntity.get(cur);
      if (sor) return sor;
      cur = parentOf.get(cur) ?? null;
    }
    return null;
  };

  // ── the dictionary bucket, split by SoR (Σ = the bucket; nothing vanishes) ──
  const typing = dictionaryBucket(buildUnknownQueue(store));
  const aboutsBySor = new Map<string, string[]>();
  const unattributed: string[] = [];
  for (const it of typing) {
    const sor = sorOfElement(elementIdOf(it.about));
    if (sor) (aboutsBySor.get(sor) ?? aboutsBySor.set(sor, []).get(sor)!).push(it.about);
    else unattributed.push(it.about);
  }

  // ── one shared owner detection ──
  const systemOwner = roster.find((r) => isSystemOwner(r.label, r.role)) ?? null;
  const markBySor = new Map(marks.map((m) => [m.sor.trim().toLowerCase(), m] as const));

  const asks: ArtifactAsk[] = [...entityCountBySor.entries()].map(([sor, entityCount]) => {
    const abouts = aboutsBySor.get(sor) ?? [];
    const mark = markBySor.get(sor.trim().toLowerCase());
    const state: ArtifactAskState =
      mark?.mark === "has-none" ? "has-none"
        : dictionaryName ? (abouts.length ? "reopened" : "provided")
          : mark?.mark === "requested" ? "requested"
            : "unrequested";
    return {
      sor, state,
      owner: systemOwner?.label ?? null,
      ownerRole: systemOwner?.role ?? null,
      weight: abouts.length, abouts, entityCount,
      requestedAt: mark?.mark === "requested" ? mark.at : null,
    };
  }).sort((a, b) => b.weight - a.weight || a.sor.localeCompare(b.sor));

  const frameComplete = asks.every((a) => a.state !== "unrequested");
  return { asks, unattributed: { weight: unattributed.length, abouts: unattributed }, frameComplete };
}

/** The inbox shows an ask ONLY while unprovided and carrying weight (self-clearing). */
export const asksNeedingChase = (view: ArtifactAskView): ArtifactAsk[] =>
  view.asks.filter((a) => (a.state === "unrequested" || a.state === "requested" || a.state === "reopened") && a.weight > 0);

/**
 * The FRAME-side readiness check, pure over the committed ontology doc (no store) —
 * naming a SoR and creating its ask are one act, so a named SoR with the ask neither
 * provided, requested, nor marked has-none is an INCOMPLETE Frame item. Used by the
 * Frame gate checklist; the ledger derivation above is the full view (they agree —
 * asserted in tests).
 */
export function frameSorReadiness(
  ontology: unknown,
  marks: ReadonlyArray<ArtifactAskMark>,
  dictionaryProvided: boolean,
): { named: string[]; unhandled: string[]; complete: boolean } {
  const entities = ontology && typeof ontology === "object" && Array.isArray((ontology as { entities?: unknown }).entities)
    ? ((ontology as { entities: unknown[] }).entities) : [];
  const named = [...new Set(entities
    .map((e) => String((e as { systemOfRecord?: unknown })?.systemOfRecord ?? "").trim())
    .filter(Boolean))].sort();
  const marked = new Set(marks.map((m) => m.sor.trim().toLowerCase()));
  const unhandled = dictionaryProvided ? [] : named.filter((sor) => !marked.has(sor.trim().toLowerCase()));
  return { named, unhandled, complete: unhandled.length === 0 };
}
