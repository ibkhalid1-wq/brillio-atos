/**
 * Per-field AI assist for phase inputs.
 *
 * The phase workspace lets a PM fill methodology-required inputs by Direct Entry,
 * Upload, or "with AI". This module owns the *pure, testable* half of the AI path:
 * turning a field + its programme context into a focused prompt that the existing
 * copilot-chat endpoint can answer. The network call lives in the shell; keeping
 * prompt construction here means the contract (what we ask for, how we sanitise
 * the reply) is unit-tested even while the AI provider is unreachable.
 */

export type FieldAssistMode = "generate" | "improve" | "expand" | "rewrite" | "merge";

export interface FieldAssistContext {
  programName: string;
  client?: string | null;
  industry?: string | null;
  objective?: string | null;
  phaseLabel: string;
  fieldLabel: string;
  fieldHint?: string | null;
  currentValue: string;
  /** For `merge` mode: the new value (e.g. a document-extracted value) to reconcile with currentValue. */
  incomingValue?: string;
  /**
   * Reviewer suggestions to act on (e.g. from the "Improve quality" modal). When
   * present, the assist must incorporate the points that pertain to THIS field
   * into the rewritten value and ignore points that belong to other fields.
   */
  guidance?: string;
}

/** Human-facing label for each mode (used by the inline action buttons). */
export const FIELD_ASSIST_MODE_LABEL: Record<FieldAssistMode, string> = {
  generate: "Generate",
  improve: "Improve",
  expand: "Expand",
  rewrite: "Rewrite",
  merge: "Merge",
};

const MODE_INSTRUCTION: Record<FieldAssistMode, string> = {
  generate:
    "Write a strong first draft for this field from scratch, grounded in the programme context above.",
  improve:
    "Improve the current draft: tighten the language, sharpen specificity, and remove vagueness while preserving its intent.",
  expand:
    "Expand the current draft with more relevant, concrete detail. Do not pad or repeat — every added clause must carry information.",
  rewrite:
    "Rewrite the current draft in clear, consultative, executive-ready language while preserving its meaning.",
  merge:
    "Reconcile the existing value and the new value into a single coherent field entry that preserves every distinct, accurate fact from both and reads as one polished statement.",
};

/**
 * Whether a field accepts an AI free-text rewrite. Only open prose fields do:
 * a constrained field (select/date) has a fixed value space, so a free-text
 * reply would write a value the control can't render — e.g. an off-list option
 * leaves a dropdown blank or, worse, gets pinned as an unreadable custom option.
 * Structured fields (grid) are reconciled by their own deterministic paths. An
 * undefined type defaults to text, matching the panel's textarea fallback.
 */
export function isFreeTextAssistField(type: string | undefined): boolean {
  return type === undefined || type === "text" || type === "textarea";
}

/**
 * Modes that require existing text to act on. `generate` is the only empty-state
 * mode. `merge` needs both an existing and an incoming value, so it is never
 * offered as a standalone inline action — it is invoked programmatically.
 */
export function isModeAvailable(mode: FieldAssistMode, currentValue: string): boolean {
  if (mode === "merge") return false;
  const hasValue = currentValue.trim().length > 0;
  return mode === "generate" ? !hasValue : hasValue;
}

/** Which actions to offer for the current field state. */
export function availableModes(currentValue: string): FieldAssistMode[] {
  return (Object.keys(FIELD_ASSIST_MODE_LABEL) as FieldAssistMode[]).filter((mode) =>
    isModeAvailable(mode, currentValue),
  );
}

/**
 * Build the copilot-chat message for a single field. The reply is consumed
 * verbatim into the field, so we are emphatic about returning ONLY the content.
 */
export function buildFieldAssistPrompt(mode: FieldAssistMode, ctx: FieldAssistContext): string {
  const contextLines = [
    `Programme: ${ctx.programName || "(unnamed)"}`,
    ctx.client ? `Client: ${ctx.client}` : null,
    ctx.industry ? `Industry: ${ctx.industry}` : null,
    ctx.objective ? `Objective: ${ctx.objective}` : null,
    `Phase: ${ctx.phaseLabel}`,
    `Field: ${ctx.fieldLabel}`,
    ctx.fieldHint ? `Field guidance: ${ctx.fieldHint}` : null,
  ].filter(Boolean);

  const current = ctx.currentValue.trim();

  if (mode === "merge") {
    const incoming = (ctx.incomingValue ?? "").trim();
    return [
      "You are AURA, a senior delivery consultant helping a Program Manager complete a phase input field.",
      "",
      "PROGRAMME CONTEXT:",
      ...contextLines,
      "",
      "EXISTING VALUE (already saved in the field):",
      current || "(empty)",
      "",
      "NEW VALUE (extracted from an uploaded document):",
      incoming || "(empty)",
      "",
      `TASK: ${MODE_INSTRUCTION.merge}`,
      "",
      "RULES:",
      "- Return ONLY the field text — no preamble, no sign-off, no quotation marks, no markdown headers.",
      "- Preserve every distinct, accurate fact from BOTH values; do not drop information.",
      "- Reconcile overlaps into a single coherent statement and remove redundancy.",
      "- Keep it concise and specific, in a professional, consultative tone suitable for an executive audience.",
    ].join("\n");
  }

  const guidance = (ctx.guidance ?? "").trim();
  return [
    "You are AURA, a senior delivery consultant helping a Program Manager complete a phase input field.",
    "",
    "PROGRAMME CONTEXT:",
    ...contextLines,
    "",
    current ? "CURRENT DRAFT:" : "CURRENT DRAFT: (empty)",
    current || "",
    "",
    `TASK: ${MODE_INSTRUCTION[mode]}`,
    ...(guidance
      ? [
          "",
          "REVIEWER GUIDANCE (a quality reviewer raised these points about the document this field feeds):",
          guidance,
          "Incorporate ONLY the points above that pertain to THIS field; ignore any that belong to other fields. Never invent facts that are not implied by the programme context or current draft.",
        ]
      : []),
    "",
    "RULES:",
    "- Return ONLY the field text — no preamble, no sign-off, no quotation marks, no markdown headers.",
    "- Keep it concise and specific: 2–4 sentences unless the field clearly needs a short list.",
    "- Write in a professional, consultative tone suitable for an executive audience.",
  ].join("\n");
}

/**
 * Sanitise a raw AI reply into a clean field value. Models sometimes wrap the
 * answer in quotes or a "Here is…" preamble despite instructions; we strip the
 * most common offenders so the field receives usable text.
 */
export function sanitiseFieldReply(raw: string): string {
  let text = (raw || "").trim();
  // Strip a leading "Here is …:" / "Sure, …:" style preamble line.
  text = text.replace(/^(sure|certainly|here(?:'s| is| are)|okay|ok)[^\n:]*:\s*/i, "");
  // Strip wrapping quotes or code fences.
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  if (text.length >= 2 && /^["'“]/.test(text) && /["'”]$/.test(text)) {
    text = text.slice(1, -1).trim();
  }
  return text;
}
