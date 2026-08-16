/**
 * THE BLUEPRINT AND THE PROTOTYPE WERE TWO SURFACES THAT NEVER MET.
 *
 * The agentic blueprint states, per agent, the ontology entities it consumes and
 * produces, how much autonomy it has, how far the damage reaches, and whether a
 * human stands in its path — and the prototype it is supposed to describe showed
 * none of it. A client walked an application in which nothing was agentic, then
 * read a document in which everything was, and nothing on the screen said which
 * records an agent would touch.
 *
 * This module reads the blueprint into the shape the assembler needs: for each
 * agent, WHICH ENTITIES IT ACTS ON and WHAT GATES IT. Pure, no clock, no RNG.
 *
 * TWO RULES IT DELIBERATELY DOES NOT BREAK:
 *
 *   1. AN ENTITY REFERENCE IS RESOLVED AGAINST THE ONTOLOGY, never assumed. The
 *      blueprint is told to name entities exactly as the ontology does and does
 *      not always manage it; a name that resolves to nothing is returned as
 *      `unmapped` so the prototype can SAY so, which is the only honest thing to
 *      do with an agent that claims to write a record type nobody modelled.
 *   2. A HITL POINT BELONGS TO AN AGENT ONLY IF IT NAMES IT. Matching on shared
 *      tokens is how a sibling surface once mapped every agent to the first gate
 *      in the list — every agent on this programme is called "<Something>
 *      Agent", so the token "agent" identified all of them. Here the point's
 *      `agent` field must equal the name, or the point's own text must contain
 *      it whole. A gate that names nobody is not silently attached to somebody:
 *      it is returned separately and rendered as what it is.
 */

import { entityNameResolver } from "./ontologyGraph.ts";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(text).filter(Boolean);

/** A human gate on an agent's work, however the blueprint stated it. */
export interface AgentGate {
  /** The step or decision the gate sits on. */
  where: string;
  /** The risk it answers, in the stakeholder's terms. */
  why: string;
  /** approve | review | override, as stated. */
  mechanism: string;
  /**
   * WHERE THE GATE CAME FROM. `declared` — the agent's own `requiresHitl`.
   * `point` — a `hitlPoints` row naming it. `operator` — a row an operator added
   * on the blueprint surface, which is an attested decision on the record and
   * must read as one rather than as something the generator produced.
   */
  source: "declared" | "point" | "operator";
}

export interface SurfacedAgent {
  name: string;
  slug: string;
  purpose: string;
  replaces: string;
  autonomy: string;
  blastRadius: string;
  reversibility: string;
  escalatesTo: string;
  /** Ontology entities it consumes / produces, resolved to their exact names. */
  reads: string[];
  writes: string[];
  /** Inputs or outputs that resolve to no entity in this ontology. */
  unmapped: string[];
  gate: AgentGate | null;
}

export interface AgenticSurface {
  agents: SurfacedAgent[];
  /** Gates the blueprint states without naming an agent — real decisions with no
   *  owner on the diagram, which is a finding, not a blank. */
  unattributedGates: AgentGate[];
}

const slugOf = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";

function gateFrom(row: Record<string, unknown>): AgentGate {
  return {
    where: text(row.where) || text(row.point) || text(row.step) || "",
    why: text(row.why) || text(row.rationale) || text(row.reason) || "",
    mechanism: text(row.mechanism) || text(row.approver) || "",
    source: text(row.addedBy).toLowerCase() === "operator" ? "operator" : "point",
  };
}

/**
 * Read the blueprint against an ontology's entity names.
 *
 * `entityNames` is the ontology's own list, in its own order — the resolution
 * table. Nothing here invents an entity: a name that does not resolve is
 * reported, never mapped to the nearest thing.
 */
export function deriveAgenticSurface(blueprint: unknown, entityNames: readonly string[]): AgenticSurface {
  const doc = isRecord(blueprint) ? blueprint : {};
  // The ONE resolution, shared with every other reader of a written entity name.
  const resolve = entityNameResolver(entityNames);

  const rows = (Array.isArray(doc.agents) ? doc.agents : []).filter(isRecord);
  const points = (Array.isArray(doc.hitlPoints) ? doc.hitlPoints : []).filter(isRecord);
  const names = rows.map((a) => text(a.name)).filter(Boolean);

  /** Does this gate row name THIS agent — by its `agent` field, or by carrying
   *  the whole name in its own text? Nothing weaker: see rule 2 above. */
  const namesAgent = (row: Record<string, unknown>, agent: string): boolean => {
    if (agent.length < 3) return false;
    const field = text(row.agent);
    if (field && field.toLowerCase() === agent.toLowerCase()) return true;
    const body = `${text(row.where)} ${text(row.point)} ${text(row.why)} ${text(row.step)}`.toLowerCase();
    return body.includes(agent.toLowerCase());
  };

  const claimed = new Set<number>();
  const agents: SurfacedAgent[] = [];
  for (const a of rows) {
    const name = text(a.name);
    if (!name) continue;
    const seen = new Set<string>();
    const unmapped: string[] = [];
    const resolveAll = (raw: unknown): string[] => {
      const out: string[] = [];
      for (const v of strings(raw)) {
        const hit = resolve(v);
        if (!hit) { if (!unmapped.includes(v)) unmapped.push(v); continue; }
        if (!out.includes(hit)) out.push(hit);
        seen.add(hit);
      }
      return out;
    };
    const reads = resolveAll(a.inputs);
    const writes = resolveAll(a.outputs);
    const pointIx = points.findIndex((p, i) => !claimed.has(i) && namesAgent(p, name));
    if (pointIx >= 0) claimed.add(pointIx);
    const declared = a.requiresHitl === true || /^(yes|true|required)$/i.test(text(a.requiresHitl));
    const gate: AgentGate | null = pointIx >= 0
      ? gateFrom(points[pointIx])
      : declared
        ? { where: text(a.replacesWorkflow) || name, why: "", mechanism: "approve", source: "declared" }
        : null;
    agents.push({
      name,
      slug: slugOf(name),
      purpose: text(a.purpose),
      replaces: text(a.replacesWorkflow),
      autonomy: text(a.autonomyLevel),
      blastRadius: text(a.blastRadius),
      reversibility: text(a.reversibility),
      escalatesTo: text(a.escalatesTo),
      reads,
      writes,
      unmapped,
      gate,
    });
  }

  // A gate nobody claimed, that names no agent this blueprint holds. Kept.
  const unattributedGates = points
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => !claimed.has(i) && !names.some((n) => namesAgent(p, n)))
    .map(({ p }) => gateFrom(p))
    .filter((g) => g.where || g.why);

  return { agents, unattributedGates };
}

/** The agents that touch one entity, in blueprint order — what the entity's own
 *  detail page has to show. `reads`/`writes` are already resolved names, so this
 *  is an exact comparison and not a second guess at the same question. */
export function agentsOnEntity(surface: AgenticSurface, entity: string): SurfacedAgent[] {
  return surface.agents.filter((a) => a.reads.includes(entity) || a.writes.includes(entity));
}

/** Agents a human has to clear before they act — the approval queue's subjects. */
export function gatedAgents(surface: AgenticSurface): SurfacedAgent[] {
  return surface.agents.filter((a) => a.gate);
}
