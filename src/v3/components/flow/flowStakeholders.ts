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
import { meetingKit, askableMovementGaps, sponsorLinkQuestions } from "@/v3/components/flow/flowMeetings";
import { readContradictions, flowMovements, movementEvidence, readMovementInputs, parseGridRows, deferredAsks } from "@/v3/components/flow/flowShellData";
import { stakeholderPrimaryArea, areaHasModel } from "@/v3/components/flow/flowAreas";

export interface MovementStakeholder {
  /** Stable key for React + pack matching. */
  id: string;
  /** A person's name when known, else the role label. */
  name: string;
  /** Role / the artifact area they speak to. */
  role: string;
  /** The area-specific questions their conversation must surface. */
  questions: string[];
  /** The agenda to mint a data-collection LINK with, when it differs from the
   * displayed `questions`. The Frame sponsor's script collapses to `[]` once
   * the mandate is on record (so a heard sponsor isn't re-asked), but their
   * card still offers a confirmation link — this keeps that link non-empty
   * without pushing the collapsed questions back into their status. */
  linkQuestions?: string[];
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
 * The conflicts the SPONSOR must arbitrate — every still-open contradiction on
 * record, phrased for a decision-maker rather than a party. In Listen the
 * sponsor is the arbiter, not a process witness: their script carries ONLY
 * conflicts to resolve, while the discovery questions route to the people who
 * actually own the work. Deduped and capped so one dispute is asked once.
 */
function sponsorConflictAsks(program: ProgramSummary): string[] {
  return readContradictions(program, true)
    .filter((row) => !/resolved|closed|settled/i.test(row.status ?? ""))
    .map((row) => {
      const parties = row.between
        .split(/,|\bvs\.?\b|&/i).map((part) => part.trim()).filter(Boolean).join(" vs ");
      return `Conflict to resolve: "${row.statement.trim()}"${parties ? ` — ${parties}` : ""}. As sponsor, which account stands, and what settles it?`;
    })
    .slice(0, 8);
}

const ADDRESSEE_STOP = new Set(["the", "and", "for", "our", "your", "their", "lead", "owner", "sme", "team", "staff", "head", "chief", "officer", "manager", "director", "specialist", "analyst", "coordinator", "representative"]);
/** Domain tokens of a role/name/addressee — lowercased, ≥3 chars, singularised
 * (so "practices" ~ "practice"), with the generic title words dropped so
 * "Sales SME" reduces to {sales} and routes on the domain it actually names. */
function domainTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? [])
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length >= 3 && !ADDRESSEE_STOP.has(token)));
}

/** The addressee a routed gap names — "Ask the Talent Acquisition SME: …" →
 * "Talent Acquisition SME", "Ask Priya — …" → "Priya". Null when the gap opens
 * some other way (it is then genuinely movement-wide). Capped to a short phrase
 * so a stray "Ask what the process is: …" isn't mistaken for an address. */
function askAddressee(ask: string): string | null {
  const match = ask.match(/^\s*ask\s+(?:the\s+)?([^:：—–-]{2,60}?)\s*[:：—–-]\s+/i);
  if (!match) return null;
  const who = match[1].trim();
  return who && who.split(/\s+/).length <= 6 ? who : null;
}

/** The gap with its "Ask <who>:" address removed — the card already identifies
 * the person, so the question reads as a question, not a routing instruction. */
export function stripAskAddressee(ask: string): string {
  const match = ask.match(/^\s*ask\s+(?:the\s+)?[^:：—–-]{2,60}?\s*[:：—–-]\s+(.*)$/is);
  if (!match) return ask;
  const rest = match[1].trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : ask;
}

interface RosterAudienceEntry { name: string; role: string; coverage?: Set<string> }
/** Does this addressee name this rostered person — by name, by the domain their
 * role names, or by the discovery-kit COVERAGE MAP domain they own? */
