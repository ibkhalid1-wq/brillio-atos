import React from "react";
import { formatCurrency } from "@/new/lib/programData";

interface ValueMeterProps {
  delivered: number;
  projected: number;
}

export function ValueMeter({ delivered, projected }: ValueMeterProps) {
  const ratio = projected > 0 ? Math.min(100, Math.round((delivered / projected) * 100)) : 0;
  const trendLabel = ratio >= 75 ? "Ahead of plan" : ratio >= 40 ? "On the way" : "Early value";
  return (
    <div className="adam-card adam-stack p-5">
      <div className="adam-title">Value</div>
      <div className="adam-heading-lg">{formatCurrency(delivered)}</div>
      <div className="adam-body adam-muted">
        Delivered against {formatCurrency(projected)} projected
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${ratio}%` }} />
      </div>
      <div className="adam-row adam-space-between">
        <span className="adam-badge blue">{ratio}% of target</span>
        <span className="adam-micro adam-muted">{trendLabel}</span>
      </div>
    </div>
  );
}
