/**
 * Ship lanes — how the accepted system actually reaches production.
 *
 * The plan COMPILES deterministically from what the programme already knows:
 * the Blueprint's build sequence, data contracts and eval plan, the hardening
 * plan when it exists, and the people on the roster. No model call — adopting
 * it is a human action, attested tier 2, and the Ship gate goes green only
 * when the validation lane is done and cutover has executed. Mutators are
 * pure blob transforms; callers persist via updateProgramData.
 */
import type { ProgramSummary } from "@/new/types";
import { FLOW_ATTESTATION_CAP } from "@/v3/lib/blobGuard";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export interface ShipItem {
  id: string;
  label: string;
  done: boolean;
  /** Where the item came from — blueprint, hardening plan, roster, standard. */
  source: string;
}

export interface ShipLane {
  id: string;
  name: string;
  items: ShipItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

export function listShipLanes(program: ProgramSummary): ShipLane[] {
  const doc = innerData(program).shipLanes;
  if (!isRecord(doc) || !Array.isArray(doc.lanes)) return [];
  return (doc.lanes as unknown[]).filter(isRecord).map((lane): ShipLane => ({
    id: String(lane.id ?? ""),
    name: String(lane.name ?? "Lane"),
    items: Array.isArray(lane.items)
      ? lane.items.filter(isRecord).map((item) => ({
          id: String(item.id ?? ""),
          label: String(item.label ?? ""),
          done: item.done === true,
          source: String(item.source ?? ""),
        })).filter((item) => item.id && item.label)
      : [],
  })).filter((lane) => lane.id && lane.items.length);
}

export function shipLaneProgress(lanes: ShipLane[]): { done: number; total: number; validationDone: boolean; cutoverDone: boolean } {
  const all = lanes.flatMap((lane) => lane.items);
  const laneDone = (id: string) => {
    const lane = lanes.find((entry) => entry.id === id);
    return !!lane && lane.items.every((item) => item.done);
  };
  return {
    done: all.filter((item) => item.done).length,
    total: all.length,
    validationDone: laneDone("validation"),
    cutoverDone: laneDone("cutover"),
  };
}

const item = (id: string, label: string, source: string): Record<string, unknown> =>
  ({ id, label: label.slice(0, 140), done: false, source });

/**
 * Compile the lane plan from the programme's own artifacts. Pure — returns
 * the full next blob with the plan adopted and the adoption attested, or null
 * when a plan already exists (re-compiling must be a deliberate replace).
 */
export function compileShipLanes(program: ProgramSummary, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  if (isRecord(inner.shipLanes) && Array.isArray((inner.shipLanes as Record<string, unknown>).lanes)) return null;

  const blueprint = isRecord(inner.agenticBlueprint) ? inner.agenticBlueprint : {};
  const hardening = isRecord(inner.hardeningPlan) ? inner.hardeningPlan : {};

  const buildItems = (Array.isArray(blueprint.buildSequence) ? blueprint.buildSequence : [])
    .map(String).filter(Boolean).slice(0, 8)
    .map((slice, index) => item(`build-${index}`, slice, "blueprint build sequence"));

  const dataItems = (Array.isArray(blueprint.dataContracts) ? blueprint.dataContracts.filter(isRecord) : [])
    .slice(0, 8)
    .map((contract, index) => item(
      `data-${index}`,
      `${String(contract.entity ?? "entity")} ← ${String(contract.source ?? "source")} (${String(contract.sync ?? "sync")})`,
      "blueprint data contracts",
    ));

  const evalItems = (Array.isArray(blueprint.evalPlan) ? blueprint.evalPlan.filter(isRecord) : [])
    .slice(0, 8)
    .map((entry, index) => item(
      `eval-${index}`,
      `${String(entry.behaviour ?? "behaviour")} — ${String(entry.threshold ?? "pass bar")}`,
      "blueprint eval plan",
    ));
  evalItems.push(item("eval-suite-green", "Eval suite green end-to-end", "gate criterion"));

  const hardeningSource = Array.isArray(hardening.workstreams) ? hardening.workstreams
    : Array.isArray(hardening.items) ? hardening.items : [];
  const hardeningItems = hardeningSource.filter(isRecord).slice(0, 8)
    .map((entry, index) => item(
      `hard-${index}`,
      String(entry.name ?? entry.area ?? entry.item ?? entry.workstream ?? "Hardening step"),
      "hardening plan",
    ));
  if (!hardeningItems.length) {
    hardeningItems.push(
      item("hard-authz", "Access control and data-scope review", "standard"),
      item("hard-failure", "Failure modes and fallbacks rehearsed", "standard"),
      item("hard-cost", "Rate and cost guards configured", "standard"),
    );
  }

  const listen = isRecord(inner.phaseInputs) && isRecord((inner.phaseInputs as Record<string, unknown>).listen)
    ? (inner.phaseInputs as Record<string, Record<string, unknown>>).listen
    : {};
  let rosterNames: string[] = [];
  if (typeof listen.interviewRoster === "string" && listen.interviewRoster.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(listen.interviewRoster);
      if (Array.isArray(parsed)) rosterNames = parsed.map((row) => String(row?.name ?? "")).filter(Boolean).slice(0, 6);
    } catch { /* no roster names */ }
  }
  const enablementItems = [
    ...rosterNames.map((name, index) => item(`enable-${index}`, `Enablement session — ${name}`, "discovery roster")),
    item("enable-runbook", "Runbook handed to the operating team", "standard"),
  ];

