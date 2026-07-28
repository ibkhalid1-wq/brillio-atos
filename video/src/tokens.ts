/**
 * Visual tokens + the DERIVED timeline.
 *
 * Scene durations are not written here — they come from the content
 * library, sized to the narration. Edit words and pacing in content.ts.
 */
import { timeline } from "./content";

export const INK = "#1D1545";
export const INK_2 = "#2E2364";
export const ELECTRIC = "#6E5BFF";
/**
 * The same violet, lifted for small type. #6E5BFF on the indigo ground
 * measures ~3.7:1 — fine for a rule or a fill, not for a 15px label. Every
 * small violet label uses this; ELECTRIC stays for fills, rules and large
 * accented words.
 */
export const ELECTRIC_TEXT = "#9B8CFF";
export const PAPER = "#FBFBFE";
export const MUTED = "rgba(255,255,255,0.55)";
export const FAINT = "rgba(255,255,255,0.28)";

export const FONT =
  '-apple-system, "SF Pro Display", "Segoe UI", Inter, sans-serif';

export const FPS = 30;

const derived = timeline();

/** Scene boundaries, keyed by scene id (seg1 … seg9). */
export const T = derived.T;
export const TOTAL_FRAMES = derived.totalFrames;
/** Narration start times in ms — consumed by scripts/mix.mjs. */
export const VO_OFFSETS_MS = derived.voOffsetsMs;
