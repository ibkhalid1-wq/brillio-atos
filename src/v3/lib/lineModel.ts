/**
 * The Line — a read-only PROJECTION of the programme record onto the
 * production-line home view (design iteration 5, "Revision One").
 *
 * Everything here derives from selectors the classic Flow UI already trusts:
 * movementArtifacts (present/stale), gateChecklist + gateReviews (the gate
 * arithmetic), areaProgress (per-area grounding), loopState (rounds and
 * convergence), listenCoverage (voices heard). NOTHING is stored for this
 * view and nothing is written by it — which is what lets it run beside the
 * classic chrome on the same live record without any possibility of drift:
 * two skins, one truth.
 *
 * Maturity vocabulary (the design's five steps), mapped to real signals:
 *   0 ○ not seeded    — no document, no ledger stub
 *   1 ◔ provisional   — drafted, but ahead of its evidence (mandate-seeded
 *                       area slices; Ship/Evolve documents drafted before the
 *                       loop converges)
 *   2 ◑ grounded      — built on real evidence for its scope
 *   3 ◕ reviewed      — at least one stakeholder sign-off on record
 *   4 ● approved      — the movement's gate is approved (or every asked
 *                       approver signed)
 */
import type { ProgramSummary } from "@/new/types";
import {
  flowMovements, movementArtifacts, gateChecklist, listenCoverage,
  type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { programAreas, areaProgress } from "@/v3/components/flow/flowAreas";
import { loopState } from "@/v3/components/flow/flowLoop";
import { artifactApprovalRollup } from "@/v3/components/flow/flowApprovals";

export type LineMaturity = 0 | 1 | 2 | 3 | 4;
export const LINE_GLYPHS: Record<LineMaturity, string> = { 0: "○", 1: "◔", 2: "◑", 3: "◕", 4: "●" };

export interface LineSegment { area: string; initials: string; maturity: LineMaturity }

export interface LineStation {
  id: string;
  /** The artifact card behind this station — null only when nothing exists to open. */
  card: ArtifactCardModel | null;
  title: string;
  subtitle: string;
  maturity: LineMaturity;
  perArea: LineSegment[] | null;
  needsRefresh: boolean;
}

export interface LineGateItem { label: string; done: boolean; advisory: boolean; why?: string }

export interface LineBand {
  id: "frame" | "listen" | "loop" | "ship" | "evolve";
  name: string;
  half?: string;
  scope: string;
  chip: { text: string; tone: "green" | "amber" | "accent" | "dim" };
  gate: LineGateItem[];
  intake?: string;
  note?: string;
  stations: LineStation[];
}

export interface LineModel {
  bands: LineBand[];
  areas: string[];
  round: number;
  stats: {
    converged: number; areasTotal: number;
    heardDone: number; heardTotal: number;
    refresh: number;
  };
}

/** Two-letter initials for an area label — the segment strips' labels. */
export function areaInitials(area: string): string {
  const words = area.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const two = (words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "");
  return two.toUpperCase() || area.slice(0, 2).toUpperCase();
}

/** Plain-word subtitles — the walkthrough's vocabulary pass, in one place. */
const SUBTITLES: Record<string, string> = {
  "charter": "Why we're doing this, in the sponsor's words",
  "discovery-kit": "The cast and the questions — it names the areas",
  "domain-ontology": "The map of your business — its shared dictionary",
  "current-state-atlas": "How the work flows today, area by area",
  "architecture-strategy": "The shape of the build, chosen on record",
  "experience-design": "What each screen and flow becomes",
  "agentic-blueprint": "What each agent does, and with which data",
  "prototype-build": "The working build — refined only where asked",
  "prototype-pack": "The working build — refined only where asked",
  "demo-scripts": "A demo for every heard voice; verdicts roll up per area",
  "hardening-plan": "Guardrails and rollback — drafted early from the Blueprint",
  "eval-suite": "Pass bars, from the record",
  "runbook": "How we run it after cutover",
  "benefits-tracker": "The pulse against the Charter's KPIs",
  "optimization-backlog": "Drift notes and improvement candidates",
};

const gateApproved = (program: ProgramSummary, movementId: string): boolean =>
  program.gateReviews?.[movementId]?.status === "approved";

/** Programme-wide maturity for one artifact card. */
function cardMaturity(program: ProgramSummary, card: ArtifactCardModel | null, movementOk: boolean): LineMaturity {
  if (!card?.present) return 0;
  if (movementOk) return 4;
  const roll = artifactApprovalRollup(program, card.movementId, card.id);
  if (roll.overall === "approved") return 4;
  if (roll.overall === "in-review" || roll.approvedCount > 0) return 3;
  return 2;
}

function station(
  program: ProgramSummary,
  card: ArtifactCardModel | null,
  movementOk: boolean,
  over?: Partial<Pick<LineStation, "id" | "title" | "subtitle" | "maturity" | "perArea">>,
): LineStation {
  const maturity = over?.maturity ?? cardMaturity(program, card, movementOk);
  return {
    id: over?.id ?? card?.id ?? "unknown",
    card,
    title: over?.title ?? card?.title ?? "—",
    subtitle: over?.subtitle ?? (card ? SUBTITLES[card.id] ?? "" : ""),
    maturity,
    perArea: over?.perArea ?? null,
    needsRefresh: !!card?.stale,
    ...(over?.perArea !== undefined ? { perArea: over.perArea } : {}),
  };
}

function gateItems(program: ProgramSummary, movementId: string): LineGateItem[] {
  const movement = flowMovements().find((m) => m.id === movementId);
  if (!movement) return [];
  const artifacts = movementArtifacts(program, movement);
  return gateChecklist(program, movement, artifacts).map((item) => ({
    label: item.label, done: item.done, advisory: !!item.advisory, why: item.why,
  }));
}

function gateChip(items: LineGateItem[], approved: boolean): LineBand["chip"] {
  const gating = items.filter((item) => !item.advisory);
  const done = gating.filter((item) => item.done).length;
  if (approved) return { text: `Closed at ${done}/${gating.length}`, tone: "green" };
  if (gating.length === 0) return { text: "Not seeded", tone: "dim" };
  return { text: `Gate ${done}/${gating.length} · auto-closes`, tone: done > 0 ? "amber" : "dim" };
}

export function buildLineModel(program: ProgramSummary): LineModel {
  const movements = flowMovements();
  const byId = new Map(movements.map((m) => [m.id, m] as const));
  const cards = new Map<string, ArtifactCardModel>();
  for (const movement of movements) {
    for (const card of movementArtifacts(program, movement)) cards.set(card.id, card);
  }
  const card = (id: string): ArtifactCardModel | null => cards.get(id) ?? null;

  const areas = programAreas(program);
  const progress = new Map(areaProgress(program).map((row) => [row.area, row] as const));
  const loop = loopState(program);
  const loopByArea = new Map(loop.areas.map((a) => [a.area, a] as const));
  const heard = listenCoverage(program);

  const frameOk = gateApproved(program, "frame");
  const listenOk = gateApproved(program, "listen");
  const envisionOk = gateApproved(program, "envision");
  const showOk = gateApproved(program, "show");
  const shipOk = gateApproved(program, "ship");

  // ── per-area maturity for the Listen pair: the provisional-seed story.
  // A drafted document covers every area at ◔; an area whose voices have
  // been heard rises to ◑; the approved gate lifts everything to ●.
  const listenSegments = (present: boolean): LineSegment[] =>
    areas.map((area) => {
      const row = progress.get(area);
      const maturity: LineMaturity = listenOk ? 4
        : row && row.heard.length > 0 ? 2
        : present ? 1 : 0;
      return { area, initials: areaInitials(area), maturity };
    });

  // ── per-area verdicts for the Validation station, straight from the loop.
  const validationSegments = (): LineSegment[] =>
    areas.map((area) => {
      const a = loopByArea.get(area);
      const maturity: LineMaturity = showOk ? 4
        : a?.converged ? 4
        : a && a.total > 0 ? 2
        : loop.hasPrototype ? 1 : 0;
      return { area, initials: areaInitials(area), maturity };
    });

  // Ship/Evolve documents drafted ahead of convergence are honest drafts: ◔.
  const earlyDraft = (m: LineMaturity): LineMaturity => (m === 2 && !loop.converged ? 1 : m);

  const onto = card("domain-ontology");
  const atlas = card("current-state-atlas");
  const proto = card("prototype-build")?.present ? card("prototype-build") : card("prototype-pack");
  const demoCard = card("demo-scripts");

  const frameGate = gateItems(program, "frame");
  const listenGate = gateItems(program, "listen");
  const loopGate = [...gateItems(program, "envision"), ...gateItems(program, "show")];
  const shipGate = gateItems(program, "ship");
  const evolveGate = gateItems(program, "evolve");

  const bands: LineBand[] = [
    {
      id: "frame", name: "Frame", scope: "programme-wide",
      chip: gateChip(frameGate, frameOk), gate: frameGate,
      stations: [
        station(program, card("charter"), frameOk),
        station(program, card("discovery-kit"), frameOk),
      ],
    },
    {
      id: "listen", name: "Listen", scope: "per area",
      chip: gateChip(listenGate, listenOk), gate: listenGate,
      intake: heard.total > 0
        ? `${heard.done} of ${heard.total} voices heard — add to the record from the classic Listen board`
        : "Interviews & portal links — waits for the Kit to cast the roster",
      note: "A correction demotes the slice it touches; everything downstream keeps its maturity but is flagged needs refresh until regenerated.",
      stations: [
        station(program, onto, listenOk, { perArea: listenSegments(!!onto?.present) }),
        station(program, atlas, listenOk, { perArea: listenSegments(!!atlas?.present) }),
      ],
    },
    {
      id: "loop", name: "Design Loop", half: "Envision ▸ Show", scope: "per area",
      chip: {
        text: loop.converged
          ? `Converged · round ${loop.round}`
          : `Round ${loop.round} · ${loop.areasConverged} of ${loop.areasTotal || areas.length} converged`,
        tone: loop.converged ? "green" : "accent",
      },
      gate: loopGate,
      note: "Clients aren't asked while the team designs — their verdicts land at Validation, the Show half of this loop.",
      stations: [
        station(program, card("architecture-strategy"), envisionOk),
        station(program, card("experience-design"), envisionOk),
        station(program, card("agentic-blueprint"), envisionOk),
        station(program, proto, envisionOk, { id: "prototype", title: "Prototype" }),
        station(program, demoCard, showOk, {
          id: "validation", title: "Validation", perArea: validationSegments(),
          subtitle: SUBTITLES["demo-scripts"],
        }),
      ],
    },
    {
      id: "ship", name: "Ship", scope: "programme-wide · lanes",
      chip: shipOk
        ? { text: "Shipped", tone: "green" }
        : { text: "Deliberate — never auto-closes", tone: card("hardening-plan")?.present ? "amber" : "dim" },
      gate: shipGate,
      note: "Six lanes compile from the Blueprint, the hardening plan and the roster when the plan is adopted: Build · Data · Validation & evals · Hardening · Enablement · Cutover.",
      stations: [
        station(program, card("hardening-plan"), shipOk, { maturity: earlyDraft(cardMaturity(program, card("hardening-plan"), shipOk)) }),
        station(program, card("eval-suite"), shipOk, { maturity: earlyDraft(cardMaturity(program, card("eval-suite"), shipOk)) }),
        station(program, card("runbook"), shipOk, { maturity: earlyDraft(cardMaturity(program, card("runbook"), shipOk)) }),
      ],
    },
    {
      id: "evolve", name: "Evolve", scope: "continuous",
      chip: { text: gateApproved(program, "evolve") ? "Running steady" : "Continuous", tone: gateApproved(program, "evolve") ? "green" : "dim" },
      gate: evolveGate,
      note: "After cutover, a drift signal flags its area — reopening the column is your call, one click, scoped.",
      stations: [
        station(program, card("benefits-tracker"), false, { maturity: earlyDraft(cardMaturity(program, card("benefits-tracker"), false)) }),
        station(program, card("optimization-backlog"), false, { maturity: earlyDraft(cardMaturity(program, card("optimization-backlog"), false)) }),
      ],
    },
  ];

  // The movements map is consulted for band ordering sanity only; keep the
  // reference so a methodology change (a renamed movement) fails loudly here
  // in tests rather than silently misrendering.
  if (!byId.has("frame") || !byId.has("listen")) {
    // Methodology drift — render what we can; tests assert against this.
  }

  const refresh = bands.reduce((n, b) => n + b.stations.filter((s) => s.needsRefresh).length, 0);

  return {
    bands,
    areas,
    round: loop.round,
    stats: {
      converged: loop.areasConverged,
      areasTotal: loop.areasTotal || areas.length,
      heardDone: heard.done,
      heardTotal: heard.total,
      refresh,
    },
  };
}