  // The hardening plan's cutover runbook, when present, IS the ship plan's
  // cutover lane: pre-flight gate first, then the timed steps (new docs carry
  // {action, verify, rollback} objects; older ones plain strings — both fold).
  const cutover = isRecord(hardening.cutoverPlan) ? hardening.cutoverPlan as Record<string, unknown> : {};
  const preFlightItems = (Array.isArray(cutover.preFlightGate) ? cutover.preFlightGate : [])
    .map(String).filter(Boolean).slice(0, 6)
    .map((entry, index) => item(`cut-pre-${index}`, `Pre-flight: ${entry}`, "hardening plan cutover"));
  const runbookItems = (Array.isArray(cutover.steps) ? cutover.steps : [])
    .slice(0, 10)
    .flatMap((step, index) => {
      const label = isRecord(step)
        ? [String(step.action ?? ""), step.verify ? `verify: ${String(step.verify)}` : ""].filter(Boolean).join(" — ")
        : String(step ?? "");
      return label ? [item(`cut-step-${index}`, label, "hardening plan cutover")] : [];
    });
  const cutoverItems = [
    ...preFlightItems,
    item("cut-rehearsal", "Cutover rehearsal completed", "standard"),
    item("cut-go", "Go / no-go decision recorded", "gate criterion"),
    ...runbookItems,
    item("cut-execute", "Production cutover executed", "gate criterion"),
    item("cut-hypercare", "Hypercare window closed", "standard"),
  ];

  const lanes = [
    { id: "build", name: "Build", items: buildItems.length ? buildItems : [item("build-0", "Build the accepted slices", "standard")] },
    { id: "data", name: "Data", items: dataItems.length ? dataItems : [item("data-0", "Stand up the shared data model", "standard")] },
    { id: "validation", name: "Validation & evals", items: evalItems },
    { id: "hardening", name: "Hardening", items: hardeningItems },
    { id: "enablement", name: "Enablement", items: enablementItems },
    { id: "cutover", name: "Cutover", items: cutoverItems },
  ];

  const total = lanes.reduce((sum, lane) => sum + lane.items.length, 0);
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: "ship", tier: 2,
    action: `Adopted the ship plan — ${lanes.length} lanes, ${total} items`,
    detail: "Compiled from the Blueprint's build sequence, data contracts and eval plan, the hardening plan, and the roster.",
  };

  return wrapProgramState(wrapper, {
    ...inner,
    shipLanes: { adoptedAt: new Date().toISOString(), lanes },
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/**
 * Toggle one lane item. Completing a whole lane is worth the trail — item
 * ticks alone are not. Null when the item is unknown.
 */
/** Set EVERY item in a lane at once — checking off a lane that was executed
 * offline, or resetting one checked in error. Attested either way. */
export function setShipLane(program: ProgramSummary, laneId: string, done: boolean, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const doc = isRecord(inner.shipLanes) ? { ...(inner.shipLanes as Record<string, unknown>) } : null;
  if (!doc || !Array.isArray(doc.lanes)) return null;
  let laneName: string | null = null;
  let changed = false;
  const lanes = (doc.lanes as unknown[]).map((lane) => {
    if (!isRecord(lane) || lane.id !== laneId || !Array.isArray(lane.items)) return lane;
    laneName = String(lane.name ?? laneId);
    const items = (lane.items as unknown[]).map((entry) => {
      if (!isRecord(entry)) return entry;
      if ((entry.done === true) !== done) changed = true;
      return { ...entry, done };
    });
    return { ...lane, items };
  });
  if (!laneName || !changed) return null;
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: "ship", tier: 1,
    action: done ? `Ship lane checked off — ${laneName}` : `Ship lane reset — ${laneName}`,
  };
  return wrapProgramState(wrapper, { ...inner, shipLanes: { ...doc, lanes }, flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP) }, usesNestedData);
}

export function toggleShipItem(program: ProgramSummary, laneId: string, itemId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const doc = isRecord(inner.shipLanes) ? { ...(inner.shipLanes as Record<string, unknown>) } : null;
  if (!doc || !Array.isArray(doc.lanes)) return null;
  let found = false;
  let laneJustCompleted: string | null = null;
  const lanes = (doc.lanes as unknown[]).map((lane) => {
    if (!isRecord(lane) || lane.id !== laneId || !Array.isArray(lane.items)) return lane;
    const items = (lane.items as unknown[]).map((entry) => {
      if (!isRecord(entry) || entry.id !== itemId) return entry;
      found = true;
      return { ...entry, done: entry.done !== true };
    });
    if (found && items.filter(isRecord).every((entry) => entry.done === true)) {
      laneJustCompleted = String(lane.name ?? laneId);
    }
    return { ...lane, items };
  });
  if (!found) return null;

  let log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  if (laneJustCompleted) {
    log = [...log, {
      ts: new Date().toISOString(), agentId: actor, phaseId: "ship", tier: 1,
      action: `Ship lane complete — ${laneJustCompleted}`,
    }].slice(-FLOW_ATTESTATION_CAP);
  }

  return wrapProgramState(wrapper, { ...inner, shipLanes: { ...doc, lanes }, flowAttestations: log }, usesNestedData);
}
