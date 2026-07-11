/**
 * Domain Ontology as a living graph. Entities are nodes, relations are
 * labelled edges — drag to arrange, click to edit in the side panel, drag
 * node-to-node to draw a new relation. The graph IS the document: every
 * change rewrites the same entities/relations shape the generator emits,
 * so grounding, standards alignment and the blueprint keep reading it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MarkerType, useNodesState,
  type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Section, TextField, TextArea, SelectField, ChipsField, StringListEditor, TableEditor,
  asArray, asRecord, asText, asStrings, type StudioProps,
} from "./StudioKit";

type Selection = { kind: "entity"; id: string } | { kind: "relation"; index: number } | null;

const CARDINALITIES = ["1:1", "1:N", "N:M", "unknown"];

function entityId(entity: Record<string, unknown>, index: number): string {
  const name = asText(entity.name).trim();
  return name || `entity-${index}`;
}

/**
 * Deterministic layered layout that keeps connectors short and mostly
 * parallel: BFS from the best-connected entity assigns layers (rows), then
 * one barycenter pass orders each layer by the average position of its
 * neighbours above — the classic crossing-minimisation move. Disconnected
 * entities settle into the final row.
 */
function seedPositions(ids: string[], relations: Array<Record<string, unknown>>): Record<string, { x: number; y: number }> {
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const relation of relations) {
    const from = String(relation.from ?? "");
    const to = String(relation.to ?? "");
    if (neighbours.has(from) && neighbours.has(to)) {
      neighbours.get(from)!.push(to);
      neighbours.get(to)!.push(from);
    }
  }
  const layers: string[][] = [];
  const layerOf = new Map<string, number>();
  const unvisited = new Set(ids);
  while (unvisited.size) {
    const root = [...unvisited].sort((a, b) => (neighbours.get(b)!.length - neighbours.get(a)!.length))[0];
    let frontier = [root];
    unvisited.delete(root);
    let depth = layers.length ? layers.length : 0;
    while (frontier.length) {
      (layers[depth] ??= []).push(...frontier);
      frontier.forEach((id) => layerOf.set(id, depth));
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of neighbours.get(id)!) {
          if (unvisited.has(other)) {
            unvisited.delete(other);
            next.push(other);
          }
        }
      }
      frontier = next;
      depth += 1;
    }
  }
  // Barycenter pass: order each layer by the mean index of neighbours above.
  for (let depth = 1; depth < layers.length; depth += 1) {
    const above = new Map(layers[depth - 1].map((id, index) => [id, index]));
    layers[depth].sort((a, b) => {
      const mean = (id: string) => {
        const ups = neighbours.get(id)!.map((other) => above.get(other)).filter((v): v is number => v !== undefined);
        return ups.length ? ups.reduce((sum, v) => sum + v, 0) / ups.length : Number.MAX_SAFE_INTEGER;
      };
      return mean(a) - mean(b);
    });
  }
  const out: Record<string, { x: number; y: number }> = {};
  layers.forEach((layer, depth) => {
    layer.forEach((id, index) => {
      out[id] = { x: Math.round((index - (layer.length - 1) / 2) * 240), y: depth * 150 };
    });
  });
  return out;
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
    const positions = seedPositions(ids, relations);
    setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id] ?? node.position })));
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
      type: "smoothstep",
      pathOptions: { borderRadius: 6 },
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
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelected({ kind: "entity", id: node.id })}
          onEdgeClick={(_, edge) => setSelected({ kind: "relation", index: Number(edge.id.replace("rel-", "")) })}
          onPaneClick={() => setSelected(null)}
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
            Click an entity or relation to edit it. Drag from one node's edge to another to draw a new relation.
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
