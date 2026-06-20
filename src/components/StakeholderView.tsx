import React, { useEffect, useRef, useState } from "react";

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const RACI_COLORS: Record<string, string> = { R: "bg-red-100 text-red-700", A: "bg-orange-100 text-orange-700", C: "bg-blue-100 text-blue-700", I: "bg-gray-100 text-gray-600" };
const ENGAGEMENT_COLORS: Record<string, string> = { unaware: "text-gray-400", resistant: "text-red-600", neutral: "text-yellow-500", supportive: "text-blue-600", champion: "text-green-600" };
const BLANK_STAKEHOLDER = { name: "", role: "", organisation: "", influence: 5, interest: 5, engagement: "neutral", notes: "" };

interface Stakeholder {
  id: string;
  name: string;
  role: string;
  organisation: string;
  influence: number;
  interest: number;
  engagement: string;
  notes: string;
  lastContactedAt?: number;
}

interface Props {
  stakeholders: Stakeholder[];
  raciMatrix: Record<string, Record<string, Record<string, string>>>;
  focusStakeholderId?: string | null;
  focusTab?: "register" | "raci" | "map";
  focusToken?: number;
  onSave: (stakeholder: any) => void;
  onDelete: (id: string) => void;
  onRACISet: (phaseId: string, activityId: string, stakeholderId: string, role: string) => void;
  onContact: (id: string) => void;
}

function getTier(influence: number, interest: number) {
  if (influence >= 7 && interest >= 7) return { label: "Manage Closely", color: "text-red-600" };
  if (interest >= 7) return { label: "Keep Informed", color: "text-blue-600" };
  if (influence >= 7) return { label: "Keep Satisfied", color: "text-yellow-600" };
  return { label: "Monitor", color: "text-gray-400" };
}

