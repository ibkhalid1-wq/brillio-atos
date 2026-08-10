/**
 * The ONE operator write path, extracted so the operator inbox can live where it
 * belongs (the Inbox view) without a second copy of the commit logic following it
 * there. Both the ledger verbs (`_operatorActions`) and the artifact-ask marks
 * (`_artifactAsks`) ride the same fingerprint-safe `{silent:true}` channel.
 *
 * Discover shows WHO TO ENGAGE and their questions. Everything the OPERATOR must
 * resolve — assign, sessions, adjudicate, in-flight, the dictionary ask — belongs
 * to the Inbox. This hook is what lets that separation hold without duplication.
 */
import { useCallback, useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { readDirectoryPeople } from "@/v3/components/flow/flowStakeholders";
import { serializeOperatorActions, OPERATOR_ACTIONS_FIELD, type OperatorAction } from "./operatorActions";
import type { ArtifactAskMark } from "./artifactAsks";

export const ARTIFACT_ASKS_FIELD = "_artifactAsks";
/** The data dictionary the SoR asks are satisfied by (CSV text or a parsed doc). */
export const DATA_DICTIONARY_FIELD = "_dataDictionary";

// Matches the shell's save handler: every underscore field is written as a
// STRING (serialized actions, JSON marks, CSV text) — no shape widening needed.
type SaveInputs = (phaseId: string, values: Record<string, string>, opts?: { silent?: boolean }) => Promise<unknown> | void;

/** Marks already on the record — tolerant of the JSON-string form the writer uses. */
export function readAskMarks(program: ProgramSummary | null | undefined): ArtifactAskMark[] {
  if (!program) return [];
  const raw = (readMovementInputs(program, "listen") as Record<string, unknown> | undefined)?.[ARTIFACT_ASKS_FIELD];
  const arr = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return []; } })() : raw;
  return Array.isArray(arr)
    ? arr.filter((m): m is ArtifactAskMark => !!m && typeof m === "object" && typeof (m as ArtifactAskMark).sor === "string")
    : [];
}

export interface OperatorCommits {
  /** Everyone the operator can route a question to — the roster, deduped. */
  candidates: Array<{ label: string; role: string }>;
  commitAction: (action: OperatorAction | OperatorAction[], existing: OperatorAction[]) => Promise<void>;
  commitAskMark: (mark: ArtifactAskMark) => Promise<void>;
  /** Attach the client's data dictionary — the write half of the SoR ask. */
  commitDictionary: (csv: string) => Promise<void>;
  canWrite: boolean;
}

export function useOperatorCommits(
  program: ProgramSummary | null | undefined,
  onSaveInputs?: SaveInputs,
): OperatorCommits {
  const candidates = useMemo(() => {
    if (!program) return [];
    const seen = new Set<string>();
    const out: Array<{ label: string; role: string }> = [];
    for (const p of readDirectoryPeople(program)) {
      const label = (p.name || p.role || "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, role: (p.role || "").trim() || label });
    }
    return out;
  }, [program]);

  const commitAction = useCallback(async (action: OperatorAction | OperatorAction[], existing: OperatorAction[]) => {
    if (!onSaveInputs) return;
    const added = Array.isArray(action) ? action : [action];
    await onSaveInputs("listen", { [OPERATOR_ACTIONS_FIELD]: serializeOperatorActions([...existing, ...added]) }, { silent: true });
  }, [onSaveInputs]);

  const commitAskMark = useCallback(async (mark: ArtifactAskMark) => {
    if (!onSaveInputs) return;
    await onSaveInputs("listen", { [ARTIFACT_ASKS_FIELD]: JSON.stringify([...readAskMarks(program), mark]) }, { silent: true });
  }, [onSaveInputs, program]);

  const commitDictionary = useCallback(async (csv: string) => {
    if (!onSaveInputs) return;
    await onSaveInputs("listen", { [DATA_DICTIONARY_FIELD]: csv }, { silent: true });
  }, [onSaveInputs]);

  return { candidates, commitAction, commitAskMark, commitDictionary, canWrite: !!onSaveInputs };
}
