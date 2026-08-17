/**
 * Prototype Build studio — the Envision "Build" output. The Prototype Build
 * agent assembles the Experience Design's screens, the Blueprint's agents and
 * the seed fixtures into a SELF-CONTAINED clickable HTML app (doc.html). This
 * studio renders it in a sandboxed iframe and gives the Experience Designer an
 * edit mode to refine it — edits propose a change, they never silently
 * overwrite the record. Show demonstrates this same built prototype to clients.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { asArray, asRecord, asStrings, asText, type StudioProps } from "./StudioKit";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { prototypeBaselineOfProgram } from "@shared/prototypeRefine.ts";
// The export still names the palette explicitly — a .zip carries its tokens.
import { paletteFor } from "@shared/prototypeAssembly.ts";
import { buildPrototypeProject, downloadPrototypeZip, importPrototypeProject, projectSlug } from "./prototypeExport";
import PrototypeCommandBar from "@/v3/components/flow/PrototypeCommandBar";
import { deriveFabric } from "@shared/fabric.ts";
import {
  readDesignOverrides, projectOverrides, targetOfFabricNode, targetLabel,
  type DesignOverride, type OverrideTarget,
} from "@shared/designOverrides.ts";
import { withAnnotator, readAnnotatePick } from "./prototypeAnnotate";

function toast(message: string, tone: "info" | "error" = "info") {
  window.dispatchEvent(new CustomEvent("atlas-v3-toast", { detail: { message, tone } }));
}

/** Open the self-contained prototype HTML in a real browser tab via a blob URL
 *  — the running app gets its own address to walk full-screen, share, or open
 *  on another device. Shared by the Design (Build) and Validate prototype tabs. */
