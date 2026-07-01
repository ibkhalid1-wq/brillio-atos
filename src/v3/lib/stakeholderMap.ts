/**
 * Stakeholder-map derivations — the influence/interest strategy grid, the
 * current→target engagement gap, and blind-spot detection.
 *
 * These rules were previously inline in StakeholderView: the quadrant label was
 * a corner-only ternary that mislabelled every `medium` cell as "Monitor", and
 * the current→target gap and "unknown" blind spots were never surfaced at all.
 * Centralising them here makes the grid correct for all nine cells and keeps the
 * strategy/gap logic unit-testable and in one place.
 */
import type { StakeholderProfile } from "@/new/types";

type Level = "high" | "medium" | "low";
type Engagement = StakeholderProfile["currentEngagement"];
type TargetEngagement = StakeholderProfile["targetEngagement"];

export type StakeholderStrategy = "Manage closely" | "Keep satisfied" | "Keep informed" | "Monitor";

/**
 * Mendelow power/interest strategy for an influence×interest pair, extended to
 * the medium band. Corners match the classic 2×2 (high/high → Manage closely,
 * high/low → Keep satisfied, low/high → Keep informed, low/low → Monitor);
 * medium rows/columns round toward the more attentive strategy so no
 * high-influence or high-interest stakeholder is under-managed.
 */
const STRATEGY_GRID: Record<Level, Record<Level, StakeholderStrategy>> = {
  // influence → interest → strategy
  high: { high: "Manage closely", medium: "Manage closely", low: "Keep satisfied" },
  medium: { high: "Keep informed", medium: "Keep informed", low: "Monitor" },
  low: { high: "Keep informed", medium: "Monitor", low: "Monitor" },
};

export function quadrantStrategy(influence: Level, interest: Level): StakeholderStrategy {
  return STRATEGY_GRID[influence][interest];
}

// Engagement ordered weakest→strongest so a positive delta means "move up".
const ENGAGEMENT_RANK: Record<Engagement, number> = {
  resistant: 0,
  unknown: 1,
  neutral: 2,
  supportive: 3,
  champion: 4,
};

const TARGET_RANK: Record<TargetEngagement, number> = {
  neutral: 2,
  supportive: 3,
  champion: 4,
};

export type EngagementDelta =
  /** Current engagement is unknown — assess before planning a move. */
  | { kind: "unknown" }
  /** Current engagement already meets or exceeds the target. */
  | { kind: "on-target" }
  /** Stakeholder needs to move up `steps` bands from `from` to `to`. */
  | { kind: "move"; from: Engagement; to: TargetEngagement; steps: number };

export function engagementDelta(entry: StakeholderProfile): EngagementDelta {
  if (entry.currentEngagement === "unknown") return { kind: "unknown" };
  const current = ENGAGEMENT_RANK[entry.currentEngagement];
  const target = TARGET_RANK[entry.targetEngagement];
  if (current >= target) return { kind: "on-target" };
  return {
    kind: "move",
    from: entry.currentEngagement,
    to: entry.targetEngagement,
    steps: target - current,
  };
}

/** Needs movement toward its target posture (excludes unknowns and on-target). */
export function needsMovement(entry: StakeholderProfile): boolean {
  return engagementDelta(entry).kind === "move";
}

/**
 * A blind spot: engagement or sentiment is unknown, so the stakeholder can't be
 * positioned or planned for until assessed.
 */
export function isBlindSpot(entry: StakeholderProfile): boolean {
  return entry.currentEngagement === "unknown" || entry.sentiment === "unknown";
}

/** No named owner assigned — the relationship is unmanaged. */
export function isUnowned(entry: StakeholderProfile): boolean {
  return !entry.owner;
}

/** High-influence stakeholder without a named owner — the sharpest governance gap. */
export function isUnownedHighInfluence(entry: StakeholderProfile): boolean {
  return entry.influence === "high" && !entry.owner;
}
