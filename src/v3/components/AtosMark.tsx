/**
 * The AURA product mark — "The Drawn Line": the five-movement spine
 * (Frame → Listen → Prototype → Ship → Evolve) rising through five nodes,
 * whose peak draws the A of AURA. The electric-violet crossbar is the
 * human in the loop — the deliberate interruption in the machine's line.
 * Inline SVG so both chromes render from one artwork; /atos-mark.svg
 * (the favicon tile) carries the same glyph on the indigo tile.
 * `tone="dark"` swaps the linework to white for dark chrome.
 */
const ACCENT = "#6E5BFF";

export default function AtosMark({
  className = "",
  title = "AURA",
  tone = "light",
}: {
  className?: string;
  title?: string;
  tone?: "light" | "dark";
}) {
  const ink = tone === "dark" ? "#FFFFFF" : "#1D1545";
  return (
    <svg
      viewBox="0 0 68 52"
      role="img"
      aria-label={title}
      className={`v3-atos-mark ${className}`.trim()}
    >
      <title>{title}</title>
      <polyline
        points="4,44 18,44 34,10 50,44 64,44"
        fill="none"
        stroke={ink}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="25" y1="32" x2="43" y2="32" stroke={ACCENT} strokeWidth="6" strokeLinecap="round" />
      <circle cx="4" cy="44" r="4.5" fill={ACCENT} />
      <circle cx="64" cy="44" r="4.5" fill={ACCENT} />
    </svg>
  );
}
