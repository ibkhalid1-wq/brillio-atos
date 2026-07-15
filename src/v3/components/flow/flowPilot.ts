/**
 * The PILOT interpreter — the Experience Design run as a working application.
 *
 * No codegen: the design's typed wireframe blocks (table/form/detail/metric/
 * action), its workflowMachines and the prototype pack's structured fixtures
 * ARE an app schema + behaviour spec + seed database. This module is the pure
 * runtime: a seeded record store, machine-state transitions (agent-actored or
 * human-approved), record creation from forms, and metrics computed from the
 * store. The pilot can never drift from the validated design, because it IS
 * the design, running. Pure and testable; PilotApp.tsx renders it.
 */
import { isAgentActor, type DemoFixture } from "@/v3/components/flow/flowDemoRun";

export interface PilotTransition { from: string; to: string; on: string; actor: string }
export interface PilotMachine { name: string; states: string[]; transitions: PilotTransition[]; entity?: string }

export interface PilotRecord {
  id: string;
  entity: string;
  label: string;
  values: Record<string, string>;
  /** Machine state, when the entity's lifecycle has a machine. */
  state?: string;
  /** True for records the stakeholder created in this session. */
  mine?: boolean;
  log: Array<{ ts: string; text: string; actor?: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const tokens = (text: string): Set<string> =>
  new Set(text.toLowerCase().split(/[^a-z0-9]+/).map((t) => t.replace(/s$/, "")).filter((t) => t.length >= 4));

/** Read the design's machines and bind each to the fixture entity whose name
 * its own name overlaps ("Claim Lifecycle" → Claim). Unbound machines stay —
 * they just drive no records. */
export function initPilotMachines(raw: Array<Record<string, unknown>> | undefined, fixtures: DemoFixture[]): PilotMachine[] {
  if (!Array.isArray(raw)) return [];
  const entities = fixtures.map((f) => f.entity);
  return raw.filter(isRecord).map((machine): PilotMachine => {
    const name = str(machine.name) || "Workflow";
    const states = Array.isArray(machine.states) ? machine.states.map(str).filter(Boolean) : [];
    const transitions = (Array.isArray(machine.transitions) ? machine.transitions : []).filter(isRecord)
      .map((t) => ({ from: str(t.from), to: str(t.to), on: str(t.on) || "advance", actor: str(t.actor) }))
      .filter((t) => t.from && t.to);
    const mTokens = tokens(name);
    const entity = entities.find((e) => {
      const eTokens = tokens(e);
      for (const tok of eTokens) if (mTokens.has(tok)) return true;
      return false;
    });
    return { name, states, transitions, entity };
  }).filter((m) => m.states.length || m.transitions.length);
}

/** The machine that drives an entity's lifecycle, if any. */
export function machineForEntity(machines: PilotMachine[], entity: string): PilotMachine | null {
  const direct = machines.find((m) => m.entity && m.entity.toLowerCase() === entity.toLowerCase());
  if (direct) return direct;
  const eTokens = tokens(entity);
  return machines.find((m) => { for (const tok of tokens(m.name)) if (eTokens.has(tok)) return true; return false; }) ?? null;
}

/** Seed the store: every fixture record becomes a live PilotRecord; entities
 * with a machine start at its FIRST state (the honest beginning of the
 * lifecycle), so the stakeholder gets to move work forward themselves. */
export function initPilotStore(fixtures: DemoFixture[], machines: PilotMachine[]): PilotRecord[] {
  const out: PilotRecord[] = [];
  let seq = 0;
  for (const fx of fixtures) {
    const machine = machineForEntity(machines, fx.entity);
    for (const record of fx.records) {
      seq += 1;
      out.push({
        id: `pr-${seq}`,
        entity: fx.entity,
        label: record.label,
        values: { ...record.values },
        state: machine?.states[0],
        log: [{ ts: new Date().toISOString(), text: "Seeded from the programme's fixtures" }],
      });
    }
  }
  return out;
}

/** The transitions available to a record from its current state. */
export function pendingTransitions(record: PilotRecord, machines: PilotMachine[]): PilotTransition[] {
  if (!record.state) return [];
  const machine = machineForEntity(machines, record.entity);
  if (!machine) return [];
  return machine.transitions.filter((t) => t.from.toLowerCase() === record.state!.toLowerCase());
}

export function isAgentTransition(t: PilotTransition): boolean {
  return isAgentActor(t.actor);
}

/** Apply a transition: the record advances and its log remembers who did it. */
export function applyPilotTransition(record: PilotRecord, t: PilotTransition, executor: "simulated" | "live-agent" | "human", note?: string): PilotRecord {
  return {
    ...record,
    state: t.to,
    log: [...record.log, {
      ts: new Date().toISOString(),
      text: note || `${t.on} → ${t.to}`,
      actor: executor === "human" ? "you" : t.actor || "agent",
    }].slice(-12),
  };
}

/** A record the stakeholder just created from a pilot form — it enters the
 * lifecycle at the machine's first state, like the real system would take it. */
export function createPilotRecord(entity: string, values: Record<string, string>, machines: PilotMachine[], seq: number): PilotRecord {
  const machine = machineForEntity(machines, entity);
  const label = Object.values(values).find((v) => v.trim()) || `New ${entity}`;
  return {
    id: `pr-new-${seq}`,
    entity,
    label: label.slice(0, 60),
    values,
    state: machine?.states[0],
    mine: true,
    log: [{ ts: new Date().toISOString(), text: "Created by you in the pilot", actor: "you" }],
  };
}

/** The fields a form block edits — the block's declared fields, else the
 * entity's attributes as seeded (their field names, verbatim). */
export function formFieldsFor(entity: string, block: Record<string, unknown>, fixtures: DemoFixture[]): string[] {
  const declared = Array.isArray(block.fields) ? block.fields.map(str).filter(Boolean) : [];
  if (declared.length) return declared.slice(0, 8);
  const fx = fixtures.find((f) => f.entity.toLowerCase() === entity.toLowerCase());
  return fx?.records[0] ? Object.keys(fx.records[0].values).slice(0, 8) : [];
}

/** A metric block's live value, computed from the store — never invented. */
export function metricValue(block: Record<string, unknown>, records: PilotRecord[]): string {
  const entity = str(block.entity);
  const mine = entity ? records.filter((r) => r.entity.toLowerCase() === entity.toLowerCase()) : records;
  const byState = new Map<string, number>();
  for (const r of mine) if (r.state) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  if (byState.size > 1) {
    return [...byState.entries()].slice(0, 3).map(([state, n]) => `${n} ${state}`).join(" · ");
  }
  return `${mine.length}`;
}
