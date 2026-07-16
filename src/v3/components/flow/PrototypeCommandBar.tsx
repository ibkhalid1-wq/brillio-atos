/**
 * The prototype refine-and-polish command bar — shared by BOTH prototype views:
 * the Design-side Prototype Build studio and the Validate-side Prototype tab.
 * The delivery team types a plain-language polish instruction; `onRefine`
 * stashes it on Envision's inputs and re-runs the prototype-build agent, so the
 * refined build replaces the current one.
 */
import { useRef, useState } from "react";

interface Attachment { name: string; text: string }
const MAX_ATTACH = 6;
const MAX_CHARS = 8000;

export default function PrototypeCommandBar({ onRefine, regenerating, compact, placeholder, busyLabel, allowAttach = true }: {
  onRefine: (instruction: string) => Promise<void> | void;
  regenerating?: boolean;
  /** Tighter padding for the in-studio bar. */
  compact?: boolean;
  /** Override the input placeholder (design tabs word it per artifact). */
  placeholder?: string;
  /** Override the regenerating-state button label (default "Polishing…"). */
  busyLabel?: string;
  /** Show the attach-files affordance (Prototype Build command line). */
  allowAttach?: boolean;
}) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const working = busy || regenerating;

  const addFiles = async (list: FileList) => {
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_ATTACH) break;
      try { next.push({ name: f.name, text: (await f.text()).slice(0, MAX_CHARS) }); } catch { /* unreadable — skip */ }
    }
    setFiles(next.slice(0, MAX_ATTACH));
  };

  const submit = async () => {
    const instruction = cmd.trim();
    if ((!instruction && !files.length) || working) return;
    // Fold attached reference files into the instruction the build agent reads.
    const combined = (instruction || "Apply the attached reference file(s) to the prototype.")
      + (files.length ? `\n\nAttached reference file(s):\n${files.map((f) => `--- ${f.name} ---\n${f.text}`).join("\n\n")}` : "");
    setBusy(true);
    try { await onRefine(combined); setCmd(""); setFiles([]); } finally { setBusy(false); }
  };

  return (
    <>
      {files.length ? (
        <div className="v3fs-protocmd-files" aria-label="Attached files">
          {files.map((f, i) => (
            <span key={i} className="v3fs-protocmd-file">
              <span className="v3fs-protocmd-file-ic" aria-hidden="true">▤</span>
              <span className="v3fs-protocmd-file-n">{f.name}</span>
              <button type="button" className="v3fs-protocmd-file-x" aria-label={`Remove ${f.name}`} disabled={working}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <form className={`v3fs-protocmd${compact ? " compact" : ""}${working ? " working" : ""}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <span className="v3fs-protocmd-spark" aria-hidden="true">{working ? <i className="v3fs-protocmd-spin" /> : "✦"}</span>
        <input className="v3fs-protocmd-in" value={cmd} disabled={working}
          placeholder={placeholder ?? "Refine & polish the prototype — e.g. “make the dashboard a card grid, add a sticky header, tighten spacing”"}
          onChange={(e) => setCmd(e.target.value)} aria-label="Refine the prototype with a plain-language instruction" />
        {allowAttach ? (
          <>
            <button type="button" className="v3fs-protocmd-clip" disabled={working || files.length >= MAX_ATTACH}
              title={files.length >= MAX_ATTACH ? `Up to ${MAX_ATTACH} files` : "Attach reference files (design notes, specs, sample data)"}
              onClick={() => fileRef.current?.click()} aria-label="Attach files">📎</button>
            <input ref={fileRef} type="file" multiple accept=".txt,.md,.html,.htm,.css,.json,.csv,.js,.ts,.tsx,.svg,text/*"
              style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0, pointerEvents: "none" }}
              onChange={(e) => { const l = e.target.files; e.target.value = ""; if (l && l.length) void addFiles(l); }} />
          </>
        ) : null}
        <button type="submit" className="v3fs-protocmd-btn" disabled={working || (!cmd.trim() && !files.length)}>
          {regenerating ? (busyLabel ?? "Polishing…") : busy ? "Sending…" : <>Refine<kbd className="v3fs-protocmd-kbd">↵</kbd></>}
        </button>
      </form>
    </>
  );
}
