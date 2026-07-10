/**
 * Tracks — the build decomposed into workstreams over the shared data model.
 *
 * The Agentic Blueprint proposes tracks; adopting that Tier-2 decision merges
 * them into rawData.tracks[] (see flowDecisions.ts). From then on the board is
 * the operating surface: every track carries its own show/refine record, and
 * acceptance is earned — at least two accepted demonstration passes, or one
 * accepted pass whose diff against the previous cycle was stable. Mutators
 * here are pure blob transforms; callers persist via updateProgramData.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export interface FlowShowPass {
  ts: string;
  stakeholder?: string;
  verdict: "accepted" | "accepted-with-changes" | "rework";
  note?: string;
  /** The refine diff since the previous pass was reviewed and held stable. */
  stableDiff?: boolean;
}

export interface FlowTrack {
  id: string;
  name: string;
  goal: string;
  /** Track ids this one waits on (shared entities, upstream slices). */
  dependsOn: string[];
  /** Build slices from the blueprint that live in this track. */
  slices: string[];
  leadStakeholder?: string;
  createdAt: string;
  showPasses: FlowShowPass[];
}

export interface TrackAcceptance {
  passes: number;
  acceptedPasses: number;
  accepted: boolean;
  /** Board label, e.g. "pass 2 · accepted" or "pass 1 · rework". */
  label: string;
}

export interface TrackPace {
  tone: "on-pace" | "watch" | "stalled";
  label: string;
  daysSinceActivity: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

export function trackSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "track";
}

function normalizePass(entry: Record<string, unknown>): FlowShowPass {
  const verdict = entry.verdict === "accepted" || entry.verdict === "accepted-with-changes" || entry.verdict === "rework"
    ? entry.verdict
    : "rework";
  return {
    ts: String(entry.ts ?? ""),
    stakeholder: typeof entry.stakeholder === "string" ? entry.stakeholder : undefined,
    verdict,
    note: typeof entry.note === "string" ? entry.note : undefined,
    stableDiff: entry.stableDiff === true ? true : undefined,
  };
}

export function listFlowTracks(program: ProgramSummary): FlowTrack[] {
  const list = innerData(program).tracks;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowTrack => ({
    id: String(entry.id ?? ""),
    name: String(entry.name ?? "Track"),
    goal: String(entry.goal ?? ""),
    dependsOn: Array.isArray(entry.dependsOn) ? entry.dependsOn.map(String).filter(Boolean) : [],
    slices: Array.isArray(entry.slices) ? entry.slices.map(String).filter(Boolean) : [],
    leadStakeholder: typeof entry.leadStakeholder === "string" ? entry.leadStakeholder : undefined,
    createdAt: String(entry.createdAt ?? ""),
    showPasses: Array.isArray(entry.showPasses) ? entry.showPasses.filter(isRecord).map(normalizePass) : [],
  })).filter((track) => track.id);
}

/**
 * The acceptance rule the board enforces: two accepted demonstration passes,
 * or one accepted pass over a reviewed-stable diff — refinement has converged,
 * not merely happened once.
 */
export function trackAcceptance(track: FlowTrack): TrackAcceptance {
  const passes = track.showPasses.length;
  const acceptedPasses = track.showPasses.filter((p) => /accepted/.test(p.verdict)).length;
  const last = track.showPasses[track.showPasses.length - 1];
  const accepted = acceptedPasses >= 2 || (!!last && /accepted/.test(last.verdict) && last.stableDiff === true);
  const label = passes === 0
    ? "no demonstrations yet"
    : `pass ${passes} · ${last ? last.verdict.replace(/-/g, " ") : ""}`;
  return { passes, acceptedPasses, accepted, label };
}

/** Pace from recency: fresh under a week, watch under two, stalled beyond. */
export function trackPace(track: FlowTrack, accepted: boolean): TrackPace {
  if (accepted) return { tone: "on-pace", label: "accepted", daysSinceActivity: null };
  const stamps = [track.createdAt, ...track.showPasses.map((p) => p.ts)]
    .map((s) => Date.parse(s)).filter((t) => !Number.isNaN(t));
  if (stamps.length === 0) return { tone: "watch", label: "no activity recorded", daysSinceActivity: null };
  const days = Math.floor((Date.now() - Math.max(...stamps)) / 86_400_000);
  if (days < 7) return { tone: "on-pace", label: "on pace", daysSinceActivity: days };
  if (days < 14) return { tone: "watch", label: `quiet ${days}d`, daysSinceActivity: days };
  return { tone: "stalled", label: `stalled ${days}d`, daysSinceActivity: days };
}

/** Unaccepted upstream tracks this one is waiting on — the dependency chips. */
export function trackBlockers(track: FlowTrack, all: FlowTrack[]): FlowTrack[] {
  return track.dependsOn
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is FlowTrack => !!t && !trackAcceptance(t).accepted);
}

/** Record a show/refine pass. Returns the full next data blob, or null. */
export function recordShowPass(
  program: ProgramSummary,
  trackId: string,
  pass: { stakeholder?: string; verdict: FlowShowPass["verdict"]; note?: string; stableDiff?: boolean },
): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.tracks) ? (inner.tracks as unknown[]) : [];
  if (!list.filter(isRecord).some((entry) => entry.id === trackId)) return null;
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), verdict: pass.verdict };
  if (pass.stakeholder) entry.stakeholder = pass.stakeholder;
  if (pass.note) entry.note = pass.note;
  if (pass.stableDiff) entry.stableDiff = true;
  const nextTracks = list.map((item) =>
    isRecord(item) && item.id === trackId
      ? { ...item, showPasses: [...(Array.isArray(item.showPasses) ? item.showPasses : []), entry].slice(-20) }
      : item,
  );
  return wrapProgramState(wrapper, { ...inner, tracks: nextTracks }, usesNestedData);
}

/** Add a track by hand (the blueprint is the usual source). Null if the id exists. */
export function addFlowTrack(
  program: ProgramSummary,
  input: { name: string; goal?: string; dependsOn?: string[] },
): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.tracks) ? (inner.tracks as unknown[]) : [];
  const id = trackSlug(input.name);
  if (list.filter(isRecord).some((entry) => entry.id === id)) return null;
  const track: Record<string, unknown> = {
    id, name: input.name.trim(), goal: (input.goal ?? "").trim(),
    dependsOn: input.dependsOn ?? [], slices: [],
    createdAt: new Date().toISOString(), showPasses: [],
  };
  return wrapProgramState(wrapper, { ...inner, tracks: [...list, track].slice(-24) }, usesNestedData);
}
