/**
 * The Collect stage's status board — a movement's discovery, organized by
 * stakeholder. One card per person or role: their script, their link/meeting
 * channels, their captured evidence, a capture box — followed until they've
 * been heard. Driven by resolveMovementStakeholders, so it serves every
 * movement.
 */
import { useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { ProgramSummary } from "@/new/types";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import { flowMovements, movementEvidence, evidenceStamp, locateQuote, readMovementInputs, contradictionLogWithout, artifactDocument } from "@/v3/components/flow/flowShellData";
import { relevantApprovers, stakeholderApprovalItems, approvalLinkFor, type StakeholderApprovalItem } from "@/v3/components/flow/flowApprovals";
import { buildMeetingIcs, mailtoLink, stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, portalLinkFor, movementValidationCoverage, engagementLabel } from "@/v3/components/flow/flowPortal";
import { resolveMovementStakeholders, readRoleBindings, readOperatorAsks, operatorAsksFor, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { AttachFileButton, TranscribeButton, copyTextFromAction } from "@/v3/components/flow/flowCapture";
import { readGovernedExceptions, withNewException, withResolvedException } from "@/v3/components/flow/flowExceptions";
import { projectStakeholderReview, reviewFallbackQuestions } from "@/v3/components/flow/flowReviews";
import { areaProgress, stakeholderPrimaryArea, programAreas, GENERAL_AREA, type AreaProgress } from "@/v3/components/flow/flowAreas";

/** A movement's discovery, organized by stakeholder. One card per person or
 * role: their script, their link/meeting channels, their captured evidence, a
 * capture box — followed until they've been heard. Driven by
 * resolveMovementStakeholders, so it serves every movement. */
/** Derive a stakeholder's collection status, their live link pack, and the
 * evidence attributed to them — the single source of truth for the status
 * board grouping and each card. */
export type CollectStatus = "approved" | "pending-approval" | "heard" | "waiting" | "toreach";

export function stakeholderCollection(
  movementId: string,
  stakeholder: MovementStakeholder,
  packs: ReturnType<typeof listInterviewPacks>,
  evidence: ReturnType<typeof movementEvidence>,
  /** The person's sign-off state (relevant approvers only) — lifts a heard
   * card into "pending-approval" / "approved" once their questions are done. */
  approval?: { pending: boolean; allApproved: boolean },
) {
  const key = stakeholder.name.toLowerCase();
  const pack = [...packs].reverse().find((p) => String(p.stakeholder ?? "").trim().toLowerCase() === key
    && (movementId === "listen" ? (!p.movementId || p.movementId === "listen") : p.movementId === movementId));
  // Their evidence: attributed voice blocks, PLUS documents they provided
  // (document entries carry the provider in their meta, not in `who`).
  const mine = evidence.filter((e) => {
    const firstToken = e.who.split(",")[0].trim().toLowerCase();
    // Exact first-token equality works at ANY name length ("Jo, CEO");
    // fuzzy containment keeps the 3-char floor against false positives.
    if (firstToken && firstToken === key) return true;
    if (key.length <= 2) return false;
    return e.who.toLowerCase().includes(key)
      || key.includes(firstToken)
      || (e.kind === "document" && e.meta.toLowerCase().includes(key));
  })
    // Newest first — the latest response leads the trail.
    .slice().sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
  const heard = mine.length > 0 || Boolean(pack?.respondedAt);
  // Lifecycle: to reach → awaiting response → heard (only once their questions
  // are settled) → pending approval (a sign-off ask is out) → approved. A heard
  // person with OPEN questions stays in "awaiting" — they owe another round.
  const status: CollectStatus = !heard
    ? (pack ? "waiting" : "toreach")
    : stakeholder.questions.length ? "waiting"
      : approval?.pending ? "pending-approval"
        : approval?.allApproved ? "approved"
          : "heard";
  return { key, pack, mine, heard, status };
}
type StakeholderCollection = ReturnType<typeof stakeholderCollection>;

const COLLECT_COLUMNS: Array<{ key: CollectStatus; label: string }> = [
  { key: "approved", label: "Approved" },
  { key: "pending-approval", label: "Pending approval" },
  { key: "heard", label: "Heard" },
  { key: "waiting", label: "Awaiting response" },
  { key: "toreach", label: "To reach" },
];

// Each area carries a stable identity colour so the board reads as a set of
// distinct business domains, not a stack of identical rows. Brand-pure: the
// tones are a cool INDIGO → VIOLET → PLUM family, all cousins of Brillio Deep
// Indigo (#211747), distinguished by hue AND lightness so lanes stay legible
// while the board reads on-brand rather than as a rainbow. General is neutral.
const AREA_TONES = [
  "hsl(252 46% 34%)", "hsl(266 42% 46%)", "hsl(288 36% 42%)", "hsl(240 44% 44%)",
  "hsl(306 30% 44%)", "hsl(258 48% 40%)", "hsl(276 38% 50%)", "hsl(228 42% 40%)",
  "hsl(294 32% 38%)", "hsl(246 40% 52%)",
];
export function areaAccent(area: string): string {
  if (!area || area === GENERAL_AREA) return "var(--v3-text-muted)";
  let hash = 0;
  for (let i = 0; i < area.length; i += 1) hash = (hash * 31 + area.charCodeAt(i)) >>> 0;
  return AREA_TONES[hash % AREA_TONES.length];
}
// When lanes render as an ordered set, assign each its tone by POSITION so the
// board never doubles a colour — a name hash can collide two areas onto one
// tone, but the ordered index cannot for up to AREA_TONES.length lanes. General
// stays neutral and doesn't consume a tone slot.
function laneAccentAt(area: string, index: number): string {
  if (!area || area === GENERAL_AREA) return "var(--v3-text-muted)";
  return AREA_TONES[index % AREA_TONES.length];
}
/** A short monogram for the area's identity tile — "Legal & Compliance" → "LC". */
export function areaMonogram(area: string): string {
  const words = area.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return area.slice(0, 2).toUpperCase();
}

/** The movement's stakeholder data collection as a STATUS BOARD: cards grouped
 * into columns by collection state (Heard · Awaiting · To reach), each card the
 * person's quote, dated feedback trail (click → transcript), follow-ups,
 * meeting, and link channels. Driven by resolveMovementStakeholders. */
export function IntervieweeDiscovery({ program, movementId, captureField, docsStale, regenerating, onRegenerateStale, onSaveInputs, onMintFollowUp, onMintReview, onScheduleFollowUp, onSendForApproval, onFocusPerson, onCaptured, onDocumentCaptured }: {
  program: ProgramSummary;
  movementId: string;
  captureField: string;
  /** A required document trails the evidence — cards offer the regenerate
   * instead of re-asking "still open" items that may already be answered. */
  docsStale?: boolean;
  /** A regeneration is IN FLIGHT for this movement — suppress the follow-up
   * script until every document lands, so the card never shows a script
   * derived from a half-regenerated kit. */
  regenerating?: boolean;
  onRegenerateStale?: () => Promise<void>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  /** Mint a shareable REVIEW link (workflow-agentify or ontology+atlas) — the
   * projected payload is built on the client and stored on the pack. */
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean }) => Promise<string | null>;
  onMintPacks?: () => Promise<void>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a sign-off link for ONE stakeholder × artifact — approval lives on
   * the stakeholder card; the artifact rolls up from everyone's verdicts. */
  onSendForApproval?: (input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string }; snapshot?: string }) => Promise<string | null>;
  /** A card opened or closed — the record rail follows the person you're in. */
  onFocusPerson?: (stakeholderId: string, open: boolean) => void;
  onCaptured?: () => void;
  /** A DOCUMENT (transcript/file) just landed — fires only on upload, not typed
   * capture, so the impacted artifacts auto-regenerate on a discrete event. */
  onDocumentCaptured?: () => void;
}) {
  const stakeholders = resolveMovementStakeholders(program, movementId);
  const movement = flowMovements().find((m) => m.id === movementId);
  const evidence = movement ? movementEvidence(program, movement) : [];
  const packs = listInterviewPacks(program);
  // Card open-state lives here (controlled), so minting a link — which moves a
  // card to another column and remounts it — never collapses it. Null until
  // the operator touches a card; the solo default is applied at render below.
  const [openIdsState, setOpenIdsState] = useState<Set<string> | null>(null);
  // Which AREA LANES are expanded. Null → per-lane default (incomplete open).
  // "Expand all / Collapse all" drives this: collapse hides everything to the
  // area headers; expand opens every lane to its stakeholder cards (kept
  // collapsed — the scripts stay closed until a card is tapped).
  const [openAreas, setOpenAreas] = useState<Set<string> | null>(null);
  // The area whose "invite everyone" is minting — disables that lane's button.
  const [inviteBusyArea, setInviteBusyArea] = useState<string | null>(null);
  // The movement-wide "invite all not-contacted" is minting.
  const [inviteAllBusy, setInviteAllBusy] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  if (!stakeholders.length) return null;
  // Sign-off state per relevant approver (evidence contributors): drives the
  // heard → pending-approval → approved card lifecycle and the card section.
  const relevantNames = new Set(relevantApprovers(program, movementId).map((a) => a.name.trim().toLowerCase()));
  const approvalByName = new Map<string, { pending: boolean; allApproved: boolean; items: StakeholderApprovalItem[] }>();
  for (const s of stakeholders) {
    if (s.isRole || !relevantNames.has(s.name.trim().toLowerCase())) continue;
    const items = stakeholderApprovalItems(program, movementId, s.name);
    approvalByName.set(s.name.trim().toLowerCase(), {
      pending: items.some((item) => item.status === "in-review"),
      // A sign-off that predates the current generation is history, not
      // validation — the card only reads Approved on FRESH approvals.
      allApproved: items.length > 0 && items.every((item) => item.status === "approved" && !item.preDatesDocument),
      items,
    });
  }
  const evaluated = stakeholders.map((s) => ({
    s,
    coll: stakeholderCollection(movementId, s, packs, evidence, approvalByName.get(s.name.trim().toLowerCase())),
  }));
  // Resolve each stakeholder's ontology-grounded primary area ONCE — the single
  // source for the by-area gate, the lane grouping, and each card's area chip.
  const primaryAreaOf = new Map(evaluated.map((e) => [e.s.id, stakeholderPrimaryArea(program, e.s.name, e.s.role)] as const));
  const heardCount = evaluated.filter((e) => e.coll.heard && !e.s.questions.length).length;
  const word = movementId === "show" ? "reviewed" : movementId === "listen" || movementId === "frame" ? "heard" : "consulted";
  const columns = COLLECT_COLUMNS
    .map((c) => ({ ...c, items: evaluated.filter((e) => e.coll.status === c.key) }))
    .filter((c) => c.items.length);
  // Default: the solo card (Frame's sponsor) opens; a roster board stays
  // closed for scanning. `openIdsState` overrides once the operator toggles.
  const soloId = stakeholders.length === 1 && !evaluated[0]?.coll.heard ? stakeholders[0].id : null;
  const openIds = openIdsState ?? new Set(soloId ? [soloId] : []);
  const setCardOpen = (id: string, open: boolean) => setOpenIdsState((prev) => {
    const base = prev ?? new Set(soloId ? [soloId] : []);
    if (base.has(id) === open) return base;
    const next = new Set(base);
    if (open) next.add(id); else next.delete(id);
    return next;
  });
  // Derive the toggle from what's ACTUALLY open, not a separate flag — a roster
  // starts fully collapsed, so a flag initialised to "not collapsed" mislabelled
  // the button and made the first click a no-op. If anything is open, collapse
  // all; otherwise expand all.
  const anyOpen = stakeholders.some((s) => openIds.has(s.id));
  const toggleAll = () => setOpenIdsState(anyOpen ? new Set() : new Set(stakeholders.map((s) => s.id)));
  // Listen · Envision · Show organize the board BY AREA once the programme spans
  // more than one — each area is a lane holding its own stakeholder cards, each
  // card carrying ONE link that bundles that person's questions and their
  // area's workflows. Frame and single-area programmes keep the status board.
  const areaOrganized = (movementId === "listen" || movementId === "envision" || movementId === "show")
    && new Set(primaryAreaOf.values()).size > 1;
  const areaRows = new Map(areaProgress(program).map((r) => [r.area, r] as const));
  const STATUS_RANK: Record<CollectStatus, number> = { toreach: 0, waiting: 1, heard: 2, "pending-approval": 3, approved: 4 };

  const renderCard = ({ s, coll }: (typeof evaluated)[number]) => (
    <IntervieweeCard key={s.id} program={program} movementId={movementId} stakeholder={s} captureField={captureField}
      coll={coll} open={openIds.has(s.id)} onOpenChange={(isOpen) => setCardOpen(s.id, isOpen)}
      primaryArea={areaOrganized ? primaryAreaOf.get(s.id) : undefined}
      docsStale={docsStale} regenerating={regenerating} onRegenerateStale={onRegenerateStale}
      approvalItems={approvalByName.get(s.name.trim().toLowerCase())?.items}
      onSendForApproval={onSendForApproval}
      onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp} onMintReview={onMintReview} onScheduleFollowUp={onScheduleFollowUp}
      onFocusPerson={onFocusPerson} onCaptured={onCaptured} onDocumentCaptured={onDocumentCaptured} />
  );

  // Group each stakeholder into exactly ONE area lane (their primary area), then
  // order lanes as the programme lists its areas (General last) and sort cards
  // within a lane by state so the work to do sits at the top.
  const laneData = areaOrganized ? (() => {
    const groups = new Map<string, typeof evaluated>();
    for (const e of evaluated) {
      const area = primaryAreaOf.get(e.s.id) ?? GENERAL_AREA;
      const list = groups.get(area) ?? [];
      list.push(e); groups.set(area, list);
    }
    const order = [...programAreas(program)];
    for (const a of groups.keys()) if (!order.includes(a)) order.push(a);
    const lanes = order.filter((a) => groups.has(a)).map((area) => {
      const list = groups.get(area)!.slice().sort((a, b) => STATUS_RANK[a.coll.status] - STATUS_RANK[b.coll.status]);
      const heard = list.filter((e) => e.coll.heard && !e.s.questions.length).length;
      const toReach = list.filter((e) => e.coll.status === "toreach").length;
      const waiting = list.filter((e) => e.coll.status === "waiting").length;
      return { area, row: areaRows.get(area), list, heard, total: list.length, toReach, waiting };
    });
    // Float the areas that still need the operator to the top: General last, then
    // complete areas below in-progress ones, then most-open-work first. The eye
    // lands on what's blocked instead of scrolling past finished lanes.
    return lanes.sort((a, b) => {
      const gen = (a.area === GENERAL_AREA ? 1 : 0) - (b.area === GENERAL_AREA ? 1 : 0);
      if (gen) return gen;
      const done = (a.total > 0 && a.heard >= a.total ? 1 : 0) - (b.total > 0 && b.heard >= b.total ? 1 : 0);
      if (done) return done;
      return (b.toReach + b.waiting) - (a.toReach + a.waiting);
    });
  })() : [];
  // Lane open/close, driven by the header's Expand all / Collapse all. Default
  // (null) keeps the per-lane rule (an area still collecting opens itself).
  const laneDefaultOpen = (l: { total: number; heard: number }) => l.total === 0 || l.heard < l.total;
  const laneIsOpen = (area: string, dflt: boolean) => openAreas ? openAreas.has(area) : dflt;
  const anyLaneOpen = openAreas ? laneData.some((l) => openAreas.has(l.area)) : laneData.some(laneDefaultOpen);
  const toggleAllAreas = () => setOpenAreas(anyLaneOpen ? new Set() : new Set(laneData.map((l) => l.area)));
  const setLaneOpen = (area: string, open: boolean) => setOpenAreas((prev) => {
    const base = prev ?? new Set(laneData.filter(laneDefaultOpen).map((l) => l.area));
    const next = new Set(base);
    if (open) next.add(area); else next.delete(area);
    return next;
  });

  // "Invite everyone" — mint the ONE unified link for each person in an area who
  // hasn't been reached yet (skips anyone heard or already holding a link), so
  // an operator opens a whole area's collection in one click. Each person still
  // gets the same review-or-questions pack the card would mint.
  const inviteArea = async (list: typeof evaluated) => {
    for (const { s, coll } of list) {
      if (coll.heard || coll.pack || s.isRole) continue;
      const linkQs = s.linkQuestions?.length ? s.linkQuestions : s.questions;
      const review = projectStakeholderReview(program, movementId, s.name, primaryAreaOf.get(s.id) ?? stakeholderPrimaryArea(program, s.name, s.role), linkQs);
      if (review && onMintReview) {
        await onMintReview({
          movementId, who: s.name, role: s.role || "Reviewer", captureField, reviewKind: review.kind,
          review, questions: linkQs.length ? linkQs : reviewFallbackQuestions(review), intro: review.intro,
        });
      } else if (onMintFollowUp && linkQs.length) {
        await onMintFollowUp({ movementId, who: s.name, questions: linkQs, captureField });
      }
    }
  };
  const canInvite = !!(onMintReview || onMintFollowUp);
  // Whole-movement coverage — the header meter and count read from the SAME
  // evaluated set the lanes do, so header and lanes can never disagree.
  const cov = {
    heard: evaluated.filter((e) => e.coll.heard && !e.s.questions.length).length,
    waiting: evaluated.filter((e) => e.coll.status === "waiting").length,
    toReach: evaluated.filter((e) => e.coll.status === "toreach" && !e.s.isRole).length,
    total: stakeholders.length,
  };
  const covPct = (n: number) => (cov.total ? Math.round((n / cov.total) * 100) : 0);
  const inviteAll = async () => {
    setInviteAllBusy(true);
    try { await inviteArea(evaluated); } finally { setInviteAllBusy(false); }
  };

  return (
    <div className="v3fs-ch-collect">
      <div className="v3fs-collect-h">
        <div className="v3fs-colh ev">{areaOrganized ? "Data collection — by area" : "Stakeholder data collection"}</div>
        {stakeholders.length > 1 ? (
          <div className="v3fs-cov" title={`${cov.heard} heard · ${cov.waiting} waiting on a reply · ${cov.toReach} still to reach`}>
            <div className="v3fs-cov-bar" aria-hidden="true">
              <span className="heard" style={{ width: `${covPct(cov.heard)}%` }} />
              <span className="waiting" style={{ width: `${covPct(cov.waiting)}%` }} />
            </div>
            <span className="v3fs-cov-count"><b>{heardCount}</b> of {stakeholders.length} {word}</span>
          </div>
        ) : (
          <span className="v3fs-collect-count"
            title={movementId === "listen"
              ? "Counted from collected evidence and responded links. The gate's coverage ledger is separate — voices are attested heard or waived in the roster."
              : "Counted from collected evidence and responded links."}>
            {heardCount} of {stakeholders.length} {word}
          </span>
        )}
        <div className="v3fs-collect-tools">
          {canInvite && cov.toReach > 0 ? (
            <button type="button" className="v3fs-btn pri" disabled={inviteAllBusy} onClick={() => void inviteAll()}
              title={`Create the collect-feedback link for all ${cov.toReach} people not yet contacted`}>
              {inviteAllBusy ? "Creating links…" : `✳ Invite ${cov.toReach} not contacted`}
            </button>
          ) : null}
          {stakeholders.length > 1 ? (
            areaOrganized
              ? <button type="button" className="v3fs-btn quiet" onClick={toggleAllAreas}>{anyLaneOpen ? "Collapse all" : "Expand all"}</button>
              : <button type="button" className="v3fs-btn quiet" onClick={toggleAll}>{anyOpen ? "Collapse all" : "Expand all"}</button>
          ) : null}
        </div>
      </div>
      {/* Design-movement validation ledger: per area, how many stakeholders have
          validated the Envision transformation / recorded a Show verdict, and how
          many links still wait. An area with links out and ZERO validations is an
          open flank on the design — same discipline as Listen's heard-count. */}
      {(movementId === "envision" || movementId === "show") ? (() => {
        const rows = movementValidationCoverage(program, movementId).filter((r) => r.validated || r.waiting);
        return rows.length ? (
          <div className="v3fs-valcov" role="note" aria-label="Validation coverage by area">
            <span className="v3fs-valcov-l">{movementId === "show" ? "Demo verdicts" : "Future-state validation"}</span>
            {rows.map((r) => (
              <span key={r.area} className={`v3fs-valcov-chip${r.validated ? " ok" : r.waiting ? " open" : ""}`}
                title={`${r.area}: ${r.validated} validated · ${r.waiting} waiting`}>
                <b>{r.area}</b> {r.validated ? `✓${r.validated}` : ""}{r.waiting ? ` · ${r.waiting} waiting` : ""}
              </span>
            ))}
          </div>
        ) : null;
      })() : null}
      {areaOrganized ? (
        <div className="v3fs-lanes">
          {laneData.map((lane, i) => (
            <AreaLane key={lane.area} area={lane.area} row={lane.row} heard={lane.heard} total={lane.total} waiting={lane.waiting}
              accent={laneAccentAt(lane.area, i)} monogram={areaMonogram(lane.area)}
              readyLabel={movementId === "listen" ? "Ready to envision" : movementId === "envision" ? "Ready to show" : "All reviewed"}
              open={laneIsOpen(lane.area, laneDefaultOpen(lane))} onToggle={(o) => setLaneOpen(lane.area, o)}
              toReach={lane.toReach} inviting={inviteBusyArea === lane.area}
              onInvite={canInvite && lane.toReach > 0 ? async () => {
                setInviteBusyArea(lane.area);
                try { await inviteArea(lane.list); } finally { setInviteBusyArea(null); }
              } : undefined}>
              {lane.list.map(renderCard)}
            </AreaLane>
          ))}
        </div>
      ) : (
        <div className="v3fs-collect-board" ref={boardRef}>
          {columns.map((col) => (
            <div key={col.key} className="v3fs-collect-col">
              <div className="v3fs-collect-col-h"><span className={`v3fs-cdot ${col.key}`} aria-hidden="true" />{col.label}<span className="v3fs-cn">{col.items.length}</span></div>
              {col.items.map(renderCard)}
            </div>
          ))}
        </div>
      )}
      <GovernedExceptions program={program} movementId={movementId} onSaveInputs={onSaveInputs} />
    </div>
  );
}

