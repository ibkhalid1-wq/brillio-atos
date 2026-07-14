/**
 * The artifact studio — the drill-down for every generated document, opened
 * from any card or Library row. Each artifact type renders its own WYSIWYG
 * editor (the ontology is a graph, the atlas a heatmap and step tables, the
 * charter structured prose); edits merge back into the generator's own shape
 * and land on the attestation trail. A typeset document view stays one tap
 * away, and artifacts with no stored structure fall back to it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { safePrompt } from "@/v3/components/flow/flowCapture";
import { useFocusTrap } from "@/v3/lib/useFocusTrap";
import type { ProgramSummary } from "@/new/types";
import { artifactDocument, falsifiedGap, flowMovements, locateQuote, movementEvidence, type ArtifactCardModel, type EvidenceEntry } from "@/v3/components/flow/flowShellData";
import { groundingFor, citationGraph, resourceUri, artifactFabioType, SEMANTIC_CONTEXT } from "@/v3/components/flow/flowSemantics";
import { readRoleBindings } from "@/v3/components/flow/flowStakeholders";
import { artifactApprovalState } from "@/v3/components/flow/flowApprovals";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { partitionOntologyViolations } from "@/v3/components/flow/flowOntologyConstraints";
import { listOpenFlowDecisions, listFlowAttestations, docSectionDiff } from "@/v3/components/flow/flowDecisions";
import { buildPrototypePrompt } from "@/v3/components/flow/flowBuildPrompt";
import { listSnapshots } from "@/v3/lib/blobSnapshots";
import { STUDIO_REGISTRY } from "./studios";
import DocumentView from "./DocumentView";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";

export interface ArtifactEditInput {
  fieldKey: string;
  movementId: string;
  title: string;
  doc: Record<string, unknown>;
}

export default function FlowArtifactStudio({ program, artifact, onClose, onRegenerate, onSaveDoc, onComment, onOpenInbox, onOpenArtifact, onSaveInputs }: {
  program: ProgramSummary;
  artifact: ArtifactCardModel;
  onClose: () => void;
  onRegenerate?: () => void;
  onSaveDoc?: (input: ArtifactEditInput) => Promise<void>;
  /** Add/resolve an anchored comment on this artifact (attested). */
  onComment?: (input: { fieldKey: string; movementId: string; title: string; text?: string; resolveId?: string }) => Promise<void>;
  /** Jump to the Inbox (used when a regenerated version awaits a confirm). */
  onOpenInbox?: () => void;
  /** Open a different artifact's document (chips in studios drill through). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Save a movement's inputs (role bindings from the kit studio). */
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const entry = STUDIO_REGISTRY[artifact.id];
  const storedDoc = useMemo(
    () => (entry ? readArtifactDoc(program, entry.fieldKey) : null),
    [program, entry],
  );

  // Approval is SENT from the artifact card in Flow (part of the process), not
  // from here — the studio just reflects the resulting state.
  const approval = useMemo(() => artifactApprovalState(program, artifact.movementId, artifact.id), [program, artifact.movementId, artifact.id]);

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

  // ARTIFACTS ARE DERIVED, NOT AUTHORED (operator direction 2026-07-14):
  // every document is a generated view of the record, so operator hand-edits
  // are disabled — a change must arrive as EVIDENCE (capture the correction
  // from its owner on the collect board) and land through resynthesis, where
  // the shrink guard, grounding rules and contributor sign-off all apply.
  // The studios still open (the diagram IS the document for graph-first
  // artifacts) but read-only: edits don't dirty, and there is no Save.
  const EDITS_LOCKED = true;
  const canEdit = !EDITS_LOCKED && !!entry && !!draft && !!onSaveDoc;
  const studioActive = !!entry && !!draft && editing;

  // Write-time ontology gate (F-004): while editing the domain ontology, the
  // declared domain/range/cardinality is checked live. Blocking violations
  // (dangling relations, bad/contradictory cardinality) disable Save — the
  // schema can reject an invalid assertion, not just render it.
  const ontologyGate = useMemo(() => {
    if (!entry || entry.fieldKey !== "domainOntology" || !draft) return { blocking: [], warnings: [] };
    return partitionOntologyViolations(draft);
  }, [entry, draft]);
  const saveBlocked = ontologyGate.blocking.length > 0;

  const save = async () => {
    if (!entry || !draft || !onSaveDoc || saveBlocked) return;
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
  // "What changed" — compare the current document against the most recent
  // snapshot that held a DIFFERENT version, section by section. The snapshot
  // ring captures every write, so the last regeneration's footprint is the
  // first differing copy walking backwards.
  const [lastChange, setLastChange] = useState<{ ts: string; rows: string[]; prior: Record<string, unknown> } | null>(null);
  useEffect(() => {
    let alive = true;
    const entry = STUDIO_REGISTRY[artifact.id];
    if (!entry) return;
    void listSnapshots(program.id).then((snapshots) => {
      if (!alive) return;
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
      const current = inner[entry.fieldKey];
      if (!current || typeof current !== "object" || Array.isArray(current)) { setLastChange(null); return; }
      for (const snapshot of snapshots) {
        const snapInner = typeof snapshot.data.data === "object" && snapshot.data.data !== null
          ? (snapshot.data.data as Record<string, unknown>)
          : snapshot.data;
        const prior = snapInner[entry.fieldKey];
        if (!prior || typeof prior !== "object" || Array.isArray(prior)) continue;
        if (JSON.stringify(prior) === JSON.stringify(current)) continue;
        const rows = docSectionDiff(prior as Record<string, unknown>, current as Record<string, unknown>);
        setLastChange(rows.length ? { ts: snapshot.ts, rows, prior: prior as Record<string, unknown> } : null);
        return;
      }
      setLastChange(null);
    });
    return () => { alive = false; };
  }, [artifact.id, program.id, program.rawData]);

  // PR-style review: each changed section, individually keepable or revertible.
  // "Revert" writes the prior snapshot's section back through the normal edit
  // path (attested); "added" sections can't be deleted by merge, so they show
  // without a revert.
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const changeRows = useMemo(() => {
    if (!lastChange) return [];
    return lastChange.rows.map((row) => {
      const [label, kind] = row.split(" — ");
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
      const currentDoc = entry ? inner[entry.fieldKey] : null;
      const key = Object.keys({ ...(lastChange.prior), ...(typeof currentDoc === "object" && currentDoc ? currentDoc : {}) })
        .find((k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() === label.toLowerCase() || k.toLowerCase() === label.toLowerCase());
      return { label, kind: kind ?? "changed", key, prevValue: key ? lastChange.prior[key] : undefined };
    });
  }, [lastChange, program.rawData, entry]);
  const revertSection = async (key: string, label: string, prevValue: unknown) => {
    if (!entry || !onSaveDoc) return;
    await onSaveDoc({ fieldKey: entry.fieldKey, movementId: artifact.movementId, title: `${artifact.title} — ${label} reverted`, doc: { [key]: prevValue } });
    setReviewed((prev) => new Set(prev).add(key));
  };

  // Anchored comments — discussion attached to THIS document, on the record.
  const comments = useMemo(() => {
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const list = Array.isArray(inner.flowComments) ? inner.flowComments : [];
    return list
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .filter((c) => entry && c.fieldKey === entry.fieldKey);
  }, [program.rawData, entry]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const addComment = async () => {
    if (!entry || !onComment || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      await onComment({ fieldKey: entry.fieldKey, movementId: artifact.movementId, title: artifact.title, text: commentText });
      setCommentText("");
    } finally { setCommentBusy(false); }
  };

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
  const [evidenceHighlight, setEvidenceHighlight] = useState<string | null>(null);
  // Span grounding: every pull-quote in the document is checked against the
  // FULL evidence pool (quotes in Envision documents cite Listen voices), and
  // ones that trace click through to the source with the passage marked.
  const allEvidence = useMemo(
    () => flowMovements().flatMap((m) => movementEvidence(program, m)).filter((e) => e.kind !== "reference" && e.text.length > 40),
    [program],
  );
  const evidenceForQuote = useMemo(() => (quote: string): EvidenceEntry | null =>
    allEvidence.find((e) => locateQuote(e.text, quote)) ?? null, [allEvidence]);
  const docBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = docBodyRef.current;
    if (!root || editing) return;
    for (const el of root.querySelectorAll(".v3fs-dv-quote")) {
      const source = evidenceForQuote(el.textContent ?? "");
      el.classList.toggle("traceable", Boolean(source));
      if (source) el.setAttribute("title", `Said by ${source.who} — click to read it in the source`);
    }
  }, [draft, editing, evidenceForQuote]);
  const traceQuote = (event: React.MouseEvent) => {
    const quoteEl = (event.target as HTMLElement).closest?.(".v3fs-dv-quote");
    if (!quoteEl) return;
    const quote = quoteEl.textContent ?? "";
    const source = evidenceForQuote(quote);
    if (source) { setEvidenceHighlight(quote); setEvidenceOpen(source); }
  };
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
                      {artifact.id === "prototype-pack" ? (
                        <button type="button" role="menuitem" onClick={() => {
                          const prompt = buildPrototypePrompt(program);
                          if (prompt) { try { void navigator.clipboard.writeText(prompt); } catch { safePrompt("Copy the build prompt:", prompt); } }
                          setMenuOpen(false);
                        }}>Copy the build prompt</button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {approval.status === "approved" ? (
              <span className="v3fs-approval-pill ok" title={approval.approver ? `Approved by ${approval.approver.name}` : "Approved"}>✓ Approved{approval.approver ? ` · ${approval.approver.name}` : ""}</span>
            ) : approval.status === "in-review" ? (
              <span className="v3fs-approval-pill wait" title={approval.approver ? `Awaiting ${approval.approver.name}` : "In review"}>◷ In review{approval.approver ? ` · ${approval.approver.name}` : ""}</span>
            ) : approval.status === "changes" ? (
              <span className="v3fs-approval-pill changes">↺ Changes requested</span>
            ) : null}
            <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </header>
        {approval.status === "changes" && approval.comment ? (
          <div className="v3fs-approval-bar changes" role="status">↺ {approval.approver?.name ?? "Approver"} requested changes: &ldquo;{approval.comment}&rdquo;</div>
        ) : null}

        {!editing && artifact.stale ? (
          <div className="v3fs-dv-band amber">
            <span>Evidence changed since this document was generated.</span>
            {onRegenerate ? (
              <button type="button" className="v3fs-btn" onClick={() => { onRegenerate(); onClose(); }}>Regenerate</button>
            ) : null}
          </div>
        ) : null}
        {!editing && lastChange ? (
          <details className="v3fs-dv-changed">
            <summary>
              Review changes — {lastChange.rows.length} section{lastChange.rows.length === 1 ? "" : "s"} since {new Date(lastChange.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </summary>
            {/* PR-style: each changed section reviewed on its own — keep the
                new version, or revert that section to the prior snapshot
                (an attested edit through the normal save path). */}
            <div className="v3fs-review">
              {changeRows.slice(0, 10).map((row) => (
                <div key={row.label} className={`v3fs-review-row ${row.kind}`}>
                  <span className={`v3fs-review-kind ${row.kind === "added" ? "add" : row.kind === "removed" ? "rm" : "rw"}`}>
                    {row.kind}
                  </span>
                  <span className="v3fs-review-l">{row.label}</span>
                  {row.key && reviewed.has(row.key) ? (
                    <span className="v3fs-review-done">✓ reverted</span>
                  ) : onSaveDoc && row.key && row.prevValue !== undefined && row.kind !== "added" ? (
                    <button type="button" className="v3fs-a" title="Restore this section from the prior version — attested"
                      onClick={() => void revertSection(row.key!, row.label, row.prevValue)}>↩ Revert section</button>
                  ) : (
                    <span className="v3fs-review-keep">{row.kind === "added" ? "new — keep" : "keep"}</span>
                  )}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {!editing && onComment && entry ? (
          <div className="v3fs-comments">
            <div className="v3fs-comments-h">
              Comments
              {comments.length ? <span>{comments.filter((c) => !c.resolved).length} open · {comments.length} total</span> : <span>none yet</span>}
            </div>
            {comments.map((c) => (
              <div key={String(c.id)} className={`v3fs-comment${c.resolved ? " resolved" : ""}`}>
                <div className="v3fs-comment-g">
                  <div className="v3fs-comment-t">{String(c.text ?? "")}</div>
                  <div className="v3fs-comment-m">{String(c.by ?? "")} · {String(c.ts ?? "").slice(0, 10)}{c.resolved ? " · resolved" : ""}</div>
                </div>
                {!c.resolved ? (
                  <button type="button" className="v3fs-a" title="Resolve — attested"
                    onClick={() => void onComment({ fieldKey: entry.fieldKey, movementId: artifact.movementId, title: artifact.title, resolveId: String(c.id) })}>✓ Resolve</button>
                ) : null}
              </div>
            ))}
            <div className="v3fs-comments-add">
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                placeholder="Comment on this document — stays on the record"
                aria-label="Add a comment"
                onKeyDown={(e) => { if (e.key === "Enter") void addComment(); }} />
              <button type="button" className="v3fs-btn" disabled={commentBusy || !commentText.trim()} onClick={() => void addComment()}>
                {commentBusy ? "Saving…" : "Comment"}
              </button>
            </div>
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

        {studioActive && (ontologyGate.blocking.length > 0 || ontologyGate.warnings.length > 0) ? (
          <div className={`v3fs-onto-gate${saveBlocked ? " blocking" : ""}`} role={saveBlocked ? "alert" : undefined}>
            <span className="v3fs-onto-gate-h">
              {saveBlocked
                ? `⚠ ${ontologyGate.blocking.length} constraint${ontologyGate.blocking.length === 1 ? "" : "s"} to fix before this saves — declare the missing entity, or click the relation in the graph to retarget or delete it`
                : `${ontologyGate.warnings.length} advisory${ontologyGate.warnings.length === 1 ? "" : " items"}`}
            </span>
            <ul>
              {[...ontologyGate.blocking, ...ontologyGate.warnings].slice(0, 6).map((violation, index) => (
                <li key={index} className={violation.severity}>
                  {violation.message}
                  {violation.missing && draft ? (
                    <button type="button" className="v3fs-a v3fs-onto-gate-fix"
                      title={`Add "${violation.missing}" to the entities so this reference resolves`}
                      onClick={() => {
                        const entities = Array.isArray(draft.entities) ? draft.entities : [];
                        setDraft({ ...draft, entities: [...entities, { name: violation.missing, definition: "", attributes: [], aliases: [], systemOfRecord: null, evidence: "" }] });
                        setDirty(true);
                      }}>
                      ＋ Declare “{violation.missing}”
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="v3fs-docview-b" ref={docBodyRef} onClick={traceQuote}>

          {studioActive && entry && draft ? (
            <>
              {/* Derived-document contract: the studio renders, edits don't
                  land. A change enters as EVIDENCE and returns via resynthesis. */}
              <div className="v3fs-derived-note" role="note">
                <b>Derived from the record.</b> Content edits are disabled — to change this document,
                capture the correction as evidence on its owner&rsquo;s collect card, then resynthesize.
                Role bindings and sign-offs still work here.
              </div>
              <entry.Component doc={draft}
                onChange={canEdit ? (next) => { setDraft(next); setDirty(true); } : () => { /* derived — edits don't land */ }}
                onOpenArtifact={onOpenArtifact} program={program}
                onBindRole={onSaveInputs ? async (movementId, role, name, email) => {
                  const bindings = readRoleBindings(program, movementId);
                  bindings[role] = email ? { name, email } : { name };
                  await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
                    attest: { action: `Role bound — ${role} → ${name}`, detail: email || undefined },
                  });
                } : undefined} />
            </>
          ) : (
            <>
              {groundingDisclosure}
              {draft ? (
                <DocumentView key={typeof draft.editedAt === "string" ? String(draft.editedAt) : "unedited"}
                  // Falsified field-demand gaps (the field demonstrably holds
                  // content) are suppressed here too — the document view, the
                  // card, the scripts and the gate read one truth.
                  doc={Array.isArray(draft.gaps)
                    ? { ...draft, gaps: (draft.gaps as unknown[]).map(String).filter((gap) => gap && !falsifiedGap(program, gap)) }
                    : draft}
                  order={entry?.docOrder}
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
                              <span className="v3fs-dv-history-t">{String(attestation.ts).slice(0, 16).replace("T", " ")}</span>
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

        {evidenceOpen ? (
          <EvidenceReader entry={evidenceOpen} highlight={evidenceHighlight ?? undefined}
            onClose={() => { setEvidenceOpen(null); setEvidenceHighlight(null); }} />
        ) : null}
        {dirty && canEdit ? (
          <footer className="v3fs-stu-savebar">
            <span>{saveBlocked ? "Fix the flagged constraints to save." : "You’ve edited this document."}</span>
            <div className="v3fs-dec-cta">
              <button type="button" className="v3fs-btn pri" disabled={saving || saveBlocked}
                title={saveBlocked ? "This ontology has unresolved constraint violations" : undefined}
                onClick={() => void save()}>
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
