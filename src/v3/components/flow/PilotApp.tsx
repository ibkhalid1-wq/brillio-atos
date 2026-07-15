/**
 * The PILOT — the future system, usable. Screens come from the Experience
 * Design's typed blocks, data from the seeded fixtures, behaviour from the
 * workflow machines. The stakeholder operates it: files records through real
 * forms, watches agents work the queue (simulated or live), and performs the
 * approval moments the design reserves for humans. Every action lands as a
 * replayable beat record on the same rails as the scenario runner.
 */
import { useMemo, useRef, useState } from "react";
import {
  initPilotMachines, initPilotStore, pendingTransitions, isAgentTransition, applyPilotTransition,
  createPilotRecord, formFieldsFor, metricValue, type PilotMachine, type PilotRecord, type PilotTransition,
} from "@/v3/components/flow/flowPilot";
import type { DemoBeatRecord, DemoFixture } from "@/v3/components/flow/flowDemoRun";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

export default function PilotApp({ screens, fixtures, machines: rawMachines, onBeatRecord, fieldFlags, onToggleFieldFlag, runLive }: {
  screens: Array<Record<string, unknown>>;
  fixtures: DemoFixture[];
  machines?: Array<Record<string, unknown>>;
  onBeatRecord?: (record: DemoBeatRecord) => void;
  fieldFlags?: Record<string, string>;
  onToggleFieldFlag?: (key: string) => void;
  runLive?: (input: { flow: string; step: number; action: string; actor: string }) => Promise<{ outcome: string } | null>;
}) {
  const machines = useMemo<PilotMachine[]>(() => initPilotMachines(rawMachines, fixtures), [rawMachines, fixtures]);
  const [records, setRecords] = useState<PilotRecord[]>(() => initPilotStore(fixtures, machines));
  const [screenIdx, setScreenIdx] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [formDrafts, setFormDrafts] = useState<Record<string, Record<string, string>>>({});
  const seqRef = useRef(0);
  const beat = (action: string, executor: DemoBeatRecord["executor"], actor: string, outcome: string, hitl = false) => {
    seqRef.current += 1;
    onBeatRecord?.({ ts: new Date().toISOString(), flow: "Pilot", step: seqRef.current, action, executor, actor, outcome, hitl });
  };

  const screen = screens[screenIdx];
  const selectedFor = (entity: string): PilotRecord | undefined => {
    const id = selected[entity.toLowerCase()];
    return records.find((r) => r.id === id) ?? records.find((r) => r.entity.toLowerCase() === entity.toLowerCase());
  };

  const runTransition = async (record: PilotRecord, t: PilotTransition) => {
    const agent = isAgentTransition(t);
    if (!agent) {
      // The human moment — the stakeholder performs it, immediately.
      setRecords((rs) => rs.map((r) => (r.id === record.id ? applyPilotTransition(r, t, "human") : r)));
      beat(`${t.on} — ${record.label}`, "human", "you", `${record.entity} → ${t.to}`, true);
      return;
    }
    setWorking(`${t.actor || "The agent"}: ${t.on} — ${record.label}…`);
    let executor: DemoBeatRecord["executor"] = "simulated";
    let note: string | undefined;
    if (runLive) {
      const live = await runLive({ flow: "Pilot", step: seqRef.current + 1, action: `${t.on} for ${record.label} (${JSON.stringify(record.values).slice(0, 300)})`, actor: t.actor });
      if (live?.outcome) { note = live.outcome; executor = "live-agent"; }
    } else {
      await new Promise((r) => setTimeout(r, 900));
    }
    setRecords((rs) => rs.map((r) => (r.id === record.id ? applyPilotTransition(r, t, executor, note) : r)));
    beat(`${t.on} — ${record.label}`, executor, t.actor || "agent", note ?? `${record.entity} → ${t.to}`);
    setWorking(null);
  };

  /** Let the agents WORK THE QUEUE: every record with a pending agent
   * transition advances one step (capped), sequentially and visibly. */
  const runQueue = async () => {
    const work: Array<{ record: PilotRecord; t: PilotTransition }> = [];
    for (const record of records) {
      const t = pendingTransitions(record, machines).find(isAgentTransition);
      if (t) work.push({ record, t });
      if (work.length >= 6) break;
    }
    for (const { record, t } of work) {
      const current = records.find((r) => r.id === record.id) ?? record;
      await runTransition(current, t);
    }
  };

  const submitForm = (blockKey: string, entity: string, fields: string[]) => {
    const draft = formDrafts[blockKey] ?? {};
    const values: Record<string, string> = {};
    for (const f of fields) if ((draft[f] ?? "").trim()) values[f] = draft[f].trim();
    if (!Object.keys(values).length) return;
    seqRef.current += 1;
    const record = createPilotRecord(entity, values, machines, seqRef.current);
    setRecords((rs) => [record, ...rs]);
    setFormDrafts((d) => ({ ...d, [blockKey]: {} }));
    setSelected((s) => ({ ...s, [entity.toLowerCase()]: record.id }));
    beat(`Created ${entity}`, "human", "you", record.label, false);
  };

  const fieldChip = (entity: string, k: string, v: string) => {
    const key = `${entity}.${k}`;
    const flagged = !!fieldFlags && key in fieldFlags;
    return (
      <button key={k} type="button" className={`v3fs-demo-field${flagged ? " flagged" : ""}`}
        disabled={!onToggleFieldFlag}
        title={flagged ? "Flagged — tap to clear" : "Tap if this field is wrong or shouldn't be here"}
        onClick={() => onToggleFieldFlag?.(key)}>
        <em>{k}</em> {v}{flagged ? " ✗" : ""}
      </button>
    );
  };

  const renderBlock = (block: Record<string, unknown>, blockKey: string) => {
    const kind = str(block.kind);
    const entity = str(block.entity);
    const label = str(block.label) || entity || kind;
    if (kind === "metric") {
      return (
        <div key={blockKey} className="v3fs-pilot-metric">
          <b>{metricValue(block, records)}</b>
          <span>{label}</span>
        </div>
      );
    }
    if (kind === "form" && entity) {
      const fields = formFieldsFor(entity, block, fixtures);
      if (!fields.length) return null;
      const draft = formDrafts[blockKey] ?? {};
      return (
        <div key={blockKey} className="v3fs-pilot-form">
          <div className="v3fs-pilot-bh">{label}</div>
          {fields.map((f) => (
            <label key={f} className="v3fs-pilot-fld">
              <span>{f}</span>
              <input value={draft[f] ?? ""} onChange={(e) =>
                setFormDrafts((d) => ({ ...d, [blockKey]: { ...(d[blockKey] ?? {}), [f]: e.target.value } }))} />
            </label>
          ))}
          <button type="button" className="v3fs-btn pri" onClick={() => submitForm(blockKey, entity, fields)}>
            ＋ Create {entity}
          </button>
        </div>
      );
    }
    if ((kind === "detail" || kind === "action") && entity) {
      const record = selectedFor(entity);
      if (!record) return null;
      const transitions = pendingTransitions(record, machines);
      return (
        <div key={blockKey} className="v3fs-pilot-detail">
          <div className="v3fs-pilot-bh">{label}</div>
          <div className="v3fs-pilot-dt">
            <b>{record.label}</b>
            {record.state ? <span className="v3fs-pilot-state">{record.state}</span> : null}
          </div>
          {kind === "detail" ? (
            <div className="v3fs-demo-fxfields">
              {Object.entries(record.values).slice(0, 8).map(([k, v]) => fieldChip(record.entity, k, v))}
            </div>
          ) : null}
          {transitions.length ? (
            <div className="v3fs-pilot-acts">
              {transitions.slice(0, 3).map((t, i) => (
                <button key={i} type="button" className={`v3fs-btn${isAgentTransition(t) ? "" : " pri"}`}
                  disabled={!!working}
                  title={isAgentTransition(t) ? `${t.actor} runs this` : "Your approval moment"}
                  onClick={() => void runTransition(record, t)}>
                  {isAgentTransition(t) ? `⚙ ${t.on}` : `⛨ ${t.on}`}
                </button>
              ))}
            </div>
          ) : record.state ? <span className="v3fs-pilot-endnote">End of this lifecycle in the pilot.</span> : null}
          {kind === "detail" && record.log.length > 1 ? (
            <ul className="v3fs-pilot-log">
              {record.log.slice(-4).map((entry, i) => <li key={i}>{entry.actor ? <b>{entry.actor}</b> : null} {entry.text}</li>)}
            </ul>
          ) : null}
        </div>
      );
    }
    // table / list / timeline — the queue itself. Selecting a row exposes its
    // pending actions INLINE, so a queue-only screen is still operable.
    const rows = entity ? records.filter((r) => r.entity.toLowerCase() === entity.toLowerCase()) : [];
    if (!rows.length) return null;
    return (
      <div key={blockKey} className="v3fs-pilot-table">
        <div className="v3fs-pilot-bh">{label}</div>
        {rows.slice(0, 8).map((r) => {
          const next = pendingTransitions(r, machines);
          const human = next.find((t) => !isAgentTransition(t));
          const isSelected = selected[r.entity.toLowerCase()] === r.id;
          return (
            <div key={r.id}>
              <button type="button"
                className={`v3fs-pilot-row${isSelected ? " on" : ""}${r.mine ? " mine" : ""}`}
                onClick={() => setSelected((s) => ({ ...s, [r.entity.toLowerCase()]: r.id }))}>
                <span className="v3fs-pilot-rowl">{r.label}{r.mine ? <em> · yours</em> : null}</span>
                {r.state ? <span className="v3fs-pilot-state">{r.state}</span> : null}
                {human ? <span className="v3fs-pilot-hitl" title={human.on}>⛨ you</span> : null}
              </button>
              {isSelected && next.length ? (
                <div className="v3fs-pilot-acts inline">
                  {next.slice(0, 3).map((t, i) => (
                    <button key={i} type="button" className={`v3fs-btn${isAgentTransition(t) ? "" : " pri"}`}
                      disabled={!!working}
                      title={isAgentTransition(t) ? `${t.actor} runs this` : "Your approval moment"}
                      onClick={() => void runTransition(r, t)}>
                      {isAgentTransition(t) ? `⚙ ${t.on}` : `⛨ ${t.on}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  if (!screens.length || !fixtures.length) return null;
  const regions = Array.isArray(screen?.wireframe) ? (screen.wireframe as Array<Record<string, unknown>>).filter(isRecord) : [];
  const blocks = regions.flatMap((region, ri) =>
    (Array.isArray(region.blocks) ? (region.blocks as unknown[]).filter(isRecord) : []).map((b, bi) => ({ b: b as Record<string, unknown>, key: `${screenIdx}.${ri}.${bi}` })));
  return (
    <div className="v3fs-pilot">
      <div className="v3fs-pilot-nav" role="tablist" aria-label="Pilot screens">
        {screens.slice(0, 8).map((sc, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === screenIdx}
            className={`v3fs-pilot-tab${i === screenIdx ? " on" : ""}`}
            onClick={() => setScreenIdx(i)}>
            {str(sc.name) || `Screen ${i + 1}`}
          </button>
        ))}
        <button type="button" className="v3fs-btn pri v3fs-pilot-queue" disabled={!!working}
          title="Every record with a pending agent step advances — watch the agents work"
          onClick={() => void runQueue()}>⚙ Let the agents work the queue</button>
      </div>
      {working ? <div className="v3fs-demo-live"><span className="v3fs-demo-pulse" aria-hidden="true" />⚙ {working}</div> : null}
      <div className="v3fs-pilot-body">
        {blocks.map(({ b, key }) => renderBlock(b, key))}
      </div>
      <p className="v3fs-pilot-honest">This pilot runs on seeded data — integrations are stubbed, and every action you take here goes to the programme team as feedback, not into any live system.</p>
    </div>
  );
}
