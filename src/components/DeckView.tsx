import { useEffect, useState } from "react";

const TEMPLATES = [
  { id: "steering", label: "Steering Committee" },
  { id: "weekly", label: "Weekly Update" },
  { id: "gate", label: "Gate Review" },
  { id: "kickoff", label: "Programme Kickoff" },
];

const RAG_COLORS: Record<string, string> = {
  "🟢 On Track": "#22c55e",
  "🟡 At Risk": "#f59e0b",
  "🔴 Off Track": "#ef4444",
};

interface Slide {
  id: string;
  heading: string;
  type: string;
  content: any;
}

interface Deck {
  id: string;
  templateId: string;
  label: string;
  generatedAt: number;
  slides: Slide[];
}

interface Props {
  decks: Deck[];
  onGenerate: (templateId: string) => Promise<Deck | null | void>;
  programName: string;
}

export function DeckView({ decks, onGenerate, programName }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState("steering");
  const [loading, setLoading] = useState(false);
  const [activeDeck, setActiveDeck] = useState<Deck | null>(decks[0] || null);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    if (!decks.length) {
      setActiveDeck(null);
      setSlideIndex(0);
      return;
    }
    if (!activeDeck || !decks.find((deck) => deck.id === activeDeck.id)) {
      setActiveDeck(decks[0]);
      setSlideIndex(0);
    }
  }, [decks, activeDeck]);

  async function generate() {
    setLoading(true);
    const deck = await onGenerate(selectedTemplate);
    if (deck) {
      setActiveDeck(deck);
      setSlideIndex(0);
    }
    setLoading(false);
  }

  function exportHtml(deck: Deck) {
    const sections = deck.slides.map((slide) => `
<section class="slide" data-type="${slide.type}">
  <h2>${slide.heading}</h2>
  ${slide.content?.callout ? `<div class="callout">${slide.content.callout}</div>` : ""}
  ${slide.content?.status ? `<div class="rag" style="color:${RAG_COLORS[slide.content.status] || "#333"}">${slide.content.status}</div>` : ""}
  <ul>${(slide.content?.bullets || []).map((bullet: string) => `<li>${bullet}</li>`).join("")}</ul>
  ${slide.content?.notes ? `<aside class="notes">${slide.content.notes}</aside>` : ""}
</section>`).join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${programName} — ${deck.label}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:0;background:#1e293b;color:#f8fafc}
    .slide{width:800px;min-height:450px;margin:40px auto;background:#fff;color:#1e293b;padding:48px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.3);page-break-after:always}
    h2{font-size:1.8rem;margin:0 0 24px;color:#312e81}
    .callout{font-size:2.4rem;font-weight:700;color:#312e81;margin-bottom:16px}
    .rag{font-size:1.6rem;font-weight:600;margin-bottom:16px}
    ul{padding-left:1.4em;font-size:1.1rem;line-height:1.8}
    aside.notes{margin-top:24px;padding:12px;background:#f1f5f9;border-radius:6px;font-size:.85rem;color:#64748b;font-style:italic}
    @media print{.slide{margin:0;box-shadow:none;border-radius:0}}
  </style>
</head>
<body>${sections}</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${programName.replace(/\s+/g, "-")}-${deck.templateId}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown(deck: Deck) {
    const markdown = deck.slides.map((slide) => {
      const lines = [`# ${slide.heading}`, ""];
      if (slide.content?.callout) lines.push(`> **${slide.content.callout}**`, "");
      if (slide.content?.status) lines.push(`**Status:** ${slide.content.status}`, "");
      (slide.content?.bullets || []).forEach((bullet: string) => lines.push(`- ${bullet}`));
      if (slide.content?.notes) lines.push("", `*${slide.content.notes}*`);
      return lines.join("\n");
    }).join("\n\n---\n\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${programName.replace(/\s+/g, "-")}-${deck.templateId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const slide = activeDeck?.slides?.[slideIndex];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Presentation Deck Generator</h2>
        {activeDeck ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportHtml(activeDeck)}
              className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
            >
              Export HTML
            </button>
            <button
              type="button"
              onClick={() => exportMarkdown(activeDeck)}
              className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
            >
              Export MD
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <select
          value={selectedTemplate}
          onChange={(event) => setSelectedTemplate(event.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          {TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Building deck..." : "Generate Deck"}
        </button>
      </div>

      {decks.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {decks.map((deck) => (
            <button
              key={deck.id}
              type="button"
              onClick={() => {
                setActiveDeck(deck);
                setSlideIndex(0);
              }}
              className={`shrink-0 border rounded px-3 py-1.5 text-xs ${
                activeDeck?.id === deck.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              {deck.label} — {new Date(deck.generatedAt).toLocaleDateString()}
            </button>
          ))}
        </div>
      ) : null}

      {activeDeck && slide ? (
        <div className="flex gap-4 h-[500px]">
          <div className="w-32 overflow-y-auto space-y-1 border-r pr-2 shrink-0">
            {activeDeck.slides.map((entry, index) => (
              <div
                key={`${entry.id}-${index}`}
                onClick={() => setSlideIndex(index)}
                className={`border rounded p-1.5 cursor-pointer text-xs ${
                  slideIndex === index ? "border-indigo-400 bg-indigo-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="font-medium truncate">{entry.heading}</div>
                <div className="text-gray-400 text-[10px]">{index + 1}/{activeDeck.slides.length}</div>
              </div>
            ))}
          </div>

          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2 text-xs text-gray-400">
              <button
                type="button"
                onClick={() => setSlideIndex((value) => Math.max(0, value - 1))}
                disabled={slideIndex === 0}
                className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span>{slideIndex + 1} / {activeDeck.slides.length}</span>
              <button
                type="button"
                onClick={() => setSlideIndex((value) => Math.min(activeDeck.slides.length - 1, value + 1))}
                disabled={slideIndex === activeDeck.slides.length - 1}
                className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                Next →
              </button>
            </div>

            <div className="flex-1 border-2 border-indigo-100 rounded-xl bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="bg-indigo-700 px-8 py-4">
                <h3 className="text-xl font-bold text-white">{slide.heading}</h3>
                <p className="text-indigo-200 text-xs mt-0.5">{programName}</p>
              </div>
              <div className="flex-1 px-8 py-6 overflow-y-auto">
                {slide.type === "title" ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <h2 className="text-4xl font-bold text-indigo-700">{programName}</h2>
                    <p className="text-lg text-gray-500 mt-3">{slide.content?.subheading || ""}</p>
                  </div>
                ) : null}

                {slide.type !== "title" && slide.content?.callout ? (
                  <div className="text-3xl font-bold text-indigo-700 mb-4">{slide.content.callout}</div>
                ) : null}

                {slide.type !== "title" && slide.content?.status ? (
                  <div className="text-2xl font-semibold mb-4" style={{ color: RAG_COLORS[slide.content.status] || "#333" }}>
                    {slide.content.status}
                    {slide.content.health != null ? (
                      <span className="text-base ml-2 text-gray-400">({slide.content.health}/100)</span>
                    ) : null}
                  </div>
                ) : null}

                {slide.type !== "title" && (slide.content?.bullets || []).length ? (
                  <ul className="space-y-2">
                    {slide.content.bullets.map((bullet: string, index: number) => (
                      <li key={`${bullet}-${index}`} className="flex items-start gap-2 text-gray-700">
                        <span className="text-indigo-400 mt-1 shrink-0">▸</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {slide.type !== "title" && slide.content?.items ? (
                  <div className="space-y-2 mt-4">
                    {slide.content.items.map((item: any, index: number) => (
                      <div key={`${item.title || item.name || item.description || index}-${index}`} className="border rounded p-2 text-sm">
                        <div className="font-medium">{item.title || item.name || item.description}</div>
                        {item.owner || item.dueDate || item.date || item.forecast ? (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {item.owner ? `Owner: ${item.owner}` : ""}
                            {item.date ? ` · ${item.date}` : ""}
                            {item.forecast ? ` · Forecast: ${item.forecast}` : ""}
                            {item.dueDate ? ` · Due: ${item.dueDate}` : ""}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {slide.content?.notes ? (
                <div className="border-t px-8 py-2 bg-gray-50 text-xs text-gray-500 italic">
                  📝 {slide.content.notes}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="border rounded p-8 text-center text-gray-400 text-sm">
          Select a template and click Generate to create a presentation deck.
        </div>
      )}
    </div>
  );
}
