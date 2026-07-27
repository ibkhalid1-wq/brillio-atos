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

/** Scene boundaries (frames @30fps) — "The Twenty-One Days", 2:10. */
export const T = {
  question: { from: 0, dur: 390 }, //     0:00–0:13 — the question + graveyard
  day0: { from: 390, dur: 330 }, //       0:13–0:24 — the mandate, clock starts
  reveal: { from: 720, dur: 450 }, //     0:24–0:39 — meet AURA, Laila derived
  listening: { from: 1170, dur: 420 }, // 0:39–0:53 — days 1–7, the listening
  day8: { from: 1590, dur: 590 }, //      0:53–1:13 — the moment it could have died
  agrees: { from: 2180, dur: 390 }, //    1:13–1:26 — days 9–20, the picture agrees
  gates: { from: 2570, dur: 390 }, //     1:26–1:39 — governed, every day
  day21: { from: 2960, dur: 430 }, //     1:39–1:53 — the demo + the numbers
  industries: { from: 3390, dur: 240 }, //1:53–2:01 — any industry, one breath
  close: { from: 3630, dur: 270 }, //     2:01–2:10 — the bookend answer
};

export const TOTAL_FRAMES = 3900;
