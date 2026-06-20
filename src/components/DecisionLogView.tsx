import React, { useMemo, useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

interface LogEntry {
  id: string;
  source: string;
  type: string;
  phase: string;
  title: string;
  body: string;
  status: string;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

interface Props {
  entries: LogEntry[];
}

const SOURCE_COLORS: Record<string, string> = {
  decision_queue: "bg-indigo-100 text-indigo-700",
  scope_change: "bg-yellow-100 text-yellow-700",
  gate_approval: "bg-green-100 text-green-700",
  raid: "bg-red-100 text-red-700",
  adr: "bg-purple-100 text-purple-700",
};

const STATUS_COLORS: Record<string, string> = {
  approved: "text-green-600",
  resolved: "text-green-600",
  rejected: "text-red-500",
  pending: "text-yellow-500",
  dismissed: "text-gray-400",
};

const PHASES = ["all", "strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const SOURCES = ["all", "decision_queue", "scope_change", "gate_approval", "raid", "adr"];

export function DecisionLogView({ entries }: Props) {
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => entries.filter((entry) => {
    if (phaseFilter !== "all" && entry.phase !== phaseFilter) return false;
    if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (
      search
      && !entry.title.toLowerCase().includes(search.toLowerCase())
      && !entry.body.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  }), [entries, phaseFilter, sourceFilter, statusFilter, search]);

  function exportCSV() {
    const header = "Date,Phase,Source,Type,Title,Status,ResolvedBy\n";
    const rows = filtered.map((entry) => [
      entry.createdAt ? new Date(entry.createdAt).toISOString().slice(0, 10) : "",
      entry.phase,
      entry.source,
      entry.type,
      `"${entry.title.replace(/"/g, "\"\"")}"`,
      entry.status,
      entry.resolvedBy || "",
    ].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "decision-log.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Decision Log</h2>
        <div className="flex gap-2">
          <span className="text-sm text-gray-400">{filtered.length} entries</span>
          <button type="button" onClick={exportCSV} className="rounded bg-gray-100 px-3 py-1 text-xs hover:bg-gray-200">Export CSV</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <input
          placeholder="Search decisions..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-48 rounded border px-2 py-1 text-sm"
        />
        <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)} className="rounded border px-2 py-1">
          {PHASES.map((phase) => <option key={phase} value={phase}>{phase === "all" ? "All Phases" : phase}</option>)}
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded border px-2 py-1">
          {SOURCES.map((source) => <option key={source} value={source}>{source === "all" ? "All Sources" : source.replace("_", " ")}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded border px-2 py-1">
          {["all", "pending", "approved", "resolved", "rejected", "dismissed"].map((status) => <option key={status} value={status}>{status === "all" ? "All Statuses" : status}</option>)}
        </select>
      </div>

      <div className="space-y-1">
        {!filtered.length ? <p className="py-8 text-center text-sm text-gray-400">No decisions match these filters.</p> : null}
        {filtered.map((entry) => (
          <div key={entry.id} className="cursor-pointer rounded border hover:bg-gray-50" onClick={() => setExpanded((value) => value === entry.id ? null : entry.id)}>
            <div className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${SOURCE_COLORS[entry.source] || "bg-gray-100"}`}>
                    {entry.source.replace("_", " ")}
                  </span>
                  <span className="text-xs capitalize text-gray-400">{entry.phase}</span>
                  <span className={`text-xs font-medium ${STATUS_COLORS[entry.status] || "text-gray-500"}`}>{entry.status}</span>
                </div>
                <p className="mt-0.5 truncate text-sm font-medium">{entry.title}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-gray-400">
                <div>{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "—"}</div>
                {entry.resolvedBy ? <div className="text-gray-300">{entry.resolvedBy}</div> : null}
              </div>
            </div>
            {expanded === entry.id && entry.body ? (
              <div className="border-t bg-gray-50 px-3 pb-3 pt-2 text-sm text-gray-600">
                <FormattedDocument content={entry.body} compact />
                {entry.resolvedAt ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Resolved {new Date(entry.resolvedAt).toLocaleString()}{entry.resolvedBy ? ` by ${entry.resolvedBy}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