function personMatchesAddressee(addressee: string, person: RosterAudienceEntry): boolean {
  const addr = addressee.toLowerCase();
  const name = person.name.trim().toLowerCase();
  const first = name.split(/\s+/)[0] ?? "";
  if (name.length >= 3 && (addr.includes(name) || name.includes(addr))) return true;
  if (first.length >= 3 && addr.includes(first)) return true;
  const addrToks = domainTokens(addressee);
  if (!addrToks.size) return false;
  const roleToks = domainTokens(`${person.name} ${person.role}`);
  for (const token of addrToks) if (roleToks.has(token)) return true;
  // Coverage-map grounding: route on the domain the map says this person owns,
  // even when their role label doesn't spell it out.
  if (person.coverage) for (const token of addrToks) if (person.coverage.has(token)) return true;
  return false;
}

/**
 * Which rostered people an artifact ask is ADDRESSED to. A gap that names a
 * person ("Ask Dan: …") or a role ("Ask the Talent Acquisition SME: …") belongs
 * on THAT card only — putting it on everyone's script asks the Legal SME about
 * talent acquisition, which reads as noise and burns goodwill. Matching is by
 * the DOMAIN the address names (role tokens + coverage map), so "Ask the Sales
 * SME" reaches the sales voices even though no role is literally "Sales SME".
 * Returns the matched roster keys; empty means the ask names no one it can place
 * and stays movement-wide.
 */
