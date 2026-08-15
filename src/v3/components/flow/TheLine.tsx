/**
 * The Line — the production-line home view, and since 2026-08-10 the ONLY Flow
 * view: the classic canvas was deleted and the appbar toggle with it, so the
 * rail's "Flow" tile renders this component and nothing else.
 *
 * A projection with exactly three write affordances, each one a shell handler
 * passed straight through, unwrapped:
 *   - the Discovery Kit matrix (coverage edits via onSaveInputs),
 *   - the capture dialog (attributed evidence appended via onSaveInputs, in the
 *     same stored format the collection card has always written),
 *   - per-person durable links (onMintFollowUp — which RETURNS the URL, so
 *     mint-and-copy is one click with no stale-closure read-back).
 * One write path, one view: nothing renders a second copy of these numbers, so
 * there is nothing left for a second surface to disagree with.
 */
import { Fragment, Suspense, lazy, useEffect, useMemo, useState, type ComponentProps, useRef } from "react";
import type { ProgramSummary } from "@/new/types";
import { buildLineModel, LINE_GLYPHS, type LineBand, type LineStation } from "@/v3/lib/lineModel";
import {
  artifactDocument, attestHeardRoster, demoAcceptance, evidenceStamp, flowMovements, movementArtifacts,
  movementEvidence, readMovementInputs, stakeholderEmail,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";
import {
  approvalLinkFor, canSendForApproval, stakeholderApprovalItems, type StakeholderApprovalItem,
} from "@/v3/components/flow/flowApprovals";
import { displayPersonLabel, resolveMovementStakeholders, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { useArtifactRegen } from "@/v3/components/flow/useArtifactRegen";
import { listInterviewPacks, linkIsOpen, visibleLinks, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { stakeholderCollection } from "@/v3/components/flow/CollectBoard";
// The two roads from the world into the capture dialog, both of them the
// SHARED controls — no second uploader, no second transcriber.
// TranscribeButton's only other render site sits inside CollectBoard's
// IntervieweeDiscovery, which nothing has imported since the classic-canvas
// sunset (564cd3d), so this mount is what makes recording ingestion reachable
// at all. It self-hides when flow-transcribe answers 501 (no OPENAI_API_KEY).
// AttachFileButton posts to flow-extract and reports its own failures inline —
// this dialog must never wrap it in anything that can swallow one.
import { AttachFileButton, TranscribeButton } from "@/v3/components/flow/flowCapture";
import { listenCoverageAreas, listenAreaCoverage } from "@/v3/components/flow/listenCoverage";
import { canonicalFrameArea, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { buildMeetingIcs, meetingKit, sponsorLinkQuestions } from "@/v3/components/flow/flowMeetings";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import { supabase } from "@/integrations/supabase/client";
import { useProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { useOperatorCommits } from "@/v3/lib/ledger/useOperatorCommits";
import { pinsForSend } from "@/v3/lib/ledger/operatorActions";
import { HeardReadout, ProvisionalMark, ClaimStatus, SourceTag } from "@/v3/components/flow/studio/ledgerPrimitives";
import DesignLoopZones from "@/v3/components/flow/DesignLoopZones";
import { ownerLabelsForCast } from "@/v3/lib/ledger/ownerBinding";
import { lifecycleEntities } from "@/v3/lib/ledger/lifecycle";
import { dictionaryCoverage, isSpreadsheetName, mergeDictionaryCsv, parseDictionaryCsv, readDictionaryWorkbook } from "@/v3/lib/ledger/dictionary";
import { currentDesignRound } from "@/v3/components/flow/flowDesignRound";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import {
  emptyOwnedLoad, ownedLoadBreakdown, ownedLoadFor, ownedLoadSections, personOwned, sendableCount,
  type OwnedBucket, type OwnedLoad,
} from "@/v3/lib/ledger/ownedLoad";
import "./theLine.css";

const FlowArtifactStudio = lazy(() => import("./studio/FlowArtifactStudio"));
const EvidenceReader = lazy(() => import("./EvidenceReader"));

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
  /** Which movement this voice is collected FOR — frame pre-Kit (the sponsor
   * is the starting voice), listen once the Kit casts the roster. Routes the
   * capture write and the link mint to the right conversation field. */
  movementId: "frame" | "listen";
  captureField: string;
  /** Primary area (first coverage lane) — what the record attributes to. */
  area: string;
  /** EVERY area this voice covers. One person, one engagement: the roster
   * never repeats a persona per area; their one link asks across all lanes. */
  areas: string[];
  heard: boolean;
  awaiting: boolean;      // link out, nothing back yet
  questions: string[];
  stakeholder: MovementStakeholder;
}

interface TheLineProps {
  program: ProgramSummary;
  /**
   * THE ONE HANDOFF. Discover reads; the Inbox acts. Where Discover surfaces
   * something that needs an operator MOVE, it states the fact and offers this —
   * never the move itself. Absent (a read-only lens), the fact is still stated and
   * nothing is offered, which is the honest degradation.
   */
  onOpenInbox?: () => void;
  /** Classic write handlers, passed through untouched. All optional — omitted
   * (e.g. a future sponsor lens) the Line renders fully read-only. */
  onSaveInputs?: SaveInputsFn;
  onRenamePerson?: KitAlignProps["onRenamePerson"];
  onRenameRole?: KitAlignProps["onRenameRole"];
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean; loci?: string[]; scripted?: boolean }) => Promise<string | null>;
  /** CLOSE a person's durable link — stamps `closedAt`, which is the one thing the edge
   * already honoured and nothing set. Reversible: re-minting (⎘ link → ↺ reopen) clears
   * it. Never touches a submission already on the record. Omitted → no close control. */
  onCloseLink?: (who: string) => Promise<void>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void | Promise<boolean | void>;
  /** Agent ids the backend reports as running — how a rebuild knows it finished. */
  runningAgentIds?: ReadonlySet<string>;
  /** Record a movement's gate — demonstrated. Reopen — evidence changed.
   * Classic's own handlers; the parent re-checks criteria at write time. */
  onRecordGate?: (movementId: string) => Promise<void>;
  onReopenGate?: (movementId: string, reason: string) => Promise<void>;
  /** THE review mint — the durable link a design review round hands out is the same
   *  one every other review share uses, stamped with the round. Pass-through. */
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean; loci?: string[]; designRoundId?: string }) => Promise<string | null>;
  /** The design review round's write verbs (`flowDesignRound.ts`), one handler.
   *  Pass-through to the Design Loop band; omitted ⇒ the round reads read-only. */
  onDesignRound?: ComponentProps<typeof DesignLoopZones>["onDesignRound"];
  /** Mint a no-login sign-off link for an artifact — returns the URL. */
  onSendForApproval?: (input: {
    artifactId: string; movementId: string; artifactTitle: string;
    approver: { name: string; role: string; email?: string }; snapshot?: string;
  }) => Promise<string | null>;
}

const MATURITY_WORDS = ["not seeded", "provisional", "grounded", "reviewed", "approved"] as const;

/** One sign-off in a persona's journey, tagged with the movement it belongs to
 * so send/copy routes correctly (Listen ontology vs Loop prototype). */
type SignoffItem = StakeholderApprovalItem & { movementId: "listen" | "show"; sendable: boolean };
/** A persona's two-phase engagement: validate & sign off in Listen, then meet
 * the prototype in the Design Loop (a demo verdict, then a prototype sign-off). */
interface PersonaJourney { listen: SignoffItem[]; loop: SignoffItem[]; verdict: string | null }

/** How a whole phase's sign-offs read at a glance: every item approved fresh,
 * something out for review, or nothing sent. */
export function phaseState(items: SignoffItem[]): "approved" | "pending" | "open" | "none" {
  if (!items.length) return "none";
  if (items.every((i) => i.status === "approved" && !i.preDatesDocument)) return "approved";
  if (items.some((i) => i.status === "in-review")) return "pending";
  return "open";
}

/**
 * WHICH JOURNEY SEGMENTS A ROW DRAWS — the decision, out of the render so it can
 * be asserted rather than inferred from a screenshot.
 *
 * A segment appears when the person has MOVED, not when they exist. "open" is the
 * state everybody starts in and stays in until they sign something (items exist,
 * none approved, none in review), so drawing it put 42 identical chips across 21
 * rows on the live CRM — same label, same state, same colour — saying what the
 * engagement chip beside them already said.
 *
 * Loop additionally needs a round to EXIST. Its items appear as soon as the
 * prototype artifact does, which says the person could be asked, not that they
 * were: with no round opened every row still claimed "Loop — open" while the band
 * above it said the round was not opened. A recorded verdict is its own evidence
 * and stands with or without a round.
 */
export function journeySegments(
  j: { listen: SignoffItem[]; loop: SignoffItem[]; verdict: string | null },
  roundOpened: boolean,
): { listen: "approved" | "pending" | null; loop: ReturnType<typeof phaseState> | null; verdict: string | null } {
  // `loop` can legitimately be "none" — a recorded verdict with no sign-off items
  // yet is still movement, and the verdict is what the segment reads.
  const worth = (state: ReturnType<typeof phaseState>) => state !== "none" && state !== "open";
  const listenState = phaseState(j.listen);
  const loopState = phaseState(j.loop);
  const verdict = j.verdict?.trim() || null;
  const showLoop = (verdict || roundOpened) && (worth(loopState) || !!verdict);
  return {
    listen: worth(listenState) ? (listenState as "approved" | "pending") : null,
    loop: showLoop ? loopState : null,
    verdict,
  };
}

function Segments({ station }: { station: LineStation }) {
  if (!station.perArea) return null;
  // A pill per area is legible up to a handful of lanes; past that the
  // initials collide and the strip reads as noise, so it collapses into a
  // maturity meter with the counts spelled out.
  if (station.perArea.length <= 8) {
    return (
      <div className="v3ln-seg" aria-label={`${station.title} — maturity per area`}>
        {station.perArea.map((seg) => (
          <span key={seg.area} className={`v3ln-sg m${seg.maturity}`}
            title={`${seg.area} · ${LINE_GLYPHS[seg.maturity]} ${MATURITY_WORDS[seg.maturity]}`}>
            {seg.maturity > 0 ? seg.initials : ""}
          </span>
        ))}
      </div>
    );
  }
  const buckets = [4, 3, 2, 1, 0]
    .map((m) => ({ m, areas: station.perArea!.filter((seg) => seg.maturity === m) }))
    .filter((bucket) => bucket.areas.length > 0);
  return (
    <div className="v3ln-seg-sum" aria-label={`${station.title} — maturity across ${station.perArea.length} areas`}>
      <span className="v3ln-meter" aria-hidden="true">
        {buckets.map((bucket) => (
          <span key={bucket.m} className={`v3ln-mt m${bucket.m}`}
            style={{ flexGrow: bucket.areas.length }}
            title={`${MATURITY_WORDS[bucket.m]} — ${bucket.areas.map((seg) => seg.area).join(", ")}`} />
        ))}
      </span>
      <span className="v3ln-seg-cap">
        {station.perArea.length} areas · {buckets.map((bucket) => `${bucket.areas.length} ${MATURITY_WORDS[bucket.m]}`).join(" · ")}
      </span>
    </div>
  );
}

