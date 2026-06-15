/**
 * Artifact Map — the complete programme artifact tree.
 *
 * The tree nests strictly by drill-down depth:
 *
 *   Phase → Artifact → Input → Source / evidence
 *
 * A phase lists the artifacts the methodology requires of it; each artifact
 * expands to the phase inputs that feed it; each input expands to its source /
 * evidence (the value provided, or the provenance of the artifact). Every
 * branch collapses independently, with expand/collapse-all controls.
 *
 * It is a pure selector over normalised programme data (artifactModel +
 * phaseInputSchema), so it stays deterministic and needs no backend.
 */
import React from "react";
import type { ProgramSummary } from "@/new/types";
import { buildArtifactModel, type ArtifactNode } from "@/v3/lib/artifactModel";
import { getPhaseInputSchema, type PhaseInputField } from "@/v3/lib/phaseInputSchema";

type Tone = "good" | "warning" | "muted";

const TONE_COLOR: Record<Tone, string> = {
  good: "var(--v3-green)",
  warning: "var(--v3-amber)",
  muted: "var(--v3-text-muted)",
};

interface Tag {
  text: string;
  variant?: "req" | "muted" | "subtle";
  color?: string;
}

interface TreeNodeData {
  key: string;
  label: string;
  tone: Tone;
  tags?: Tag[];
  /** Sub-text rendered under the label (provenance / value / hint). */
  detail?: string | null;
  detailSubtle?: boolean;
  children?: TreeNodeData[];
}

/** Read the persisted phase inputs map, tolerating both rawData shapes. */
function readPhaseInputs(program: ProgramSummary, phaseId: string): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const source = typeof raw.data === "object" && raw.data !== null
    ? (raw.data as Record<string, unknown>)
    : raw;
  const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
    ? (source.phaseInputs as Record<string, Record<string, unknown>>)
    : {};
  return phaseInputs[phaseId] ?? {};
}

function valuePreview(value: unknown): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function artifactTone(node: ArtifactNode): Tone {
  if (!node.present) return node.required ? "warning" : "muted";
  if (node.state === "approved" || node.state === "ready") return "good";
  return "warning";
}

function artifactStatusLabel(node: ArtifactNode): string {
  if (!node.present) return node.required ? "Missing" : "Optional";
  return node.state.charAt(0).toUpperCase() + node.state.slice(1);
}

function collectKeys(nodes: TreeNodeData[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      acc.push(node.key);
      collectKeys(node.children, acc);
    }
  }
  return acc;
}

