/**
 * Voice input — browser dictation (Web Speech API) that types into whatever
 * field it's attached to. The respondent reviews and edits before sending, so
 * the submit path stays text-through-quarantine either way. Renders nothing
 * when the browser has no speech recognition (Firefox), so callers can drop it
 * anywhere without a capability check.
 *
 * Shared by the interview/demo form (FlowRespond) and the visual review
 * surfaces (FlowReviewSurface / FlowReviewVisuals).
 */
import { useEffect, useRef, useState } from "react";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  && typeof MediaRecorder !== "undefined" && !!import.meta.env.VITE_SUPABASE_URL;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SpeechRecognitionCtor: (new () => SpeechRecognitionLike) | undefined = typeof window !== "undefined"
  ? ((window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined
  : undefined;

/** True when the browser can dictate — callers can gate a whole "voice mode". */
export const dictationSupported = !!SpeechRecognitionCtor;

/** Append a dictated sentence to what's already typed, with sane spacing. */
export function joinDictation(existing: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return existing;
  const lead = text.charAt(0).toUpperCase() + text.slice(1);
  return existing.trim() ? `${existing.replace(/\s+$/, "")} ${lead}` : lead;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** flow-transcribe answers 501 before it validates anything when the project has
 *  no OPENAI_API_KEY. Probed once per session and remembered, exactly as
 *  `TranscribeButton` (flowCapture.tsx) does it — one rule, two render sites. */
let transcribeAvailable: boolean | null = null;
let transcribeProbe: Promise<void> | null = null;

/**
 * The fallback for browsers with no live dictation (Firefox): record audio and
 * transcribe it server-side (flow-transcribe), then drop the text in the field.
 *
 * SELF-HIDES when flow-transcribe isn't configured. A mic that records the
 * stakeholder's answer and then silently drops it is worse than no mic: they
 * believe they have answered. Typing is always there underneath, so the graceful
 * degradation is to offer only what the project can actually deliver.
 */
function AudioRecordButton({ onText, compact, label }: { onText: (s: string) => void; compact?: boolean; label?: string }) {
  const [state, setState] = useState<"idle" | "recording" | "working" | "unavailable">("idle");
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => () => { recRef.current?.state === "recording" && recRef.current.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => {
    if (transcribeAvailable !== null) { if (!transcribeAvailable) setState("unavailable"); return; }
    transcribeProbe ??= fetch(`${FUNCTIONS_BASE}/flow-transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: "{}",
    }).then((res) => { transcribeAvailable = res.status !== 501; })
      .catch(() => { transcribeAvailable = true; });   // a network blip is not a verdict on the feature
    void transcribeProbe.then(() => { if (!transcribeAvailable) setState("unavailable"); });
  }, []);

  const stop = () => { if (recRef.current?.state === "recording") recRef.current.stop(); };
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1200) { setState("idle"); return; }
        setState("working");
        try {
          const audio = await blobToBase64(blob);
          const res = await fetch(`${FUNCTIONS_BASE}/flow-transcribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
            body: JSON.stringify({ audio, mime: blob.type }),
          });
          if (res.status === 501) { transcribeAvailable = false; setState("unavailable"); return; }
          const body = await res.json().catch(() => ({}));
          if (res.ok && typeof body.text === "string" && body.text.trim()) { onText(body.text.trim()); setNote(null); }
          // NEVER a silent drop: they spoke, and if nothing came back they have to
          // be told, with something they can actually do about it.
          else setNote("That recording didn’t come back as text — please type it instead.");
        } catch { setNote("That recording didn’t come back as text — please type it instead."); }
        setState("idle");
      };
      recRef.current = rec;
      rec.start();
      setNote(null);
      setState("recording");
    } catch { setState("idle"); }
  };

  if (state === "unavailable") return null;
  const cls = compact ? "v3fs-micdot" : "v3fs-mic";
  const busy = state === "working";
  const button = (
    <button type="button" className={`${cls}${state === "recording" ? " on" : ""}`} disabled={busy}
      aria-pressed={state === "recording"} onClick={() => (state === "recording" ? stop() : void start())}
      title={state === "recording" ? "Stop and transcribe" : busy ? "Transcribing…" : (label || "Record your answer")}>
      {compact ? <span aria-hidden="true">{busy ? "…" : state === "recording" ? "◉" : "🎙"}</span>
        : (busy ? "Transcribing…" : state === "recording" ? "◉ Recording… tap to stop" : `🎙 ${label || "Record your answer"}`)}
    </button>
  );
  if (!note) return button;
  return <span className="v3fs-mic-wrap">{button}<span className="v3fs-kit-rec-note">{note}</span></span>;
}

/**
 * A mic that dictates into a field. `compact` renders a small icon button
 * (for sitting inside/next to an input); the default is the labelled button.
 * Falls back to record-and-transcribe where the browser has no live dictation.
 */
export function DictationButton({ onText, compact, label }: {
  onText: (spoken: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognizerRef.current?.stop(), []);
  if (!SpeechRecognitionCtor) {
    return canRecord ? <AudioRecordButton onText={onText} compact={compact} label={label} /> : null;
  }
  const toggle = () => {
    if (listening) { recognizerRef.current?.stop(); return; }
    const recognizer = new SpeechRecognitionCtor();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = navigator.language || "en-US";
    recognizer.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) onText(result[0].transcript);
      }
    };
    recognizer.onend = () => setListening(false);
    recognizer.onerror = () => setListening(false);
    recognizerRef.current = recognizer;
    recognizer.start();
    setListening(true);
  };
  if (compact) {
    return (
      <button type="button" className={`v3fs-micdot${listening ? " on" : ""}`} aria-pressed={listening}
        onClick={toggle} title={listening ? "Stop dictating" : (label || "Speak instead of typing")}>
        <span aria-hidden="true">{listening ? "◉" : "🎙"}</span>
      </button>
    );
  }
  return (
    <button type="button" className={`v3fs-mic${listening ? " on" : ""}`} aria-pressed={listening} onClick={toggle}
      title={listening ? "Stop — what you said stays in the field" : "Speak instead of typing — you can edit before sending"}>
      {listening ? "◉ Listening… tap to stop" : `🎙 ${label || "Speak your answer"}`}
    </button>
  );
}
