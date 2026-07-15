/**
 * Prototype Build studio — the Envision "Build" output. The Prototype Build
 * agent assembles the Experience Design's screens, the Blueprint's agents and
 * the seed fixtures into a SELF-CONTAINED clickable HTML app (doc.html). This
 * studio renders it in a sandboxed iframe and gives the Experience Designer an
 * edit mode to refine it — edits propose a change, they never silently
 * overwrite the record. Show demonstrates this same built prototype to clients.
 */
import { useEffect, useState } from "react";
import { asArray, asRecord, asText, type StudioProps } from "./StudioKit";

export default function PrototypeStudio({ doc, onChange }: StudioProps) {
  const html = asText(doc.html);
  const screens = asArray(doc.screens).map(asRecord);
  const summary = asText(doc.summary);
  const generatedAt = asText(doc.generatedAt);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(html);

  // Re-seed the editor when the underlying build changes (a rebuild lands, or
  // a proposed edit is confirmed and flows back into the doc).
  useEffect(() => { setDraft(html); }, [html]);

  if (!html) {
    return (
      <div className="v3fs-proto empty">
        <div className="v3fs-proto-emptyc">
          <span className="v3fs-proto-emptyi" aria-hidden="true">🖥</span>
          <b>No prototype built yet</b>
          <p>The Prototype Build assembles the Experience Design, the Blueprint&rsquo;s agents and the seed fixtures into a clickable app. Use <em>Rebuild</em> above to build it — then the Experience Designer can refine it here.</p>
        </div>
      </div>
    );
  }

  const source = mode === "edit" ? draft : html;
  const dirty = draft !== html;

  return (
    <div className="v3fs-proto">
      <div className="v3fs-proto-bar">
        <div className="v3fs-proto-screens">
          {screens.slice(0, 8).map((s, i) => (
            <span key={i} className="v3fs-proto-chip" title={asText(s.purpose)}>{asText(s.name) || asText(s.id) || `Screen ${i + 1}`}</span>
          ))}
          {screens.length > 8 ? <span className="v3fs-proto-chip more">+{screens.length - 8}</span> : null}
        </div>
        <div className="v3fs-proto-modes" role="group" aria-label="Prototype mode">
          <button type="button" className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>▶ Run it</button>
          <button type="button" className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>✎ Experience Designer</button>
          {/* External build: the prototype is self-contained, so it runs anywhere —
              download it to open standalone, share, or hand to a build team. */}
          <button type="button" title="Download the self-contained prototype — runs in any browser, or hand it to a build team" onClick={() => {
            const blob = new Blob([mode === "edit" ? draft : html], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "prototype.html"; a.click();
            URL.revokeObjectURL(url);
          }}>⬇ Export</button>
        </div>
      </div>

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

      {(summary || generatedAt) ? (
        <p className="v3fs-proto-sum">{summary}{generatedAt ? <em> · built {generatedAt.slice(0, 10)}</em> : null}</p>
      ) : null}
    </div>
  );
}