function TreeNode({
  node,
  expanded,
  onToggle,
}: {
  node: TreeNodeData;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}) {
  const hasChildren = !!node.children && node.children.length > 0;
  const open = expanded.has(node.key);
  return (
    <div className="v3-amap-node">
      <button
        type="button"
        className="v3-amap-row"
        onClick={() => hasChildren && onToggle(node.key)}
        disabled={!hasChildren}
      >
        <span className={`v3-amap-caret${hasChildren ? "" : " is-leaf"}`}>
          {hasChildren ? (open ? "▾" : "▸") : "•"}
        </span>
        <span className="v3-amap-dot" style={{ background: TONE_COLOR[node.tone] }} />
        <span className="v3-amap-node-body">
          <span className="v3-amap-node-top">
            <span className="v3-amap-node-label">{node.label}</span>
            {node.tags?.map((tag, i) => (
              <span
                key={i}
                className={`v3-amap-tag${tag.variant ? ` ${tag.variant}` : ""}`}
                style={tag.color ? { color: tag.color } : undefined}
              >
                {tag.text}
              </span>
            ))}
          </span>
          {node.detail ? (
            <span className={`v3-amap-node-detail${node.detailSubtle ? " subtle" : ""}`}>{node.detail}</span>
          ) : null}
        </span>
      </button>
      {hasChildren && open ? (
        <div className="v3-amap-children">
          {node.children!.map((child) => (
            <TreeNode key={child.key} node={child} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ArtifactMapTree({ program }: { program: ProgramSummary | null }) {
  const model = React.useMemo(() => buildArtifactModel(program), [program]);

  const tree = React.useMemo<TreeNodeData[]>(() => {
    if (!program) return [];
    return model.phases.map((phase) => {
      const fields: PhaseInputField[] = getPhaseInputSchema(phase.phaseId).fields;
      const values = readPhaseInputs(program, phase.phaseId);
      const inputs = fields.map((field) => {
        const preview = valuePreview(values[field.id]);
        return { field, preview, filled: preview != null };
      });
      const inputsFilled = inputs.filter((i) => i.filled).length;

      const phaseKey = `phase:${phase.phaseId}`;
      const phaseTone: Tone = phase.missing === 0 ? "good" : phase.present > 0 ? "warning" : "muted";

      // Input nodes are shared across this phase's artifacts (they are the
      // source context the phase's artifacts are generated from).
      const buildInputNodes = (artifactKey: string): TreeNodeData[] =>
        inputs.map(({ field, preview, filled }) => {
          const inputKey = `${artifactKey}>in:${field.id}`;
          const tags: Tag[] = [];
          if (field.required) tags.push({ text: "Required", variant: "req" });
          if (!filled) tags.push({ text: "Not provided", variant: "muted" });
          return {
            key: inputKey,
            label: field.label,
            tone: filled ? "good" : field.required ? "warning" : "muted",
            tags,
            children: [
              {
                key: `${inputKey}>src`,
                label: "Source / evidence",
                tone: filled ? "good" : "muted",
                detail: preview ?? (field.hint ? `No value yet — ${field.hint}` : "Not provided"),
                detailSubtle: !filled,
              },
            ],
          };
        });

      const artifactNodes: TreeNodeData[] = phase.artifacts.map((node) => {
        const tone = artifactTone(node);
        const artifactKey = `${phaseKey}>art:${node.key}`;
        const tags: Tag[] = [{ text: artifactStatusLabel(node), color: TONE_COLOR[tone] }];
        if (!node.required) tags.push({ text: "Extra", variant: "muted" });
        if (node.quality != null) tags.push({ text: `${node.quality}%`, variant: "subtle" });
        return {
          key: artifactKey,
          label: node.label,
          tone,
          tags,
          detail: node.evidence ?? (node.present ? null : "Not yet produced for this phase."),
          detailSubtle: !node.present,
          children: buildInputNodes(artifactKey),
        };
      });

      const phaseTags: Tag[] = [{ text: `${phase.present}/${phase.required} artifacts`, variant: "subtle" }];
      if (fields.length > 0) phaseTags.push({ text: `${inputsFilled}/${fields.length} inputs`, variant: "subtle" });
      if (phase.avgQuality != null) phaseTags.push({ text: `${phase.avgQuality}% quality`, variant: "subtle" });

      return {
        key: phaseKey,
        label: phase.phaseLabel,
        tone: phaseTone,
        tags: phaseTags,
        children: artifactNodes,
      };
    });
  }, [program, model.phases]);

  const phaseKeys = React.useMemo(() => tree.map((n) => n.key), [tree]);
  const allKeys = React.useMemo(() => collectKeys(tree), [tree]);

  // Default: phase branches open, deeper levels collapsed — scannable overview.
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    setExpanded(new Set(phaseKeys));
  }, [phaseKeys]);

  const toggle = React.useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!program || tree.length === 0) {
    return <div className="v3-context-artifacts-empty">No artifact tree for this programme yet.</div>;
  }

  return (
    <div className="v3-amap">
      <div className="v3-amap-toolbar">
        <span className="v3-amap-totals">
          <strong>{model.totals.present}</strong> of <strong>{model.totals.required}</strong> required artifacts present
          {model.totals.avgQuality != null ? <> · <strong>{model.totals.avgQuality}%</strong> avg quality</> : null}
          {" "}across <strong>{tree.length}</strong> phases
        </span>
        <div className="v3-amap-toolbar-actions">
          <button type="button" className="v3-button ghost" onClick={() => setExpanded(new Set(allKeys))}>
            Expand all
          </button>
          <button type="button" className="v3-button ghost" onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        </div>
      </div>

      <div className="v3-amap-tree">
        {tree.map((node) => (
          <div key={node.key} className="v3-amap-phase">
            <TreeNode node={node} expanded={expanded} onToggle={toggle} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ArtifactMapTree;
