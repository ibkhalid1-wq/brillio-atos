import React from "react";
import type { ProgramSummary } from "@/new/types";
import {
  derivePhaseMethodologyCompleteness,
  type RequirementKind,
} from "@/v3/lib/phaseMethodologyCompleteness";

const KIND_HINT: Record<RequirementKind, string> = {
  input: "Capture below",
  artifact: "Generate or upload",
  "exit-criterion": "Confirm at gate",
};

function toneFor(pct: number): "green" | "amber" | "red" {
  if (pct >= 100) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

/**
 * Methodology checklist — binds the three methodology requirement sources
 * (required inputs, required artifacts, mandatory exit criteria) into a single
 * on-screen completeness view. Collapsed by default to a headline ("N of M met,
 * K still needed"); expand for the full grouped checklist so a PM sees, without
 * leaving the phase, exactly what the methodology demands and what remains.
 */
export function PhaseMethodologyChecklist({
  program,
  phaseId,
}: {
  program: ProgramSummary | null;
  phaseId: string | null;
}) {
  const [open, setOpen] = React.useState(false);

  const completeness = React.useMemo(
    () => derivePhaseMethodologyCompleteness(program, phaseId),
    [program, phaseId],
  );

  if (!completeness || completeness.total === 0) return null;

  const tone = toneFor(completeness.pct);
  const remaining = completeness.total - completeness.present;

  return (
    <div className="v3-method-checklist">
      <button
        type="button"
        className="v3-method-checklist-head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div className="v3-method-checklist-headline">
          <span className="v3-method-checklist-title">Methodology checklist</span>
          <span className={`v3-chip ${tone}`}>{completeness.pct}% complete</span>
        </div>
        <div className="v3-method-checklist-sub">
          {completeness.present} of {completeness.total} requirements met
          {remaining > 0 ? ` · ${remaining} still needed` : " · phase fully covered"}
          <span className="v3-method-checklist-caret">{open ? "▴" : "▾"}</span>
        </div>
      </button>

      <div className="v3-method-checklist-bar">
        <div className={`v3-method-checklist-bar-fill ${tone}`} style={{ width: `${completeness.pct}%` }} />
      </div>

      {open ? (
        <div className="v3-method-checklist-body">
          {completeness.groups.map((group) => (
            <div key={group.kind} className="v3-method-group">
              <div className="v3-method-group-head">
                <span className="v3-method-group-label">{group.label}</span>
                <span className={`v3-chip ${group.present === group.total ? "green" : group.present > 0 ? "amber" : "muted"}`}>
                  {group.present}/{group.total}
                </span>
              </div>
              <ul className="v3-method-group-list">
                {group.items.map((item) => (
                  <li key={item.id} className={`v3-method-item ${item.present ? "present" : "missing"}`}>
                    <span className="v3-method-item-mark" aria-hidden="true">{item.present ? "✓" : "○"}</span>
                    <span className="v3-method-item-label">{item.label}</span>
                    {!item.present ? (
                      <span className="v3-method-item-hint">{KIND_HINT[item.kind]}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default PhaseMethodologyChecklist;
