import { useEffect, useState } from "react";

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const ROLES = ["Programme Manager", "Business Analyst", "Solution Architect", "Developer", "Tester", "Change Manager", "Data Analyst", "Scrum Master", "Product Owner", "Security Analyst"];
const BLANK = { name: "", role: "Developer", availability: 100, skills: "" };

interface Resource {
  id: string;
  name: string;
  role: string;
  availability: number;
  skills: string;
}

interface Allocation {
  pct: number;
  workstream: string;
  notes: string;
}

interface Utilisation {
  byResource: Record<string, { totalPct: number; byPhase: Record<string, number>; overAllocated: boolean }>;
  byPhase: Record<string, { avgPct: number; headcount: number; underStaffed: boolean }>;
}

interface Props {
  resources: Resource[];
  allocations: Record<string, Record<string, Allocation>>;
  utilisation: Utilisation;
  focusTab?: "matrix" | "register" | "heatmap";
  focusPhase?: string;
  focusToken?: number;
  onSave: (resource: any) => void;
  onDelete: (id: string) => void;
  onAlloc: (phaseId: string, resourceId: string, pct: number, workstream: string, notes: string) => void;
}

function getPctColor(pct: number) {
  if (pct > 100) return "bg-red-500";
  if (pct > 80) return "bg-yellow-400";
  if (pct > 40) return "bg-green-500";
  return "bg-gray-300";
}

