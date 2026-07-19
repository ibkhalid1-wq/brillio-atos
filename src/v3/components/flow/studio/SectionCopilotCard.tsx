/**
 * SectionCopilotCard — a Copilot command card on a design-team artifact tab
 * (Architecture Strategy, Experience Design, Agentic Blueprint). The operator
 * types (or dictates) a plain-language command to refine THIS section and can
 * attach reference documents; on submit the command — with the attached text
 * folded in — is stashed on the artifact's `_refine_<fieldKey>` input (the
 * generator's highest-priority guidance) and the artifact is regenerated.
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";
import { AttachFileButton } from "@/v3/components/flow/flowCapture";

const MAX_DOC_CHARS = 8000;

export default function SectionCopilotCard({ program, sectionLabel, placeholder, refining, onRefine }: {
  program: ProgramSummary;
  /** Human name of the section, e.g. "the architecture strategy". */
  sectionLabel: string;
  placeholder?: string;
  refining?: boolean;
  /** Stash the command on the artifact and regenerate it. */
  onRefine: (instruction: string) => Promise<void> | void;
}) {
  const [cmd, setCmd] = useState("");
  const [docs, setDocs] = useState<Array<{ name: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const working = busy || !!refining;

  const submit = async () => {
    const instruction = cmd.trim();
    if ((!instruction && !docs.length) || working) return;
    const combined = (instruction || `Apply the attached document(s) to ${sectionLabel}.`)
      + (docs.length ? `\n\nAttached document(s):\n${docs.map((d) => `--- ${d.name} ---\n${d.text}`).join("\n\n")}` : "");
    setBusy(true);
    try { await onRefine(combined); setCmd(""); setDocs([]); } finally { setBusy(false); }
  };

  return (
    <div className={`v3fs-copilotcard${working ? " working" : ""}`}>
      <div className="v3fs-copilotcard-h">
        <span className="v3fs-copilotcard-spark" aria-hidden="true">{working ? <i className="v3fs-protocmd-spin" /> : "✦"}</span>
        <b>Copilot</b>
        <span className="v3fs-copilotcard-sub">Refine {sectionLabel} — type or speak a command, attach a document.</span>
      </div>
      {docs.length ? (
        <div className="v3fs-copilotcard-docs" aria-label="Attached documents">
          {docs.map((d, i) => (
            <span key={i} className="v3fs-protocmd-file">
              <span className="v3fs-protocmd-file-ic" aria-hidden="true">▤</span>
              <span className="v3fs-protocmd-file-n">{d.name}</span>
              <button type="button" className="v3fs-protocmd-file-x" aria-label={`Remove ${d.name}`} disabled={working}
                onClick={() => setDocs(docs.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <form className="v3fs-copilotcard-row" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input className="v3fs-copilotcard-in" value={cmd} disabled={working}
          placeholder={placeholder ?? `e.g. "add a resilience option", "score cost lower", "tighten the recommendation"`}
          onChange={(e) => setCmd(e.target.value)} aria-label={`Command to refine ${sectionLabel}`} />
        <DictationButton compact label="Speak your command" onText={(spoken) => setCmd((cur) => joinDictation(cur, spoken))} />
        <AttachFileButton programId={program.id}
          onExtracted={(name, text) => setDocs((cur) => [...cur, { name, text: text.slice(0, MAX_DOC_CHARS) }])} />
        <button type="submit" className="v3fs-copilotcard-send" disabled={working || (!cmd.trim() && !docs.length)}>
          {refining ? "Refining…" : busy ? "Sending…" : "Refine"}
        </button>
      </form>
    </div>
  );
}
