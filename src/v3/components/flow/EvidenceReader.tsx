/**
 * The evidence drill-down: one attributed voice, read in full. Opened from a
 * Library evidence row or an artifact's "Grounded in" list, and stacks above
 * the artifact studio so a claim can be checked against its source without
 * losing your place in the document.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFocusTrap } from "@/v3/lib/useFocusTrap";
import { flowMovements, locateQuote, type EvidenceEntry } from "@/v3/components/flow/flowShellData";

export default function EvidenceReader({ entry, highlight, onClose }: {
  entry: EvidenceEntry;
  /** A quoted claim to locate and mark inside the source text. */
  highlight?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // Capture phase so Escape closes THIS layer, not the studio beneath it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const movementName = useMemo(
    () => flowMovements().find((m) => m.id === entry.movementId)?.displayName ?? entry.movementId,
    [entry.movementId],
  );
  const paragraphs = useMemo(
    () => entry.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [entry.text],
  );

  return (
    <>
      <div className="v3fs-doc-backdrop v3fs-evread-layer" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} tabIndex={-1} className="v3fs-docview v3fs-evread" role="dialog" aria-modal="true" aria-label={entry.who}>
        <header className="v3fs-docview-h">
          <div>
            <h2 className="v3fs-evread-who">{entry.who}</h2>
            <span className="v3fs-docview-m">
              {[entry.fieldLabel, movementName, entry.words ? `${entry.words.toLocaleString()} words` : null]
                .filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="v3fs-docview-cta">
            <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </header>
        <div className="v3fs-docview-b v3fs-evread-b">
          {entry.kind === "reference" || !paragraphs.length ? (
            <p className="v3fs-empty">
              A referenced source — its content lives outside the captured record. Reference: {entry.who}.
            </p>
          ) : (
            paragraphs.map((paragraph, index) => {
              const hit = highlight ? locateQuote(paragraph, highlight) : null;
              if (!hit) return <p key={index} className="v3fs-evread-p">{paragraph}</p>;
              return (
                <p key={index} className="v3fs-evread-p">
                  {paragraph.slice(0, hit.start)}
                  <mark
                    className="v3fs-evread-mark"
                    ref={(node) => { node?.scrollIntoView({ block: "center" }); }}
                  >{paragraph.slice(hit.start, hit.end)}</mark>
                  {paragraph.slice(hit.end)}
                </p>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
