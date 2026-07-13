/**
 * The Brillio brand mark — rendered from the official artwork in
 * `public/brillio-logo.png` (replace that file with the current logo to
 * update every branded surface at once). Sizing is set per placement by the
 * CSS class; the image keeps its own aspect via object-fit, so it never
 * distorts. Prefer an SVG export for crispness: save it as
 * `public/brillio-logo.svg` and change the `src` below.
 *
 * `tone`:
 *  - "auto" / "mono" → the logo as-is (correct on light chrome).
 *  - "invert"        → white-out for dark chrome / photography.
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
    <img
      src="/brillio-logo.png"
      alt={title}
      className={`brillio-logo brillio-tone-${tone} ${className}`.trim()}
      draggable={false}
    />
  );
}
