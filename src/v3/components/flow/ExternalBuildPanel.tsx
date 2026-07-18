/**
 * ExternalBuildPanel — build the prototype outside the app. The operator links
 * an external build (v0, Cursor, Figma Make…) and the pilots' "Open the
 * prototype" points at it (the URL is saved to show.prototypeLocation, which
 * the flow-portal edge already serves). The panel also generates an
 * IMPROVEMENT PROMPT from the evidence received — open change requests plus
 * what the pilots actually said — ready to paste into whatever tool builds the
 * prototype. Salvaged from the retired reimagined chrome (FlowNextBoard).
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { changeRequests } from "@/v3/components/flow/flowLoop";
import { readMovementInputs, movementEvidence, flowMovements } from "@/v3/components/flow/flowShellData";

export default function ExternalBuildPanel({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const stored = String(readMovementInputs(program, "show").prototypeLocation ?? "");
  const [url, setUrl] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    if (!onSaveInputs) return;
    setSaving(true); setSaved(false);
    try {
      await onSaveInputs("show", { prototypeLocation: url.trim() }, {
        attest: { action: url.trim() ? `Linked external prototype — ${url.trim()}` : "Cleared external prototype link" },
      });
      setSaved(true);
    } finally { setSaving(false); }
  };

  const reqs = changeRequests(program);
  const genPrompt = () => {
    // Validation evidence — what the pilots actually said, beyond the
    // structured change requests, so the prompt carries their own words.
    const show = flowMovements().find((m) => m.id === "show");
    const voices = (show ? movementEvidence(program, show) : [])
      .map((e) => ({ who: e.who, text: (e.excerpt || e.text || "").replace(/\s+/g, " ").trim() }))
      .filter((v) => v.text.length > 20)
      .slice(0, 8);
    const lines: string[] = [];
    lines.push(`Update the "${program.name}" prototype to address the pilot feedback below. Keep everything that already works; change only what the feedback calls out, and keep the product's domain language consistent.`);
    lines.push("");
    if (reqs.length) {
      lines.push("Change requests to address:");
      reqs.forEach((c, i) => lines.push(`${i + 1}. [${c.area}] ${c.stakeholder}${c.blocking ? " — BLOCKING objection" : ""}: ${c.ask || c.verdict}`));
      lines.push("");
    }
    if (voices.length) {
      lines.push("What the pilots said (verbatim evidence):");
      voices.forEach((v) => lines.push(`- ${v.who}: "${v.text.slice(0, 220)}"`));
      lines.push("");
    }
    if (!reqs.length && !voices.length) {
      lines.push("No pilot feedback yet — the pilots haven't asked for changes. Use this once their feedback lands.");
      lines.push("");
    }
    lines.push("Return the updated build; preserve the existing structure and styling unless the feedback requires otherwise.");
    setPrompt(lines.join("\n"));
    setCopied(false);
  };
  const copyPrompt = async () => {
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { /* clipboard denied — the box is selectable */ }
  };

  return (
    <div className="v3fs-nb-ext">
      <div className="v3fs-nb-ext-eyebrow">Build outside the app</div>
      <p className="v3fs-nb-ext-sub">Prototype in your own tool (v0, Cursor, Figma Make…) and link it here — the pilots’ “Open the prototype” points at your build.</p>
      <div className="v3fs-nb-ext-row">
        <input className="v3fs-nb-ext-in" type="url" value={url} placeholder="https://your-prototype.example.com"
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }} aria-label="External prototype URL" />
        <button type="button" className="v3fs-nb-open" disabled={!onSaveInputs || saving || url.trim() === stored} onClick={() => void save()}>{saving ? "Saving…" : "Save link"}</button>
        {url.trim() ? <a className="v3fs-nb-open ghost" href={url.trim()} target="_blank" rel="noreferrer">Open ↗</a> : null}
      </div>
      {saved ? <p className="v3fs-nb-ext-ok">✓ Linked — the pilots now open this build.</p> : null}
      <div className="v3fs-nb-ext-prompt">
        <button type="button" className="v3fs-nb-open ghost" onClick={genPrompt}>✳ Generate improvement prompt from evidence{reqs.length ? ` (${reqs.length} change request${reqs.length === 1 ? "" : "s"})` : ""}</button>
        {prompt !== null ? (
          <>
            <textarea className="v3fs-nb-ext-ta" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} rows={Math.min(14, prompt.split("\n").length + 1)} />
            <button type="button" className="v3fs-nb-open" onClick={() => void copyPrompt()}>{copied ? "✓ Copied" : "Copy prompt"}</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
