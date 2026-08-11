/**
 * The Design Loop as a LEDGER SURFACE — three ownership zones keyed to source
 * class, replacing the old "four artifact cards with needs-refresh buttons over a
 * 0-of-10-converged counter".
 *
 * The ledger already encodes who-does-what by SOURCE CLASS; this surface reads it
 * rather than inventing a taxonomy:
 *   · Operator builds it   — decision/dispositioned (Architecture, Blueprint,
 *     Prototype generation). Decided-with-basis, not refreshable blobs. A
 *     stakeholder can QUESTION a decision (routes as a proposal naming the owning
 *     role) but can't edit.
 *   · Stakeholders shape it — asserted (Validation sign-off = the loop's GOAL
 *     state, promoted out of the footer; answering owned unknowns = the queue).
 *   · Joint                — a locus with both (Experience Design as intent-
 *     asserted vs design-rendered, the deviation register between them; Prototype
 *     refinement, where a stakeholder assertion wins over operator regeneration).
 *
 * HONESTY: read-only in-browser migrate. Stakeholder `asserted` closures arrive
 * through the store write path, not wired here — so the "stakeholders shape it"
 * zone reads 0 assertions today. That 0 is the truth of the read model, marked
 * provisional/gated, NEVER dressed up as convergence the ledger doesn't have.
 */
import { useMemo, useState } from "react";
import type { LineBand, LineStation } from "@/v3/lib/lineModel";
import type { ArtifactCardModel } from "@/v3/components/flow/flowShellData";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import type { Routing } from "@/v3/lib/ledger/projections";
import {
  OwnershipTag, HeardReadout, ConvergenceReadout, ProvisionalMark,
  ClaimStatus, SourceTag, DeviationMarker,
} from "@/v3/components/flow/studio/ledgerPrimitives";

interface Props {
  band: LineBand;
  ledger: ProgramLedger;
  onOpen: (card: ArtifactCardModel, section?: string) => void;
  onRegen?: (card: ArtifactCardModel) => void;
  onGenerate?: (card: ArtifactCardModel) => void;
  regenBusy: Record<string, boolean>;
  genBusy: Record<string, boolean>;
  /* NO `onQuestion`. A stakeholder QUESTIONS an operator decision, and a stakeholder is
   * not who is standing here: this is the operator's own board. The prop existed, took a
   * `(station, owningRole)` callback and drew a "? question → {role}" button — and
   * TheLine, its only caller, never passed it, so the button could not be reached in the
   * running app and the branch below always fell to the note. The capture genuinely lives
   * on the stakeholder's link (FlowRespond); routing one from here would need an operator
   * write the read-only migrate does not have. So the tile states the routing as FACT —
   * "questionable → routes to {role}" — which is true, instead of offering a verb this
   * surface cannot perform. Guarded by designLoopZonesProps.test.ts. */
}

/** Which zone each loop station belongs to, and (for the operator zone) the role
 *  a question routes to — the ledger's owner for that class of decision. */
const ZONE_OF: Record<string, { zone: "operator" | "stakeholder" | "joint"; role?: string }> = {
  "architecture-strategy": { zone: "operator", role: "Architect" },
  "agentic-blueprint": { zone: "operator", role: "Architect" },
  prototype: { zone: "operator", role: "Design team" },
  validation: { zone: "stakeholder" },
  "experience-design": { zone: "joint", role: "Design team" },
};

/** One operator-built artifact: decided-with-basis, not a refreshable blob. No
 *  "needs refresh" — its state reads as present/draft + ownership, and a
 *  stakeholder may question it (routes, never edits). */
