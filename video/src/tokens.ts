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
  question: { from: 0, dur: 510 }, //     0:00–0:17 — the question + graveyard
  diagnosis: { from: 510, dur: 310 }, //  0:17–0:27.3 — the missing middle
  reveal: { from: 820, dur: 420 }, //     0:27.3–0:41.3 — meet AURA, Laila derived
  alignment: { from: 1240, dur: 410 }, // 0:41.3–0:55 — it starts with people
  grounding: { from: 1650, dur: 390 }, // 0:55–1:08 — the business's own language
  journey: { from: 2040, dur: 450 }, //   1:08–1:23 — governed by design
  numbers: { from: 2490, dur: 450 }, //   1:23–1:38 — the proof
  industries: { from: 2940, dur: 330 }, //1:38–1:49 — any business
  close: { from: 3270, dur: 240 }, //     1:49–1:57 — the bookend answer
};

export const TOTAL_FRAMES = 3510;
