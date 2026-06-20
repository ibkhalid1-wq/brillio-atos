import type { DecisionItem } from "@/lib/adamDecisionUtils";

type NotificationUpdateItem = {
  id: string;
  title: string;
  summary: string;
  viewId: string;
  actionLabel: string;
  occurredAt?: number | string | null;
  tone?: "green" | "amber" | "red" | "blue";
};

type Props = {
  items: DecisionItem[];
  updates?: NotificationUpdateItem[];
  open: boolean;
  onClose: () => void;
  onNavigate: (target: string | DecisionItem | NotificationUpdateItem) => void;
  onDismiss: (itemId: string) => void;
};

const COLORS = {
  white: "#ffffff",
  gray50: "#f8fafc",
  gray200: "#e2e8f0",
  gray500: "#64748b",
  gray700: "#334155",
  gray900: "#0f172a",
  critical: "#dc2626",
  high: "#2563eb",
  medium: "#d97706",
  info: "#0891b2",
  green: "#16a34a",
};

function getPriorityColor(priority: DecisionItem["priority"]) {
  if (priority === "critical") return COLORS.critical;
  if (priority === "high") return COLORS.high;
  if (priority === "medium") return COLORS.medium;
  return COLORS.info;
}

function renderSection(
  label: string,
  items: DecisionItem[],
  onNavigate: (target: string | DecisionItem | NotificationUpdateItem) => void,
  onDismiss: (itemId: string) => void,
) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.gray500,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "stretch",
              background: COLORS.white,
              border: `1px solid ${COLORS.gray200}`,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
            }}
          >
            <div style={{ width: 4, background: getPriorityColor(item.priority), flexShrink: 0 }} />
            <div style={{ flex: 1, padding: "12px 12px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: COLORS.gray700,
                    background: COLORS.gray50,
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: 999,
                    padding: "3px 7px",
                  }}
                >
                  {item.phaseId}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray900, marginBottom: 4 }}>
                {item.title}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: COLORS.gray500,
                  lineHeight: 1.45,
                  marginBottom: 10,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.summary}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onNavigate(item)}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    background: COLORS.gray900,
                    color: COLORS.white,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "7px 10px",
                    cursor: "pointer",
                  }}
                >
                  {item.actionLabel}
                </button>
                {item.dismissable ? (
                  <button
                    type="button"
                    onClick={() => onDismiss(item.id)}
                    style={{
                      border: `1px solid ${COLORS.gray200}`,
                      borderRadius: 10,
                      background: COLORS.white,
                      color: COLORS.gray700,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "7px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getUpdateToneColor(tone: NotificationUpdateItem["tone"]) {
  if (tone === "red") return COLORS.critical;
  if (tone === "amber") return COLORS.medium;
  if (tone === "green") return COLORS.green;
  return COLORS.high;
}

function formatOccurredAtLabel(value?: number | string | null) {
  if (!value && value !== 0) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const deltaMs = Date.now() - parsed.getTime();
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 3_600_000) return `${Math.max(1, Math.round(deltaMs / 60_000))} min ago`;
  if (deltaMs < 86_400_000) return `${Math.max(1, Math.round(deltaMs / 3_600_000))} hr ago`;
  if (deltaMs < 604_800_000) {
    const days = Math.max(1, Math.round(deltaMs / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderUpdates(
  items: NotificationUpdateItem[],
  onNavigate: (target: string | DecisionItem | NotificationUpdateItem) => void,
) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.gray500,
          marginBottom: 10,
        }}
      >
        Recent updates
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "stretch",
              background: COLORS.white,
              border: `1px solid ${COLORS.gray200}`,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
            }}
          >
            <div style={{ width: 4, background: getUpdateToneColor(item.tone), flexShrink: 0 }} />
            <div style={{ flex: 1, padding: "12px 12px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray900 }}>
                  {item.title}
                </div>
                {formatOccurredAtLabel(item.occurredAt) ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.gray500, whiteSpace: "nowrap" }}>
                    {formatOccurredAtLabel(item.occurredAt)}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: COLORS.gray500,
                  lineHeight: 1.45,
                  marginBottom: 10,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.summary}
              </div>
              <button
                type="button"
                onClick={() => onNavigate(item)}
                style={{
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: 10,
                  background: COLORS.white,
                  color: COLORS.gray700,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "7px 10px",
                  cursor: "pointer",
                }}
              >
                {item.actionLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotificationDrawer({ items, updates = [], open, onClose, onNavigate, onDismiss }: Props) {
  const actionRequired = items.filter((item) => item.priority === "critical" || item.priority === "high");
  const review = items.filter((item) => item.priority === "medium");
  const proposals = items.filter((item) => item.priority === "info");
  const totalCount = items.length + updates.length;

  return (
    <>
      {open ? (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.24)",
            zIndex: 34,
          }}
        />
      ) : null}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: 320,
          background: COLORS.gray50,
          borderLeft: `1px solid ${COLORS.gray200}`,
          boxShadow: "-20px 0 48px rgba(15,23,42,0.14)",
          zIndex: 35,
          transform: open ? "translateX(0)" : "translateX(104%)",
          transition: "transform 220ms ease",
          display: "flex",
          flexDirection: "column",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div
          style={{
            padding: "18px 16px 14px",
            borderBottom: `1px solid ${COLORS.gray200}`,
            background: COLORS.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.gray900 }}>Executive Inbox</div>
            <span
              style={{
                minWidth: 20,
                height: 20,
                borderRadius: 999,
                background: COLORS.gray900,
                color: COLORS.white,
                fontSize: 10,
                fontWeight: 800,
                lineHeight: "20px",
                textAlign: "center",
                padding: "0 6px",
              }}
            >
              {totalCount}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: COLORS.gray500,
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COLORS.gray200}`, background: COLORS.white, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: COLORS.gray700, background: COLORS.gray50, border: `1px solid ${COLORS.gray200}`, borderRadius: 999, padding: "5px 8px" }}>
            {actionRequired.length} action required
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: COLORS.gray700, background: COLORS.gray50, border: `1px solid ${COLORS.gray200}`, borderRadius: 999, padding: "5px 8px" }}>
            {updates.length} updates
          </span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!items.length && !updates.length ? (
            <div
              style={{
                marginTop: 24,
                border: `1px dashed ${COLORS.gray200}`,
                borderRadius: 16,
                background: COLORS.white,
                padding: "22px 16px",
                textAlign: "center",
                color: COLORS.gray500,
                fontSize: 12.5,
                lineHeight: 1.6,
              }}
            >
              All caught up. ADAM is working quietly in the background and will surface the next required action here.
            </div>
          ) : (
            <>
              {renderSection("Action Required", actionRequired, onNavigate, onDismiss)}
              {renderSection("Review", review, onNavigate, onDismiss)}
              {renderSection("Proposals", proposals, onNavigate, onDismiss)}
              {renderUpdates(updates, onNavigate)}
            </>
          )}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${COLORS.gray200}`, background: COLORS.white }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onNavigate("decisions")}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 12,
                background: COLORS.gray900,
                color: COLORS.white,
                fontSize: 12,
                fontWeight: 800,
                padding: "11px 12px",
                cursor: "pointer",
              }}
            >
              Open action queue
            </button>
            <button
              type="button"
              onClick={() => onNavigate("notifications")}
              style={{
                border: `1px solid ${COLORS.gray200}`,
                borderRadius: 12,
                background: COLORS.white,
                color: COLORS.gray700,
                fontSize: 12,
                fontWeight: 800,
                padding: "11px 12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Delivery log
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
