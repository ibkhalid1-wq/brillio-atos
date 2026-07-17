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
  type Node, type Edge, type Connection, type ReactFlowInstance, type NodeChange,
} from "@xyflow/react";
import { ROUTED_EDGE_TYPES, layeredPositions, elkGraphLayout } from "./graphKit";
import "@xyflow/react/dist/style.css";
import {
  Section, TextField, TextArea, SelectField, ChipsField, TableEditor,
  asArray, asRecord, asText, asStrings, useStudioLocked, type StudioProps,
} from "./StudioKit";

import { ONTOLOGY_CARDINALITIES } from "@/v3/components/flow/flowOntologyConstraints";
import { GapRoutingEditor } from "./GapRoutingEditor";

type Selection = { kind: "entity"; id: string } | { kind: "relation"; index: number } | { kind: "candidate"; id: string } | null;

/** Ghost-node id namespace — candidates share the canvas but never the doc. */
const CAND_PREFIX = "cand:";

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

export default function OntologyStudio({ doc, onChange, program, gapRoutes, onRouteGap }: StudioProps) {
  const locked = useStudioLocked();
  const entities = useMemo(() => asArray(doc.entities).map(asRecord), [doc.entities]);
  const relations = useMemo(() => asArray(doc.relations).map(asRecord), [doc.relations]);
  const ids = useMemo(() => entities.map(entityId), [entities]);
  // Candidates: the demoted standard classes behind the gap questions —
  // generator-emitted, pack-grounded, never part of doc.entities. Drawn as
  // dashed "to confirm" ghosts so the sponsor can point at the question.
  const candidates = useMemo(() => asArray(doc.candidates).map(asRecord)
    .filter((candidate) => asText(candidate.name) && !entities.some((entity, i) => entityId(entity, i) === asText(candidate.name))),
    [doc.candidates, entities]);
  const [showCandidates, setShowCandidates] = useState(true);
  const ghostIds = useMemo(() => (showCandidates ? candidates.map((c) => CAND_PREFIX + asText(c.name)) : []), [candidates, showCandidates]);
  // A candidate edge endpoint is either the candidate's own class (→ ghost id)
  // or an asserted entity's display name (→ its node id).
  const ghostEdgeEnd = useCallback((name: string, candidateName: string) =>
    name === candidateName ? CAND_PREFIX + name : name, []);

  const [selected, setSelected] = useState<Selection>(null);
  // Focus mode: clicking an entity spotlights it, its direct neighbours, and the
  // relations between them; everything else dims so a single relationship reads
  // clearly without having to drag nodes apart.
  const selectedEntityId = selected?.kind === "entity" ? selected.id : null;
  const focusIds = useMemo(() => {
    if (!selectedEntityId) return null;
    const set = new Set<string>([selectedEntityId]);
    for (const relation of relations) {
      const from = String(relation.from ?? ""), to = String(relation.to ?? "");
      if (from === selectedEntityId) set.add(to);
      if (to === selectedEntityId) set.add(from);
    }
    return set;
  }, [selectedEntityId, relations]);
  // Controlled node state via React Flow's own reducer — it records the
  // measured dimensions edges need to route; we sync structure from the doc
  // below while preserving positions and measurements across rebuilds.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  // ELK's orthogonal edge routes (edge id → polyline), valid ONLY for the node
  // positions the arrange produced them with — any drag or doc change drops
  // them and the edges fall back to live floating lines.
  const [routes, setRoutes] = useState<Record<string, Array<{ x: number; y: number }>>>({});
  // Auto-layout bookkeeping: tidy a freshly-generated/opened graph ONCE it's
  // measured, but never fight the operator once they've dragged a node.
  const arrangedFor = useRef("");
  const userDragged = useRef(false);
  // Dragging a node opts this graph out of auto-arrange until its entity set
  // next changes (a rename/add/remove or a regeneration) — and invalidates the
  // routed edge paths, which described the pre-drag geometry.
  const handleNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (changes.some((c) => c.type === "position" && c.dragging)) {
      userDragged.current = true;
      setRoutes((current) => (Object.keys(current).length ? {} : current));
    }
    onNodesChange(changes);
  }, [onNodesChange]);

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

  // The arrange: ELK's layered layout with MEASURED node boxes — overlap-free
  // node positions AND orthogonal edge routes that steer around nodes with
  // crossing minimisation, so edges stop slicing through entities or piling
  // onto each other. Falls back to the sync layered layout (nodes only,
  // floating edges) if the lazy ELK chunk cannot load.
  const rearrange = useCallback(async () => {
    const current = flowRef.current?.getNodes() ?? [];
    const sizeOf = (id: string) => {
      const node = current.find((n) => n.id === id);
      return {
        width: node?.measured?.width ?? node?.width ?? 170,
        height: node?.measured?.height ?? node?.height ?? 48,
      };
    };
    const allIds = [...ids, ...ghostIds];
    const links = relations
      .map((relation, index) => ({ id: `rel-${index}`, source: String(relation.from ?? ""), target: String(relation.to ?? "") }))
      .filter((edge) => edge.source && edge.target && edge.source !== edge.target
        && ids.includes(edge.source) && ids.includes(edge.target));
    // Ghost edges join the layout too, so ELK parks each candidate next to the
    // entity it would attach to instead of in a detached island.
    if (ghostIds.length) {
      candidates.forEach((candidate, ci) => {
        const candidateName = asText(candidate.name);
        asArray(candidate.relations).map(asRecord).forEach((relation, ri) => {
          const source = ghostEdgeEnd(asText(relation.from), candidateName);
          const target = ghostEdgeEnd(asText(relation.to), candidateName);
          if (allIds.includes(source) && allIds.includes(target) && source !== target) {
            links.push({ id: `cedge-${ci}-${ri}`, source, target });
          }
        });
      });
    }
    try {
      const { positions, routes: nextRoutes } = await elkGraphLayout(allIds.map((id) => ({ id, ...sizeOf(id) })), links);
      setNodes((nodesNow) => nodesNow.map((node) => ({ ...node, position: positions[node.id] ?? node.position })));
      setRoutes(nextRoutes);
    } catch {
      setNodes((nodesNow) => {
        const sizes: Record<string, { width: number; height: number }> = {};
        for (const node of nodesNow) {
          const width = node.measured?.width ?? node.width;
          const height = node.measured?.height ?? node.height;
          if (width && height) sizes[node.id] = { width, height };
        }
        const positions = layeredPositions(
          ids,
          relations.map((relation) => ({ from: String(relation.from ?? ""), to: String(relation.to ?? "") })),
          { sizes, y: 170, gapX: 84 },
        );
        return nodesNow.map((node) => ({ ...node, position: positions[node.id] ?? node.position }));
      });
      setRoutes({});
    }
    // Re-frame on the tidied graph once the new positions have painted.
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, duration: 400 }));
  }, [ids, relations, ghostIds, candidates, ghostEdgeEnd, setNodes]);

  // A new entity set (fresh generation, or an add/remove/rename) re-opts the
  // graph into auto-arrange — the operator's hand-positioning applied to the
  // PREVIOUS set, not this one.
  const idKey = ids.join(" ");
  // A relation change re-arranges too (the routes moved with it), but only an
  // entity-set change clears the drag opt-out.
  const layoutKey = idKey + "#" + relations.map((relation) => String(relation.from ?? "") + ">" + String(relation.to ?? "")).join(",") + "~" + ghostIds.join(",");
  useEffect(() => { userDragged.current = false; }, [idKey]);
  useEffect(() => { arrangedFor.current = ""; }, [layoutKey]);
  // The doc moved underneath the routed edge paths: they describe the OLD
  // graph. Drop them (edges fall back to floating) until the next arrange.
  useEffect(() => { setRoutes((current) => (Object.keys(current).length ? {} : current)); }, [layoutKey]);
  // Auto-run the sized, crossing-minimised layout ONCE per entity set — as soon
  // as React Flow has measured every node (so rows pack by real width and never
  // overlap) — unless the operator has already dragged a node. Replaces the old
  // behaviour where the graph opened in the inferior fixed-slot seed layout
  // until the operator clicked "Arrange".
  useEffect(() => {
    if (!ids.length || userDragged.current || arrangedFor.current === layoutKey) return;
    const measured = [...ids, ...ghostIds].every((id) => { const n = nodes.find((x) => x.id === id); return !!(n && (n.measured?.width ?? n.width)); });
    if (!measured) return;
    arrangedFor.current = layoutKey;
    void rearrange();
  }, [ids, ghostIds, layoutKey, nodes, rearrange]);

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
          className: `v3fs-onto-node${selected?.kind === "entity" && selected.id === id ? " selected" : ""}${focusIds && focusIds.has(id) && selectedEntityId !== id ? " related" : ""}${focusIds && !focusIds.has(id) ? " dimmed" : ""}`,
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
      }).concat(showCandidates ? candidates.map((candidate, index) => {
        // Ghost node: a demoted standard class riding as a question. Dashed,
        // muted, read-only — solid means asserted, dashed means asked.
        const name = asText(candidate.name);
        const id = CAND_PREFIX + name;
        const prev = prevById.get(id);
        return {
          ...(prev ?? {}),
          id,
          position: prev?.position ?? { x: 220 * index - 60, y: 320 },
          className: `v3fs-onto-node candidate${selected?.kind === "candidate" && selected.id === id ? " selected" : ""}${focusIds ? " dimmed" : ""}`,
          style: { borderStyle: "dashed", opacity: 0.66 },
          connectable: false,
          data: {
            label: (
              <div className="v3fs-onto-nl">
                <b>{name}</b>
                <span className="v3fs-onto-std">to confirm · {asText(candidate.vocabulary) || "standard"}</span>
              </div>
            ),
          },
        } as Node;
      }) : []);
    });
  }, [entities, ids, relations, adopted, candidates, showCandidates, selected, selectedEntityId, focusIds, setNodes]);

  const edges: Edge[] = useMemo(() => relations.map((relation, index) => {
    const cardinality = asText(relation.cardinality);
    const from = asText(relation.from), to = asText(relation.to);
    const touchesFocus = selectedEntityId != null && (from === selectedEntityId || to === selectedEntityId);
    // An edge with a current ELK route draws that exact polyline (routed
    // around nodes, crossings minimised); without one it falls back to the
    // live floating line.
    const route = routes[`rel-${index}`];
    return {
      id: `rel-${index}`,
      type: route ? "routed" : "floating",
      ...(route ? { data: { points: route } } : {}),
      selected: selected?.kind === "relation" && selected.index === index,
      source: from,
      target: to,
      label: `${asText(relation.relation) || "relates to"}${cardinality && cardinality !== "unknown" ? ` · ${cardinality}` : ""}`,
      className: `v3fs-onto-edge${selected?.kind === "relation" && selected.index === index ? " selected" : ""}${selectedEntityId ? (touchesFocus ? " related" : " dimmed") : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    } as Edge;
  }).concat(showCandidates ? candidates.flatMap((candidate, ci) => {
    const candidateName = asText(candidate.name);
    return asArray(candidate.relations).map(asRecord).map((relation, ri) => {
      const source = ghostEdgeEnd(asText(relation.from), candidateName);
      const target = ghostEdgeEnd(asText(relation.to), candidateName);
      const route = routes[`cedge-${ci}-${ri}`];
      return {
        id: `cedge-${ci}-${ri}`,
        type: route ? "routed" : "floating",
        ...(route ? { data: { points: route } } : {}),
        source,
        target,
        label: asText(relation.relation) || "relates to",
        className: `v3fs-onto-edge candidate${selectedEntityId ? " dimmed" : ""}`,
        style: { strokeDasharray: "6 4", opacity: 0.55 },
        labelStyle: { opacity: 0.65 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      } as Edge;
    });
  }) : []), [relations, routes, selected, selectedEntityId, candidates, showCandidates, ghostEdgeEnd]);

  const patch = (next: Partial<Record<string, unknown>>) => onChange({ ...doc, ...next });

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // A self-relation says nothing an attribute can't — and it knots the layout.
    if (connection.source === connection.target) return;
    // Ghosts are questions, not entities — a relation cannot land on one.
    if (connection.source.startsWith(CAND_PREFIX) || connection.target.startsWith(CAND_PREFIX)) return;
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
        {/* The flow viewport starts BELOW the toolbar band, so an arranged
            graph can never slide under the buttons. */}
        <div className="v3fs-onto-flowwrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={ROUTED_EDGE_TYPES}
          onNodesChange={handleNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelected(node.id.startsWith(CAND_PREFIX) ? { kind: "candidate", id: node.id } : { kind: "entity", id: node.id })}
          onEdgeClick={(_, edge) => { if (!edge.id.startsWith("cedge-")) setSelected({ kind: "relation", index: Number(edge.id.replace("rel-", "")) }); }}
          onPaneClick={() => setSelected(null)}
          onInit={(instance) => { flowRef.current = instance; }}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.1 }}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={!locked}
          nodesDraggable={!locked}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        </div>
        <div className="v3fs-onto-toolbar">
          {locked ? null : <button type="button" className="v3fs-btn" onClick={addEntity}>＋ Add entity</button>}
          <button type="button" className="v3fs-btn" onClick={() => void rearrange()} title="Re-apply the routed layout — no overlaps, edges steered around entities, fewest crossings">⌗ Arrange</button>
          {/* The honest inventory: what the DOCUMENT holds, regardless of what
              the viewport or focus mode currently shows. If this reads low,
              the data shrank; if it reads full while the canvas looks empty,
              it's a display state (focus/zoom), never data loss. */}
          <span className="v3fs-onto-count">{entities.length} entit{entities.length === 1 ? "y" : "ies"} · {relations.length} relation{relations.length === 1 ? "" : "s"}{candidates.length ? ` · ${candidates.length} to confirm` : ""}</span>
          {candidates.length ? (
            <button type="button" className="v3fs-btn" onClick={() => setShowCandidates((v) => !v)}
              title="Entities the industry standard suggests but the sponsor has not confirmed — dashed means suggested, solid means confirmed in the model">
              {showCandidates ? "◌ Hide suggested entities" : `◌ Show suggested entities (${candidates.length})`}
            </button>
          ) : null}
        </div>
        {/* Focus mode is a spotlight, not a filter — say so while it's on. */}
        {selectedEntityId ? (
          <button type="button" className="v3fs-onto-focus" onClick={() => setSelected(null)}>
            Focused on <b>{selectedEntityId}</b> — showing its direct relationships; the rest is dimmed, not gone. Click to show all.
          </button>
        ) : null}
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
            {/* Explicit relation creation — same result as dragging node-to-
                node on the canvas, but discoverable: pick the target entity
                and the new relation opens in this panel to be named. */}
            {locked ? null : <SelectField label="Add relation to…" value=""
              options={["", ...ids.filter((entityName) => entityName !== asText(selectedEntity.name))]}
              onChange={(target) => {
                if (!target) return;
                const next = [...relations, { from: asText(selectedEntity.name), relation: "relates to", to: target, cardinality: "unknown" }];
                patch({ relations: next });
                setSelected({ kind: "relation", index: next.length - 1 });
              }} />}
            {locked ? null : <p className="v3fs-onto-hint">…or drag from this entity’s edge dot to another entity on the canvas.</p>}
            {locked ? null : <button type="button" className="v3fs-btn danger" onClick={() => deleteEntity(selectedEntityIndex)}>
              Delete entity
            </button>}
          </>
        ) : selectedRelation && selected?.kind === "relation" ? (
          <>
            <div className="v3fs-stu-sec-h"><h3>Relation</h3><span>{asText(selectedRelation.from)} → {asText(selectedRelation.to)}</span></div>
            <TextField label="Relation (verb phrase)" value={asText(selectedRelation.relation)}
              onChange={(next) => updateRelation(selected.index, { relation: next })} />
            <SelectField label="Cardinality" value={asText(selectedRelation.cardinality) || "unknown"} options={CARDINALITIES}
              onChange={(next) => updateRelation(selected.index, { cardinality: next })} />
            {locked ? null : <button type="button" className="v3fs-btn danger" onClick={() => deleteRelation(selected.index)}>
              Delete relation
            </button>}
          </>
        ) : selected?.kind === "candidate" ? (() => {
          const candidate = candidates.find((c) => CAND_PREFIX + asText(c.name) === selected.id);
          if (!candidate) return <div className="v3fs-stu-empty">This entity is no longer suggested.</div>;
          const gapList = asStrings(doc.gaps);
          const ask = gapList.find((gap) => gap.includes(`"${asText(candidate.name)}"`));
          return (
            <>
              <div className="v3fs-stu-sec-h"><h3>Suggested entity</h3><span>from the industry standard — awaiting the sponsor&rsquo;s confirmation</span></div>
              <p><b>{asText(candidate.name)}</b>{asText(candidate.vocabulary) ? <> · {asText(candidate.vocabulary)}</> : null}</p>
              <p style={{ opacity: 0.85 }}>{asText(candidate.definition)}</p>
              {asText(candidate.uri) ? <p><a href={asText(candidate.uri)} target="_blank" rel="noreferrer">{asText(candidate.uri)}</a></p> : null}
              <p style={{ opacity: 0.8 }}>
                {asText(candidate.reason) === "below-consensus"
                  ? "Some generation drafts modelled this and others did not — it needs the sponsor's confirmation before it becomes part of the model."
                  : "The industry standard defines this class, but the mandate has not confirmed it — it rides as a question, not a fact."}
              </p>
              {ask ? <p className="v3fs-onto-hint">{ask}</p> : null}
              <p className="v3fs-onto-hint">To adopt it: answer the gap below (route it to its owner), then add it as an entity — or regenerate once Listen evidence names it.</p>
            </>
          );
        })() : (
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
        {/* Ambiguities (duplicated the open Gaps) and Standards alignment are
            hidden from the studio — the Gaps table below is the one place open
            questions get triaged and redirected. */}
        <Section label="Gaps" hint="entities referenced but never defined — redirect each to the stakeholder or role who can close it">
          <GapRoutingEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} program={program}
            movementId="listen" gapRoutes={gapRoutes} onRoute={onRouteGap} addLabel="Add gap" emptyHint="No gaps." />
        </Section>
      </div>
    </div>
  );
}
