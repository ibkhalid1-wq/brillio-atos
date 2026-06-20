import React, { useState } from "react";

const CHANNEL_TYPES = [
  { id: "slack", label: "Slack Webhook" },
  { id: "webhook", label: "Generic Webhook" },
  { id: "email", label: "Email Endpoint" },
];

const ALL_EVENTS = [
  "gate_approval",
  "risk_mitigation",
  "steering_pack",
  "communication_ready",
  "retro_ready",
  "budget_alert",
  "integration_conflict",
  "draft_review",
  "escalation",
  "scope_change",
  "hypothesis_alert",
  "capacity_alert",
  "*",
];

const BLANK_CHANNEL = { id: "", name: "", type: "slack", url: "", events: ["*"], enabled: true };

interface Channel {
  id: string;
  name: string;
  type: string;
  url: string;
  events: string[];
  enabled: boolean;
}

interface LogEntry {
  id: string;
  channelId: string;
  itemType: string;
  sentAt: number;
  status: string;
  attempts: number;
}

interface Props {
  channels: Channel[];
  log: LogEntry[];
  onSave: (channel: Channel) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
}

export function NotificationChannelsView({ channels, log, onSave, onDelete, onTest }: Props) {
  const [form, setForm] = useState<Channel>({ ...BLANK_CHANNEL, id: crypto.randomUUID() });
  const [open, setOpen] = useState(false);

  function toggleEvent(eventId: string) {
    setForm((current) => ({
      ...current,
      events: current.events.includes(eventId)
        ? current.events.filter((entry) => entry !== eventId)
        : [...current.events, eventId],
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave(form);
    setForm({ ...BLANK_CHANNEL, id: crypto.randomUUID() });
    setOpen(false);
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Notification Channels</h2>
        <button onClick={() => setOpen((value) => !value)} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700">
          + Add Channel
        </button>
      </div>

      <div className="space-y-2">
        {channels.length === 0 ? <p className="text-sm text-gray-400">No channels configured.</p> : null}
        {channels.map((channel) => (
          <div key={channel.id} className="border rounded p-3 flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${channel.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="font-medium text-sm">{channel.name}</span>
                <span className="text-xs bg-gray-100 px-1.5 rounded">{channel.type}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">{channel.url}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Events: {channel.events.includes("*") ? "all" : channel.events.join(", ")}
              </p>
            </div>
            <div className="flex gap-1 text-xs shrink-0">
              <button onClick={() => onTest(channel.id)} className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200">Test</button>
              <button onClick={() => onDelete(channel.id)} className="px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100">Del</button>
            </div>
          </div>
        ))}
      </div>

      {open ? (
        <form onSubmit={submit} className="border rounded p-4 space-y-3 bg-gray-50">
          <h3 className="text-sm font-semibold">New Channel</h3>
          <input
            required
            placeholder="Channel name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <select
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            {CHANNEL_TYPES.map((channelType) => <option key={channelType.id} value={channelType.id}>{channelType.label}</option>)}
          </select>
          <input
            required
            type="url"
            placeholder="Webhook URL"
            value={form.url}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            className="w-full border rounded px-2 py-1 text-sm font-mono"
          />
          <div>
            <p className="text-xs text-gray-500 mb-1">Subscribe to events:</p>
            <div className="flex flex-wrap gap-1">
              {ALL_EVENTS.map((eventId) => (
                <button
                  type="button"
                  key={eventId}
                  onClick={() => toggleEvent(eventId)}
                  className={`text-xs px-2 py-0.5 rounded border ${form.events.includes(eventId) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-gray-300"}`}
                >
                  {eventId === "*" ? "ALL" : eventId}
                </button>
              ))}
            </div>
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
            <button type="button" onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      ) : null}

      {log.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium mb-2">Delivery Log</h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {["Channel", "Event", "Sent At", "Status", "Attempts"].map((header) => (
                  <th key={header} className="border px-2 py-1 text-left">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.slice(-20).reverse().map((entry) => {
                const channel = channels.find((candidate) => candidate.id === entry.channelId);
                return (
                  <tr key={entry.id}>
                    <td className="border px-2 py-1">{channel?.name || entry.channelId.slice(0, 8)}</td>
                    <td className="border px-2 py-1 font-mono">{entry.itemType}</td>
                    <td className="border px-2 py-1">{new Date(entry.sentAt).toLocaleString()}</td>
                    <td className={`border px-2 py-1 ${entry.status === "sent" ? "text-green-600" : "text-red-500"}`}>{entry.status}</td>
                    <td className="border px-2 py-1 text-center">{entry.attempts}</td>
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
