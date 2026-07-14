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
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { meetingKit, askableMovementGaps } from "@/v3/components/flow/flowMeetings";
import { readContradictions, flowMovements, movementEvidence, readMovementInputs, parseGridRows } from "@/v3/components/flow/flowShellData";

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
    .filter((row) => row.between.toLowerCase().includes(needle)
      || (row.routedTo ?? "").trim().toLowerCase() === needle)
    .map((row) => `Two accounts disagree: "${row.statement.trim()}" — your account vs ${row.between
      .split(/,|\bvs\.?\b|&/i).map((part) => part.trim()).filter((part) => part && part.toLowerCase() !== needle).join(", ") || "the other account"}. Which is right, and what settles it?`)
    .slice(0, 3);
}

/**
 * Which rostered people an artifact ask is ADDRESSED to. A gap that names a
 * person ("Ask Dan: …") or a role ("the Talent Acquisition SME's hand-off…")
 * belongs on THAT card only — putting it on everyone's script asks the Legal
 * SME about talent acquisition, which reads as noise and burns goodwill.
 * Returns the matched roster keys; empty means the ask names no one and stays
 * movement-wide.
 */
function askAudience(ask: string, roster: Array<{ name: string; role: string }>): Set<string> {
  const text = ask.toLowerCase();
  const matched = new Set<string>();
  for (const person of roster) {
    const name = person.name.trim().toLowerCase();
    const role = person.role.trim().toLowerCase();
    const first = name.split(/\s+/)[0] ?? "";
    if ((name.length > 3 && text.includes(name))
      || (first.length > 3 && text.includes(first))
      || (role.length > 3 && text.includes(role))) {
      matched.add(name);
    }
  }
  return matched;
}

/**
 * Roles the OPERATOR removed from the programme's cast — stored under Listen's
 * inputs as `_dismissedListenRoles` (underscore ⇒ fingerprint-safe: removing a
 * role is an operator judgement, never new evidence). Every role-derived
 * surface (persona cards, TBC placeholders, People rows) filters against it,
 * and regeneration can't resurrect a dismissed role.
 */
export function dismissedListenRoles(program: ProgramSummary): Set<string> {
  const raw = readMovementInputs(program, "listen")._dismissedListenRoles;
  if (typeof raw !== "string" || !raw.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean) : []);
  } catch { return new Set(); }
}

/** Every persona the Discovery Kit inventoried — the programme's full cast of
 * roles, internal AND external, minus the ones the operator dismissed. The
 * People page lists these so no role lives only inside the kit document. */
export interface KitPersonaEntry {
  name: string;
  kind: "internal" | "external";
  spokenForBy: string[];
  unrepresented: boolean;
}
export function kitPersonaDirectory(program: ProgramSummary): KitPersonaEntry[] {
  const kit = dataRoot(program).discoveryKit;
  const personas = isRecord(kit) && Array.isArray(kit.personas) ? kit.personas.filter(isRecord) : [];
  const dismissed = dismissedListenRoles(program);
  const seen = new Set<string>();
  const out: KitPersonaEntry[] = [];
  for (const persona of personas) {
    const name = String(persona.name ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || dismissed.has(key)) continue;
    seen.add(key);
    const spokenForBy = Array.isArray(persona.spokenForBy) ? persona.spokenForBy.map(String).map((s) => s.trim()).filter(Boolean) : [];
    out.push({
      name,
      kind: String(persona.kind ?? "internal") === "external" ? "external" : "internal",
      spokenForBy,
      unrepresented: persona.unrepresented === true || !spokenForBy.length,
    });
  }
  return out;
}