function OperatorTile({ station, role, onOpen, onRegen, onGenerate, regenerating, generating }: {
  station: LineStation; role: string;
  onOpen: Props["onOpen"]; onRegen?: Props["onRegen"]; onGenerate?: Props["onGenerate"];
  regenerating: boolean; generating: boolean;
}) {
  const present = !!station.card?.present;
  const canGen = !present && !!station.canGenerate && !!station.card && !!onGenerate;
  const evidenceMoved = present && station.needsRefresh; // was "needs refresh"
  return (
    <div className={`v3dl-tile${present ? " present" : ""}`}>
      <button type="button" className="v3dl-tile-open" disabled={!present && !canGen}
        title={present ? `Open ${station.title}` : canGen ? `Generate ${station.title} — its inputs are ready` : `${station.title} — not built yet`}
        onClick={() => { if (present && station.card) onOpen(station.card); else if (canGen && !generating) onGenerate!(station.card!); }}>
        <span className="v3dl-tile-h">
          <span className="v3dl-tile-n">{station.title}</span>
          <OwnershipTag cls="operator" showLabel={false} />
        </span>
        <span className="v3dl-tile-sub">{station.subtitle}</span>
        {/* claim state replaces "needs refresh": present decisions read decided;
            an unbuilt tile reads its readiness; a moved-evidence tile names what
            actually changed (the claims under it), never "refresh". */}
        <span className="v3dl-tile-state">
          {present ? (
            evidenceMoved ? (
              <span className="v3dl-moved" title="the claims this decision rests on have moved — rebuild to re-ground it">
                <ClaimStatus state="weak" /> evidence moved underneath
              </span>
            ) : (
              <span className="v3dl-decided"><ClaimStatus state="closed" showLabel={false} /> decided, on record</span>
            )
          ) : canGen ? (
            <span className="v3dl-ready"><ClaimStatus state="open" showLabel={false} /> inputs ready — generate</span>
          ) : (
            <span className="v3dl-notseeded"><ClaimStatus state="open" showLabel={false} /> upstream not ready</span>
          )}
        </span>
        {station.sections?.length ? (
          <span className="v3dl-secs">{station.sections.map((s) => <span key={s.key} className="v3dl-sec">{s.label}</span>)}</span>
        ) : null}
      </button>
      <div className="v3dl-tile-foot">
        {present && onRegen && station.card ? (
          <button type="button" className="v3dl-mini" disabled={regenerating}
            onClick={() => onRegen!(station.card!)}
            aria-label={`Rebuild ${station.title} from the current claims`}
            title="Rebuild this from the current claims (a decision is re-derived from the claims, not a blob refreshed)">
            {regenerating ? "rebuilding…" : <><span aria-hidden="true">↻ </span>rebuild from claims</>}
          </button>
        ) : null}
        {/* stakeholders question-but-don't-edit. A STATEMENT, not a control: the person
            who may question this is the stakeholder, on their own link — see Props. */}
        <span className="v3dl-question" title={`A stakeholder can question this decision — it routes to ${role} as a proposal, and never edits the artifact. The capture lives on their link.`}>
          <span className="v3dl-question-note">questionable<span aria-hidden="true"> → </span>routes to {role}</span>
        </span>
      </div>
    </div>
  );
}

