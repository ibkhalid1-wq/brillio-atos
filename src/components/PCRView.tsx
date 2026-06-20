import React, { useEffect, useRef, useState } from "react";

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const STATUSES = ["draft", "submitted", "under_review", "approved", "implementing", "implemented", "rejected", "deferred", "cancelled"];
const ROLES = ["delivery_lead", "executive", "architect"];
const STATUS_FLOW: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "rejected"],
  under_review: ["approved", "rejected", "deferred"],
  approved: ["implementing", "cancelled"],
  implementing: ["implemented", "cancelled"],
  deferred: ["submitted", "cancelled"],
  rejected: [],
  implemented: [],
  cancelled: [],
};
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  implementing: "bg-indigo-100 text-indigo-700",
  implemented: "bg-green-200 text-green-800",
  rejected: "bg-red-100 text-red-700",
  deferred: "bg-orange-100 text-orange-700",
  cancelled: "bg-gray-200 text-gray-500",
};
const BLANK = { title: "", description: "", requestedBy: "", phase: "build", priority: "medium" };

interface PCR {
  id: string;
  title: string;
  description: string;
  requestedBy: string;
  phase: string;
  priority: string;
  status: string;
  impact: any;
  approvals: Record<string, any>;
  history: any[];
  createdAt: number;
}

interface Props {
  changeRequests: PCR[];
  focusPcrId?: string | null;
  focusStatus?: string;
  focusToken?: number;
  onSave: (pcr: any) => void;
  onSubmit: (id: string) => void;
  onTransition: (id: string, status: string, note: string) => void;
  onApproval: (id: string, role: string, approved: boolean, note: string) => void;
}

