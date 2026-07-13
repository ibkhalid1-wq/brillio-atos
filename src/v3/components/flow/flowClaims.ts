/**
 * Claim tags — the curated layer above raw evidence. A claim is a quoted span
 * from an attributed transcript, tagged by the operator to a real object in
 * the programme's graph (an ontology entity, a KPI, a track, or a free theme).
 * Tags live IN the blob so the snapshot ring and "as of" replay capture them,
 * and every tag/untag is attested — even curation is on the record.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState } from "@/new/lib/programState";
import { listDrillAnchors } from "@/v3/components/flow/flowDrilldown";

export interface ClaimTarget { kind: "entity" | "kpi" | "track" | "theme"; refId: string; label: string; }
export interface ClaimTag {
  id: string;
  quote: string;
  who: string;
  movementId: string;
  target: ClaimTarget;
  ts: string;
  by: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function listClaimTags(program: ProgramSummary): ClaimTag[] {
  const inner = getProgramState((program.rawData ?? {}) as Record<string, unknown>).inner as Record<string, unknown>;
  const list = Array.isArray(inner.claimTags) ? inner.claimTags : [];
  return list.filter(isRecord).map((t): ClaimTag => ({
    id: String(t.id ?? ""),
    quote: String(t.quote ?? ""),
    who: String(t.who ?? ""),
    movementId: String(t.movementId ?? ""),
    target: isRecord(t.target)
      ? { kind: (String(t.target.kind ?? "theme") as ClaimTarget["kind"]), refId: String(t.target.refId ?? ""), label: String(t.target.label ?? "") }
      : { kind: "theme", refId: "", label: "" },
    ts: String(t.ts ?? ""),
    by: String(t.by ?? ""),
  })).filter((t) => t.id && t.quote);
}

/** The taggable objects in this programme's graph, for the reader's picker. */
export function claimTargets(program: ProgramSummary): ClaimTarget[] {
  return [
    ...listDrillAnchors(program, "process").map((o) => ({ kind: "entity" as const, refId: o.refId, label: o.label })),
    ...listDrillAnchors(program, "kpi").map((o) => ({ kind: "kpi" as const, refId: o.refId, label: o.label })),
    ...listDrillAnchors(program, "track").map((o) => ({ kind: "track" as const, refId: o.refId, label: o.label })),
  ];
}
