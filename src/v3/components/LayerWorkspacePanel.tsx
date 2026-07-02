import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import {
  buildLayerMaturityModel,
  type LayerGroup,
  type LayerMaturity,
  type LayerStatus,
} from "@/v3/lib/layerMaturity";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";

/**
 * Layer Stack workspace — renders buildLayerMaturityModel as the ATOS architecture
 * expressed as *workspaces that accrete as a programme advances through the
 * methodology*. The 6 buildable knowledge-plane layers (Context … Analytics) show
 * live maturity (locked → seeding → populated → healthy) computed from the
 * programme's selectors; the shell/cognition/substrate layers carry a fixed tag.
 * Each buildable layer deep-links into the workspace where its content lives.
 *
 * Pure presentation over the selector — reads no storage, mutates nothing.
 */

const GROUP_LABEL: Record<LayerGroup, string> = {
  shell: "Shell — the application itself",
  knowledge: "Knowledge plane — built up as the programme progresses",
  cognition: "Cognition — runtime intelligence",
  substrate: "Substrate — the platform",
};

const GROUP_ORDER: LayerGroup[] = ["shell", "cognition", "knowledge", "substrate"];

/** Status → chip colour + human label. */
const STATUS_META: Record<LayerStatus, { chip: string; label: string }> = {
  locked: { chip: "muted", label: "Locked" },
  seeding: { chip: "amber", label: "Seeding" },
  populated: { chip: "blue", label: "Populated" },
  healthy: { chip: "green", label: "Healthy" },
  shell: { chip: "muted", label: "Shell" },
  runtime: { chip: "muted", label: "Runtime" },
  platform: { chip: "muted", label: "Platform" },
};

/**
 * Map a layer's declarative deepLink to a routable More-view. Only knowledge
 * layers whose content lives in an existing workspace get a jump button; the rest
 * (agent-trace, insights) have no More-view home and are left as read-only.
 */
const DEEPLINK_TO_MOREVIEW: Record<string, V3MoreView> = {
  graph: "program-graph",
  ontology: "ontology",
  artifacts: "artifact-map",
};

interface LayerWorkspacePanelProps {
  program: ProgramSummary | null;
  onOpenMoreView?: (view: V3MoreView) => void;
}

function StatusChip({ status }: { status: LayerStatus }) {
  const meta = STATUS_META[status];
  return <span className={`v3-chip ${meta.chip}`} style={{ fontSize: 10 }}>{meta.label}</span>;
}

function LayerRow({
  layer,
  onOpenMoreView,
}: {
  layer: LayerMaturity;
  onOpenMoreView?: (view: V3MoreView) => void;
}) {
  const jumpTo = layer.deepLink ? DEEPLINK_TO_MOREVIEW[layer.deepLink] : undefined;
  const canJump = Boolean(jumpTo && onOpenMoreView && layer.buildable);
  const accent =
    layer.status === "healthy" ? "success"
    : layer.status === "populated" ? "info"
    : layer.status === "seeding" ? "warning"
    : "none";

  return (
    <AdamCard accent={accent} className="v3-layer-row" onClick={canJump ? () => onOpenMoreView!(jumpTo!) : undefined}>
      <AdamCardBody>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{layer.label}</span>
              <StatusChip status={layer.status} />
              {canJump ? <span className="v3-chip blue" style={{ fontSize: 10 }}>Open ›</span> : null}
            </div>
            <p style={{ fontSize: 12, color: "var(--v3-text-muted)", margin: 0 }}>{layer.description}</p>
          </div>
          {layer.buildable ? (
            <div style={{ display: "flex", gap: 14, flexShrink: 0, textAlign: "right" }}>
              <Metric label="Items" value={layer.populated} />
              <Metric label="Gaps" value={layer.gaps} warn={layer.gaps > 0} />
              <Metric label="Quality" value={layer.quality == null ? "—" : `${layer.quality}%`} />
            </div>
          ) : null}
        </div>
        {layer.buildable && layer.contributingPhases.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "var(--v3-text-muted)", alignSelf: "center" }}>Fed by</span>
            {layer.contributingPhases.map((phase) => (
              <span key={phase} className="v3-chip muted" style={{ fontSize: 10 }}>{phase}</span>
            ))}
          </div>
        ) : null}
      </AdamCardBody>
    </AdamCard>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 44 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: warn ? "var(--v3-amber)" : "var(--v3-text)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--v3-text-muted)" }}>{label}</div>
    </div>
  );
}

export default function LayerWorkspacePanel({ program, onOpenMoreView }: LayerWorkspacePanelProps) {
  const model = useMemo(() => buildLayerMaturityModel(program), [program]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        layers: model.layers.filter((l) => l.group === group),
      })).filter((g) => g.layers.length > 0),
    [model],
  );

  const { summary } = model;

  return (
    <div className="v3-section" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdamCard>
        <AdamCardHeader
          title="Layer Stack"
          subtitle="The ATOS architecture as workspaces that build up as the programme clears its methodology gates. The six knowledge-plane layers accrete content; the rest are shell, runtime and platform."
        />
        <AdamCardBody>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            <Metric label="Buildable layers" value={summary.buildableTotal} />
            <Metric label="Healthy" value={summary.healthy} />
            <Metric label="Populated" value={summary.populated} />
            <Metric label="Seeding" value={summary.seeding} />
            <Metric label="Locked" value={summary.locked} />
          </div>
        </AdamCardBody>
      </AdamCard>

      {grouped.map(({ group, layers }) => (
        <section key={group}>
          <h2
            className="v3-workspace-group-label"
            style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--v3-text-muted)", margin: "0 0 8px" }}
          >
            {GROUP_LABEL[group]}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {layers.map((layer) => (
              <LayerRow key={layer.id} layer={layer} onOpenMoreView={onOpenMoreView} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