function kitInterviews(program: ProgramSummary): MovementStakeholder[] {
  const kit = dataRoot(program).discoveryKit;
  const interviews = isRecord(kit) && Array.isArray(kit.interviews) ? kit.interviews.filter(isRecord) : [];
  // Listen's artifact gaps (ontology/atlas open questions) become follow-up
  // asks — ROUTED: an ask that names a person or role goes only to their
  // card; an unaddressed ask is genuinely open and goes to everyone.
  const movementAsks = interviews.length ? askableMovementGaps(program, "listen") : [];
  const listen = flowMovements().find((movement) => movement.id === "listen");
  const evidence = listen ? movementEvidence(program, listen) : [];
  // The routing roster: every interviewee plus the sponsor — a sponsor-
  // addressed ask ("Ask the sponsor: …") must not spam the interviewees
  // (it reaches the sponsor through Frame's card).
  const sponsor = sponsorStakeholder(program);
  // Listen role bindings: a placeholder bound on its card ("our Recruitment
  // Operations lead is Maya") BECOMES that person here — the one place every
  // downstream reader (collect board, People page, approvals) derives from.
  const listenBindings = readRoleBindings(program, "listen");
  // UNREPRESENTED PERSONAS become role-placeholder cards. The generator is
  // told to emit an interview entry for every voice the programme needs, but
  // when it only inventories a role under kit.personas (seen live: "Recruitment
  // Operations Staff" on Pharma), that role must still surface — on the collect
  // board and the People page — or the programme silently never hears it.
  // External personas (customers, partners) are excluded: they can't be
  // interviewed; internal ones with nobody to speak for them can and must.
  const covered = new Set<string>();
  for (const interview of interviews) {
    for (const value of [interview.stakeholder, interview.role]) {
      const token = String(value ?? "").trim().toLowerCase().replace(/\s*[—–-]\s*tbc\s*$/i, "");
      if (token) covered.add(token);
    }
  }
  const personas = isRecord(kit) && Array.isArray(kit.personas) ? kit.personas.filter(isRecord) : [];
  // Operator-dismissed roles leave the cast everywhere: no card, no People
  // row, and a regeneration can't resurrect them.
  const dismissedRoles = dismissedListenRoles(program);
  const personaRoles = personas
    .filter((persona) => String(persona.kind ?? "internal") !== "external")
    .filter((persona) => persona.unrepresented === true
      || !(Array.isArray(persona.spokenForBy) && persona.spokenForBy.map(String).filter((s) => s.trim()).length))
    .map((persona) => String(persona.name ?? "").trim())
    .filter((roleName) => roleName && !covered.has(roleName.toLowerCase()) && !dismissedRoles.has(roleName.toLowerCase()));
  const audienceRoster = [
    ...interviews.map((interview) => ({ name: String(interview.stakeholder ?? "").trim(), role: String(interview.role ?? "").trim() })),
    ...personaRoles.map((roleName) => ({ name: listenBindings[roleName]?.name ?? "", role: roleName })),
    ...(sponsor ? [{ name: sponsor.name, role: sponsor.role }] : []),
  ];
  const personaCards: MovementStakeholder[] = personaRoles.map((roleName, index) => {
    const bound = listenBindings[roleName];
    const name = bound?.name ?? "";
    const key = (name || roleName).toLowerCase();
    const myAsks = movementAsks.filter((ask) => {
      const audience = askAudience(ask, audienceRoster);
      return audience.size === 0 || audience.has(key) || audience.has(name.toLowerCase());
    });
    return {
      id: `persona-${index}`,
      name: name || roleName,
      role: roleName,
      questions: [...new Set([
        "Walk us through your part of the process — what do you pick up, from whom, and what do you hand off when you're done?",
        ...myAsks,
      ])],
      isRole: !name,
    };
  });
  const interviewCards = interviews.map((interview, index) => {
    const agenda = (Array.isArray(interview.agenda) ? interview.agenda : [])
      .flatMap((slot) => (isRecord(slot) && Array.isArray(slot.questions) ? slot.questions.map(String) : []))
      .filter(Boolean);
    // A kit entry is a ROLE PLACEHOLDER when the stakeholder is empty OR uses
    // the "Role — TBC" convention the generator is instructed to emit. Its
    // label is the role awaiting a person, never someone's name.
    const rawName = String(interview.stakeholder ?? "").trim();
    const tbc = /\s*[—–-]\s*TBC\s*$/i.test(rawName);
    const roleLabel = String(interview.role ?? "").trim() || rawName.replace(/\s*[—–-]\s*TBC\s*$/i, "").trim();
    const placeholder = !rawName || tbc;
    const bound = placeholder && roleLabel ? listenBindings[roleLabel] : undefined;
    const name = placeholder ? (bound?.name ?? "") : rawName;
    const key = name.toLowerCase();
    const myAsks = movementAsks.filter((ask) => {
      const audience = askAudience(ask, audienceRoster);
      return audience.size === 0 || audience.has(key);
    });
    // Heard already? Their turns are on the record. If so, the follow-up is only
    // what is STILL OPEN (disagreements + artifact gaps) — not the original
    // agenda they've answered, which is what left it "not getting cleared".
    const heard = key.length > 2 && evidence.some((entry) =>
      entry.who.toLowerCase().includes(key) || key.includes(entry.who.split(",")[0].trim().toLowerCase()));
    const asks = name ? contradictionAsksFor(program, name) : [];
    const questions = heard
      ? [...new Set([...asks, ...myAsks])]
      : [...new Set([...asks, ...myAsks, ...agenda])];
    return {
      id: `iv-${index}`, name: name || roleLabel || `Interviewee ${index + 1}`, role: roleLabel,
      questions, isRole: !name,
    };
  });
  // A dismissed role's placeholder card leaves the board too — but a NAMED
  // person is never dropped by a role dismissal (people outrank roles).
  return [...interviewCards, ...personaCards]
    .filter((card) => !(card.isRole && dismissedRoles.has(card.role.trim().toLowerCase())));
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
  // Envision questions are DECISION-SHAPED: each answer becomes a fact the
  // Architecture Strategy's constraint-satisfaction matrix, buildVsBuy
  // exit-paths, score weighting and failure modes verify against — not a
  // vague preference the generator has to guess from.
  envision: [
    { role: "Solution Architect", questions: [
      "Constraints as verdicts: which system must remain the system of record? Which data may not leave your tenancy or region? What peak volume (records/day) must this survive? What uptime does the business actually need?",
      "Which integrations are non-negotiable, and which are risky? For each system: API, export, or human-only access — and who owns the credentials?",
      "What have you already tried or bought for this problem, and what happened?",
      "Where are the operability and scaling risks?",
    ] },
    { role: "Product Owner", questions: [
      "Which build slices demonstrate the most value first?",
      "What must the very first demonstration prove?",
      "What is explicitly out of scope for the pilot?",
      "If you had to trade: faster first demo vs. lower run-cost vs. easier operations — rank them, and say why.",
    ] },
    { role: "Experience Designer", questions: [
      "What must the user journey feel like at each stage?",
      "Where does a human stay in the loop, and why?",
      "What is the worst way an automated system could embarrass you in front of a customer?",
    ] },
    { role: "Data / Engineering Lead", questions: [
      "Where does each entity live, and what are the sync constraints?",
      "What data-quality issues will bite us?",
      "What are the hard security and access boundaries — and which data carries PII or regulatory handling rules?",
      "Build vs buy: where does your organisation default, and who owns that decision?",
    ] },
  ],
  ship: [
    { role: "Hardening / SRE Owner", questions: [
      "What guardrails and failure modes must we cover before go-live?",
      "What is the rollback plan if a slice misbehaves — and who can call the abort during the cutover window?",
      "What load or edge cases worry you most?",
      "What service levels must hold in production — and what alert should defend each one?",
    ] },
    { role: "Eval / QA Owner", questions: ["What behaviours must we prove before go-live?", "What is the pass bar for each?", "Where would you not yet trust the agent?"] },
    { role: "Ops / Runbook Owner", questions: [
      "How is this run day to day, and who owns each routine?",
      "What is the incident-response path?",
      "What monitoring tells you it's healthy?",
      "Who must be told what — before, during and after cutover — and on which channel?",
    ] },
    { role: "Executive Sponsor", questions: ["What must be true for you to approve cutover?", "What residual risk is acceptable to you — and are you prepared to accept it on the record?"] },
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
/**
 * People the OPERATOR added directly in the People tab — stored under Listen's
 * inputs as `_directoryPeople` (underscore ⇒ fingerprint-safe: adding a person
 * is an org fact, never new evidence). Each carries a `roleResolved` flag: a
 * role the programme already recognises resolves on add; an unfamiliar one
 * stays unresolved and surfaces in the Inbox to clarify.
 */
export interface DirectoryPerson {
  id: string;
  name: string;
  email?: string;
  role: string;
  movementId: string;
  roleResolved: boolean;
}
export function readDirectoryPeople(program: ProgramSummary): DirectoryPerson[] {
  const raw = readMovementInputs(program, "listen")._directoryPeople;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).map((entry) => ({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? "").trim(),
      email: entry.email ? String(entry.email).trim() : undefined,
      role: String(entry.role ?? "").trim(),
      movementId: String(entry.movementId ?? "listen"),
      roleResolved: entry.roleResolved === true,
    })).filter((entry) => entry.id && entry.name);
  } catch { return []; }
}