function askAudience(ask: string, roster: RosterAudienceEntry[]): Set<string> {
  const matched = new Set<string>();
  const addressee = askAddressee(ask);
  if (addressee) {
    for (const person of roster) {
      if (personMatchesAddressee(addressee, person)) matched.add(person.name.trim().toLowerCase());
    }
    return matched;
  }
  // Unaddressed gap: route by (a) literal name/role containment, or (b) the
  // DOMAIN the gap's content names — its subject tokens overlapping the person's
  // role + coverage-map domain. So an atlas open question about "partner-
  // influenced opportunities" reaches the Alliances voice, and "sales-to-
  // delivery hand-off" reaches Sales and Delivery — not every SME's script.
  const text = ask.toLowerCase();
  const contentToks = domainTokens(ask);
  for (const person of roster) {
    const name = person.name.trim().toLowerCase();
    const role = person.role.trim().toLowerCase();
    const first = name.split(/\s+/)[0] ?? "";
    if ((name.length >= 3 && text.includes(name))
      || (first.length >= 3 && text.includes(first))
      || (role.length > 3 && text.includes(role))) {
      matched.add(name);
      continue;
    }
    const personToks = domainTokens(person.role);
    if (person.coverage) for (const token of person.coverage) personToks.add(token);
    for (const token of contentToks) { if (personToks.has(token)) { matched.add(name); break; } }
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
  // The routing roster is the interviewees ONLY — the sponsor is deliberately
  // left off. In Listen the sponsor arbitrates; they don't witness the process.
  // So a discovery ask that happens to name the sponsor should reach the people
  // who own the work (movement-wide), not sit on a sponsor script — and the
  // sponsor's own card carries only conflicts to resolve (sponsorConflictAsks).
  const sponsor = sponsorStakeholder(program);
  const sponsorFirst = sponsor ? sponsor.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "" : "";
  const isSponsorCard = (personName: string, personRole: string): boolean => {
    if (/executive sponsor/i.test(personRole)) return true;
    const first = personName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return sponsorFirst.length > 2 && first.length > 2 && first === sponsorFirst;
  };
  // Listen role bindings: a placeholder bound on its card ("our Recruitment
  // Operations lead is Maya") BECOMES that person here — the one place every
  // downstream reader (collect board, People page, approvals) derives from.
  const listenBindings = readRoleBindings(program, "listen");
  // DEFERRED questions: a respondent said "not me — ask X". Each routes ONLY
  // to its target's card (matched by name or role, either direction), and is
  // removed from everyone else's script — including the deferrer's.
  const deferrals = deferredAsks(program);
  const normAsk = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const deferralByAsk = new Map(deferrals.map((entry) => [normAsk(entry.question), entry.to.toLowerCase()]));
  const matchesTarget = (to: string, name: string, role: string): boolean => {
    const target = to.trim().toLowerCase();
    if (!target) return false;
    const personName = name.trim().toLowerCase();
    const personRole = role.trim().toLowerCase();
    return (personName.length > 2 && (target.includes(personName) || personName.includes(target)))
      || (personRole.length > 2 && (target.includes(personRole) || personRole.includes(target)));
  };
  const deferredFor = (name: string, role: string): string[] =>
    deferrals.filter((entry) => matchesTarget(entry.to, name, role)).map((entry) => entry.question);
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
      const token = String(value ?? "").trim().toLowerCase().replace(/\s*[—–−‑-]\s*tbc\s*$/i, "");
      if (token) covered.add(token);
    }
  }
  const personas = isRecord(kit) && Array.isArray(kit.personas) ? kit.personas.filter(isRecord) : [];
  // Operator-dismissed roles leave the cast everywhere: no card, no People
  // row, and a regeneration can't resurrect them.
  const dismissedRoles = dismissedListenRoles(program);
  const personaRoles = personas
    .filter((persona) => String(persona.kind ?? "internal") !== "external")
    // "Represented" only counts when the person who speaks for the role is
    // ACTUALLY being interviewed. A persona whose spokenForBy names someone with
    // no interview entry has nobody on the record — so it must still get its own
    // card, or the People page lists a role the Listen board never collects.
    .filter((persona) => {
      if (persona.unrepresented === true) return true;
      const spokenFor = Array.isArray(persona.spokenForBy)
        ? persona.spokenForBy.map(String).map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
      if (!spokenFor.length) return true;
      return !spokenFor.some((speaker) => covered.has(speaker));
    })
    .map((persona) => String(persona.name ?? "").trim())
    .filter((roleName) => roleName && !covered.has(roleName.toLowerCase()) && !dismissedRoles.has(roleName.toLowerCase()));
  // Coverage-map grounding: the discovery kit's coverage map assigns each
  // business DOMAIN to the people who cover it. Index the domain tokens per
  // person so a gap addressed to a domain ("Ask the Sales SME: …") routes to
  // whoever the map says owns Sales — even when their role label doesn't say it.
  const coverageRows = isRecord(kit) && Array.isArray(kit.coverageMap) ? kit.coverageMap.filter(isRecord) : [];
  const coverageTokensByPerson = new Map<string, Set<string>>();
  for (const row of coverageRows) {
    const domToks = domainTokens(String(row.domain ?? ""));
    if (!domToks.size) continue;
    const coveredBy = Array.isArray(row.coveredBy) ? row.coveredBy.map(String) : String(row.coveredBy ?? "").split(",");
    for (const raw of coveredBy) {
      const key = raw.trim().toLowerCase().replace(/\s*[—–−‑-]\s*tbc\s*$/i, "");
      if (!key) continue;
      const set = coverageTokensByPerson.get(key) ?? new Set<string>();
      for (const token of domToks) set.add(token);
      coverageTokensByPerson.set(key, set);
    }
  }
  const withCoverage = (name: string, role: string): RosterAudienceEntry =>
    ({ name, role, coverage: coverageTokensByPerson.get(name.trim().toLowerCase()) });
  const audienceRoster: RosterAudienceEntry[] = [
    ...interviews.map((interview) => withCoverage(String(interview.stakeholder ?? "").trim(), String(interview.role ?? "").trim())),
    ...personaRoles.map((roleName) => withCoverage(listenBindings[roleName]?.name ?? "", roleName)),
    // Sponsor intentionally excluded — see the note above: their discovery asks
    // fall through to the stakeholders who own the work.
  ];
  // With a coverage map we can ROUTE unaddressed gaps by domain, so an ask that
  // fits no one's domain is a movement-wide open question kept on the artifact —
  // not blanketed onto every SME's script. Without a map (early programmes, a
  // lone interviewee) there's no domain split, so an unplaceable gap still
  // reaches everyone rather than vanishing.
  const canRouteByDomain = audienceRoster.some((entry) => entry.coverage && entry.coverage.size > 0);
  const personaCards: MovementStakeholder[] = personaRoles.map((roleName, index) => {
    const bound = listenBindings[roleName];
    const name = bound?.name ?? "";
    const key = (name || roleName).toLowerCase();
    const myAsks = movementAsks.filter((ask) => {
      const to = deferralByAsk.get(normAsk(ask));
      if (to && !matchesTarget(to, name, roleName)) return false;
      const audience = askAudience(ask, audienceRoster);
      // Route to THIS card when the ask names or is about this person's domain.
      // An ask that fits nobody: kept on the artifact when we can route by
      // domain, else falls through to everyone.
      return audience.has(key) || audience.has(name.toLowerCase()) || (audience.size === 0 && !canRouteByDomain);
    }).map(stripAskAddressee);
    return {
      id: `persona-${index}`,
      name: name || roleName,
      role: roleName,
      questions: isSponsorCard(name, roleName)
        ? sponsorConflictAsks(program)
        : [...new Set([
          "Walk us through your part of the process — what do you pick up, from whom, and what do you hand off when you're done?",
          ...deferredFor(name, roleName),
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
    const tbc = /\s*[—–−‑-]\s*TBC\s*$/i.test(rawName);
    const roleLabel = String(interview.role ?? "").trim() || rawName.replace(/\s*[—–−‑-]\s*TBC\s*$/i, "").trim();
    const placeholder = !rawName || tbc;
    const bound = placeholder && roleLabel ? listenBindings[roleLabel] : undefined;
    const name = placeholder ? (bound?.name ?? "") : rawName;
    const key = name.toLowerCase();
    const isDeferredElsewhere = (ask: string): boolean => {
      const to = deferralByAsk.get(normAsk(ask));
      return !!to && !matchesTarget(to, name, roleLabel);
    };
    const myAsks = movementAsks.filter((ask) => {
      if (isDeferredElsewhere(ask)) return false;
      const audience = askAudience(ask, audienceRoster);
      // Only asks that name or fit this person's domain land on their script; an
      // ask that fits no one is kept on the artifact when we can route by domain,
      // else (no coverage map to split by) falls through to everyone.
      return audience.has(key) || (audience.size === 0 && !canRouteByDomain);
    }).map(stripAskAddressee);
    // Heard already? Their turns are on the record. If so, the follow-up is only
    // what is STILL OPEN (disagreements + artifact gaps) — not the original
    // agenda they've answered, which is what left it "not getting cleared".
    // Exact first-token equality matches ANY length (so "Jo" is heard when
    // "Jo, CEO" speaks); the fuzzy containment paths keep the 3-char floor.
    const heard = evidence.some((entry) => {
      const firstToken = entry.who.split(",")[0].trim().toLowerCase();
      if (firstToken && firstToken === key) return true;
      return key.length > 2 && (entry.who.toLowerCase().includes(key) || key.includes(firstToken));
    });
    const asks = name ? contradictionAsksFor(program, name) : [];
    const routedToMe = deferredFor(name, roleLabel);
    // Coverage-based "heard": if this person's business AREA is already modelled
    // on the Atlas — even when the captured evidence names no individual (a bulk
    // document, a whole-team transcript) — treat their planned agenda as
    // addressed. Their still-open items (contradictions, routed asks, area gaps)
    // remain below; only the discovery agenda clears, so we stop re-asking for
    // information the record already holds.
    const primaryArea = name || roleLabel ? stakeholderPrimaryArea(program, name || roleLabel, roleLabel) : "";
    const agendaAddressed = heard || (!!primaryArea && areaHasModel(program, primaryArea));
    // The sponsor's Listen card is arbiter-only: conflicts to resolve, nothing
    // else. The discovery agenda that would sit here reaches the process owners
    // through their own cards (the sponsor is off the routing roster).
    const questions = isSponsorCard(name, roleLabel)
      ? sponsorConflictAsks(program)
      : agendaAddressed
        ? [...new Set([...asks, ...routedToMe, ...myAsks])]
        : [...new Set([...asks, ...routedToMe, ...myAsks, ...agenda.filter((question) => !isDeferredElsewhere(question))])];
    return {
      id: `iv-${index}`, name: name || roleLabel || `Interviewee ${index + 1}`, role: roleLabel,
      questions, isRole: !name,
    };
  });
  // A dismissed role's placeholder card leaves the board too — but a NAMED
  // person is never dropped by a role dismissal (people outrank roles).
  return [...interviewCards, ...personaCards]
    .filter((card) => !(card.isRole && dismissedRoles.has(card.role.trim().toLowerCase())))
    // The sponsor is a Listen arbiter — their card exists ONLY to resolve
    // conflicts. With no open conflicts there's nothing to ask, so the card
    // shouldn't show at all (they're heard in Frame, not here).
    .filter((card) => !(isSponsorCard(card.name, card.role) && card.questions.length === 0));
}

export function sponsorStakeholder(program: ProgramSummary): MovementStakeholder | null {
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
      const key = name.toLowerCase().replace(/\s*[—–−‑-]\s*tbc\s*$/i, "").trim();
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

/** The base stakeholders a movement's OWN model produces (kit interviews, role
 * templates, the sponsor) — before operator-added people are folded in. */
function movementStakeholdersBase(program: ProgramSummary, movementId: string): MovementStakeholder[] {
  if (movementId === "frame") {
    // Frame's one voice is the sponsor — their conversation runs on the same
    // full-width collection card as every other stakeholder, with the meeting
    // kit's sponsor script as their questions.
    const kit = meetingKit(program, "frame");
    if (!kit || !kit.who.trim()) return [];
    // `questions` drives their status (empty ⇒ nothing outstanding). The LINK
    // agenda is always non-empty so "Copy link" mints a working confirmation
    // link even after the mandate is on record.
    return [{ id: "frame-sponsor", name: kit.who.trim(), role: "Executive Sponsor", questions: kit.questions,
      linkQuestions: kit.questions.length ? undefined : sponsorLinkQuestions(program), isRole: false }];
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
  // ENVISION is the delivery team's build studio: the Product Owner, Solution
  // Architect, Experience Designer and Data/Eng Lead design and BUILD the
  // prototype. Client owners are NOT engaged here — they validate the built
  // prototype in SHOW. So Envision's collect board is the delivery personas
  // (from ROLE_TEMPLATES), never the workflow owners.
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
 * Questions the OPERATOR raised for a specific stakeholder, from their collect
 * card — stored under the movement's inputs as `_operatorAsks` (underscore ⇒
 * fingerprint-safe: an operator question is a request, not captured evidence).
 * Keyed by the person's name, else their role, lowercased. These fold into that
 * person's link and script until they're answered or the operator removes them.
 */
export function readOperatorAsks(program: ProgramSummary, movementId: string): Record<string, string[]> {
  const raw = readMovementInputs(program, movementId)._operatorAsks;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const questions = value.map((entry) => String(entry).trim()).filter(Boolean);
      if (questions.length) out[key.trim().toLowerCase()] = questions;
    }
    return out;
  } catch { return {}; }
}
/** The operator's own questions for one stakeholder in a movement. */
export function operatorAsksFor(program: ProgramSummary, movementId: string, who: string): string[] {
  return readOperatorAsks(program, movementId)[who.trim().toLowerCase()] ?? [];
}

/**
 * People a respondent named as "who else should we speak with?" on their link —
 * stored fingerprint-safe under Listen's `_suggestedVoices`. Surfaced on the
 * People page for the operator to ADD (→ a real collection card) or dismiss;
 * anyone already on the programme drops off automatically.
 */
export interface SuggestedVoice { name: string; role: string; note?: string; from?: string; ts?: string }
export function readSuggestedVoices(program: ProgramSummary): SuggestedVoice[] {
  const raw = readMovementInputs(program, "listen")._suggestedVoices;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = knownPeopleNames(program);
    const dismissed = dismissedListenRoles(program);
    const seen = new Set<string>();
    return parsed.filter(isRecord).map((entry) => ({
      name: String(entry.name ?? "").trim(),
      role: String(entry.role ?? "").trim(),
      note: entry.note ? String(entry.note).trim() : undefined,
      from: entry.from ? String(entry.from).trim() : undefined,
      ts: entry.ts ? String(entry.ts) : undefined,
    })).filter((entry) => {
      const key = entry.name.toLowerCase();
      if (!entry.name || known.has(key) || dismissed.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch { return []; }
}

/** A movement-appropriate opening question for an operator-added person, so a
 * name dropped onto the People page becomes a real collection card rather than
 * a row that never gets asked anything. */
const DIRECTORY_OPENERS: Record<string, string> = {
  listen: "Walk us through your part of the process — what do you pick up, from whom, and what do you hand off when you're done?",
  envision: "For your part of this, what must be true — technically and operationally — for it to work, and where are the risks?",
  show: "Watch your part of the workflow run in the prototype — does it do what you described, and would you sign off on it?",
  ship: "What must hold in production for your area, and what would you need to see before go-live?",
  evolve: "In live operation, what's working in your area and what still needs attention?",
};

/** Operator-added people (People page → Add a person) as collection cards for
 * their movement — so everyone listed under People maps to a real collection
 * card. A directory role that matches a movement's template inherits that
 * template's questions; otherwise it gets the movement's opener. */
function directoryStakeholdersFor(program: ProgramSummary, movementId: string): MovementStakeholder[] {
  const opener = DIRECTORY_OPENERS[movementId];
  if (!opener) return [];
  const template = ROLE_TEMPLATES[movementId] ?? [];
  return readDirectoryPeople(program)
    .filter((person) => person.movementId === movementId && person.name.trim())
    .map((person, index) => {
      const templated = template.find((entry) => normRole(entry.role) === normRole(person.role));
      const asks = contradictionAsksFor(program, person.name);
      return {
        id: `dir-${movementId}-${index}`,
        name: person.name.trim(),
        role: person.role.trim() || "Contributor",
        questions: [...new Set([...(templated ? templated.questions : [opener]), ...asks])],
        isRole: false,
      };
    });
}

/**
 * The stakeholders a movement collects evidence from — the movement's own model
 * PLUS anyone the operator added to it on the People page, so every person under
 * People maps to a real collection card. Dedup keeps a directory person who is
 * already a roster voice from listing twice.
 */
export function resolveMovementStakeholders(program: ProgramSummary, movementId: string): MovementStakeholder[] {
  const base = movementStakeholdersBase(program, movementId);
  const directory = directoryStakeholdersFor(program, movementId);
  if (!directory.length) return base;
  const seen = new Set(base.map((s) => s.name.trim().toLowerCase()).filter(Boolean));
  return [...base, ...directory.filter((s) => !seen.has(s.name.trim().toLowerCase()))];
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

  // Interview + approval packs follow the person too: a rename must not
  // orphan their standing links or drop their recorded verdicts from the
  // per-stakeholder rollup (which matches by name).
  const nextInterviewPacks = Array.isArray(inner.flowInterviewPacks)
    ? (inner.flowInterviewPacks as unknown[]).map((pack) =>
        isRecord(pack) && eq(pack.stakeholder) ? (touched = true, { ...pack, stakeholder: to }) : pack)
    : undefined;
  const nextApprovalPacks = Array.isArray(inner.flowApprovalPacks)
    ? (inner.flowApprovalPacks as unknown[]).map((pack) => {
        if (!isRecord(pack) || !isRecord(pack.approver) || !eq((pack.approver as Record<string, unknown>).name)) return pack;
        touched = true;
        return { ...pack, approver: { ...(pack.approver as Record<string, unknown>), name: to } };
      })
    : undefined;

  if (!touched) return null;

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    ...(kit ? { discoveryKit: kit } : {}),
    ...(nextInterviewPacks ? { flowInterviewPacks: nextInterviewPacks } : {}),
    ...(nextApprovalPacks ? { flowApprovalPacks: nextApprovalPacks } : {}),
    phaseInputs,
    flowAttestations: [...log, {
      ts: new Date().toISOString(), agentId: actor, phaseId: "listen", tier: 2,
      action: `Person renamed — ${from} → ${to}`,
      detail: "roster, contact binding, links and approval packs updated; historical evidence keeps the original attribution",
    }].slice(-200),
  }, usesNestedData);
}
