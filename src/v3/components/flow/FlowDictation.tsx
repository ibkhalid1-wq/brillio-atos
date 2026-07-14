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

/**
 * A mic that dictates into a field. `compact` renders a small icon button
 * (for sitting inside/next to an input); the default is the labelled button.
 */
export function DictationButton({ onText, compact, label }: {
  onText: (spoken: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognizerRef.current?.stop(), []);
  if (!SpeechRecognitionCtor) return null;
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
