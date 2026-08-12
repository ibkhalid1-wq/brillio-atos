/**
 * Artifact asks — the dictionary ask, PREVENTIVE by default, remedial fallback.
 *
 * One ask PER SYSTEM OF RECORD, born the moment the SoR is named (naming a SoR and
 * creating its artifact ask are one act — the ask EXISTS by derivation, no write
 * needed). It is projected, one item one count, to: the Frame readiness check, the
 * Discover card, the kit artifact-ask section, and the operator inbox — which shows
 * it only while unprovided (self-clearing on import).
 *
 * A SoR is named on either of TWO surfaces, and one system is never two asks:
 *  · the SPONSOR's Frame input `systemsOfRecord` (`parseDeclaredSors`) — so the ask
 *    is born at Frame time, before any ontology exists, which is when the dictionary
 *    is cheapest to ask for;
 *  · the ontology's `entities[].systemOfRecord`, generated in Listen.
 * They merge CASE-INSENSITIVELY, the modelled spelling winning where both hold it
 * (it is the one the entity claims carry). `ask.source` says which — never inferred.
 *
 * States (honest, never fabricated):
 *  · unrequested — SoR named, nothing done yet. A Frame-incomplete signal.
 *  · requested   — operator asked the system owner (persisted, aged from that moment
 *                  — the same operator-tracked ageing rule as people).
 *  · provided    — a dictionary is on file and no typing question remains for this SoR.
 *  · reopened    — a dictionary is on file but typing questions (re)accumulated —
 *                  ontology growth after import attaches HERE, never a second ask.
 *  · complete    — a dictionary is on file and the operator recorded that it is ALL
 *                  the system has. The remaining typing questions stay OPEN and stay
 *                  counted; they simply stop being chased as a dictionary ask,
 *                  because no further upload is coming. Only meaningful with a
 *                  dictionary on file — the mark is ignored without one, since
 *                  "that is all of it" says nothing about a system that gave none.
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

export type ArtifactAskState = "unrequested" | "requested" | "provided" | "reopened" | "complete" | "has-none";

/** A persisted operator mark on a SoR's ask (underscore-field `_artifactAsks`). */
export interface ArtifactAskMark { sor: string; mark: "requested" | "has-none" | "complete"; by?: string; at: string; }