/**
 * One AREA LANE — a business area's own collection strip. Its header carries the
 * area's shape (workflows · terms), a voices-heard bar, and a ready/collecting
 * state; its body holds that area's stakeholder cards. Collapsible, so a
 * finished area folds away while the operator works the ones still open.
 */
function AreaLane({ area, row, heard, total, waiting, ready, readyLabel, open, onToggle, toReach, accent, monogram, inviting, onInvite, children }: {
  area: string;
  row?: AreaProgress;
  heard: number;
  total: number;
  /** Awaiting-reply count — the amber middle segment of the coverage meter. */
  waiting?: number;
  ready?: boolean;
  readyLabel: string;
  /** Controlled open state — driven by the header's Expand/Collapse all. */
  open: boolean;
  onToggle: (open: boolean) => void;
  /** People in this area not yet reached — the count "invite everyone" covers. */
  toReach?: number;
  /** The area's identity colour + monogram for its tile and accent edge. */
  accent?: string;
  monogram?: string;
  inviting?: boolean;
  /** Mint the unified link for every not-yet-reached person in this area. */
  onInvite?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const done = total > 0 && heard >= total;
  const pct = total ? Math.round((heard / total) * 100) : 0;
  const complete = ready ?? done;
  return (
    <details className={`v3fs-lane${complete ? " ready" : ""}`} open={open}
      onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(o); }}
      style={accent ? ({ "--lane-accent": accent } as CSSProperties) : undefined}>
      <summary className="v3fs-lane-h">
        <span className="v3fs-lane-ic" aria-hidden="true">{monogram ?? "▦"}</span>
        <div className="v3fs-lane-id">
          <b>{area}</b>
          {row ? <span>{row.workflows} workflow{row.workflows === 1 ? "" : "s"} · {row.entities} term{row.entities === 1 ? "" : "s"}</span> : null}
        </div>
        <div className="v3fs-lane-prog" title={`${heard} heard · ${waiting ?? 0} waiting · ${toReach ?? 0} to reach in ${area}`}>
          <div className="v3fs-lane-meter" aria-hidden="true">
            <span className="heard" style={{ width: `${pct}%` }} />
            <span className="waiting" style={{ width: `${total ? Math.round(((waiting ?? 0) / total) * 100) : 0}%` }} />
          </div>
          <span className="v3fs-lane-sum">{total ? <><b>{heard}</b>/{total}</> : "—"}{waiting ? <em> · {waiting} waiting</em> : null}</span>
        </div>
        <span className={`v3fs-lane-st${complete ? " ready" : ""}`}>
          <i aria-hidden="true">{complete ? "●" : "◔"}</i>{complete ? readyLabel : "Collecting"}
        </span>
        <span className="v3fs-lane-chev" aria-hidden="true" />
      </summary>
      <div className="v3fs-lane-b">
        {onInvite && toReach ? (
          <div className="v3fs-lane-invite">
            <span>{toReach} not reached yet in {area}</span>
            <button type="button" className="v3fs-btn" disabled={inviting}
              onClick={(e) => { e.preventDefault(); void onInvite(); }}
              title={`Create the collect-feedback link for all ${toReach} people not yet reached in ${area}`}>
              {inviting ? "Creating links…" : `✳ Invite everyone (${toReach})`}
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </details>
  );
}

/**
 * Governed exceptions — the escape valve for the edit-lock. The operator can't
 * hand-edit artifacts, but they CAN record a deliberate, justified deviation:
 * a first-class logged entry with a scope, a justification, an authority, and a
 * review date. It reads alongside the evidence, is attested tier-1, and is
 * auditable — a decision, never a silent change. Available on every movement.
 */
function GovernedExceptions({ program, movementId, onSaveInputs }: {
  program: ProgramSummary;
  movementId: string;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const exceptions = readGovernedExceptions(program, movementId);
  const openCount = exceptions.filter((entry) => entry.status === "open").length;
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState("");
  const [justification, setJustification] = useState("");
  const [basis, setBasis] = useState("");
  const [reviewBy, setReviewBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const persist = async (next: ReturnType<typeof readGovernedExceptions>, action: string, detail?: string) => {
    setBusy(true);
    try {
      await onSaveInputs(movementId, { _governedExceptions: JSON.stringify(next) }, { silent: true, attest: { action, detail } });
    } finally { setBusy(false); }
  };
  const save = async () => {
    const next = withNewException(exceptions, { scope, justification, basis, reviewBy }, "you");
    if (next === exceptions) return;
    await persist(next, `Governed exception logged — ${movementId}`, scope.trim().slice(0, 140));
    setScope(""); setJustification(""); setBasis(""); setReviewBy(""); setAdding(false);
  };
  const resolve = async (id: string) => {
    const next = withResolvedException(exceptions, id, resolveNote, "you");
    await persist(next, `Governed exception resolved — ${movementId}`, resolveNote.trim().slice(0, 140) || undefined);
    setResolvingId(null); setResolveNote("");
  };

  return (
    <details className="v3fs-gex" open={openCount > 0}>
      <summary>
        <span className="v3fs-gex-ic" aria-hidden="true">⚖</span>
        <b>Governed exceptions</b>
        {exceptions.length
          ? <span className="v3fs-gex-count">{openCount ? `${openCount} open` : "all resolved"} · {exceptions.length} logged</span>
          : <span className="v3fs-gex-count quiet">none logged</span>}
      </summary>
      <p className="v3fs-gex-lead">
        A logged, justified deviation — recorded and auditable, never a silent change to an artifact.
        Use it when the programme knowingly departs from the record: a waived constraint, a domain heard
        from a single voice, a step taken before a sign-off lands.
      </p>
      {exceptions.length ? (
        <div className="v3fs-gex-list">
          {exceptions.map((ex) => (
            <div key={ex.id} className={`v3fs-gex-row ${ex.status}`}>
              <div className="v3fs-gex-row-h">
                <span className={`v3fs-gex-st ${ex.status}`}>{ex.status === "open" ? "● Open" : "✓ Resolved"}</span>
                <b>{ex.scope}</b>
              </div>
              <p className="v3fs-gex-just">{ex.justification}</p>
              <div className="v3fs-gex-meta">
                {ex.basis ? <span title="Authority / evidence basis">⚑ {ex.basis}</span> : null}
                {ex.reviewBy ? <span title="Review by">↻ review {ex.reviewBy}</span> : null}
                <span title="Logged">{(ex.createdAt || "").slice(0, 10)} · {ex.createdBy}</span>
                {ex.resolution ? <span className="ok" title="How it closed">→ {ex.resolution}</span> : null}
              </div>
              {ex.status === "open" ? (
                resolvingId === ex.id ? (
                  <div className="v3fs-gex-resolve">
                    <input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="How was it closed? (optional)" aria-label="Resolution note" />
                    <button type="button" className="v3fs-btn pri" disabled={busy} onClick={() => void resolve(ex.id)}>Confirm</button>
                    <button type="button" className="v3fs-btn quiet" onClick={() => { setResolvingId(null); setResolveNote(""); }}>Cancel</button>
                  </div>
                ) : (
                  <button type="button" className="v3fs-btn quiet v3fs-gex-mark" onClick={() => setResolvingId(ex.id)}>Mark resolved</button>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div className="v3fs-gex-form">
          <label>What are you making an exception for?
            <input value={scope} onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. Cutover proceeds before Legal's sign-off" />
          </label>
          <label>Why is it justified?
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
              placeholder="The reasoning the programme is standing behind" />
          </label>
          <label>On whose authority, or on what basis?
            <input value={basis} onChange={(e) => setBasis(e.target.value)}
              placeholder="e.g. Sponsor decision 2026-07-14; residual risk accepted on the record" />
          </label>
          <label className="v3fs-gex-date">Review by (optional)
            <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
          </label>
          <div className="v3fs-gex-actions">
            <button type="button" className="v3fs-btn pri" disabled={busy || !scope.trim() || !justification.trim()}
              onClick={() => void save()}>{busy ? "Logging…" : "Log exception"}</button>
            <button type="button" className="v3fs-btn quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="v3fs-btn v3fs-gex-add" onClick={() => setAdding(true)}>⚖ Log a governed exception</button>
      )}
    </details>
  );
}

function IntervieweeCard({ program, movementId, stakeholder, captureField, coll, open, onOpenChange, primaryArea, docsStale, regenerating, onRegenerateStale, approvalItems, onSendForApproval, onSaveInputs, onMintFollowUp, onMintReview, onScheduleFollowUp, onFocusPerson, onCaptured, onDocumentCaptured }: {
  program: ProgramSummary;
  movementId: string;
  stakeholder: MovementStakeholder;
  captureField: string;
  coll: StakeholderCollection;
  /** The one area this card is filed under (area-organized movements) — scopes
   * their review link to that area's workflows so they review THEIR world. */
  primaryArea?: string;
  /** Open state is owned by the board (controlled) so minting a link — which
   * moves the card to another column and remounts it — never collapses it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A required document trails the evidence — answered "still open" items
   * only clear when it regenerates, so the card offers the regenerate instead
   * of re-asking what may already be answered. */
  docsStale?: boolean;
  /** A regeneration is in flight — the script is suppressed until it finishes. */
  regenerating?: boolean;
  onRegenerateStale?: () => Promise<void>;
  /** This person's per-artifact sign-off queue (relevant approvers only). */
  approvalItems?: StakeholderApprovalItem[];
  onSendForApproval?: (input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string }; snapshot?: string }) => Promise<string | null>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  /** Mint the ONE unified link for Listen/Envision — their questions folded into
   * a projected visual review (their workflow + the domain terms). */
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean }) => Promise<string | null>;
  /** Put the meeting on the programme calendar (attested) — the .ics download
   * is the invite; this is the record of it. */
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onFocusPerson?: (stakeholderId: string, open: boolean) => void;
  onCaptured?: () => void;
  /** A DOCUMENT (transcript/file) just landed — fires only on upload, not typed
   * capture, so the impacted artifacts auto-regenerate on a discrete event. */
  onDocumentCaptured?: () => void;
}) {
  const { name, role, questions, isRole } = stakeholder;
  // Questions the OPERATOR raised for this person, right here on the card — they
  // travel on the person's link and stay until answered or removed.
  const askKey = (name || role).trim().toLowerCase();
  const operatorAsks = useMemo(() => operatorAsksFor(program, movementId, name || role), [program, movementId, name, role]);
  const [askDraft, setAskDraft] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const saveOperatorAsks = async (next: string[]) => {
    const all = readOperatorAsks(program, movementId);
    if (next.length) all[askKey] = next; else delete all[askKey];
    await onSaveInputs(movementId, { _operatorAsks: JSON.stringify(all) }, {
      attest: { action: `Question raised for ${name || role}`, detail: next[next.length - 1]?.slice(0, 120) },
    });
  };
  const addOperatorAsk = async () => {
    const q = askDraft.trim();
    if (!q || operatorAsks.some((existing) => existing.toLowerCase() === q.toLowerCase())) { setAskDraft(""); return; }
    setAskBusy(true);
    try { await saveOperatorAsks([...operatorAsks, q]); setAskDraft(""); } finally { setAskBusy(false); }
  };
  const removeOperatorAsk = async (q: string) => {
    setAskBusy(true);
    try { await saveOperatorAsks(operatorAsks.filter((existing) => existing !== q)); } finally { setAskBusy(false); }
  };
  // Questions to mint a LINK with. Usually the displayed script, but the Frame
  // sponsor's script collapses to [] once the mandate is on record while their
  // card still offers a confirmation link — linkQuestions keeps that non-empty
  // so "Copy link" never mints a dead, question-less form. Operator-raised
  // questions always ride along so a hand-typed ask reaches the stakeholder.
  const linkQuestions = useMemo(() => [...new Set([
    ...(stakeholder.linkQuestions?.length ? stakeholder.linkQuestions : questions),
    ...operatorAsks,
  ])], [stakeholder.linkQuestions, questions, operatorAsks]);
  const { pack, heard, status } = coll;
  const first = name.split(" ")[0] || "they";
  const email = stakeholderEmail(program, name);
  // Role binding: the first-class place to say "our Solution Architect is
  // Priya, priya@…". Saved under `_roleBindings` (fingerprint-safe), so the
  // placeholder becomes a person without flagging any document stale.
  const [bindName, setBindName] = useState("");
  const [bindEmail, setBindEmail] = useState("");
  const [bindBusy, setBindBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  // A named person with no address: the operator adds it right on the card.
  // Stored as a name-keyed role binding — stakeholderEmail resolves bindings
  // by the bound NAME, so every sender and the gate's "emails on file"
  // criterion pick it up without touching the generated kit document.
  const saveEmail = async () => {
    const address = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return;
    setEmailBusy(true);
    try {
      const bindings = readRoleBindings(program, movementId);
      bindings[name] = { name, email: address };
      await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
        attest: { action: `Email on file — ${name}`, detail: address },
      });
      setEmailDraft("");
    } finally { setEmailBusy(false); }
  };
  // The link is minted on demand by Copy/Send (ensureLink) — never on open, so
  // opening a "to reach" card to work it never flips its status and jumps it
  // into "Awaiting response" (which unmounts the card and collapses it). A
  // person is "awaiting response" once the operator SENDS, not when they look.
  // A dispute the operator judges settled (the newer account stands) resolves
  // right here — same log flip as the Library panel, attested, and the row
  // leaves every script on the next derivation.
  const resolveDisputeRow = async (disputed: string) => {
    // Same model as the Inbox: the resolution becomes EVIDENCE and every
    // near-duplicate row of the dispute is removed — no resolution log.
    const bucket = readMovementInputs(program, "listen");
    const existing = typeof bucket.interviewTranscripts === "string" ? bucket.interviewTranscripts : "";
    const note = `— Operator resolution, ${new Date().toISOString().slice(0, 10)} —\nDispute: "${disputed}"\nSettled: the newer account stands. Recorded as evidence; the dispute is closed.`;
    setResolveBusy(disputed);
    try {
      await onSaveInputs("listen", {
        contradictionLog: contradictionLogWithout(program, disputed),
        interviewTranscripts: [existing.trimEnd(), note].filter(Boolean).join("\n\n"),
      }, { attest: { action: "Dispute resolved — resolution recorded as evidence", detail: disputed.slice(0, 140) } });
    } finally { setResolveBusy(null); }
  };
  const saveBinding = async () => {
    const person = bindName.trim();
    if (!person) return;
    setBindBusy(true);
    try {
      const bindings = readRoleBindings(program, movementId);
      const emailValue = bindEmail.trim();
      bindings[role] = emailValue ? { name: person, email: emailValue } : { name: person };
      await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
        attest: { action: `Role bound — ${role} → ${person}`, detail: emailValue || undefined },
      });
      setBindName("");
      setBindEmail("");
    } finally { setBindBusy(false); }
  };
  // The card's ONE link: a projected visual review (Listen/Envision) that
  // carries their questions, else a plain questions link. Shared with the lane's
  // "invite everyone" via projectStakeholderReview so both mint the same pack.
  const reviewForLink = useMemo(
    () => projectStakeholderReview(program, movementId, name, primaryArea, linkQuestions),
    [program, movementId, name, primaryArea, linkQuestions],
  );
  // A questions link is "the" link only while its questions still match the
  // current script; a review link stands as long as it exists (its content is
  // the projected review, not the volatile gap script).
  const isReviewPack = !!pack && String(pack.role ?? "").startsWith("review:");
  const packMatches = isReviewPack
    || (!!pack && (Array.isArray(pack.questions) ? pack.questions.map(String).join(" ") : "")
      === linkQuestions.slice(0, 8).join(" "));
  // The pending chip carries the per-artifact count — "1/2 approved" — so a
  // card that stays pending after one verdict reads as "one more to go", not
  // as a contradiction with the answered link.
  const apprDone = approvalItems?.filter((item) => item.status === "approved").length ?? 0;
  const apprTotal = approvalItems?.length ?? 0;
  // One calm status ladder: To reach → Invited → Follow-up open → Heard (plus the
  // approval states). "Invited · update" replaces the old "Link outdated" — same
  // meaning (their link predates the current script), stated without alarm.
  const statusLabel = status === "approved" ? "Approved"
    : status === "pending-approval" ? `Pending${apprTotal > 1 ? ` · ${apprDone}/${apprTotal}` : ""}`
      : status === "heard" ? "Heard"
        : heard ? "Follow-up open"
          : pack ? (packMatches ? "Invited" : "Invited · update") : "To reach";
  // The row's ONE next move, surfaced so the operator acts without opening every
  // card. It opens the card focused on that action (the working controls — mint,
  // copy, capture — live in the body); the label alone makes the board scannable.
  const nextAction = status === "toreach" ? "Send link"
    : (status === "waiting" && !heard) ? "Copy link"
      : (heard && stakeholder.questions.length) ? "Follow up"
        : null;
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [evFor, setEvFor] = useState<StakeholderCollection["mine"][number] | null>(null);
  // Passage to highlight when the reader opens from a contradiction question.
  const [evHighlight, setEvHighlight] = useState<string | null>(null);
  // The copy action can't rely on the clipboard (embedded contexts deny it
  // silently) — the link is ALWAYS shown inline after minting; the clipboard
  // write is best-effort and the tick reports whether it landed.
  const [linkShown, setLinkShown] = useState<string | null>(null);
  const [copiedTick, setCopiedTick] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [inviteTick, setInviteTick] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  // Sign-off actions: mint (or re-mint) this person's approval link for one
  // artifact, always showing the URL inline (clipboard is best-effort).
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [approvalCopied, setApprovalCopied] = useState<string | null>(null);
  const [approvalLinkShown, setApprovalLinkShown] = useState<string | null>(null);
  const sendApproval = async (item: StakeholderApprovalItem) => {
    if (!onSendForApproval) return;
    setApprovalBusy(item.artifactId);
    try {
      const link = await copyTextFromAction(() => onSendForApproval({
        artifactId: item.artifactId, movementId, artifactTitle: item.artifactTitle,
        approver: { name, role, email: email || undefined },
        snapshot: artifactDocument(program, item.artifactId) ?? undefined,
      }));
      if (link) { setApprovalLinkShown(link); setApprovalCopied(item.artifactId); window.setTimeout(() => setApprovalCopied(null), 2400); }
    } finally { setApprovalBusy(null); }
  };
  const copyApprovalLink = async (item: StakeholderApprovalItem) => {
    if (!item.token) return;
    const link = approvalLinkFor(program.id, { token: item.token });
    await copyTextFromAction(async () => link);
    setApprovalLinkShown(link);
    setApprovalCopied(item.artifactId);
    window.setTimeout(() => setApprovalCopied(null), 2400);
  };
  const dateRef = useRef<HTMLInputElement | null>(null);
  const effectiveLink = (pack && packMatches ? portalLinkFor(program.id, pack) : null) ?? mintedLink;

  const ensureLink = async (): Promise<string | null> => {
    if (effectiveLink) return effectiveLink;
    setLinkBusy(true);
    try {
      // The ONE unified link: a projected visual review (Listen/Envision) that
      // carries their questions, else a plain questions link (Frame/Show — the
      // edge folds a Show pack's demo walkthrough on automatically).
      if (reviewForLink && onMintReview) {
        const link = await onMintReview({
          movementId, who: name, role: role || "Reviewer", captureField,
          reviewKind: reviewForLink.kind, review: reviewForLink,
          questions: linkQuestions.length ? linkQuestions : reviewFallbackQuestions(reviewForLink),
          intro: reviewForLink.intro, unnamed: isRole,
        });
        if (link) setMintedLink(link);
        else setLinkNote("Could not create the link — try again.");
        return link;
      }
      if (onMintFollowUp && linkQuestions.length) {
        const link = await onMintFollowUp({ movementId, who: name, questions: linkQuestions, captureField, unnamed: isRole });
        if (link) setMintedLink(link);
        else setLinkNote("Could not create the link — try again.");
        return link;
      }
      setLinkNote(!onMintFollowUp && !onMintReview ? "Links aren't available here." : "Nothing to ask yet — the script is empty.");
      return null;
    } catch {
      setLinkNote("Could not create the link — try again.");
      return null;
    } finally { setLinkBusy(false); }
  };
  const copyLink = async () => {
    setLinkNote(null);
    // One click does both: the clipboard is claimed inside the gesture and
    // the minted link lands in it when ready — never "create, then copy".
    const link = await copyTextFromAction(ensureLink);
    if (!link) return;
    setLinkShown(link);
    setCopiedTick(true);
    window.setTimeout(() => setCopiedTick(false), 2400);
  };
  const sendLink = async () => { if (!email) return; const link = await ensureLink(); if (link) window.location.href = mailtoLink(email, { stakeholder: name, programmeName: program.name, link }); };

  const save = async () => {
    const text = capture.trim();
    if (!text) return;
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const phase = flowMovements().find((m) => m.id === movementId);
      const phaseId = movementId;
      void phase;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const header = `— ${[name, role, evidenceStamp()].filter(Boolean).join(", ")} —`;
      await onSaveInputs(phaseId, { [captureField]: [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n") },
        { attest: { action: `Captured — ${name}` } });
      setCapture("");
      onCaptured?.();
    } finally { setBusy(false); }
  };

  // An attached file is EVIDENCE the moment it lands: saved as a document
  // block in the person's name — canonical header + [source:] pointer — so the
  // Library lists it and the original stays downloadable. No manual step.
  // A MEETING TRANSCRIPT goes further: detected speakers are auto-mapped to
  // the movement's roster and each matched person gets their turns as their
  // OWN attributed block — everyone in the room is heard, not just this card.
  const saveAttachedDoc = async (filename: string, text: string, sourceKey?: string) => {
    const docTitle = filename.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const day = evidenceStamp();
      const docBlock = `— Document: ${docTitle}, provided by ${name}, ${day} —\n${sourceKey ? `[source: ${sourceKey}]\n` : ""}${text}`;
      const roster = resolveMovementStakeholders(program, movementId).map((s) => ({ name: s.name, role: s.role }));
      const mapping = mapTranscriptSpeakers(text, roster);
      const speakerBlocks = (mapping?.blocks ?? []).map((b) =>
        `— ${[b.name, b.role, day].filter(Boolean).join(", ")} —\n${b.text}`);
      const attestDetail = mapping
        ? `provided by ${name} · speakers mapped: ${mapping.matched.join(", ") || "none"}${mapping.unmatched.length ? ` · unmatched: ${mapping.unmatched.join(", ")}` : ""}`
        : `provided by ${name}`;
      await onSaveInputs(movementId,
        { [captureField]: [existing.trimEnd(), docBlock, ...speakerBlocks].filter(Boolean).join("\n\n") },
        { attest: { action: mapping?.blocks.length ? `Transcript mapped — ${docTitle}` : `Document added — ${docTitle}`, detail: attestDetail } });
      onCaptured?.();
      // A document/transcript is a discrete evidence event: it re-fingerprints
      // the movement's inputs, so the impacted artifacts flip to "Stale —
      // regenerate" and wait for the operator (or auto-build, if opted in).
      // We no longer force a blocking rebuild here — that blanked the board.
      onDocumentCaptured?.();
    } finally { setBusy(false); }
  };
  return (
    <>
      <details className={`v3fs-ivc ${status}`} open={open}
        onToggle={(event) => {
          const isOpen = (event.currentTarget as HTMLDetailsElement).open;
          if (isOpen !== open) onOpenChange(isOpen);
          onFocusPerson?.(stakeholder.id, isOpen);
        }}>
        <span className="v3fs-ivc-strip" aria-hidden="true" />
        <summary>
          {/* Status-toned initials — the person reads as a person at a glance. */}
          <span className={`v3fs-ivc-av ${status}`} aria-hidden="true">
            {(name || "?").split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?"}
          </span>
          <span className="v3fs-ivc-who">{name || "Stakeholder"}{role && role !== name ? <span>{role}</span> : null}</span>
          <span className="v3fs-ivc-chev" aria-hidden="true" />
          {/* Status + actions on their OWN row (grid area) so they never overlap a
              wrapped role in a narrow card. */}
          <div className="v3fs-ivc-actions">
            <span className={`v3fs-ivc-st ${status}`}>{statusLabel}</span>
            {!isRole && !email ? <span className="v3fs-ivc-noaddr" title="No email on file — open the card to add it">＋ email</span> : null}
            {nextAction ? (
              <button type="button" className="v3fs-ivc-next" title={`${nextAction} — opens ${first || name || "this"}'s card`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenChange(true); }}>
                {nextAction}<i aria-hidden="true">→</i>
              </button>
            ) : null}
          </div>
        </summary>
        <div className="v3fs-ivc-b">
          {/* A role placeholder invites its person: bind a name (and email)
              and the card becomes theirs — link, invite and captures follow. */}
          {isRole ? (
            <div className="v3fs-ivc-sec v3fs-ivc-bind">
              <div className="v3fs-ivc-sec-h">Who is this?</div>
              <div className="v3fs-ivc-bind-row">
                <input value={bindName} onChange={(event) => setBindName(event.target.value)}
                  placeholder={`Name — who is your ${role}?`} aria-label={`Name the ${role}`} />
                <input value={bindEmail} onChange={(event) => setBindEmail(event.target.value)}
                  placeholder="email (optional)" type="email" aria-label={`Email for the ${role}`} />
                <button type="button" className="v3fs-btn pri" disabled={bindBusy || !bindName.trim()}
                  onClick={() => void saveBinding()}>{bindBusy ? "Binding…" : "Bind"}</button>
              </div>
              <span className="v3fs-ivc-sec-note">Names the {role.toLowerCase()} — their link, meeting invite and captures follow the person from here on.</span>
            </div>
          ) : null}
          {/* A named person with NO address: say so, and take it here — the
              gate's "emails on file" criterion and every send follow it. */}
          {!isRole && !email ? (
            <div className="v3fs-ivc-sec v3fs-ivc-bind">
              <div className="v3fs-ivc-sec-h">No email on file</div>
              <div className="v3fs-ivc-bind-row">
                <input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)}
                  placeholder={`Email for ${name}`} type="email" aria-label={`Email for ${name}`} />
                <button type="button" className="v3fs-btn pri" disabled={emailBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.trim())}
                  onClick={() => void saveEmail()}>{emailBusy ? "Saving…" : "Save address"}</button>
              </div>
              <span className="v3fs-ivc-sec-note">The link can still be copied without it — but email sends, meeting invites and the gate&rsquo;s &ldquo;emails on file&rdquo; criterion need an address. Saved to the record, attested.</span>
            </div>
          ) : null}
          {/* The person's feedback trail lives on the RECORD RAIL — opening
              this card focuses the rail on them, so the card keeps only the
              work: their script, the channels, and the capture box. */}

          {/* Follow-up questions / their script. A question born from a
              contradiction carries its receipts: the disputed passage links
              straight into the evidence reader, highlighted, so the operator
              (or the stakeholder on a call) reviews the source before judging. */}
          {heard && regenerating ? (
            // A regeneration is in flight. The follow-up script is derived from
            // the documents — showing it now, while a kit or charter is still
            // regenerating, would present a half-built, inaccurate script. Hold
            // it until the whole run lands; the accurate script returns then.
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">Documents regenerating</div>
              <div className="v3fs-ivc-regen">
                <p>Reading {first}&rsquo;s answers into the documents… the follow-up script updates once every document has finished regenerating.</p>
              </div>
            </div>
          ) : heard && docsStale ? (
            // Their answers are ON THE RECORD, but the documents that draw on them
            // (ontology, atlas, …) are now out of date. Auto-build is OFF by
            // default, so nothing regenerates on its own — "Update now" is the
            // action that rebuilds them with the new answers; whatever remains
            // open afterwards returns here as a fresh follow-up script.
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">Answers on the record</div>
              <div className="v3fs-ivc-regen">
                <p>{first}&rsquo;s answers are captured. The documents that draw on them are now out of date — <b>Update now</b> rebuilds them with what {first} said, then anything still open returns here as a fresh script.</p>
                {onRegenerateStale ? (
                  <button type="button" className="v3fs-btn quiet" disabled={regenBusy} onClick={async () => {
                    setRegenBusy(true);
                    try { await onRegenerateStale(); } finally { setRegenBusy(false); }
                  }}>{regenBusy ? "Updating…" : "↻ Update now"}</button>
                ) : null}
              </div>
            </div>
          ) : questions.length ? (
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Still open — ask on the next round" : "Their script"}
                {heard ? <span className="v3fs-ivc-sec-note">these are unresolved gaps &amp; disputes; they clear when the artifact is regenerated or the dispute resolved</span> : null}</div>
              <ul className="v3fs-ivc-q">{questions.map((q, i) => {
                const disputed = q.match(/disagree[^"]*"(.{8,140}?)"/i)?.[1];
                const source = disputed
                  ? flowMovements().flatMap((m) => movementEvidence(program, m)).find((entry) => entry.text && locateQuote(entry.text, disputed))
                  : undefined;
                return (
                  <li key={i}>
                    {q}
                    {source ? (
                      <button type="button" className="v3fs-a v3fs-ivc-evlink" title={`Said by ${source.who} — read the passage in the source`}
                        onClick={() => { setEvHighlight(disputed ?? null); setEvFor(source); }}>
                        ⤷ review evidence
                      </button>
                    ) : null}
                    {disputed ? (
                      <button type="button" className="v3fs-a v3fs-ivc-evlink" disabled={resolveBusy === disputed}
                        title="Already answered — mark the dispute resolved (attested); it leaves the scripts"
                        onClick={() => void resolveDisputeRow(disputed)}>
                        {resolveBusy === disputed ? "Resolving…" : "✓ mark resolved"}
                      </button>
                    ) : null}
                  </li>
                );
              })}</ul>
            </div>
          ) : null}

          {/* Ask a question: the operator can raise their own question for THIS
              stakeholder at any point — it rides on the person's link and stays
              on their card until answered or removed. Available on every card,
              every movement (Listen, Envision, Show…). */}
          {!regenerating ? (
            <div className="v3fs-ivc-sec v3fs-ivc-ask">
              <div className="v3fs-ivc-sec-h">Ask {first} a question
                <span className="v3fs-ivc-sec-note">your own question — travels on {first}&rsquo;s link until answered</span>
              </div>
              {operatorAsks.length ? (
                <ul className="v3fs-ivc-q v3fs-ivc-askq">{operatorAsks.map((q, i) => (
                  <li key={i}>
                    {q}
                    <button type="button" className="v3fs-a v3fs-ivc-evlink" disabled={askBusy}
                      title="Remove this question" onClick={() => void removeOperatorAsk(q)}>✕ remove</button>
                  </li>
                ))}</ul>
              ) : null}
              <div className="v3fs-ivc-askadd">
                <input value={askDraft} onChange={(event) => setAskDraft(event.target.value)}
                  placeholder={`Ask ${first} something…`} aria-label={`Ask ${name || role} a question`} disabled={askBusy}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addOperatorAsk(); } }} />
                <button type="button" className="v3fs-btn" disabled={askBusy || !askDraft.trim()} onClick={() => void addOperatorAsk()}>
                  {askBusy ? "Adding…" : "＋ Ask"}
                </button>
              </div>
            </div>
          ) : null}

          {/* Sign-off: the approval workflow LIVES ON THE PERSON, not the
              artifact — each artifact this contributor's evidence fed lists
              here with their own ask/verdict; the artifact card only rolls
              up everyone's verdicts. Shown once their questions are settled. */}
          {!isRole && approvalItems?.length && !questions.length && onSendForApproval ? (
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">Sign-off
                <span className="v3fs-ivc-sec-note">these documents were built from {first}&rsquo;s evidence — their approval is part of the record</span>
              </div>
              <div className="v3fs-ivc-appr">
                {approvalItems.map((item) => (
                  <div key={item.artifactId} className={`v3fs-ivc-appr-row ${item.status}`}>
                    <span className="v3fs-ivc-appr-t">{item.artifactTitle}</span>
                    {item.status === "approved" && item.preDatesDocument ? (
                      <>
                        <span className="v3fs-ivc-appr-st changes" title="The document changed after they approved it — their sign-off covers an earlier version">
                          ↻ Approved before latest changes
                        </span>
                        <button type="button" className="v3fs-btn" disabled={approvalBusy === item.artifactId}
                          onClick={() => void sendApproval(item)}>
                          {approvalBusy === item.artifactId ? "…" : "Re-request"}
                        </button>
                      </>
                    ) : item.status === "approved" ? (
                      <span className="v3fs-ivc-appr-st ok">✓ Approved{item.decidedAt ? ` · ${String(item.decidedAt).slice(0, 10)}` : ""}</span>
                    ) : item.status === "changes" ? (
                      <>
                        <span className="v3fs-ivc-appr-st changes" title={item.comment || undefined}>↺ Changes requested{item.comment ? ` — “${item.comment.slice(0, 60)}”` : ""}</span>
                        <button type="button" className="v3fs-btn" disabled={approvalBusy === item.artifactId}
                          onClick={() => void sendApproval(item)}>
                          {approvalBusy === item.artifactId ? "…" : "Send again"}
                        </button>
                      </>
                    ) : item.status === "in-review" ? (
                      <>
                        <span className="v3fs-ivc-appr-st wait">◷ {item.token ? "Awaiting verdict" : "Reply received — recording…"}</span>
                        {/* The link is copyable only while the ask is genuinely
                            open; once answered, the used link is withheld (its
                            verdict is landing), so no dead "Copy link" button. */}
                        {item.token ? (
                          <button type="button" className="v3fs-btn" onClick={() => void copyApprovalLink(item)}>
                            {approvalCopied === item.artifactId ? "Copied ✓" : "⎘ Copy link"}
                          </button>
                        ) : (
                          /* Reply received but the verdict never landed on the
                             record — re-send a fresh link so it's never stuck. */
                          <button type="button" className="v3fs-btn quiet" disabled={approvalBusy === item.artifactId}
                            onClick={() => void sendApproval(item)} title="Their reply didn't record a verdict — send a fresh sign-off link">
                            {approvalBusy === item.artifactId ? "…" : "↻ Re-request"}
                          </button>
                        )}
                      </>
                    ) : (
                      <button type="button" className="v3fs-btn pri" disabled={approvalBusy === item.artifactId}
                        onClick={() => void sendApproval(item)}>
                        {approvalBusy === item.artifactId ? "Creating…" : "Request sign-off"}
                      </button>
                    )}
                  </div>
                ))}
                {approvalLinkShown ? (
                  <span className="v3fs-ivc-linkrow">
                    <input readOnly value={approvalLinkShown} onFocus={(event) => event.currentTarget.select()}
                      aria-label={`Sign-off link for ${name}`} />
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Meeting + link channels. Not-yet-heard people get "Reach out";
              heard people KEEP the same three channels as "Follow up" whenever
              the kit still has questions for them (it swaps in the gap-driven
              follow-up script once a conversation is on record) — so the Frame
              sponsor's single card never strands the operator without a send
              button, and every movement's card behaves identically. */}
          {(!heard || questions.length) && !(heard && docsStale) && !(heard && regenerating) ? (
            // While answers await regeneration the channels HIDE: sending a
            // link or booking a meeting now would re-ask a stale script. The
            // regenerate notice above is the only door until the record reads.
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Follow up" : "Reach out"}</div>
              {/* Three ways in, no standing form: copy the link, email the
                  link, or send a meeting invite — the date picker lives INSIDE
                  the invite action, asked for only when it's needed. */}
              <div className="v3fs-ivc-ch">
                <button type="button" className={`v3fs-btn${email ? "" : " pri"}`} disabled={linkBusy} onClick={() => void copyLink()}>
                  {linkBusy && !email ? "…" : copiedTick ? "Copied ✓" : effectiveLink ? "⎘ Copy link" : "⎘ Create & copy link"}
                </button>
                {/* The live URL sits beside the button whenever one EXISTS —
                    derived from the persisted pack, so it survives the card
                    remounting when minting moves it across status columns. */}
                {(effectiveLink ?? linkShown) ? (
                  <span className="v3fs-ivc-linkrow">
                    <input readOnly value={effectiveLink ?? linkShown ?? ""} onFocus={(event) => event.currentTarget.select()}
                      aria-label={`Response link for ${name}`} />
                    {copiedTick ? <span className="v3fs-ivc-linkok">✓</span> : null}
                  </span>
                ) : null}
                {/* Engagement read: where the demo/review loses this person —
                    opened-but-silent is a different follow-up than never-opened. */}
                {pack && engagementLabel(pack) ? (
                  <span className="v3fs-ivc-engage" title="From the link's own progress pings">👁 {engagementLabel(pack)}</span>
                ) : null}
                {/* Send appears only once a link EXISTS — you copy/create the
                    link first, then send it. Sending before a link is minted
                    would email a draft with nothing in it. */}
                {email && (effectiveLink ?? linkShown) ? (
                  <button type="button" className="v3fs-btn pri" disabled={linkBusy} title={`Opens a draft to ${email}`} onClick={() => void sendLink()}>✉ Send link</button>
                ) : null}
                <button type="button" className="v3fs-btn" title={`Pick a date — schedules the meeting and downloads the invite for ${name}`}
                  onClick={() => {
                    const picker = dateRef.current;
                    if (!picker) return;
                    if ("showPicker" in picker) { try { (picker as HTMLInputElement & { showPicker: () => void }).showPicker(); return; } catch { /* fall through */ } }
                    picker.focus(); picker.click();
                  }}>🗓 Send meeting invite</button>
                <input ref={dateRef} type="date" className="v3fs-ivc-date-hidden" tabIndex={-1} aria-label={`Meeting date for ${name}`}
                  value={date}
                  onChange={(e) => {
                    const picked = e.target.value;
                    setDate(picked);
                    if (!picked) return;
                    // Two halves of one action: the meeting goes ON THE
                    // PROGRAMME CALENDAR (attested, visible in Today), and the
                    // .ics downloads as the stakeholder's invite.
                    void onScheduleFollowUp?.(movementId, name, picked);
                    const ics = buildMeetingIcs({ who: name, email, date: picked, programmeName: program.name, intro: "", questions: linkQuestions });
                    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `${movementId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                    setInviteTick(`Scheduled for ${picked}${onScheduleFollowUp ? " — on the programme calendar" : ""}; the invite downloaded — open it to send.`);
                    window.setTimeout(() => setInviteTick(null), 6000);
                  }} />
              </div>
              {linkNote ? <div className="v3fs-ivc-note warn">{linkNote}</div> : null}
              {inviteTick ? <div className="v3fs-ivc-note ok">🗓 {inviteTick}</div> : null}
            </div>
          ) : null}

          {/* Capture what they said — typed, or spoken and transcribed. */}
          <div className="v3fs-ivc-cap">
            <textarea rows={2} value={capture} onChange={(e) => setCapture(e.target.value)}
              placeholder={`What ${first} said — attribution added for you`} aria-label={`Capture ${name}'s input`} />
            <div className="v3fs-ivc-cap-row">
              <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
                {busy ? "Saving…" : "Capture"}
              </button>
              <TranscribeButton onText={(transcript) => setCapture((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
              <AttachFileButton programId={program.id}
                onExtracted={(filename, text, sourceKey) => void saveAttachedDoc(filename, text, sourceKey)} />
            </div>
          </div>
        </div>
      </details>
      {evFor ? <EvidenceReader entry={evFor} highlight={evHighlight ?? undefined} onClose={() => { setEvFor(null); setEvHighlight(null); }} /> : null}
    </>
  );
}
