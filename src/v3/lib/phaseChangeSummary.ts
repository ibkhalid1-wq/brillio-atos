/**
 * "Since your last visit" — what changed on a phase between two points in time.
 *
 * The phase workspace is a return-to surface: a PM dips in and out as the
 * programme moves. Rather than make them re-scan everything, we diff the phase's
 * artifacts, risks, decisions and milestones against the timestamp of their last
 * visit (persisted client-side) and surface only what's new or resolved. Pure and
 * testable: it reads the normalized programme and a `since` ISO string, nothing else.
 */
import type { ProgramSummary } from "@/new/types";

export type PhaseChangeKind = "artifact" | "risk" | "decision" | "milestone";
export type PhaseChangeTone = "added" | "updated" | "resolved";

export interface PhaseChange {
  id: string;
  kind: PhaseChangeKind;
  tone: PhaseChangeTone;
  label: string;
  detail: string;
  /** ISO timestamp of the change, used for sorting (newest first). */
  at: string;
}

function isAfter(iso: string | null | undefined, since: number): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return ts > since ? iso : null;
}

/**
 * Derive the changes on `phaseId` since `sinceIso`. Returns [] when there is no
 * baseline (first visit) or no program, so the caller can simply hide the panel.
 */
export function derivePhaseChanges(
  program: ProgramSummary | null,
  phaseId: string | null,
  sinceIso: string | null,
): PhaseChange[] {
  if (!program || !phaseId || !sinceIso) return [];
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return [];

  const changes: PhaseChange[] = [];

  // Artifacts — created or edited.
  for (const artifact of program.artifacts ?? []) {
    if (artifact.phaseId !== phaseId) continue;
    const at = isAfter(artifact.lastEditedAt, since);
    if (!at) continue;
    const isNew = artifact.versionNumber <= 1;
    changes.push({
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      tone: artifact.status === "approved" ? "resolved" : isNew ? "added" : "updated",
      label: artifact.title,
      detail: artifact.status === "approved" ? "Approved" : isNew ? "New artifact" : `Updated · v${artifact.versionNumber}`,
      at,
    });
  }

  // Risks / RAID — raised or closed.
  for (const entry of program.raidEntries ?? []) {
    if (entry.phase !== phaseId) continue;
    const closedAt = isAfter(entry.closedAt, since);
    if (closedAt) {
      changes.push({
        id: `risk-closed:${entry.id}`,
        kind: "risk",
        tone: "resolved",
        label: entry.title,
        detail: `${entry.type} closed`,
        at: closedAt,
      });
      continue;
    }
    const createdAt = isAfter(entry.createdAt, since);
    if (createdAt) {
      changes.push({
        id: `risk:${entry.id}`,
        kind: "risk",
        tone: "added",
        label: entry.title,
        detail: `New ${entry.severity} ${entry.type}`,
        at: createdAt,
      });
    }
  }

  // Decisions — newly raised on this phase.
  for (const decision of program.decisionQueue ?? []) {
    if (decision.phaseId !== phaseId) continue;
    const createdAt = isAfter(decision.createdAt, since);
    if (!createdAt) continue;
    changes.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      tone: "added",
      label: decision.title,
      detail: "Decision needed",
      at: createdAt,
    });
  }

  // Milestones — updated on this phase.
  for (const milestone of program.milestones ?? []) {
    if (milestone.phaseId !== phaseId) continue;
    const at = isAfter(milestone.lastUpdatedAt, since);
    if (!at) continue;
    changes.push({
      id: `milestone:${milestone.id}`,
      kind: "milestone",
      tone: milestone.status === "complete" ? "resolved" : "updated",
      label: milestone.title,
      detail: milestone.status === "complete" ? "Completed" : `Status: ${milestone.status}`,
      at,
    });
  }

  // Newest first.
  changes.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return changes;
}
