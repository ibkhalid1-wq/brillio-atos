/**
 * Prototype Build studio — the Envision "Build" output. The Prototype Build
 * agent assembles the Experience Design's screens, the Blueprint's agents and
 * the seed fixtures into a SELF-CONTAINED clickable HTML app (doc.html). This
 * studio renders it in a sandboxed iframe and gives the Experience Designer an
 * edit mode to refine it — edits propose a change, they never silently
 * overwrite the record. Show demonstrates this same built prototype to clients.
 */
import { useEffect, useRef, useState } from "react";
import { asArray, asRecord, asStrings, asText, type StudioProps } from "./StudioKit";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
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

  if (!html) {
    return (
      <div className="v3fs-proto empty">
        <div className="v3fs-emptc">
          <span className="v3fs-emptc-i" aria-hidden="true">🖥</span>
          <b className="v3fs-emptc-t">No prototype built yet</b>
          <p className="v3fs-emptc-h">The Prototype Build assembles the Experience Design, the Blueprint&rsquo;s agents and the seed fixtures into a clickable app. Use <em>Rebuild</em> above to build it — then the Experience Designer can refine it here.</p>
        </div>
      </div>
    );
  }

  const source = mode === "edit" ? draft : html;
  const dirty = draft !== html;

  return (
    <div className="v3fs-proto">
      <div className="v3fs-proto-bar">
        {/* The static screen-name chips were removed — they were non-interactive
            labels that did nothing. Navigation lives inside the running prototype. */}
        <div className="v3fs-proto-modes" role="group" aria-label="Prototype mode">
          <button type="button" className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>▶ Run it</button>
          <button type="button" className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>✎ Experience Designer</button>
          {/* Open the running prototype in a real browser tab (its own URL), so it
              can be walked full-screen, shared, or opened on another device. */}
          <button type="button" title="Open the running prototype in a new browser tab" onClick={() => openPrototypeInBrowser(mode === "edit" ? draft : html)}>↗ Open in browser</button>
          {/* External build: the prototype is self-contained, so it runs anywhere —
              download it to open standalone, share, or hand to a build team. */}
          <button type="button" title="Download the self-contained prototype as a single HTML file — runs in any browser" onClick={() => {
            const blob = new Blob([mode === "edit" ? draft : html], { type: "text/html" });
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
              html: mode === "edit" ? draft : html,
              title: asText(doc.title),
              programName: program?.name,
              screens,
              theme: program ? asRecord(readArtifactDoc(program, "experienceDesign")?.theme ?? {}) : null,
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
              Prototype source — the Experience Designer&rsquo;s edits <b>propose</b> a change; they don&rsquo;t overwrite the record until confirmed.
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
