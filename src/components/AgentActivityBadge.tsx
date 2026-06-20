type BadgeLevel = "critical" | "high" | "medium" | "none";

type Props = {
  count: number;
  level: BadgeLevel;
};

const COLORS = {
  critical: "#dc2626",
  high: "#2563eb",
  medium: "#d97706",
  white: "#ffffff",
};

export function AgentActivityBadge({ count, level }: Props) {
  if (!count || level === "none") return null;

  const isCritical = level === "critical";
  const background = level === "critical"
    ? COLORS.critical
    : level === "high"
      ? COLORS.high
      : COLORS.medium;

  return (
    <>
      {isCritical ? (
        <div
          dangerouslySetInnerHTML={{
            __html: `
              <style>
                @keyframes adamAgentBadgePulse {
                  0% { opacity: 1; transform: scale(1); }
                  50% { opacity: 0.3; transform: scale(1.06); }
                  100% { opacity: 1; transform: scale(1); }
                }
              </style>
            `,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          top: -4,
          right: -4,
          minWidth: count <= 9 ? 16 : 22,
          height: 16,
          borderRadius: 999,
          background,
          color: COLORS.white,
          fontSize: 9,
          fontWeight: 800,
          lineHeight: "16px",
          textAlign: "center",
          padding: count <= 9 ? 0 : "0 5px",
          boxShadow: "0 6px 14px rgba(15,23,42,0.18)",
          animation: isCritical ? "adamAgentBadgePulse 1.2s infinite" : "none",
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        {count > 99 ? "99+" : count}
      </div>
    </>
  );
}
