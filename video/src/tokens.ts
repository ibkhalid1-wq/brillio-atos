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
  question: { from: 0, dur: 400 }, //     0:00–0:13.3 — the question + graveyard
  diagnosis: { from: 400, dur: 280 }, //  0:13.3–0:22.7 — the missing middle
  reveal: { from: 680, dur: 370 }, //     0:22.7–0:35 — meet AURA, Laila derived
  alignment: { from: 1050, dur: 370 }, // 0:35–0:47.3 — it starts with people
  grounding: { from: 1420, dur: 390 }, // 0:47.3–1:00.3 — the business's language
  journey: { from: 1810, dur: 390 }, //   1:00.3–1:13.3 — governed by design
  numbers: { from: 2200, dur: 370 }, //   1:13.3–1:25.7 — the proof
  industries: { from: 2570, dur: 220 }, //1:25.7–1:33 — any business
  close: { from: 2790, dur: 240 }, //     1:33–1:41 — the bookend answer
};

export const TOTAL_FRAMES = 3030;
