import { AlertIcon } from "@/new/components/ui/Icons";

export interface EmptyStateProps {
  context: string;
  explanation: string;
  recommendation: string;
  generateLabel?: string;
  onGenerate?: () => void;
  learnMoreLabel?: string;
  onLearnMore?: () => void;
}

export function EmptyState({
  context,
  explanation,
  recommendation,
  generateLabel,
  onGenerate,
  learnMoreLabel,
  onLearnMore,
}: EmptyStateProps) {
  return (
    <div className="adam-empty">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-blue-200">
        <AlertIcon className="h-5 w-5" />
      </span>
      <div className="adam-title">{context}</div>
      <div className="adam-body adam-muted">{explanation}</div>
      <div className="adam-body">{recommendation}</div>
      <div className="adam-row" style={{ flexWrap: "wrap" }}>
        {generateLabel && onGenerate ? (
          <button type="button" className="adam-button" onClick={onGenerate}>
            {generateLabel}
          </button>
        ) : null}
        {learnMoreLabel && onLearnMore ? (
          <button type="button" className="adam-button-ghost" onClick={onLearnMore}>
            {learnMoreLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
