/**
 * The ATOS product mark — the network-graph tile (evidence, artifacts and
 * demonstrations as connected nodes). Rendered from /favicon.svg so the tab
 * icon and the in-app mark are ONE artwork: change the favicon, the brand
 * follows everywhere.
 */
export default function AtosMark({
  className = "",
  title = "ATOS",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <img
      src="/favicon.svg"
      alt={title}
      className={`v3-atos-mark ${className}`.trim()}
      draggable={false}
    />
  );
}
