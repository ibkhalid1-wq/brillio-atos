/** Design tokens for the AURA board film — one identity with the app. */
export const INK = "#1D1545";
export const INK_2 = "#2E2364";
export const ELECTRIC = "#6E5BFF";
export const PAPER = "#FBFBFE";
export const MUTED = "rgba(255,255,255,0.55)";
export const FAINT = "rgba(255,255,255,0.28)";

export const FONT =
  '-apple-system, "SF Pro Display", "Segoe UI", Inter, sans-serif';

export const FPS = 30;

/** Scene boundaries (frames @30fps) — mirror the v5 90-second script. */
export const T = {
  question: { from: 0, dur: 360 }, //  0:00–0:12 — typed question + graveyard
  reveal: { from: 360, dur: 540 }, //  0:12–0:30 — spine draws, the Laila reveal
  grounding: { from: 900, dur: 540 }, //  0:30–0:48 — ontology + standards + RUN1|RUN2
  alignment: { from: 1440, dur: 360 }, //  0:48–1:00 — routed question, answer folds in
  numbers: { from: 1800, dur: 540 }, //  1:00–1:18 — the stamps
  close: { from: 2340, dur: 360 }, //  1:18–1:30 — tagline + handoff card
};

export const TOTAL_FRAMES = 2700;