function Station({ station, onOpen, onRegen, onGenerate, regenerating, generating }: {
  station: LineStation;
  onOpen: (card: ArtifactCardModel, section?: string) => void;
  onRegen?: (card: ArtifactCardModel) => void;
  onGenerate?: (card: ArtifactCardModel) => void;
  regenerating?: boolean;
  generating?: boolean;
}) {
  const present = !!station.card?.present;
  const canRegen = !!(station.needsRefresh && station.card && onRegen);
  // Not on the record yet, but its upstream inputs are — the whole tile
  // becomes a Generate button (it has nothing to open).
  const canGen = !present && !!station.canGenerate && !!station.card && !!onGenerate;
  return (
    <button type="button" className={`v3ln-stn${canGen ? " gen" : ""}`} disabled={!present && !canGen}
      title={present ? `Open ${station.title}`
        : canGen ? `Generate ${station.title} — its inputs are ready`
        : `${station.title} — not seeded yet`}
      onClick={() => {
        if (present && station.card) onOpen(station.card);
        else if (canGen && !generating) onGenerate!(station.card!);
      }}>
      <span className="v3ln-stn-h">
        {!station.perArea ? (
          <span className={`v3ln-g m${station.maturity}`} aria-hidden="true">{LINE_GLYPHS[station.maturity]}</span>
        ) : null}
        <span className="v3ln-stn-n">{station.title}</span>
        {present && station.needsRefresh ? (
          // The badge IS the action: clicking it regenerates from the
          // refreshed record instead of opening the stale document. A span
          // (not a nested button — invalid inside the station button) with
          // its own click/key handling.
          canRegen ? (
            <span role="button" tabIndex={0}
              className={`v3ln-rf act${regenerating ? " busy" : ""}`}
              title={`Regenerate ${station.title} from the refreshed record`}
              onClick={(e) => { e.stopPropagation(); if (!regenerating) onRegen!(station.card!); }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault(); e.stopPropagation();
                if (!regenerating) onRegen!(station.card!);
              }}>
              {regenerating ? "rebuilding…" : "evidence moved ↻"}
            </span>
          ) : <span className="v3ln-rf">evidence moved</span>
        ) : canGen ? (
          // Inputs are ready but nothing's been generated — a visual badge for
          // the action the tile itself carries (aria-hidden: the tile's own
          // title announces it, and a nested control would be redundant).
          <span className={`v3ln-rf gen${generating ? " busy" : ""}`} aria-hidden="true">
            {generating ? "generating…" : "generate ↧"}
          </span>
        ) : null}
      </span>
      {station.subtitle ? <span className="v3ln-stn-sub">{station.subtitle}</span> : null}
      {station.sections?.length ? (
        <span className="v3ln-stn-secs">
          {station.sections.map((s) => (
            // A direct link: opens the studio jumped to this section. role=button
            // (not a nested <button>, invalid inside the station button) with
            // stopPropagation so it doesn't also fire the station's own open.
            <span key={s.key} role="button" tabIndex={0} className="v3ln-stn-sec"
              title={`Open ${station.title} at ${s.label}`}
              onClick={(e) => { e.stopPropagation(); if (station.card) onOpen(station.card, s.key); }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault(); e.stopPropagation();
                if (station.card) onOpen(station.card, s.key);
              }}>{s.label}</span>
          ))}
        </span>
      ) : null}
      <Segments station={station} />
    </button>
  );
}

/** Classic's armed two-step confirm, in Line clothes: first press arms (and
 * auto-disarms after 4s), second press acts. */
function LineGateAction({ idle, armedLabel, busyLabel, onAct }: {
  idle: string; armedLabel: string; busyLabel: string; onAct: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const press = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try { await onAct(); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <button type="button" className={`v3ln-gate-act${armed ? " armed" : ""}`} disabled={busy}
      onClick={() => void press()}>
      {busy ? busyLabel : armed ? armedLabel : idle}
    </button>
  );
}

function GateSheet({ band, approved, onClose, onRecord, onReopen }: {
  band: LineBand;
  approved: boolean;
  onClose: () => void;
  onRecord?: () => Promise<void>;
  onReopen?: () => Promise<void>;
}) {
  const gating = band.gate.filter((item) => !item.advisory);
  const ready = gating.length > 0 && gating.every((item) => item.done);
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
        {onRecord && ready && !approved ? (
          <div className="v3ln-gate-actions">
            <LineGateAction idle="Record the gate — demonstrated" armedLabel="Confirm — records the gate and locks inputs"
              busyLabel="Recording…" onAct={onRecord} />
          </div>
        ) : null}
        {onReopen && approved ? (
          <div className="v3ln-gate-actions">
            <LineGateAction idle="Reopen the gate — evidence changed" armedLabel="Confirm — reopens the gate and unlocks inputs"
              busyLabel="Reopening…" onAct={onReopen} />
          </div>
        ) : null}
        <p className="v3ln-gate-f">Frame, Listen and the Loop close themselves when every criterion is met. Ship and Evolve stay deliberate decisions.</p>
      </div>
    </>
  );
}

/**
 * THE LINK THIS ROW IS ABOUT — read through `visibleLinks`, the ONE rule for which of a
 * person's packs a surface shows: the newest OPEN one (the live ask) and the newest
 * CLOSED one (the record that they finished). The row then prefers the OPEN link.
 *
 * It used to be `[...packs].reverse().find(matches)` — LAST IN THE BLOB wins, closure
 * never consulted. Blob order is not mint order: `capInterviewPacks` re-sorts on
 * DURABILITY, and its `isDurable` test is `askUpdatedAt || submissions || live review`.
 * A link that has been ANSWERED carries `submissions`, so it is durable and moves to the
 * TAIL; a link that has never been answered and predates `askUpdatedAt` is not durable
 * and stays at the head. So the ordering systematically promotes a person's FINISHED
 * link above their OPEN one, and the row read "link closed · ↺ reopen" while their live
 * link was still taking answers — with `⎘ link` copying the dead token, which is how an
 * operator ends up chasing someone on a URL that refuses their answer. An OPEN link is
 * what the row is about; a closed one only when there is nothing live.
 *
 * Scoped to the person and movement BEFORE `visibleLinks`, because that function groups
 * per PERSON: a Frame link and a Listen link for one voice are two different asks and
 * must not compete for the same slot.
 */
function packFor(program: ProgramSummary, who: string, movementId: "frame" | "listen") {
  const key = who.trim().toLowerCase();
  const theirs = listInterviewPacks(program).filter((pack) =>
    pack.stakeholder.trim().toLowerCase() === key
    && (movementId === "listen" ? (!pack.movementId || pack.movementId === "listen") : pack.movementId === movementId));
  const shown = visibleLinks(theirs);
  return shown.find(linkIsOpen) ?? shown[shown.length - 1];
}

