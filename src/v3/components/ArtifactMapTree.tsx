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
import { buildFactGraph, type FactSourceType } from "@/v3/lib/factGraph";

// ─── Cross-surface focus request ─────────────────────────────────────────────
// The Traceability panel (StageView) lets a user jump from a fact straight to
// its node in the full artifact map. Because the map mounts fresh when the view
// switches, we stash the request module-side and fire an event: a freshly
// mounted tree reads the pending request on mount, while an already-mounted tree
// re-focuses on the event. The request is single-shot — consumed once read.

const ARTIFACT_MAP_FOCUS_EVENT = "v3-artifact-map-focus";

type ArtifactMapFocusRequest = { phaseId: string; inputId: string };

let pendingArtifactMapFocus: ArtifactMapFocusRequest | null = null;

/** Request the full artifact map to expand + highlight a phase input's nodes. */
export function requestArtifactMapFocus(phaseId: string, inputId: string) {
  pendingArtifactMapFocus = { phaseId, inputId };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ArtifactMapFocusRequest>(ARTIFACT_MAP_FOCUS_EVENT, { detail: { phaseId, inputId } }));
  }
}

function consumeArtifactMapFocus(): ArtifactMapFocusRequest | null {
  const req = pendingArtifactMapFocus;
  pendingArtifactMapFocus = null;
  return req;
}

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
  /** Right-aligned child-count hint shown on expandable rows. */
  count?: string;
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

function valuePreview(value: unknown, max = 160): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : String(value);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

/** Ancestor keys for a `a>b>c` tree key (excludes the key itself). */
function ancestorKeys(key: string): string[] {
  const parts = key.split(">");
  const acc: string[] = [];
  for (let i = 1; i < parts.length; i++) acc.push(parts.slice(0, i).join(">"));
  return acc;
}

/**
 * Resolve a focus request to the input-node keys it should highlight (the same
 * input appears under each artifact of the phase) plus every ancestor that must
 * be expanded to reveal them.
 */
function resolveFocusKeys(
  allKeys: string[],
  phaseId: string,
  inputId: string,
): { focus: string[]; expand: string[] } {
  const phasePrefix = `phase:${phaseId}>`;
  const inputSuffix = `>in:${inputId}`;
  const focus = allKeys.filter((k) => k.startsWith(phasePrefix) && k.endsWith(inputSuffix));
  const expand = new Set<string>();
  for (const k of focus) for (const a of ancestorKeys(k)) expand.add(a);
  return { focus, expand: [...expand] };
}

