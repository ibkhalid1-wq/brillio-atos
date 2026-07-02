/**
 * Run-over-run graph change surface — the persistence + summarisation layer that
 * finally puts graphFingerprint's dormant diff to work.
 *
 * `fingerprintGraph`/`diffFingerprints` can already tell whether two Program
 * Graphs differ and name the node/edge ids that moved, but nothing stored a prior
 * fingerprint to diff against, so the timeline was never surfaced. This module
 * keeps the last-seen fingerprint per programme in localStorage (device-local,
 * directional context — the same scope and rationale as confidenceHistory, and
 * deliberately NOT the persisted program data blob wiped in the 2026-06-28
 * incident) and turns a diff into a human-readable "since you last looked"
 * summary, resolving node ids back to kinds and labels.
 *
 * The pure summariser (`describeGraphDiff`) is storage-free and unit-testable; the
 * localStorage helpers degrade to no-ops when storage is unavailable.
 */
import { fingerprintGraph, diffFingerprints, type GraphFingerprint, type GraphDiff } from "@/v3/lib/graphFingerprint";
import type { ProgramGraph } from "@/v3/lib/programGraph";

export interface GraphChangeSummary {
  /** True when the current graph differs from the stored baseline. */
  changed: boolean;
  /** True when there was no stored baseline (first snapshot — nothing to diff). */
  isFirstSnapshot: boolean;
  /** One-line headline, e.g. "Since your last view: 2 added, 1 changed". */
  headline: string;
  /** Per-change specifics with kinds and labels, capped for display. */
  details: string[];
  /** The underlying diff, or null on a first snapshot. */
  diff: GraphDiff | null;
}

const KEY_PREFIX = "atlas-graph-fingerprint:";
/** Cap on how many specific change lines to surface, so a big run stays readable. */
const MAX_DETAIL_LINES = 8;

function storageKey(programId: string): string {
  return `${KEY_PREFIX}${programId}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // privacy mode / disabled storage
  }
}

/** The stored baseline fingerprint for a programme, or null when none/invalid. */
export function getStoredFingerprint(programId: string | null | undefined): GraphFingerprint | null {
  if (!programId) return null;
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(programId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed || typeof parsed !== "object" ||
      typeof parsed.hash !== "string" ||
      !Array.isArray(parsed.nodeIds) || !Array.isArray(parsed.edgeKeys) ||
      typeof parsed.nodeHashes !== "object" || parsed.nodeHashes === null
    ) {
      return null;
    }
    return parsed as GraphFingerprint;
  } catch {
    return null;
  }
}

/** Persist the current graph's fingerprint as the new baseline for future diffs. */
export function commitGraphSnapshot(programId: string | null | undefined, graph: ProgramGraph): void {
  if (!programId) return;
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(storageKey(programId), JSON.stringify(fingerprintGraph(graph)));
  } catch {
    /* quota / disabled → best-effort, skip */
  }
}

/** Kind label for a node id (`requirement:REQ-1` → "requirement"), doc → document. */
function kindFromId(id: string): string {
  const prefix = id.split(":", 1)[0];
  return prefix === "doc" ? "document" : prefix;
}

/** The label portion of a node id, for a removed node no longer in the graph. */
function labelFromId(id: string): string {
  const idx = id.indexOf(":");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

/** Pluralise a kind count, e.g. (2, "requirement") → "2 requirements". */
function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Turn a fingerprint diff into a human-readable summary, resolving ids back to
 * kinds and labels. Added/changed nodes are looked up in `graph` for their live
 * label; removed nodes (gone from the graph) fall back to parsing their id. Pure.
 */
export function describeGraphDiff(diff: GraphDiff, graph: ProgramGraph): { headline: string; details: string[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodeDesc = (id: string): string => {
    const node = byId.get(id);
    return node ? `${node.type} "${node.label}"` : `${kindFromId(id)} "${labelFromId(id)}"`;
  };

  const headlineParts: string[] = [];
  const nodeDelta = diff.addedNodes.length + diff.removedNodes.length + diff.changedNodes.length;
  if (diff.addedNodes.length) headlineParts.push(`${diff.addedNodes.length} added`);
  if (diff.changedNodes.length) headlineParts.push(`${diff.changedNodes.length} changed`);
  if (diff.removedNodes.length) headlineParts.push(`${diff.removedNodes.length} removed`);
  const edgeDelta = diff.addedEdges.length + diff.removedEdges.length;
  if (!nodeDelta && edgeDelta) headlineParts.push(`${countLabel(edgeDelta, "relationship")} rewired`);

  const headline = headlineParts.length
    ? `Since your last view: ${headlineParts.join(", ")}.`
    : "No changes since your last view.";

  const details: string[] = [];
  for (const id of diff.addedNodes) details.push(`Added ${nodeDesc(id)}.`);
  for (const id of diff.changedNodes) details.push(`Updated ${nodeDesc(id)}.`);
  for (const id of diff.removedNodes) details.push(`Removed ${nodeDesc(id)}.`);
  const shown = details.slice(0, MAX_DETAIL_LINES);
  if (details.length > MAX_DETAIL_LINES) {
    shown.push(`…and ${details.length - MAX_DETAIL_LINES} more.`);
  }
  return { headline, details: shown };
}

/**
 * Diff the current graph against the stored baseline and summarise what changed —
 * WITHOUT committing a new baseline (so reading is idempotent; the caller decides
 * when to advance the baseline via {@link commitGraphSnapshot}). On a first
 * snapshot there is nothing to diff, so `changed` is false and `isFirstSnapshot`
 * is true.
 */
export function reviewGraphChanges(
  programId: string | null | undefined,
  graph: ProgramGraph,
): GraphChangeSummary {
  const prev = getStoredFingerprint(programId);
  if (!prev) {
    return { changed: false, isFirstSnapshot: true, headline: "No changes since your last view.", details: [], diff: null };
  }
  const next = fingerprintGraph(graph);
  const diff = diffFingerprints(prev, next);
  const { headline, details } = describeGraphDiff(diff, graph);
  return { changed: diff.changed, isFirstSnapshot: false, headline, details, diff };
}
