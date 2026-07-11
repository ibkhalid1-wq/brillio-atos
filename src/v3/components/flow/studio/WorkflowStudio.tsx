/**
 * The Current-State Atlas's workflows as a living diagram. Each workflow is
 * a left-to-right chain of step cards — actor, action, system, duration —
 * with the ontology's entities as chips on the steps that touch them. The
 * diagram IS the document: selection edits in the inspector, add/remove/
 * reorder rewrite the same steps array the generator emits, and dragging
 * only arranges (geometry lives in `_`-prefixed keys the readers ignore).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  TextField, ChipsField, asArray, asRecord, asText, asStrings, type StudioProps,
} from "./StudioKit";

function seedPosition(index: number): { x: number; y: number } {
  return { x: index * 240, y: (index % 2) * 26 };
}

function StepNode({ data }: { data: { actor: string; action: string; system: string; duration: string; entities: string[]; onEntity?: () => void } }) {
  return (
    <div className="v3fs-wf-node">
      {data.actor ? <div className="v3fs-wf-actor">{data.actor}</div> : null}
      <div className="v3fs-wf-action">{data.action || "—"}</div>
      <div className="v3fs-wf-meta">
        {data.system ? <span className="v3fs-wf-system">{data.system}</span> : null}
        {data.duration ? <span className="v3fs-wf-dur">{data.duration}</span> : null}
      </div>
      {data.entities.length ? (
        <div className="v3fs-wf-ents">
          {data.entities.slice(0, 4).map((entity) => (
            <button key={entity} type="button" className="v3fs-wf-ent" title="Defined in the Domain Ontology — open it"
              onClick={(event) => { event.stopPropagation(); data.onEntity?.(); }}>
              {entity}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const NODE_TYPES = { wfstep: StepNode };

export default function WorkflowStudio({ doc, onChange, onOpenArtifact }: StudioProps) {
  const workflows = useMemo(() => asArray(doc.workflows).map(asRecord), [doc.workflows]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const workflow = workflows[Math.min(active, Math.max(0, workflows.length - 1))];
  const steps = useMemo(() => (workflow ? asArray(workflow.steps).map(asRecord) : []), [workflow]);

  const writeWorkflows = useCallback((next: Array<Record<string, unknown>>) => {
    onChange({ ...doc, workflows: next });
  }, [doc, onChange]);
  const patchWorkflow = useCallback((patch: Record<string, unknown>) => {
    writeWorkflows(workflows.map((entry, index) => (index === active ? { ...entry, ...patch } : entry)));
  }, [workflows, active, writeWorkflows]);
  const patchStep = useCallback((index: number, patch: Record<string, unknown>) => {
    patchWorkflow({ steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  }, [steps, patchWorkflow]);

  // Structure follows the doc; geometry follows the user (stored on the step
  // under a `_pos` key every reader ignores).
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    setNodes((current) => steps.map((step, index) => {
      const id = `step-${index}`;
      const held = current.find((node) => node.id === id);
      const pos = asRecord(step._pos);
      return {
        id,
        type: "wfstep",
        position: held?.position
          ?? (typeof pos.x === "number" && typeof pos.y === "number" ? { x: pos.x, y: pos.y } : seedPosition(index)),
        selected: selected === index,
        data: {
          actor: asText(step.actor),
          action: asText(step.action),
          system: asText(step.system),
          duration: asText(step.duration),
          entities: asStrings(step.entities),
          onEntity: onOpenArtifact ? () => onOpenArtifact("domain-ontology") : undefined,
        },
      };
    }));
  }, [steps, selected, setNodes, onOpenArtifact]);

  const edges: Edge[] = useMemo(() => steps.slice(1).map((_, index) => ({
    id: `seq-${index}`,
    source: `step-${index}`,
    target: `step-${index + 1}`,
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [steps]);

  const persistPosition = useCallback((node: Node) => {
    const index = Number(node.id.replace("step-", ""));
    if (!Number.isNaN(index) && steps[index]) patchStep(index, { _pos: { x: Math.round(node.position.x), y: Math.round(node.position.y) } });
  }, [steps, patchStep]);

  const addStep = () => {
    const at = selected != null ? selected + 1 : steps.length;
    const next = [...steps];
    next.splice(at, 0, { actor: "", action: "New step", system: "", duration: "" });
    patchWorkflow({ steps: next });
    setSelected(at);
  };
  const moveStep = (delta: number) => {
    if (selected == null) return;
    const to = selected + delta;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(selected, 1);
    next.splice(to, 0, step);
    patchWorkflow({ steps: next });
    setSelected(to);
  };
  const removeStep = () => {
    if (selected == null) return;
    patchWorkflow({ steps: steps.filter((_, index) => index !== selected) });
    setSelected(null);
  };
  const addWorkflow = () => {
    writeWorkflows([...workflows, { name: `Workflow ${workflows.length + 1}`, owner: "", trigger: "", steps: [], handoffs: [], failureModes: [] }]);
    setActive(workflows.length);
    setSelected(null);
  };

  return (
    <div className="v3fs-wf">
      <div className="v3fs-wf-tabs" role="tablist" aria-label="Workflows">
        {workflows.map((entry, index) => (
          <button key={index} type="button" role="tab" aria-selected={index === active}
            className={index === active ? "on" : ""}
            onClick={() => { setActive(index); setSelected(null); }}>
            {asText(entry.name) || `Workflow ${index + 1}`}
          </button>
        ))}
        <button type="button" className="v3fs-a" onClick={addWorkflow}>＋ workflow</button>
      </div>

      {!workflow ? (
        <div className="v3fs-stu-empty">No workflows on record yet — add one, or regenerate the Atlas once transcripts are in.</div>
      ) : (
        <>
          <div className="v3fs-wf-head">
            <TextField label="Name" value={asText(workflow.name)} onChange={(next) => patchWorkflow({ name: next })} />
            <TextField label="Trigger" value={asText(workflow.trigger)} onChange={(next) => patchWorkflow({ trigger: next })} />
            <TextField label="Owner" value={asText(workflow.owner)} onChange={(next) => patchWorkflow({ owner: next })} />
          </div>
          <div className="v3fs-wf-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onNodeDragStop={(_, node) => persistPosition(node)}
              onNodeClick={(_, node) => setSelected(Number(node.id.replace("step-", "")))}
              onPaneClick={() => setSelected(null)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="v3fs-wf-bar">
            <button type="button" className="v3fs-btn" onClick={addStep}>＋ Step{selected != null ? " after selected" : ""}</button>
            {selected != null ? (
              <>
                <button type="button" className="v3fs-btn" onClick={() => moveStep(-1)}>← Earlier</button>
                <button type="button" className="v3fs-btn" onClick={() => moveStep(1)}>Later →</button>
                <button type="button" className="v3fs-btn" onClick={removeStep}>Remove step</button>
              </>
            ) : <span className="v3fs-wf-hint">Select a step to edit it</span>}
          </div>
          {selected != null && steps[selected] ? (
            <div className="v3fs-wf-inspector">
              <TextField label="Actor" value={asText(steps[selected].actor)} onChange={(next) => patchStep(selected, { actor: next })} />
              <TextField label="Action" value={asText(steps[selected].action)} onChange={(next) => patchStep(selected, { action: next })} />
              <TextField label="System" value={asText(steps[selected].system)} onChange={(next) => patchStep(selected, { system: next })} />
              <TextField label="Duration" value={asText(steps[selected].duration)} onChange={(next) => patchStep(selected, { duration: next })} />
              <ChipsField label="Entities touched (from the ontology)" values={asStrings(steps[selected].entities)}
                onChange={(next) => patchStep(selected, { entities: next })} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