export default function TheLine({ program, onOpenInbox, onSaveInputs, onRenamePerson, onRenameRole, onMintFollowUp, onMintReview, onCloseLink, onScheduleFollowUp, onRunAgent, runningAgentIds, onRecordGate, onReopenGate, onSendForApproval, onDesignRound }: TheLineProps) {
  const model = useMemo(() => buildLineModel(program), [program]);
  // The ONE in-browser ledger read every surface here shares (read-only migrate).
  const ledger = useProgramLedger(program);
  // The ONE operator write path (`_operatorActions`, silent) — reused here, not cloned,
  // so the SEND moment can record its in-flight PINS on the same channel the inbox
  // writes assigns and fates to.
  const commits = useOperatorCommits(program, onSaveInputs);
  const [gateFor, setGateFor] = useState<LineBand | null>(null);
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // A section chip on the board deep-links into the studio at that section.
  const [docSection, setDocSection] = useState<string | undefined>(undefined);
  /** One-signal lifecycle readings — no question exists for them, so the Record is
   *  the only place they are accounted for. Read through lifecycle.ts, as ever. */
  const maybeLifecycles = useMemo(
    () => lifecycleEntities(ledger.store).filter((l) => !l.confident), [ledger.store]);
  const openStation = (card: ArtifactCardModel, section?: string) => { setDocSection(section); setDocFor(card); };
  // Two projections of the one record: the WORK board (where the programme
  // is) and DISCOVERY (who it runs through — links, capture, invites). The
  // surface itself stays load-bearing past Listen — the same people carry demo
  // verdicts and sign-offs later, and they land here.
  const [tab, setTab] = useState<"work" | "discovery" | "record">("work");
  const [reading, setReading] = useState<EvidenceEntry | null>(null);
  // Discover's area filter — narrows the roster to one lane ("" = all).
  const [areaFilter, setAreaFilter] = useState<string>("");

  // ── the cast: the Listen roster with area, heard state and their questions.
  // Pre-Kit, the roster IS the sponsor: a new programme's Discover tab opens on
  // the Executive Sponsor (named from Frame, else a placeholder whose script
  // and link exist before the name does — a thread waiting).
  const cast = useMemo<CastRow[]>(() => {
    const movements = flowMovements();
    const packs = listInterviewPacks(program);
    const kitAreas = listenCoverageAreas(program).map((area) => area.label);
    const coverage = listenAreaCoverage(program);
    const rows = (movementId: "frame" | "listen", captureField: string, people: MovementStakeholder[]): CastRow[] => {
      const movement = movements.find((m) => m.id === movementId);
      const evidence = movement ? movementEvidence(program, movement) : [];
      return people.map((stakeholder) => {
        const label = stakeholder.name || stakeholder.role;
        const col = stakeholderCollection(movementId, stakeholder, packs, evidence);
        // EVERY lane that covers this voice, kit order — not just the first.
        const covered = coverage
          .filter((row) => row.roles.some((who) => who.trim().toLowerCase() === label.trim().toLowerCase()))
          .map((row) => row.area);
        const areas = covered.length ? [...new Set(covered)]
          : [canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, stakeholder.name ?? "", stakeholder.role))].filter(Boolean) as string[];
        const questions = [...new Set(stakeholder.linkQuestions ?? stakeholder.questions)];
        return {
          label, role: stakeholder.role, isRole: stakeholder.isRole, movementId, captureField,
          area: areas[0] ?? "", areas,
          // "Awaiting" needs a pack that actually CARRIES questions — a link with zero
          // sent questions is not in-flight (the two-reads invariant: in-flight-with-
          // 0-sent must be unrepresentable). Same read that feeds the sent count.
          heard: col.heard, awaiting: !col.heard && !!col.pack && questions.length > 0,
          questions,
          stakeholder,
        };
      });
    };
    // One person, one engagement: a named person absorbs their role's row —
    // "Ibrahim Khalid, Sales reps - Markets" is ONE voice with the union of
    // that role's areas and questions, never a second entry beside the role.
    const consolidate = (all: CastRow[]): CastRow[] => {
      const key = (s: string) => s.trim().toLowerCase();
      const fillersByRole = new Map<string, CastRow[]>();
      for (const row of all) {
        if (!row.role || key(row.label) === key(row.role)) continue;
        const k = key(row.role);
        const list = fillersByRole.get(k) ?? [];
        list.push(row);
        fillersByRole.set(k, list);
      }
      const out: CastRow[] = [];
      for (const row of all) {
        const fillers = key(row.label) === key(row.role || row.label) ? fillersByRole.get(key(row.label)) : undefined;
        if (fillers?.length) {
          for (const person of fillers) {
            for (const area of row.areas) if (!person.areas.includes(area)) person.areas.push(area);
            person.area = person.areas[0] ?? person.area;
            for (const q of row.questions) if (!person.questions.includes(q)) person.questions.push(q);
            person.heard = person.heard || row.heard;
            person.awaiting = !person.heard && (person.awaiting || row.awaiting);
          }
          continue;
        }
        out.push(row);
      }
      return out;
    };
    const listenRows = consolidate(rows("listen", "interviewTranscripts", resolveMovementStakeholders(program, "listen")));
    if (listenRows.length) return listenRows;
    const kit = meetingKit(program, "frame");
    const captureField = kit?.captureField ?? "sponsorConversation";
    const framePeople = resolveMovementStakeholders(program, "frame");
    if (framePeople.length) return rows("frame", captureField, framePeople);
    // No sponsor named yet — the placeholder starts the thread anyway.
    const script = kit?.questions.length ? kit.questions : sponsorLinkQuestions(program);
    return rows("frame", captureField, [{
      id: "frame-sponsor", name: "", role: "Executive Sponsor",
      questions: script, isRole: true,
    } as MovementStakeholder]);
  }, [program]);

  // Distinct areas actually present on the roster, kit order preserved by
  // first appearance; the filter narrows without ever hiding its own option.
  const castAreas = useMemo(() => {
    const seen: string[] = [];
    for (const row of cast) for (const area of row.areas) if (!seen.includes(area)) seen.push(area);
    return seen;
  }, [cast]);
  const filteredCast = areaFilter && castAreas.includes(areaFilter)
    ? cast.filter((row) => row.areas.includes(areaFilter))
    : cast;

  // Who the Design Loop's review round may ask — THE cast, not a second resolution
  // of the roster. Passed down so the round and Discover can never disagree about
  // who is on this programme.
  const roundRoster = useMemo(
    () => cast.map((row) => ({
      name: row.label,
      role: row.role,
      isRole: row.isRole,
      email: stakeholderEmail(program, row.label) ?? undefined,
    })),
    [cast, program],
  );

  // ── Discover as an engagement dashboard: each person's DOMINANT actionable state,
  // computed from the ledger (operator assignments + roster signal). Ageing on
  // in-flight is OPERATOR-TRACKED (the operator's chase, timed by hand) — honest until
  // the stakeholder link is live and the same clock times a real system send.
  type EngState = "ready" | "in-flight" | "blocked" | "done";
  const ENG_LABEL: Record<EngState, string> = { ready: "Ready", "in-flight": "In flight", blocked: "Blocked", done: "Done for now" };
  // A roster person → the ledger OWNER-LABEL(s) they own, via the ledger's own
  // function mapping (ownerRoleLabelForArea) — NOT area-word overlap. This is the
  // F-1/turf root fix: a person's questions are the OPEN unknowns on loci THEY OWN,
  // so the same locus can never land under two owners and inflate everyone's count.
  // The binding rule lives in lib/ledger/ownerBinding — one definition, asserted
  // directly. It used to be inline here, which is how the area fallback quietly
  // handed a recruiter all of Sales Leaders' questions.
  const ownerLabelsFor = useMemo(
    () => ownerLabelsForCast(cast, [...ledger.soloByOwner.keys()]),
    [cast, ledger.soloByOwner],
  );
  // ── THE ONE owned-load per person (ownedLoad.ts) ──────────────────────────────────
  // Every locus this person owns, partitioned ONCE into the four buckets that add up to
  // the headline: on this link · next link · blocked · → dictionary. The card's button,
  // its breakdown line, its expanded list and the link the operator mints all read this
  // object, which is what stops them printing 10 / 9 / 8 for one person (F6).
  const ownedLoadByLabel = useMemo(() => {
    const m = new Map<string, OwnedLoad>();
    for (const row of cast) m.set(row.label, ownedLoadFor(ledger, ownerLabelsFor.get(row.label) ?? []));
    return m;
  }, [cast, ownerLabelsFor, ledger]);
  const loadFor = (label: string): OwnedLoad => ownedLoadByLabel.get(label) ?? emptyOwnedLoad();
  // The same load, phrased. Seams are absent by construction (joint owners are never in
  // soloByOwner) — they live in the session queue, not on an async list. Blocked and
  // dictionary loci ARE here, tagged with why they can't ride: a miss stays visible.
  const ownedQuestionsFor = useMemo(() => {
    const m = new Map<string, Array<{ about: string; question: string; typeTag: string; bucket: OwnedBucket }>>();
    for (const row of cast) {
      m.set(row.label, (ownedLoadByLabel.get(row.label)?.owned ?? []).map((it) => {
        const r = renderQuestion(ledger.store, it.about, "operator");   // the ONE renderer
        return { about: it.about, question: r.question, typeTag: r.label, bucket: it.bucket };
      }));
    }
    return m;
  }, [cast, ownedLoadByLabel, ledger.store]);
  // Does this person sit on either side of an open seam? (blocked = only a joint
  // session left for them). Read from the one session queue, by owner-label.
  const seamPairsFor = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of cast) {
      const labels = ownerLabelsFor.get(row.label) ?? new Set<string>();
      const pairs = ledger.sessionQueue.filter((s) => s.pair.split("⋈").some((p) => labels.has(p.trim()))).map((s) => s.pair);
      m.set(row.label, pairs);
    }
    return m;
  }, [cast, ownerLabelsFor, ledger.sessionQueue]);
  const engagementByLabel = useMemo(() => {
    const now = Date.now();
    const byLabel = new Map<string, { state: EngState; ageDays: number | null; open: number; done: number; needsSession: boolean; onTurf: number; blockedOwned: number }>();
    for (const row of cast) {
      const key = row.label.trim().toLowerCase();
      const assigned = ledger.assignments.filter((a) => a.owner.label.trim().toLowerCase() === key);
      const open = assigned.filter((a) => !ledger.capturedAbouts.has(a.about));
      const done = assigned.filter((a) => ledger.capturedAbouts.has(a.about));
      const oldest = open.reduce<number | null>((m, a) => { const t = Date.parse(a.at); return Number.isNaN(t) ? m : (m === null ? t : Math.min(m, t)); }, null);
      const ageDays = oldest !== null ? Math.max(0, Math.floor((now - oldest) / 86400000)) : null;
      // SENDABLE, from the one owned-load — what a link could actually carry (the cap
      // only decides which link, not whether there is anything to ask).
      const load = ownedLoadByLabel.get(row.label) ?? emptyOwnedLoad();
      const onTurf = sendableCount(load);
      const blockedOwned = load.blocked.length;
      const needsSession = (seamPairsFor.get(row.label) ?? []).length > 0;
      let state: EngState;
      if (open.length > 0 || row.awaiting) state = "in-flight";      // engaged, awaiting a response
      else if (onTurf > 0) state = "ready";                          // open questions on loci THEY OWN
      // BLOCKED covers both shapes of "owned but unaskable": a seam that needs a joint
      // session, and loci the ledger has blocked. Reading the second as "Done for now"
      // (the old fall-through) buried a real miss under the calmest label on the board.
      else if (needsSession || blockedOwned > 0) state = "blocked";
      else state = "done";                                           // nothing open owned by them
      byLabel.set(row.label, { state, ageDays, open: open.length, done: done.length, needsSession, onTurf, blockedOwned });
    }
    return byLabel;
  }, [cast, ledger.assignments, ledger.capturedAbouts, ownedLoadByLabel, seamPairsFor]);
  const sortedCast = useMemo(() => {
    const rank: Record<EngState, number> = { ready: 0, "in-flight": 1, blocked: 2, done: 3 };
    return [...filteredCast].sort((a, b) => {
      const ea = engagementByLabel.get(a.label), eb = engagementByLabel.get(b.label);
      const ra = rank[ea?.state ?? "done"], rb = rank[eb?.state ?? "done"];
      if (ra !== rb) return ra - rb;
      if (ea?.state === "in-flight") return (eb?.ageDays ?? -1) - (ea?.ageDays ?? -1);          // chase oldest first
      if (ea?.state === "ready") return (eb?.onTurf ?? 0) - (ea?.onTurf ?? 0);                  // biggest real owned load first
      return a.label.localeCompare(b.label);
    });
  }, [filteredCast, engagementByLabel]);
  const engSummary = useMemo(() => {
    const c = { ready: 0, "in-flight": 0, blocked: 0, done: 0 } as Record<EngState, number>;
    let oldest = 0;
    for (const row of filteredCast) {
      const e = engagementByLabel.get(row.label); if (!e) continue;
      c[e.state] += 1;
      if (e.state === "in-flight" && e.ageDays != null) oldest = Math.max(oldest, e.ageDays);
    }
    return { ...c, oldest };
  }, [filteredCast, engagementByLabel]);
  const ageStr = (d: number) => d === 0 ? "today" : d === 1 ? "1 day" : d < 21 ? `${d} days` : `${Math.floor(d / 7)} weeks`;
  // ── OWNED BY NOBODY ON THE ROSTER ────────────────────────────────────────────────
  // The ledger owns loci by ROLE LABEL; the roster binds people to those labels above
  // (ownerLabelsFor). A label nothing binds to owns open questions with literally nobody
  // to ask — 27 of them on the real Laila programme (Executive Sponsor, Sales Ops, Talent
  // Acquisition, Finance) — and no surface said so, so they read as covered. The count is
  // soloByOwner's own; no person is invented and no number is invented. NOT filtered by
  // the area chip: an unclaimed owner has no roster row and therefore no area, so a filter
  // would silently hide the miss.
  // ROLES NOBODY ANSWERS FOR are derived and drawn in the INBOX now (2026-08-12):
  // naming someone for a role and reassigning their questions are both operator
  // decisions, and this surface is for the questions aimed at stakeholders. The
  // binding rule they share is `ownerLabelsForCast`, so neither can drift.


  // ── the record: every attributed evidence entry across the spine, newest
  // first, each mapped to its speaker's area so the Record projection can
  // group and filter the same way the roster does.
  const record = useMemo(() => {
    const areaOf = new Map(cast.map((row) => [row.label.trim().toLowerCase(), row.area]));
    // Folded role rows are gone from the roster, but the record may still
    // carry entries attributed to the role — keep them resolvable.
    for (const row of cast) {
      const roleKey = row.role.trim().toLowerCase();
      if (roleKey && !areaOf.has(roleKey)) areaOf.set(roleKey, row.area);
    }
    const kitAreas = listenCoverageAreas(program).map((area) => area.label);
    // Leadership is ONE lane on the record — the sponsor's frame conversation
    // and every executive-titled voice merge under a single label (the
    // roster's client-facing title when it has one, else the frame role) —
    // never folded into a delivery area.
    const exec = (s?: string) => !!s && /\bexecutive\b/i.test(s);
    const frameVoices = resolveMovementStakeholders(program, "frame");
    const rosterExec = cast.find((row) => exec(row.role) || exec(row.label));
    const leadLane = (rosterExec && (exec(rosterExec.role) ? rosterExec.role : rosterExec.label))
      || frameVoices[0]?.role.trim()
      || "Executive Sponsor";
    const sponsorKeys = new Set<string>();
    for (const voice of frameVoices) {
      for (const key of [voice.name, voice.role]) {
        if (key?.trim()) sponsorKeys.add(key.trim().toLowerCase());
      }
    }
    return flowMovements()
      .flatMap((movement) => movementEvidence(program, movement))
      .map((entry) => {
        // "Name, Role, stamp" — voices off the roster still resolve to an
        // area the same way roster rows do.
        const parts = entry.who.split(",");
        const name = parts[0].trim();
        const role = (parts[1] ?? "").trim();
        const isLeadership = exec(role) || exec(name)
          || sponsorKeys.has(name.toLowerCase()) || sponsorKeys.has(role.toLowerCase())
          || entry.movementId === "frame";
        const area = (isLeadership ? leadLane : undefined)
          ?? areaOf.get(name.toLowerCase())
          ?? canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, name, role));
        return { entry, name, area: area ?? "" };
      })
      .sort((a, b) => (b.entry.capturedAt ?? "").localeCompare(a.entry.capturedAt ?? ""));
  }, [program, cast]);
  // The Record's filterable lanes: every area that actually holds entries —
  // roster areas in kit order, then off-roster lanes (the sponsor's included)
  // by first appearance.
  const recordAreas = useMemo(() => {
    const order = castAreas.filter((area) => record.some((r) => r.area === area));
    for (const r of record) if (r.area && !order.includes(r.area)) order.push(r.area);
    return order;
  }, [record, castAreas]);
  const recordGroups = useMemo(() => {
    const order: string[] = [...recordAreas];
    if (record.some((r) => !r.area)) order.push("");
    const groups = order.map((area) => ({ area, items: record.filter((r) => r.area === area) }));
    return areaFilter && recordAreas.includes(areaFilter)
      ? groups.filter((g) => g.area === areaFilter)
      : groups;
  }, [record, recordAreas, areaFilter]);

  // ── the persona's journey across the spine: the SAME heard voice validates
  // and signs off the ontology in Listen, then meets the built prototype in the
  // Design Loop (a demo verdict, then a prototype sign-off). One row, two phases
  // — matched by name because there is no portable person-id across movements.
  /** Has a design review round actually been opened? The Loop journey segment is
   *  gated on this: the person's `loop` sign-off items exist as soon as the
   *  prototype artifact does, which says they COULD be asked, not that they were. */
  const designRoundOpened = useMemo(() => !!currentDesignRound(program), [program]);

  const journeys = useMemo(() => {
    const byMovement = new Map(flowMovements().map((m) => [m.id, m] as const));
    const cards = new Map<string, ArtifactCardModel[]>();
    const itemsFor = (movementId: "listen" | "show", name: string): SignoffItem[] => {
      const items = stakeholderApprovalItems(program, movementId, name);
      if (!items.length) return [];
      const movement = byMovement.get(movementId);
      if (movement && !cards.has(movementId)) cards.set(movementId, movementArtifacts(program, movement));
      return items.map((item) => ({
        ...item, movementId,
        sendable: !!(movement && cards.get(movementId)?.find((a) => a.id === item.artifactId)
          && canSendForApproval(program, movement, cards.get(movementId)!.find((a) => a.id === item.artifactId)!)),
      }));
    };
    // Loop verdict — the client's reaction to their demo (show.demoTour), the
    // "refine the prototype" signal that precedes the sign-off.
    const tour = demoAcceptance(program).rows;
    const verdictFor = (name: string): string | null => {
      const key = name.trim().toLowerCase();
      const row = tour.find((r) => (r.stakeholder ?? "").trim().toLowerCase() === key);
      return row?.verdict?.trim() || null;
    };
    const map = new Map<string, PersonaJourney>();
    for (const row of cast) {
      if (row.isRole) continue;
      const listen = row.heard ? itemsFor("listen", row.label) : [];
      const loop = itemsFor("show", row.label);
      const verdict = verdictFor(row.label);
      if (!listen.length && !loop.length && !verdict) continue;
      map.set(row.label, { listen, loop, verdict });
    }
    return map;
  }, [program, cast]);
  const [apprLink, setApprLink] = useState<{ who: string; url: string } | null>(null);
  const showApprLink = async (who: string, url: string, label: string) => {
    setApprLink({ who, url });
    setQOpen((s) => ({ ...s, [who]: true }));
    try {
      await navigator.clipboard.writeText(url);
      setNote(`Sign-off link copied — ${label} → ${displayPersonLabel(who)}. It's also shown in their row.`);
    } catch {
      setNote(`Sign-off link ready — copy it from ${displayPersonLabel(who)}'s row.`);
    }
    window.setTimeout(() => setNote(null), 6000);
  };
  const sendApproval = async (row: CastRow, item: SignoffItem) => {
    if (!onSendForApproval) return;
    try {
      const url = await onSendForApproval({
        artifactId: item.artifactId, movementId: item.movementId, artifactTitle: item.artifactTitle,
        approver: { name: row.label, role: row.role, email: stakeholderEmail(program, row.label) || undefined },
        snapshot: artifactDocument(program, item.artifactId) ?? undefined,
      });
      if (!url) throw new Error("no link returned");
      await showApprLink(row.label, url, item.artifactTitle);
    } catch (error) {
      setNote(`Couldn't send for approval: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setNote(null), 8000);
    }
  };

  // ── per-person link: existing pack's URL, else mint (returns the URL).
  // The URL ALWAYS renders inline; the clipboard is best-effort on top —
  // embedded previews and iframes deny clipboards silently, and a button
  // that only writes to a denied clipboard reads as broken.
  const [linkShown, setLinkShown] = useState<{ who: string; url: string } | null>(null);
  const [qOpen, setQOpen] = useState<Record<string, boolean>>({});
  // Company brief — who the client IS. A web-fetched DRAFT the operator
  // confirms or overrides; only their save writes it to the record.
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  // REOPEN is a re-mint, not a second verb: `mintFollowUpPack` clears `closedAt` on the
  // durable pack, so forcing the mint path is the whole of it. `reopen` only suppresses
  // the "there's already a link, just copy it" shortcut — everything below (the ask, the
  // loci, the send-moment pins) is the ordinary send it always was.
  const copyLink = async (row: CastRow, opts?: { reopen?: boolean }) => {
    try {
      const existing = opts?.reopen ? null : packFor(program, row.label, row.movementId);
      let url = existing ? portalLinkFor(program.id, existing) : null;
      if (!url && onMintFollowUp) {
        // THE ask on this person's link = the `on this link` bucket of the ONE owned-load
        // their card shows — sent as LOCI, so the linked page renders them through the ONE
        // renderer and an answer names the point it closes. Taking the bucket (not the
        // whole owned list) is what makes the card's breakdown TRUE: the pack caps the ask
        // at LINK_QUESTION_CAP and silently drops the rest, so a card promising more than
        // the bucket was describing a send that never happened (F6). Their kit script stays
        // the fallback when nothing is sendable: a person still gets a link.
        const owned = loadFor(row.label).onLink;
        const ask = owned.length
          ? owned.map((q) => ({ about: q.about, text: renderQuestion(ledger.store, q.about, "stakeholder").question }))
          : row.questions.map((text) => ({ about: "", text }));
        // The fallback is a DIFFERENT KIND of ask and the pack has to say so. Every
        // question on it carries `about: ""` — no point in the model, so nothing an
        // answer can be filed against. Unmarked, the recipient's page was
        // indistinguishable from a locus-backed one while closing nothing. We know
        // it here and only here: the ledger is in hand and owns nothing for them.
        const scripted = !owned.length;
        url = await onMintFollowUp({
          movementId: row.movementId, who: row.label,
          questions: ask.map((q) => q.text),
          loci: ask.map((q) => q.about),
          captureField: row.captureField, unnamed: row.isRole,
          ...(scripted ? { scripted: true } : {}),
        });
        // THE SEND MOMENT. The link is out, so every LOCUS it carries is now PINNED to
        // this recipient: a later re-derivation (or a bulk assign) cannot move it — it
        // has to surface in the inbox as a decision. Written through the ONE operator
        // write path, after the mint, so a pin never claims a link that wasn't created.
        // A send carrying no loci (kit-script fallback) pins nothing — in-flight with 0
        // sent questions stays unrepresentable.
        if (url && commits.canWrite) {
          const pins = pinsForSend({
            abouts: ask.map((q) => q.about),
            owner: { label: row.label, isRole: row.isRole },
            ownerRole: row.role,
            by: "operator", at: new Date().toISOString(),
          });
          if (pins.length) await commits.commitAction(pins, ledger.actions);
        }
      }
      if (!url) { setNote(`No link handler available for ${displayPersonLabel(row.label)} in this view.`); return; }
      setLinkShown({ who: row.label, url });
      setQOpen((s) => ({ ...s, [row.label]: true }));
      try {
        await navigator.clipboard.writeText(url);
        setNote(opts?.reopen
          ? `Link reopened and copied — ${displayPersonLabel(row.label)} can answer again. Their earlier answers are untouched.`
          : `Link copied — ${displayPersonLabel(row.label)}. It's also shown below their row.`);
      } catch {
        setNote(opts?.reopen
          ? `Link reopened — copy it from the field under ${displayPersonLabel(row.label)}'s row.`
          : `Link ready — copy it from the field under ${displayPersonLabel(row.label)}'s row.`);
      }
      window.setTimeout(() => setNote(null), 6000);
    } catch (error) {
      setNote(`Couldn't create the link: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setNote(null), 8000);
    }
  };

  // ── CLOSING a durable link. Two clicks, because it changes what a stakeholder
  // sitting on the link can do: the first arms, the second writes `closedAt` through the
  // same flow-mutation path every mint uses. It stops the link taking NEW answers and
  // does nothing else — no submission is deleted, the token keeps resolving, and their
  // recap still renders. Re-minting reopens it, and the armed control says so.
  const [closeArmed, setCloseArmed] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const closeLink = async (row: CastRow) => {
    if (!onCloseLink) return;
    if (closeArmed !== row.label) { setCloseArmed(row.label); return; }
    setCloseBusy(row.label);
    try {
      await onCloseLink(row.label);
      setNote(`Link closed — ${displayPersonLabel(row.label)} can't send new answers. Everything they already sent stays on the record; ↺ reopen re-mints the link.`);
    } catch (error) {
      setNote(`Couldn't close the link: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCloseBusy(null);
      setCloseArmed(null);
      window.setTimeout(() => setNote(null), 8000);
    }
  };

  /**
   * REGENERATION IN FLIGHT — the dispatch and the "is it back yet" both live in
   * `useArtifactRegen` now, because the Library shows the same documents and could
   * not offer the same act. The board keeps only what is its own: the toast.
   */
  const { regenerate, regenerating, regeneratingIds } = useArtifactRegen(program, onRunAgent, (message) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 6000);
  }, runningAgentIds);

  // First generation of an artifact whose upstream inputs are ready. Same
  // dispatch as regenerate; cleared implicitly when the document lands and the
  // station stops being generatable.
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const generate = (card: ArtifactCardModel) => {
    if (!onRunAgent) return;
    onRunAgent(card.id, card.movementId);
    setGenBusy((s) => ({ ...s, [card.id]: true }));
    setNote(`Generating ${card.title} from the record — the station fills in when it lands.`);
    window.setTimeout(() => setNote(null), 6000);
  };

  // AUTO-ACCEPT heard voices on mount — the retired canvas used to do this, and
  // without it no session ever marks evidence-backed voices Heard. Idempotent:
  // attestHeardRoster returns null once settled.
  useEffect(() => {
    if (!onSaveInputs) return;
    const listen = flowMovements().find((m) => m.id === "listen");
    if (!listen) return;
    const heardNames = [...new Set(movementEvidence(program, listen).map((e) => e.who).filter(Boolean))];
    if (!heardNames.length) return;
    const proposal = attestHeardRoster(program, heardNames);
    if (!proposal) return;
    void onSaveInputs("listen", { interviewRoster: proposal.value }, {
      silent: true,
      attest: {
        action: `Roster auto-attested — ${proposal.attested.length} voice${proposal.attested.length === 1 ? "" : "s"} Heard on evidence`,
        detail: proposal.attested.join(", ").slice(0, 140),
      },
    });
  }, [program, onSaveInputs]);

  const briefSet = !!String(readMovementInputs(program, "frame").companyBrief ?? "").trim();
  const openBrief = () => {
    setBriefText(String(readMovementInputs(program, "frame").companyBrief ?? ""));
    setBriefOpen(true);
  };
  const fetchBrief = async () => {
    setBriefBusy(true);
    try {
      const industry = String(readMovementInputs(program, "frame").industry ?? "");
      // The CLIENT is the company; the programme name is only a fallback hint.
      const { data, error } = await supabase.functions.invoke("company-brief", {
        body: { company: program.client || program.name, industry, hint: program.client ? program.name : "" },
      });
      if (error) throw new Error(error.message);
      const brief = typeof (data as { brief?: unknown })?.brief === "string" ? (data as { brief: string }).brief.trim() : "";
      if (!brief) throw new Error("No brief returned.");
      setBriefText(brief);
    } catch (error) {
      setNote(`Couldn't fetch the brief: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setNote(null), 8000);
    } finally {
      setBriefBusy(false);
    }
  };
  const saveBrief = async () => {
    if (!onSaveInputs) return;
    await onSaveInputs("frame", { companyBrief: briefText.trim() },
      { attest: { action: "Company brief updated" } });
    setBriefOpen(false);
    setNote("Company brief saved — the charter, kit, ontology and atlas ground in it on their next generation.");
    window.setTimeout(() => setNote(null), 6000);
  };

  /**
   * COPY, WITH A FALLBACK THAT ACTUALLY DOES SOMETHING.
   *
   * `navigator.clipboard.writeText` is refused with NotAllowedError whenever the
   * document is not focused or the page sits in an embed without clipboard
   * permission — both ordinary, neither the operator's fault. The old catch told
   * them to "select the link text and copy it manually" and then left the text
   * unselected, which is a instruction, not a fallback.
   *
   * So the fallback does the selecting: the field is focused and its text
   * selected, `execCommand("copy")` is tried (it works in exactly the embedded
   * cases the async API refuses), and only if THAT fails does it ask for a
   * keystroke — on text already highlighted, so the keystroke is all that is left.
   */
  const linkFieldRef = useRef<HTMLInputElement | null>(null);
  const copyShown = async () => {
    if (!linkShown) return;
    const done = (msg: string) => { setNote(msg); window.setTimeout(() => setNote(null), 5000); };
    try {
      await navigator.clipboard.writeText(linkShown.url);
      done(`Link copied — ${displayPersonLabel(linkShown.who)}.`);
      return;
    } catch { /* refused — fall through to the selection path */ }
    const field = linkFieldRef.current;
    if (field) {
      field.focus();
      field.select();
      try {
        if (document.execCommand("copy")) {
          done(`Link copied — ${displayPersonLabel(linkShown.who)}.`);
          return;
        }
      } catch { /* older engines and locked-down embeds both land here */ }
    }
    done("The clipboard is blocked here — the link is selected, press ⌘C (Ctrl+C) to copy it.");
  };

  // ── meeting invite: a VISIBLE inline date bar (hidden-input showPicker()
  // throws in embedded/iframe contexts, which read as a dead button), then
  // schedule the follow-up and download the .ics — classic's two halves.
  const [invitee, setInvitee] = useState<CastRow | null>(null);
  const [inviteDate, setInviteDate] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const pickDate = (row: CastRow) => {
    setInvitee((current) => (current?.label === row.label ? null : row));
    setInviteDate("");
  };
  const confirmInvite = async () => {
    if (!inviteDate || !invitee) return;
    try {
      await onScheduleFollowUp?.(invitee.movementId, invitee.label, inviteDate);
      const ics = buildMeetingIcs({
        who: invitee.label, email: stakeholderEmail(program, invitee.label), date: inviteDate,
        programmeName: program.name, questions: invitee.questions,
      });
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${invitee.movementId}-${invitee.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
      a.click(); URL.revokeObjectURL(url);
      setNote(`Invite downloaded · follow-up scheduled — ${displayPersonLabel(invitee.label)}, ${inviteDate}`);
    } catch (error) {
      setNote(`Couldn't schedule: ${error instanceof Error ? error.message : String(error)}`);
    }
    setInvitee(null); setInviteDate("");
    window.setTimeout(() => setNote(null), 6000);
  };

  // ── capture: append attributed evidence in the one stored evidence format.
  const [capFor, setCapFor] = useState<CastRow | "open" | null>(null);
  const [capWho, setCapWho] = useState<string>("");
  const [capText, setCapText] = useState("");
  /** Files extracted by flow-extract and waiting for the operator to read them.
   * Held, not written: the dialog's contract is that NOTHING is evidence until
   * Capture is pressed, and an extraction is exactly the kind of text that has
   * to be looked at first (a spreadsheet, a deck, a scanned PDF). */
  const [capDocs, setCapDocs] = useState<Array<{ filename: string; text: string; sourceKey?: string }>>([]);
  /**
   * AN ATTACHMENT THAT IS ALSO A DICTIONARY.
   *
   * "Add to the record" files a document as evidence — the edge flattens it to
   * prose and it lands as a "— Document —" entry. That is the right home for an
   * interview transcript and the wrong one for a data dictionary, whose whole
   * value is in its columns: filed as prose it reads fine and closes nothing.
   *
   * So the file is ALSO read here, by the same parser the Inbox ask uses, and when
   * it parses the operator is offered the second reading. Nothing is redirected:
   * they attached it to the record, so it still becomes evidence. This only stops
   * the answers inside it going unnoticed.
   */
  const [capDict, setCapDict] = useState<{
    name: string; fields: number; closes: number; csv: string;
    /** how many attachments this reading came from — the sentence is plural above one */
    files: number;
    /** open questions on the entities this file NAMES — the honest denominator */
    inScope: number; entities: string[];
  } | null>(null);
  /** Read, never written from here — one definition, in lifecycle.ts. */
  /** Who the stage question is now ON — read from the queue, never re-derived here. */
  const readAttachedDictionary = async (files: File[]) => {
    // SEQUENTIALLY, into one running CSV. A system's dictionary arrives as several
    // per-object workbooks, so the whole selection is one reading — and merging
    // through the SAME rule the stored field uses means the count offered here is
    // the count that lands. Reading them in parallel and merging into state would
    // race: each result computed from a `capDict` the previous had not written.
    let csv = "";
    let read = 0;
    for (const file of files) {
      try {
        const wb = isSpreadsheetName(file.name) ? await readDictionaryWorkbook(await file.arrayBuffer(), file.name) : null;
        const own = wb ? wb.csv : await file.text();
        if (!parseDictionaryCsv(own).fields.length) continue;   // not a dictionary; not an error
        csv = mergeDictionaryCsv(csv, own);
        read += 1;
      } catch {
        // Unreadable as a dictionary is not an error here — it is simply not one,
        // and the extraction path reports its own failures.
      }
    }
    const parsed = parseDictionaryCsv(csv, files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${read} files`);
    if (!parsed.fields.length) { setCapDict(null); return; }
    const openTyping = new Set(ledger.typingLoci.map((i) => i.about.split("#")[0]));
    const cover = dictionaryCoverage(parsed.fields, openTyping);
    setCapDict({
      name: parsed.name, fields: parsed.fields.length, closes: cover.matched,
      inScope: cover.inScope, entities: cover.entities, csv, files: read,
    });
  };

  const openCapture = (row?: CastRow) => {
    setCapFor(row ?? "open");
    setCapWho(row?.label ?? cast[0]?.label ?? "");
    setCapText("");
    setCapDocs([]);
    setCapDict(null);   // a new capture starts with no reading of a previous file
  };
  const saveCapture = async () => {
    const row = cast.find((r) => r.label === capWho);
    const text = capText.trim();
    const docs = capDocs.filter((doc) => doc.text.trim());
    if (!row || (!text && !docs.length) || !onSaveInputs) return;
    const existing = String(readMovementInputs(program, row.movementId)[row.captureField] ?? "");
    const stamp = evidenceStamp();
    // The one identity the dialog is capturing FOR — the same one the typed
    // header names. A file is attributed to the person selected above, never
    // to the operator who happened to be holding it.
    const person = row.isRole ? row.role : row.label;
    const header = `— ${[person, row.isRole ? "" : row.role, stamp].filter(Boolean).join(", ")} —`;
    const docTitle = (filename: string) => filename.replace(/\.[^.]+$/, "");
    // The document header the record already parses (flowShellData: kind
    // "document", with the optional "[source: …]" pointer to the stored
    // original so the Library can offer it back as a native download).
    const docBlocks = docs.map((doc) =>
      `— Document: ${docTitle(doc.filename)}, provided by ${person}, ${stamp} —\n${doc.sourceKey ? `[source: ${doc.sourceKey}]\n` : ""}${doc.text.trim()}`);
    const appended = [existing.trimEnd(), ...(text ? [`${header}\n${text}`] : []), ...docBlocks]
      .filter(Boolean).join("\n\n");
    await onSaveInputs(row.movementId, { [row.captureField]: appended }, {
      attest: docs.length
        ? {
            action: `Document added — ${docs.map((doc) => docTitle(doc.filename)).join(" · ")}`,
            detail: `provided by ${row.label}${text ? " · with a typed capture" : ""}`,
          }
        : { action: `Captured — ${row.label}` },
    });
    onRunAgent?.("contradiction-detector", row.movementId);
    setCapFor(null); setCapText(""); setCapDocs([]); setCapDict(null);
    const what = docs.length
      ? `${docs.length} document${docs.length === 1 ? "" : "s"} added${text ? " with a capture" : ""}`
      : "Captured";
    setNote(row.movementId === "listen"
      ? `${what} — ${displayPersonLabel(row.label)}. The Ontology and Atlas will refresh for ${row.area}.`
      : `${what} — ${displayPersonLabel(row.label)}. The Charter and Discovery Kit will refresh.`);
    window.setTimeout(() => setNote(null), 6000);
  };

  // ── operator verbs (Assign / Schedule / Respond): append an action through the
  // fingerprint-safe Listen field; useProgramLedger re-derives ownership on the next
  // render. Candidate owners are the people the kit already knows.

  // Artifact-ask marks (requested / has-none) — appended to the fingerprint-safe
  // `_artifactAsks` field via the SAME silent-save channel as operator actions.

  return (
    <div className="v3ln">
      <div className="v3ln-tabs" role="tablist" aria-label="Line projections">
        <button type="button" role="tab" aria-selected={tab === "work"}
          className={tab === "work" ? "on" : undefined} onClick={() => setTab("work")}>
          Work<span>the board — bands, stations, gates</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "discovery"}
          className={tab === "discovery" ? "on" : undefined} onClick={() => setTab("discovery")}>
          Discover<span>the people — links, capture, invites</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "record"}
          className={tab === "record" ? "on" : undefined} onClick={() => setTab("record")}>
          Record<span>who said what, when — by area</span>
        </button>
      </div>

      {tab === "work" ? (
        <>
        {/* THE BURN-DOWN STRIP IS HIDDEN (on request, 2026-08-12). "206 open · 0
            answered · 0 need an owner · 106 → dictionary · 4 seams" is five
            programme-wide numbers stacked at the top of the board, none of them a
            thing to do — and each is already stated where it can be acted on: the
            open count on the Discover cards, the dictionary bucket on the Inbox's
            dictionary panel, the seams on their own band. Nothing is recomputed
            anywhere; the numbers still exist, they are just no longer restated as a
            headline above the work. */}
        {/* ROUND / HEARD / CONVERGENCE HIDDEN (on request, 2026-08-12), the last
            of the headline strips to go. On a programme where nothing has been
            heard yet it read "Round 1 · 0 attributed closures · 0% closed · 90.9%
            incl. pre-filled · nothing heard yet" — five provisional readings of
            the same fact, none of them an action. Heard is still a button on
            Discover; convergence is still on the gate that consumes it. */}
        {/* UnownedSeamStrip hidden by request (2026-08-09) — the same numbers stay
            readable in the goal line (unowned/seams) and the inbox sections. */}
        </>
      ) : null}

      {note ? <div className="v3ln-toast" role="status">{note}</div> : null}

      {tab === "work" ? <div className="v3ln-spine">{model.bands.map((band, bi) => (
        <div key={band.id} data-mv={band.id} className="v3ln-spine-row">
        <span className="v3ln-rail-n" aria-hidden="true">{String(bi + 1).padStart(2, "0")}</span>
        <section className={`v3ln-band${band.id === "loop" ? " loop" : ""}`} aria-label={band.name}>
          <header className="v3ln-band-h spine">
            <span className="v3ln-band-n">{band.name}</span>
            {band.half ? <span className="v3ln-half">{band.half}</span> : null}
            <span className="v3ln-scope">{band.scope}</span>
            <span className="v3ln-band-sp" />
            <button type="button" className={`v3ln-chip ${band.chip.tone}`}
              onClick={() => setGateFor(band)}
              title={`Open the ${band.name} gate's criteria`}>
              {band.chip.text}<span className="v3ln-chev" aria-hidden="true">›</span>
            </button>
          </header>
          {band.intake ? (
            <div className="v3ln-intake"><span>evidence in</span>{band.intake}
              {band.id === "listen" && onSaveInputs && cast.length > 0 ? (
                <button type="button" className="v3ln-a" onClick={() => openCapture()}>＋ add to the record</button>
              ) : null}
            </div>
          ) : null}
          {band.id === "loop" && band.stations.some((s) => s.lane) ? (
            // The Design Loop is a LEDGER SURFACE, not four refreshable cards: the
            // operator's four built artifacts, the design review round STAGED to the
            // loop's own sequence, and a deviation section that draws only when there
            // are deviations. `onGoDiscover` is how the band hands Listen's burn-down
            // back to the tab that works it — the same setTab the Heard stat uses.
            // See DesignLoopZones.tsx and docs/aura/surface-redesign.md.
            <DesignLoopZones band={band} program={program} ledger={ledger}
              roster={roundRoster}
              onOpen={openStation}
              onRegen={regenerate}
              onGenerate={onRunAgent ? generate : undefined}
              onMintReview={onMintReview}
              onDesignRound={onDesignRound}
              /* The consumers only ask "is this one in flight", so they get booleans:
                 the document snapshot is this component's own bookkeeping for knowing
                 when the run came back, not something a child should have to know. */
              regenBusy={Object.fromEntries(regeneratingIds.map((id) => [id, true]))}
              genBusy={genBusy} />
          ) : (
          <div className={`v3ln-stns n${band.stations.length + (band.id === "frame" && onSaveInputs ? 1 : 0)}`}>
            {/* The Company Brief leads Frame: who the client IS comes before
              * why we're doing this. An input station, not a generated one —
              * it opens the fetch/override dialog rather than a studio. */}
            {band.id === "frame" && onSaveInputs ? (
              <button type="button" className="v3ln-stn" onClick={openBrief}
                title={briefSet ? "Company Brief — on the record; open to edit or refetch" : "Company Brief — not set; fetch a web-grounded draft or write your own"}>
                <span className="v3ln-stn-h">
                  <span className={`v3ln-g ${briefSet ? "m4" : "m0"}`} aria-hidden="true">{briefSet ? "●" : "○"}</span>
                  <span className="v3ln-stn-n">Company Brief</span>
                </span>
                <span className="v3ln-stn-sub">Who the client is — web-fetched draft, confirmed by you</span>
              </button>
            ) : null}
            {band.stations.map((s) => (
              <Station key={s.id} station={s} onOpen={openStation}
                onRegen={regenerate}
                onGenerate={onRunAgent ? generate : undefined}
                regenerating={!!s.card && regenerating(s.card.id)}
                generating={!!(s.card && genBusy[s.card.id])} />
            ))}
          </div>
          )}
        </section>
        </div>
      ))}</div> : null}

      {tab === "work" ? (
        <div className="v3ln-legend" role="note" aria-label="How to read the board">
          <span className="v3ln-sl">Maturity</span>
          {([0, 1, 2, 3, 4] as const).map((m) => (
            <span key={m} className="v3ln-lg">
              <i className={`v3ln-lg-sw m${m}`} aria-hidden="true" />
              <span className={`v3ln-g m${m}`} aria-hidden="true">{LINE_GLYPHS[m]}</span>
              {MATURITY_WORDS[m]}
            </span>
          ))}
          <span className="v3ln-lg"><span className="v3ln-rf">evidence moved</span>the claims under it moved — rebuild to re-ground it</span>
        </div>
      ) : null}

      {tab === "discovery" && cast.length > 0 ? (
        <section className="v3ln-band" aria-label="Discover">
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">Discover</span>
            {cast[0]?.movementId === "frame" ? (
              <span className="v3ln-scope">the sponsor is the starting voice — the Kit casts the rest</span>
            ) : null}
            <span className="v3ln-band-sp" />
            {castAreas.length > 1 ? (
              <label className="v3ln-filter">
                <span>Area</span>
                <select value={castAreas.includes(areaFilter) ? areaFilter : ""}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  aria-label="Filter the roster by area">
                  <option value="">All areas · {cast.length}</option>
                  {castAreas.map((area) => (
                    <option key={area} value={area}>{area} · {cast.filter((r) => r.areas.includes(area)).length}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {/* Demoted from "N of N linked/responded" (a completion-looking roster
                count over a ledger with 0 real closures) to a plain reachable count. */}
            <span className="v3ln-scope">{filteredCast.length} on the roster{areaFilter && castAreas.includes(areaFilter) ? ` in ${areaFilter}` : ""}</span>
            {onSaveInputs ? (
              <button type="button" className="v3ln-a" onClick={() => openCapture()}>＋ add to the record</button>
            ) : null}
          </header>
          {/* THE BURN-DOWN IS NOT A STAKEHOLDER'S BUSINESS. It moved to Work
              (2026-08-12): "221 open · 121 → dictionary · 4 seams" is how the
              OPERATOR judges the programme's state, and Discover exists for the
              questions and confirmations aimed at the people being asked. Nothing
              was lost — Work is where it now lives, beside the round and the
              convergence it belongs with. */}
          {/* The operator inbox moved to the INBOX view (2026-08-10, by request):
              Discover shows WHO TO ENGAGE and their questions; everything the
              OPERATOR must resolve — assign / sessions / adjudicate / in-flight /
              the dictionary ask — is the Inbox's job. One "Inbox", one meaning. */}
          {/* Discover as an engagement dashboard: who needs attention and why, sorted by
              state. Ageing on in-flight is operator-tracked until the link is live. */}
          {/* THE LIFECYCLE STRIP IS GONE FROM DISCOVER (2026-08-13).
              It was built when a lifecycle's stage question reached nobody — the
              strip WAS the finding's only appearance. Since those questions began
              routing to their owners, every confident row said the same thing: "on
              Sales Leaders's list", "on Legal's list" — pointing at the person cards
              directly below it. Discover is organised by PERSON; a block organised by
              ENTITY, restating what those cards already carry, is a second axis over
              the same facts.

              ONE THING IS NOT ON A CARD: the readings with a single signal behind
              them, which have no question anywhere and so are now invisible. That is
              a miss. It belongs on the Record — the surface for what was found and
              when — rather than on the one for asking people things. Flagged in the
              worklog, not silently dropped. */}
          <div className="v3ln-engbar" role="note" aria-label="Engagement — who needs attention">
            <span className="v3ln-engbar-l">Who to engage</span>
            <span className="v3ln-engpill is-ready"><b>{engSummary.ready}</b> ready</span>
            <span className="v3ln-engpill is-in-flight"><b>{engSummary["in-flight"]}</b> in flight{engSummary.oldest > 0 ? ` · oldest ${ageStr(engSummary.oldest)}` : ""}</span>
            <span className="v3ln-engpill is-blocked"><b>{engSummary.blocked}</b> blocked</span>
            <span className="v3ln-engpill is-done"><b>{engSummary.done}</b> done for now</span>
            {/* HEARD, BACK — and on the surface it is about. Hiding the Work strip
                (2026-08-12) took the last rendering of it with it, which was a real
                loss: heard is the roster's own progress, and Discover IS the roster.
                It reads here as one more state of the people on this board, beside
                ready / in flight / blocked, rather than as a programme headline
                above the work. */}
            <span className="v3ln-engpill is-heard"><HeardReadout heard={ledger.heard} /></span>
            <span className="v3ln-engbar-note">ageing is operator-tracked (the chase), not a system-tracked reply — until the link is live</span>
          </div>
          {/* "NOBODY TO ASK" MOVED TO THE INBOX (2026-08-12). Its own note told
              the operator to "name someone for the role in the Discovery Kit, or
              reassign the questions in the Inbox" — an operator decision, printed
              on the surface for stakeholder questions. The miss still stays
              visible; it is visible where it can be acted on. */}
          <div className="v3ln-cast">
            {sortedCast.map((row, i) => {
              const eng = engagementByLabel.get(row.label);
              const prevState = i > 0 ? engagementByLabel.get(sortedCast[i - 1].label)?.state : undefined;
              const showHeader = eng && eng.state !== prevState;
              return (
              <Fragment key={row.label}>
              {showHeader ? <div className={`v3ln-eng-hdr is-${eng!.state}`}>{ENG_LABEL[eng!.state]}</div> : null}
              <div className="v3ln-cr"
                onClick={(e) => {
                  // The whole row toggles the expansion — except clicks that
                  // already mean something (buttons, links, inputs).
                  //
                  // `summary` belongs on this list and was missing: it is an
                  // interactive control that is not a <button>, so a click on a
                  // question-group heading opened the group AND fell through to
                  // here, which collapsed the whole drawer in the same gesture.
                  // The section appeared not to open at all.
                  if ((e.target as HTMLElement).closest("button, a, input, select, textarea, summary")) return;
                  setQOpen((s) => ({ ...s, [row.label]: !s[row.label] }));
                }}>
                {/* The top bar holds everything actionable and NEVER moves —
                  * expansion only ever adds a body underneath. */}
                <div className="v3ln-cr-top">
                  <span className={`v3ln-dot ${row.heard ? "d" : row.awaiting ? "w" : "t"}`}
                    title={row.heard ? "Heard — evidence on the record" : row.awaiting ? "Link out — awaiting response" : "To reach"} />
                  <span className="v3ln-cr-who">
                    {/* The roster stores an unnamed voice as "<Role> — TBC", a machine
                      * token. Rendered through the ONE helper the Inbox already uses, so
                      * Discover stops leaking it as if it were somebody's name. */}
                    <b>{displayPersonLabel(row.label)}</b>
                    {/* ALWAYS RENDERED, blank when there is nothing to say. It used to
                        appear only for people whose role differs from their name, so a
                        roster row was two lines tall for some and three for others and
                        nothing lined up down the column. An empty line reserved costs
                        one row of leading; a ragged column costs every scan. */}
                    <span className="v3ln-cr-role">
                      {row.isRole ? "role — assign a name to send"
                        : row.role && row.role !== row.label ? row.role : ""}
                    </span>
                    {(() => {
                      const e = engagementByLabel.get(row.label);
                      if (!e) return null;
                      const load = loadFor(row.label);
                      const aged = e.state === "in-flight" && e.ageDays != null;
                      return (
                        <span className="v3ln-engrow">
                          <span className={`v3ln-eng is-${e.state}`}>{ENG_LABEL[e.state]}</span>
                          {aged ? (
                            <span className={`v3ln-age${e.ageDays! >= 21 ? " hot" : e.ageDays! >= 9 ? " warm" : ""}`}
                              title="operator-tracked — the team's chase, timed by hand (not a system-tracked reply until the link is live)">
                              awaiting · {ageStr(e.ageDays!)} · operator-tracked
                            </span>
                          ) : e.state === "in-flight" ? <span className="v3ln-age">awaiting response · operator-tracked</span>
                          : e.state === "blocked" && e.needsSession ? <span className="v3ln-eng-why" title="A jointly-owned seam — settled in a session, not solo. It's in the session queue.">only a joint session left</span>
                          : null}
                          {/* THE RECONCILIATION LINE (F6). One sentence, from the one
                            * owned-load: the headline the button shows, and where the
                            * rest of it went. No second derivation, and no subtraction
                            * left to the operator. */}
                          {personOwned(load) ? (
                            <span className="v3ln-eng-why"
                              title="Every locus this person owns, split by whether a link minted now can carry it: the pack caps the ask, blocked loci need unsticking first, and typing loci are answered by the data dictionary rather than by them.">
                              {ownedLoadBreakdown(load)}{e.state === "ready" ? " — send a link" : ""}
                            </span>
                          ) : null}
                        </span>
                      );
                    })()}
                  </span>
                  {/* AREA CHIPS REMOVED (2026-08-11, by request). Up to three turf
                      tags plus a "+N more" sat on every roster row and said nothing
                      about what to do with the person; the row's job is who to reach
                      and what they owe. Filtering by area is NOT lost — the "Area"
                      dropdown in the band header above does it, with a count per
                      area, and is a labelled control rather than a tag you have to
                      guess is clickable. */}
                  <span className="v3ln-cr-right">
                  {(() => {
                    // THE HEADLINE — the owned-load's own total, the same object the
                    // breakdown line and the minted link read. One number, one definition.
                    const load = loadFor(row.label);
                    return (
                  <button type="button" className="v3ln-cr-qbtn" aria-expanded={!!qOpen[row.label]}
                    title={`${ownedLoadBreakdown(load)}. Open unknowns on loci this person OWNS — seam questions are in the session queue, not here.`}
                    onClick={() => setQOpen((s) => ({ ...s, [row.label]: !s[row.label] }))}>
                    {personOwned(load)} owned question{personOwned(load) === 1 ? "" : "s"}
                    <span aria-hidden="true">{qOpen[row.label] ? " ▴" : " ▾"}</span>
                  </button>
                    );
                  })()}
                  {(() => {
                    // The persona's journey at a glance: Listen (ontology) then
                    // Loop (prototype). Each segment only appears once that phase
                    // has a sign-off in play, so the strip grows as the voice
                    // travels the spine.
                    const j = journeys.get(row.label);
                    if (!j || (!j.listen.length && !j.loop.length && !j.verdict)) return null;
                    // A SEGMENT APPEARS WHEN THE PERSON HAS MOVED, not when they exist.
                    //
                    // It used to render for any state but "none", and "open" is the
                    // state everybody starts in and stays in until they sign something:
                    // sign-off items exist, none approved, none in review. On the live
                    // CRM that was 42 chips across 21 rows, every one reading "open",
                    // every dot the same colour — two columns of the row spent saying
                    // what the engagement chip beside them ("Ready") already said.
                    // The information was always in the TRANSITION, so only the
                    // transition is drawn now: approved, in review, or a verdict.
                    // `journeySegments` decides WHETHER; this only decides how it reads.
                    const seg = (label: string, state: ReturnType<typeof phaseState>, extra?: string) => (
                        <span className={`v3ln-jseg ${state}`} title={`${label} — ${extra || state}`}>
                          <span className="v3ln-jdot" aria-hidden="true" />{label}{extra ? ` · ${extra}` : ""}
                        </span>
                      );
                    const verdictShort = j.verdict
                      ? /objection/i.test(j.verdict) ? "objection" : /changes/i.test(j.verdict) ? "changes" : /accept/i.test(j.verdict) ? "accepted" : j.verdict.toLowerCase()
                      : undefined;
                    const show = journeySegments(j, designRoundOpened);
                    const listenSeg = show.listen ? seg("Listen", show.listen) : null;
                    const loopSeg = show.loop ? seg("Loop", show.loop, verdictShort) : null;
                    if (!listenSeg && !loopSeg) return null;
                    return (
                      <span className="v3ln-journey" aria-label={`${displayPersonLabel(row.label)} journey`}>
                        {listenSeg}
                        {loopSeg}
                      </span>
                    );
                  })()}
                  <span className="v3ln-cr-act">
                  {(() => {
                    // THE LINK'S STATE, read through the ONE closure rule the edge
                    // enforces (`linkIsOpen` → `acceptsSubmission`). A closed link keeps
                    // its row and SAYS it is closed — losing the buttons silently is how
                    // the operator ends up unable to tell "finished" from "never sent".
                    const pack = packFor(program, row.label, row.movementId);
                    const closed = !!pack && !linkIsOpen(pack);
                    const armed = closeArmed === row.label;
                    const busy = closeBusy === row.label;
                    return (
                      <>
                        <button type="button" className="v3ln-a" onClick={() => void copyLink(row)}
                          title={closed
                            ? "Their durable link — closed to new answers, but it still opens and still shows them their recap"
                            : "Their one durable link — minted once, reused forever"}>⎘ link</button>
                        {closed ? (
                          <>
                            <span className="v3ln-linkclosed" title={`Closed on ${pack?.closedAt?.slice(0, 10) ?? "record"} — it still opens and shows their recap, it just can't take new answers.`}>
                              link closed
                            </span>
                            {onMintFollowUp ? (
                              <button type="button" className="v3ln-a" onClick={() => void copyLink(row, { reopen: true })}
                                title="Re-mint the current ask on the same token — the link takes answers again. Nothing already sent is changed.">↺ reopen</button>
                            ) : null}
                          </>
                        ) : onCloseLink && pack ? (
                          <button type="button" className={`v3ln-a${armed ? " v3ln-linkclose-armed" : ""}`} disabled={busy}
                            onClick={() => void closeLink(row)}
                            onBlur={() => setCloseArmed((who) => (who === row.label ? null : who))}
                            title="Stop this link taking new answers. Nothing already sent is deleted or changed, and ↺ reopen re-mints it.">
                            {busy ? "closing…" : armed ? "confirm — close (reopen any time)" : "✕ close link"}
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                    {onSaveInputs ? (
                      <button type="button" className="v3ln-a" onClick={() => openCapture(row)}
                        title={`Capture what ${displayPersonLabel(row.label)} said`}>✎ capture</button>
                    ) : null}
                    {onScheduleFollowUp ? (
                      <button type="button" className="v3ln-a" onClick={() => pickDate(row)}
                        title="Schedule a follow-up and download the calendar invite">🗓 invite</button>
                    ) : null}
                  </span>
                  </span>
                </div>
                {qOpen[row.label] ? (
                  <div className="v3ln-cr-body">
                    {/* The async list = OPEN unknowns on loci this person OWNS, derived from
                        the ledger (soloByOwner), NOT area-inherited kit questions. Seam
                        questions are excluded — they're in the session queue. */}
                    {(() => {
                      const owned = ownedQuestionsFor.get(row.label) ?? [];
                      const seams = seamPairsFor.get(row.label) ?? [];
                      if (!owned.length) return (
                        <p className="v3ln-cr-noq">No open unknowns on loci {displayPersonLabel(row.label)} owns.{seams.length ? ` Their open work is a joint session — it's in the session queue (${seams.join(", ")}).` : " Their durable link still carries the interview script."}</p>
                      );
                      return (
                        <>
                        {/* The card header already prints this sentence; repeating
                            it at the top of the drawer said the same arithmetic
                            twice, two lines apart. */}
                        {/* Every owned locus is listed, including the ones a link minted
                            now cannot carry — but the REASON is a property of the bucket,
                            so it is stated once as a section heading instead of tagged
                            onto every row. Ten typing questions used to print "answered
                            by the data dictionary, not by them" ten times. */}
                        {ownedLoadSections(owned).map(({ bucket, section, items }) => (
                          // <details>, so the disclosure is keyboard-operable and works
                          // with no JS — the same idiom the prototype nav uses. The
                          // dictionary section starts closed: 36 rows nobody will answer
                          // buried the eight that are actually addressed to this person.
                          <details key={bucket} className={`v3ln-cr-qgroup ${bucket}`} open={section.defaultOpen}>
                            <summary className="v3ln-cr-qgroup-h">
                              <span className="v3ln-cr-qgroup-t">{section.title}</span>
                              <span className="v3ln-cr-qgroup-n">{items.length}</span>
                              <span className="v3ln-cr-qgroup-note">{section.note}</span>
                            </summary>
                            {/* A bucket routed away from this person is COUNTED, not
                                transcribed — see `listRows`. */}
                            {section.listRows ? (
                              <ul className="v3ln-cr-qs owned">
                                {items.map((q) => (
                                  <li key={q.about} title={q.about}>
                                    <span className="v3ln-cr-qtype">{q.typeTag}</span>{q.question}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        ))}
                        {seams.length ? (
                          <p className="v3ln-cr-seamnote">＋ seam questions ({seams.join(", ")}) are in the session queue — a joint session, not solo.</p>
                        ) : null}
                        </>
                      );
                    })()}
                    {linkShown?.who === row.label ? (
                      <span className="v3ln-cr-url-row">
                        <input ref={linkFieldRef} className="v3ln-cr-url" readOnly value={linkShown.url}
                          onFocus={(e) => e.currentTarget.select()}
                          aria-label={`${displayPersonLabel(row.label)}'s durable link`} />
                        <button type="button" className="v3ln-a" onClick={() => void copyShown()}
                          title="Copy the link">⧉ copy</button>
                      </span>
                    ) : null}
                    {(() => {
                      const j = journeys.get(row.label);
                      if (!j || !onSendForApproval) return null;
                      const signoffRow = (item: SignoffItem) => (
                        <span key={item.movementId + item.artifactId} className="v3ln-cr-appr-row">
                          <span className={`v3ln-appr-dot ${item.status}${item.preDatesDocument ? " old" : ""}`} aria-hidden="true" />
                          <span className="v3ln-cr-appr-n">{item.artifactTitle}</span>
                          <span className="v3ln-cr-appr-s">
                            {item.preDatesDocument ? "approved an older version"
                              : item.status === "in-review" ? "sent — awaiting verdict"
                              : item.status === "changes" ? "changes requested"
                              : item.status === "approved" ? "approved" : "not sent"}
                          </span>
                          {item.status === "in-review" && item.token ? (
                            <button type="button" className="v3ln-a"
                              onClick={() => void showApprLink(row.label, approvalLinkFor(program.id, { token: item.token! }), item.artifactTitle)}>
                              ⎘ copy link</button>
                          ) : item.sendable ? (
                            <button type="button" className="v3ln-a" onClick={() => void sendApproval(row, item)}>
                              {item.preDatesDocument ? "re-request" : item.status === "changes" ? "re-send" : "send for sign-off"}
                            </button>
                          ) : null}
                        </span>
                      );
                      return (
                        <>
                          {j.listen.length ? (
                            <div className="v3ln-cr-appr">
                              <span className="v3ln-cr-appr-t">Listen — validate &amp; sign off the ontology</span>
                              {j.listen.map(signoffRow)}
                            </div>
                          ) : null}
                          {j.loop.length || j.verdict ? (
                            <div className="v3ln-cr-appr">
                              <span className="v3ln-cr-appr-t">Design Loop — refine the prototype, sign off once aligned</span>
                              {j.verdict ? (
                                <span className="v3ln-cr-appr-row">
                                  <span className={`v3ln-appr-dot ${/objection/i.test(j.verdict) ? "changes" : /accept/i.test(j.verdict) && !/changes/i.test(j.verdict) ? "approved" : "in-review"}`} aria-hidden="true" />
                                  <span className="v3ln-cr-appr-n">Prototype demo</span>
                                  <span className="v3ln-cr-appr-s">{j.verdict.toLowerCase()}</span>
                                </span>
                              ) : null}
                              {j.loop.map(signoffRow)}
                            </div>
                          ) : null}
                          {apprLink?.who === row.label ? (
                            <span className="v3ln-cr-url-row">
                              <input className="v3ln-cr-url" readOnly value={apprLink.url}
                                onFocus={(e) => e.currentTarget.select()}
                                aria-label={`${displayPersonLabel(row.label)}'s sign-off link`} />
                              <button type="button" className="v3ln-a"
                                onClick={() => void showApprLink(row.label, apprLink.url, "the sign-off")}
                                title="Copy the link">⧉ copy</button>
                            </span>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
                {invitee?.label === row.label ? (
                  <span className="v3ln-cr-invite">
                    <input type="date" value={inviteDate} onChange={(e) => setInviteDate(e.target.value)}
                      aria-label={`Follow-up date for ${displayPersonLabel(row.label)}`} />
                    <button type="button" className="v3ln-btn" disabled={!inviteDate}
                      onClick={() => void confirmInvite()}>Schedule &amp; download invite</button>
                    <button type="button" className="v3ln-a" onClick={() => setInvitee(null)}>cancel</button>
                  </span>
                ) : null}
              </div>
              </Fragment>
              );
            })}
          </div>
        </section>
      ) : null}
      {tab === "discovery" && cast.length === 0 ? (
        <div className="v3ln-note">No one to hear yet — the roster arrives when the Discovery Kit casts it.</div>
      ) : null}

      {tab === "record" ? (
        <section className="v3ln-band" aria-label="Record">
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">Record</span>
            <span className="v3ln-band-sp" />
            {recordAreas.length > 1 ? (
              <label className="v3ln-filter">
                <span>Area</span>
                <select value={recordAreas.includes(areaFilter) ? areaFilter : ""}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  aria-label="Filter the record by area">
                  <option value="">All areas · {record.length}</option>
                  {recordAreas.map((area) => (
                    <option key={area} value={area}>{area} · {record.filter((r) => r.area === area).length}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="v3ln-scope">{recordGroups.reduce((n, g) => n + g.items.length, 0)} evidence entries</span>
          </header>
          {/* The entries below are attributed evidence (who said it, when) — real.
              But the LEDGER attributes only closures: 26 attributed, and every one
              is an operator touch (weak, no verbatim), not a stakeholder assertion.
              Shown so "who said what" never over-claims what the ledger holds. */}
          <div className="v3ln-ledgerstrip">
            <span className="v3ln-ledgerstrip-l">Attributed on the ledger</span>
            <span className="v3ln-rec-attr"><ClaimStatus state="closed" showLabel={false} /> <b>{ledger.heard.total}</b> attributed closures</span>
            <span className="v3ln-ledgerstrip-sep" aria-hidden="true">·</span>
            <span className="v3ln-rec-attr"><SourceTag source="dispositioned" /> <b>{ledger.stats.closedWithoutVerbatim}</b> operator touches (weak, no verbatim)</span>
            <ProvisionalMark what="per-area attribution needs the stakeholder write path; all closures read into one band today" />
          </div>
          {/* READINGS THAT NEVER BECAME A QUESTION. Aura reads an entity as having a
              lifecycle from four signals; one signal alone is a suggestion, not a
              finding, so no question is minted and nobody is asked. That is the right
              call — a name alone must not put a question on somebody's link — but it
              leaves a reading nothing on the board accounts for. The Record is where
              what was found and not acted on belongs. Read-only, like the rest of
              this surface. */}
          {maybeLifecycles.length ? (
            <p className="v3ln-rec-note">
              <b>{maybeLifecycles.length}</b> entit{maybeLifecycles.length === 1 ? "y" : "ies"} read as having a
              lifecycle from the field name alone — {maybeLifecycles.map((l) => l.entity).join(", ")}.
              One signal each, so Aura did not call them lifecycles and no question was asked.
              Noted here so a reading nobody acted on is still on the record.
            </p>
          ) : null}
          {recordGroups.length === 0 ? (
            <div className="v3ln-note">Nothing on the record yet{areaFilter ? ` for ${areaFilter}` : ""} — capture a conversation or share a link from Discover.</div>
          ) : recordGroups.map((group) => (
            <div key={group.area || "programme"} className="v3ln-rec-grp">
              <div className="v3ln-rec-area">
                {group.area ? (
                  <button type="button" className="v3ln-cr-area"
                    title={areaFilter === group.area ? "Show all areas" : `Filter to ${group.area}`}
                    onClick={() => setAreaFilter(areaFilter === group.area ? "" : group.area)}>{group.area}</button>
                ) : <span className="v3ln-scope">programme-wide</span>}
                <span>{group.items.length} entr{group.items.length === 1 ? "y" : "ies"}</span>
              </div>
              {group.items.map(({ entry, name }) => (
                <button type="button" key={entry.id} className="v3ln-rec-row"
                  title="Read the full entry"
                  onClick={() => setReading(entry)}>
                  <span className="v3ln-rec-top">
                    <b>{name}</b>
                    <span className="v3ln-rec-fl">{entry.fieldLabel}</span>
                    {entry.capturedAt ? <time className="v3ln-rec-when">{entry.capturedAt}</time> : null}
                  </span>
                  <span className="v3ln-rec-ex">{entry.excerpt}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {reading ? (
        <Suspense fallback={null}>
          <EvidenceReader entry={reading} onClose={() => setReading(null)} />
        </Suspense>
      ) : null}

      {gateFor ? (() => {
        // The loop band folds Envision+Show — its convergence closes itself,
        // so record/reopen apply only to bands that ARE movements.
        const gateMovement = ["frame", "listen", "ship", "evolve"].includes(gateFor.id) ? gateFor.id : null;
        const gateApproved = !!gateMovement && program.gateReviews?.[gateMovement]?.status === "approved";
        return (
          <GateSheet band={gateFor} approved={gateApproved} onClose={() => setGateFor(null)}
            onRecord={gateMovement && onRecordGate
              ? async () => { await onRecordGate(gateMovement); setGateFor(null); }
              : undefined}
            onReopen={gateMovement && onReopenGate
              ? async () => { await onReopenGate(gateMovement, "Evidence changed after the demonstration"); setGateFor(null); }
              : undefined} />
        );
      })() : null}

      {capFor ? (
        <>
          <div className="v3ln-gate-backdrop" onClick={() => setCapFor(null)} aria-hidden="true" />
          <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label="Add to the record">
            <div className="v3ln-gate-h">
              <h3>Add to the record</h3>
              <button type="button" className="v3ln-x" onClick={() => setCapFor(null)} aria-label="Close">✕</button>
            </div>
            <div className="v3ln-cap">
              <label className="v3ln-cap-f">
                <span>Who said it</span>
                <select value={capWho} onChange={(e) => setCapWho(e.target.value)}>
                  {/* The VALUE stays the stored label (it keys the write); only the copy is humanised. */}
                  {cast.map((row) => <option key={row.label} value={row.label}>{displayPersonLabel(row.label)}{row.role && row.role !== row.label ? ` — ${row.role}` : ""}</option>)}
                </select>
              </label>
              <label className="v3ln-cap-f">
                <span>What they said — attribution is added for you</span>
                <textarea rows={7} value={capText} onChange={(e) => setCapText(e.target.value)}
                  placeholder="Paste a transcript, meeting notes, an email thread…" />
              </label>
              {/* Each attachment stays its own reviewable block: the extracted
                  text is EDITABLE here and lands as a “— Document —” entry
                  attributed to the person selected above. Removing one before
                  Capture leaves no trace on the record. */}
              {capDocs.map((doc, index) => (
                <div className="v3ln-cap-f v3ln-cap-doc" key={`${doc.filename}-${index}`}>
                  <span className="v3ln-cap-doc-h">
                    <span className="v3ln-cap-doc-n"><span aria-hidden="true">▤ </span>{doc.filename}</span>
                    <button type="button" className="v3ln-a" aria-label={`Remove ${doc.filename}`}
                      onClick={() => setCapDocs((current) => current.filter((_, i) => i !== index))}>Remove</button>
                  </span>
                  <textarea rows={5} value={doc.text}
                    aria-label={`Extracted text from ${doc.filename} — edit before it lands`}
                    onChange={(e) => setCapDocs((current) =>
                      current.map((d, i) => (i === index ? { ...d, text: e.target.value } : d)))} />
                </div>
              ))}
              {/* Appends, never overwrites: a transcript joins whatever the
                  operator has already typed or pasted, and stays editable —
                  nothing becomes evidence until Capture is pressed. */}
              <div className="v3ln-cap-ins">
                <AttachFileButton programId={program.id}
                  onFiles={(files) => void readAttachedDictionary(files)}
                  onExtracted={(filename, text, sourceKey) => setCapDocs((current) => [...current, { filename, text, sourceKey }])} />
                <TranscribeButton onText={(transcript) => setCapText((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
              </div>
              {/* THE SECOND READING. The attachment is already on its way to the
                  record as evidence; this says what else is in it and offers to
                  use it. Stated, never taken: applying is a click. */}
              {capDict ? (
                <div className="v3ln-cap-dict">
                  <span className="v3ln-cap-dict-t">
                    <b>{capDict.name}</b> {capDict.files > 1 ? "together read" : "also reads"} as a <b>data dictionary</b> —
                    {" "}{capDict.fields} field{capDict.fields === 1 ? "" : "s"},
                    {" "}<b>{capDict.closes}</b> of the {capDict.inScope} open typing question{capDict.inScope === 1 ? "" : "s"}
                    {capDict.entities.length ? ` on ${capDict.entities.slice(0, 3).join(", ")}${capDict.entities.length > 3 ? ` +${capDict.entities.length - 3} more` : ""}` : ""} match
                    {capDict.closes === 0 ? " — nothing here matches an open locus, so it would close nothing" : ""}
                  </span>
                  <span className="v3ln-cap-dict-m">
                    Filed on the record it stays prose and closes nothing. Applied, it answers those
                    questions as <i>code-derived · weak</i> — anyone can still deviate. It lands
                    programme-wide; the Inbox is where a dictionary is attached to one system of record.
                  </span>
                  {/* APPLYING IT MOVED TO THE INBOX. Attaching a file to the record is
                      Discover's own act — it is how a stakeholder's evidence arrives.
                      APPLYING it as a dictionary is an operator move: it answers open
                      questions programme-wide at the strength a schema carries, and
                      the Inbox is where a dictionary is keyed to its system of record.
                      The reading is still stated here, in full, so the operator learns
                      what the file contains at the moment they attach it. */}
                  {onOpenInbox && capDict.closes > 0 ? (
                    <button type="button" className="v3ln-handoff" onClick={onOpenInbox}
                      aria-label="Open the Inbox to apply this file as a data dictionary">
                      apply it in the Inbox<span aria-hidden="true"> →</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="v3ln-cap-bar">
                <button type="button" className="v3ln-btn" disabled={(!capText.trim() && !capDocs.some((doc) => doc.text.trim())) || !capWho}
                  onClick={() => void saveCapture()}>Capture</button>
                <span>Lands as “— Name, Role, Date —” evidence and refreshes what depends on it. An attached file lands as its own “— Document —” entry, attributed to the same person, with the original kept for download.</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {briefOpen ? (
        <>
          <div className="v3ln-gate-backdrop" onClick={() => setBriefOpen(false)} aria-hidden="true" />
          <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label="Company brief">
            <div className="v3ln-gate-h">
              <h3>Company brief — who the client is</h3>
              <button type="button" className="v3ln-x" onClick={() => setBriefOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="v3ln-cap">
              <label className="v3ln-cap-f">
                <span>Grounds the charter, kit, ontology and atlas — edit freely; only your save writes it</span>
                <textarea rows={11} value={briefText} onChange={(e) => setBriefText(e.target.value)}
                  placeholder={`What ${program.name} does — market, customers, products, scale. Fetch a web-grounded draft below, or write your own.`} />
              </label>
              <div className="v3ln-cap-bar">
                <button type="button" className="v3ln-a" disabled={briefBusy}
                  onClick={() => void fetchBrief()}>{briefBusy ? "Fetching…" : "⌕ Fetch from the web"}</button>
                <button type="button" className="v3ln-btn" disabled={briefBusy}
                  onClick={() => void saveBrief()}>Save to the record</button>
                <span>The fetched text is a draft with its sources — it reaches the generators only once you save it. Saving empty clears the brief.</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {docFor ? (
        <Suspense fallback={null}>
          <FlowArtifactStudio program={program} artifact={docFor} initialSection={docSection}
            onClose={() => { setDocFor(null); setDocSection(undefined); }}
            onRegenerate={regenerate ? () => regenerate(docFor) : undefined}
            regenerating={regenerating(docFor.id)}
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
