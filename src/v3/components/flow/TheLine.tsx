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
import { Fragment, Suspense, lazy, useEffect, useMemo, useState, type ComponentProps } from "react";
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
import { resolveMovementStakeholders, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { listenCoverageAreas, listenAreaCoverage } from "@/v3/components/flow/listenCoverage";
import { canonicalFrameArea, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { buildMeetingIcs, meetingKit, sponsorLinkQuestions } from "@/v3/components/flow/flowMeetings";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import { supabase } from "@/integrations/supabase/client";
import { useProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { HeardReadout, ConvergenceReadout, UnownedSeamStrip, ProvisionalMark, ClaimStatus, SourceTag } from "@/v3/components/flow/studio/ledgerPrimitives";
import DesignLoopZones from "@/v3/components/flow/DesignLoopZones";
import OperatorInbox from "@/v3/components/flow/OperatorInbox";
import { serializeOperatorActions, OPERATOR_ACTIONS_FIELD, type OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { ownerRoleLabelForArea } from "@/v3/lib/ledger/migrate";
import { questionForLocus } from "@/v3/lib/ledger/phrasing";
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
  /** Classic write handlers, passed through untouched. All optional — omitted
   * (e.g. a future sponsor lens) the Line renders fully read-only. */
  onSaveInputs?: SaveInputsFn;
  onRenamePerson?: KitAlignProps["onRenamePerson"];
  onRenameRole?: KitAlignProps["onRenameRole"];
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
  /** Record a movement's gate — demonstrated. Reopen — evidence changed.
   * Classic's own handlers; the parent re-checks criteria at write time. */
  onRecordGate?: (movementId: string) => Promise<void>;
  onReopenGate?: (movementId: string, reason: string) => Promise<void>;
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
function phaseState(items: SignoffItem[]): "approved" | "pending" | "open" | "none" {
  if (!items.length) return "none";
  if (items.every((i) => i.status === "approved" && !i.preDatesDocument)) return "approved";
  if (items.some((i) => i.status === "in-review")) return "pending";
  return "open";
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

/** Same matching classic uses: newest pack whose stakeholder name matches,
 * scoped to Listen (durable kit links carry no movementId). */
function packFor(program: ProgramSummary, who: string, movementId: "frame" | "listen") {
  const key = who.trim().toLowerCase();
  return [...listInterviewPacks(program)].reverse().find((pack) =>
    pack.stakeholder.trim().toLowerCase() === key
    && (movementId === "listen" ? (!pack.movementId || pack.movementId === "listen") : pack.movementId === movementId));
}

export default function TheLine({ program, onSaveInputs, onRenamePerson, onRenameRole, onMintFollowUp, onScheduleFollowUp, onRunAgent, onRecordGate, onReopenGate, onSendForApproval }: TheLineProps) {
  const model = useMemo(() => buildLineModel(program), [program]);
  // The ONE in-browser ledger read every surface here shares (read-only migrate).
  const ledger = useProgramLedger(program);
  const [gateFor, setGateFor] = useState<LineBand | null>(null);
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // A section chip on the board deep-links into the studio at that section.
  const [docSection, setDocSection] = useState<string | undefined>(undefined);
  const openStation = (card: ArtifactCardModel, section?: string) => { setDocSection(section); setDocFor(card); };
  // Two projections of the one record: the WORK board (where the programme
  // is) and DISCOVERY (who it runs through — links, capture, invites; named
  // to match the classic chrome's Discovery tab). The surface itself stays
  // load-bearing past Listen — the same people carry demo verdicts and
  // sign-offs later, and they land here.
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
  const ownerLabelsFor = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const row of cast) {
      const labels = new Set<string>();
      // A person owns their PRIMARY function — from their ROLE/title, else their
      // primary area. NOT the union of every coverage area they're tagged with:
      // nearly everyone "covers" Sales, so unioning coverage reproduces the
      // area-inherited bleed (Alliances inheriting Sales-handoff questions). The
      // ledger owns each locus by ONE role, so a person maps to ONE owning function.
      const primary = ownerRoleLabelForArea(row.role) ?? ownerRoleLabelForArea(row.label) ?? ownerRoleLabelForArea(row.area);
      if (primary) labels.add(primary);
      m.set(row.label, labels);
    }
    return m;
  }, [cast]);
  // Each person's SOLO-answerable owned questions (dedup by locus), read from the
  // one soloByOwner projection. Seams are excluded by construction (joint owners are
  // never in soloByOwner) — they live in the session queue, not on an async list.
  const ownedQuestionsFor = useMemo(() => {
    const nameOf = new Map(ledger.store.elements().map((e) => [e.id, e.name] as const));
    const m = new Map<string, Array<{ about: string; question: string; typeTag: string }>>();
    for (const row of cast) {
      const seen = new Set<string>();
      const out: Array<{ about: string; question: string; typeTag: string }> = [];
      for (const label of ownerLabelsFor.get(row.label) ?? []) {
        for (const it of ledger.soloByOwner.get(label) ?? []) {
          if (seen.has(it.about)) continue; seen.add(it.about);
          const p = questionForLocus(it.about, (id) => nameOf.get(id));
          out.push({ about: it.about, question: p.question, typeTag: p.typeTag });
        }
      }
      m.set(row.label, out);
    }
    return m;
  }, [cast, ownerLabelsFor, ledger.soloByOwner, ledger.store]);
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
    const byLabel = new Map<string, { state: EngState; ageDays: number | null; open: number; done: number; needsSession: boolean; onTurf: number }>();
    for (const row of cast) {
      const key = row.label.trim().toLowerCase();
      const assigned = ledger.assignments.filter((a) => a.owner.label.trim().toLowerCase() === key);
      const open = assigned.filter((a) => !ledger.capturedAbouts.has(a.about));
      const done = assigned.filter((a) => ledger.capturedAbouts.has(a.about));
      const oldest = open.reduce<number | null>((m, a) => { const t = Date.parse(a.at); return Number.isNaN(t) ? m : (m === null ? t : Math.min(m, t)); }, null);
      const ageDays = oldest !== null ? Math.max(0, Math.floor((now - oldest) / 86400000)) : null;
      const onTurf = (ownedQuestionsFor.get(row.label) ?? []).length;   // real owned-solo load, not area coverage
      const needsSession = (seamPairsFor.get(row.label) ?? []).length > 0;
      let state: EngState;
      if (open.length > 0 || row.awaiting) state = "in-flight";      // engaged, awaiting a response
      else if (onTurf > 0) state = "ready";                          // open questions on loci THEY OWN
      else if (needsSession) state = "blocked";                      // only a seam session left for them
      else state = "done";                                           // nothing open owned by them
      byLabel.set(row.label, { state, ageDays, open: open.length, done: done.length, needsSession, onTurf });
    }
    return byLabel;
  }, [cast, ledger.assignments, ledger.capturedAbouts, ownedQuestionsFor, seamPairsFor]);
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
      setNote(`Sign-off link copied — ${label} → ${who}. It's also shown in their row.`);
    } catch {
      setNote(`Sign-off link ready — copy it from ${who}'s row.`);
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
  const [areaOpen, setAreaOpen] = useState<Record<string, boolean>>({});
  // Company brief — who the client IS. A web-fetched DRAFT the operator
  // confirms or overrides; only their save writes it to the record.
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  const copyLink = async (row: CastRow) => {
    try {
      const existing = packFor(program, row.label, row.movementId);
      let url = existing ? portalLinkFor(program.id, existing) : null;
      if (!url && onMintFollowUp) {
        url = await onMintFollowUp({
          movementId: row.movementId, who: row.label, questions: row.questions,
          captureField: row.captureField, unnamed: row.isRole,
        });
      }
      if (!url) { setNote(`No link handler available for ${row.label} in this view.`); return; }
      setLinkShown({ who: row.label, url });
      setQOpen((s) => ({ ...s, [row.label]: true }));
      try {
        await navigator.clipboard.writeText(url);
        setNote(`Link copied — ${row.label}. It's also shown below their row.`);
      } catch {
        setNote(`Link ready — copy it from the field under ${row.label}'s row.`);
      }
      window.setTimeout(() => setNote(null), 6000);
    } catch (error) {
      setNote(`Couldn't create the link: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setNote(null), 8000);
    }
  };

  // Regeneration in flight, by artifact id. Cleared implicitly: when the
  // regenerated document lands, the station stops being stale and the badge
  // disappears; the flag only mutes double-clicks meanwhile.
  const [regenBusy, setRegenBusy] = useState<Record<string, boolean>>({});
  const regenerate = (card: ArtifactCardModel) => {
    if (!onRunAgent) return;
    onRunAgent(card.id, card.movementId);
    setRegenBusy((s) => ({ ...s, [card.id]: true }));
    setNote(`Regenerating ${card.title} from the record — the station refreshes when it lands.`);
    window.setTimeout(() => setNote(null), 6000);
  };

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

  // AUTO-ACCEPT heard voices — classic runs this on canvas mount; without it
  // a Line-only session never marks evidence-backed voices Heard. Identical
  // write, idempotent: attestHeardRoster returns null once settled.
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

  const copyShown = async () => {
    if (!linkShown) return;
    try {
      await navigator.clipboard.writeText(linkShown.url);
      setNote(`Link copied — ${linkShown.who}.`);
    } catch {
      setNote("The clipboard is blocked here — select the link text and copy it manually.");
    }
    window.setTimeout(() => setNote(null), 5000);
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
      setNote(`Invite downloaded · follow-up scheduled — ${invitee.label}, ${inviteDate}`);
    } catch (error) {
      setNote(`Couldn't schedule: ${error instanceof Error ? error.message : String(error)}`);
    }
    setInvitee(null); setInviteDate("");
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
    const existing = String(readMovementInputs(program, row.movementId)[row.captureField] ?? "");
    const header = `— ${[row.isRole ? row.role : row.label, row.isRole ? "" : row.role, evidenceStamp()].filter(Boolean).join(", ")} —`;
    const appended = [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n");
    await onSaveInputs(row.movementId, { [row.captureField]: appended }, { attest: { action: `Captured — ${row.label}` } });
    onRunAgent?.("contradiction-detector", row.movementId);
    setCapFor(null); setCapText("");
    setNote(row.movementId === "listen"
      ? `Captured — ${row.label}. The Ontology and Atlas will refresh for ${row.area}.`
      : `Captured — ${row.label}. The Charter and Discovery Kit will refresh.`);
    window.setTimeout(() => setNote(null), 6000);
  };

  // ── operator verbs (Assign / Schedule / Respond): append an action through the
  // fingerprint-safe Listen field; useProgramLedger re-derives ownership on the next
  // render. Candidate owners are the people the kit already knows.
  const verbCandidates = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; role: string }> = [];
    for (const r of cast) { if (seen.has(r.label)) continue; seen.add(r.label); out.push({ label: r.label, role: r.role }); }
    return out;
  }, [cast]);
  const commitOperatorAction = async (action: OperatorAction | OperatorAction[]) => {
    if (!onSaveInputs) { setNote("No write handler available in this view."); window.setTimeout(() => setNote(null), 5000); return; }
    const added = Array.isArray(action) ? action : [action];
    const next = [...ledger.actions, ...added];
    await onSaveInputs("listen", { [OPERATOR_ACTIONS_FIELD]: serializeOperatorActions(next) }, { silent: true });
    const a = added[0];
    setNote(Array.isArray(action) ? `Assigned ${added.length} question${added.length === 1 ? "" : "s"} — owned-and-open now (not counted as heard).`
      : a.kind === "assign" ? `Assigned to ${a.owner.label} — owned-and-open now (not closed, not counted as heard).`
      : a.kind === "schedule" ? `Marked for a joint session — ${a.pair} (${a.abouts.length} question${a.abouts.length === 1 ? "" : "s"}). No date yet — scheduling is gated.`
      : a.kind === "decide-fate" ? `Recorded — ${a.decision === "escalate" ? "escalated" : "out-of-scope"} (not an answer, not counted as heard).`
      : a.kind === "unassign" ? `Returned to unowned — ${a.reason === "release" ? "released by the holder" : "you unassigned it"} (not counted as heard).`
      : a.kind === "redirect" ? `Referral recorded — confirm it to reassign (not counted as heard).`
      : `Captured via the team — recorded, provisional, not counted as heard.`);
    window.setTimeout(() => setNote(null), 6000);
  };

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
        <div className="v3ln-stats ledger">
          <div><span className="v3ln-sl">Round</span><span className="v3ln-sv">{model.round}</span></div>
          <button type="button" className="v3ln-statbtn wide" onClick={() => setTab("discovery")}
            title="Attributed closures — a person closed the slot. The honest heard-count, not a roster tally.">
            <span className="v3ln-sl">Heard <span className="v3ln-sl-note">attributed closures</span></span>
            <HeardReadout heard={ledger.heard} />
          </button>
          <div className="v3ln-stat-wide">
            <span className="v3ln-sl">Convergence <span className="v3ln-sl-note">real claim closures</span></span>
            <ConvergenceReadout burnDown={ledger.kit.burnDown} />
          </div>
        </div>
        <UnownedSeamStrip unownedBands={ledger.unownedBands} seamBands={ledger.seamBands} openTotal={ledger.queue.counts.total} unownedOpen={ledger.unownedOpen} />
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
            // The Design Loop is a LEDGER SURFACE, not four refreshable cards: three
            // ownership zones keyed to source class (operator builds · stakeholders
            // shape · joint), convergence promoted to real closures. See
            // DesignLoopZones.tsx and docs/aura/surface-redesign.md.
            <DesignLoopZones band={band} ledger={ledger}
              onOpen={openStation}
              onRegen={onRunAgent ? regenerate : undefined}
              onGenerate={onRunAgent ? generate : undefined}
              regenBusy={regenBusy} genBusy={genBusy} />
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
                onRegen={onRunAgent ? regenerate : undefined}
                onGenerate={onRunAgent ? generate : undefined}
                regenerating={!!(s.card && regenBusy[s.card.id])}
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
          {/* One denominator, one goal: the burn-down is the headline; the inbox below
              is the small operator-action subset. No two numbers that contradict. */}
          <div className="v3ln-goal">
            <span className="v3ln-goal-lead">The goal — close the burn-down</span>
            <span className="v3ln-goal-stats">
              <b>{ledger.kit.burnDown.open}</b> open <span className="v3ln-unit">questions</span> · <b>{ledger.heard.total}</b> answered
              {" "}· <b>{ledger.unownedOpen}</b> need an owner{ledger.typingLoci.length ? <> · <b>{ledger.typingLoci.length}</b> → dictionary</> : null} · <b>{ledger.seamBands.length}</b> seam{ledger.seamBands.length === 1 ? "" : "s"}
            </span>
            <ConvergenceReadout burnDown={ledger.kit.burnDown} />
            <span className="v3ln-goal-heard"><HeardReadout heard={ledger.heard} /></span>
          </div>
          {/* The operator inbox: the actionable subset — assign / decide-fate / schedule /
              adjudicate, reassignment, and the stakeholder exits (interim). */}
          <OperatorInbox ledger={ledger} candidates={verbCandidates} by="operator" onCommit={commitOperatorAction} />
          {/* Discover as an engagement dashboard: who needs attention and why, sorted by
              state. Ageing on in-flight is operator-tracked until the link is live. */}
          <div className="v3ln-engbar" role="note" aria-label="Engagement — who needs attention">
            <span className="v3ln-engbar-l">Who to engage</span>
            <span className="v3ln-engpill is-ready"><b>{engSummary.ready}</b> ready</span>
            <span className="v3ln-engpill is-in-flight"><b>{engSummary["in-flight"]}</b> in flight{engSummary.oldest > 0 ? ` · oldest ${ageStr(engSummary.oldest)}` : ""}</span>
            <span className="v3ln-engpill is-blocked"><b>{engSummary.blocked}</b> blocked</span>
            <span className="v3ln-engpill is-done"><b>{engSummary.done}</b> done for now</span>
            <span className="v3ln-engbar-note">ageing is operator-tracked (the chase), not a system-tracked reply — until the link is live</span>
          </div>
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
                  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
                  setQOpen((s) => ({ ...s, [row.label]: !s[row.label] }));
                }}>
                {/* The top bar holds everything actionable and NEVER moves —
                  * expansion only ever adds a body underneath. */}
                <div className="v3ln-cr-top">
                  <span className={`v3ln-dot ${row.heard ? "d" : row.awaiting ? "w" : "t"}`}
                    title={row.heard ? "Heard — evidence on the record" : row.awaiting ? "Link out — awaiting response" : "To reach"} />
                  <span className="v3ln-cr-who">
                    <b>{row.label}</b>
                    {row.isRole ? <span>role — assign a name to send</span>
                      : row.role && row.role !== row.label ? <span>{row.role}</span> : null}
                    {(() => {
                      const e = engagementByLabel.get(row.label);
                      if (!e) return null;
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
                          : e.state === "ready" ? <span className="v3ln-eng-why" title="Open unknowns on loci THIS person owns (their solo load) — not area coverage, not seam questions.">{e.onTurf} open on loci they own — send a link</span>
                          : null}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="v3ln-cr-areas">
                    {/* Routing signal (which turf each person covers) — kept, but collapsed
                        to the primary few + "+N more" (the same idiom the seams strip uses),
                        so seven tags don't clutter the row. Filtered area is always shown. */}
                    {(() => {
                      const CAP = 3;
                      const expanded = !!areaOpen[row.label];
                      // Keep the active filter visible even if it sits past the cap.
                      const primary = row.areas.slice(0, CAP);
                      if (areaFilter && row.areas.includes(areaFilter) && !primary.includes(areaFilter)) primary[CAP - 1] = areaFilter;
                      const shown = expanded ? row.areas : primary;
                      const hidden = row.areas.length - shown.length;
                      return (
                        <>
                          {shown.map((area) => (
                            <button key={area} type="button"
                              className={`v3ln-cr-area${areaFilter === area ? " on" : areaFilter && castAreas.includes(areaFilter) ? " dim" : ""}`}
                              title={areaFilter === area ? "Show all areas" : `Filter to ${area}`}
                              onClick={() => setAreaFilter(areaFilter === area ? "" : area)}>{area}</button>
                          ))}
                          {hidden > 0 && !expanded ? (
                            <button type="button" className="v3ln-cr-area more"
                              title={`Also covers: ${row.areas.slice(CAP).join(", ")}`}
                              onClick={(e) => { e.stopPropagation(); setAreaOpen((s) => ({ ...s, [row.label]: true })); }}>+{hidden} more</button>
                          ) : expanded && row.areas.length > CAP ? (
                            <button type="button" className="v3ln-cr-area more"
                              onClick={(e) => { e.stopPropagation(); setAreaOpen((s) => ({ ...s, [row.label]: false })); }}>less</button>
                          ) : null}
                        </>
                      );
                    })()}
                  </span>
                  <span className="v3ln-cr-right">
                  {(() => {
                    const owned = ownedQuestionsFor.get(row.label) ?? [];
                    return (
                  <button type="button" className="v3ln-cr-qbtn" aria-expanded={!!qOpen[row.label]}
                    title="Open unknowns on loci this person OWNS (their solo load) — seam questions are in the session queue, not here"
                    onClick={() => setQOpen((s) => ({ ...s, [row.label]: !s[row.label] }))}>
                    {owned.length} owned question{owned.length === 1 ? "" : "s"}
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
                    const seg = (label: string, state: ReturnType<typeof phaseState>, extra?: string) =>
                      state === "none" && !extra ? null : (
                        <span className={`v3ln-jseg ${state}`} title={`${label} — ${extra || state}`}>
                          <span className="v3ln-jdot" aria-hidden="true" />{label}{extra ? ` · ${extra}` : ""}
                        </span>
                      );
                    const verdictShort = j.verdict
                      ? /objection/i.test(j.verdict) ? "objection" : /changes/i.test(j.verdict) ? "changes" : /accept/i.test(j.verdict) ? "accepted" : j.verdict.toLowerCase()
                      : undefined;
                    return (
                      <span className="v3ln-journey" aria-label={`${row.label} journey`}>
                        {seg("Listen", phaseState(j.listen))}
                        {j.loop.length || j.verdict ? seg("Loop", phaseState(j.loop), verdictShort) : null}
                      </span>
                    );
                  })()}
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
                        <p className="v3ln-cr-noq">No open unknowns on loci {row.label} owns.{seams.length ? ` Their open work is a joint session — it's in the session queue (${seams.join(", ")}).` : " Their durable link still carries the interview script."}</p>
                      );
                      return (
                        <ul className="v3ln-cr-qs owned">
                          {owned.map((q) => (
                            <li key={q.about} title={q.about}><span className="v3ln-cr-qtype">{q.typeTag}</span>{q.question}</li>
                          ))}
                          {seams.length ? <li className="v3ln-cr-seamnote">＋ seam questions ({seams.join(", ")}) are in the session queue — a joint session, not solo.</li> : null}
                        </ul>
                      );
                    })()}
                    {linkShown?.who === row.label ? (
                      <span className="v3ln-cr-url-row">
                        <input className="v3ln-cr-url" readOnly value={linkShown.url}
                          onFocus={(e) => e.currentTarget.select()}
                          aria-label={`${row.label}'s durable link`} />
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
                                aria-label={`${row.label}'s sign-off link`} />
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
                      aria-label={`Follow-up date for ${row.label}`} />
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
            onRegenerate={onRunAgent ? () => regenerate(docFor) : undefined}
            regenerating={!!regenBusy[docFor.id]}
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