const normRole = (role: string): string => role.trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\/+/g, " ").replace(/\s+/g, " ").trim();
const roleTokens = (role: string): Set<string> =>
  new Set((normRole(role).match(/[a-z]{3,}/g) ?? []).filter((t) => !["the", "and", "for", "lead", "owner", "sme"].includes(t)));

/**
 * Every role the programme RECOGNISES: the methodology's delivery-role
 * templates, the sponsor role, the discovery-kit personas and heard roster
 * roles, and any operator-declared role already resolved in the directory.
 * This is the vocabulary a newly-added person's role is validated against.
 */
export function knownProgramRoles(program: ProgramSummary): string[] {
  const roles = new Set<string>();
  roles.add("Executive Sponsor");
  for (const entries of Object.values(ROLE_TEMPLATES)) for (const entry of entries) roles.add(entry.role);
  const kit = dataRoot(program).discoveryKit;
  if (isRecord(kit) && Array.isArray(kit.interviews)) {
    for (const iv of kit.interviews) if (isRecord(iv) && typeof iv.role === "string" && iv.role.trim()) roles.add(iv.role.trim());
  }
  for (const rosterRow of parseGridRows(readMovementInputs(program, "listen").interviewRoster)) {
    const role = String(rosterRow.role ?? "").trim();
    if (role) roles.add(role);
  }
  for (const person of readDirectoryPeople(program)) if (person.roleResolved && person.role) roles.add(person.role);
  return [...roles];
}

