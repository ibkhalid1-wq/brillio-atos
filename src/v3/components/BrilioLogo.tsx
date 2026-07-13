/**
 * The Brillio wordmark, reconstructed as a crisp inline SVG — bold geometric
 * bars with the b-bowl and o-ring, and the signature two green dots. Rendered
 * as vector so it is razor-sharp at every size and adapts to the surrounding
 * ink via currentColor (the dots keep the brand green). This is a faithful
 * reconstruction; to use the exact official artwork, drop a `brillio-logo.svg`
 * into `public/` and point the component at it.
 *
 * `tone`:
 *  - "auto"  → letters take the surrounding text colour (currentColor).
 *  - "mono"  → forced to the primary ink (on-light chrome).
 *  - "invert"→ forced to white (on-dark chrome / photography).
 */
const BRILLIO_GREEN = "#3aad4a";

export default function BrilioLogo({
  className = "",
  tone = "auto",
  title = "Brillio",
}: {
  className?: string;
  tone?: "auto" | "mono" | "invert";
  title?: string;
}) {
  const ink = tone === "invert" ? "#ffffff" : tone === "mono" ? "var(--v3-text-primary)" : "currentColor";
  return (
    <svg
      className={`brillio-logo ${className}`.trim()}
      viewBox="0 0 400 152"
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <g fill={ink}>
        {/* b — tall stem + bowl */}
        <rect x="0" y="8" width="26" height="112" rx="13" />
        {/* r — stem + shoulder */}
        <rect x="92" y="44" width="26" height="76" rx="13" />
        <circle cx="131" cy="57" r="13" />
        {/* i */}
        <rect x="162" y="44" width="26" height="76" rx="13" />
        {/* l l */}
        <rect x="202" y="8" width="26" height="112" rx="13" />
        <rect x="242" y="8" width="26" height="112" rx="13" />
        {/* i */}
        <rect x="282" y="44" width="26" height="76" rx="13" />
      </g>
      {/* b bowl + o ring */}
      <circle cx="40" cy="82" r="25" stroke={ink} strokeWidth="26" />
      <circle cx="360" cy="82" r="25" stroke={ink} strokeWidth="26" />
      {/* the two signature dots */}
      <circle cx="184" cy="141" r="11" fill={BRILLIO_GREEN} />
      <circle cx="216" cy="141" r="11" fill={BRILLIO_GREEN} />
    </svg>
  );
}
