/**
 * Domain Ontology as a living graph. Entities are nodes, relations are
 * labelled edges — drag to arrange, click to edit in the side panel, drag
 * node-to-node to draw a new relation. The graph IS the document: every
 * change rewrites the same entities/relations shape the generator emits,
 * so grounding, standards alignment and the blueprint keep reading it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState,
  type Node, type Edge, type Connection, type ReactFlowInstance,
} from "@xyflow/react";
import { FLOATING_EDGE_TYPES, layeredPositions } from "./graphKit";
import "@xyflow/react/dist/style.css";
import {
  Section, TextField, TextArea, SelectField, ChipsField, StringListEditor, TableEditor,
  asArray, asRecord, asText, asStrings, type StudioProps,
} from "./StudioKit";

import { ONTOLOGY_CARDINALITIES } from "@/v3/components/flow/flowOntologyConstraints";

type Selection = { kind: "entity"; id: string } | { kind: "relation"; index: number } | null;

// One vocabulary, shared with the write-time gate — the dropdown can always
// represent what the gate accepts (incl. the generator's N:1 / 0:N forms).
const CARDINALITIES = [...ONTOLOGY_CARDINALITIES];

function entityId(entity: Record<string, unknown>, index: number): string {
  const name = asText(entity.name).trim();
  return name || `entity-${index}`;
}

function seedPositions(ids: string[], relations: Array<Record<string, unknown>>): Record<string, { x: number; y: number }> {
  return layeredPositions(ids, relations.map((relation) => ({ from: String(relation.from ?? ""), to: String(relation.to ?? "") })));
}

export default function OntologyStudio({ doc, onChange }: StudioProps) {
  const entities = useMemo(() => asArray(doc.entities).map(asRecord), [doc.entities]);
  const relations = useMemo(() => asArray(doc.relations).map(asRecord), [doc.relations]);
  const ids = useMemo(() => entities.map(entityId), [entities]);

  const [selected, setSelected] = useState<Selection>(null);
  // Controlled node state via React Flow's own reducer — it records the
  // measured dimensions edges need to route; we sync structure from the doc
  // below while preserving positions and measurements across rebuilds.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);

  const adopted = useMemo(() => {
    const rows = asArray(doc.standardAlignment).map(asRecord);
    const byEntity = new Map<string, string>();
    for (const row of rows) {
      const entity = asText(row.entity);
      const uri = asText(row.standard);
      if (entity && uri && !byEntity.has(entity)) byEntity.set(entity, uri.split("/").pop() ?? uri);
    }
    return byEntity;
  }, [doc.standardAlignment]);

  // Structure follows the document; geometry follows the user. Rebuild nodes
  // whenever entities/selection change, carrying prior position + measured
  // size by id so the graph never snaps back or loses its edges.
  const rearrange = useCallback(() => {
    setNodes((current) => {
      // Feed the layout each node's MEASURED box so the row packing never
      // overlaps and rows clear each other by real height.
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const node of current) {
        const width = node.measured?.width ?? node.width;
        const height = node.measured?.height ?? node.height;
        if (width && height) sizes[node.id] = { width, height };
      }
      const positions = layeredPositions(
        ids,
        relations.map((relation) => ({ from: String(relation.from ?? ""), to: String(relation.to ?? "") })),
        { sizes, y: 120 },
      );
      return current.map((node) => ({ ...node, position: positions[node.id] ?? node.position }));
    });
    // Re-frame on the tidied graph once the new positions have painted.
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, duration: 400 }));
  }, [ids, relations, setNodes]);

  useEffect(() => {
    setNodes((previous) => {
      const prevById = new Map(previous.map((node) => [node.id, node]));
      const seeded = seedPositions(ids, relations);
      return entities.map((entity, index) => {
        const id = entityId(entity, index);
        const prev = prevById.get(id);
        const standard = adopted.get(asText(entity.name));
        return {
          ...(prev ?? {}),
          id,
          position: prev?.position ?? seeded[id] ?? { x: 40 * (index % 5) - 80, y: 48 * Math.floor(index / 5) - 48 },
          className: `v3fs-onto-node${selected?.kind === "entity" && selected.id === id ? " selected" : ""}`,
          data: {
            label: (
              <div className="v3fs-onto-nl">
                <b>{asText(entity.name) || "Unnamed entity"}</b>
                {asText(entity.systemOfRecord) ? <span className="v3fs-onto-sor">{asText(entity.systemOfRecord)}</span> : null}
                {standard ? <span className="v3fs-onto-std">⇢ {standard}</span> : null}
              </div>
            ),
          },
        } as Node;
      });
    });
  }, [entities, ids, relations, adopted, selected, setNodes]);

  const edges: Edge[] = useMemo(() => relations.map((relation, index) => {
    const cardinality = asText(relation.cardinality);
    return {
      id: `rel-${index}`,
      type: "floating",
      selected: selected?.kind === "relation" && selected.index === index,
      source: asText(relation.from),
      target: asText(relation.to),
      label: `${asText(relation.relation) || "relates to"}${cardinality && cardinality !== "unknown" ? ` · ${cardinality}` : ""}`,
      className: `v3fs-onto-edge${selected?.kind === "relation" && selected.index === index ? " selected" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
  }), [relations, selected]);

  const patch = (next: Partial<Record<string, unknown>>) => onChange({ ...doc, ...next });

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const next = [...relations, { from: connection.source, relation: "relates to", to: connection.target, cardinality: "unknown" }];
    patch({ relations: next });
    setSelected({ kind: "relation", index: next.length - 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations, doc]);

  const addEntity = () => {
    let name = "New entity";
    let n = 2;
    while (ids.includes(name)) name = `New entity ${n++}`;
    patch({ entities: [...entities, { name, definition: "", attributes: [], aliases: [], systemOfRecord: null }] });
    setSelected({ kind: "entity", id: name });
  };

  const renameEntity = (index: number, nextName: string) => {
    const oldName = asText(entities[index].name);
    const nextEntities = entities.map((entity, i) => (i === index ? { ...entity, name: nextName } : entity));
    const nextRelations = relations.map((relation) => ({
      ...relation,
      from: asText(relation.from) === oldName ? nextName : relation.from,
      to: asText(relation.to) === oldName ? nextName : relation.to,
    }));
    const nextAlignment = asArray(doc.standardAlignment).map(asRecord).map((row) =>
      asText(row.entity) === oldName ? { ...row, entity: nextName } : row);
    setNodes((current) => current.map((node) => (node.id === oldName ? { ...node, id: nextName || `entity-${index}` } : node)));
    setSelected({ kind: "entity", id: nextName || `entity-${index}` });
    patch({ entities: nextEntities, relations: nextRelations, standardAlignment: nextAlignment });
  };

  const updateEntity = (index: number, changes: Record<string, unknown>) =>
    patch({ entities: entities.map((entity, i) => (i === index ? { ...entity, ...changes } : entity)) });

  const deleteEntity = (index: number) => {
    const name = asText(entities[index].name);
    patch({
      entities: entities.filter((_, i) => i !== index),
      relations: relations.filter((relation) => asText(relation.from) !== name && asText(relation.to) !== name),
    });
    setSelected(null);
  };

  const updateRelation = (index: number, changes: Record<string, unknown>) =>
    patch({ relations: relations.map((relation, i) => (i === index ? { ...relation, ...changes } : relation)) });

  const deleteRelation = (index: number) => {
    patch({ relations: relations.filter((_, i) => i !== index) });
    setSelected(null);
  };

  const selectedEntityIndex = selected?.kind === "entity"
    ? entities.findIndex((entity, i) => entityId(entity, i) === selected.id)
    : -1;
  const selectedEntity = selectedEntityIndex >= 0 ? entities[selectedEntityIndex] : null;
  const selectedRelation = selected?.kind === "relation" ? relations[selected.index] : null;

  return (
    <div className="v3fs-onto">
      <div className="v3fs-onto-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={FLOATING_EDGE_TYPES}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelected({ kind: "entity", id: node.id })}
          onEdgeClick={(_, edge) => setSelected({ kind: "relation", index: Number(edge.id.replace("rel-", "")) })}
          onPaneClick={() => setSelected(null)}
          onInit={(instance) => { flowRef.current = instance; }}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesConnectable
          nodesDraggable
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="v3fs-onto-toolbar">
          <button type="button" className="v3fs-btn" onClick={addEntity}>＋ Add entity</button>
          <button type="button" className="v3fs-btn" onClick={rearrange} title="Re-apply the layered layout — shortest connectors, fewest crossings">⌗ Arrange</button>
        </div>
      </div>

      <aside className="v3fs-onto-panel">
        {selectedEntity ? (
          <>
            <div className="v3fs-stu-sec-h"><h3>Entity</h3><span>name, definition, evidence</span></div>
            <TextField label="Name" value={asText(selectedEntity.name)}
              onChange={(next) => renameEntity(selectedEntityIndex, next)} />
            <TextArea label="Definition" rows={3} value={asText(selectedEntity.definition)}
              onChange={(next) => updateEntity(selectedEntityIndex, { definition: next })} />
            <TextField label="System of record" value={asText(selectedEntity.systemOfRecord)}
              onChange={(next) => updateEntity(selectedEntityIndex, { systemOfRecord: next || null })} />
            <ChipsField label="Attributes" values={asStrings(selectedEntity.attributes)}
              onChange={(next) => updateEntity(selectedEntityIndex, { attributes: next })} />
            <ChipsField label="Aliases" values={asStrings(selectedEntity.aliases)}
              onChange={(next) => updateEntity(selectedEntityIndex, { aliases: next })} />
            <TextArea label="Evidence" rows={2} value={asText(selectedEntity.evidence)}
              onChange={(next) => updateEntity(selectedEntityIndex, { evidence: next })} />
            <button type="button" className="v3fs-btn danger" onClick={() => deleteEntity(selectedEntityIndex)}>
              Delete entity
            </button>
          </>
        ) : selectedRelation && selected?.kind === "relation" ? (
          <>
            <div className="v3fs-stu-sec-h"><h3>Relation</h3><span>{asText(selectedRelation.from)} → {asText(selectedRelation.to)}</span></div>
            <TextField label="Relation (verb phrase)" value={asText(selectedRelation.relation)}
              onChange={(next) => updateRelation(selected.index, { relation: next })} />
            <SelectField label="Cardinality" value={asText(selectedRelation.cardinality) || "unknown"} options={CARDINALITIES}
              onChange={(next) => updateRelation(selected.index, { cardinality: next })} />
            <button type="button" className="v3fs-btn danger" onClick={() => deleteRelation(selected.index)}>
              Delete relation
            </button>
          </>
        ) : (
          <div className="v3fs-stu-empty">
            Click an entity or relation to edit it. Drag from one node’s edge to another to draw a new relation.
          </div>
        )}
      </aside>

      <div className="v3fs-onto-below">
        <Section label="Business events" hint="what happens, what causes it, what it changes">
          <TableEditor
            columns={[
              { key: "name", label: "Event" },
              { key: "triggers", label: "Triggered by", grow: 1.4 },
              { key: "produces", label: "Produces", grow: 1.4 },
            ]}
            rows={asArray(doc.events).map(asRecord)}
            onChange={(next) => patch({ events: next })}
            addLabel="Add event"
            emptyHint="No business events captured yet."
          />
        </Section>
        <Section label="Ambiguities" hint="terms teams use differently">
          <TableEditor
            columns={[
              { key: "term", label: "Term" },
              { key: "resolution", label: "Resolution", grow: 2 },
            ]}
            rows={asArray(doc.ambiguities).map(asRecord)}
            onChange={(next) => patch({ ambiguities: next })}
            addLabel="Add ambiguity"
            emptyHint="No ambiguities logged."
          />
        </Section>
        <Section label="Standards alignment" hint="entities mapped to public vocabularies — adopted via the Inbox">
          <TableEditor
            columns={[
              { key: "entity", label: "Entity" },
              { key: "standard", label: "Standard URI", grow: 2 },
              { key: "vocabulary", label: "Vocabulary" },
              { key: "relation", label: "Relation" },
            ]}
            rows={asArray(doc.standardAlignment).map(asRecord)}
            onChange={(next) => patch({ standardAlignment: next })}
            addLabel="Add mapping"
            emptyHint="No standard mappings adopted yet."
          />
        </Section>
        <Section label="Gaps" hint="entities referenced but never defined">
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </Section>
      </div>
    </div>
  );
}
