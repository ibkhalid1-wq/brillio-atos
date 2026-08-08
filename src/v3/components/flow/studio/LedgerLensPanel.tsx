/**
 * Ledger lens (Phase 4 demonstration surface). Runs the migration on THIS program's
 * committed artifacts on the fly (read-only — never writes; persistence is gated) and
 * renders the ledger projections with the new claim primitives. This is where the
 * primitives get exercised against migrated Laila data for the visual pass.
 *
 * The live swimlane/kit keep their existing data path — swapping them to the ledger
 * needs persistence for write-back (gated). Listed as a migration remainder.
 */
import { useMemo } from "react";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { migrate, migrationStats, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, buildKitView, buildDeviationRegister, type SlotState } from "@/v3/lib/ledger/projections";
import { ClaimStatus, SourceTag, ContradictionBadge, BandTag, DeviationMarker } from "./ledgerPrimitives";
import type { ProgramSummary } from "@/new/types";

const STATES: SlotState[] = ["closed", "weak", "open", "blocked", "n/a", "conflict"];
const SOURCES = ["asserted", "document", "external-standard", "code-derived", "generated", "regulation"];

export default function LedgerLensPanel({ program }: { program?: ProgramSummary }) {
  const store = useMemo(() => {
    const inner = (((program?.rawData as { data?: Record<string, unknown> } | undefined)?.data) ?? {}) as Record<string, unknown>;
    const overrides = Array.isArray(inner.flowOperatorOverrides) ? inner.flowOperatorOverrides as Array<Record<string, unknown>> : [];
    const snap: Snapshot = {
      ontology: (program ? (readArtifactDoc(program, "domainOntology") as Record<string, unknown>) : {}) ?? {},
      atlas: (program ? (readArtifactDoc(program, "currentStateAtlas") as Record<string, unknown>) : {}) ?? {},
      overrides,
    };
    return migrate(snap);
  }, [program]);

  const stats = useMemo(() => migrationStats(store), [store]);
  const queue = useMemo(() => buildUnknownQueue(store), [store]);
  const kit = useMemo(() => buildKitView(store), [store]);
  const devs = useMemo(() => buildDeviationRegister(store), [store]);

  return (
    <div className="v3lc" data-mv="listen">
      <p className="v3lc-intro">
        One claims ledger, migrated from this engagement&apos;s artifacts on the fly (read-only).
        Every slot is a claim with its own certainty, world, source and owner — an unknown is a first-class
        object, not an omission. <b>{stats.claims}</b> claims · <b>{stats.openUnknowns}</b> open unknowns ·
        <b> {stats.weak}</b> weak · <b>{stats.unresolvedRefs}</b> unresolved refs · <b>{stats.byWorld["as-is"] ?? 0}</b> as-is /
        <b> {stats.byWorld["to-be"] ?? 0}</b> to-be.
      </p>

      {/* burn-down */}
      <div className="v3lc-burn" role="img" aria-label={`burn-down: ${kit.burnDown.pctClosed}% of claims closed or weak`}>
        <div className="v3lc-burn-bar"><span style={{ width: `${kit.burnDown.pctClosed}%` }} /></div>
        <span className="v3lc-burn-l">{kit.burnDown.closed} closed/weak · {kit.burnDown.open} open · <b>{kit.burnDown.pctClosed}%</b></span>
      </div>

      {/* primitive showcase — each in its states, for the visual pass */}
      <section className="v3lc-card">
        <h4>Claim status <span className="v3lc-sub">— shape + text, never colour alone; ● closed vs ◐ weak is the key distinction</span></h4>
        <div className="v3lc-row">{STATES.map((s) => <ClaimStatus key={s} state={s} />)}</div>
        <h4>Source class <span className="v3lc-sub">— dashed = a strong default awaiting confirmation (export / standard / generated)</span></h4>
        <div className="v3lc-row">{SOURCES.map((s) => <SourceTag key={s} source={s} />)}</div>
        <h4>Contradiction <span className="v3lc-sub">— a routable item, not an error</span></h4>
        <div className="v3lc-row">
          <ContradictionBadge count={2} />
          <ContradictionBadge count={2} escalate="slot-owner" />
          <ContradictionBadge count={2} escalate="legal-compliance" />
        </div>
        <h4>Deviation <span className="v3lc-sub">— deliberate vs unbacked</span></h4>
        <div className="v3lc-row">
          <DeviationMarker classification="document-backed" />
          <DeviationMarker classification="unbacked" />
          <DeviationMarker classification="unbacked" stillReferenced />
        </div>
      </section>

      {/* kit bands — function, seam (joint), unowned */}
      <section className="v3lc-card">
        <h4>Unknowns by owner <span className="v3lc-sub">— seams as joint bands; unowned pinned and loud</span></h4>
        <div className="v3lc-bands">
          {kit.bands.slice(0, 10).map((b) => (
            <div key={b.key} className={`v3lc-band-row is-${b.kind}`}>
              <BandTag kind={b.kind} label={b.label} />
              <span className="v3lc-band-nums">
                {b.blocking > 0 ? <span className="v3lc-chip is-block">{b.blocking} blocking</span> : null}
                <span className="v3lc-chip">{b.open} open</span>
                <span className="v3lc-chip is-heard">{b.heard} heard</span>
              </span>
            </div>
          ))}
        </div>
        <div className="v3lc-qcounts">
          queue: <b>{queue.counts.blocking}</b> blocking · {queue.counts["answerable-without-a-meeting"]} answerable-without-a-meeting ·
          {" "}{queue.counts.blocked} blocked · {queue.counts.unowned} unowned
        </div>
      </section>

      {/* deviation register — real removed-while-referenced cases */}
      <section className="v3lc-card">
        <h4>Deviation register <span className="v3lc-sub">— as-is vs to-be on one locus</span></h4>
        {devs.length === 0 ? <p className="v3lc-empty">No world deviations — this engagement has no imported as-is facts yet.</p> : (
          <ul className="v3lc-devs">
            {devs.map((d) => (
              <li key={d.about}>
                <code>{d.about.replace(/^el:/, "")}</code>
                <span className="v3lc-dev-vals">{d.asIs} <span aria-hidden="true">→</span> {d.toBe}</span>
                <DeviationMarker classification={d.classification} stillReferenced={d.stillReferenced} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