export function PCRView({
  changeRequests,
  focusPcrId = null,
  focusStatus,
  focusToken = 0,
  onSave,
  onSubmit,
  onTransition,
  onApproval,
}: Props) {
  const [form, setForm] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PCR | null>(null);
  const [note, setNote] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = changeRequests.filter((request) => filterStatus === "all" || request.status === filterStatus);
  const active = selected ? changeRequests.find((request) => request.id === selected.id) || selected : null;
  const focusedRequest = focusPcrId ? changeRequests.find((request) => request.id === focusPcrId) || null : null;

  useEffect(() => {
    if (focusStatus) setFilterStatus(focusStatus);
    if (!focusPcrId) return;
    const nextActive = changeRequests.find((request) => request.id === focusPcrId);
    if (!nextActive) return;
    setSelected(nextActive);
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current[focusPcrId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [changeRequests, focusPcrId, focusStatus, focusToken]);

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    onSave({ ...form, id: crypto.randomUUID() });
    setForm({ ...BLANK });
    setOpen(false);
  }

  return (
    <div className="p-4 space-y-4">
      {focusedRequest ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            ADAM brought you directly to "{focusedRequest.title}" so you can review the submitted change without searching the register.
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Change Request Register</h2>
        <button
          onClick={() => setOpen((value) => !value)}
          className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
        >
          + New PCR
        </button>
      </div>

      {open ? (
        <form onSubmit={submitForm} className="border rounded p-4 bg-gray-50 space-y-2 text-sm">
          <input
            required
            placeholder="Change title"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className="w-full border rounded px-2 py-1"
          />
          <textarea
            required
            placeholder="Description of change and business justification"
            rows={3}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            className="w-full border rounded px-2 py-1 resize-none"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              placeholder="Requested by"
              value={form.requestedBy}
              onChange={(event) => setForm((current) => ({ ...current, requestedBy: event.target.value }))}
              className="border rounded px-2 py-1"
            />
            <select
              value={form.phase}
              onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))}
              className="border rounded px-2 py-1"
            >
              {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
            </select>
            <select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              className="border rounded px-2 py-1"
            >
              {["low", "medium", "high", "critical"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700">Save Draft</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2 flex-wrap text-xs">
        {["all", ...STATUSES].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-2 py-0.5 rounded border ${filterStatus === status ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300"}`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="flex gap-4 h-[480px]">
        <div className="w-2/5 overflow-y-auto space-y-1 border-r pr-2">
          {!filtered.length ? <p className="text-sm text-gray-400 text-center pt-8">No change requests.</p> : null}
          {filtered.map((request) => (
            <div
              key={request.id}
              ref={(node) => { itemRefs.current[request.id] = node; }}
              onClick={() => setSelected(request)}
              className={`border rounded p-2 cursor-pointer text-xs ${selected?.id === request.id ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300" : "hover:bg-gray-50"}`}
            >
              <div className="flex justify-between items-start gap-1">
                <span className="font-medium leading-tight">{request.title}</span>
                <span className={`shrink-0 px-1.5 rounded ${STATUS_COLORS[request.status] || "bg-gray-100 text-gray-600"}`}>
                  {request.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="text-gray-400 mt-0.5">{request.phase} · {request.priority} · {request.requestedBy}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto text-sm">
          {active ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">{active.title}</h3>
                <p className="text-xs text-gray-400">{active.phase} · {active.priority} priority · {active.requestedBy}</p>
                <p className="text-sm text-gray-600 mt-1">{active.description}</p>
              </div>

              {active.impact ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Impact Assessment</p>
                  <p className="text-sm text-gray-700 mb-2">{active.impact.summary}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {Object.entries(active.impact.dimensions || {}).map(([key, value]: any) => (
                      <div key={key} className="border rounded p-1.5">
                        <span className="capitalize font-medium">{key}</span>
                        <span className={`ml-1 ${value.level === "high" ? "text-red-600" : value.level === "medium" ? "text-yellow-600" : "text-green-600"}`}>
                          {value.level}
                        </span>
                        <p className="text-gray-500 mt-0.5">{value.detail}</p>
                      </div>
                    ))}
                  </div>
                  {active.impact.recommendation ? (
                    <p className="text-xs mt-2 text-gray-500">
                      Recommendation: <strong>{active.impact.recommendation}</strong> — {active.impact.rationale}
                    </p>
                  ) : null}
                </div>
              ) : active.status === "draft" ? (
                <button onClick={() => onSubmit(active.id)} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700">
                  Submit for Impact Assessment
                </button>
              ) : null}

              {["submitted", "under_review", "approved", "rejected"].includes(active.status) ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Approvals</p>
                  <div className="space-y-2">
                    {ROLES.map((roleId) => {
                      const approval = active.approvals?.[roleId];
                      return (
                        <div key={roleId} className="border rounded p-2 text-xs">
                          <div className="flex justify-between">
                            <span className="capitalize font-medium">{roleId.replace(/_/g, " ")}</span>
                            {approval ? (
                              <span className={approval.approved ? "text-green-600" : "text-red-500"}>
                                {approval.approved ? "✓ Approved" : "✗ Rejected"} by {approval.by}
                              </span>
                            ) : (
                              <div className="flex gap-1">
                                <button onClick={() => onApproval(active.id, roleId, true, note)} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">Approve</button>
                                <button onClick={() => onApproval(active.id, roleId, false, note)} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">Reject</button>
                              </div>
                            )}
                          </div>
                          {approval?.note ? <p className="text-gray-400 mt-0.5">{approval.note}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(STATUS_FLOW[active.status] || []).length ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Transition</p>
                  <textarea
                    placeholder="Note (optional)"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="w-full border rounded px-2 py-1 text-xs resize-none mb-1"
                  />
                  <div className="flex flex-wrap gap-1">
                    {(STATUS_FLOW[active.status] || []).map((status) => (
                      <button
                        key={status}
                        onClick={() => { onTransition(active.id, status, note); setNote(""); }}
                        className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 capitalize"
                      >
                        → {status.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {active.history?.length ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">History</p>
                  {[...active.history].reverse().map((entry: any, index: number) => (
                    <div key={index} className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 py-0.5">
                      <span className="capitalize">{String(entry.status || "").replace(/_/g, " ")}</span>
                      {entry.by ? <span> by {entry.by}</span> : null}
                      <span className="ml-1">{entry.at ? new Date(entry.at).toLocaleString() : ""}</span>
                      {entry.note ? <p>{entry.note}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center pt-12">Select a change request.</p>
          )}
        </div>
      </div>
    </div>
  );
}