export function ResourceView({
  resources,
  allocations,
  utilisation,
  focusTab,
  focusPhase,
  focusToken = 0,
  onSave,
  onDelete,
  onAlloc,
}: Props) {
  const [tab, setTab] = useState<"matrix" | "register" | "heatmap">("matrix");
  const [form, setForm] = useState<any>({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [editCell, setEditCell] = useState<{ phase: string; rid: string } | null>(null);
  const [cellPct, setCellPct] = useState("");
  const [cellWorkstream, setCellWorkstream] = useState("");
  const [selectedPhase, setSelectedPhase] = useState(PHASES[0]);

  useEffect(() => {
    if (focusTab) setTab(focusTab);
    if (focusPhase && PHASES.includes(focusPhase)) setSelectedPhase(focusPhase);
  }, [focusPhase, focusTab, focusToken]);

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    onSave({ ...form, id: form.id || crypto.randomUUID() });
    setForm({ ...BLANK });
    setOpen(false);
  }

  function commitCell() {
    if (!editCell) return;
    onAlloc(editCell.phase, editCell.rid, Number(cellPct) || 0, cellWorkstream, "");
    setEditCell(null);
  }

  const totals = utilisation.byResource || {};
  const focusMessage = focusPhase
    ? `ADAM brought you to ${focusPhase} resource planning so you can address the staffing signal without hunting through the matrix.`
    : focusTab === "register"
      ? "ADAM brought you to the resource register so you can update capacity or assignment details directly."
      : focusTab === "heatmap"
        ? "ADAM brought you to the utilisation view so you can review the current staffing posture and imbalances."
        : focusTab === "matrix"
          ? "ADAM brought you to the allocation matrix so you can adjust the exact workload behind the alert."
          : null;

  return (
    <div className="p-4 space-y-4">
      {focusMessage ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">{focusMessage}</div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Resource Allocation</h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
        >
          + Add Resource
        </button>
      </div>

      {open ? (
        <form onSubmit={submitForm} className="border rounded p-3 bg-gray-50 grid grid-cols-2 gap-2 text-sm">
          <input
            required
            placeholder="Full name"
            value={form.name}
            onChange={(event) => setForm((previous: any) => ({ ...previous, name: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <select
            value={form.role}
            onChange={(event) => setForm((previous: any) => ({ ...previous, role: event.target.value }))}
            className="border rounded px-2 py-1"
          >
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <div>
            <label className="text-xs text-gray-500">Availability: {form.availability}%</label>
            <input
              type="range"
              min={10}
              max={100}
              step={10}
              value={form.availability}
              onChange={(event) => setForm((previous: any) => ({ ...previous, availability: Number(event.target.value) }))}
              className="w-full"
            />
          </div>
          <input
            placeholder="Key skills (comma-separated)"
            value={form.skills}
            onChange={(event) => setForm((previous: any) => ({ ...previous, skills: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2 border-b">
        {(["matrix", "register", "heatmap"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={`text-sm px-3 py-1.5 border-b-2 capitalize ${tab === entry ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
          >
            {entry === "matrix" ? "Allocation Matrix" : entry === "heatmap" ? "Utilisation Heatmap" : "Register"}
          </button>
        ))}
      </div>

      {tab === "matrix" ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-center text-sm">
            <label className="text-gray-500">Phase:</label>
            <select value={selectedPhase} onChange={(event) => setSelectedPhase(event.target.value)} className="border rounded px-2 py-1">
              {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
            </select>
            {utilisation.byPhase?.[selectedPhase]?.underStaffed ? (
              <span className="text-xs text-yellow-600">⚠ Under-staffed</span>
            ) : null}
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {["Resource", "Role", "Allocation %", "Workstream", "Total Load"].map((heading) => (
                  <th key={heading} className="border px-2 py-1 text-left font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!resources.length ? (
                <tr><td colSpan={5} className="border px-2 py-3 text-center text-gray-400">Add resources to the register first.</td></tr>
              ) : null}
              {resources.map((resource) => {
                const allocation = allocations?.[selectedPhase]?.[resource.id];
                const total = totals[resource.id];
                const isEditing = editCell?.phase === selectedPhase && editCell.rid === resource.id;
                return (
                  <tr key={resource.id} className={total?.overAllocated ? "bg-red-50" : ""}>
                    <td className="border px-2 py-1 font-medium">{resource.name}</td>
                    <td className="border px-2 py-1 text-gray-500">{resource.role}</td>
                    <td className="border px-2 py-1">
                      {isEditing ? (
                        <div className="space-y-1">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={cellPct}
                              onChange={(event) => setCellPct(event.target.value)}
                              className="w-16 border rounded px-1 py-0.5"
                            />
                            <button type="button" onClick={commitCell} className="text-green-600">✓</button>
                            <button type="button" onClick={() => setEditCell(null)} className="text-red-400">✗</button>
                          </div>
                          <input
                            placeholder="Workstream"
                            value={cellWorkstream}
                            onChange={(event) => setCellWorkstream(event.target.value)}
                            className="w-full border rounded px-1 py-0.5"
                          />
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => {
                            setEditCell({ phase: selectedPhase, rid: resource.id });
                            setCellPct(String(allocation?.pct || 0));
                            setCellWorkstream(allocation?.workstream || "");
                          }}
                        >
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div className={`${getPctColor(allocation?.pct || 0)} h-2 rounded-full`} style={{ width: `${allocation?.pct || 0}%` }} />
                          </div>
                          <span className="font-mono">{allocation?.pct || 0}%</span>
                        </div>
                      )}
                    </td>
                    <td className="border px-2 py-1 text-gray-500">{allocation?.workstream || "—"}</td>
                    <td className={`border px-2 py-1 font-mono ${total?.overAllocated ? "text-red-600 font-bold" : ""}`}>
                      {total?.totalPct || 0}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "register" ? (
        <div className="space-y-1">
          {!resources.length ? <p className="text-sm text-gray-400">No resources registered.</p> : null}
          {resources.map((resource) => (
            <div key={resource.id} className="border rounded p-2 flex items-start justify-between gap-2 text-sm">
              <div>
                <span className="font-medium">{resource.name}</span>
                <span className="text-gray-400 ml-2 text-xs">{resource.role}</span>
                <p className="text-xs text-gray-400">{resource.availability}% available · {resource.skills}</p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(resource.id)}
                className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600"
              >
                Del
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "heatmap" ? (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-2 py-1 text-left">Resource</th>
                {PHASES.map((phaseId) => (
                  <th key={phaseId} className="border px-2 py-1 capitalize font-medium">{phaseId.slice(0, 5)}</th>
                ))}
                <th className="border px-2 py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => {
                const util = totals[resource.id] || { byPhase: {}, totalPct: 0, overAllocated: false };
                return (
                  <tr key={resource.id} className={util.overAllocated ? "bg-red-50" : ""}>
                    <td className="border px-2 py-1 font-medium whitespace-nowrap">{resource.name}</td>
                    {PHASES.map((phaseId) => {
                      const pct = util.byPhase?.[phaseId] || 0;
                      return (
                        <td key={phaseId} className="border px-1 py-1 text-center">
                          {pct > 0 ? (
                            <div className={`w-full h-5 rounded text-white text-[10px] flex items-center justify-center font-mono ${
                              pct > 100 ? "bg-red-500" : pct > 80 ? "bg-yellow-400 text-gray-800" : "bg-green-500"
                            }`}>
                              {pct}%
                            </div>
                          ) : (
                            <span className="text-gray-200">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={`border px-2 py-1 font-mono font-bold text-center ${
                      util.overAllocated ? "text-red-600" : util.totalPct > 80 ? "text-yellow-600" : "text-green-600"
                    }`}
                    >
                      {util.totalPct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
