/**
 * Cross-artifact validation — the record PROVES consistency instead of the
 * prompts promising it. Deterministic client-side checks over the stored
 * documents:
 *
 *   · every Blueprint agent input/output is a declared Ontology entity
 *   · every agent's replacesWorkflow exists in the Atlas
 *   · every data contract's entity is a declared Ontology entity
 *   · an agent acting on irreversible / high-blast work has a HITL point
 *   · the Architecture Strategy's recommendation satisfies every hard
 *     constraint it verified
 *
 * Violations surface as GATE CRITERIA (Envision can't read green while its
 * documents disagree) — alongside the stakeholder sign-off criterion on
 * Listen (an ontology/atlas is validated by the people whose evidence built
 * it, per the per-stakeholder approval model). Complements the persona→Atlas
 * coverage check already on the Listen gate and the shrink guard at write
 * time: entities and personas are never silently dropped, and what remains
 * is validated with stakeholders.
 */
import type { ProgramSummary } from "@/new/types";
import { flowMovements, movementArtifacts } from "@/v3/components/flow/flowShellData";
import { artifactApprovalRollup } from "@/v3/components/flow/flowApprovals";
import type { GateCheckItem } from "@/v3/components/flow/flowShellData";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function dataRoot(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
}

const norm = (value: unknown): string => String(value ?? "").trim().toLowerCase();

export interface CrossViolation {
  /** Which check fired. */
  kind: "unmapped-entity" | "unknown-workflow" | "contract-entity" | "act-without-hitl" | "hard-constraint";
  /** One plain sentence naming the inconsistency. */
  detail: string;
}

/** Ontology entity names (aliases included) — the vocabulary every other
 * document must speak. */
function ontologyVocabulary(inner: Record<string, unknown>): Set<string> {
  const doc = inner.domainOntology;
  const out = new Set<string>();
  if (!isRecord(doc) || !Array.isArray(doc.entities)) return out;
  for (const entity of doc.entities) {
    if (!isRecord(entity)) continue;
    const name = norm(entity.name);
    if (name) out.add(name);
    if (Array.isArray(entity.aliases)) for (const alias of entity.aliases) {
      const key = norm(alias);
      if (key) out.add(key);
    }
  }
  return out;
}

export function crossArtifactViolations(program: ProgramSummary): CrossViolation[] {
  const inner = dataRoot(program);
  const violations: CrossViolation[] = [];
  const vocabulary = ontologyVocabulary(inner);
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : null;
  const workflows = new Set(
    (atlas && Array.isArray(atlas.workflows) ? atlas.workflows : [])
      .filter(isRecord).map((workflow) => norm(workflow.name)).filter(Boolean),
  );
  const blueprint = isRecord(inner.agenticBlueprint) ? inner.agenticBlueprint : null;

  if (blueprint && Array.isArray(blueprint.agents)) {
    const hitlText = (Array.isArray(blueprint.hitlPoints) ? blueprint.hitlPoints : [])
      .filter(isRecord).map((point) => `${norm(point.where)} ${norm(point.why)}`).join(" · ");
    for (const agent of blueprint.agents.filter(isRecord)) {
      const agentName = String(agent.name ?? "agent");
      // Inputs/outputs must speak the ontology's vocabulary — checks only run
      // when an ontology exists to check against.
      if (vocabulary.size) {
        for (const field of ["inputs", "outputs"] as const) {
          for (const entity of (Array.isArray(agent[field]) ? agent[field] as unknown[] : [])) {
            const key = norm(entity);
            if (key && !vocabulary.has(key)) {
              violations.push({ kind: "unmapped-entity", detail: `${agentName}'s ${field.slice(0, -1)} “${String(entity)}” is not an Ontology entity — align the name or add the entity.` });
            }
          }
        }
      }
      if (workflows.size) {
        const workflow = norm(agent.replacesWorkflow);
        if (workflow && !workflows.has(workflow)) {
          violations.push({ kind: "unknown-workflow", detail: `${agentName} replaces “${String(agent.replacesWorkflow)}”, which is not an Atlas workflow.` });
        }
      }
      // Safety envelope: acting on irreversible / high-blast work needs a
      // human in the loop — declared or discoverable in hitlPoints.
      const acts = norm(agent.autonomyLevel) === "act";
      const risky = norm(agent.reversibility) === "irreversible" || norm(agent.blastRadius) === "high";
      if (acts && risky) {
        const covered = agent.requiresHitl === true || hitlText.includes(agentName.toLowerCase());
        if (!covered) {
          violations.push({ kind: "act-without-hitl", detail: `${agentName} acts autonomously on ${norm(agent.reversibility) === "irreversible" ? "irreversible" : "high-blast-radius"} work with no HITL point.` });
        }
      }
    }
    if (vocabulary.size) {
      for (const contract of (Array.isArray(blueprint.dataContracts) ? blueprint.dataContracts : []).filter(isRecord)) {
        const key = norm(contract.entity);
        if (key && !vocabulary.has(key)) {
          violations.push({ kind: "contract-entity", detail: `Data contract entity “${String(contract.entity)}” is not an Ontology entity.` });
        }
      }
    }
  }

  const strategy = isRecord(inner.architectureStrategy) ? inner.architectureStrategy : null;
  if (strategy && isRecord(strategy.recommendation) && strategy.recommendation.hardConstraintsMet === false) {
    const unmet = Array.isArray(strategy.recommendation.unmetConstraints)
      ? strategy.recommendation.unmetConstraints.map(String).filter(Boolean) : [];
    violations.push({ kind: "hard-constraint", detail: `The recommended architecture does not satisfy every hard constraint${unmet.length ? ` — unmet: ${unmet.slice(0, 3).join("; ")}` : ""}.` });
  }

  return violations.slice(0, 24);
}

/**
 * Extra GATE criteria derived from the validation model — appended to the
 * movement's checklist by the canvas:
 *   · Listen: every present artifact SIGNED OFF by all its contributors
 *     (the per-stakeholder approval rollup — validate with stakeholders).
 *   · Envision: zero cross-artifact violations (the documents agree).
 */
export function gateAugmentations(program: ProgramSummary, movementId: string): GateCheckItem[] {
  const items: GateCheckItem[] = [];
  if (movementId === "listen") {
    const movement = flowMovements().find((entry) => entry.id === movementId);
    if (movement) {
      for (const artifact of movementArtifacts(program, movement).filter((entry) => entry.present)) {
        const rollup = artifactApprovalRollup(program, movementId, artifact.id);
        if (!rollup.total) continue; // no contributors yet — nothing to sign off
        items.push({
          id: `signoff-${artifact.id}`,
          label: `${artifact.title} — validated by its contributors (${rollup.approvedCount}/${rollup.total} approved)`,
          done: rollup.overall === "approved",
          why: rollup.overall === "approved"
            ? undefined
            : `awaiting ${rollup.approvers.filter((approver) => approver.status !== "approved").slice(0, 3).map((approver) => approver.name.split(" ")[0]).join(", ")} — request sign-off on their collect cards`,
        });
      }
    }
  }
  if (movementId === "envision") {
    const violations = crossArtifactViolations(program);
    items.push({
      id: "cross-consistency",
      label: violations.length
        ? `Documents agree with each other — ${violations.length} inconsistenc${violations.length === 1 ? "y" : "ies"}`
        : "Documents agree with each other — ontology, atlas and blueprint are consistent",
      done: violations.length === 0,
      why: violations.length ? violations.slice(0, 3).map((violation) => violation.detail).join(" · ") : undefined,
    });
  }
  return items;
}
