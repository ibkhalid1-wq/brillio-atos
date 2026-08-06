/**
 * The Line — the production-line home view, mounted BESIDE the classic Flow
 * chrome as a flag-gated sibling (appbar toggle · `?ui=line` · localStorage).
 *
 * A projection with exactly three write affordances, every one of them the
 * classic chrome's own handler passed through untouched:
 *   - the Discovery Kit matrix (coverage edits via onSaveInputs),
 *   - the capture dialog (attributed evidence appended via onSaveInputs,
 *     byte-identical to the classic collection card's format),
 *   - per-person durable links (onMintFollowUp — which RETURNS the URL, so
 *     mint-and-copy is one click with no stale-closure read-back).
 * One write path, two skins: the chromes can run at the same time and can
 * never disagree, because there is nothing here to disagree with.
 */
import { Suspense, lazy, useMemo, useRef, useState, type ComponentProps } from "react";
import type { ProgramSummary } from "@/new/types";
import { buildLineModel, LINE_GLYPHS, type LineBand, type LineStation } from "@/v3/lib/lineModel";
import {
  evidenceStamp, flowMovements, movementEvidence, readMovementInputs, stakeholderEmail,
  type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { resolveMovementStakeholders, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { copyTextFromAction } from "@/v3/components/flow/flowCapture";
import { stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { listenCoverageAreas, listenAreaCoverage } from "@/v3/components/flow/listenCoverage";
import { canonicalFrameArea, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { buildMeetingIcs } from "@/v3/components/flow/flowMeetings";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import "./theLine.css";

const FlowArtifactStudio = lazy(() => import("./studio/FlowArtifactStudio"));

type KitAlignProps = ComponentProps<typeof DiscoveryKitAlign>;

/** FlowShell's full save signature — wider than the Kit matrix's (it carries
 * `attest`, which the capture write uses); still assignable to the matrix's
 * narrower prop by parameter contravariance. */
type SaveInputsFn = (phaseId: string, inputs: Record<string, string>,
  opts?: { silent?: boolean; attest?: { action: string; detail?: string }; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;

interface CastRow {
  label: string;
  role: string;
  isRole: boolean;
  area: string;
  heard: boolean;
  awaiting: boolean;      // link out, nothing back yet
  questions: string[];
  stakeholder: MovementStakeholder;
}

interface TheLineProps {
  program: ProgramSummary;
  /** Classic write handlers, passed through untouched. All optional — omitted
   * (e.g. a future sponsor lens) the Line renders fully read-only. */
  onSaveInputs?: SaveInputsFn;
  onRenamePerson?: KitAlignProps["onRenamePerson"];
  onRenameRole?: KitAlignProps["onRenameRole"];
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}

function Segments({ station }: { station: LineStation }) {
  if (!station.perArea) return null;
  return (
    <div className="v3ln-seg" aria-label={`${station.title} — maturity per area`}>
      {station.perArea.map((seg) => (
        <span key={seg.area} className={`v3ln-sg m${seg.maturity}`}
          title={`${seg.area} · ${LINE_GLYPHS[seg.maturity]}`}>
          {seg.maturity > 0 ? seg.initials : ""}
        </span>
      ))}
    </div>
  );
}

function Station({ station, onOpen }: { station: LineStation; onOpen: (card: ArtifactCardModel) => void }) {
  const openable = !!station.card?.present;
  return (
    <button type="button" className="v3ln-stn" disabled={!openable}
      title={openable ? `Open ${station.title}` : `${station.title} — not seeded yet`}
      onClick={() => { if (station.card) onOpen(station.card); }}>
      <span className="v3ln-stn-h">
        {!station.perArea ? (
          <span className={`v3ln-g m${station.maturity}`} aria-hidden="true">{LINE_GLYPHS[station.maturity]}</span>
        ) : null}
        <span className="v3ln-stn-n">{station.title}</span>
        {station.needsRefresh ? <span className="v3ln-rf">needs refresh ↻</span> : null}
      </span>
      {station.subtitle ? <span className="v3ln-stn-sub">{station.subtitle}</span> : null}
      <Segments station={station} />
    </button>
  );
}

function GateSheet({ band, onClose }: { band: LineBand; onClose: () => void }) {
  return (
    <>
      <div className="v3ln-gate-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label={`${band.name} gate criteria`}>
        <div className="v3ln-gate-h">
          <h3>{band.name} — the gate, item by item</h3>
          <button type="button" className="v3ln-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {band.gate.length === 0 ? (
          <p className="v3ln-gate-empty">No criteria yet — this gate seeds with the movement.</p>
        ) : (
          <ul className="v3ln-crit">
            {band.gate.map((item, index) => (
              <li key={index} className={item.advisory ? "adv" : undefined}>
                <span className={`v3ln-tick ${item.done ? "d" : "o"}`} aria-hidden="true">{item.done ? "✓" : "…"}</span>
                <span className="v3ln-crit-b">
                  {item.label}
                  {item.why ? <em>{item.why}</em> : null}
                  {item.advisory ? <em>advisory — informs, never gates</em> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="v3ln-gate-f">Frame, Listen and the Loop close themselves when every criterion is met. Ship and Evolve stay deliberate decisions.</p>
      </div>
    </>
  );
}

/** Same matching classic uses: newest pack whose stakeholder name matches,
 * scoped to Listen (durable kit links carry no movementId). */
function packFor(program: ProgramSummary, who: string) {
  const key = who.trim().toLowerCase();
  return [...listInterviewPacks(program)].reverse().find((pack) =>
    pack.stakeholder.trim().toLowerCase() === key
    && (!pack.movementId || pack.movementId === "listen"));
}

export default function TheLine({ program, onSaveInputs, onRenamePerson, onRenameRole, onMintFollowUp, onScheduleFollowUp, onRunAgent }: TheLineProps) {
  const model = useMemo(() => buildLineModel(program), [program]);
  const [gateFor, setGateFor] = useState<LineBand | null>(null);
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);

  // ── the cast: the Listen roster with area, heard state and their questions.
  const cast = useMemo<CastRow[]>(() => {
    const listen = flowMovements().find((movement) => movement.id === "listen");
    if (!listen) return [];
    const packs = listInterviewPacks(program);
    const evidence = movementEvidence(program, listen);
    const kitAreas = listenCoverageAreas(program).map((area) => area.label);
    const coverage = listenAreaCoverage(program);
    return resolveMovementStakeholders(program, "listen").map((stakeholder) => {
      const label = stakeholder.name || stakeholder.role;
      const col = stakeholderCollection("listen", stakeholder, packs, evidence);
      const covered = coverage.find((row) =>
        row.roles.some((who) => who.trim().toLowerCase() === label.trim().toLowerCase()));
      const area = covered?.area
        ?? canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, stakeholder.name ?? "", stakeholder.role));
      return {
        label, role: stakeholder.role, isRole: stakeholder.isRole, area,
        heard: col.heard, awaiting: !col.heard && !!col.pack,
        questions: stakeholder.linkQuestions ?? stakeholder.questions,
        stakeholder,
      };
    });
  }, [program]);

  // ── per-person link: existing pack's URL, else mint (returns the URL).
  const [linkShown, setLinkShown] = useState<{ who: string; url: string } | null>(null);
  const copyLink = async (row: CastRow) => {
    const url = await copyTextFromAction(async () => {
      const existing = packFor(program, row.label);
      if (existing) return portalLinkFor(program.id, existing);
      if (!onMintFollowUp) return null;
      return onMintFollowUp({
        movementId: "listen", who: row.label, questions: row.questions,
        captureField: "interviewTranscripts", unnamed: row.isRole,
      });
    });
    if (url) setLinkShown({ who: row.label, url });
  };

  // ── meeting invite: schedule the follow-up, then download the .ics.
  const dateRef = useRef<HTMLInputElement>(null);
  const [invitee, setInvitee] = useState<CastRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pickDate = (row: CastRow) => {
    setInvitee(row);
    const input = dateRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker(); else input.click();
  };
  const onDatePicked = async (date: string) => {
    if (!date || !invitee) return;
    await onScheduleFollowUp?.("listen", invitee.label, date);
    const ics = buildMeetingIcs({
      who: invitee.label, email: stakeholderEmail(program, invitee.label), date,
      programmeName: program.name, questions: invitee.questions,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url; a.download = `listen-${invitee.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
    a.click(); URL.revokeObjectURL(url);
    setNote(`Invite downloaded · follow-up scheduled — ${invitee.label}, ${date}`);
    setInvitee(null);
    window.setTimeout(() => setNote(null), 6000);
  };

  // ── capture: append attributed evidence, byte-identical to classic.
  const [capFor, setCapFor] = useState<CastRow | "open" | null>(null);
  const [capWho, setCapWho] = useState<string>("");
  const [capText, setCapText] = useState("");
  const openCapture = (row?: CastRow) => {
    setCapFor(row ?? "open");
    setCapWho(row?.label ?? cast[0]?.label ?? "");
    setCapText("");
  };
  const saveCapture = async () => {
    const row = cast.find((r) => r.label === capWho);
    const text = capText.trim();
    if (!row || !text || !onSaveInputs) return;
    const existing = String(readMovementInputs(program, "listen").interviewTranscripts ?? "");
    const header = `— ${[row.isRole ? row.role : row.label, row.isRole ? "" : row.role, evidenceStamp()].filter(Boolean).join(", ")} —`;
    const appended = [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n");
    await onSaveInputs("listen", { interviewTranscripts: appended }, { attest: { action: `Captured — ${row.label}` } });
    onRunAgent?.("contradiction-detector", "listen");
    setCapFor(null); setCapText("");
    setNote(`Captured — ${row.label}. The Ontology and Atlas will refresh for ${row.area}.`);
    window.setTimeout(() => setNote(null), 6000);
  };

  return (
    <div className="v3ln">
      <div className="v3ln-stats">
        <div><span className="v3ln-sl">Round</span><span className="v3ln-sv">{model.round}</span></div>
        <div><span className="v3ln-sl">Converged — signed off</span><span className="v3ln-sv">{model.stats.converged} of {model.stats.areasTotal} areas</span></div>
        <div><span className="v3ln-sl">Voices heard</span><span className="v3ln-sv">{model.stats.heardTotal > 0 ? `${model.stats.heardDone} of ${model.stats.heardTotal}` : "—"}</span></div>
        <div><span className="v3ln-sl">Needs refresh</span><span className={`v3ln-sv${model.stats.refresh > 0 ? " acc" : ""}`}>{model.stats.refresh > 0 ? `${model.stats.refresh} station${model.stats.refresh === 1 ? "" : "s"}` : "—"}</span></div>
        <div className="v3ln-sp" />
        <span className="v3ln-ro" title="Both chromes read and write the same live record — switch back any time; nothing diverges.">one record · both chromes live</span>
      </div>

      {note ? <div className="v3ln-toast" role="status">{note}</div> : null}

      {model.bands.map((band) => (
        <section key={band.id} className={`v3ln-band${band.id === "loop" ? " loop" : ""}`} aria-label={band.name}>
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">{band.name}</span>
            {band.half ? <span className="v3ln-half">{band.half}</span> : null}
            <span className="v3ln-scope">{band.scope}</span>
            <span className="v3ln-band-sp" />
            <button type="button" className={`v3ln-chip ${band.chip.tone}`}
              onClick={() => setGateFor(band)}
              title={`Open the ${band.name} gate's criteria`}>
              {band.chip.text} ›
            </button>
          </header>
          {band.intake ? (
            <div className="v3ln-intake"><span>evidence in</span>{band.intake}
              {band.id === "listen" && onSaveInputs && cast.length > 0 ? (
                <button type="button" className="v3ln-a" onClick={() => openCapture()}>＋ add to the record</button>
              ) : null}
            </div>
          ) : null}
          <div className={`v3ln-stns n${band.stations.length}`}>
            {band.stations.map((s) => <Station key={s.id} station={s} onOpen={setDocFor} />)}
          </div>
          {band.note ? <div className="v3ln-note">{band.note}</div> : null}
        </section>
      ))}

      {cast.length > 0 ? (
        <section className="v3ln-band" aria-label="The cast">
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">The Cast</span>
            <span className="v3ln-scope">Listen · one durable link per voice</span>
            <span className="v3ln-band-sp" />
            <span className="v3ln-scope">{cast.filter((r) => r.heard).length} of {cast.length} heard</span>
          </header>
          <div className="v3ln-cast">
            {cast.map((row) => (
              <div key={row.label} className="v3ln-cr">
                <span className={`v3ln-dot ${row.heard ? "d" : row.awaiting ? "w" : "t"}`}
                  title={row.heard ? "Heard — evidence on the record" : row.awaiting ? "Link out — awaiting response" : "To reach"} />
                <span className="v3ln-cr-who">
                  <b>{row.label}</b>
                  <span>{row.isRole ? "role — assign a name to send" : row.role}</span>
                </span>
                <span className="v3ln-cr-area" title="Primary area — where their verdicts roll up">{row.area}</span>
                <details className="v3ln-cr-q">
                  <summary>{row.questions.length} question{row.questions.length === 1 ? "" : "s"}</summary>
                  <ul>{row.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </details>
                <span className="v3ln-cr-act">
                  <button type="button" className="v3ln-a" onClick={() => void copyLink(row)}
                    title="Their one durable link — minted once, reused forever">⎘ link</button>
                  {onSaveInputs ? (
                    <button type="button" className="v3ln-a" onClick={() => openCapture(row)}
                      title={`Capture what ${row.label} said`}>✎ capture</button>
                  ) : null}
                  {onScheduleFollowUp ? (
                    <button type="button" className="v3ln-a" onClick={() => pickDate(row)}
                      title="Schedule a follow-up and download the calendar invite">🗓 invite</button>
                  ) : null}
                </span>
                {linkShown?.who === row.label ? (
                  <input className="v3ln-cr-url" readOnly value={linkShown.url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`${row.label}'s durable link`} />
                ) : null}
              </div>
            ))}
          </div>
          <div className="v3ln-note">A person&rsquo;s link is minted once and re-asks forever — new questions supersede old ones on the same URL. Copying always shows the link here too, in case the clipboard is denied.</div>
        </section>
      ) : null}

      <div className="v3ln-legend">
        <span className="v3ln-sl">Segments read</span>
        <span>{model.areas.map((a) => a).join(" · ") || "areas arrive when the Discovery Kit names them"}</span>
        <span className="v3ln-glyphs">○ not seeded · ◔ provisional · ◑ grounded · ◕ reviewed · ● approved</span>
      </div>

      <input ref={dateRef} type="date" className="v3ln-hidden" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const d = e.target.value; e.target.value = ""; void onDatePicked(d); }} />

      {gateFor ? <GateSheet band={gateFor} onClose={() => setGateFor(null)} /> : null}

      {capFor ? (
        <>
          <div className="v3ln-gate-backdrop" onClick={() => setCapFor(null)} aria-hidden="true" />
          <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label="Add to the record">
            <div className="v3ln-gate-h">
              <h3>Add to the record — Listen</h3>
              <button type="button" className="v3ln-x" onClick={() => setCapFor(null)} aria-label="Close">✕</button>
            </div>
            <div className="v3ln-cap">
              <label className="v3ln-cap-f">
                <span>Who said it</span>
                <select value={capWho} onChange={(e) => setCapWho(e.target.value)}>
                  {cast.map((row) => <option key={row.label} value={row.label}>{row.label} — {row.role}</option>)}
                </select>
              </label>
              <label className="v3ln-cap-f">
                <span>What they said — attribution is added for you</span>
                <textarea rows={7} value={capText} onChange={(e) => setCapText(e.target.value)}
                  placeholder="Paste a transcript, meeting notes, an email thread…" />
              </label>
              <div className="v3ln-cap-bar">
                <button type="button" className="v3ln-btn" disabled={!capText.trim() || !capWho}
                  onClick={() => void saveCapture()}>Capture</button>
                <span>Lands as “— Name, Role, Date —” evidence and refreshes what depends on it. To record live or attach files, use the classic Listen board — same record.</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {docFor ? (
        <Suspense fallback={null}>
          <FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)}
            header={docFor.id === "discovery-kit"
              ? <DiscoveryKitAlign program={program} onSaveInputs={onSaveInputs}
                  onRenamePerson={onRenamePerson} onRenameRole={onRenameRole}
                  locked={program.gateReviews?.frame?.status === "approved"}
                  onOpenGate={() => setGateFor(model.bands.find((b) => b.id === "frame") ?? null)} />
              : undefined} />
        </Suspense>
      ) : null}
    </div>
  );
}
