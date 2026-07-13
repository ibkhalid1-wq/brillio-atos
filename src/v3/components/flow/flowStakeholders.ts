/**
 * Per-movement stakeholder lists for evidence collection. Every movement
 * gathers evidence from the people (or role-personas) whose input its
 * artifacts depend on — Listen from the discovery interviewees, Envision from
 * the architecture/design roles, Show from the Listen voices plus the sponsor,
 * Ship from the artifact-area owners, Evolve from the operating personas.
 * Each entry drives a stakeholder-evidence card: schedule a meeting, or
 * collect via a link, then capture what came back.
 */
import type { ProgramSummary } from "@/new/types";
import { meetingKit, askableMovementGaps } from "@/v3/components/flow/flowMeetings";
import { readContradictions, flowMovements, movementEvidence, readMovementInputs } from "@/v3/components/flow/flowShellData";

export interface MovementStakeholder {
  /** Stable key for React + pack matching. */
  id: string;
  /** A person's name when known, else the role label. */
  name: string;
  /** Role / the artifact area they speak to. */
  role: string;
  /** The area-specific questions their conversation must surface. */
  questions: string[];
  /** True when this is a role placeholder, not yet a named person. */
  isRole: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function dataRoot(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
}

/**
 * Open contradictions that NAME a person route to that person: their side of
 * the disagreement becomes a question on their own follow-up script (the
 * sponsor keeps the arbiter's copy via the frame kit). A conflict between two
 * documents/accounts therefore has two roads out of the Inbox — resolve it in
 * the log, or ask the people it belongs to.
 */
function contradictionAsksFor(program: ProgramSummary, personName: string): string[] {
  const needle = personName.trim().toLowerCase();
  if (needle.length < 3) return [];
  // readContradictions dedupes near-identical rows, so a dispute is asked once.
  return readContradictions(program, true)
    .filter((row) => row.between.toLowerCase().includes(needle))
    .map((row) => `Two accounts disagree: "${row.statement.trim()}" — your account vs ${row.between
      .split(/,|\bvs\.?\b|&/i).map((part) => part.trim()).filter((part) => part && part.toLowerCase() !== needle).join(", ") || "the other account"}. Which is right, and what settles it?`)
    .slice(0, 3);
}

function kitInterviews(program: ProgramSummary): MovementStakeholder[] {
  const kit = dataRoot(program).discoveryKit;
  const interviews = isRecord(kit) && Array.isArray(kit.interviews) ? kit.interviews.filter(isRecord) : [];
  // Listen's artifact gaps (ontology/atlas open questions) become follow-up
  // asks on every interviewee's script — an artifact that says "we still don't
  // know X" is a question for the people who can answer it.
  const movementAsks = interviews.length ? askableMovementGaps(program, "listen") : [];
  const listen = flowMovements().find((movement) => movement.id === "listen");
  const evidence = listen ? movementEvidence(program, listen) : [];
  return interviews.map((interview, index) => {
    const agenda = (Array.isArray(interview.agenda) ? interview.agenda : [])
      .flatMap((slot) => (isRecord(slot) && Array.isArray(slot.questions) ? slot.questions.map(String) : []))
      .filter(Boolean);
    const name = String(interview.stakeholder ?? "").trim();
    const key = name.toLowerCase();
    // Heard already? Their turns are on the record. If so, the follow-up is only
    // what is STILL OPEN (disagreements + artifact gaps) — not the original
    // agenda they've answered, which is what left it "not getting cleared".
    const heard = key.length > 2 && evidence.some((entry) =>
      entry.who.toLowerCase().includes(key) || key.includes(entry.who.split(",")[0].trim().toLowerCase()));
    const asks = name ? contradictionAsksFor(program, name) : [];
    const questions = heard
      ? [...new Set([...asks, ...movementAsks])]
      : [...new Set([...asks, ...movementAsks, ...agenda])];
    return {
      id: `iv-${index}`, name: name || `Interviewee ${index + 1}`, role: String(interview.role ?? ""),
      questions, isRole: !name,
    };
  });
}

function sponsorStakeholder(program: ProgramSummary): MovementStakeholder | null {
  const frame = isRecord(dataRoot(program).phaseInputs) ? (dataRoot(program).phaseInputs as Record<string, Record<string, unknown>>).frame : undefined;
  const sponsor = frame && typeof frame.sponsor === "string" ? frame.sponsor.trim() : "";
  if (!sponsor) return null;
  return {
    id: "sponsor", name: sponsor, role: "Executive Sponsor", isRole: false,
    questions: [
      "Since the last conversation — has the mandate, scope, or urgency shifted?",
      "Does what you're seeing match the outcome you're funding?",
      "What would make you confident enough to back the next step?",
    ],
  };
}

/**
 * Role bindings — the first-class place to say "our Solution Architect is
 * Priya, priya@…". Stored under the movement's inputs as `_roleBindings`
 * (JSON: role → {name, email}): the underscore keeps it OUT of the evidence
 * fingerprint, because naming a person is an org fact, not new evidence —
 * binding must never flag documents stale.
 */
export function readRoleBindings(program: ProgramSummary, movementId: string): Record<string, { name: string; email?: string }> {
  const raw = readMovementInputs(program, movementId)._roleBindings;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, { name: string; email?: string }> = {};
    for (const [role, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const name = String((value as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      const email = String((value as Record<string, unknown>).email ?? "").trim();
      out[role] = email ? { name, email } : { name };
    }
    return out;
  } catch { return {}; }
}

const ROLE_TEMPLATES: Record<string, Array<{ role: string; questions: string[] }>> = {
  envision: [
    { role: "Solution Architect", questions: ["Which target architecture shape fits our constraints, and what does it trade away?", "Which integrations are non-negotiable, and which are risky?", "Where are the operability and scaling risks?"] },
    { role: "Product Owner", questions: ["Which build slices demonstrate the most value first?", "What must the very first demonstration prove?", "What is explicitly out of scope for the pilot?"] },
    { role: "Experience Designer", questions: ["What must the user journey feel like at each stage?", "Where does a human stay in the loop, and why?", "What would make an agent's action feel trustworthy to a user?"] },
    { role: "Data / Engineering Lead", questions: ["Where does each entity live, and what are the sync constraints?", "What data-quality issues will bite us?", "What are the hard security and access boundaries?"] },
  ],
  ship: [
    { role: "Hardening / SRE Owner", questions: ["What guardrails and failure modes must we cover before go-live?", "What is the rollback plan if a slice misbehaves?", "What load or edge cases worry you most?"] },
    { role: "Eval / QA Owner", questions: ["What behaviours must we prove before go-live?", "What is the pass bar for each?", "Where would you not yet trust the agent?"] },
    { role: "Ops / Runbook Owner", questions: ["How is this run day to day, and who owns each routine?", "What is the incident-response path?", "What monitoring tells you it's healthy?"] },
    { role: "Executive Sponsor", questions: ["What must be true for you to approve cutover?", "What residual risk is acceptable to you?"] },
  ],
  evolve: [
    { role: "Operating Owner", questions: ["What is working in live operation, and what breaks?", "Where is manual effort still creeping back in?", "What would you change first?"] },
    { role: "Executive Sponsor", questions: ["Are we realising the value we set out to capture?", "What is the next outcome worth funding?"] },
  ],
};

/**
 * Every delivery role Envision onward, with its binding state — the Discovery
 * Kit studio shows this directory next to the interview roster so ALL of the
 * programme's people (heard voices and delivery roles alike) are managed in
 * one place. The sponsor rows auto-bind to Frame's sponsor.
 */
export interface DeliveryRoleEntry {
  movementId: string;
  role: string;
  bound: { name: string; email?: string } | null;
  /** True when the binding is inherited from Frame's sponsor, not editable here. */
  isSponsor: boolean;
}
export function deliveryRoleDirectory(program: ProgramSummary): DeliveryRoleEntry[] {
  const frame = readMovementInputs(program, "frame");
  const sponsor = typeof frame.sponsor === "string" ? frame.sponsor.trim() : "";
  const out: DeliveryRoleEntry[] = [];
  for (const [movementId, entries] of Object.entries(ROLE_TEMPLATES)) {
    const bindings = readRoleBindings(program, movementId);
    for (const entry of entries) {
      if (/sponsor/i.test(entry.role)) {
        out.push({ movementId, role: entry.role, bound: sponsor ? { name: sponsor } : null, isSponsor: true });
        continue;
      }
      out.push({ movementId, role: entry.role, bound: bindings[entry.role] ?? null, isSponsor: false });
    }
  }
  return out;
}

/** The stakeholders a movement collects evidence from. */
export function resolveMovementStakeholders(program: ProgramSummary, movementId: string): MovementStakeholder[] {
  if (movementId === "frame") {
    // Frame's one voice is the sponsor — their conversation runs on the same
    // full-width collection card as every other stakeholder, with the meeting
    // kit's sponsor script as their questions.
    const kit = meetingKit(program, "frame");
    if (!kit || !kit.who.trim()) return [];
    return [{ id: "frame-sponsor", name: kit.who.trim(), role: "Executive Sponsor", questions: kit.questions, isRole: false }];
  }
  if (movementId === "listen") return kitInterviews(program);
  if (movementId === "show") {
    // Circle back with everyone heard in Listen, plus the sponsor.
    const people = kitInterviews(program).map((s) => ({
      ...s, id: `show-${s.id}`,
      questions: [
        `Watch your own workflow run in the prototype — does it do what you described?`,
        "What's missing, wrong, or would block you from using this?",
        "Would you sign off on this for your part of the process?",
      ],
    }));
    const sponsor = sponsorStakeholder(program);
    if (sponsor && !people.some((p) => p.name.toLowerCase() === sponsor.name.toLowerCase())) {
      people.push({ ...sponsor, id: "show-sponsor", questions: [
        "Does the demonstration prove the outcome you're funding?",
        "What would you want to see before the full rollout?",
      ] });
    }
    return people;
  }
  const template = ROLE_TEMPLATES[movementId];
  if (template) {
    const sponsor = sponsorStakeholder(program);
    const bindings = readRoleBindings(program, movementId);
    return template.map((entry, index) => {
      // Bind the "Executive Sponsor" role to the real sponsor when known.
      if (/sponsor/i.test(entry.role) && sponsor) {
        return { id: `${movementId}-${index}`, name: sponsor.name, role: "Executive Sponsor", questions: entry.questions, isRole: false };
      }
      // An operator-bound role IS a person: their card carries their name,
      // their link and invite reach their address, their captures attribute.
      const bound = bindings[entry.role];
      if (bound?.name) {
        return { id: `${movementId}-${index}`, name: bound.name, role: entry.role, questions: entry.questions, isRole: false };
      }
      return { id: `${movementId}-${index}`, name: entry.role, role: entry.role, questions: entry.questions, isRole: true };
    });
  }
  return [];
}
