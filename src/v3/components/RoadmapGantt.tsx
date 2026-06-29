import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGantt, shiftIsoDate, daysBetween, type GanttRow } from "@/v3/lib/phaseSchedule";

interface RoadmapGanttProps {
  /** Ordered phases with their effective start/end dates. */
  rows: GanttRow[];
  /** When false the chart is read-only (no drag, disabled date inputs). */
  editable?: boolean;
  /** Commit one phase's new dates (fired on drag-end and date-input change). */
  onChange?: (id: string, start: string, end: string) => void;
}

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  origStart: string;
  origEnd: string;
  /** Captured at gesture start so range/width shifts mid-drag don't make it jumpy. */
  trackWidthPx: number;
  totalDays: number;
}

const MIN_DAYS = 1;

/**
 * A compact, responsive Gantt for the strategic roadmap. Bars are positioned by
 * percentage (layout math lives in the pure `layoutGantt` helper), so the chart
 * reflows with its container. Dates are editable two ways: drag the bar to move
 * it / drag its edges to resize, or type exact dates in the per-row inputs. Both
 * paths funnel through one `onChange` so persistence has a single entry point.
 */
export default function RoadmapGantt({ rows, editable = false, onChange }: RoadmapGanttProps) {
  // Working copy so drags/edits render live before the parent persists and feeds
  // fresh props back. Re-synced whenever the incoming rows actually change.
  const [draft, setDraft] = useState<GanttRow[]>(rows);
  const rowsKey = useMemo(() => JSON.stringify(rows), [rows]);
  useEffect(() => {
    setDraft(rows);
  }, [rowsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const layout = useMemo(() => layoutGantt(draft), [draft]);

  // Month axis labels: show the month abbreviation on every tick but only print
  // the year when it changes, so dense (monthly) axes don't overlap.
  const monthTicks = useMemo(() => {
    if (!layout) return [];
    let lastYear = "";
    return layout.months.map((m) => {
      const [mon, year] = m.label.split(" ");
      const showYear = year !== lastYear;
      lastYear = year;
      return { ...m, mon, yy: year ? `\u2019${year.slice(2)}` : "", showYear };
    });
  }, [layout]);

  // "Today" marker position as a % of the padded timeline, or null when today
  // falls outside the chart's range.
  const todayPct = useMemo(() => {
    if (!layout) return null;
    const total = daysBetween(layout.rangeStart, layout.rangeEnd);
    if (total <= 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const offset = daysBetween(layout.rangeStart, today);
    if (offset < 0 || offset > total) return null;
    return (offset / total) * 100;
  }, [layout]);

  const commit = useCallback(
    (id: string, start: string, end: string) => {
      onChange?.(id, start, end);
    },
    [onChange],
  );

  const applyDraft = useCallback((id: string, start: string, end: string) => {
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, start, end } : r)));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent, row: GanttRow, mode: DragMode) => {
      if (!editable || !layout) return;
      event.preventDefault();
      event.stopPropagation();
      const trackWidthPx = trackRef.current?.getBoundingClientRect().width ?? 0;
      if (trackWidthPx <= 0) return;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      setDrag({
        id: row.id,
        mode,
        startX: event.clientX,
        origStart: row.start,
        origEnd: row.end,
        trackWidthPx,
        totalDays: daysBetween(layout.rangeStart, layout.rangeEnd),
      });
    },
    [editable, layout],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || drag.totalDays <= 0) return;
      const dxPx = event.clientX - drag.startX;
      const deltaDays = Math.round((dxPx / drag.trackWidthPx) * drag.totalDays);
      if (deltaDays === 0) {
        applyDraft(drag.id, drag.origStart, drag.origEnd);
        return;
      }
      let start = drag.origStart;
      let end = drag.origEnd;
      if (drag.mode === "move") {
        start = shiftIsoDate(drag.origStart, deltaDays);
        end = shiftIsoDate(drag.origEnd, deltaDays);
      } else if (drag.mode === "resize-start") {
        start = shiftIsoDate(drag.origStart, deltaDays);
        if (daysBetween(start, end) < MIN_DAYS) start = shiftIsoDate(end, -MIN_DAYS);
      } else {
        end = shiftIsoDate(drag.origEnd, deltaDays);
        if (daysBetween(start, end) < MIN_DAYS) end = shiftIsoDate(start, MIN_DAYS);
      }
      applyDraft(drag.id, start, end);
    },
    [drag, applyDraft],
  );

  const onPointerUp = useCallback(() => {
    if (!drag) return;
    const row = draft.find((r) => r.id === drag.id);
    if (row && (row.start !== drag.origStart || row.end !== drag.origEnd)) {
      commit(row.id, row.start, row.end);
    }
    setDrag(null);
  }, [drag, draft, commit]);

  const onDateInput = useCallback(
    (row: GanttRow, field: "start" | "end", value: string) => {
      if (!value) return;
      let start = field === "start" ? value : row.start;
      let end = field === "end" ? value : row.end;
      // Keep at least a one-day span regardless of which end the user moved.
      if (daysBetween(start, end) < MIN_DAYS) {
        if (field === "start") end = shiftIsoDate(start, MIN_DAYS);
        else start = shiftIsoDate(end, -MIN_DAYS);
      }
      applyDraft(row.id, start, end);
      commit(row.id, start, end);
    },
    [applyDraft, commit],
  );

  if (!layout) {
    return (
      <div className="v3-gantt">
        <div className="v3-gantt-empty">
          Set the programme start and target end dates on the Strategy phase to build a roadmap timeline.
        </div>
      </div>
    );
  }

  return (
    <div className="v3-gantt">
      <div className="v3-gantt-head">
        <span className="v3-gantt-title">Roadmap timeline</span>
        <span className="v3-gantt-hint">
          {editable ? "Drag bars to move, drag edges to resize, or type exact dates" : "Read-only"}
        </span>
      </div>

      {/* Month axis (labels only — gridlines live in the grid overlay below) */}
      <div className="v3-gantt-row v3-gantt-axis">
        <span className="v3-gantt-label" aria-hidden="true" />
        <div className="v3-gantt-track v3-gantt-axis-track" ref={trackRef}>
          {monthTicks.map((month) => (
            <span
              key={month.label}
              className={`v3-gantt-monthlabel${month.showYear ? " is-year" : ""}`}
              style={{ left: `${month.offsetPct}%` }}
            >
              {month.mon}
              {month.showYear ? <span className="v3-gantt-monthyear">{month.yy}</span> : null}
            </span>
          ))}
        </div>
      </div>

      {/* One bar row per phase */}
      <div
        className="v3-gantt-grid"
        onPointerMove={drag ? onPointerMove : undefined}
        onPointerUp={drag ? onPointerUp : undefined}
        onPointerCancel={drag ? onPointerUp : undefined}
      >
        {/* Aligned overlay: month gridlines + the "today" marker, confined to the
            track column so they line up exactly with the bars. */}
        <div className="v3-gantt-overlay" aria-hidden="true">
          {layout.months.map((month) => (
            <span key={month.label} className="v3-gantt-monthline" style={{ left: `${month.offsetPct}%` }} />
          ))}
          {todayPct != null ? (
            <span className="v3-gantt-today" style={{ left: `${todayPct}%` }}>
              <span className="v3-gantt-today-flag">Today</span>
            </span>
          ) : null}
        </div>
        {layout.bars.map((bar) => {
          const progress = Math.max(0, Math.min(100, bar.progressPct ?? 0));
          const rag = bar.rag ?? "grey";
          return (
            <div className="v3-gantt-row" key={bar.id}>
              <span className="v3-gantt-label" title={bar.name}>
                <span className={`v3-gantt-dot rag-${rag}`} aria-hidden="true" />
                {bar.name}
              </span>
              <div className="v3-gantt-track">
                <div
                  className={`v3-gantt-bar${editable ? " is-editable" : ""}${drag?.id === bar.id ? " is-dragging" : ""}`}
                  data-rag={rag}
                  style={{ left: `${bar.offsetPct}%`, width: `${bar.widthPct}%` }}
                  title={`${bar.name}: ${bar.start} → ${bar.end} · ${progress}% complete${bar.risk ? ` · ⚠ ${bar.risk}` : ""}`}
                  onPointerDown={editable ? (e) => onPointerDown(e, bar, "move") : undefined}
                >
                  <span className="v3-gantt-fill" style={{ width: `${progress}%` }} aria-hidden="true" />
                  {bar.expectedPct != null ? (
                    <span className="v3-gantt-expected" style={{ left: `${bar.expectedPct}%` }} aria-hidden="true" />
                  ) : null}
                  {progress > 12 ? <span className="v3-gantt-pct">{progress}%</span> : null}
                  {bar.risk ? <span className="v3-gantt-risk" title={bar.risk} aria-hidden="true">⚠</span> : null}
                  {editable ? (
                    <span
                      className="v3-gantt-handle start"
                      onPointerDown={(e) => onPointerDown(e, bar, "resize-start")}
                    />
                  ) : null}
                  {editable ? (
                    <span
                      className="v3-gantt-handle end"
                      onPointerDown={(e) => onPointerDown(e, bar, "resize-end")}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Precise date editors — one row per phase */}
      {draft.map((row) => (
        <div className="v3-gantt-editrow" key={`edit-${row.id}`}>
          <span className="v3-gantt-label" title={row.name}>{row.name}</span>
          <div className="v3-gantt-dates">
            <input
              type="date"
              className="v3-gantt-date"
              aria-label={`${row.name} start date`}
              value={row.start}
              max={shiftIsoDate(row.end, -MIN_DAYS)}
              disabled={!editable}
              onChange={(e) => onDateInput(row, "start", e.target.value)}
            />
            <span className="v3-gantt-dates-sep">→</span>
            <input
              type="date"
              className="v3-gantt-date"
              aria-label={`${row.name} end date`}
              value={row.end}
              min={shiftIsoDate(row.start, MIN_DAYS)}
              disabled={!editable}
              onChange={(e) => onDateInput(row, "end", e.target.value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
