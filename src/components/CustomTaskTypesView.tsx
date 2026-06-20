import React, { useState } from "react";
import { generateId } from "@/lib/adamUtils";

const TRIGGER_TYPES = [
  { id: "field_populated", label: "Field populated" },
  { id: "artifact_approved", label: "Artifact approved" },
  { id: "gate_passed", label: "Gate passed" },
  { id: "phase_entered", label: "Phase entered" },
  { id: "manual", label: "Manual only" },
];

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

const BLANK_TASK = {
  id: "",
  name: "",
  triggerType: "field_populated",
  triggerTarget: "",
  promptTemplate: "",
  outputQueueType: "draft_review",
  phases: PHASES,
  enabled: true,
};

interface TaskType {
  id: string;
  name: string;
  triggerType: string;
  triggerTarget: string;
  promptTemplate: string;
  outputQueueType: string;
  phases: string[];
  enabled: boolean;
}

interface Props {
  tasks: TaskType[];
  log: any[];
  onSave: (task: TaskType) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}

export function CustomTaskTypesView({ tasks, log, onSave, onDelete, onRun }: Props) {
  const [editing, setEditing] = useState<TaskType | null>(null);
  const [form, setForm] = useState<TaskType>({ ...BLANK_TASK });

  function startNew() {
    setForm({ ...BLANK_TASK, id: generateId() });
    setEditing(null);
  }

  function startEdit(task: TaskType) {
    setForm({ ...task });
    setEditing(task);
  }

  function togglePhase(phaseId: string) {
    setForm((current) => ({
      ...current,
      phases: current.phases.includes(phaseId)
        ? current.phases.filter((entry) => entry !== phaseId)
        : [...current.phases, phaseId],
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave(form);
    setForm({ ...BLANK_TASK, id: generateId() });
    setEditing(null);
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Custom Agent Task Types</h2>
        <button onClick={startNew} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700">
          + New Task Type
        </button>
      </div>

      <div className="space-y-2">
        {tasks.length === 0 ? <p className="text-sm text-gray-400">No custom task types yet.</p> : null}
        {tasks.map((task) => (
          <div key={task.id} className="border rounded p-3 flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${task.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="font-medium text-sm">{task.name}</span>
                <span className="text-xs text-gray-400 ml-1">→ {task.outputQueueType}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Trigger: {TRIGGER_TYPES.find((entry) => entry.id === task.triggerType)?.label}
                {task.triggerTarget ? ` on "${task.triggerTarget}"` : ""}
              </p>
            </div>
            <div className="flex gap-1 text-xs">
              <button onClick={() => onRun(task.id)} className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">▶ Run</button>
              <button onClick={() => startEdit(task)} className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">Edit</button>
              <button onClick={() => onDelete(task.id)} className="px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100">Del</button>
            </div>
          </div>
        ))}
      </div>

      {form.id ? (
        <form onSubmit={submit} className="border rounded p-4 space-y-3 bg-gray-50">
          <h3 className="text-sm font-semibold">{editing ? "Edit" : "New"} Task Type</h3>
          <input
            required
            placeholder="Task name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <select
            value={form.triggerType}
            onChange={(event) => setForm((current) => ({ ...current, triggerType: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            {TRIGGER_TYPES.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}
          </select>
          <input
            placeholder="Trigger target (field ID, artifact ID, or leave blank)"
            value={form.triggerTarget}
            onChange={(event) => setForm((current) => ({ ...current, triggerTarget: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <input
            placeholder="Output queue type (e.g. draft_review, escalation)"
            value={form.outputQueueType}
            onChange={(event) => setForm((current) => ({ ...current, outputQueueType: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div>
            <p className="text-xs text-gray-500 mb-1">Active phases:</p>
            <div className="flex flex-wrap gap-1">
              {PHASES.map((phaseId) => (
                <button
                  type="button"
                  key={phaseId}
                  onClick={() => togglePhase(phaseId)}
                  className={`text-xs px-2 py-0.5 rounded border ${form.phases.includes(phaseId) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-gray-300"}`}
                >
                  {phaseId}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">
              Prompt template — use {"{{program_name}}"}, {"{{phase}}"}, {"{{artifacts}}"}, {"{{objective}}"}, {"{{date}}"}
            </p>
            <textarea
              required
              rows={5}
              placeholder={"You are a program advisor for {{program_name}}. Given the current {{phase}} phase artifacts:\n{{artifacts}}\n\nGenerate..."}
              value={form.promptTemplate}
              onChange={(event) => setForm((current) => ({ ...current, promptTemplate: event.target.value }))}
              className="w-full border rounded px-2 py-1 text-sm font-mono resize-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Enabled
          </label>
          <div className="flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">Save</button>
            <button type="button" onClick={() => { setForm({ ...BLANK_TASK }); setEditing(null); }} className="text-sm px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      ) : null}

      {log.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium mb-2">Recent Executions</h3>
          <div className="space-y-1">
            {log.slice(-10).reverse().map((entry: any) => (
              <div key={entry.id} className="text-xs text-gray-500 border rounded px-2 py-1">
                [{entry.phaseId}] {tasks.find((task) => task.id === entry.taskTypeId)?.name || entry.taskTypeId}
                {" "}- {entry.outcome} - {new Date(entry.triggeredAt).toLocaleString()}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
