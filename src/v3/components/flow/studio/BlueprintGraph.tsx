/**
 * The Agentic Blueprint's orchestration as a living graph: agents are nodes,
 * and the DATAFLOW between them is derived — agent A feeds agent B wherever
 * A's outputs intersect B's inputs, each edge labelled with what crosses it.
 * Human-in-the-loop points ride the agents that own them. Layered layout,
 * floating angled connectors; the agent cards below remain the full editor.
 */
import { useEffect, useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FLOATING_EDGE_TYPES, layeredPositions } from "./graphKit";
import { asArray, asRecord, asText, asStrings, useStudioLocked, type StudioProps } from "./StudioKit";

export default function BlueprintGraph({ doc }: Pick<StudioProps, "doc">) {
  const locked = useStudioLocked();
  const agents = useMemo(() => asArray(doc.agents).map(asRecord), [doc.agents]);
  const orchestration = asRecord(doc.orchestration);
  const hitl = useMemo(() => asArray(doc.hitlPoints).map(asRecord), [doc.hitlPoints]);

  const flows = useMemo(() => {
    // Dataflow first: A feeds B where their outputs/inputs share a name —
    // token-tolerant (ReconciliationAction ~ reconciliation actions). When a
    // pair shares nothing, fall back to the orchestration description: a
    // sentence naming A then B with an orchestration verb draws A → B.
    const tokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/)
      .map((token) => token.replace(/s$/, "")).filter((token) => token.length >= 4);
    const links: Array<{ from: string; to: string; carries: string[] }> = [];
    for (const a of agents) {
      for (const b of agents) {
        if (a === b) continue;
        const inputTokens = new Set(asStrings(b.inputs).flatMap(tokens));
        const carries = asStrings(a.outputs).filter((value) => tokens(value).some((token) => inputTokens.has(token)));
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
          if (pattern.test(description)) {
            links.push({ from, to, carries: ["orchestrates"] });
            linked.add(`${from}→${to}`);
          }
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
        const gated = hitl.some((point) => asText(point.agent) === id || asText(point.point ?? point.where ?? "").includes(id));
        return {
          ...(prev ?? {}),
          id,
          position: prev?.position ?? seeded[id] ?? { x: index * 240, y: 0 },
          className: "v3fs-onto-node v3fs-bp-node",
          data: {
            label: (
              <div className="v3fs-onto-nl">
                <b>{id}</b>
                {asText(agent.autonomyLevel) ? <span className="v3fs-bp-auto">{asText(agent.autonomyLevel)}</span> : null}
                {asText(agent.purpose) ? <span className="v3fs-bp-purpose">{asText(agent.purpose).slice(0, 72)}</span> : null}
                {gated ? <span className="v3fs-bp-hitl">⛊ human approves</span> : null}
              </div>
            ),
          },
        } as Node;
      });
    });
  }, [agents, flows, hitl, setNodes]);

  const edges: Edge[] = useMemo(() => flows.map((flow, index) => ({
    id: `flow-${index}`,
    type: "floating",
    source: flow.from,
    target: flow.to,
    label: flow.carries.slice(0, 2).join(", ") + (flow.carries.length > 2 ? "…" : ""),
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  })), [flows]);

  if (!agents.length) {
    return <div className="v3fs-stu-empty">No agents yet — add them below, or regenerate the Blueprint.</div>;
  }
  return (
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
  );
}