export default function DesignLoopZones({ band, ledger, onOpen, onRegen, onGenerate, regenBusy, genBusy }: Props) {
  const stationOf = (id: string) => band.stations.find((s) => s.id === id);
  const opStations = band.stations.filter((s) => ZONE_OF[s.id]?.zone === "operator");
  const validation = stationOf("validation");
  const experience = stationOf("experience-design");
  const proto = stationOf("prototype");

  // stakeholder queue: open unknowns owned by a role (not unowned/blocked) — the
  // discovery-kit questions a stakeholder answers. Assertions on record = the
  // honest heard-count (0 stakeholder asserts in the read-only model).
  const stakeholderOpen = ledger.queue.counts.blocking + ledger.queue.counts["answerable-without-a-meeting"];
  const stakeholderAsserts = ledger.ownership.stakeholder; // 0 in-browser (write path gated)

  // ── the stakeholder queue as a WORK QUEUE — each headline number drills through
  // to the questions it counts (not a dead affordance). "owned" = blocking+answerable
  // (the role-owned open set); each segment filters to its routing set. Filtered off
  // the one queue projection, phrased plain-language. ──
  const [drill, setDrill] = useState<null | "owned" | Routing>(null);
  const drillItems = useMemo(() => {
    if (!drill) return [];
    const match = (r: Routing) => drill === "owned" ? (r === "blocking" || r === "answerable-without-a-meeting") : r === drill;
    return ledger.queue.items.filter((i) => match(i.routing) && i.owner.kind === "role")
      .map((i) => { const r = renderQuestion(ledger.store, i.about, "operator"); return { ...i, question: r.question, typeTag: r.label, name: r.elementName }; });
  }, [drill, ledger.queue.items, ledger.store]);
  const DrillBtn = ({ k, n, label }: { k: "owned" | Routing; n: number; label: string }) => (
    <button type="button" className={`v3dl-drillbtn${drill === k ? " on" : ""}`} aria-pressed={drill === k}
      disabled={n === 0}
      title={n === 0 ? `No ${label} questions` : `Show the ${n} ${label} question${n === 1 ? "" : "s"}`}
      onClick={() => setDrill(drill === k ? null : k)}>
      <b>{n}</b> {label}{n > 0 ? <span className="v3dl-drillchev" aria-hidden="true">{drill === k ? " ▴" : " ▾"}</span> : null}
    </button>
  );

  return (
    <div className="v3dl">
      {/* convergence promoted to the header — real closures, not a 0-of-10 counter */}
      <div className="v3dl-head">
        <div className="v3dl-conv">
          <span className="v3dl-conv-lbl">Convergence</span>
          <ConvergenceReadout burnDown={ledger.kit.burnDown} />
        </div>
        <div className="v3dl-conv">
          <span className="v3dl-conv-lbl">Heard</span>
          <HeardReadout heard={ledger.heard} />
        </div>
      </div>

      {/* ZONE 1 — operator builds it */}
      <section className="v3dl-zone is-operator" aria-label="Operator builds it">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="operator" />
          <span className="v3dl-zone-t">Operator builds it</span>
          <span className="v3dl-zone-d">decided with basis — Architecture, Blueprint, Prototype. Questionable, not editable.</span>
        </header>
        <div className="v3dl-tiles">
          {opStations.map((s) => (
            <OperatorTile key={s.id} station={s} role={ZONE_OF[s.id]?.role ?? "Design team"}
              onOpen={onOpen} onRegen={onRegen} onGenerate={onGenerate}
              regenerating={!!(s.card && regenBusy[s.card.id])} generating={!!(s.card && genBusy[s.card.id])} />
          ))}
        </div>
      </section>

      {/* ZONE 2 — stakeholders shape it (Validation = the goal state) */}
      <section className="v3dl-zone is-stakeholder" aria-label="Stakeholders shape it">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="stakeholder" />
          <span className="v3dl-zone-t">Stakeholders shape it</span>
          <span className="v3dl-zone-d">Validation sign-off is the loop&apos;s goal state — and the owned questions they answer.</span>
        </header>
        <div className="v3dl-shape">
          <div className="v3dl-goal">
            <span className="v3dl-goal-t">Validation — the goal state</span>
            {validation?.card ? (
              <button type="button" className="v3dl-goal-open" onClick={() => onOpen(validation.card!)}
                title="Open Validation — per-stakeholder demo verdicts and sign-off">
                {validation.subtitle || "A demo for every heard voice; verdicts roll up per area"}
              </button>
            ) : <span className="v3dl-goal-sub">Not seeded — Validation appears once the prototype is built.</span>}
            <div className="v3dl-goal-nums">
              <span className="v3dl-goal-num"><b>{stakeholderAsserts}</b> stakeholder sign-offs on record</span>
              <ProvisionalMark what="per-area sign-off + assertion write path are gated on the model key + binder; 0 asserted in the read-only model" />
            </div>
          </div>
          <div className="v3dl-queue">
            <span className="v3dl-queue-t">Owned questions awaiting a stakeholder — a work queue, click to drill in</span>
            {/* THE work — each number drills to the questions it counts, filtered by
                that operator action. Not a dead affordance. */}
            <span className="v3dl-queue-n"><DrillBtn k="owned" n={stakeholderOpen} label="open unknowns owned by a role" /></span>
            <span className="v3dl-queue-sub">
              <ClaimStatus state="open" showLabel={false} />
              <DrillBtn k="blocking" n={ledger.queue.counts.blocking} label="blocking — gates the Architect" /> ·
              <DrillBtn k="answerable-without-a-meeting" n={ledger.queue.counts["answerable-without-a-meeting"]} label="answerable — send a link now" /> ·
              <DrillBtn k="blocked" n={ledger.queue.counts.blocked} label="blocked — needs unsticking" />
            </span>
            {drill ? (
              <ul className="v3dl-drilllist" aria-label={`${drill} questions`}>
                {drillItems.slice(0, 24).map((it) => (
                  <li key={it.about} title={it.about}>
                    <span className="v3dl-drill-type">{it.typeTag}</span>
                    <span className="v3dl-drill-q">{it.question}</span>
                    <span className="v3dl-drill-owner"><span aria-hidden="true">→ </span>owner: {it.ownerLabel}</span>
                  </li>
                ))}
                {drillItems.length > 24 ? <li className="v3dl-drill-more">+{drillItems.length - 24} more — work them in the Discover inbox</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {/* ZONE 3 — joint (Experience Design split + Prototype refinement) */}
      <section className="v3dl-zone is-joint" aria-label="Joint — operator and stakeholder">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="joint" />
          <span className="v3dl-zone-t">Joint — designed together</span>
          <span className="v3dl-zone-d">Experience Design as intent vs render, with the deviation register between them.</span>
        </header>
        <div className="v3dl-split">
          <div className="v3dl-split-col">
            <span className="v3dl-split-lbl"><OwnershipTag cls="stakeholder" showLabel={false} /> Intent — asserted</span>
            <p className="v3dl-split-body">What stakeholders said the experience must do. Asserted intent wins over a render that drifts from it.</p>
            <span className="v3dl-split-num"><b>{stakeholderAsserts}</b> asserted intents <ProvisionalMark what="intent assertions arrive on the stakeholder write path (gated)" /></span>
          </div>
          <div className="v3dl-devreg" aria-label="deviation register">
            <span className="v3dl-devreg-t">Deviation register</span>
            {ledger.devs.length ? (
              <ul className="v3dl-devlist">
                {ledger.devs.slice(0, 5).map((d) => (
                  <li key={d.about}>
                    <code>{d.about.replace(/^el:/, "")}</code>
                    <span className="v3dl-devvals">{d.asIs} <span aria-hidden="true">→</span> <span className="v3lc-sr">becomes </span>{d.toBe}</span>
                    <DeviationMarker classification={d.classification} stillReferenced={d.stillReferenced} />
                  </li>
                ))}
              </ul>
            ) : <p className="v3dl-devempty">No as-is → to-be deviations on record for this program.</p>}
          </div>
          <div className="v3dl-split-col">
            <span className="v3dl-split-lbl"><OwnershipTag cls="operator" showLabel={false} /> Render — designed</span>
            <p className="v3dl-split-body">What the Experience Design document actually renders. A render deviating from asserted intent shows up in the register.</p>
            {experience?.card ? (
              <button type="button" className="v3dl-mini" onClick={() => onOpen(experience.card!)}
                title="Open Experience Design">open Experience Design<span aria-hidden="true"> →</span></button>
            ) : <span className="v3dl-split-num"><ClaimStatus state="open" showLabel={false} /> not rendered yet</span>}
          </div>
        </div>
        <div className="v3dl-refine">
          <span className="v3dl-refine-t">Prototype refinement</span>
          <span className="v3dl-refine-body">
            A stakeholder&apos;s <SourceTag source="asserted" /> refinement wins over the operator&apos;s <SourceTag source="generated" /> regeneration —
            the ledger keeps the assertion, never the re-gen.
          </span>
          <span className="v3dl-refine-num">
            <b>{stakeholderAsserts}</b> stakeholder refinements · {proto?.card?.present ? "prototype built (generated)" : "prototype not built"}
            <ProvisionalMark what="refinement is a stakeholder assertion on the gated write path; all prototype content is generated today" />
          </span>
        </div>
      </section>
    </div>
  );
}