export function openPrototypeInBrowser(html: string) {
  if (!html.trim()) { toast("No prototype to open yet — build it first.", "error"); return; }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  // Anchor-click, not window.open: with the noopener feature, window.open
  // returns null EVEN ON SUCCESS (per spec), so the old "pop-up blocked"
  // toast fired on every successful open.
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  // Revoke after the new tab has had time to load the document.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function PrototypeStudio({ doc, onChange, program, onRefinePrototype, refining, designOverrides, onDesignOverride }: StudioProps) {
  const html = asText(doc.html);
  const screens = asArray(doc.screens).map(asRecord);
  const summary = asText(doc.summary);
  const generatedAt = asText(doc.generatedAt);
  // In refine mode the Build agent reports the screens/areas it actually
  // edited this iteration — everything else was preserved from the prior build.
  const changed = asStrings(doc.changed);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(html);
  const importRef = useRef<HTMLInputElement>(null);

  // THE FABRIC PATH — the deterministic assembly (fabric → semantic roles →
  // Meridian → seed data), derived from the committed ontology + atlas with ZERO
  // model tokens for structure. This is the default render; the model-authored
  // build (when present) is the refined layer behind an explicit toggle.
  //
  // `assemblePrototype` is imported from `_shared` — the same module the edge
  // (`flow-portal`) imports to build the STAKEHOLDER's prototype. One copy, so
  // what the operator reviews here and what the client opens on their link cannot
  // drift. The "Refined build" toggle is operator-only: it never leaves the app.
  const assembled = useMemo(() => {
    if (!program) return null;
    try {
      // ONE DEFINITION OF "the assembled build" — the edge's own.
      //
      // This used to re-assemble by hand: ontology, atlas, parents, vocabulary,
      // theme, screen options, design, blueprint, app name — every input the
      // edge passes, listed again. It matched on all of them and still showed a
      // POORER build than the record holds, because two inputs were missing and
      // both are ones a previous round already earned:
      //   · the carried SCREEN SPEC — the widgets the model chose and the
      //     operator has already seen; and
      //   · the approved SKIN — the stylesheet a previous restyle produced.
      // So the preview looked like a plainer product than the one on the
      // record, which is what made "Fabric vs Refined" read as two designs
      // rather than as live vs as-generated.
      //
      // `prototypeBaselineOfProgram` is the function the edge builds its refine
      // baseline with: it assembles from those same inputs, applies the carried
      // spec, and re-adopts the approved skin (refusing one whose stylesheet
      // cannot parse). Calling it here means the operator's preview, the
      // stakeholder's link and the post-condition the model is judged against
      // are the same build by construction, not by a matching list of arguments.
      const inner = (() => {
        const raw = (program.rawData ?? {}) as Record<string, unknown>;
        return (typeof raw.data === "object" && raw.data !== null ? raw.data : raw) as Record<string, unknown>;
      })();
      return prototypeBaselineOfProgram(inner)?.html ?? null;
    } catch { return null; }
  }, [program]);

  /**
   * ANNOTATE — point at something in the running build and say what it should
   * be called, or that it should not be there.
   *
   * The address comes free: every element carries its `data-fabric-id`, and the
   * fabric node behind it carries the `{entity, attribute}` tuple an override is
   * keyed on. So the operator never types an address, and nothing has to parse
   * one back out of a sentence. What they write is stored as DATA and re-applied
   * by every later build — the point of the whole channel.
   */
  const [annotating, setAnnotating] = useState(false);
  const [pick, setPick] = useState<{ target: OverrideTarget; text: string } | null>(null);
  const [rename, setRename] = useState("");

  /** Fabric id → the durable tuple it stands for, derived from the SAME
   *  ontology and atlas the build was assembled from. */
  const targetsById = useMemo(() => {
    const map = new Map<string, OverrideTarget>();
    if (!program) return map;
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = (typeof raw.data === "object" && raw.data !== null ? raw.data : raw) as Record<string, unknown>;
      const fabric = deriveFabric(inner.domainOntology as Record<string, unknown>, inner.currentStateAtlas as Record<string, unknown>);
      for (const node of fabric.nodes) {
        const t = targetOfFabricNode(node);
        if (t) map.set(node.id, t);
      }
    } catch { /* no ontology yet — annotate stays unavailable */ }
    return map;
  }, [program]);

  /** What is in force right now, for the panel that lists it. */
  const inForce = useMemo(
    () => [...projectOverrides(readDesignOverrides(designOverrides ?? [])).values()],
    [designOverrides],
  );

  useEffect(() => {
    if (!annotating) return;
    const onMessage = (event: MessageEvent) => {
      const picked = readAnnotatePick(event.data);
      if (!picked) return;
      // A fabric node resolves to its own tuple. A persona's queue is not a
      // fabric node, so it carries the entity it lists instead — and that IS a
      // durable address, because it is the ontology's own name for the thing on
      // screen. Anything else has nothing a later build could find again, and is
      // refused out loud rather than swallowed.
      const target = targetsById.get(picked.fabricId)
        ?? (picked.entity ? { of: "entity", entity: picked.entity } as OverrideTarget : undefined);
      if (!target) { toast("That part of the screen isn't addressable — try a field, a table or a menu entry.", "error"); return; }
      setPick({ target, text: picked.text });
      setRename(target.of === "attribute" ? target.attribute : target.of === "entity" ? target.entity : "");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [annotating, targetsById]);

  const record = async (entry: Parameters<NonNullable<typeof onDesignOverride>>[0]) => {
    if (!onDesignOverride) return;
    await onDesignOverride(entry);
    setPick(null);
    setRename("");
  };

  // fabric is the default; fall through honestly when one side is missing


  // Re-seed the editor when the underlying build changes (a rebuild lands, or
  // a proposed edit is confirmed and flows back into the doc).
  useEffect(() => { setDraft(html); }, [html]);

  // Round-trip: bring an externally-edited project (.zip) or a single .html
  // back in. Reassemble to one self-contained document, load it into the editor
  // and switch to edit mode — the change is PROPOSED, not silently written.
  const onImportFile = async (file: File) => {
    try {
      const { html: imported, warnings } = await importPrototypeProject(file);
      setDraft(imported);
      setMode("edit");
      toast(warnings.length ? `Imported — ${warnings[0]} Review and Propose to apply.` : "Imported — review the change and Propose to apply.", warnings.length ? "error" : "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not import that file.", "error");
    }
  };

  if (!html && !assembled) {
    return (
      <div className="v3fs-proto empty">
        <div className="v3fs-emptc">
          <span className="v3fs-emptc-i" aria-hidden="true">🖥</span>
          <b className="v3fs-emptc-t">No prototype yet</b>
          <p className="v3fs-emptc-h">Once the ontology and atlas exist, the prototype assembles from them deterministically (fabric → Meridian). Use <em>Rebuild</em> above for the model-refined layer on top.</p>
        </div>
      </div>
    );
  }

  // What the preview shows: the LIVE assembly by default — the record as it
  // stands, which is also what a stakeholder's link renders — and the stored
  // snapshot behind the toggle. The editor always edits the STORED build: the
  // live assembly has no stored source to edit.
  // The live assembly, always — the stored document is only what the editor
  // proposes against and what a round-trip is diffed from.
  const shown = assembled ?? html;
  const source = mode === "edit" ? draft : shown;
  const dirty = draft !== html;

  return (
    <div className="v3fs-proto">
      <div className="v3fs-proto-bar">
        {/* The static screen-name chips were removed — they were non-interactive
            labels that did nothing. Navigation lives inside the running prototype. */}
        <div className="v3fs-proto-modes" role="group" aria-label="Prototype mode">
          <button type="button" className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>▶ Run it</button>
          {/* NOT the Experience Design surface. This edits the built prototype's HTML
              in place; Experience Design is the entity → parent-screen decision, a
              different artifact entirely. The label collided from the day that studio
              was rewritten, and an operator clicking it here expected the toggles. */}
          {onDesignOverride && targetsById.size ? (
            <button type="button" className={annotating ? "on" : ""}
              title="Point at anything in the running build and say what it should be called — or that it should not be there. What you record is kept as data and re-applied by every later build."
              onClick={() => { setAnnotating((on) => !on); setPick(null); setMode("preview"); }}>◎ Annotate</button>
          ) : null}
          {/* ONE BUILD (operator direction, 2026-08-17). There were two views —
              Live and As generated — and the second was a snapshot whose only
              unique content was the refine's in-region work. That work does not
              survive the next generation anyway (only the stylesheet carries),
              so the toggle preserved something already doomed while making it
              look durable, and offered a stale build to show in a review. The
              question it answered — "has anything moved since we generated?" —
              is answered without a second rendering now: the tile carries its
              generation stamp and the stage says when evidence moved.

              LIVE IS THE ONE THAT SURVIVES: it is what a stakeholder's link
              renders and what the refine post-condition measures against, so
              keeping the other one meant the operator could be looking at a
              build nobody else could see.

              "Edit this build" went with it, and for the same reason: it edited
              the STORED document — the snapshot — so its edits were bytes, and
              bytes are what a rebuild erases. Annotate is the editing path, and
              what it writes is data the next build re-applies. The source
              editor is still reachable from Import, where a round-trip has to
              be reviewed before it lands. */}
          {/* TAKE IT ELSEWHERE — one door over four transfer controls.
              Eight buttons sat in one row at equal weight: three that change what you
              are LOOKING AT (run it, assembled, refined) and five that move the thing
              somewhere else. Only the first group is part of reviewing a prototype;
              the rest are what you do once you have decided. Same treatment as the
              blueprint's reference sections, for the same reason. */}
        </div>
        <details className="v3fs-pt-transfer">
          <summary>Take it elsewhere — open, download, import</summary>
          <div className="v3fs-pt-transfer-b">
          {/* Open the running prototype in a real browser tab (its own URL), so it
              can be walked full-screen, shared, or opened on another device. */}
          <button type="button" title="Open the running prototype in a new browser tab" onClick={() => openPrototypeInBrowser(mode === "edit" ? draft : shown)}>↗ Open in browser</button>
          {/* External build: the prototype is self-contained, so it runs anywhere —
              download it to open standalone, share, or hand to a build team. */}
          <button type="button" title="Download the self-contained prototype as a single HTML file — runs in any browser" onClick={() => {
            const blob = new Blob([mode === "edit" ? draft : shown], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "prototype.html"; a.click();
            URL.revokeObjectURL(url);
          }}>⬇ HTML</button>
          {/* Editable project: split the single document into a real directory
              (index.html + styles.css + app.js + fixtures + tokens + README),
              zipped — so a build team or a coding agent can work in it. */}
          <button type="button" title="Download as an editable project (.zip) — separate HTML/CSS/JS + fixtures, tokens and a README, for a build team or coding agent" onClick={async () => {
            const project = buildPrototypeProject({
              html: mode === "edit" ? draft : shown,
              title: asText(doc.title),
              programName: program?.name,
              screens,
              theme: program ? paletteFor(readArtifactDoc(program, "experienceDesign")) : null,
              pack: program ? readArtifactDoc(program, "prototypePack") : null,
            });
            await downloadPrototypeZip(project, projectSlug(program?.name));
          }}>⬇ Project (.zip)</button>
          {/* Round-trip: import an externally-edited project or single HTML. The
              change is proposed via the editor, never silently overwritten. */}
          <button type="button" title="Import an edited project (.zip) or a single .html file — reassembled and loaded to propose" onClick={() => importRef.current?.click()}>⬆ Import</button>
          <input ref={importRef} type="file" accept=".zip,.html,.htm"
            style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0, pointerEvents: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onImportFile(f); }} />
          </div>
        </details>
      </div>

      {/* Refine & polish command bar — the delivery team refines the build in
          plain language (type or dictate); it re-runs the prototype-build agent. */}
      {onRefinePrototype ? <PrototypeCommandBar onRefine={onRefinePrototype} regenerating={refining} compact /> : null}

      {annotating ? (
        <div className="v3fs-anno">
          <div className="v3fs-anno-h">
            <span className="v3fs-anno-t">Annotating</span>
            <span className="v3fs-anno-hint">
              {pick ? `Selected — ${targetLabel(pick.target)}` : "Click a field, a table or a menu entry in the build below."}
            </span>
            <button type="button" className="v3fs-anno-x" onClick={() => { setAnnotating(false); setPick(null); }}>done</button>
          </div>
          {pick ? (
            <div className="v3fs-anno-panel">
              <p className="v3fs-anno-what">
                <b>{targetLabel(pick.target)}</b>
                {pick.text ? <span className="v3fs-anno-said"> — “{pick.text}”</span> : null}
              </p>
              {pick.target.of === "relation" ? null : (
                <div className="v3fs-anno-row">
                  <label className="v3fs-anno-lbl" htmlFor="anno-rename">Call it</label>
                  <input id="anno-rename" className="v3fs-anno-in" value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && rename.trim()) void record({ via: "operator", kind: "label", target: pick.target, value: rename.trim() }); }} />
                  <button type="button" className="v3fs-btn pri" disabled={!rename.trim()}
                    onClick={() => void record({ via: "operator", kind: "label", target: pick.target, value: rename.trim() })}>Rename</button>
                </div>
              )}
              <div className="v3fs-anno-row">
                {pick.target.of === "attribute" ? (
                  <button type="button" className="v3fs-btn"
                    title="Take this field off the build — the table, the detail and the form. The ontology keeps it, so the decision can be withdrawn."
                    onClick={() => void record({ via: "operator", kind: "hide", target: pick.target })}>Remove from the build</button>
                ) : null}
                <button type="button" className="v3fs-btn" onClick={() => setPick(null)}>Cancel</button>
              </div>
              {/* THE BOUNDARY, STATED WHERE IT IS CROSSED. A rule about the
                  domain put in here would live in the pixels, where the
                  questions, the seed and every downstream document cannot see
                  it. */}
              <p className="v3fs-anno-note">
                Presentation only. If what changed is a <em>rule</em> — required, or not allowed after
                something — it belongs in the ontology, where the whole chain can see it.
              </p>
            </div>
          ) : null}
          {inForce.length ? (
            <div className="v3fs-anno-list">
              <span className="v3fs-anno-list-l">In force</span>
              {inForce.map((o: DesignOverride) => (
                <span key={o.id} className="v3fs-anno-chip"
                  title={`${o.by}${o.byRole ? `, ${o.byRole}` : ""}${o.at ? ` · ${o.at.slice(0, 10)}` : ""}${o.note ? ` — “${o.note}”` : ""}`}>
                  {targetLabel(o.target)}
                  <span className="v3fs-anno-chip-v">{o.kind === "hide" ? "removed" : `→ ${o.value}`}</span>
                  {onDesignOverride ? (
                    <button type="button" className="v3fs-anno-chip-x" aria-label={`Withdraw ${targetLabel(o.target)}`}
                      title="Withdraw this decision — the build goes back to what the ontology says"
                      onClick={() => void record({ via: "operator", kind: "reset", target: o.target })}>×</button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* KEYED ON THE DECISIONS TOO. A srcDoc that changes is not reloaded by
          the browser on its own, so recording a rename left the operator looking
          at the build they had just changed with no sign it had landed — the one
          moment the feedback matters most. */}
      {mode === "preview" ? (
        <iframe className="v3fs-proto-frame" key={`${annotating ? "anno" : "plain"}:${inForce.map((o) => o.id).join(",")}`}
          sandbox="allow-scripts allow-forms" srcDoc={annotating ? withAnnotator(source) : source} title="Prototype" />
      ) : (
        <div className="v3fs-proto-edit">
          <div className="v3fs-proto-editcol">
            <label className="v3fs-proto-editlbl">
              Prototype source — your edits <b>propose</b> a change; they don&rsquo;t overwrite the record until confirmed.
            </label>
            <textarea className="v3fs-proto-src" value={draft} spellCheck={false}
              onChange={(e) => setDraft(e.target.value)} aria-label="Prototype HTML source" />
            <div className="v3fs-proto-editactions">
              <button type="button" className="v3fs-btn pri" disabled={!dirty} onClick={() => onChange({ ...doc, html: draft })}>Propose this design change</button>
              <button type="button" className="v3fs-btn" disabled={!dirty} onClick={() => setDraft(html)}>Revert</button>
            </div>
          </div>
          <iframe className="v3fs-proto-frame live" sandbox="allow-scripts allow-forms" srcDoc={draft} title="Live preview" />
        </div>
      )}

      {changed.length ? (
        <div className="v3fs-proto-refined" title="This iteration refined the prior prototype — only these screens/areas changed; everything else was preserved.">
          <span className="v3fs-proto-refined-l">↻ Refined this iteration</span>
          <div className="v3fs-proto-refined-chips">
            {changed.slice(0, 10).map((c, i) => <span key={i} className="v3fs-proto-chip ch">{c}</span>)}
            {changed.length > 10 ? <span className="v3fs-proto-chip more">+{changed.length - 10}</span> : null}
          </div>
        </div>
      ) : null}

      {(summary || generatedAt) ? (
        <p className="v3fs-proto-sum">{summary}{generatedAt ? <em> · built {generatedAt.slice(0, 10)}</em> : null}</p>
      ) : null}
    </div>
  );
}
