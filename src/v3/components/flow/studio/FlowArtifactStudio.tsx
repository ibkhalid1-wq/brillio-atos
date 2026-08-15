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
import { artifactDocument, falsifiedGap, flowMovements, locateQuote, movementEvidence, spineLabel, type ArtifactCardModel, type EvidenceEntry } from "@/v3/components/flow/flowShellData";
import { groundingFor, citationGraph, resourceUri, artifactFabioType, SEMANTIC_CONTEXT } from "@/v3/components/flow/flowSemantics";
import { readRoleBindings, readOperatorAsks, operatorAsksFor, resolveMovementStakeholders, readDirectoryPeople, validateProgramRole, readGapRoutes, gapRouteKey } from "@/v3/components/flow/flowStakeholders";
import { artifactApprovalState } from "@/v3/components/flow/flowApprovals";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { operatorOverrideCount } from "@/v3/components/flow/flowOperatorOverrides";
import { partitionOntologyViolations } from "@/v3/components/flow/flowOntologyConstraints";
import { listOpenFlowDecisions, listFlowAttestations, docSectionDiff } from "@/v3/components/flow/flowDecisions";
import { buildPrototypePrompt } from "@/v3/components/flow/flowBuildPrompt";
import { listSnapshots } from "@/v3/lib/blobSnapshots";
import { STUDIO_REGISTRY } from "./studios";
import SectionCopilotCard from "./SectionCopilotCard";
import { StudioLockContext, StudioAuthoringContext, StudioPrintContext, EmptyState } from "./StudioKit";
import { artifactEditTier, isArtifactAuthorable } from "@/v3/lib/artifactEditPolicy";

const SECTION_COPILOT_LABEL: Record<string, string> = {
  "architecture-strategy": "the architecture strategy",
  "experience-design": "the experience design",
  "agentic-blueprint": "the agentic blueprint",
};
const SECTION_COPILOT_PLACEHOLDER: Record<string, string> = {
  "architecture-strategy": "e.g. “add a resilience-first option”, “score cost lower on the hub”, “tighten the recommendation rationale”",
  // Three examples, none of which this surface can do any more: it stopped authoring
  // screens and the theme when it became the parent-entity decision, and the
  // agentify call was never its to make. A placeholder is an offer — these offered
  // work the studio would silently ignore. Same staleness the tile's pills carried.
  "experience-design": "e.g. “give Contract its own screen”, “Territory belongs under Account, not in the menu”, “put Opportunity first”",
  "agentic-blueprint": "e.g. “add a human-in-the-loop gate before contract send”, “split the pricing agent in two”",
};
/**
 * Artifacts whose studio draws something the prose CANNOT carry — the ontology
 * graph, the workflow swimlanes. For these the export leads with the picture and
 * follows with the document; everywhere else the studio is a form, and a form
 * on paper is just greyed-out boxes, so only the document prints.
 *
 * The swimlanes travelled with the workflows: AGENTIFY draws them now, and the
 * Current-State Atlas tab is registers — a form, which would print as boxes.
 */
const PRINT_GRAPHIC_ARTIFACTS = ["domain-ontology", "current-state-atlas", "agentify"];

import DocumentView from "./DocumentView";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";

export interface ArtifactEditInput {
  fieldKey: string;
  movementId: string;
  title: string;
  doc: Record<string, unknown>;
}