export function StakeholderView({
  stakeholders,
  raciMatrix,
  focusStakeholderId = null,
  focusTab,
  focusToken = 0,
  onSave,
  onDelete,
  onRACISet,
  onContact,
}: Props) {
  const [tab, setTab] = useState<"register" | "raci" | "map">("register");
  const [form, setForm] = useState<any>({ ...BLANK_STAKEHOLDER });
  const [editing, setEditing] = useState<string | null>(null);
  const [raciPhase, setRaciPhase] = useState(PHASES[0]);
  const [newActivity, setNewActivity] = useState("");
  const [highlightStakeholderId, setHighlightStakeholderId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activities = Object.keys(raciMatrix?.[raciPhase] || {});
  const focusedStakeholder = focusStakeholderId ? stakeholders.find((entry) => entry.id === focusStakeholderId) || null : null;
  const focusMessage = focusedStakeholder
    ? `ADAM brought you to "${focusedStakeholder.name}" so you can review stakeholder attention, engagement, or responsibility coverage immediately.`
    : focusTab === "raci"
      ? "ADAM brought you to the RACI matrix so you can review the ownership pattern behind the current action."
      : focusTab === "map"
        ? "ADAM brought you to the influence map so you can review stakeholder concentration and attention needs."
        : null;

  useEffect(() => {
    if (focusTab) setTab(focusTab);
    if (!focusStakeholderId) return;
    setHighlightStakeholderId(focusStakeholderId);
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current[focusStakeholderId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => {
      setHighlightStakeholderId((current) => (current === focusStakeholderId ? null : current));
    }, 2200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusStakeholderId, focusTab, focusToken]);

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    onSave({ ...form, id: form.id || crypto.randomUUID() });
    setForm({ ...BLANK_STAKEHOLDER });
    setEditing(null);
  }

  return (
    <div className="p-4 space-y-4">
      {focusMessage ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">{focusMessage}</div>
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">Stakeholder Register & RACI</h2>

      <div className="flex gap-2 border-b">
        {(["register", "raci", "map"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`text-sm px-3 py-1.5 border-b-2 capitalize ${tab === value ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
          >
            {value === "map" ? "Influence Map" : value === "raci" ? "RACI Matrix" : "Register"}
          </button>
        ))}
      </div>

      {tab === "register" ? (
        <div className="space-y-3">
          <button
            onClick={() => { setEditing("new"); setForm({ ...BLANK_STAKEHOLDER, id: crypto.randomUUID() }); }}
            className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
          >
            + Add Stakeholder
          </button>
          {editing ? (
            <form onSubmit={submitForm} className="border rounded p-3 bg-gray-50 grid grid-cols-2 gap-2 text-sm">
              <input required placeholder="Full name" value={form.name} onChange={(event) => setForm((current: any) => ({ ...current, name: event.target.value }))} className="border rounded px-2 py-1" />
              <input placeholder="Role/Title" value={form.role} onChange={(event) => setForm((current: any) => ({ ...current, role: event.target.value }))} className="border rounded px-2 py-1" />
              <input placeholder="Organisation" value={form.organisation} onChange={(event) => setForm((current: any) => ({ ...current, organisation: event.target.value }))} className="border rounded px-2 py-1" />
              <select value={form.engagement} onChange={(event) => setForm((current: any) => ({ ...current, engagement: event.target.value }))} className="border rounded px-2 py-1">
                {["unaware", "resistant", "neutral", "supportive", "champion"].map((engagement) => <option key={engagement} value={engagement}>{engagement}</option>)}
              </select>
              <div>
                <label className="text-xs text-gray-500">Influence (1–10): {form.influence}</label>
                <input type="range" min={1} max={10} value={form.influence} onChange={(event) => setForm((current: any) => ({ ...current, influence: Number(event.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Interest (1–10): {form.interest}</label>
                <input type="range" min={1} max={10} value={form.interest} onChange={(event) => setForm((current: any) => ({ ...current, interest: Number(event.target.value) }))} className="w-full" />
              </div>
              <textarea placeholder="Notes" rows={2} value={form.notes} onChange={(event) => setForm((current: any) => ({ ...current, notes: event.target.value }))} className="col-span-2 border rounded px-2 py-1 resize-none" />
              <div className="col-span-2 flex gap-2">
                <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
              </div>
            </form>
          ) : null}
          <div className="space-y-1">
            {!stakeholders.length ? <p className="text-sm text-gray-400">No stakeholders registered yet.</p> : null}
            {stakeholders.map((stakeholder) => {
              const tier = getTier(stakeholder.influence || 5, stakeholder.interest || 5);
              return (
                <div
                  key={stakeholder.id}
                  ref={(node) => { rowRefs.current[stakeholder.id] = node; }}
                  className={`border rounded p-2 flex items-start justify-between gap-2 text-sm transition-all ${
                    highlightStakeholderId === stakeholder.id ? "ring-2 ring-indigo-400 bg-indigo-50" : ""
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{stakeholder.name}</span>
                      <span className={`text-xs ${tier.color}`}>{tier.label}</span>
                      <span className={`text-xs ${ENGAGEMENT_COLORS[stakeholder.engagement] || ""}`}>{stakeholder.engagement}</span>
                    </div>
                    <p className="text-xs text-gray-400">{stakeholder.role}{stakeholder.organisation ? ` · ${stakeholder.organisation}` : ""}</p>
                    {stakeholder.lastContactedAt ? <p className="text-xs text-gray-300">Last contact: {new Date(stakeholder.lastContactedAt).toLocaleDateString()}</p> : null}
                  </div>
                  <div className="flex gap-1 text-xs shrink-0">
                    <button onClick={() => onContact(stakeholder.id)} className="px-2 py-0.5 rounded bg-green-50 text-green-700 hover:bg-green-100">✓ Contacted</button>
                    <button onClick={() => { setEditing(stakeholder.id); setForm({ ...stakeholder }); }} className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">Edit</button>
                    <button onClick={() => onDelete(stakeholder.id)} className="px-2 py-0.5 rounded bg-red-50 text-red-600">Del</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "raci" ? (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <select value={raciPhase} onChange={(event) => setRaciPhase(event.target.value)} className="border rounded px-2 py-1 text-sm">
              {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
            </select>
            <input placeholder="Add activity…" value={newActivity} onChange={(event) => setNewActivity(event.target.value)} className="border rounded px-2 py-1 text-sm" />
            <button
              onClick={() => {
                if (!newActivity.trim() || !stakeholders[0]?.id) return;
                onRACISet(raciPhase, newActivity.trim(), stakeholders[0].id, "I");
                setNewActivity("");
              }}
              className="text-sm bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200"
            >
              Add
            </button>
          </div>
          {!activities.length ? (
            <p className="text-sm text-gray-400">No activities defined for this phase yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1 text-left w-32">Activity</th>
                    {stakeholders.map((stakeholder) => (
                      <th key={stakeholder.id} className="border px-2 py-1 text-center font-medium">{stakeholder.name.split(" ")[0]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activityId) => (
                    <tr key={activityId} className="hover:bg-gray-50">
                      <td className="border px-2 py-1 font-medium">{activityId}</td>
                      {stakeholders.map((stakeholder) => {
                        const current = raciMatrix?.[raciPhase]?.[activityId]?.[stakeholder.id] || "";
                        return (
                          <td key={stakeholder.id} className="border px-1 py-1 text-center">
                            <select
                              value={current}
                              onChange={(event) => onRACISet(raciPhase, activityId, stakeholder.id, event.target.value)}
                              className={`text-xs rounded px-1 py-0.5 font-bold ${RACI_COLORS[current] || "bg-white"}`}
                            >
                              <option value="">—</option>
                              {["R", "A", "C", "I"].map((role) => <option key={role} value={role}>{role}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "map" ? (
        <div>
          <svg width="500" height="400" className="border rounded bg-gray-50 w-full">
            <line x1="250" y1="0" x2="250" y2="400" stroke="#e5e7eb" strokeWidth="1" />
            <line x1="0" y1="200" x2="500" y2="200" stroke="#e5e7eb" strokeWidth="1" />
            <text x="130" y="14" textAnchor="middle" fontSize="10" fill="#9ca3af">Keep Satisfied</text>
            <text x="370" y="14" textAnchor="middle" fontSize="10" fill="#9ca3af">Manage Closely</text>
            <text x="130" y="395" textAnchor="middle" fontSize="10" fill="#9ca3af">Monitor</text>
            <text x="370" y="395" textAnchor="middle" fontSize="10" fill="#9ca3af">Keep Informed</text>
            <text x="255" y="200" fontSize="9" fill="#d1d5db">Interest →</text>
            {stakeholders.map((stakeholder) => {
              const x = 20 + ((stakeholder.interest || 5) / 10) * 460;
              const y = 380 - ((stakeholder.influence || 5) / 10) * 360;
              const tier = getTier(stakeholder.influence || 5, stakeholder.interest || 5);
              return (
                <g key={stakeholder.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={14}
                    fill={tier.label === "Manage Closely" ? "#ef4444" : tier.label === "Keep Informed" ? "#3b82f6" : tier.label === "Keep Satisfied" ? "#f59e0b" : "#d1d5db"}
                    opacity={0.8}
                  />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="600">
                    {stakeholder.name.split(" ").map((word: string) => word[0]).join("").slice(0, 3)}
                  </text>
                  <text x={x} y={y + 24} textAnchor="middle" fontSize="8" fill="#374151">{stakeholder.name.split(" ")[0]}</text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}
    </div>
  );
}
