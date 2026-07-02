import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import type { DocumentIntelligence } from "@/new/lib/documentIntelligenceTypes";
import { getDocumentDetail, useDocumentAttachments } from "@/new/lib/useDocumentAttachments";
import {
  buildProgramGraph,
  type ProgramDocument,
  type ProgramGraphNodeKind,
} from "@/v3/lib/programGraph";
import { fingerprintGraph } from "@/v3/lib/graphFingerprint";
import {
  reviewGraphChanges,
  commitGraphSnapshot,
  type GraphChangeSummary,
} from "@/v3/lib/graphChangeLog";
import { TransformationTwinGraph } from "@/new/components/ui/TransformationTwinGraph";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";

/**
 * Program Graph workspace — renders buildProgramGraph (the unified document →
 * fact → phase → artifact lineage) through the existing TransformationTwinGraph
 * canvas. The graph node/edge shapes already match the canvas reader; the only
 * translation is the node kind → display type, which selects the canvas lane and
 * colour. Documents are loaded with their full extracted_data so the entities the
 * extractor found but never mapped to a phase field surface as `insight` nodes.
 */
const KIND_TO_DISPLAY: Record<ProgramGraphNodeKind, string> = {
  phase: "Phase",
  fact: "Fact",
  document: "Source",
  artifact: "Artifact",
  kpi: "KPI",
  risk: "Risk",
  decision: "Decision",
  stakeholder: "Stakeholder",
  insight: "Insight",
  requirement: "Requirement",
  scope: "Scope",
  increment: "Increment",
};

interface ProgramGraphPanelProps {
  program: ProgramSummary | null;
  programId: string | null;
}

export default function ProgramGraphPanel({ program, programId }: ProgramGraphPanelProps) {
  const { data: docSummaries } = useDocumentAttachments(programId);
  const [documents, setDocuments] = useState<ProgramDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!programId || !docSummaries.length) {
        setDocuments([]);
        return;
      }
      const details = await Promise.all(
        docSummaries.map(async (summary) => {
          try {
            const detail = await getDocumentDetail(programId, summary.id);
            const intel = detail.extracted_data as DocumentIntelligence | null;
            // Meeting-notes rows and failed extractions store a different shape;
            // keep only documents whose extracted_data is a DocumentIntelligence.
            if (!intel || typeof intel !== "object" || !("documentType" in intel)) return null;
            return { id: summary.id, fileName: detail.file_name, intelligence: intel } as ProgramDocument;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) setDocuments(details.filter((d): d is ProgramDocument => d !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, docSummaries]);

  // Canvas height tracks the viewport so the graph gets more room as it grows,
  // rather than being pinned to a fixed height regardless of how many phases the
  // programme has accumulated.
  const [canvasHeight, setCanvasHeight] = useState(() =>
    typeof window === "undefined" ? 760 : Math.max(560, window.innerHeight - 280),
  );
  useEffect(() => {
    const onResize = () => setCanvasHeight(Math.max(560, window.innerHeight - 280));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const graph = useMemo(() => buildProgramGraph(program, documents), [program, documents]);

  // Run-over-run change surface: diff the current graph against the device-local
  // baseline (the last fingerprint this browser saw for this programme), show a
  // "since your last view" banner, then advance the baseline. Keyed on the
  // fingerprint hash so it only fires when the graph's shape actually changed —
  // review is idempotent (does not persist), commit advances the baseline.
  const fingerprint = useMemo(() => fingerprintGraph(graph), [graph]);
  const [changeSummary, setChangeSummary] = useState<GraphChangeSummary | null>(null);
  useEffect(() => {
    if (!programId || !graph.stats.nodeCount) return;
    const summary = reviewGraphChanges(programId, graph);
    setChangeSummary(summary.changed ? summary : null);
    commitGraphSnapshot(programId, graph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, fingerprint.hash]);

  const twinGraph = useMemo(
    () => ({
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        type: KIND_TO_DISPLAY[node.type],
        label: node.label,
        status: typeof node.properties?.status === "string" ? (node.properties.status as string) : undefined,
        phaseCreated: node.phaseCreated,
        confidence: node.confidence,
        properties: node.properties,
      })),
      edges: graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })),
    }),
    [graph],
  );

  const stats = graph.stats;

  return (
    <div className="v3-section">
      <AdamCard>
        <AdamCardHeader
          title="Program graph"
          subtitle="The unified knowledge graph — documents, the facts extracted from them, the phases they inform, and the artifacts they ground. Everything earlier phases produced flows forward here."
          badge={
            stats.nodeCount ? (
              <span className="v3-chip muted" style={{ fontSize: 11 }}>
                {stats.nodeCount} nodes · {stats.edgeCount} edges
              </span>
            ) : undefined
          }
        />
        <AdamCardBody>
          {stats.nodeCount ? (
            <>
              {changeSummary ? (
                <GraphChangeBanner summary={changeSummary} onDismiss={() => setChangeSummary(null)} />
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <StatChip label="Documents" value={stats.documentCount} />
                <StatChip label="Facts" value={stats.byKind.fact} />
                <StatChip label="Insights" value={stats.byKind.insight} />
                <StatChip label="Artifacts" value={stats.byKind.artifact} />
                <StatChip label="KPIs" value={stats.byKind.kpi} />
                <StatChip label="Open risks" value={stats.byKind.risk} />
                <StatChip label="Open decisions" value={stats.byKind.decision} />
                {stats.orphanFacts ? <StatChip label="Ungrounded facts" value={stats.orphanFacts} tone="warn" /> : null}
              </div>
              <TransformationTwinGraph
                twinGraph={twinGraph}
                height={canvasHeight}
                minZoom={0.15}
                fitViewKey={`${stats.nodeCount}:${stats.edgeCount}`}
              />
            </>
          ) : (
            <EmptyState
              compact
              icon="◌"
              title="No graph yet"
              description="Import a document or complete a phase to populate the program graph."
            />
          )}
        </AdamCardBody>
      </AdamCard>
    </div>
  );
}

function GraphChangeBanner({ summary, onDismiss }: { summary: GraphChangeSummary; onDismiss: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "10px 12px",
        marginBottom: 12,
        borderRadius: 8,
        border: "1px solid rgba(37,99,235,0.28)",
        background: "rgba(37,99,235,0.06)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>{summary.headline}</div>
        {summary.details.length ? (
          <ul style={{ margin: "6px 0 0", padding: "0 0 0 16px", fontSize: 11.5, color: "#334155" }}>
            {summary.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss change summary"
        style={{
          flexShrink: 0,
          border: "none",
          background: "transparent",
          color: "#64748b",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <span
      className="v3-chip muted"
      style={{
        fontSize: 11,
        color: tone === "warn" ? "#b45309" : undefined,
        borderColor: tone === "warn" ? "rgba(180,83,9,0.35)" : undefined,
      }}
    >
      {label}: {value}
    </span>
  );
}
