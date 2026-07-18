/**
 * PortalAttach — the paper-clip on every linked-page input field.
 *
 * One shared mechanism: the file goes to the flow-portal `extract` endpoint
 * (which stores the original and returns its text, refined to the question
 * when possible), the TEXT is appended into the field the clip sits on —
 * visible and editable, so the respondent sees exactly what will be sent —
 * and the field's normal submission carries it. The stored original rides as
 * a `documents` reference on submissions that support it (the interview
 * pack); everywhere else the in-field text IS the record.
 */
import { useState } from "react";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

export type PortalDoc = { name: string; sourceKey?: string };
export type PortalAttachFn = (key: string, file: File, context: string, append: (text: string) => void) => Promise<void>;

export function usePortalAttach(token: string) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, PortalDoc[]>>({});
  const attach: PortalAttachFn = async (key, file, context, append) => {
    setBusyKey(key);
    setNote(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, extract: { file: btoa(binary), mime: file.type || "", filename: file.name, question: context } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.text !== "string") {
        setNote(typeof body.error === "string" ? body.error : "Could not read that file.");
        return;
      }
      const heading = `From "${file.name}"${body.refined === true ? " (the relevant part)" : ""}:`;
      append(`${heading}\n${body.text}`);
      setDocs((current) => ({ ...current, [key]: [...(current[key] ?? []), {
        name: file.name,
        sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : undefined,
      }] }));
    } catch {
      setNote("Could not read that file.");
    } finally {
      setBusyKey(null);
    }
  };
  const removeDoc = (key: string, index: number) =>
    setDocs((current) => ({ ...current, [key]: (current[key] ?? []).filter((_, i) => i !== index) }));
  return { busyKey, note, docs, attach, removeDoc };
}

/** The clip itself — a compact 📎 beside an input, with the attached-file
 * chips. `label` swaps the bare clip for the fuller "⌲ Attach a document"
 * treatment the question cards use. */
export function AttachClip({ fieldKey, context, busyKey, docs, onFile, onRemove, label }: {
  fieldKey: string;
  context: string;
  busyKey: string | null;
  docs?: PortalDoc[];
  onFile: (file: File) => void;
  onRemove?: (index: number) => void;
  label?: string;
}) {
  const busy = busyKey === fieldKey;
  return (
    <span className="v3fs-clip-row">
      {(docs ?? []).map((doc, index) => (
        <span key={index} className="v3fs-portal-att-chip">
          {doc.name}
          {onRemove ? (
            <button type="button" aria-label={`Remove ${doc.name}`} onClick={() => onRemove(index)}>×</button>
          ) : null}
        </span>
      ))}
      <label className={label ? "v3fs-portal-att-add" : "v3fs-clip"} title={`Attach a file — its text is added to "${context}"`}>
        {busy ? (label ? "Reading…" : "…") : (label ?? "📎")}
        <input type="file" hidden disabled={busyKey !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }} />
      </label>
    </span>
  );
}
