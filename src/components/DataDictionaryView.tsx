import { useEffect, useMemo, useRef, useState } from "react";
import { generateId } from "@/lib/adamUtils";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "pii", "sensitive"];
const TYPES = ["entity", "field", "system", "integration"];
const CLASS_COLORS: Record<string, string> = {
  public: "bg-green-100 text-green-700",
  internal: "bg-blue-100 text-blue-700",
  confidential: "bg-yellow-100 text-yellow-700",
  restricted: "bg-orange-100 text-orange-700",
  pii: "bg-red-100 text-red-700",
  sensitive: "bg-red-200 text-red-800",
};
const BLANK = {
  name: "",
  type: "entity",
  description: "",
  owningSystem: "",
  classification: "internal",
  owner: "",
  notes: "",
  governanceEntry: false,
};

interface DataEntry {
  id: string;
  name: string;
  type: string;
  description: string;
  owningSystem: string;
  classification: string;
  owner: string;
  referencedIn: string[];
  governanceEntry: boolean;
  notes?: string;
  addedAt: number;
}

interface Props {
  entries: DataEntry[];
  focusEntryId?: string | null;
  focusClassification?: string | null;
  focusToken?: number;
  onSave: (entry: any) => void;
  onDelete: (id: string) => void;
  onToggleGovernance: (id: string) => void;
}

