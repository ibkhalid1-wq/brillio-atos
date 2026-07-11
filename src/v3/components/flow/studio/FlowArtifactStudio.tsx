/**
 * The artifact studio — the drill-down for every generated document, opened
 * from any card or Library row. Each artifact type renders its own WYSIWYG
 * editor (the ontology is a graph, the atlas a heatmap and step tables, the
 * charter structured prose); edits merge back into the generator's own shape
 * and land on the attestation trail. A typeset document view stays one tap
 * away, and artifacts with no stored structure fall back to it.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useFocusTrap } from "@/v3/lib/useFocusTrap";
import type { ProgramSummary } from "@/new/types";
import { artifactDocument, flowMovements, movementEvidence, type ArtifactCardModel, type EvidenceEntry } from "@/v3/components/flow/flowShellData";
import { groundingFor, citationGraph, resourceUri, artifactFabioType, SEMANTIC_CONTEXT } from "@/v3/components/flow/flowSemantics";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { listOpenFlowDecisions, listFlowAttestations } from "@/v3/components/flow/flowDecisions";
import { STUDIO_REGISTRY } from "./studios";
import DocumentView from "./DocumentView";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";

export interface ArtifactEditInput {
  fieldKey: string;
  movementId: string;
  title: string;
  doc: Record<string, unknown>;
}

export default function FlowArtifactStudio({ program, artifact, onClose, onRegenerate, onSaveDoc, onOpenInbox, onOpenArtifact }: {
  program: ProgramSummary;
  artifact: ArtifactCardModel;
  onClose: () => void;
  onRegenerate?: () => void;
  onSaveDoc?: (input: ArtifactEditInput) => Promise<void>;
  /** Jump to the Inbox (used when a regenerated version awaits a confirm). */
  onOpenInbox?: () => void;
  /** Open a different artifact's document (chips in studios drill through). */
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const entry = STUDIO_REGISTRY[artifact.id];
  const storedDoc = useMemo(
    () => (entry ? readArtifactDoc(program, entry.fieldKey) : null),
    [program, entry],
  );

  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(storedDoc);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Read first, everywhere: every artifact opens as the typeset document;
  // Edit flips to its form (or graph), and both Save and Discard land you
  // back on the document. One flow, no mode maze.
  // The graph-first documents open straight into their studio — the diagram
  // IS the document there, so the graphical view leads. Prose-first
  // documents keep the typeset reading view as the default.
  const GRAPH_FIRST = ["domain-ontology", "current-state-atlas", "architecture-strategy", "agentic-blueprint"];
  const [editing, setEditing] = useState(() => GRAPH_FIRST.includes(artifact.id));

  // A regenerate or portal write can refresh the programme under the open
  // studio — follow the store while the user hasn't started editing.
  useEffect(() => {
    if (!dirty) setDraft(storedDoc);
  }, [storedDoc, dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canEdit = !!entry && !!draft && !!onSaveDoc;
  const studioActive = canEdit && editing;

  const save = async () => {
    if (!entry || !draft || !onSaveDoc) return;
    setSaving(true);
    try {
      await onSaveDoc({ fieldKey: entry.fieldKey, movementId: artifact.movementId, title: artifact.title, doc: draft });
      setDirty(false);
      setEditing(false);
      window.dispatchEvent(new CustomEvent("atlas-v3-toast", {
        detail: { message: `${artifact.title} saved — the change is on the trail.`, tone: "success", duration: 3000 },
      }));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(storedDoc);
    setDirty(false);
    setEditing(false);
  };

  const body = artifactDocument(program, artifact.id);
  const blocks = useMemo(() => (body ?? "")
    .replace(/\*\*/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter(Boolean)
    .map((block) => block.split("\n").map((line) => {
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      if (heading) return { kind: "h" as const, text: heading[1] };
      const bullet = line.match(/^\s*[-•]\s+(.*)$/);
      if (bullet) return { kind: "li" as const, text: bullet[1] };
      return { kind: "p" as const, text: line };
    })), [body]);

  const grounding = useMemo(() => groundingFor(program, artifact.id, artifact.movementId), [program, artifact]);
  const movementName = useMemo(
    () => flowMovements().find((m) => m.id === artifact.movementId)?.displayName ?? artifact.movementId,
    [artifact.movementId],
  );
  // The regeneration guard queues fresh versions of hand-edited docs as
  // decisions — surface that state on the document itself.
  const regenPending = useMemo(() => {
    if (!entry) return false;
    return listOpenFlowDecisions(program).some((decision) => {
      const payload = decision.payload;
      const docs = payload && typeof payload === "object" ? (payload as Record<string, unknown>).artifactDocs : null;
      return !!docs && typeof docs === "object" && entry.fieldKey in (docs as Record<string, unknown>);
    });
  }, [program, entry]);
  const [menuOpen, setMenuOpen] = useState(false);
  // This document's history, filtered from the programme-wide trail: its
  // generations (agentId = artifact id), studio edits, and the guard's
  // propose/confirm cycle — all mention the title.
  const history = useMemo(() => listFlowAttestations(program).filter((attestation) =>
    attestation.agentId === artifact.id || (attestation.action ?? "").includes(artifact.title),
  ).slice(0, 8), [program, artifact.id, artifact.title]);
  const copyJsonLd = () => {
    const node = {
      "@context": SEMANTIC_CONTEXT,
      "@id": resourceUri(program.id, "artifact", artifact.id),
      "@type": artifactFabioType(artifact.id),
      "dcterms:title": artifact.title,
      citations: citationGraph(program),
    };
    try { void navigator.clipboard.writeText(JSON.stringify(node, null, 2)); } catch { /* ignore */ }
    setMenuOpen(false);
  };
  // groundingFor builds 1:1 over movementEvidence — row index IS the entry.
  const movementEvidenceList = useMemo(() => {
    const movement = flowMovements().find((m) => m.id === artifact.movementId);
    return movement ? movementEvidence(program, movement) : [];
  }, [program, artifact.movementId]);
  const [evidenceOpen, setEvidenceOpen] = useState<EvidenceEntry | null>(null);
  const edited = draft && typeof draft.editedAt === "string" ? String(draft.editedAt).slice(0, 10) : null;

  // Grounding lives in the colophon with the rest of the provenance.
  const groundingDisclosure = grounding.length ? (
        <details className="v3fs-disc v3fs-disc-sm v3fs-ground">
          <summary>
            <span className="v3fs-disc-l">Grounded in<em>{grounding.length}</em></span>
            <span className="v3fs-disc-hint">
              {(() => {
            const convs = grounding.filter((g) => g.kind === "conversation").length;
            const docs = grounding.filter((g) => g.kind === "document").length;
            return [
              convs ? `${convs} conversation${convs === 1 ? "" : "s"}` : null,
              docs ? `${docs} document${docs === 1 ? "" : "s"}` : null,
            ].filter(Boolean).join(" · ");
              })()}
            </span>
            <span className="v3fs-disc-c" aria-hidden="true" />
          </summary>
          <div className="v3fs-disc-b">
            {grounding.map((entry_, groundingIndex) => (
              <div key={entry_.uri} className="v3fs-ground-row v3fs-row-open" role="button" tabIndex={0}
                onClick={() => setEvidenceOpen(movementEvidenceList[groundingIndex] ?? null)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setEvidenceOpen(movementEvidenceList[groundingIndex] ?? null); }}>
                <span className={`v3fs-tag ${entry_.kind === "document" ? "gn" : "ev"}`}>{entry_.kind}</span>
                <div className="v3fs-row-g" title={`${entry_.relation} · ${entry_.uri}`}>
                  <div className="v3fs-row-n">{entry_.label}</div>
                  <div className="v3fs-row-m">{entry_.relation === "cito:citesAsEvidence" ? "cited as evidence" : "background source"}</div>
                </div>
                <span className="v3fs-ground-go" aria-hidden="true">›</span>
              </div>
            ))}
          </div>
        </details>
      ) : null;

  return (
    <>
      <div className="v3fs-doc-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} tabIndex={-1} className={`v3fs-docview${studioActive ? " v3fs-studio" : ""}`} role="dialog" aria-modal="true" aria-label={artifact.title}>
        <header className="v3fs-docview-h">
          <div>
            <div className="v3fs-dv-eyebrow">{movementName} · generated document</div>
            <h2>{artifact.title}</h2>
          </div>
          <div className="v3fs-docview-cta">
            {canEdit && !editing ? (
              <button type="button" className="v3fs-btn pri" onClick={() => setEditing(true)}>✎ Edit</button>
            ) : null}
            {editing && !dirty ? (
              <button type="button" className="v3fs-btn" onClick={() => setEditing(false)}>View document</button>
            ) : null}
            {!editing ? (
              <div className="v3fs-dv-menuwrap">
                <button type="button" className="v3fs-btn" aria-label="More actions" aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}>⋯</button>
                {menuOpen ? (
                  <>
                    <div className="v3fs-dv-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                    <div className="v3fs-dv-menu" role="menu">
                      {onRegenerate && !artifact.stale ? (
                        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRegenerate(); onClose(); }}>
                          Regenerate
                        </button>
                      ) : null}
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); window.print(); }}>
                        Export · print or PDF
                      </button>
                      <button type="button" role="menuitem" onClick={copyJsonLd}>Copy as JSON-LD</button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </header>

        {!editing && artifact.stale ? (
          <div className="v3fs-dv-band amber">
            <span>Evidence changed since this document was generated.</span>
            {onRegenerate ? (
              <button type="button" className="v3fs-btn" onClick={() => { onRegenerate(); onClose(); }}>Regenerate</button>
            ) : null}
          </div>
        ) : null}
        {!editing && regenPending ? (
          <div className="v3fs-dv-band indigo">
            <span>A regenerated version awaits your confirm in the Inbox — your hand edits are protected until then.</span>
            {onOpenInbox ? (
              <button type="button" className="v3fs-btn" onClick={() => { onClose(); onOpenInbox(); }}>Review in the Inbox</button>
            ) : null}
          </div>
        ) : null}

        <div className="v3fs-docview-b">

          {studioActive && entry && draft ? (
            <entry.Component doc={draft} onChange={(next) => { setDraft(next); setDirty(true); }} onOpenArtifact={onOpenArtifact} />
          ) : (
            <>
              {groundingDisclosure}
              {draft ? (
                <DocumentView key={typeof draft.editedAt === "string" ? String(draft.editedAt) : "unedited"} doc={draft} order={entry?.docOrder}
                  onPatch={canEdit ? (key, value) => { setDraft({ ...draft, [key]: value }); setDirty(true); } : undefined}
                  onOpenFullEditor={canEdit ? () => setEditing(true) : undefined} />
              ) : (
                <>
                  {blocks.length === 0 ? <p className="v3fs-empty">No document body yet — generate it first.</p> : null}
                  {blocks.map((lines, blockIndex) => (
                    <div key={blockIndex} className="v3fs-docview-blk">
                      {lines.map((line, lineIndex) =>
                        line.kind === "h" ? <h3 key={lineIndex}>{line.text}</h3>
                          : line.kind === "li" ? <div key={lineIndex} className="v3fs-docview-li">{line.text}</div>
                            : <p key={lineIndex}>{line.text}</p>,
                      )}
                    </div>
                  ))}
                </>
              )}
              {draft || blocks.length > 0 ? (
                <details className="v3fs-disc v3fs-disc-sm v3fs-dv-colophon">
                  <summary>
                    <span className="v3fs-disc-l">About this document</span>
                    <span className="v3fs-disc-hint">
                      {[draft && typeof draft.generatedAt === "string" ? `generated ${String(draft.generatedAt).slice(0, 10)}` : null,
                        artifact.confidence != null ? `confidence ${artifact.confidence}%` : null,
                        edited ? `hand-edited ${edited}` : null]
                        .filter(Boolean).join(" · ") || "generated by ATOS"}
                    </span>
                    <span className="v3fs-disc-c" aria-hidden="true" />
                  </summary>
                  <div className="v3fs-disc-b">
                    <div className="v3fs-dv-facts">
                      <div className="v3fs-dv-fact">
                        <span className="v3fs-dv-fl">Generated</span>
                        <span className="v3fs-dv-fv">
                          {draft && typeof draft.generatedAt === "string" ? String(draft.generatedAt).slice(0, 10) : "—"}
                          {artifact.confidence != null ? ` · confidence ${artifact.confidence}%` : ""}
                        </span>
                      </div>
                      {edited ? (
                        <div className="v3fs-dv-fact">
                          <span className="v3fs-dv-fl">Hand-edited</span>
                          <span className="v3fs-dv-fv">{edited}{draft && typeof draft.editedBy === "string" ? ` · ${String(draft.editedBy)}` : ""}</span>
                        </div>
                      ) : null}
                      <div className="v3fs-dv-fact">
                        <span className="v3fs-dv-fl">Movement</span>
                        <span className="v3fs-dv-fv">{artifact.movementId.replace(/^./, (c) => c.toUpperCase())}</span>
                      </div>
                    </div>
                    {history.length ? (
                      <div className="v3fs-dv-history">
                        <span className="v3fs-dv-fl">History</span>
                        <div className="v3fs-dv-history-list">
                          {history.map((attestation, index) => (
                            <div key={index} className="v3fs-dv-history-row">
                              <span className={`v3fs-tdot t${attestation.tier}`} aria-hidden="true" />
                              <span className="v3fs-dv-history-a">{attestation.action}</span>
                              <span className="v3fs-dv-history-t">{String(attestation.ts).slice(0, 10)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>

        {evidenceOpen ? <EvidenceReader entry={evidenceOpen} onClose={() => setEvidenceOpen(null)} /> : null}
        {dirty && canEdit ? (
          <footer className="v3fs-stu-savebar">
            <span>You've edited this document.</span>
            <div className="v3fs-dec-cta">
              <button type="button" className="v3fs-btn pri" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save & attest"}
              </button>
              <button type="button" className="v3fs-btn" disabled={saving} onClick={discard}>
                Discard edits
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </>
  );
}
