import { useMemo, useState } from "react";

export interface ADRProposal {
  id: string;
  title?: string;
  chosenApproach?: string;
  rationale?: string;
  tradeOffs?: string;
  alternativesConsidered?: string[] | string;
  reversibility?: string;
  generatedAt?: string | null;
  createdAt?: string | null;
  sourceArtifactId?: string | null;
  sourceArtifactPhase?: string | null;
}

interface ADRProposalPanelProps {
  proposals: ADRProposal[];
  onAccept: (id: string, edits: Partial<ADRProposal>) => void;
  onDismiss: (id: string) => void;
}

function toAlternatives(value: ADRProposal["alternativesConsidered"]) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function formatGeneratedDate(value?: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function ADRProposalPanel({ proposals, onAccept, onDismiss }: ADRProposalPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<ADRProposal>>>({});

  const proposalCount = proposals?.length ?? 0;
  const alternativesMap = useMemo(
    () => Object.fromEntries((proposals ?? []).map((proposal) => [proposal.id, toAlternatives(proposal.alternativesConsidered)])),
    [proposals],
  );

  if (!proposalCount) return null;

  const updateEdit = (proposalId: string, field: keyof ADRProposal, value: string) => {
    setEdits((current) => ({
      ...current,
      [proposalId]: {
        ...(current[proposalId] || {}),
        [field]: value,
      },
    }));
  };

  return (
    <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-blue-900">
          ⚡ {proposalCount} ADR draft{proposalCount === 1 ? "" : "s"} generated from artifacts
        </div>
        <div className="text-xs text-blue-700">Review and accept or dismiss</div>
      </div>

      <div className="space-y-3">
        {(proposals ?? []).map((proposal) => {
          const isExpanded = expandedId === proposal.id;
          const localEdits = edits[proposal.id] || {};
          const alternatives = alternativesMap[proposal.id] || [];
          return (
            <div key={proposal.id} className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : proposal.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {proposal.title || "Untitled ADR Draft"}
                  </div>
                  <div className="mt-1 text-xs text-blue-700">
                    {(proposal.sourceArtifactPhase || "unknown")} / {(proposal.sourceArtifactId || "artifact")}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAccept(proposal.id, edits[proposal.id] ?? {});
                    }}
                    className="rounded border border-green-200 bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDismiss(proposal.id);
                    }}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <div className="border-t border-blue-100 bg-white px-4 py-4">
                  <div className="grid gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Chosen Approach</span>
                      <textarea
                        value={String(localEdits.chosenApproach ?? proposal.chosenApproach ?? "")}
                        onChange={(event) => updateEdit(proposal.id, "chosenApproach", event.target.value)}
                        rows={3}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-300 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Rationale</span>
                      <textarea
                        value={String(localEdits.rationale ?? proposal.rationale ?? "")}
                        onChange={(event) => updateEdit(proposal.id, "rationale", event.target.value)}
                        rows={3}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-300 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Trade-Offs</span>
                      <textarea
                        value={String(localEdits.tradeOffs ?? proposal.tradeOffs ?? "")}
                        onChange={(event) => updateEdit(proposal.id, "tradeOffs", event.target.value)}
                        rows={3}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-300 focus:outline-none"
                      />
                    </label>

                    {alternatives.length > 0 ? (
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Alternatives Considered</div>
                        <div className="flex flex-wrap gap-2">
                          {alternatives.map((alternative) => (
                            <span
                              key={`${proposal.id}-${alternative}`}
                              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-800"
                            >
                              {alternative}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                      <span>Reversibility: {proposal.reversibility || "medium"}</span>
                      <span>Generated: {formatGeneratedDate(proposal.generatedAt || proposal.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
