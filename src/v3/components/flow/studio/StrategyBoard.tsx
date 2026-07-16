/**
 * The Architecture Strategy as a decision board: candidates side by side —
 * score bars across the four dimensions, strengths and risks in columns,
 * the recommendation crowned. Choosing "Recommend" writes the same
 * recommendation object the generator emits; the candidate cards below
 * remain the full editor.
 */
import { useMemo } from "react";
import { asArray, asRecord, asText, asStrings, EmptyState, useStudioLocked, type StudioProps } from "./StudioKit";

const SCORE_DIMS: Array<{ key: string; label: string }> = [
  { key: "fitToWorkflows", label: "Fit to workflows" },
  { key: "timeToFirstDemo", label: "Time to first demo" },
  { key: "operability", label: "Operability" },
  { key: "cost", label: "Cost" },
];

export default function StrategyBoard({ doc, onChange }: StudioProps) {
  const locked = useStudioLocked();
  const candidates = useMemo(() => asArray(doc.candidates).map(asRecord), [doc.candidates]);
  const recommendation = asRecord(doc.recommendation);
  const recommended = asText(recommendation.candidate);

  const recommend = (name: string) => {
    onChange({ ...doc, recommendation: { ...recommendation, candidate: name } });
  };

  if (!candidates.length) {
    return <EmptyState icon="🏛" title="No architecture candidates yet" hint="Add them below, or regenerate the Architecture Strategy to derive options from the Atlas and Ontology." />;
  }
  return (
    <div className="v3fs-strat">
      <div className="v3fs-strat-board" style={{ gridTemplateColumns: `repeat(${candidates.length}, minmax(230px, 1fr))` }}>
        {candidates.map((candidate, index) => {
          const name = asText(candidate.name) || `Candidate ${index + 1}`;
          const isRec = recommended && name === recommended;
          const scores = asRecord(candidate.scores);
          return (
            <div key={index} className={`v3fs-strat-col${isRec ? " rec" : ""}`}>
              {isRec ? <div className="v3fs-strat-crown">★ Recommended</div> : null}
              <div className="v3fs-strat-name">{name}</div>
              {asText(candidate.shape) ? <div className="v3fs-strat-shape">{asText(candidate.shape)}</div> : null}
              <div className="v3fs-strat-scores">
                {SCORE_DIMS.map((dim) => {
                  const value = Math.max(0, Math.min(10, Number(asText(scores[dim.key])) || 0));
                  return (
                    <div key={dim.key} className="v3fs-strat-score">
                      <span>{dim.label}</span>
                      <div className="v3fs-strat-bar"><div style={{ width: `${value * 10}%` }} /></div>
                      <em>{value || "—"}</em>
                    </div>
                  );
                })}
              </div>
              {asStrings(candidate.strengths).length ? (
                <ul className="v3fs-strat-list plus">
                  {asStrings(candidate.strengths).slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {asStrings(candidate.risks).length ? (
                <ul className="v3fs-strat-list minus">
                  {asStrings(candidate.risks).slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {!isRec && !locked ? (
                <button type="button" className="v3fs-btn" onClick={() => recommend(name)}>Recommend</button>
              ) : null}
            </div>
          );
        })}
      </div>
      {asText(recommendation.rationale) ? (
        <p className="v3fs-strat-why">“{asText(recommendation.rationale)}”</p>
      ) : null}
    </div>
  );
}
