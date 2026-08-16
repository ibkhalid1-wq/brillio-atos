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

export default function PrototypeStudio({ doc, onChange, program, onRefinePrototype, refining }: StudioProps) {
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
  const [view, setView] = useState<"fabric" | "build">("fabric");
  // fabric is the default; fall through honestly when one side is missing
  const effectiveView: "fabric" | "build" = assembled && (view === "fabric" || !html) ? "fabric" : "build";

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
  const shown = effectiveView === "fabric" && assembled ? assembled : html;
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
          {html ? <button type="button" className={mode === "edit" ? "on" : ""} title="Edit this build's screens and markup in place — the assembled prototype is regenerated, so edits belong on the refined build" onClick={() => setMode("edit")}>✎ Edit this build</button> : null}
          {/* LIVE vs AS GENERATED — not two designs, one freshness comparison.
              Both now assemble from the same inputs, carry the same accepted
              screen spec and wear the same approved skin; Live is rebuilt from
              the record on every render, while the stored build is the snapshot
              its "Generated …" stamp names. The old labels (Fabric / Refined
              build) described how each was produced, which read as a choice
              between two products.
              The fabric assembly is the deterministic
              default (0 model tokens for structure); the model-refined build is
              the layer on top, reachable when it exists. */}
          {assembled && html ? (<>
            <button type="button" className={effectiveView === "fabric" ? "on" : ""} title="Assembled from the record as it stands right now — the current ontology, atlas and design, wearing the approved skin and carrying the widgets a previous round accepted. This is what a stakeholder opens on their link." onClick={() => { setView("fabric"); setMode("preview"); }}>◇ Live</button>
            <button type="button" className={effectiveView === "build" ? "on" : ""} title="The build stored on the record, exactly as it was generated — a snapshot. It is what the editor edits and what Export downloads; compare it with Live to see what has moved since." onClick={() => setView("build")}>✦ As generated</button>
          </>) : null}
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

      {mode === "preview" ? (
        <iframe className="v3fs-proto-frame" sandbox="allow-scripts allow-forms" srcDoc={source} title="Prototype" />
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
