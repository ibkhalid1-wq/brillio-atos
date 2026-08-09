/**
 * The Agentic Blueprint as ONE canvas with LENSES — not ten accordions. Agents are
 * nodes and the DATAFLOW between them is derived (A feeds B where A's outputs meet
 * B's inputs). The other blueprint dimensions are LENSES over this same canvas, not
 * separate drawers — "same object, different emphasis":
 *   · Flow   — the dataflow edges (the default).
 *   · Data   — each agent's data contracts (inputs/outputs it reads & writes).
 *   · HITL   — the agents a human gates; the rest dim.
 *   · Eval   — each agent's pass bar (the eval plan, per agent).
 *   · Build  — the agents numbered by build sequence.
 * Every node shows its claim status: an agent with no automation/autonomy decided
 * renders as `?unknown` — the blueprint-layer unknown, made visible here.
 */
import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FLOATING_EDGE_TYPES, layeredPositions } from "./graphKit";
import { asArray, asRecord, asText, asStrings, useStudioLocked, EmptyState, type StudioProps } from "./StudioKit";

type Lens = "flow" | "data" | "hitl" | "eval" | "build";
const LENSES: Array<{ key: Lens; label: string; hint: string }> = [
  { key: "flow", label: "Flow", hint: "the dataflow between agents (the default)" },
  { key: "data", label: "Data", hint: "each agent's data contracts — what it reads & writes" },
  { key: "hitl", label: "HITL", hint: "the agents a human gates; the rest dim" },
  { key: "eval", label: "Eval", hint: "each agent's pass bar from the eval plan" },
  { key: "build", label: "Build", hint: "agents numbered by the build sequence" },
];

/** token overlap so "ReconciliationAction" ~ "reconciliation actions". */
const tok = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).map((t) => t.replace(/s$/, "")).filter((t) => t.length >= 4);
const mentions = (haystack: string, name: string) => {
  const hs = haystack.toLowerCase();
  return name.length >= 3 && (hs.includes(name.toLowerCase()) || tok(name).some((t) => hs.includes(t)));
};

