/**
 * The Brillio wordmark — a crisp, theme-aware brand lockup used across the app
 * (auth screen, top bar, skeleton states). Rendered as live type in the app's
 * geometric display face with the signature two green dots, so it stays razor
 * sharp at every size and adapts to light/dark grounds via `currentColor` —
 * where a raster logo would soften and fight the background.
 *
 * `tone`:
 *  - "auto"  → the wordmark takes the surrounding text colour (currentColor).
 *  - "mono"  → forced to the primary ink (for on-light chrome).
 *  - "invert"→ forced to white (for on-dark chrome / photography).
 */
export default function BrilioLogo({
  className = "",
  tone = "auto",
  title = "Brillio",
}: {
  className?: string;
  tone?: "auto" | "mono" | "invert";
  title?: string;
}) {
  return (
    <span className={`brillio-logo brillio-tone-${tone} ${className}`.trim()} role="img" aria-label={title}>
      <span className="brillio-word" aria-hidden="true">brillio</span>
      <span className="brillio-dots" aria-hidden="true"><i /><i /></span>
    </span>
  );
}
