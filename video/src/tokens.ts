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

/** Scene boundaries (frames @30fps) — the v7 script, 2:10. */
export const T = {
  question: { from: 0, dur: 380 }, //     0:00–0:12.7 — the question + graveyard
  diagnosis: { from: 380, dur: 300 }, //  0:12.7–0:22.7 — the missing middle
  reveal: { from: 680, dur: 400 }, //     0:22.7–0:36 — meet AURA, Laila derived
  alignment: { from: 1080, dur: 380 }, // 0:36–0:48.7 — it starts with people
  grounding: { from: 1460, dur: 400 }, // 0:48.7–1:02 — the business's own language
  journey: { from: 1860, dur: 410 }, //   1:02–1:15.7 — governed by design
  numbers: { from: 2270, dur: 390 }, //   1:15.7–1:28.7 — the proof
  industries: { from: 2660, dur: 270 }, //1:28.7–1:37.7 — any business
  close: { from: 2930, dur: 260 }, //     1:37.7–1:46.3 — the bookend answer
};

export const TOTAL_FRAMES = 3190;