/**
 * Does this role match a role the programme already knows? Exact (normalised)
 * or strong token overlap counts as known; otherwise it is unresolved and the
 * caller routes it to the Inbox. `suggestions` are the closest known roles.
 */
export function validateProgramRole(program: ProgramSummary, role: string):
  { known: boolean; match: string | null; suggestions: string[] } {
  const target = normRole(role);
  if (!target) return { known: false, match: null, suggestions: [] };
  const known = knownProgramRoles(program);
  const exact = known.find((k) => normRole(k) === target);
  if (exact) return { known: true, match: exact, suggestions: [] };
  const targetToks = roleTokens(role);
  const scored = known
    .map((k) => {
      const kt = roleTokens(k);
      let shared = 0;
      for (const t of targetToks) if (kt.has(t)) shared += 1;
      return { role: k, score: kt.size && targetToks.size ? shared / Math.min(kt.size, targetToks.size) : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const strong = scored.find((entry) => entry.score >= 0.75);
  if (strong) return { known: true, match: strong.role, suggestions: [] };
  return { known: false, match: null, suggestions: scored.slice(0, 4).map((entry) => entry.role) };
}

/**
 * Every person the programme already KNOWS by name: the Listen roster voices,
 * operator-added directory people, everyone bound in `_roleBindings`, and the
 * sponsor. Used to tell whether a name typed into the Discovery Kit coverage
 * map is a real person or one the operator must still add.
 */
export function knownPeopleNames(program: ProgramSummary): Set<string> {
  const names = new Set<string>();
  const add = (n: string) => { const v = n.trim().toLowerCase(); if (v) names.add(v); };
  for (const entry of resolveMovementStakeholders(program, "listen")) if (!entry.isRole) add(entry.name);
  for (const p of readDirectoryPeople(program)) add(p.name);
  const frame = readMovementInputs(program, "frame");
  if (typeof frame.sponsor === "string") add(frame.sponsor.split(",")[0]);
  for (const bucket of Object.values((() => {
    const inner = dataRoot(program).phaseInputs;
    return isRecord(inner) ? inner as Record<string, Record<string, unknown>> : {};
  })())) {
    const raw = bucket?._roleBindings;
    if (typeof raw !== "string") continue;
    try { for (const b of Object.values(JSON.parse(raw) as Record<string, { name?: unknown }>)) add(String(b?.name ?? "")); } catch { /* skip */ }
  }
  return names;
}

/** Names the operator explicitly marked "not a person" on the coverage map —
 * team/function labels that should not keep prompting. Fingerprint-safe. */
function dismissedCoverageNames(program: ProgramSummary): Set<string> {
  const raw = readMovementInputs(program, "listen")._dismissedCoverageNames;
  if (typeof raw !== "string" || !raw.trim()) return new Set();
  try { const a = JSON.parse(raw); return new Set(Array.isArray(a) ? a.map((x) => String(x).trim().toLowerCase()) : []); }
  catch { return new Set(); }
}

/**
 * Names written into the Discovery Kit coverage map's "covered by" that are NOT
 * yet people on the programme. Each is an Inbox item to resolve: add them to
 * People, or mark the label as not-a-person. Team/function labels the operator
 * dismissed are excluded.
 */
export function unresolvedCoverageNames(program: ProgramSummary): Array<{ name: string; domain: string }> {
  const kit = dataRoot(program).discoveryKit;
  const rows = isRecord(kit) && Array.isArray(kit.coverageMap) ? kit.coverageMap.filter(isRecord) : [];
  const known = knownPeopleNames(program);
  const dismissed = dismissedCoverageNames(program);
  // A role the operator removed from the cast must not auto-add back in
  // through its coverage label.
  const dismissedRoles = dismissedListenRoles(program);
  const out: Array<{ name: string; domain: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = String(row.domain ?? "").trim();
    const coveredBy = Array.isArray(row.coveredBy) ? row.coveredBy.map(String) : String(row.coveredBy ?? "").split(",");
    for (const raw of coveredBy) {
      const name = raw.trim();
      // "End Patient — TBC" and "End Patient" are the same identity: strip the
      // TBC suffix before matching, so adding the person resolves the label.
      const key = name.toLowerCase().replace(/\s*[—–-]\s*tbc\s*$/i, "").trim();
      if (!name || name.split(/\s+/).length > 5) continue; // skip empties + sentence-like blobs
      if (!key || known.has(key) || dismissed.has(key) || dismissedRoles.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, domain });
    }
  }
  return out;
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

/**
 * Rename a person across the record. The Discovery-Kit roster is the join key
 * every reader uses (roster, interview packs, the gate's email check, evidence
 * matching), so the rename patches it there and re-keys the one contact store
 * (`_roleBindings`) so their email travels with them. Historical transcript
 * headers keep the original name — they are an immutable record of what was
 * captured — so only forward-looking reads pick up the new name. Returns the
 * new inner blob for persistFlowMutation, or null when nothing changed.
 */
export function renamePersonInProgram(
  program: ProgramSummary,
  oldName: string,
  newName: string,
  actor: string,
): Record<string, unknown> | null {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const eq = (value: unknown) => String(value ?? "").trim().toLowerCase() === from.toLowerCase();
  let touched = false;

  // 1) Discovery-Kit roster — the source every reader joins on.
  const kit = isRecord(inner.discoveryKit) ? { ...(inner.discoveryKit as Record<string, unknown>) } : null;
  if (kit) {
    if (Array.isArray(kit.interviews)) {
      kit.interviews = (kit.interviews as unknown[]).map((iv) => {
        if (isRecord(iv) && eq(iv.stakeholder)) { touched = true; return { ...iv, stakeholder: to }; }
        return iv;
      });
    }
    if (Array.isArray(kit.personas)) {
      kit.personas = (kit.personas as unknown[]).map((p) => {
        if (!isRecord(p) || !Array.isArray(p.spokenForBy)) return p;
        const names = (p.spokenForBy as unknown[]).map((n) => (eq(n) ? (touched = true, to) : n));
        return { ...p, spokenForBy: names };
      });
    }
  }

  // 2) One contact store — re-key the binding so the address follows the name.
  const phaseInputs = isRecord(inner.phaseInputs) ? { ...(inner.phaseInputs as Record<string, unknown>) } : {};
  for (const [mid, bucketRaw] of Object.entries(phaseInputs)) {
    if (!isRecord(bucketRaw)) continue;
    // Sponsor's name lives as a plain string on Frame's inputs.
    if (typeof bucketRaw.sponsor === "string" && eq(bucketRaw.sponsor)) {
      phaseInputs[mid] = { ...bucketRaw, sponsor: to }; touched = true;
    }
    const raw = (phaseInputs[mid] as Record<string, unknown>)._roleBindings;
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, { name?: unknown; email?: unknown }>;
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if ((isRecord(val) && eq(val.name)) || key.trim().toLowerCase() === from.toLowerCase()) {
          next[to] = isRecord(val) ? { ...val, name: to } : val; changed = true; touched = true;
        } else next[key] = val;
      }
      if (changed) phaseInputs[mid] = { ...(phaseInputs[mid] as Record<string, unknown>), _roleBindings: JSON.stringify(next) };
    } catch { /* skip malformed bindings */ }
  }

  // 3) Operator-added directory people.
  const listen = isRecord(phaseInputs.listen) ? { ...(phaseInputs.listen as Record<string, unknown>) } : null;
  if (listen && typeof listen._directoryPeople === "string") {
    try {
      const dp = JSON.parse(listen._directoryPeople) as unknown[];
      if (Array.isArray(dp)) {
        listen._directoryPeople = JSON.stringify(dp.map((p) => (isRecord(p) && eq(p.name) ? (touched = true, { ...p, name: to }) : p)));
        phaseInputs.listen = listen;
      }
    } catch { /* skip */ }
  }

  if (!touched) return null;

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    ...(kit ? { discoveryKit: kit } : {}),
    phaseInputs,
    flowAttestations: [...log, {
      ts: new Date().toISOString(), agentId: actor, phaseId: "listen", tier: 2,
      action: `Person renamed — ${from} → ${to}`,
      detail: "roster and contact binding updated; historical evidence keeps the original attribution",
    }].slice(-200),
  }, usesNestedData);
}
