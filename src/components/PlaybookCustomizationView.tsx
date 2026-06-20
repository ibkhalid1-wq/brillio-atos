import { useState } from "react";

interface Activity {
  id: string;
  label: string;
  description?: string;
  notApplicable?: boolean;
  isCustom?: boolean;
}

interface EffectivePlaybook {
  activities: Activity[];
  milestones?: string[];
  artifacts?: any[];
}

interface Props {
  phases: string[];
  getPlaybook: (phaseId: string) => EffectivePlaybook;
  onAdd: (phaseId: string, activity: { label: string; description: string }) => void;
  onRemove: (phaseId: string, id: string) => void;
  onToggleNA: (phaseId: string, id: string) => void;
  onReset: (phaseId: string) => void;
  overrides: Record<string, any>;
}

export function PlaybookCustomizationView({
  phases,
  getPlaybook,
  onAdd,
  onRemove,
  onToggleNA,
  onReset,
  overrides,
}: Props) {
  const [selectedPhase, setSelectedPhase] = useState(phases[0] || "strategy");
  const [addForm, setAddForm] = useState({ label: "", description: "" });
  const [addOpen, setAddOpen] = useState(false);

  const playbook = getPlaybook(selectedPhase);
  const hasOverride = !!(
    overrides?.[selectedPhase]
    && (
      overrides[selectedPhase].additions?.length
      || overrides[selectedPhase].removals?.length
      || overrides[selectedPhase].notApplicable?.length
    )
  );

  function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    onAdd(selectedPhase, addForm);
    setAddForm({ label: "", description: "" });
    setAddOpen(false);
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Playbook Customization</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Customise the ADAM phase playbook for this program. Changes apply only to this program.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {phases.map((phaseId) => (
          <button
            key={phaseId}
            type="button"
            onClick={() => setSelectedPhase(phaseId)}
            className={`text-xs px-2.5 py-1 rounded-full border capitalize relative ${
              selectedPhase === phaseId ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            {phaseId}
            {overrides?.[phaseId] && (
              overrides[phaseId].additions?.length
              || overrides[phaseId].removals?.length
              || overrides[phaseId].notApplicable?.length
            ) ? <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-yellow-400 rounded-full" /> : null}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">
          {selectedPhase} Phase Activities
          {hasOverride ? <span className="ml-2 text-xs text-yellow-600">customised</span> : null}
        </h3>
        <div className="flex gap-2">
          {hasOverride ? (
            <button
              type="button"
              onClick={() => onReset(selectedPhase)}
              className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100"
            >
              Reset to default
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAddOpen((value) => !value)}
            className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded hover:bg-indigo-700"
          >
            + Add activity
          </button>
        </div>
      </div>

      {addOpen ? (
        <form onSubmit={submitAdd} className="border rounded p-3 bg-gray-50 space-y-2 text-sm">
          <input
            required
            placeholder="Activity name"
            value={addForm.label}
            onChange={(event) => setAddForm((prev) => ({ ...prev, label: event.target.value }))}
            className="w-full border rounded px-2 py-1"
          />
          <textarea
            placeholder="Description (optional)"
            rows={2}
            value={addForm.description}
            onChange={(event) => setAddForm((prev) => ({ ...prev, description: event.target.value }))}
            className="w-full border rounded px-2 py-1 resize-none"
          />
          <div className="flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm">Add</button>
            <button type="button" onClick={() => setAddOpen(false)} className="px-3 py-1.5 rounded bg-gray-200 text-sm">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="space-y-1">
        {(playbook.activities || []).length === 0 ? (
          <p className="text-sm text-gray-400">No activities defined for this phase.</p>
        ) : null}
        {(playbook.activities || []).map((activity, index) => (
          <div
            key={activity.id || String(index)}
            className={`border rounded p-2.5 flex items-start justify-between gap-2 text-sm ${
              activity.notApplicable ? "opacity-40" : ""
            } ${(activity as any).isCustom ? "border-indigo-200 bg-indigo-50" : ""}`}
          >
            <div className="flex items-start gap-2 flex-1">
              <span className="text-gray-300 text-xs mt-0.5 shrink-0">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <span className={`font-medium ${activity.notApplicable ? "line-through text-gray-400" : ""}`}>{activity.label}</span>
                {(activity as any).isCustom ? <span className="ml-2 text-xs text-indigo-500">custom</span> : null}
                {activity.description ? <p className="text-xs text-gray-500 mt-0.5">{activity.description}</p> : null}
              </div>
            </div>
            <div className="flex gap-1 text-xs shrink-0">
              <button
                type="button"
                onClick={() => onToggleNA(selectedPhase, activity.id)}
                className={`px-2 py-0.5 rounded border ${activity.notApplicable ? "bg-gray-200 border-gray-300" : "border-gray-300 hover:bg-gray-100"}`}
              >
                {activity.notApplicable ? "Re-enable" : "N/A"}
              </button>
              <button
                type="button"
                onClick={() => onRemove(selectedPhase, activity.id)}
                className="px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {playbook.artifacts && playbook.artifacts.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Phase Artifacts (read-only)</p>
          <div className="flex flex-wrap gap-1">
            {playbook.artifacts.map((artifact: any, index: number) => (
              <span key={`${typeof artifact === "string" ? artifact : artifact?.id || index}-${index}`} className="text-xs bg-gray-100 rounded px-2 py-0.5">
                {typeof artifact === "string" ? artifact : artifact?.label || artifact?.id}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