export interface ArtifactAsk {
  sor: string;                 // the system of record, verbatim from the data
  state: ArtifactAskState;
  owner: string | null;        // system-owner label from the roster, or null → renders TBC
  ownerRole: string | null;
  weight: number;              // open typing questions this artifact would close
  abouts: string[];            // the loci behind the weight (the one count, traceable)
  entityCount: number;         // entities recorded against this SoR
  requestedAt: string | null;  // ageing anchor — set only by the explicit request mark
  /** The dictionary satisfying THIS ask — its own upload if it has one, else the
   *  programme-wide one, else null. Named so a surface can say which file answered. */
  dictionary: string | null;
  /** True when the dictionary on file is this SoR's OWN, not the global upload. */
  ownDictionary: boolean;
  /** Where the SoR was named. `frame` = the sponsor's Frame input only (no ontology
   *  models it yet — the ask is born at Frame time); `ontology` = entities carry it;
   *  `both` = the sponsor named it AND the model holds it. Never inferred. */
  source: "frame" | "ontology" | "both";
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
 * The ONE parse of the Frame "systems of record" input — the field where a sponsor
 * NAMES the systems, before any ontology exists. Free text, one per line or
 * separated by commas/semicolons; list bullets tolerated. Deduped CASE-INSENSITIVELY
 * (first spelling wins) because two spellings of one system would otherwise mint two
 * asks, and one-ask-per-SoR is the invariant this whole model rests on.
 */
export const parseDeclaredSors = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const name = part.replace(/^[\s\-•*•]+/, "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

/**
 * Derive the artifact asks from the ledger + roster + persisted marks.
 * `dictionaryName` is the currently-imported dictionary (null when none).
 */
export function deriveArtifactAsks(
  store: LedgerStore,
  opts: {
    roster?: ReadonlyArray<{ label: string; role: string }>;
    marks?: ReadonlyArray<ArtifactAskMark>;
    /** The PROGRAMME-WIDE dictionary (the un-keyed upload), null when there is none. */
    dictionaryName?: string | null;
    /** Systems of record the SPONSOR named in Frame (`parseDeclaredSors` of the
     *  Frame input). An ask is born here too, before any ontology exists — naming
     *  a SoR and creating its ask are one act whichever surface the name arrives on. */
    declaredSors?: readonly string[];
    /** Per-SoR dictionaries on file: lowercased SoR → the dictionary's name. Each ask
     *  is satisfied by ITS OWN upload; one system's dictionary never answers another's. */
    dictionaryBySor?: ReadonlyMap<string, string>;
  } = {},
): ArtifactAskView {
  const {
    roster = [], marks = [], dictionaryName = null, declaredSors = [],
    dictionaryBySor = new Map<string, string>(),
  } = opts;

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

  // ── the SoR set: the ontology's + the sponsor's Frame declaration, merged
  //    CASE-INSENSITIVELY so one system can never become two asks. The MODELLED
  //    spelling wins where both exist — it is the one the entity claims carry, and
  //    the weight/entityCount hang off it. ──
  const bySor = new Map<string, { sor: string; entityCount: number; source: ArtifactAsk["source"] }>();
  for (const [sor, entityCount] of entityCountBySor) {
    bySor.set(sor.trim().toLowerCase(), { sor, entityCount, source: "ontology" });
  }
  for (const declared of declaredSors) {
    const key = declared.trim().toLowerCase();
    if (!key) continue;
    const held = bySor.get(key);
    if (held) held.source = "both";
    else bySor.set(key, { sor: declared.trim(), entityCount: 0, source: "frame" });
  }

  const asks: ArtifactAsk[] = [...bySor.values()].map(({ sor, entityCount, source }) => {
    const key = sor.trim().toLowerCase();
    const abouts = aboutsBySor.get(sor) ?? [];
    const mark = markBySor.get(key);
    // THIS SoR's own dictionary answers it; the programme-wide upload answers it only
    // because it claims to cover everything. A CRM export says nothing about the
    // finance system, so an ask is never marked provided by another SoR's file.
    const own = dictionaryBySor.get(key) ?? null;
    const dictionary = own ?? dictionaryName;
    const state: ArtifactAskState =
      mark?.mark === "has-none" ? "has-none"
        // `complete` needs a dictionary to be about. Without one it is not a
        // statement anybody can act on, so the ask falls through to its real state
        // rather than being silently settled by a mark that describes nothing.
        : dictionary && mark?.mark === "complete" ? "complete"
          : dictionary ? (abouts.length ? "reopened" : "provided")
            : mark?.mark === "requested" ? "requested"
              : "unrequested";
    return {
      sor, state,
      owner: systemOwner?.label ?? null,
      ownerRole: systemOwner?.role ?? null,
      weight: abouts.length, abouts, entityCount,
      requestedAt: mark?.mark === "requested" ? mark.at : null,
      source, dictionary, ownDictionary: !!own,
    };
  }).sort((a, b) => b.weight - a.weight || a.sor.localeCompare(b.sor));

  const frameComplete = asks.every((a) => a.state !== "unrequested");
  return { asks, unattributed: { weight: unattributed.length, abouts: unattributed }, frameComplete };
}

/**
 * The inbox shows an ask ONLY while unprovided and carrying weight (self-clearing) —
 * PLUS the Frame-time case: a SoR the sponsor named that no entity models yet has
 * nothing to weigh, and dropping it would make the preventive ask invisible exactly
 * when it is cheapest to satisfy. Weight 0 with entities modelled means there is
 * genuinely nothing left for a dictionary to close: no chase.
 */
/**
 * The asks still worth chasing. `provided`, `has-none` and `complete` are settled —
 * each for a different reason, and `complete` is the one an operator chooses: a
 * dictionary arrived, it was not exhaustive, and there is no more coming.
 *
 * A settled ask keeps its WEIGHT and stays in `view.asks`, so conservation is
 * untouched and its open questions remain in the burn-down. Settling stops the
 * chase, never the count.
 */
export const asksNeedingChase = (view: ArtifactAskView): ArtifactAsk[] =>
  view.asks.filter((a) => (a.state === "unrequested" || a.state === "requested" || a.state === "reopened")
    && (a.weight > 0 || a.entityCount === 0));

/**
 * The FRAME-side readiness check, pure over the sponsor's declaration + the committed
 * ontology doc (no store) — naming a SoR and creating its ask are one act, so a named
 * SoR with the ask neither provided, requested, nor marked has-none is an INCOMPLETE
 * Frame item. Used by the Frame gate checklist; the ledger derivation above is the
 * full view (they agree — asserted in tests).
 *
 * `declared` is the Frame input where the sponsor NAMES the systems, so the ask can
 * be born at Frame time — before any ontology exists. `providedSors` are the systems
 * with their OWN dictionary on file. Both optional and last, so the callers that
 * predate them are unchanged.
 *
 * `dictionaryProvided` is the PROGRAMME-WIDE upload — the one that claims to cover
 * everything. A per-SoR dictionary handles only its own system.
 */
export function frameSorReadiness(
  ontology: unknown,
  marks: ReadonlyArray<ArtifactAskMark>,
  dictionaryProvided: boolean,
  declared: readonly string[] = [],
  providedSors: readonly string[] = [],
): { named: string[]; unhandled: string[]; complete: boolean; fromFrame: string[]; fromOntology: string[] } {
  const entities = ontology && typeof ontology === "object" && Array.isArray((ontology as { entities?: unknown }).entities)
    ? ((ontology as { entities: unknown[] }).entities) : [];
  const fromOntology = [...new Set(entities
    .map((e) => String((e as { systemOfRecord?: unknown })?.systemOfRecord ?? "").trim())
    .filter(Boolean))].sort();
  const fromFrame = declared.map((s) => s.trim()).filter(Boolean);
  // ONE name per system: merged case-insensitively, the modelled spelling winning
  // where both exist — the same rule deriveArtifactAsks applies, so the gate item
  // and the inbox can never disagree about how many systems there are.
  const byKey = new Map<string, string>();
  for (const sor of fromOntology) byKey.set(sor.toLowerCase(), sor);
  for (const sor of fromFrame) if (!byKey.has(sor.toLowerCase())) byKey.set(sor.toLowerCase(), sor);
  const named = [...byKey.values()].sort();
  const marked = new Set(marks.map((m) => m.sor.trim().toLowerCase()));
  const provided = new Set(providedSors.map((s) => s.trim().toLowerCase()));
  const unhandled = dictionaryProvided ? []
    : named.filter((sor) => !marked.has(sor.trim().toLowerCase()) && !provided.has(sor.trim().toLowerCase()));
  return { named, unhandled, complete: unhandled.length === 0, fromFrame, fromOntology };
}
