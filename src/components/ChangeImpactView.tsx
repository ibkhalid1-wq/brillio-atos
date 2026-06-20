import { useEffect, useRef, useState } from "react";

const DIMS = [
  { id: "people", label: "People & Culture", description: "Headcount, roles, skills, behaviours, resistance" },
  { id: "process", label: "Process", description: "Workflows, procedures, handovers, controls" },
  { id: "technology", label: "Technology", description: "Systems, integrations, data, infrastructure" },
  { id: "data", label: "Data & Information", description: "Data flows, quality, ownership, privacy" },
  { id: "governance", label: "Governance & Compliance", description: "Policies, regulations, audit, risk controls" },
  { id: "culture", label: "Culture & Change", description: "Mindset, engagement, communication needs" },
  { id: "finance", label: "Finance", description: "Cost, revenue, budget impact, ROI" },
  { id: "customers", label: "Customers & Partners", description: "External stakeholders, SLAs, experience impact" },
];

const LEVELS = ["none", "low", "medium", "high", "critical"];
const LEVEL_COLORS: Record<string, string> = {
  none: "bg-gray-100 text-gray-500",
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

interface DimInput {
  level: string;
  notes: string;
}

interface Assessment {
  id: string;
  title: string;
  assessedAt: number;
  dimensions: Record<string, DimInput>;
  overallScore: number;
  maxScore: number;
  intensity: number;
  summary: string;
  topRisks: string[];
  recommendedApproach: string;
  approved: boolean;
  pcrId: string | null;
}

interface PCR {
  id: string;
  title: string;
}

interface Props {
  assessments: Assessment[];
  pcrs: PCR[];
  focusAssessmentId?: string | null;
  focusPcrId?: string | null;
  focusTab?: "form" | "results";
  focusToken?: number;
  onGenerate: (pcrId: string | null, title: string, dims: Record<string, DimInput>) => Promise<Assessment | null | void>;
  onSave: (assessment: Assessment) => void;
}

export function ChangeImpactView({
  assessments,
  pcrs,
  focusAssessmentId = null,
  focusPcrId = null,
  focusTab,
  focusToken = 0,
  onGenerate,
  onSave,
}: Props) {
  const blank = Object.fromEntries(DIMS.map((entry) => [entry.id, { level: "none", notes: "" }])) as Record<string, DimInput>;
  const [dimensions, setDimensions] = useState<Record<string, DimInput>>(blank);
  const [title, setTitle] = useState("");
  const [pcrId, setPcrId] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Assessment | null>(assessments[0] || null);
  const [tab, setTab] = useState<"form" | "results">("form");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusedAssessment = focusAssessmentId
    ? assessments.find((entry) => entry.id === focusAssessmentId) || null
    : focusPcrId
      ? assessments.find((entry) => entry.pcrId === focusPcrId) || null
      : null;
  const focusedPcr = focusPcrId ? pcrs.find((entry) => entry.id === focusPcrId) || null : null;

  useEffect(() => {
    if (!selected && assessments[0]) setSelected(assessments[0]);
    if (selected && !assessments.find((entry) => entry.id === selected.id) && assessments[0]) {
      setSelected(assessments[0]);
    }
  }, [assessments, selected]);

  useEffect(() => {
    if (!focusToken && !focusAssessmentId && !focusPcrId && !focusTab) return;
    if (focusTab) setTab(focusTab);
    const linkedAssessment = focusAssessmentId
      ? assessments.find((entry) => entry.id === focusAssessmentId)
      : focusPcrId
        ? assessments.find((entry) => entry.pcrId === focusPcrId)
        : null;
    if (linkedAssessment) {
      setSelected(linkedAssessment);
      setTab("results");
      setHighlightId(linkedAssessment.id);
      const frame = window.requestAnimationFrame(() => {
        itemRefs.current[linkedAssessment.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const timer = window.setTimeout(() => {
        setHighlightId((current) => (current === linkedAssessment.id ? null : current));
      }, 2200);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
      };
    }
    if (focusPcrId) {
      setPcrId(focusPcrId);
      const linkedPcr = pcrs.find((entry) => entry.id === focusPcrId);
      if (linkedPcr) {
        setTitle((current) => (current?.trim() ? current : linkedPcr.title));
      }
      setTab(focusTab || "form");
    }
  }, [assessments, focusAssessmentId, focusPcrId, focusTab, focusToken, pcrs]);

  function setDimensionLevel(id: string, level: string) {
    setDimensions((previous) => ({ ...previous, [id]: { ...previous[id], level } }));
  }

  function setDimensionNotes(id: string, notes: string) {
    setDimensions((previous) => ({ ...previous, [id]: { ...previous[id], notes } }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const assessment = await onGenerate(pcrId || null, title, dimensions);
    if (assessment) {
      setSelected(assessment);
    }
    setLoading(false);
    setTab("results");
  }

  const detail = selected ? assessments.find((entry) => entry.id === selected.id) || selected : null;

  function getIntensityColor(pct: number) {
    return pct >= 70 ? "text-red-600" : pct >= 40 ? "text-yellow-600" : "text-green-600";
  }

  return (
    <div className="p-4 space-y-4">
      {focusedAssessment || focusedPcr ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            {focusedAssessment
              ? `ADAM brought you to the linked impact assessment "${focusedAssessment.title}" so you can review the change implications without searching the register.`
              : `ADAM brought you directly into the impact assessment flow for "${focusedPcr?.title || "this change request"}" so you can complete the evaluation now.`}
          </div>
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">Change Impact Assessment</h2>

      <div className="flex gap-2 border-b">
        {(["form", "results"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={`text-sm px-3 py-1.5 border-b-2 ${tab === entry ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
          >
            {entry === "form" ? "New Assessment" : `Assessments (${assessments.length})`}
          </button>
        ))}
      </div>

      {tab === "form" ? (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <input
              required
              placeholder="Assessment title / change name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="col-span-2 border rounded px-2 py-1"
            />
            <div>
              <label className="text-xs text-gray-500">Linked Change Request (optional)</label>
              <select value={pcrId} onChange={(event) => setPcrId(event.target.value)} className="w-full border rounded px-2 py-1">
                <option value="">— None —</option>
                {pcrs.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {DIMS.map((dimension) => (
              <div key={dimension.id} className="border rounded p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">{dimension.label}</span>
                    <p className="text-xs text-gray-400">{dimension.description}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setDimensionLevel(dimension.id, level)}
                        className={`text-xs px-1.5 py-0.5 rounded capitalize border ${
                          dimensions[dimension.id]?.level === level
                            ? `${LEVEL_COLORS[level]} border-transparent`
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  placeholder="Notes on this dimension..."
                  value={dimensions[dimension.id]?.notes || ""}
                  onChange={(event) => setDimensionNotes(dimension.id, event.target.value)}
                  className="w-full border rounded px-2 py-1 text-xs mt-2"
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="bg-indigo-600 text-white text-sm px-6 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Generating assessment..." : "Generate Change Impact Assessment"}
          </button>
        </form>
      ) : (
        <div className="flex gap-4 h-[520px]">
          <div className="w-1/3 overflow-y-auto border-r pr-2 space-y-1">
            {!assessments.length ? <p className="text-sm text-gray-400 text-center pt-8">No assessments yet.</p> : null}
            {assessments.map((assessment) => (
              <div
                key={assessment.id}
                ref={(node) => { itemRefs.current[assessment.id] = node; }}
                onClick={() => setSelected(assessment)}
                className={`border rounded p-2 cursor-pointer text-xs ${
                  selected?.id === assessment.id
                    ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                    : highlightId === assessment.id
                      ? "border-indigo-300 bg-indigo-50/70 ring-2 ring-indigo-100"
                      : "hover:bg-gray-50"
                }`}
              >
                <p className="font-medium">{assessment.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${assessment.intensity >= 70 ? "bg-red-500" : assessment.intensity >= 40 ? "bg-yellow-400" : "bg-green-500"}`}
                      style={{ width: `${assessment.intensity}%` }}
                    />
                  </div>
                  <span className={getIntensityColor(assessment.intensity)}>{assessment.intensity}%</span>
                </div>
                <p className="text-gray-400 mt-0.5">{new Date(assessment.assessedAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto text-sm">
            {detail ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">{detail.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-xs">
                      <div
                        className={`h-2 rounded-full ${detail.intensity >= 70 ? "bg-red-500" : detail.intensity >= 40 ? "bg-yellow-400" : "bg-green-500"}`}
                        style={{ width: `${detail.intensity}%` }}
                      />
                    </div>
                    <span className={`font-bold text-lg ${getIntensityColor(detail.intensity)}`}>{detail.intensity}% intensity</span>
                  </div>
                </div>

                {detail.summary ? <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{detail.summary}</p> : null}

                <div className="grid grid-cols-2 gap-1">
                  {DIMS.map((dimension) => {
                    const entry = detail.dimensions?.[dimension.id];
                    return (
                      <div key={dimension.id} className="border rounded p-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{dimension.label}</span>
                          <span className={`px-1.5 rounded ${LEVEL_COLORS[entry?.level || "none"]}`}>{entry?.level || "none"}</span>
                        </div>
                        {entry?.notes ? <p className="text-gray-500 mt-0.5">{entry.notes}</p> : null}
                      </div>
                    );
                  })}
                </div>

                {detail.topRisks?.length ? (
                  <div>
                    <p className="text-xs font-medium text-red-600 mb-1">Top Risks</p>
                    <ul className="list-disc pl-4 text-xs text-gray-700 space-y-0.5">
                      {detail.topRisks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}
                    </ul>
                  </div>
                ) : null}

                {detail.recommendedApproach ? (
                  <div className="bg-blue-50 border border-blue-100 rounded p-3 text-xs">
                    <p className="font-medium text-blue-800 mb-1">Recommended Approach</p>
                    <p className="text-blue-700">{detail.recommendedApproach}</p>
                  </div>
                ) : null}

                {!detail.approved ? (
                  <button
                    type="button"
                    onClick={() => onSave({ ...detail, approved: true })}
                    className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                  >
                    ✓ Approve Assessment
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-gray-400 text-sm text-center pt-12">Select an assessment to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