export default function BlueprintGraph({ doc }: Pick<StudioProps, "doc">) {
  const locked = useStudioLocked();
  const [lens, setLens] = useState<Lens>("flow");
  const agents = useMemo(() => asArray(doc.agents).map(asRecord), [doc.agents]);
  const orchestration = asRecord(doc.orchestration);
  const hitl = useMemo(() => asArray(doc.hitlPoints).map(asRecord), [doc.hitlPoints]);
  const evals = useMemo(() => asArray(doc.evalPlan).map(asRecord), [doc.evalPlan]);
  const build = useMemo(() => asStrings(doc.buildSequence), [doc.buildSequence]);

  // per-agent lens facts, keyed by agent name.
  const lensFacts = useMemo(() => {
    const m = new Map<string, { hitl?: string; passBar?: string; buildIndex?: number; unknownAutonomy: boolean }>();
    for (const a of agents) {
      const name = asText(a.name); if (!name) continue;
      const h = hitl.find((p) => mentions(`${asText(p.agent)} ${asText(p.point ?? p.where ?? "")}`, name));
      const e = evals.find((row) => mentions(`${asText(row.agent)} ${asText(row.metric ?? row.what ?? row.check ?? "")}`, name));
      const bi = build.findIndex((slice) => mentions(slice, name));
      m.set(name, {
        hitl: h ? (asText(h.point ?? h.where) || asText(h.approver) || "human approves") : undefined,
        passBar: e ? (asText(e.passBar ?? e.threshold ?? e.target) || asText(e.metric ?? e.what ?? e.check)) : undefined,
        buildIndex: bi >= 0 ? bi + 1 : undefined,
        unknownAutonomy: !asText(a.autonomyLevel).trim(),   // blueprint-layer ?unknown
      });
    }
    return m;
  }, [agents, hitl, evals, build]);

  const flows = useMemo(() => {
    const links: Array<{ from: string; to: string; carries: string[] }> = [];
    for (const a of agents) {
      for (const b of agents) {
        if (a === b) continue;
        const inputTokens = new Set(asStrings(b.inputs).flatMap(tok));
        const carries = asStrings(a.outputs).filter((value) => tok(value).some((token) => inputTokens.has(token)));
        if (carries.length) links.push({ from: asText(a.name), to: asText(b.name), carries });
      }
    }
    const description = asText(orchestration.description);
    if (description) {
      const linked = new Set(links.map((link) => `${link.from}→${link.to}`));
      for (const a of agents) {
        for (const b of agents) {
          if (a === b) continue;
          const from = asText(a.name), to = asText(b.name);
          if (!from || !to || linked.has(`${from}→${to}`) || linked.has(`${to}→${from}`)) continue;
          const pattern = new RegExp(`${from}[^.]*(?:invok|orchestrat|call|rout|hand|delegat)[^.]*${to}`, "i");
          if (pattern.test(description)) { links.push({ from, to, carries: ["orchestrates"] }); linked.add(`${from}→${to}`); }
        }
      }
    }
    return links;
  }, [agents, orchestration]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    const ids = agents.map((agent) => asText(agent.name)).filter(Boolean);
    const seeded = layeredPositions(ids, flows, { x: 260, y: 160 });
    setNodes((previous) => {
      const prevById = new Map(previous.map((node) => [node.id, node]));
      return agents.map((agent, index) => {
        const id = asText(agent.name) || `agent-${index}`;
        const prev = prevById.get(id);
        const f = lensFacts.get(id) ?? { unknownAutonomy: true };
        // Lens picks what each node EMPHASISES — same node, different face.
        const dimmed = lens === "hitl" && !f.hitl;
        const lensLine =
          lens === "data" ? [...asStrings(agent.inputs).slice(0, 2).map((x) => `↓${x}`), ...asStrings(agent.outputs).slice(0, 2).map((x) => `${x}↑`)].join("  ") || "no data contracts"
          : lens === "hitl" ? (f.hitl ? `⛊ ${f.hitl.slice(0, 60)}` : "no human gate")
          : lens === "eval" ? (f.passBar ? `✓ ${f.passBar.slice(0, 60)}` : "no pass bar set")
          : lens === "build" ? (f.buildIndex ? `slice ${f.buildIndex}` : "not sequenced")
          : asText(agent.purpose).slice(0, 72);
        return {
          ...(prev ?? {}),
          id,
          position: prev?.position ?? seeded[id] ?? { x: index * 240, y: 0 },
          className: `v3fs-onto-node v3fs-bp-node${dimmed ? " v3fs-bp-dim" : ""}${lens === "hitl" && f.hitl ? " v3fs-bp-gated" : ""}`,
          data: {
            label: (
              <div className="v3fs-onto-nl">
                <b>{id}{lens === "build" && f.buildIndex ? <span className="v3fs-bp-seq">{f.buildIndex}</span> : null}</b>
                {/* claim status: an agent with no autonomy decided is a blueprint-layer ?unknown */}
                {f.unknownAutonomy
                  ? <span className="v3fs-bp-auto unknown" title="Automation/autonomy not decided — a blueprint-layer open unknown">?unknown autonomy</span>
                  : <span className="v3fs-bp-auto">{asText(agent.autonomyLevel)}</span>}
                {lensLine ? <span className="v3fs-bp-purpose">{lensLine}</span> : null}
                {lens === "flow" && f.hitl ? <span className="v3fs-bp-hitl">⛊ human approves</span> : null}
              </div>
            ),
          },
        } as Node;
      });
    });
  }, [agents, flows, lensFacts, lens, setNodes]);

  // Edges only carry meaning in the Flow lens; the others emphasise nodes.
  const edges: Edge[] = useMemo(() => lens !== "flow" ? [] : flows.map((flow, index) => ({
    id: `flow-${index}`,
    type: "floating",
    source: flow.from,
    target: flow.to,
    label: flow.carries.slice(0, 2).join(", ") + (flow.carries.length > 2 ? "…" : ""),
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  })), [flows, lens]);

  if (!agents.length) {
    return <EmptyState icon="🧩" title="No agents yet" hint="Add them below, or regenerate the Blueprint to derive them from the Atlas and Ontology." />;
  }
  const unknownCount = [...lensFacts.values()].filter((f) => f.unknownAutonomy).length;
  return (
    <div className="v3fs-bp-wrap">
      <div className="v3fs-bp-lenses" role="tablist" aria-label="Blueprint lenses">
        {LENSES.map((l) => (
          <button key={l.key} type="button" role="tab" aria-selected={lens === l.key}
            className={`v3fs-bp-lens${lens === l.key ? " on" : ""}`} title={l.hint}
            onClick={() => setLens(l.key)}>{l.label}</button>
        ))}
        <span className="v3fs-bp-lens-hint">{LENSES.find((l) => l.key === lens)?.hint}</span>
        {unknownCount ? <span className="v3fs-bp-unknowns" title="Agents whose automation/autonomy is an open unknown">{unknownCount} ?unknown</span> : null}
      </div>
      <div className="v3fs-bp-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={FLOATING_EDGE_TYPES}
          onNodesChange={onNodesChange}
          nodesDraggable={!locked}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.1 }}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {asText(orchestration.pattern) ? (
          <div className="v3fs-bp-pattern">{asText(orchestration.pattern)}</div>
        ) : null}
      </div>
    </div>
  );
}