export default function FlowArtifactStudio({ program, artifact, onClose, onRegenerate, onSaveDoc, onOpenInbox, onOpenArtifact, onSaveInputs, embedded, regenerating, header, initialSection }: {
  program: ProgramSummary;
  artifact: ArtifactCardModel;
  onClose: () => void;
  onRegenerate?: () => void;
  /** Open scrolled to this document section (a Work-board section chip). */
  initialSection?: string;
  /** Render inline inside a movement tab (no backdrop, no dialog chrome, no
   *  Close) rather than as a full-screen overlay. */
  embedded?: boolean;
  /** This artifact is currently regenerating — the header button shows a spinner. */
  regenerating?: boolean;
  /** Extra content rendered above the document body (e.g. Frame's Listen plan
   *  merged into the Discovery Kit tab). */
  header?: React.ReactNode;
  onSaveDoc?: (input: ArtifactEditInput) => Promise<void>;
  /** Add/resolve an anchored comment on this artifact (attested). */
  onComment?: (input: { fieldKey: string; movementId: string; title: string; text?: string; resolveId?: string }) => Promise<void>;
  /** Jump to the Inbox (used when a regenerated version awaits a confirm). */
  onOpenInbox?: () => void;
  /** Open a different artifact's document (chips in studios drill through). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Save a movement's inputs (role bindings from the kit studio). */
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string }; extraInputs?: Record<string, Record<string, string>> }) => Promise<void>;
}) {
  const entry = STUDIO_REGISTRY[artifact.id];
  const storedDoc = useMemo(
    () => (entry ? readArtifactDoc(program, entry.fieldKey) : null),
    [program, entry],
  );

  // Approval is SENT from the artifact card in Flow (part of the process), not
  // from here — the studio just reflects the resulting state.
  const approval = useMemo(() => artifactApprovalState(program, artifact.movementId, artifact.id), [program, artifact.movementId, artifact.id]);
  // Hand corrections this document carries (operator overrides + curation-log
  // dismissals). Regeneration REPLACES the document, so each is a stakeholder
  // correction about to be discarded — warn before regenerating, with the count.
  const overrideCount = useMemo(() => (entry ? operatorOverrideCount(program, entry.fieldKey) : 0), [program, entry]);
  const guardedRegenerate = React.useCallback(() => {
    if (!onRegenerate) return;
    if (overrideCount > 0 && typeof window !== "undefined"
      && !window.confirm(`This ${artifact.title} carries ${overrideCount} hand correction${overrideCount === 1 ? "" : "s"} from stakeholder meetings. Regenerating REPLACES the document — those corrections are not merged, and there is no saved version to roll back to. Regenerate anyway?`)) return;
    onRegenerate();
  }, [onRegenerate, overrideCount, artifact.title]);

  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(embedded ? { current: null } : dialogRef);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(storedDoc);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Read first, everywhere: every artifact opens as the typeset document;
  // Edit flips to its form (or graph), and both Save and Discard land you
  // back on the document. One flow, no mode maze.
  // The graph-first documents open straight into their studio — the diagram
  // IS the document there, so the graphical view leads. Prose-first
  // documents keep the typeset reading view as the default.
  // (BOTH Listen diagrams open on their picture: the Atlas because the swimlane IS
  // the atlas — the workflows and every structural edit to them — and Agentify
  // because the call on a step is made where the step is drawn.)
  const GRAPH_FIRST = ["domain-ontology", "current-state-atlas", "agentify", "architecture-strategy", "agentic-blueprint", "experience-design", "prototype-build"];
  const graphFirst = GRAPH_FIRST.includes(artifact.id);
  const [editing, setEditing] = useState(graphFirst);

  // A regenerate or portal write can refresh the programme under the open
  // studio — follow the store while the user hasn't started editing.
  useEffect(() => {
    if (!dirty) setDraft(storedDoc);
  }, [storedDoc, dirty]);

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  // EDITABILITY SPLITS BY OWNERSHIP (operator direction 2026-07-16):
  // The Prototype Loop's OWN working documents — architecture, experience,
  // blueprint, prototype — are AUTHORED DIRECTLY by the delivery team, so their
  // studios are fully editable with a Save. Everything derived from stakeholder
  // evidence (discovery kit, ontology, atlas, demo scripts, ship/hardening)
  // stays derived and read-only: a change there must arrive as EVIDENCE and
  // land through resynthesis, where the shrink guard, grounding and sign-off
  // all apply.
  // Ownership tiers (operator direction 2026-07-19) live in artifactEditPolicy,
  // the single source shared with the policy tests:
  //  - authorable → canEdit (design-team documents; add-new allowed)
  //  - curatable  → canCurate (ontology/atlas; rename/relate/dismiss, NO add-new)
  //  - derived    → read-only (change arrives as evidence)
  // Editing MECHANICS (draft lands, Save shows, studio unlocked) apply to both
  // authoring and curation; only INVENTION (add-new) is gated to authoring.
  const hasDraft = !!entry && !!draft && !!onSaveDoc;
  const canEdit = hasDraft && isArtifactAuthorable(artifact.id);
  const canCurate = hasDraft && artifactEditTier(artifact.id) === "curatable";
  const editable = canEdit || canCurate;
  // EXPORT PRINTS THE DOCUMENT, NOT THE EDITOR (operator report 2026-08-05).
  // `window.print()` captures whatever is on screen, and for three artifacts
  // that was never the document:
  //  - domain-ontology / current-state-atlas open graph-first, so the export
  //    caught a React Flow canvas (unformatted) and a workflow studio that
  //    keeps only the ACTIVE area's lanes mounted — hence "not showing all
  //    areas and personas". The unmounted tabs cannot print; no CSS reaches
  //    a node that isn't in the DOM.
  //  - discovery-kit suppresses its document body on screen in favour of the
  //    plan matrix, so the export carried the plan and none of the kit.
  // Printing therefore renders the document projection instead: every section
  // in registry order, every row of every collection, nothing behind a tab.
  // The draft is the same object the studio edits, so unsaved curation prints
  // exactly as it appears — and `editing` is untouched, so the operator lands
  // back in the studio afterwards with their work intact.
  const [printing, setPrinting] = useState(false);
  const studioActive = !!entry && !!draft && editing && !printing;

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    void (async () => {
      // One frame commits the print render and lets the browser lay it out.
      await frame();
      // A GRAPH needs more than a layout pass. React Flow mounts, waits for a
      // ResizeObserver to report the container, measures each node, and only
      // then can fit the view — several frames, not one. Printing on the next
      // frame caught it mid-mount: the viewport still at identity transform,
      // the nodes at raw coordinates, and no edges rendered at all. So wait
      // for the fit to actually land, with a ceiling so a graph that never
      // settles still prints rather than hanging the export.
      if (PRINT_GRAPHIC_ARTIFACTS.includes(artifact.id)) {
        const IDENTITY = "translate(0px, 0px) scale(1)";
        const deadline = Date.now() + 2500;
        for (;;) {
          if (cancelled) return;
          const viewport = dialogRef.current?.querySelector<HTMLElement>(".v3fs-printgraphic .react-flow__viewport");
          // No React Flow here (the atlas draws plain DOM swimlanes) — one
          // layout pass is all that surface needs.
          if (!viewport) break;
          if (viewport.style.transform && viewport.style.transform !== IDENTITY) break;
          if (Date.now() > deadline) break;
          await frame();
        }
      }
      if (cancelled) return;
      try { window.print(); } finally { setPrinting(false); }
    })();
    return () => { cancelled = true; };
  }, [printing, artifact.id]);

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
      // Graph-first tabs (ontology, atlas, …) STAY in their studio after a
      // save — flipping to the document reading is a jarring "navigation".
      if (!graphFirst) setEditing(false);
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
    if (!graphFirst) setEditing(false);
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
  // Spine-folded: envision/show read "Prototype · Design/Validate", never the old names.
  const movementName = useMemo(
    () => spineLabel(artifact.movementId, { distinct: true }),
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

  // The document is DERIVED — the operator can't edit it. The only way to change
  // it is to ask the relevant stakeholder: their answer arrives as evidence and
  // regenerates the document. This panel raises that question against the
  // movement's own roster, storing it as an operator ask (fingerprint-safe)
  // that travels on that person's link — the SAME channel the collect board uses.
  // Every role with a NAMED individual, across ALL movements (deduped by
  // person) — a question needs a person to travel to; an unbound role
  // placeholder has no link to carry it.
  const askRoster = useMemo(() => {
    const ordered = [artifact.movementId, ...flowMovements().map((m) => m.id).filter((id) => id !== artifact.movementId)];
    const seen = new Set<string>();
    const out: Array<{ name: string; role: string }> = [];
    for (const movementId of ordered) {
      for (const s of resolveMovementStakeholders(program, movementId)) {
        if (s.isRole || !s.name.trim()) continue;
        if (s.name.trim().toLowerCase() === (s.role || "").trim().toLowerCase()) continue;
        const key = s.name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: s.name, role: s.role || "" });
      }
    }
    return out;
  }, [program, artifact.movementId]);
  const [askWho, setAskWho] = useState("");
  const [askText, setAskText] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askDone, setAskDone] = useState("");
  const askEntry = askRoster.find((s) => s.name === askWho) ?? askRoster[0];
  const askTarget = askEntry?.name ?? "";
  const askExisting = useMemo(
    () => (askEntry ? operatorAsksFor(program, artifact.movementId, askEntry.name) : []),
    [program, artifact.movementId, askEntry],
  );
  // Route the question to the person ON THIS artifact's movement: the ask is
  // stored on this movement's _operatorAsks, and if the person has no card on
  // this movement's Discovery yet, a directory entry is added IN THE SAME
  // WRITE — so the question and the card land together and the ask rides the
  // link minted from that card.
  const addAsk = async () => {
    const q = askText.trim();
    if (!q || !askEntry || !onSaveInputs) return;
    setAskBusy(true);
    try {
      const movementId = artifact.movementId;
      const inputs: Record<string, string> = {};
      const extraInputs: Record<string, Record<string, string>> = {};
      const onBoard = resolveMovementStakeholders(program, movementId)
        .some((s) => !s.isRole && s.name.trim().toLowerCase() === askEntry.name.trim().toLowerCase());
      if (!onBoard) {
        // The directory is ONE store that lives in the LISTEN bucket
        // (readDirectoryPeople reads listen inputs); the ENTRY's movementId
        // field is what files the person onto THIS movement's Discovery. So
        // the write must target the listen bucket — folded into this same
        // save via extraInputs when the artifact isn't a Listen one.
        const dirJson = JSON.stringify([...readDirectoryPeople(program), {
          id: `dp-${Date.now().toString(36)}-${askEntry.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
          name: askEntry.name, role: askEntry.role || "Stakeholder", email: undefined, movementId,
          roleResolved: validateProgramRole(program, askEntry.role || "Stakeholder").known,
        }]);
        if (movementId === "listen") inputs._directoryPeople = dirJson;
        else extraInputs.listen = { _directoryPeople: dirJson };
      }
      const all = readOperatorAsks(program, movementId);
      const key = askEntry.name.trim().toLowerCase();
      const next = [...(all[key] ?? [])];
      if (!next.some((existing) => existing.toLowerCase() === q.toLowerCase())) next.push(q);
      all[key] = next;
      inputs._operatorAsks = JSON.stringify(all);
      await onSaveInputs(movementId, inputs, {
        attest: { action: `Question raised for ${askEntry.name}`, detail: q.slice(0, 120) },
        ...(Object.keys(extraInputs).length ? { extraInputs } : {}),
      });
      setAskText("");
      setAskDone(askTarget);
      window.dispatchEvent(new CustomEvent("atlas-v3-toast", {
        detail: { message: `Question sent to ${askTarget} — it travels on their link until answered.`, tone: "success", duration: 3200 },
      }));
    } finally { setAskBusy(false); }
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

  // Grounding lives in the colophon with the rest of the provenance. The
  // Discovery Kit is a plan the operator shapes, not an evidence-grounded
  // synthesis — its "Grounded in" disclosure is noise there, so hide it.
  const groundingDisclosure = grounding.length && artifact.id !== "discovery-kit" ? (
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

  // Ask a question — the derived document's ONE editing path (also offered on
  // the editable Transformation Charter): ask the person who owns the answer.
  // The question travels on their link and regenerates the document when
  // answered. Only roles with a NAMED individual are offered; asking someone
  // not yet on this movement's Discovery adds their card. Rendered at the TOP
  // of the tab.
  const askPanel = (!canEdit || artifact.id === "charter") && artifact.movementId !== "envision" && artifact.movementId !== "show" && onSaveInputs && askRoster.length ? (
    <div className="v3fs-artask">
      <div className="v3fs-artask-h">
        <span className="v3fs-artask-l">Ask a question</span>
      </div>
      <div className="v3fs-artask-b">
        <label className="v3fs-artask-row">
          <span>Who to ask</span>
          <select className="v3fs-artask-who" value={askTarget} onChange={(e) => { setAskWho(e.target.value); setAskDone(""); }} aria-label="Who to ask">
            {askRoster.map((s, i) => (
              <option key={`${s.name}-${i}`} value={s.name}>{`${s.name}${s.role ? ` · ${s.role}` : ""}`}</option>
            ))}
          </select>
        </label>
        {askExisting.length ? (
          <ul className="v3fs-artask-q">
            {askExisting.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        ) : null}
        <div className="v3fs-artask-add">
          <input value={askText} onChange={(e) => setAskText(e.target.value)}
            placeholder={`Your question for ${askTarget || "the owner"}…`}
            aria-label="Your question"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addAsk(); } }} />
          <button type="button" className="v3fs-btn" disabled={askBusy || !askText.trim() || !askTarget} onClick={() => void addAsk()}>
            {askBusy ? "Sending…" : "＋ Ask"}
          </button>
        </div>
        {askDone ? <div className="v3fs-artask-done">✓ Sent to {askDone} — travels on their link until answered.</div> : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      {embedded ? null : <div className="v3fs-doc-backdrop" onClick={onClose} aria-hidden="true" />}
      <div ref={dialogRef} tabIndex={embedded ? undefined : -1}
        className={`${embedded ? "v3fs-artpanel" : "v3fs-docview"}${studioActive ? " v3fs-studio" : ""}`}
        role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-label={artifact.title}>
        <header className="v3fs-docview-h">
          <div>
            <div className="v3fs-dv-eyebrow">{movementName} · {artifact.present ? "generated document" : "not generated yet"}</div>
            <h2>{artifact.title}</h2>
          </div>
          <div className="v3fs-docview-cta">
            {/* REGENERATE IS ON THE SURFACE, not under the ⋯.
                It used to show only when the document was stale, on the reasoning
                that a current document needs no rebuild. Two things are wrong with
                that. The staleness flag tracks the inputs FINGERPRINT, so every
                reason to rebuild that the fingerprint cannot see — a prompt change,
                a bad generation, an edit upstream of the hash — left the operator
                with no visible way to act on it. And the fallback WAS there: the
                same verb, spelled the same way, inside the ⋯ overflow. Reported as
                "currently regenerate is hidden under the menu". A primary action for
                a generated document belongs in the header at all times; it now
                renders whenever the document can be regenerated, and the menu no
                longer carries a second copy of it.

                ONE control per screen, named for what it does in the state it is in.
                A stale document's band used to carry its own "↻ Rebuild in full"
                button — right when the header was showing "↻ Regenerate" — so a
                stale screen offered two differently-named controls for one act. The
                band keeps every word of its explanation (it is the only place that
                says a full rebuild does not merge hand corrections); the button is
                here, and takes the band's honest wording while it is stale. */}
            {onRegenerate ? (
              <button type="button" className="v3fs-btn v3fs-btn-regen" disabled={!!regenerating}
                onClick={() => { guardedRegenerate(); if (!embedded) onClose(); }}
                title={!artifact.present ? "Generate this document from the evidence on record"
                  : artifact.stale ? "A full rebuild REPLACES the whole document from the current claims — the affected-sections-only update is not yet wired"
                  : "Resynthesize this document from the latest evidence"}>
                {/* The glyph is decoration and is hidden from the reading order —
                    the accessible name is the WORD. It used to be inside the label,
                    which nothing caught while this button only rendered on a stale
                    document; drawing it on every artifact screen put "↻ Regenerate"
                    into the name on every studio and the a11y guard said so. */}
                {regenerating ? "Generating…" : (
                  <>
                    <span aria-hidden="true">{artifact.present ? "↻ " : "✦ "}</span>
                    {!artifact.present ? "Generate" : artifact.stale ? "Rebuild in full" : "Regenerate"}
                  </>
                )}
              </button>
            ) : null}
            {entry ? (
              <div className="v3fs-dv-menuwrap">
                <button type="button" className="v3fs-btn" aria-label="More actions" aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}>⋯</button>
                {menuOpen ? (
                  <>
                    <div className="v3fs-dv-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                    <div className="v3fs-dv-menu" role="menu">
                      {/* Regenerate is in the header now, always — see the note
                          there. The menu keeps only what has nowhere else to go. */}
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPrinting(true); }}>
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
            {embedded ? null : <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>}
          </div>
        </header>
        {askPanel}
        {/* The Discovery Kit's coverage matrix arrives as `header`. It is a grid
            inside a 640px-capped scroller on screen, so the print pass needs the
            signal too — it narrows its own columns to the page width. */}
        {header ? (
          <div className="v3fs-artpanel-header">
            <StudioPrintContext.Provider value={printing}>{header}</StudioPrintContext.Provider>
          </div>
        ) : null}
        {approval.status === "changes" && approval.comment ? (
          <div className="v3fs-approval-bar changes" role="status">↺ {approval.approver?.name ?? "Approver"} requested changes: &ldquo;{approval.comment}&rdquo;</div>
        ) : null}

        {artifact.stale ? (
          // Claim-status, not a generic staleness flag: an upstream claim this
          // document rests on moved (or its own inputs changed). The intended path
          // is a TARGETED update of the affected sections (the fabric's incremental
          // path) — but only a full rebuild is wired today, so we say so plainly and
          // never present nuke-and-rebuild as if it were the update.
          <div className="v3fs-dv-band amber">
            <span>
              <b>The claims this {artifact.title} rests on moved</b> since it was generated — an upstream deliverable was rebuilt or its own inputs changed.{overrideCount > 0
                ? ` ⚠ ${overrideCount} stakeholder correction${overrideCount === 1 ? "" : "s"} would be replaced — a full rebuild does not merge them.`
                : ""} A <b>targeted update of just the affected sections</b> is the intended path; today only a full rebuild is wired.
              {onRegenerate ? <> The header&rsquo;s <b>↻ Rebuild in full</b> is that rebuild.</> : null}
            </span>
            {/* The button that stood here said the same thing as the header's, two
                inches away and under a different name. The explanation is what this
                band is for; the act is one control, at the top. */}
          </div>
        ) : null}
        {regenPending ? (
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
                  {/* A dangling STANDARD MAPPING has a second remedy: the row
                      itself may be wrong — drop it here without declaring. */}
                  {violation.kind === "dangling-alignment" && violation.missing && draft ? (
                    <button type="button" className="v3fs-a v3fs-onto-gate-fix"
                      title={`Remove the standard-alignment row referencing "${violation.missing}"`}
                      onClick={() => {
                        const rows = Array.isArray(draft.standardAlignment) ? draft.standardAlignment : [];
                        const wanted = String(violation.missing).trim().toLowerCase();
                        setDraft({ ...draft, standardAlignment: rows.filter((row) =>
                          String((row as Record<string, unknown>)?.entity ?? "").trim().toLowerCase() !== wanted) });
                        setDirty(true);
                      }}>
                      ✕ Remove the mapping
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
              {/* Copilot command card — refine THIS section with a plain-language
                  command (type or speak) plus optional reference documents.
                  Architecture Strategy / Experience Design / Agentic Blueprint;
                  the Prototype Build has its own command line inside its studio. */}
              {canEdit && onSaveInputs && onRegenerate
                && ["architecture-strategy", "experience-design", "agentic-blueprint"].includes(artifact.id) ? (
                <SectionCopilotCard program={program}
                  sectionLabel={SECTION_COPILOT_LABEL[artifact.id] ?? "this section"}
                  placeholder={SECTION_COPILOT_PLACEHOLDER[artifact.id]}
                  refining={regenerating}
                  onRefine={async (instruction) => {
                    const fieldKey = STUDIO_REGISTRY[artifact.id]?.fieldKey;
                    if (!fieldKey) return;
                    await onSaveInputs(artifact.movementId, { [`_refine_${fieldKey}`]: instruction }, { silent: true });
                    onRegenerate();
                  }} />
              ) : null}
              {/* Locked when edits are disabled — the studio's own inputs and
                  add/remove/drag affordances go read-only, so a field can't be
                  clicked into or typed (a no-op onChange had let the caret in). */}
              <StudioLockContext.Provider value={!editable}>
               <StudioAuthoringContext.Provider value={canEdit}>
                <entry.Component doc={draft}
                  onChange={editable ? (next) => { setDraft(next); setDirty(true); } : () => { /* derived — edits don't land */ }}
                  onOpenArtifact={onOpenArtifact} program={program}
                  refining={regenerating}
                  onRefinePrototype={onSaveInputs && onRegenerate ? async (instruction) => {
                    // Stash the design-team's command (fingerprint-safe) and re-run
                    // the prototype-build agent — the refined build replaces this one.
                    await onSaveInputs("envision", { _prototypeRefine: instruction }, { silent: true });
                    onRegenerate();
                  } : undefined}
                  onBindRole={onSaveInputs ? async (movementId, role, name, email) => {
                    const bindings = readRoleBindings(program, movementId);
                    bindings[role] = email ? { name, email } : { name };
                    await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
                      attest: { action: `Role bound — ${role} → ${name}`, detail: email || undefined },
                    });
                  } : undefined}
                  gapRoutes={readGapRoutes(program, artifact.movementId)}
                  onRouteGap={onSaveInputs ? async (gap, who) => {
                    // WHO a derived gap is asked of is an operator judgement — persist
                    // it as an overlay (the document stays read-only) so the follow-up
                    // router redirects the gap to the stakeholder the operator chose.
                    // Clearing the field DELETES the override, restoring the generator's
                    // own addressee rather than accumulating an empty redirect.
                    const routes = readGapRoutes(program, artifact.movementId);
                    const key = gapRouteKey(gap);
                    if (who.trim()) routes[key] = who.trim(); else delete routes[key];
                    await onSaveInputs(artifact.movementId, { _gapRoutes: JSON.stringify(routes) }, {
                      attest: { action: who.trim() ? `Gap redirected to ${who.trim()}` : "Gap redirect cleared", detail: key.slice(0, 120) },
                    });
                  } : undefined} />
               </StudioAuthoringContext.Provider>
              </StudioLockContext.Provider>
            </>
          ) : (
            <>
              {/* THE PICTURE, THEN THE RECORD. The ontology graph and the atlas
                  swimlanes say something the prose underneath cannot — shape,
                  adjacency, who hands off to whom. They render here in a print
                  pass of their own: read-only, un-authorable, and told (via
                  StudioPrintContext) to draw EVERY workflow and to fit the graph
                  to all its nodes rather than to the operator's last viewport. */}
              {printing && entry && draft && PRINT_GRAPHIC_ARTIFACTS.includes(artifact.id) ? (
                <div className="v3fs-printgraphic">
                  <StudioLockContext.Provider value={true}>
                    <StudioAuthoringContext.Provider value={false}>
                      <StudioPrintContext.Provider value={true}>
                        <entry.Component doc={draft} onChange={() => { /* print render — read-only */ }}
                          program={program} />
                      </StudioPrintContext.Provider>
                    </StudioAuthoringContext.Provider>
                  </StudioLockContext.Provider>
                </div>
              ) : null}
              {groundingDisclosure}
              {/* The Discovery Kit reads as the Listen plan (the `header` above)
                  plus "About this document" — the generated document body is
                  hidden here; the plan is the operator's working surface. */}
              {artifact.id === "discovery-kit" && !printing ? null : draft ? (
                <DocumentView key={typeof draft.editedAt === "string" ? String(draft.editedAt) : "unedited"}
                  // Falsified field-demand gaps (the field demonstrably holds
                  // content) are suppressed here too — the document view, the
                  // card, the scripts and the gate read one truth.
                  doc={Array.isArray(draft.gaps)
                    ? { ...draft, gaps: (draft.gaps as unknown[]).map(String).filter((gap) => gap && !falsifiedGap(program, gap)) }
                    : draft}
                  order={entry?.docOrder}
                  // The Discovery Kit's interview questions are asked and edited
                  // in the Listen phase — hide that section here so the kit reads
                  // as the plan (coverage + cast), not a duplicate of the scripts.
                  // On EXPORT they come back: a printed kit that omits the
                  // questions isn't the kit, it's the cover sheet.
                  // AGENTIFY holds DECISIONS, not workflows. A document generated
                  // in the older shape still carries a verbatim copy of the Atlas's
                  // `workflows`; typesetting it here would print a second, competing
                  // atlas that nothing on this tab can edit — so it is suppressed.
                  // Presentational only: the copy is still READ (its decisions are
                  // migrated on the next call made), it is just never shown as the
                  // record of what the business does. The Atlas presents its own
                  // workflows again, and hides nothing.
                  hideKeys={artifact.id === "discovery-kit" && !printing ? new Set(["interviews"])
                    : artifact.id === "agentify" ? new Set(["workflows"]) : undefined}
                  openToSection={initialSection}
                  onPatch={editable ? (key, value) => { setDraft({ ...draft, [key]: value }); setDirty(true); } : undefined}
                  onOpenFullEditor={editable ? () => setEditing(true) : undefined} />
              ) : (
                <>
                  {blocks.length === 0 ? <EmptyState icon="📄" title="Not generated yet" hint="Use ✦ Generate above to synthesize this document from the evidence on record." /> : null}
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
                        .filter(Boolean).join(" · ") || "generated by AURA"}
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

        {/* Review changes lives at the BOTTOM — the diff since the last version,
            read after the document, not before it. */}
        {lastChange ? (
          <details className="v3fs-dv-changed v3fs-dv-changed-foot">
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
        {evidenceOpen ? (
          <EvidenceReader entry={evidenceOpen} highlight={evidenceHighlight ?? undefined}
            onClose={() => { setEvidenceOpen(null); setEvidenceHighlight(null); }} />
        ) : null}
        {dirty && editable ? (
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
