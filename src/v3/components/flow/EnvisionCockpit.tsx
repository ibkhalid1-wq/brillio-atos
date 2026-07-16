/**
 * The Envision cockpit — the delivery team's build studio. It carries the
 * DIRECTION act (choose the architecture, recorded) plus the "Incoming from
 * Show" change-request tray. Direction is a SOLUTION-level decision owned by the
 * Design team, so it shows only when the Design-team tile is selected. The old
 * DESIGN and BUILD acts were removed — they duplicated the Experience Design and
 * Prototype artifact tabs, which carry the same content. Client validation
 * happens in SHOW, not here.
 */
import { useMemo, useState } from "react";
import { projectFutureState, type FutureState } from "@/v3/components/flow/flowFutureState";
import { loopState, changeRequests, type ChangeRequest } from "@/v3/components/flow/flowLoop";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { DESIGN_TEAM } from "@/v3/components/flow/ProductOwnerCockpit";
import type { ProgramSummary } from "@/new/types";

type ChangeRoute = "design" | "listen" | "frame";

export default function EnvisionCockpit({ program, areaFilter, onSaveInputs, onOpenArtifact }: {
  program: ProgramSummary;
  /** When provided, the phase-home area board controls the area filter — the
   * cockpit scopes its future-state to these areas (empty = all) and hides its
   * own "Filter by area" chip row so there's one filter, not two. */
  areaFilter?: string[];
  onSaveInputs?: (movementId: string, patch: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  /** Open one of the Design workspaces (Architecture · Experience · Prototype). */
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const fs = useMemo<FutureState>(() => projectFutureState(program), [program]);
  // The Direction accordion: null = auto-open until a direction is chosen; an
  // explicit "" collapses it.
  const [openAct, setOpenAct] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [tradeaway, setTradeaway] = useState("");
  const [recording, setRecording] = useState(false);
  const [iterating, setIterating] = useState(false);
  const [routed, setRouted] = useState<Record<string, ChangeRoute>>({});
  const ls = useMemo(() => loopState(program), [program]);
  const incoming = useMemo(() => changeRequests(program), [program]);
  const crKey = (cr: ChangeRequest) => `${cr.stakeholder}::${cr.ask}`;

  // Triage a change request. Not every "change" is a design fix: some tell us we
  // got the CLIENT'S WORLD wrong (a current-state correction → Listen, which then
  // cascades the ontology/workflows forward), and some are NEW REQUIREMENTS
  // (→ Frame's scope). Only design fixes are addressed by the rebuild here.
  const routeChange = async (cr: ChangeRequest, route: ChangeRoute) => {
    if (route !== "design" && onSaveInputs) {
      const note = `\n\n— ${cr.stakeholder} · from Show validation (iteration ${ls.round}) —\n${cr.ask || "(see their demo verdict)"}`;
      if (route === "listen") {
        const cur = String(readMovementInputs(program, "listen").interviewTranscripts ?? "");
        await onSaveInputs("listen", { interviewTranscripts: (cur + note).trimStart() },
          { attest: { action: `Current-state correction routed to Listen — ${cr.stakeholder}`, detail: cr.ask.slice(0, 140) } });
      } else {
        const cur = String(readMovementInputs(program, "frame").sponsorConversation ?? "");
        await onSaveInputs("frame", { sponsorConversation: (cur + note).trimStart() },
          { attest: { action: `New requirement routed to Frame scope — ${cr.stakeholder}`, detail: cr.ask.slice(0, 140) } });
      }
    }
    setRouted((prev) => ({ ...prev, [crKey(cr)]: route }));
  };

  // Start the next iteration: record the round bump (feedback → design), then
  // open the Prototype workspace so the team rebuilds to the changes.
  const newIteration = async () => {
    if (!onSaveInputs) return;
    setIterating(true);
    try {
      await onSaveInputs("show", { iterationRound: String(ls.round + 1) },
        { attest: { action: `Started prototype iteration ${ls.round + 1}`, detail: `${incoming.length} change request${incoming.length === 1 ? "" : "s"} from Show` } });
      onOpenArtifact?.("prototype-build");
    } finally { setIterating(false); }
  };

  if (!fs.hasArchitecture && !fs.hasDesign && !fs.hasBlueprint) return null;

  // Only the DIRECTION act (architecture strategy) remains in the cockpit — the
  // Design and Build acts were redundant with the artifact tabs below, so they
  // were removed. Direction auto-opens until a direction is chosen; clicking its
  // header toggles it.
  const effectiveOpen = openAct ?? (fs.direction.chosen ? "" : "Direction");
  const toggleAct = (label: string) => setOpenAct(effectiveOpen === label ? "" : label);

  // The DIRECTION act (architecture strategy) is a SOLUTION-level decision owned
  // by the Design team, not per-area work — so it shows ONLY when the Design-team
  // tile is selected (never in the unfiltered or business-area views).
  const showDirection = (areaFilter ?? []).includes(DESIGN_TEAM);

  const recordDirection = async () => {
    if (!onSaveInputs || !pick) return;
    setRecording(true);
    try {
      await onSaveInputs("envision", { directionDecision: `Chosen direction: ${pick}.${tradeaway.trim() ? `\nTraded away: ${tradeaway.trim()}` : ""}` },
        { attest: { action: `Architecture direction chosen — ${pick}`, detail: tradeaway.trim().slice(0, 140) } });
    } finally { setRecording(false); }
  };

  // With Direction now Design-team-only, a business-area or unfiltered view has
  // nothing to render here (the design work lives in the artifact tabs) — return
  // null rather than leave an empty panel below the orchestration board.
  if (!incoming.length && !(showDirection && fs.direction.candidates.length)) return null;

  return (
    <div className="v3fs-envc">
      {/* ── INCOMING FROM SHOW ────────────────────────────────────────────────
          The loop closing: change requests stakeholders raised on the prototype,
          waiting for the team to fold into the design and rebuild. */}
      {incoming.length ? (
        <section className="v3fs-envc-incoming" aria-label="Incoming from Show">
          <div className="v3fs-envc-inc-h">
            <span className="v3fs-envc-inc-t">◀ Incoming from Show — {incoming.length} change{incoming.length === 1 ? "" : "s"} to fold in</span>
            <span className="v3fs-envc-inc-round">iteration {ls.round}</span>
          </div>
          {/* Grouped by area — parallel areas route their changes to their own
              workspace slice, so the team can address one area without the others. */}
          {[...new Set(incoming.map((c) => c.area))].map((area) => (
            <div key={area} className="v3fs-envc-inc-area">
              <div className="v3fs-envc-inc-al">{area}<em>{incoming.filter((c) => c.area === area).length}</em></div>
              <ul className="v3fs-envc-inc-list">
                {incoming.filter((c) => c.area === area).map((cr, i) => {
                  const route = routed[crKey(cr)];
                  return (
                    <li key={i} className={`v3fs-envc-inc-cr${cr.blocking ? " block" : ""}${route ? ` routed-${route}` : ""}`}>
                      <div className="v3fs-envc-inc-crtop">
                        <b>{cr.stakeholder}</b>
                        <em>{cr.blocking ? "objection" : "change"}</em>
                        {cr.ask ? <span>{cr.ask}</span> : <span className="v3fs-envc-inc-noask">asked for a change — see their demo row</span>}
                      </div>
                      {/* Triage: not every change is a design fix. */}
                      {route ? (
                        <div className="v3fs-envc-inc-routed">
                          {route === "design" ? "→ design fix — folds into the rebuild"
                            : route === "listen" ? "→ current-state correction — sent to Listen; the model re-derives"
                              : "→ new requirement — sent to Frame scope"}
                        </div>
                      ) : onSaveInputs ? (
                        <div className="v3fs-envc-inc-triage" role="group" aria-label={`Route ${cr.stakeholder}'s change`}>
                          <span className="lbl">This is a</span>
                          <button type="button" onClick={() => void routeChange(cr, "design")}>design fix</button>
                          <button type="button" onClick={() => void routeChange(cr, "listen")} title="We got their current-state model wrong — update the ontology/workflows and cascade forward">current-state correction</button>
                          <button type="button" onClick={() => void routeChange(cr, "frame")} title="A new ask beyond the agreed scope">new requirement</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {onSaveInputs ? (
            <button type="button" className="v3fs-btn pri v3fs-envc-inc-go" disabled={iterating} onClick={() => void newIteration()}>
              {iterating ? "Starting…" : `▶ Address & rebuild — start iteration ${ls.round + 1}`}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ── DIRECTION ─────────────────────────────────────────────────────── */}
      {fs.direction.candidates.length && showDirection ? (
        <section className={`v3fs-envc-act${effectiveOpen === "Direction" ? " open" : ""}`}>
          <div className="v3fs-envc-ah">
            <button type="button" className="v3fs-envc-ahbtn" aria-expanded={effectiveOpen === "Direction"} onClick={() => toggleAct("Direction")}>
              <span className="v3fs-envc-an">1</span>Direction
              {fs.direction.chosen ? <span className="v3fs-envc-ahsum done">✓ {fs.direction.chosen}</span> : <span className="v3fs-envc-ahsum todo">choose the shape</span>}
              <span className="v3fs-envc-ahchev" aria-hidden="true">{effectiveOpen === "Direction" ? "▾" : "▸"}</span>
            </button>
            {fs.hasArchitecture && onOpenArtifact ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onOpenArtifact("architecture-strategy")}>view the strategy →</button> : null}
          </div>
          {effectiveOpen !== "Direction" ? null : fs.direction.chosen ? (
            <div className="v3fs-envc-chosen">✓ On the record: <b>{fs.direction.chosen}</b></div>
          ) : (
            <>
              <div className="v3fs-envc-cands">
                {fs.direction.candidates.map((c) => (
                  <button key={c.name} type="button" className={`v3fs-envc-cand${pick === c.name ? " on" : ""}${c.recommended ? " rec" : ""}`}
                    aria-pressed={pick === c.name} onClick={() => setPick((p) => (p === c.name ? "" : c.name))}>
                    <div className="v3fs-envc-candh"><b>{c.name}</b>{c.shape ? <span className="v3fs-envc-shape">{c.shape}</span> : null}{c.recommended ? <span className="v3fs-envc-recbadge">✓ recommended</span> : null}</div>
                    {c.description ? <p>{c.description}</p> : null}
                  </button>
                ))}
              </div>
              {pick ? (
                <div className="v3fs-envc-decide">
                  <label><span>What does choosing <b>{pick}</b> trade away? <em>(recorded)</em></span>
                    <textarea rows={2} value={tradeaway} onChange={(e) => setTradeaway(e.target.value)} placeholder="The candidate's strengths you're consciously giving up…" /></label>
                  <button type="button" className="v3fs-btn pri" disabled={recording || !onSaveInputs} onClick={() => void recordDirection()}>{recording ? "Recording…" : "✓ Record this direction"}</button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

    </div>
  );
}
