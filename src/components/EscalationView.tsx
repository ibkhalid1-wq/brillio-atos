import { useEffect, useRef, useState } from "react";

const CHAIN = [
  { level: 1, role: "delivery_lead", label: "Delivery Lead", color: "bg-blue-100 text-blue-700" },
  { level: 2, role: "executive", label: "Executive Sponsor", color: "bg-orange-100 text-orange-700" },
  { level: 3, role: "programme_board", label: "Programme Board", color: "bg-red-100 text-red-700" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-500",
};

interface EscHistory {
  level: number;
  role: string;
  assignedAt?: number;
  resolvedAt?: number;
  note: string;
}

interface Escalation {
  id: string;
  raidId: string;
  raidTitle: string;
  category: string;
  priority: string;
  currentLevel: number;
  status: string;
  raisedAt: number;
  dueAt: number;
  resolvedAt: number | null;
  history: EscHistory[];
  resolution?: string;
}

interface Props {
  escalations: Escalation[];
  raidIssues: { id: string; title: string; priority: string; raisedAt: number }[];
  focusEscalationId?: string | null;
  focusStatus?: string;
  focusToken?: number;
  onInitiate: (raidId: string) => void;
  onEscalate: (id: string, note: string) => void;
  onResolve: (id: string, resolution: string) => void;
}

export function EscalationView({
  escalations,
  raidIssues,
  focusEscalationId = null,
  focusStatus,
  focusToken = 0,
  onInitiate,
  onEscalate,
  onResolve,
}: Props) {
  const [selected, setSelected] = useState<Escalation | null>(null);
  const [note, setNote] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = escalations.filter((entry) => filterStatus === "all" || entry.status === filterStatus);
  const detail = selected ? escalations.find((entry) => entry.id === selected.id) || selected : null;
  const now = Date.now();
  const openIssues = raidIssues.filter((issue) => !escalations.find((entry) => entry.raidId === issue.id && entry.status === "open"));
  const focusedEscalation = focusEscalationId ? escalations.find((entry) => entry.id === focusEscalationId) || null : null;

  useEffect(() => {
    if (focusStatus) setFilterStatus(focusStatus);
    if (!focusEscalationId) return;
    const nextDetail = escalations.find((entry) => entry.id === focusEscalationId);
    if (!nextDetail) return;
    setSelected(nextDetail);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[focusEscalationId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [escalations, focusEscalationId, focusStatus, focusToken]);

  return (
    <div className="p-4 space-y-4">
      {focusedEscalation ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            ADAM brought you to the active escalation for "{focusedEscalation.raidTitle}" so you can resolve it at the current approval level.
          </div>
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">Issue Escalation Workflow</h2>

      <div className="flex gap-4 text-xs">
        {[
          ["Open", escalations.filter((entry) => entry.status === "open").length, "text-yellow-600"],
          ["Breached", escalations.filter((entry) => entry.status === "open" && now > entry.dueAt).length, "text-red-600"],
          ["Resolved", escalations.filter((entry) => entry.status === "resolved").length, "text-green-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className={`font-semibold ${color}`}>{value} {label}</div>
        ))}
      </div>

      {openIssues.length ? (
        <div className="border rounded p-3 bg-yellow-50 space-y-2">
          <p className="text-xs font-medium text-yellow-800">Issues eligible for escalation ({openIssues.length}):</p>
          {openIssues.slice(0, 4).map((issue) => (
            <div key={issue.id} className="flex items-center justify-between text-xs">
              <span>{issue.title} <span className="text-gray-400">({issue.priority})</span></span>
              <button
                type="button"
                onClick={() => onInitiate(issue.id)}
                className="text-xs px-2 py-0.5 rounded bg-yellow-600 text-white hover:bg-yellow-700"
              >
                Escalate
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2 text-xs">
        {["all", "open", "resolved"].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilterStatus(status)}
            className={`px-2 py-0.5 rounded border capitalize ${filterStatus === status ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300"}`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="flex gap-4 h-[440px]">
        <div className="w-2/5 overflow-y-auto border-r pr-2 space-y-1">
          {!filtered.length ? (
            <p className="text-sm text-gray-400 text-center pt-8">No escalations.</p>
          ) : null}
          {filtered.map((entry) => {
            const isBreached = entry.status === "open" && now > entry.dueAt;
            const currentStep = CHAIN.find((item) => item.level === entry.currentLevel);
            return (
              <div
                key={entry.id}
                ref={(node) => { itemRefs.current[entry.id] = node; }}
                onClick={() => setSelected(entry)}
                className={`border rounded p-2 cursor-pointer text-xs ${
                  selected?.id === entry.id
                    ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300"
                    : isBreached
                      ? "border-red-300 bg-red-50"
                      : "hover:bg-gray-50"
                }`}
              >
                <div className="flex justify-between items-start gap-1">
                  <span className="font-medium leading-tight">{entry.raidTitle}</span>
                  <span className={`shrink-0 px-1.5 rounded ${STATUS_COLORS[entry.status] || STATUS_COLORS.closed}`}>{entry.status}</span>
                </div>
                <div className="flex gap-2 mt-0.5 text-gray-400">
                  <span>{currentStep?.label || `Level ${entry.currentLevel}`}</span>
                  <span>·</span>
                  {isBreached ? (
                    <span className="text-red-600 font-medium">⚠ SLA breached</span>
                  ) : (
                    <span>Due {new Date(entry.dueAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto text-sm">
          {detail ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">{detail.raidTitle}</h3>
                <p className="text-xs text-gray-400">
                  {detail.category} · {detail.priority} · Raised {new Date(detail.raisedAt).toLocaleDateString()}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Escalation Chain</p>
                <div className="flex gap-0">
                  {CHAIN.map((entry) => {
                    const active = detail.currentLevel === entry.level && detail.status === "open";
                    const passed = detail.currentLevel > entry.level || detail.status === "resolved";
                    const historyEntry = detail.history.find((record) => record.level === entry.level);
                    return (
                      <div key={entry.level} className="flex-1 text-center">
                        <div className={`mx-1 rounded p-2 text-xs border-2 ${
                          active ? "border-indigo-500 bg-indigo-50" : passed ? "border-green-400 bg-green-50" : "border-gray-200 bg-white"
                        }`}>
                          <div className="font-semibold">{entry.label}</div>
                          {historyEntry?.assignedAt ? (
                            <div className="text-gray-400 text-[10px] mt-0.5">{new Date(historyEntry.assignedAt).toLocaleDateString()}</div>
                          ) : null}
                          {active ? <div className="text-indigo-600 text-[10px] mt-0.5">▶ Current</div> : null}
                          {passed ? <div className="text-green-600 text-[10px] mt-0.5">✓</div> : null}
                        </div>
                        {entry.level < CHAIN.length ? <div className="text-gray-300 text-xs">→</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">History</p>
                {detail.history.map((historyEntry, index) => (
                  <div key={`${historyEntry.role}-${index}`} className="border-l-2 border-gray-200 pl-2 py-0.5 text-xs text-gray-500">
                    <span className="capitalize font-medium">{CHAIN.find((entry) => entry.role === historyEntry.role)?.label || historyEntry.role}</span>
                    {historyEntry.assignedAt ? <span className="ml-1">{new Date(historyEntry.assignedAt).toLocaleString()}</span> : null}
                    <p>{historyEntry.note}</p>
                  </div>
                ))}
              </div>

              {detail.status === "open" ? (
                <div className="border-t pt-3 space-y-2">
                  <textarea
                    placeholder="Note"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="w-full border rounded px-2 py-1 text-xs resize-none"
                  />
                  <div className="flex gap-2">
                    {detail.currentLevel < CHAIN.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          onEscalate(detail.id, note);
                          setNote("");
                        }}
                        className="flex-1 bg-orange-500 text-white text-xs py-1 rounded hover:bg-orange-600"
                      >
                        Escalate to {CHAIN.find((entry) => entry.level === detail.currentLevel + 1)?.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        onResolve(detail.id, note);
                        setNote("");
                      }}
                      className="flex-1 bg-green-600 text-white text-xs py-1 rounded hover:bg-green-700"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ) : null}

              {detail.status === "resolved" && detail.resolution ? (
                <div className="bg-green-50 rounded p-2 text-xs text-green-700">
                  <span className="font-medium">Resolution: </span>{detail.resolution}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center pt-12">Select an escalation.</p>
          )}
        </div>
      </div>
    </div>
  );
}
