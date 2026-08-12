/**
 * Capture inputs — the two roads from the world into the record: attach a
 * file (extracted server-side, reviewed before it lands) or transcribe a
 * recording (audio never stored). Shared by the collect board, the meeting
 * kit and the Library attach flow.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Copy fallback that can never take the app down: window.prompt() is
 * unsupported in some embedded contexts and THROWS — a failed copy must
 * stay a quiet no-op, never an unhandled rejection. */
export function safePrompt(message: string, value: string): void {
  try { window.prompt(message, value); } catch { /* clipboard and prompt both unavailable */ }
}

/**
 * Copy text the click still has to PRODUCE (a mint, a fetch) without losing
 * the user gesture. Awaiting the mint first expires the activation window and
 * the copy throws — the old two-step "create, then copy again". A
 * ClipboardItem can carry a PROMISE, so the clipboard is claimed
 * synchronously inside the click and the text lands when the work resolves:
 * one click, created AND copied. Falls back to a plain writeText, then to
 * the visible prompt. Returns the produced text; null when production failed.
 */
export async function copyTextFromAction(
  produce: () => Promise<string | null>,
  promptLabel = "Copy the link:",
): Promise<string | null> {
  const pending = produce();
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/plain": pending.then((text) => {
          if (!text) throw new Error("nothing to copy");
          return new Blob([text], { type: "text/plain" });
        }),
      });
      await navigator.clipboard.write([item]);
      return await pending;
    } catch { /* fall through — pending is shared, the mint runs once */ }
  }
  const text = await pending.catch(() => null);
  if (!text) return null;
  try { await navigator.clipboard.writeText(text); }
  catch { safePrompt(promptLabel, text); }
  return text;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Any document → reviewable text via flow-extract (decode, Office XML, or the
 * model reading PDFs/images natively). The operator reads the extraction in
 * the form before "Add the document" makes it evidence — nothing lands blind. */
/**
 * `onFile` hands the caller the RAW file alongside the extraction.
 *
 * The edge returns prose — the right shape for evidence, and the wrong shape for a
 * data dictionary, whose value is in its columns. A caller that wants to notice
 * "this attachment is also a dictionary" has to read the bytes itself, and cannot
 * do that from text the edge has already flattened. The attachment still becomes
 * evidence either way; this only lets the caller offer the second reading.
 */
export function AttachFileButton({ programId, onExtracted, onFile }: {
  programId: string;
  onExtracted: (filename: string, text: string, sourceKey?: string) => void;
  onFile?: (file: File) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const ingest = async (file: File) => {
    setBusy(true);
    setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("flow-extract", {
        body: { file: await fileToBase64(file), mime: file.type || "", filename: file.name, store: true, programId },
      });
      if (error) {
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        setNote((detail as { error?: string } | null)?.error ?? "Could not read that file — paste the text instead.");
        return;
      }
      const text = typeof (data as { text?: string } | null)?.text === "string" ? (data as { text: string }).text : "";
      const sourceKey = typeof (data as { sourceKey?: string } | null)?.sourceKey === "string" ? (data as { sourceKey: string }).sourceKey : undefined;
      if (text) onExtracted(file.name, text, sourceKey);
      else setNote("The file produced no readable text.");
    } catch {
      setNote("Could not read that file — paste the text instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v3fs-kit-rec">
      <input ref={inputRef} type="file" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          onFile?.(file);            // the caller's own reading, before the edge flattens it
          void ingest(file);
        }} />
      <button type="button" className="v3fs-a" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Reading…" : "⌲ Attach a file — PDF, Word, Excel, text…"}
      </button>
      {note ? <span className="v3fs-kit-rec-note">{note}</span> : null}
    </div>
  );
}

/** Recording → reviewable text. The audio is transcribed server-side and the
 * transcript lands in the capture box for the operator to READ before it
 * becomes evidence — the recording itself is never stored. Hidden after a
 * 501 (transcription not configured on the project). */
let transcribeAvailable: boolean | null = null;
let transcribeProbeInFlight: Promise<void> | null = null;

export function TranscribeButton({ onText }: { onText: (transcript: string) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "unavailable">("idle");
  const [note, setNote] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Probe once per session: an empty POST answers 501 before any body
  // validation when the key is missing, so the button never advertises a
  // feature the project can't deliver.
  useEffect(() => {
    if (transcribeAvailable !== null) {
      if (!transcribeAvailable) setState("unavailable");
      return;
    }
    const probe = transcribeProbeInFlight ??= supabase.functions.invoke("flow-transcribe", { body: {} }).then(({ error }: { error: unknown }) => {
      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      transcribeAvailable = status !== 501;
    });
    void probe.then(() => { if (!transcribeAvailable) setState("unavailable"); });
  }, []);
  if (state === "unavailable") return null;

  const ingest = async (file: File) => {
    setState("busy");
    setNote(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
      }
      const { data, error } = await supabase.functions.invoke("flow-transcribe", {
        body: { audio: btoa(binary), mime: file.type || "audio/webm", filename: file.name },
      });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 501) { setState("unavailable"); return; }
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        setNote((detail as { error?: string } | null)?.error ?? "Transcription failed — paste the notes instead.");
        setState("idle");
        return;
      }
      const text = typeof (data as { text?: string } | null)?.text === "string" ? (data as { text: string }).text : "";
      if (text) onText(text); else setNote("The recording produced no speech to transcribe.");
      setState("idle");
    } catch {
      setNote("Could not read that file — paste the notes instead.");
      setState("idle");
    }
  };

  return (
    <div className="v3fs-kit-rec">
      <input ref={inputRef} type="file" accept="audio/*,video/webm,video/mp4" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void ingest(file);
        }} />
      <button type="button" className="v3fs-a" disabled={state === "busy"} onClick={() => inputRef.current?.click()}>
        {state === "busy" ? "Transcribing\u2026" : "\u2b06 Transcribe a recording"}
      </button>
      {note ? <span className="v3fs-kit-rec-note">{note}</span> : null}
    </div>
  );
}