export function DataDictionaryView({
  entries,
  focusEntryId = null,
  focusClassification = null,
  focusToken = 0,
  onSave,
  onDelete,
  onToggleGovernance,
}: Props) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [selected, setSelected] = useState<DataEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ ...BLANK });
  const [sortBy, setSortBy] = useState<"name" | "classification" | "type">("name");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const filtered = useMemo(() => entries
    .filter((entry) => (
      (filterType === "all" || entry.type === filterType)
      && (filterClass === "all" || entry.classification === filterClass)
      && (
        !search
        || entry.name.toLowerCase().includes(search.toLowerCase())
        || entry.description?.toLowerCase().includes(search.toLowerCase())
      )
    ))
    .sort((left, right) => `${left[sortBy] || ""}`.localeCompare(`${right[sortBy] || ""}`)),
  [entries, filterClass, filterType, search, sortBy]);

  const piiCount = entries.filter((entry) => ["pii", "sensitive", "restricted"].includes(entry.classification)).length;
  const governanceGaps = entries.filter((entry) => (
    ["pii", "sensitive", "restricted"].includes(entry.classification) && !entry.governanceEntry
  )).length;
  const detail = selected ? entries.find((entry) => entry.id === selected.id) || selected : null;
  const focusedEntry = focusEntryId ? entries.find((entry) => entry.id === focusEntryId) || null : null;
  const focusMessage = focusedEntry
    ? `ADAM brought you to "${focusedEntry.name}" so you can review the exact governance or classification issue behind the alert.`
    : focusClassification === "governance_gap"
      ? "ADAM brought you to the data governance gaps so you can resolve sensitive entries missing governance coverage."
      : focusClassification
        ? `ADAM brought you to ${focusClassification} data entries so you can review the relevant governance set quickly.`
        : null;

  useEffect(() => {
    if (focusClassification === "governance_gap") {
      setFilterClass("all");
    } else if (focusClassification) {
      setFilterClass(focusClassification);
    }

    const targetEntry = focusEntryId
      ? entries.find((entry) => entry.id === focusEntryId)
      : focusClassification === "governance_gap"
        ? entries.find((entry) => ["pii", "sensitive", "restricted"].includes(entry.classification) && !entry.governanceEntry)
        : null;
    if (!targetEntry) return;
    setSelected(targetEntry);
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current[targetEntry.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries, focusClassification, focusEntryId, focusToken]);

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    onSave({ ...form, id: form.id || generateId(), referencedIn: form.referencedIn || [] });
    setForm({ ...BLANK });
    setOpen(false);
  }

  function exportCsv() {
    const header = "Name,Type,Classification,OwningSystem,Owner,GovernanceEntry,References\n";
    const rows = entries.map((entry) => [
      `"${String(entry.name || "").replace(/"/g, "\"\"")}"`,
      entry.type,
      entry.classification,
      entry.owningSystem || "",
      entry.owner || "",
      entry.governanceEntry ? "yes" : "no",
      (entry.referencedIn || []).join("|"),
    ].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "data-dictionary.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4">
      {focusMessage ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">{focusMessage}</div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Data Dictionary</h2>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value);
              setForm({ ...BLANK, id: generateId() });
            }}
            className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
          >
            + Add Entry
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-xs">
        <span>{entries.length} entries</span>
        {piiCount > 0 ? <span className="text-red-600">{piiCount} sensitive/PII</span> : null}
        {governanceGaps > 0 ? (
          <span className="text-orange-600 font-medium">⚠ {governanceGaps} governance gap{governanceGaps !== 1 ? "s" : ""}</span>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submitForm} className="border rounded p-3 bg-gray-50 grid grid-cols-2 gap-2 text-sm">
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm((prev: any) => ({ ...prev, name: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <select
            value={form.type}
            onChange={(event) => setForm((prev: any) => ({ ...prev, type: event.target.value }))}
            className="border rounded px-2 py-1"
          >
            {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <textarea
            required
            placeholder="Description"
            rows={2}
            value={form.description}
            onChange={(event) => setForm((prev: any) => ({ ...prev, description: event.target.value }))}
            className="col-span-2 border rounded px-2 py-1 resize-none"
          />
          <input
            placeholder="Owning system"
            value={form.owningSystem}
            onChange={(event) => setForm((prev: any) => ({ ...prev, owningSystem: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <select
            value={form.classification}
            onChange={(event) => setForm((prev: any) => ({ ...prev, classification: event.target.value }))}
            className="border rounded px-2 py-1"
          >
            {CLASSIFICATIONS.map((classification) => (
              <option key={classification} value={classification}>{classification}</option>
            ))}
          </select>
          <input
            placeholder="Data owner"
            value={form.owner}
            onChange={(event) => setForm((prev: any) => ({ ...prev, owner: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <input
            placeholder="Notes"
            value={form.notes || ""}
            onChange={(event) => setForm((prev: any) => ({ ...prev, notes: event.target.value }))}
            className="border rounded px-2 py-1"
          />
          <label className="flex items-center gap-2 text-xs col-span-2">
            <input
              type="checkbox"
              checked={form.governanceEntry}
              onChange={(event) => setForm((prev: any) => ({ ...prev, governanceEntry: event.target.checked }))}
            />
            Governance entry exists
          </label>
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-3 py-1.5 rounded">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-gray-200">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2 flex-wrap text-xs">
        <input
          placeholder="Search..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="border rounded px-2 py-1 text-sm w-40"
        />
        <select value={filterType} onChange={(event) => setFilterType(event.target.value)} className="border rounded px-2 py-1">
          <option value="all">All Types</option>
          {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filterClass} onChange={(event) => setFilterClass(event.target.value)} className="border rounded px-2 py-1">
          <option value="all">All Classifications</option>
          {CLASSIFICATIONS.map((classification) => (
            <option key={classification} value={classification}>{classification}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as any)} className="border rounded px-2 py-1">
          {["name", "classification", "type"].map((entry) => (
            <option key={entry} value={entry}>Sort: {entry}</option>
          ))}
        </select>
        <span className="text-gray-400 self-center">{filtered.length} shown</span>
      </div>

      <div className="flex gap-4 h-[440px]">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="bg-gray-50">
                {["Name", "Type", "Classification", "Owning System", "Governance", "References"].map((heading) => (
                  <th key={heading} className="border px-2 py-1 text-left font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="border px-2 py-4 text-center text-gray-400">No entries match.</td></tr>
              ) : null}
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  ref={(node) => { rowRefs.current[entry.id] = node; }}
                  onClick={() => setSelected(entry)}
                  className={`cursor-pointer hover:bg-gray-50 ${selected?.id === entry.id ? "bg-indigo-50" : ""} ${
                    !entry.governanceEntry && ["pii", "sensitive", "restricted"].includes(entry.classification) ? "bg-red-50" : ""
                  }`}
                >
                  <td className="border px-2 py-1 font-medium">{entry.name}</td>
                  <td className="border px-2 py-1 capitalize">{entry.type}</td>
                  <td className="border px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded ${CLASS_COLORS[entry.classification] || "bg-gray-100"}`}>{entry.classification}</span>
                  </td>
                  <td className="border px-2 py-1">{entry.owningSystem || "—"}</td>
                  <td className="border px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGovernance(entry.id);
                      }}
                      className={`text-lg ${entry.governanceEntry ? "text-green-500" : "text-gray-300 hover:text-gray-400"}`}
                    >
                      {entry.governanceEntry ? "✓" : "○"}
                    </button>
                  </td>
                  <td className="border px-2 py-1 text-gray-400">{(entry.referencedIn || []).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail ? (
          <div className="w-60 border rounded p-3 text-sm space-y-3 overflow-y-auto shrink-0">
            <div className="flex justify-between">
              <h3 className="font-semibold">{detail.name}</h3>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-400">✕</button>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded ${CLASS_COLORS[detail.classification] || "bg-gray-100"}`}>{detail.classification}</span>
            <p className="text-xs text-gray-600">{detail.description}</p>
            {detail.owningSystem ? <p className="text-xs"><span className="text-gray-400">System:</span> {detail.owningSystem}</p> : null}
            {detail.owner ? <p className="text-xs"><span className="text-gray-400">Owner:</span> {detail.owner}</p> : null}
            {detail.notes ? <p className="text-xs text-gray-500">{detail.notes}</p> : null}
            <div>
              <p className="text-xs text-gray-400 mb-1">Referenced in ({(detail.referencedIn || []).length}):</p>
              {(detail.referencedIn || []).map((reference, index) => (
                <div key={`${reference}-${index}`} className="text-xs text-indigo-600 font-mono">{reference}</div>
              ))}
            </div>
            <div className="flex gap-1 pt-1 border-t">
              <button
                type="button"
                onClick={() => onToggleGovernance(detail.id)}
                className={`flex-1 text-xs py-1 rounded ${detail.governanceEntry ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}
              >
                {detail.governanceEntry ? "Governance OK" : "Mark Governed"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(detail.id);
                  setSelected(null);
                }}
                className="text-xs px-2 rounded bg-red-50 text-red-600 hover:bg-red-100"
              >
                Del
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
