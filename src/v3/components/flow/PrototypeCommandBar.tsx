/**
 * The prototype refine-and-polish command bar — the delivery team types a
 * plain-language polish instruction; `onRefine` stashes it on Envision's inputs
 * and re-runs the prototype-build agent, so the refined build replaces the
 * current one.
 *
 * IT IS AN INSTRUMENT, NOT A SEARCH BOX. An unlabelled input floating above the
 * prototype told the operator nothing about what it did to the thing below it:
 * what a refine is allowed to change, what it must preserve, and what survives
 * into the NEXT generation. That last one was asked out loud, twice. So the bar
 * now says who it is (a heading), offers openings in the vocabulary the refine
 * contract actually accepts (the starters — every one of them presentation, so
 * none can be refused), and keeps the carry rules one disclosure away instead of
 * in a handover document.
 */
import { useRef, useState } from "react";

interface Attachment { name: string; text: string }
const MAX_ATTACH = 6;
const MAX_CHARS = 8000;

/**
 * OPENINGS THE CONTRACT CAN ACCEPT. `REFINE_CONTRACT` lets a refine move
 * presentation — spacing, hierarchy, type, colour, density, elevation, the
 * component vocabulary, the chrome — and forbids it from moving structure,
 * navigation or records. Every starter here sits on the allowed side, so
 * clicking one cannot produce the "I refused that, see gaps" round-trip that a
 * blank prompt invites. They FILL the line rather than submitting it: the
 * operator's own wording is the point, and these are where it starts.
 */
const STARTERS = [
  "Tighten the density — less padding, more rows in view",
  "Stronger type hierarchy: larger screen titles, quieter field labels",
  "Warmer palette, higher contrast on the primary actions",
  "More elevation and softer corners on the cards",
];

export default function PrototypeCommandBar({
  onRefine, regenerating, compact, placeholder, busyLabel, allowAttach = true,
  heading = "Refine & polish", starters = STARTERS, showKeeps = true,
}: {
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
  /** What this bar is. Empty string draws no heading — for a surface that
   *  already titles the region it sits in. */
  heading?: string;
  /** Openings offered under the line. Pass `[]` for a bare command line. */
  starters?: string[];
  /** The carry rules disclosure. Prototype-specific — off for other artifacts,
   *  whose refine has no skin and no accepted spec to carry. */
  showKeeps?: boolean;
}) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    <div className={`v3fs-refine${compact ? " compact" : ""}${working ? " working" : ""}`}>
      {heading ? (
        <div className="v3fs-refine-h">
          <span className="v3fs-refine-t">{heading}</span>
          {/* THE CONTRACT, IN ONE LINE. The model is held to this by
              `checkRefinedPrototype`; saying it here is what stops an operator
              asking for a screen to be added and reading the refusal as a bug. */}
          <span className="v3fs-refine-scope">presentation only — screens, records and controls are preserved</span>
        </div>
      ) : null}

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
        <input ref={inputRef} className="v3fs-protocmd-in" value={cmd} disabled={working}
          placeholder={placeholder ?? "Describe the polish — e.g. “tighten the spacing and give the dashboard a card grid”"}
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

      {/* A BLANK LINE ASKS THE OPERATOR TO INVENT THE VOCABULARY. Hidden once
          they have started typing — an opening is only useful before the first
          word — and while a round is in flight, when nothing here can be sent. */}
      {starters.length && !cmd.trim() && !working ? (
        <div className="v3fs-refine-starters">
          <span className="v3fs-refine-starters-l">try</span>
          {starters.map((s) => (
            <button key={s} type="button" className="v3fs-refine-starter"
              title="Put this on the command line — edit it before sending"
              onClick={() => { setCmd(s); inputRef.current?.focus(); }}>{s}</button>
          ))}
        </div>
      ) : null}

      {/* The refine takes a minute or more and replaces what is on screen; a
          label swap on one button is not enough to say so. Announced, not just
          drawn, because the operator is usually looking at the prototype. */}
      {working ? (
        <p className="v3fs-refine-busy" role="status">
          Restyling the current build — every screen, record and control is kept; only presentation moves.
        </p>
      ) : null}

      {showKeeps ? (
        <details className="v3fs-refine-keeps">
          <summary>what a refine keeps, and what the next generation inherits</summary>
          <ul>
            <li>
              <b>This round.</b> Structure, navigation, seeded records and every working
              control are preserved — an answer that drops them is rejected and the
              assembled build is kept instead.
            </li>
            <li>
              <b>Into the next generation.</b> The stylesheet you approved is carried
              onto the newly assembled build, and so are the widgets a previous round
              accepted. Rounds accumulate rather than reset.
            </li>
            <li>
              <b>What does not carry.</b> The skeleton is re-derived from the ontology
              every time, so presentation applied to individual regions is not
              inherited — only the stylesheet is. If a change upstream adds or removes
              a region, the skin no longer fits the build and the next one starts from
              the stock sheet.
            </li>
          </ul>
        </details>
      ) : null}
    </div>
  );
}
