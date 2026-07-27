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
  question: { from: 0, dur: 420 }, //   0:00–0:14 — the question + graveyard
  diagnosis: { from: 420, dur: 360 }, // 0:14–0:26 — the missing middle
  reveal: { from: 780, dur: 480 }, //    0:26–0:42 — Laila, derived from evidence
  alignment: { from: 1260, dur: 420 }, // 0:42–0:56 — it starts with people
  grounding: { from: 1680, dur: 480 }, // 0:56–1:12 — the business's own language
  journey: { from: 2160, dur: 600 }, //  1:12–1:32 — governed by design
  numbers: { from: 2760, dur: 480 }, //  1:32–1:48 — the proof
  industries: { from: 3240, dur: 360 }, // 1:48–2:00 — any business
  close: { from: 3600, dur: 300 }, //    2:00–2:10 — bookend answer
};

export const TOTAL_FRAMES = 3900;
