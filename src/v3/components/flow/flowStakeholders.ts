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

function kitInterviews(program: ProgramSummary): MovementStakeholder[] {
  const kit = dataRoot(program).discoveryKit;
  const interviews = isRecord(kit) && Array.isArray(kit.interviews) ? kit.interviews.filter(isRecord) : [];
  return interviews.map((interview, index) => {
    const questions = (Array.isArray(interview.agenda) ? interview.agenda : [])
      .flatMap((slot) => (isRecord(slot) && Array.isArray(slot.questions) ? slot.questions.map(String) : []))
      .filter(Boolean);
    const name = String(interview.stakeholder ?? "").trim();
    return { id: `iv-${index}`, name: name || `Interviewee ${index + 1}`, role: String(interview.role ?? ""), questions, isRole: !name };
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

/** The stakeholders a movement collects evidence from. */
export function resolveMovementStakeholders(program: ProgramSummary, movementId: string): MovementStakeholder[] {
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
    return template.map((entry, index) => {
      // Bind the "Executive Sponsor" role to the real sponsor when known.
      if (/sponsor/i.test(entry.role) && sponsor) {
        return { id: `${movementId}-${index}`, name: sponsor.name, role: "Executive Sponsor", questions: entry.questions, isRole: false };
      }
      return { id: `${movementId}-${index}`, name: entry.role, role: entry.role, questions: entry.questions, isRole: true };
    });
  }
  return [];
}
