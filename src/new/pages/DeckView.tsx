import React, { useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { DeckSlide, ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";
import { exportAsPDF, exportAsDocx, deckToHtml } from "@/v3/lib/documentExport";
import DocumentRefinePanel from "@/v3/components/DocumentRefinePanel";

interface DeckViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerDeck: () => void;
  onOpenIntelligence: () => void;
}

function exportSlide(slide: DeckSlide): string {
  return [
    `Slide ${slide.slideNumber}: ${slide.title}`,
    `Type: ${slide.type}`,
    "",
    "Talking points:",
    ...slide.talkingPoints.map((item) => `- ${item}`),
    "",
    "Data callouts:",
    ...slide.dataCallouts.map((item) => `- ${item}`),
    slide.recommendedVisual ? `\nRecommended visual:\n${slide.recommendedVisual}` : "",
    slide.speakerNotes ? `\nSpeaker notes:\n${slide.speakerNotes}` : "",
  ].filter(Boolean).join("\n");
}

export function DeckView({
  program,
  isRunning,
  onTriggerDeck,
  onOpenIntelligence,
}: DeckViewProps) {
  const [expandedSlide, setExpandedSlide] = useState<number | null>(1);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [audience, setAudience] = useState("Executive");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [refiningSlide, setRefiningSlide] = useState<string | null>(null);

  const slides = useMemo(() => program?.deck?.slides || [], [program]);
  const programId = program?.id ?? null;

  if (!program) {
    return (
      <NotReadyCard
        title="Executive deck"
        reason="No active program. Connect Supabase and choose a program to generate a deck."
      />
    );
  }

  const handleCopy = async (label: string, content: string) => {
    if (!navigator?.clipboard) return;
    await navigator.clipboard.writeText(content);
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel((current) => current === label ? null : current), 1800);
  };

  if (!program.deck || !slides.length) {
    return (
      <section className="adam-card p-8" style={{ maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
        <div className="adam-heading-xl">Generate the executive deck</div>
        <div className="mt-3 adam-body adam-muted">
          ATOS will draft the slide narrative, talking points, data callouts, and presenter notes for an executive-ready program update.
        </div>
        <button
          type="button"
          className="adam-button mt-6"
          onClick={onTriggerDeck}
          disabled={isRunning}
        >
          {isRunning ? "Generating deck…" : "Generate deck"}
        </button>
      </section>
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">{program.deck.title}</div>
            <div className="adam-body adam-muted">{program.deck.programHealthSummary}</div>
            <div className="adam-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="adam-badge blue">{program.deck.audience}</span>
              <span className={`v3-chip ${confidenceTone(program.deck.confidence)}`} title={confidenceLabel(program.deck.confidence)}>
                {Math.round(program.deck.confidence * 100)}% confidence
              </span>
              {program.deckGeneratedAt ? (
                <span className="adam-micro adam-muted">Generated {new Date(program.deckGeneratedAt).toLocaleString()}</span>
              ) : null}
            </div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 12 }}
              onClick={onOpenIntelligence}
            >
              View history & autonomy →
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={() => void handleCopy("all", slides.map((slide) => exportSlide(slide)).join("\n\n---\n\n"))}
            >
              {copiedLabel === "all" ? "Copied" : "Copy all"}
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerDeck}
              disabled={isRunning}
            >
              {isRunning ? "Regenerating…" : "Re-generate"}
            </button>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", color: "var(--v3-text-secondary)", cursor: "pointer" }}
            >
              {["Executive", "Project Team", "Regulator", "Board"].map((a) => <option key={a}>{a}</option>)}
            </select>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", cursor: "pointer", color: "var(--v3-text-secondary)" }}
                onClick={() => setShowExportMenu((v) => !v)}
              >
                Export ▾
              </button>
              {showExportMenu && program.deck && (() => {
                const rawInner = program?.rawData && typeof (program.rawData as Record<string, unknown>).data === "object"
                  ? (program.rawData as Record<string, unknown>).data as Record<string, unknown>
                  : program?.rawData as Record<string, unknown> | undefined;
                const deckData = (rawInner?.deck || rawInner?.executiveDeck || program.deck) as Record<string, unknown>;
                const exportTitle = `Executive Deck — ${program?.name || ""}`;
                return (
                  <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 50, minWidth: 130 }}>
                    {([["PDF", () => { exportAsPDF(exportTitle, deckToHtml({ name: program?.name, client: (program as Record<string, unknown>).client as string | undefined }, deckData)); setShowExportMenu(false); }], ["Word Doc", () => { exportAsDocx(exportTitle, deckToHtml({ name: program?.name, client: (program as Record<string, unknown>).client as string | undefined }, deckData)); setShowExportMenu(false); }]] as Array<[string, () => void]>).map(([label, fn]) => (
                      <button key={label} type="button" onClick={fn} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--v3-text-primary)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--v3-surface-2)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                      >{label}</button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Slides</div>
        <div className="mt-4 v3-deck-slides">
          {slides.map((slide) => {
            const expanded = expandedSlide === slide.slideNumber;
            return (
              <div key={slide.slideNumber} className="adam-list-item">
                <button
                  type="button"
                  className="adam-row adam-space-between"
                  style={{ width: "100%", background: "transparent", border: "none", color: "inherit", padding: 0, textAlign: "left", cursor: "pointer", gap: 12 }}
                  onClick={() => setExpandedSlide((current) => current === slide.slideNumber ? null : slide.slideNumber)}
                >
                  <div className="adam-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="adam-badge slate">{slide.slideNumber}</span>
                    <span className="adam-title">{slide.title}</span>
                    <span className="adam-badge blue">{slide.type}</span>
                  </div>
                  <span className="adam-micro adam-muted">{expanded ? "Hide details" : "Open slide"}</span>
                </button>

                {expanded ? (
                  <div className="mt-4 adam-stack" style={{ position: "relative" }}>
                    {refiningSlide === (slide.type || null) && programId && (
                      <DocumentRefinePanel
                        programId={programId}
                        artifactType="deck-section"
                        sectionType={slide.type || undefined}
                        currentContent={exportSlide(slide)}
                        onRefined={() => {
                          onTriggerDeck();
                          setRefiningSlide(null);
                        }}
                        onClose={() => setRefiningSlide(null)}
                      />
                    )}
                    <div>
                      <div className="adam-micro adam-muted">Talking points</div>
                      <div className="mt-2 adam-list">
                        {slide.talkingPoints.map((item, index) => (
                          <div key={`${slide.slideNumber}-point-${index}`} className="adam-list-item adam-body">{item}</div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="adam-micro adam-muted">Data callouts</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {slide.dataCallouts.length ? slide.dataCallouts.map((item, index) => (
                          <span key={`${slide.slideNumber}-callout-${index}`} className="adam-badge amber">{item}</span>
                        )) : <span className="adam-micro adam-muted">No explicit callouts on this slide.</span>}
                      </div>
                    </div>
                    {slide.recommendedVisual ? (
                      <div className="adam-body adam-muted" style={{ fontStyle: "italic" }}>
                        Recommended visual: {slide.recommendedVisual}
                      </div>
                    ) : null}
                    <div className="adam-body adam-muted">
                      {slide.speakerNotes}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="adam-button-ghost"
                        onClick={() => void handleCopy(`slide-${slide.slideNumber}`, exportSlide(slide))}
                      >
                        {copiedLabel === `slide-${slide.slideNumber}` ? "Copied" : "Copy slide"}
                      </button>
                      <button type="button"
                        onClick={() => setRefiningSlide(refiningSlide === (slide.type || null) ? null : (slide.type || null))}
                        style={{ fontSize: 11, padding: "3px 8px", border: "1px solid var(--v3-border)", borderRadius: 4, background: "none", cursor: "pointer", color: "var(--v3-text-muted)" }}>
                        ✨ Refine slide
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
