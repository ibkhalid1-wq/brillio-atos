/**
 * The evidence drill-down: one attributed voice, read in full. Opened from a
 * Library evidence row or an artifact's "Grounded in" list, and stacks above
 * the artifact studio so a claim can be checked against its source without
 * losing your place in the document.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/v3/lib/useFocusTrap";
import { safePrompt } from "@/v3/components/flow/flowCapture";
import { flowMovements, locateQuote, type EvidenceEntry } from "@/v3/components/flow/flowShellData";

export default function EvidenceReader({ entry, highlight, targets, onTag, onClose, onDownload, onFindAnswers, openAsks }: {
  entry: EvidenceEntry;
  /** A quoted claim to locate and mark inside the source text. */
  highlight?: string;
  /** Taggable objects (entities/KPIs/tracks) — enables highlight-to-tag. */
  targets?: Array<{ kind: string; refId: string; label: string }>;
  onTag?: (target: { kind: string; refId: string; label: string }, quote: string) => Promise<void>;
  onClose: () => void;
  /** Fetch + open the ORIGINAL uploaded file. Shown when the evidence came from
   *  a document upload (entry.sourceKey) — the reader shows the extracted text,
   *  this button gets the original .docx/.pdf/etc. */
  onDownload?: () => void;
  /**
   * MATCH THIS ENTRY AGAINST THE QUESTIONS STILL OPEN.
   *
   * `review-capture` could only ever run at CAPTURE time, off the text in the
   * paste box. Every transcript already on the record — seven real discovery
   * sessions on one live programme, ~330kB of it — was therefore unreachable by
   * the reader that exists to read exactly that. The only way to match one was
   * to paste it in a second time, which is both absurd and a second copy of the
   * evidence.
   *
   * Absent when there is nothing open to match against: a reader offering to
   * find answers to zero questions is a button that cannot do anything.
   */
  onFindAnswers?: () => Promise<void> | void;
  /** How many questions are open, so the control says what it will do rather
   *  than making somebody press it to find out. */
  openAsks?: number;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);
  // Highlight-to-quote: select any passage and lift it out with its
  // attribution attached — the quotable claim, ready to paste anywhere.
  const [sel, setSel] = useState<{ text: string; top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  /** The agent runs on the edge and takes real seconds; without this the button
   *  looks inert and gets pressed twice, which runs the read twice. */
  const [finding, setFinding] = useState(false);
  const onSelect = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || text.length < 8 || !selection || selection.rangeCount === 0) { setSel(null); return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const host = dialogRef.current?.getBoundingClientRect();
    if (!host) return;
    setSel({ text, top: rect.top - host.top - 38, left: Math.max(8, rect.left - host.left) });
    setCopied(false);
    setPicking(false);
  };
  const copyQuote = async () => {
    if (!sel) return;
    const quote = `“${sel.text}”\n— ${entry.who}`;
    try { await navigator.clipboard.writeText(quote); } catch { safePrompt("Copy the quote:", quote); }
    setCopied(true);
    window.setTimeout(() => setSel(null), 900);
  };
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
            {/* Only where there is something to match against AND something to
                match: a reference entry has no text here to read. The count is
                on the label so the control says what it will do. */}
            {onFindAnswers && openAsks && entry.kind !== "reference" && entry.text.trim().length > 400 ? (
              <button type="button" className="v3fs-btn v3fs-btn--go" disabled={finding}
                title={`Match this against the ${openAsks} question${openAsks === 1 ? "" : "s"} still open. Every match is a candidate you confirm — nothing is recorded as said until you do.`}
                onClick={async () => {
                  setFinding(true);
                  try { await onFindAnswers(); } finally { setFinding(false); }
                }}>
                {finding ? "Reading…" : `⌕ Find answers — ${openAsks} open`}
              </button>
            ) : null}
            {onDownload ? <button type="button" className="v3fs-btn" onClick={onDownload} title="Download the original uploaded file">⬇ Download original</button> : null}
            <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </header>
        {sel ? (
          <div className="v3fs-quote-pop-w" style={{ top: sel.top, left: sel.left }}>
            <button type="button" className="v3fs-quote-pop" onClick={() => void copyQuote()}>
              {copied ? "✓ Copied with attribution" : "⎘ Copy as quote"}
            </button>
            {onTag && targets?.length ? (
              <button type="button" className="v3fs-quote-pop tag" onClick={() => setPicking((v) => !v)}>⌗ Tag →</button>
            ) : null}
            {picking && onTag ? (
              <div className="v3fs-tag-pick" role="menu">
                {(targets ?? []).map((t) => (
                  <button key={`${t.kind}-${t.refId}`} type="button" role="menuitem"
                    onClick={async () => { await onTag(t, sel.text); setPicking(false); setSel(null); }}>
                    <span className="v3fs-tag-kind">{t.kind}</span>{t.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="v3fs-docview-b v3fs-evread-b" onMouseUp={onSelect}>
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