function TreeNode({
  node,
  expanded,
  onToggle,
  focusedKeys,
}: {
  node: TreeNodeData;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  focusedKeys: Set<string>;
}) {
  const hasChildren = !!node.children && node.children.length > 0;
  const open = expanded.has(node.key);
  const isFocused = focusedKeys.has(node.key);
  return (
    <div className="v3-amap-node">
      <button
        type="button"
        className={`v3-amap-row${isFocused ? " is-focused" : ""}`}
        data-amap-key={node.key}
        onClick={() => hasChildren && onToggle(node.key)}
        disabled={!hasChildren}
      >
        <span className={`v3-amap-caret${hasChildren ? (open ? " is-open" : "") : " is-leaf"}`} aria-hidden="true">
          {hasChildren ? "❯" : "•"}
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
            {node.count ? <span className="v3-amap-count">{node.count}</span> : null}
          </span>
          {node.detail ? (
            <span className={`v3-amap-node-detail${node.detailSubtle ? " subtle" : ""}`}>{node.detail}</span>
          ) : null}
        </span>
      </button>
      {hasChildren && open ? (
        <div className="v3-amap-children">
          {node.children!.map((child) => (
            <TreeNode key={child.key} node={child} expanded={expanded} onToggle={onToggle} focusedKeys={focusedKeys} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ArtifactMapTree({
  program,
  phaseId,
}: {
  program: ProgramSummary | null;
  /** When set, render only this phase's branch (used in the phase rail). */
  phaseId?: string | null;
}) {
  const model = React.useMemo(() => buildArtifactModel(program), [program]);
  const scoped = !!phaseId;

  // Source provenance per phase-field, derived from the Fact Graph: tells each
  // input node whether its value was typed by the user or extracted from an
  // imported document, so the tree can show a "User input" / "Document" chip.
  const factSourceByField = React.useMemo(() => {
    const map = new Map<string, { sourceType: FactSourceType; sourceName: string }>();
    const graph = buildFactGraph(program);
    for (const fact of graph.facts) {
      const key = `${fact.sourceId}::${fact.factType}`;
      if (!map.has(key)) map.set(key, { sourceType: fact.sourceType, sourceName: fact.sourceName });
    }
    return map;
  }, [program]);

  const phases = React.useMemo(
    () => (phaseId ? model.phases.filter((p) => p.phaseId === phaseId) : model.phases),
    [model.phases, phaseId],
  );

  const totals = React.useMemo(() => {
    if (!scoped) return model.totals;
    const present = phases.reduce((s, p) => s + p.present, 0);
    const required = phases.reduce((s, p) => s + p.required, 0);
    const quals = phases.map((p) => p.avgQuality).filter((q): q is number => typeof q === "number");
    const avgQuality = quals.length ? Math.round(quals.reduce((a, b) => a + b, 0) / quals.length) : null;
    return { ...model.totals, present, required, avgQuality };
  }, [scoped, phases, model.totals]);

  const tree = React.useMemo<TreeNodeData[]>(() => {
    if (!program) return [];
    return phases.map((phase) => {
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
          // Show how a provided value was sourced — typed by the user or pulled
          // from an imported document — so provenance is visible at a glance. For
          // imported values, name the originating document.
          const src = filled ? factSourceByField.get(`${phase.phaseId}::${field.id}`) : undefined;
          const sourceType = src?.sourceType;
          const docName = sourceType === "imported_document"
            && src?.sourceName && src.sourceName !== "Imported document"
            ? src.sourceName
            : null;
          if (sourceType === "imported_document") {
            const chipName = docName ? (docName.length > 28 ? `${docName.slice(0, 27)}…` : docName) : null;
            tags.push({ text: chipName ? `Document · ${chipName}` : "Document", variant: "subtle", color: "var(--v3-accent)" });
          } else if (sourceType) {
            tags.push({ text: "User input", variant: "subtle" });
          }
          if (!filled) tags.push({ text: "Not provided", variant: "muted" });
          const short = preview ? (preview.length > 72 ? `${preview.slice(0, 71)}…` : preview) : null;
          const sourceLabel = sourceType === "imported_document"
            ? (docName ? `Source — ${docName}` : "Source — imported document")
            : sourceType
              ? "Source — user input"
              : "Source / evidence";
          return {
            key: inputKey,
            label: field.label,
            tone: filled ? "good" : field.required ? "warning" : "muted",
            tags,
            // Surface the value inline so it's scannable without drilling in.
            detail: short ?? (field.hint ? field.hint : "Not provided"),
            detailSubtle: !filled,
            children: [
              {
                key: `${inputKey}>src`,
                label: sourceLabel,
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
          count: fields.length > 0 ? `${fields.length} inputs` : undefined,
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
  }, [program, phases, factSourceByField]);

  const allKeys = React.useMemo(() => collectKeys(tree), [tree]);

  // Default open set: phases always; when scoped to one phase, also open its
  // artifacts so the rail shows the tree one level deep without a click.
  const defaultKeys = React.useMemo(() => {
    const keys = tree.map((n) => n.key);
    if (scoped) {
      for (const phase of tree) for (const child of phase.children ?? []) keys.push(child.key);
    }
    return keys;
  }, [tree, scoped]);

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  // Seed the open set from defaults, but only when the tree's *structure* changes
  // — not on every re-render. `program` is re-normalised to a fresh object on each
  // refresh/poll, which churns the tree/defaultKeys references; resetting on that
  // identity change would collapse whatever the user manually expanded. Gate on a
  // structural signature so refreshes that don't alter the node set leave the
  // user's expand state intact.
  const defaultKeysSig = React.useMemo(() => defaultKeys.join("|"), [defaultKeys]);
  const seededSigRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (seededSigRef.current === defaultKeysSig) return;
    seededSigRef.current = defaultKeysSig;
    setExpanded(new Set(defaultKeys));
  }, [defaultKeysSig, defaultKeys]);

  const toggle = React.useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Cross-surface focus: expand + highlight a fact's input node ──
  // Only the full map (not the scoped rail) honours focus requests. On a focus
  // request we expand the ancestor chain, mark the matching input rows, scroll
  // the first into view, then fade the highlight after a few seconds.
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [focusedKeys, setFocusedKeys] = React.useState<Set<string>>(() => new Set());
  const focusTimerRef = React.useRef<number | null>(null);

  const applyFocus = React.useCallback((req: ArtifactMapFocusRequest) => {
    if (scoped) return;
    const { focus, expand } = resolveFocusKeys(allKeys, req.phaseId, req.inputId);
    if (focus.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const k of expand) next.add(k);
      return next;
    });
    setFocusedKeys(new Set(focus));
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    // Wait for the expand to render, then scroll the first match into view.
    window.setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-amap-key="${CSS.escape(focus[0])}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    focusTimerRef.current = window.setTimeout(() => setFocusedKeys(new Set()), 5000);
  }, [scoped, allKeys]);

  // Drain a pending request on mount (view just switched in) and listen for
  // live requests while mounted.
  React.useEffect(() => {
    if (scoped) return;
    const pending = consumeArtifactMapFocus();
    if (pending) applyFocus(pending);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactMapFocusRequest>).detail;
      if (detail) applyFocus(detail);
    };
    window.addEventListener(ARTIFACT_MAP_FOCUS_EVENT, handler);
    return () => {
      window.removeEventListener(ARTIFACT_MAP_FOCUS_EVENT, handler);
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    };
  }, [scoped, applyFocus]);

  if (!program || tree.length === 0) {
    return <div className="v3-context-artifacts-empty">No artifact tree for this programme yet.</div>;
  }

  return (
    <div className={`v3-amap${scoped ? " is-scoped" : ""}`} ref={containerRef}>
      <div className="v3-amap-toolbar">
        <span className="v3-amap-totals">
          <strong>{totals.present}</strong> of <strong>{totals.required}</strong> required artifacts present
          {totals.avgQuality != null ? <> · <strong>{totals.avgQuality}%</strong> avg quality</> : null}
          {scoped ? null : <> {" "}across <strong>{tree.length}</strong> phases</>}
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
          <div key={node.key} className="v3-amap-phase" data-tone={node.tone}>
            <TreeNode node={node} expanded={expanded} onToggle={toggle} focusedKeys={focusedKeys} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ArtifactMapTree;
