/**
 * The AURA product mark — the sphere-network artwork from the brand kit
 * (deep-indigo wireframe globe, Brillio-green accent nodes). The favicon PNGs
 * ship from the same kit, so tab icon and in-app mark stay one identity.
 * `tone="dark"` swaps to the white-linework variant for dark chrome.
 */
export default function AtosMark({
  className = "",
  title = "AURA",
  tone = "light",
}: {
  className?: string;
  title?: string;
  tone?: "light" | "dark";
}) {
  return (
    <img
      src={tone === "dark" ? "/atos-mark-dark.png" : "/atos-mark.svg"}
      alt={title}
      className={`v3-atos-mark ${className}`.trim()}
      draggable={false}
    />
  );
}
