/**
 * The Collect stage's status board — a movement's discovery, organized by
 * stakeholder. One card per person or role: their script, their link/meeting
 * channels, their captured evidence, a capture box — followed until they've
 * been heard. Driven by resolveMovementStakeholders, so it serves every
 * movement.
 */
import { useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import { flowMovements, movementEvidence, evidenceStamp, locateQuote, parseGridRows, readMovementInputs } from "@/v3/components/flow/flowShellData";
import { buildMeetingIcs, mailtoLink, stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { resolveMovementStakeholders, readRoleBindings, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { AttachFileButton, TranscribeButton, copyTextFromAction } from "@/v3/components/flow/flowCapture";

/** A movement's discovery, organized by stakeholder. One card per person or
 * role: their script, their link/meeting channels, their captured evidence, a
 * capture box — followed until they've been heard. Driven by
 * resolveMovementStakeholders, so it serves every movement. */
/** Derive a stakeholder's collection status, their live link pack, and the
 * evidence attributed to them — the single source of truth for the status
 * board grouping and each card. */
export function stakeholderCollection(
  movementId: string,
  stakeholder: MovementStakeholder,
  packs: ReturnType<typeof listInterviewPacks>,
  evidence: ReturnType<typeof movementEvidence>,
) {
  const key = stakeholder.name.toLowerCase();
  const pack = [...packs].reverse().find((p) => String(p.stakeholder ?? "").trim().toLowerCase() === key
    && (movementId === "listen" ? (!p.movementId || p.movementId === "listen") : p.movementId === movementId));
  // Their evidence: attributed voice blocks, PLUS documents they provided
  // (document entries carry the provider in their meta, not in `who`).
  const mine = (key.length > 2 ? evidence.filter((e) =>
    e.who.toLowerCase().includes(key)
    || key.includes(e.who.split(",")[0].trim().toLowerCase())
    || (e.kind === "document" && e.meta.toLowerCase().includes(key))) : [])
    // Newest first — the latest response leads the trail.
    .slice().sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
  const heard = mine.length > 0 || Boolean(pack?.respondedAt);
  const status: "heard" | "waiting" | "toreach" = heard ? "heard" : pack ? "waiting" : "toreach";
  return { key, pack, mine, heard, status };
}
type StakeholderCollection = ReturnType<typeof stakeholderCollection>;

const COLLECT_COLUMNS: Array<{ key: "heard" | "waiting" | "toreach"; label: string }> = [
  { key: "heard", label: "Heard" },
  { key: "waiting", label: "Awaiting response" },
  { key: "toreach", label: "To reach" },
];

/** The movement's stakeholder data collection as a STATUS BOARD: cards grouped
 * into columns by collection state (Heard · Awaiting · To reach), each card the
 * person's quote, dated feedback trail (click → transcript), follow-ups,
 * meeting, and link channels. Driven by resolveMovementStakeholders. */
export function IntervieweeDiscovery({ program, movementId, captureField, docsStale, onRegenerateStale, onSaveInputs, onMintFollowUp, onMintPacks, onScheduleFollowUp, onFocusPerson, onCaptured }: {
  program: ProgramSummary;
  movementId: string;
  captureField: string;
  /** A required document trails the evidence — cards offer the regenerate
   * instead of re-asking "still open" items that may already be answered. */
  docsStale?: boolean;
  onRegenerateStale?: () => Promise<void>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  onMintPacks?: () => Promise<void>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  /** A card opened or closed — the record rail follows the person you're in. */
  onFocusPerson?: (stakeholderId: string, open: boolean) => void;
  onCaptured?: () => void;
}) {
  const stakeholders = resolveMovementStakeholders(program, movementId);
  const movement = flowMovements().find((m) => m.id === movementId);
  const evidence = movement ? movementEvidence(program, movement) : [];
  const packs = listInterviewPacks(program);
  const [mintBusy, setMintBusy] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  if (!stakeholders.length) return null;
  const evaluated = stakeholders.map((s) => ({ s, coll: stakeholderCollection(movementId, s, packs, evidence) }));
  const heardCount = evaluated.filter((e) => e.coll.status === "heard").length;
  const word = movementId === "show" ? "reviewed" : movementId === "listen" || movementId === "frame" ? "heard" : "consulted";
  const columns = COLLECT_COLUMNS
    .map((c) => ({ ...c, items: evaluated.filter((e) => e.coll.status === c.key) }))
    .filter((c) => c.items.length);
  const toggleAll = () => {
    const next = !allCollapsed;
    boardRef.current?.querySelectorAll("details.v3fs-ivc").forEach((node) => { (node as HTMLDetailsElement).open = !next; });
    setAllCollapsed(next);
  };
  return (
    <div className="v3fs-ch-collect">
      <div className="v3fs-collect-h">
        <div className="v3fs-colh ev">Stakeholder data collection</div>
        <span className="v3fs-collect-count"
          title={movementId === "listen"
            ? "Counted from collected evidence and responded links. The gate's coverage ledger is separate — voices are attested heard or waived in the roster."
            : "Counted from collected evidence and responded links."}>
          {heardCount} of {stakeholders.length} {word}
        </span>
        <div className="v3fs-collect-tools">
          {movementId === "listen" && onMintPacks ? (
            <button type="button" className="v3fs-btn" disabled={mintBusy}
              onClick={async () => { setMintBusy(true); try { await onMintPacks(); } finally { setMintBusy(false); } }}>
              {packs.length ? "↺ Refresh & add links" : "✳ Create everyone's link"}
            </button>
          ) : null}
          {stakeholders.length > 1 ? (
            <button type="button" className="v3fs-btn quiet" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
          ) : null}
        </div>
      </div>
      <div className="v3fs-collect-board" ref={boardRef}>
        {columns.map((col) => (
          <div key={col.key} className="v3fs-collect-col">
            <div className="v3fs-collect-col-h"><span className={`v3fs-cdot ${col.key}`} aria-hidden="true" />{col.label}<span className="v3fs-cn">{col.items.length}</span></div>
            {col.items.map(({ s, coll }) => (
              <IntervieweeCard key={s.id} program={program} movementId={movementId} stakeholder={s} captureField={captureField}
                coll={coll} solo={stakeholders.length === 1} docsStale={docsStale} onRegenerateStale={onRegenerateStale}
                onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp} onScheduleFollowUp={onScheduleFollowUp}
                onFocusPerson={onFocusPerson} onCaptured={onCaptured} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntervieweeCard({ program, movementId, stakeholder, captureField, coll, solo, docsStale, onRegenerateStale, onSaveInputs, onMintFollowUp, onScheduleFollowUp, onFocusPerson, onCaptured }: {
  program: ProgramSummary;
  movementId: string;
  stakeholder: MovementStakeholder;
  captureField: string;
  coll: StakeholderCollection;
  /** The board's only person (Frame's sponsor): their card IS the board, so
   * it opens by default. On a roster board the tiles stay closed for scanning. */
  solo?: boolean;
  /** A required document trails the evidence — answered "still open" items
   * only clear when it regenerates, so the card offers the regenerate instead
   * of re-asking what may already be answered. */
  docsStale?: boolean;
  onRegenerateStale?: () => Promise<void>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  /** Put the meeting on the programme calendar (attested) — the .ics download
   * is the invite; this is the record of it. */
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onFocusPerson?: (stakeholderId: string, open: boolean) => void;
  onCaptured?: () => void;
}) {
  const { name, role, questions, isRole } = stakeholder;
  const { pack, heard, status } = coll;
  const first = name.split(" ")[0] || "they";
  const email = stakeholderEmail(program, name);
  // Role binding: the first-class place to say "our Solution Architect is
  // Priya, priya@…". Saved under `_roleBindings` (fingerprint-safe), so the
  // placeholder becomes a person without flagging any document stale.
  const [bindName, setBindName] = useState("");
  const [bindEmail, setBindEmail] = useState("");
  const [bindBusy, setBindBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  // A named person with no address: the operator adds it right on the card.
  // Stored as a name-keyed role binding — stakeholderEmail resolves bindings
  // by the bound NAME, so every sender and the gate's "emails on file"
  // criterion pick it up without touching the generated kit document.
  const saveEmail = async () => {
    const address = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return;
    setEmailBusy(true);
    try {
      const bindings = readRoleBindings(program, movementId);
      bindings[name] = { name, email: address };
      await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
        attest: { action: `Email on file — ${name}`, detail: address },
      });
      setEmailDraft("");
    } finally { setEmailBusy(false); }
  };
  // The link exists the moment a card needs one: opening a card with a
  // script and no link mints it silently, so the operator only ever COPIES.
  const autoMinted = useRef(false);
  const autoMintOnOpen = (isOpen: boolean) => {
    if (!isOpen || autoMinted.current) return;
    if (effectiveLink || !questions.length || !onMintFollowUp) return;
    if (heard && docsStale) return; // channels are hidden — regenerate first
    autoMinted.current = true;
    void ensureLink();
  };
  // A dispute the operator judges settled (the newer account stands) resolves
  // right here — same log flip as the Library panel, attested, and the row
  // leaves every script on the next derivation.
  const resolveDisputeRow = async (disputed: string) => {
    const rows = parseGridRows(readMovementInputs(program, "listen").contradictionLog);
    const day = new Date().toISOString().slice(0, 10);
    const next = rows.map((row) => {
      const stmt = String(row.statement ?? "").trim();
      return stmt === disputed || stmt.startsWith(disputed) ? { ...row, status: `Resolved — ${day}` } : row;
    });
    setResolveBusy(disputed);
    try {
      await onSaveInputs("listen", { contradictionLog: JSON.stringify(next) },
        { attest: { action: "Resolved a contradiction", detail: disputed.slice(0, 140) } });
    } finally { setResolveBusy(null); }
  };
  const saveBinding = async () => {
    const person = bindName.trim();
    if (!person) return;
    setBindBusy(true);
    try {
      const bindings = readRoleBindings(program, movementId);
      const emailValue = bindEmail.trim();
      bindings[role] = emailValue ? { name: person, email: emailValue } : { name: person };
      await onSaveInputs(movementId, { _roleBindings: JSON.stringify(bindings) }, {
        attest: { action: `Role bound — ${role} → ${person}`, detail: emailValue || undefined },
      });
      setBindName("");
      setBindEmail("");
    } finally { setBindBusy(false); }
  };
  // A minted link is only "the" link while its questions still match the
  // current script — when the script has moved on, the old link goes stale and
  // Copy/Send mint a fresh pack (which supersedes the unanswered one).
  const packMatches = !!pack && (Array.isArray(pack.questions) ? pack.questions.map(String).join(" ") : "")
    === questions.slice(0, 8).join(" ");
  const statusLabel = heard ? "Heard" : pack ? (packMatches ? "Link sent" : "Link outdated") : "To reach";
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [evFor, setEvFor] = useState<StakeholderCollection["mine"][number] | null>(null);
  // Passage to highlight when the reader opens from a contradiction question.
  const [evHighlight, setEvHighlight] = useState<string | null>(null);
  // The copy action can't rely on the clipboard (embedded contexts deny it
  // silently) — the link is ALWAYS shown inline after minting; the clipboard
  // write is best-effort and the tick reports whether it landed.
  const [linkShown, setLinkShown] = useState<string | null>(null);
  const [copiedTick, setCopiedTick] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [inviteTick, setInviteTick] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const effectiveLink = (pack && packMatches ? portalLinkFor(program.id, pack) : null) ?? mintedLink;

  const ensureLink = async (): Promise<string | null> => {
    if (effectiveLink) return effectiveLink;
    if (!onMintFollowUp || !questions.length) {
      setLinkNote(questions.length ? "Links aren't available here." : "Nothing to ask yet — the script is empty.");
      return null;
    }
    setLinkBusy(true);
    try {
      const link = await onMintFollowUp({ movementId, who: name, questions, captureField });
      if (link) setMintedLink(link);
      else setLinkNote("Could not create the link — try again.");
      return link;
    } catch {
      setLinkNote("Could not create the link — try again.");
      return null;
    } finally { setLinkBusy(false); }
  };
  const copyLink = async () => {
    setLinkNote(null);
    // One click does both: the clipboard is claimed inside the gesture and
    // the minted link lands in it when ready — never "create, then copy".
    const link = await copyTextFromAction(ensureLink);
    if (!link) return;
    setLinkShown(link);
    setCopiedTick(true);
    window.setTimeout(() => setCopiedTick(false), 2400);
  };
  const sendLink = async () => { if (!email) return; const link = await ensureLink(); if (link) window.location.href = mailtoLink(email, { stakeholder: name, programmeName: program.name, link }); };

  const save = async () => {
    const text = capture.trim();
    if (!text) return;
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const phase = flowMovements().find((m) => m.id === movementId);
      const phaseId = movementId;
      void phase;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const header = `— ${[name, role, evidenceStamp()].filter(Boolean).join(", ")} —`;
      await onSaveInputs(phaseId, { [captureField]: [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n") },
        { attest: { action: `Captured — ${name}` } });
      setCapture("");
      onCaptured?.();
    } finally { setBusy(false); }
  };

  // An attached file is EVIDENCE the moment it lands: saved as a document
  // block in the person's name — canonical header + [source:] pointer — so the
  // Library lists it and the original stays downloadable. No manual step.
  // A MEETING TRANSCRIPT goes further: detected speakers are auto-mapped to
  // the movement's roster and each matched person gets their turns as their
  // OWN attributed block — everyone in the room is heard, not just this card.
  const saveAttachedDoc = async (filename: string, text: string, sourceKey?: string) => {
    const docTitle = filename.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const day = evidenceStamp();
      const docBlock = `— Document: ${docTitle}, provided by ${name}, ${day} —\n${sourceKey ? `[source: ${sourceKey}]\n` : ""}${text}`;
      const roster = resolveMovementStakeholders(program, movementId).map((s) => ({ name: s.name, role: s.role }));
      const mapping = mapTranscriptSpeakers(text, roster);
      const speakerBlocks = (mapping?.blocks ?? []).map((b) =>
        `— ${[b.name, b.role, day].filter(Boolean).join(", ")} —\n${b.text}`);
      const attestDetail = mapping
        ? `provided by ${name} · speakers mapped: ${mapping.matched.join(", ") || "none"}${mapping.unmatched.length ? ` · unmatched: ${mapping.unmatched.join(", ")}` : ""}`
        : `provided by ${name}`;
      await onSaveInputs(movementId,
        { [captureField]: [existing.trimEnd(), docBlock, ...speakerBlocks].filter(Boolean).join("\n\n") },
        { attest: { action: mapping?.blocks.length ? `Transcript mapped — ${docTitle}` : `Document added — ${docTitle}`, detail: attestDetail } });
      onCaptured?.();
    } finally { setBusy(false); }
  };
  return (
    <>
      <details className={`v3fs-ivc ${status}`} open={solo && !heard}
        onToggle={(event) => {
          const isOpen = (event.currentTarget as HTMLDetailsElement).open;
          onFocusPerson?.(stakeholder.id, isOpen);
          autoMintOnOpen(isOpen);
        }}>
        <span className="v3fs-ivc-strip" aria-hidden="true" />
        <summary>
          {/* Status-toned initials — the person reads as a person at a glance. */}
          <span className={`v3fs-ivc-av ${status}`} aria-hidden="true">
            {(name || "?").split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?"}
          </span>
          <span className="v3fs-ivc-who">{name || "Stakeholder"}{role && role !== name ? <span>{role}</span> : null}</span>
          <span className={`v3fs-ivc-st ${status}`}>{statusLabel}</span>
          {!isRole && !email ? <span className="v3fs-ivc-noaddr" title="No email on file — open the card to add it">✉ no address</span> : null}
          <span className="v3fs-ivc-chev" aria-hidden="true" />
        </summary>
        <div className="v3fs-ivc-b">
          {/* A role placeholder invites its person: bind a name (and email)
              and the card becomes theirs — link, invite and captures follow. */}
          {isRole ? (
            <div className="v3fs-ivc-sec v3fs-ivc-bind">
              <div className="v3fs-ivc-sec-h">Who is this?</div>
              <div className="v3fs-ivc-bind-row">
                <input value={bindName} onChange={(event) => setBindName(event.target.value)}
                  placeholder={`Name — who is your ${role}?`} aria-label={`Name the ${role}`} />
                <input value={bindEmail} onChange={(event) => setBindEmail(event.target.value)}
                  placeholder="email (optional)" type="email" aria-label={`Email for the ${role}`} />
                <button type="button" className="v3fs-btn pri" disabled={bindBusy || !bindName.trim()}
                  onClick={() => void saveBinding()}>{bindBusy ? "Binding…" : "Bind"}</button>
              </div>
              <span className="v3fs-ivc-sec-note">Names the {role.toLowerCase()} — their link, meeting invite and captures follow the person from here on.</span>
            </div>
          ) : null}
          {/* A named person with NO address: say so, and take it here — the
              gate's "emails on file" criterion and every send follow it. */}
          {!isRole && !email ? (
            <div className="v3fs-ivc-sec v3fs-ivc-bind">
              <div className="v3fs-ivc-sec-h">No email on file</div>
              <div className="v3fs-ivc-bind-row">
                <input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)}
                  placeholder={`Email for ${name}`} type="email" aria-label={`Email for ${name}`} />
                <button type="button" className="v3fs-btn pri" disabled={emailBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.trim())}
                  onClick={() => void saveEmail()}>{emailBusy ? "Saving…" : "Save address"}</button>
              </div>
              <span className="v3fs-ivc-sec-note">The link can still be copied without it — but email sends, meeting invites and the gate&rsquo;s &ldquo;emails on file&rdquo; criterion need an address. Saved to the record, attested.</span>
            </div>
          ) : null}
          {/* The person's feedback trail lives on the RECORD RAIL — opening
              this card focuses the rail on them, so the card keeps only the
              work: their script, the channels, and the capture box. */}

          {/* Follow-up questions / their script. A question born from a
              contradiction carries its receipts: the disputed passage links
              straight into the evidence reader, highlighted, so the operator
              (or the stakeholder on a call) reviews the source before judging. */}
          {heard && docsStale ? (
            // Their answers are ON THE RECORD but the documents haven't read
            // them yet — re-asking "still open" items now would re-ask what may
            // already be answered. The regenerate IS the next step; whatever
            // remains open afterwards returns as a fresh follow-up script.
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">Answers on the record</div>
              <div className="v3fs-ivc-regen">
                <p>{first}&rsquo;s answers haven&rsquo;t been read into the documents yet — regenerate first; anything still open returns here as a fresh script.</p>
                {onRegenerateStale ? (
                  <button type="button" className="v3fs-btn pri" disabled={regenBusy} onClick={async () => {
                    setRegenBusy(true);
                    try { await onRegenerateStale(); } finally { setRegenBusy(false); }
                  }}>{regenBusy ? "Regenerating…" : "↻ Regenerate the documents"}</button>
                ) : null}
              </div>
            </div>
          ) : questions.length ? (
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Still open — ask on the next round" : "Their script"}
                {heard ? <span className="v3fs-ivc-sec-note">these are unresolved gaps &amp; disputes; they clear when the artifact is regenerated or the dispute resolved</span> : null}</div>
              <ul className="v3fs-ivc-q">{questions.map((q, i) => {
                const disputed = q.match(/disagree[^"]*"(.{8,140}?)"/i)?.[1];
                const source = disputed
                  ? flowMovements().flatMap((m) => movementEvidence(program, m)).find((entry) => entry.text && locateQuote(entry.text, disputed))
                  : undefined;
                return (
                  <li key={i}>
                    {q}
                    {source ? (
                      <button type="button" className="v3fs-a v3fs-ivc-evlink" title={`Said by ${source.who} — read the passage in the source`}
                        onClick={() => { setEvHighlight(disputed ?? null); setEvFor(source); }}>
                        ⤷ review evidence
                      </button>
                    ) : null}
                    {disputed ? (
                      <button type="button" className="v3fs-a v3fs-ivc-evlink" disabled={resolveBusy === disputed}
                        title="Already answered — mark the dispute resolved (attested); it leaves the scripts"
                        onClick={() => void resolveDisputeRow(disputed)}>
                        {resolveBusy === disputed ? "Resolving…" : "✓ mark resolved"}
                      </button>
                    ) : null}
                  </li>
                );
              })}</ul>
            </div>
          ) : null}

          {/* Meeting + link channels. Not-yet-heard people get "Reach out";
              heard people KEEP the same three channels as "Follow up" whenever
              the kit still has questions for them (it swaps in the gap-driven
              follow-up script once a conversation is on record) — so the Frame
              sponsor's single card never strands the operator without a send
              button, and every movement's card behaves identically. */}
          {(!heard || questions.length) && !(heard && docsStale) ? (
            // While answers await regeneration the channels HIDE: sending a
            // link or booking a meeting now would re-ask a stale script. The
            // regenerate notice above is the only door until the record reads.
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Follow up" : "Reach out"}</div>
              {/* Three ways in, no standing form: copy the link, email the
                  link, or send a meeting invite — the date picker lives INSIDE
                  the invite action, asked for only when it's needed. */}
              <div className="v3fs-ivc-ch">
                <button type="button" className={`v3fs-btn${email ? "" : " pri"}`} disabled={linkBusy} onClick={() => void copyLink()}>
                  {linkBusy && !email ? "…" : copiedTick ? "Copied ✓" : effectiveLink ? "⎘ Copy link" : "⎘ Create & copy link"}
                </button>
                {/* The live URL sits beside the button whenever one EXISTS —
                    derived from the persisted pack, so it survives the card
                    remounting when minting moves it across status columns. */}
                {(effectiveLink ?? linkShown) ? (
                  <span className="v3fs-ivc-linkrow">
                    <input readOnly value={effectiveLink ?? linkShown ?? ""} onFocus={(event) => event.currentTarget.select()}
                      aria-label={`Response link for ${name}`} />
                    {copiedTick ? <span className="v3fs-ivc-linkok">✓</span> : null}
                  </span>
                ) : null}
                {email ? (
                  <button type="button" className="v3fs-btn pri" disabled={linkBusy} title={`Opens a draft to ${email}`} onClick={() => void sendLink()}>✉ Send link</button>
                ) : null}
                <button type="button" className="v3fs-btn" title={`Pick a date — schedules the meeting and downloads the invite for ${name}`}
                  onClick={() => {
                    const picker = dateRef.current;
                    if (!picker) return;
                    if ("showPicker" in picker) { try { (picker as HTMLInputElement & { showPicker: () => void }).showPicker(); return; } catch { /* fall through */ } }
                    picker.focus(); picker.click();
                  }}>🗓 Send meeting invite</button>
                <input ref={dateRef} type="date" className="v3fs-ivc-date-hidden" tabIndex={-1} aria-label={`Meeting date for ${name}`}
                  value={date}
                  onChange={(e) => {
                    const picked = e.target.value;
                    setDate(picked);
                    if (!picked) return;
                    // Two halves of one action: the meeting goes ON THE
                    // PROGRAMME CALENDAR (attested, visible in Today), and the
                    // .ics downloads as the stakeholder's invite.
                    void onScheduleFollowUp?.(movementId, name, picked);
                    const ics = buildMeetingIcs({ who: name, email, date: picked, programmeName: program.name, intro: "", questions });
                    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `${movementId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                    setInviteTick(`Scheduled for ${picked}${onScheduleFollowUp ? " — on the programme calendar" : ""}; the invite downloaded — open it to send.`);
                    window.setTimeout(() => setInviteTick(null), 6000);
                  }} />
              </div>
              {linkNote ? <div className="v3fs-ivc-note warn">{linkNote}</div> : null}
              {inviteTick ? <div className="v3fs-ivc-note ok">🗓 {inviteTick}</div> : null}
            </div>
          ) : null}

          {/* Capture what they said — typed, or spoken and transcribed. */}
          <div className="v3fs-ivc-cap">
            <textarea rows={2} value={capture} onChange={(e) => setCapture(e.target.value)}
              placeholder={`What ${first} said — attribution added for you`} aria-label={`Capture ${name}'s input`} />
            <div className="v3fs-ivc-cap-row">
              <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
                {busy ? "Saving…" : "Capture"}
              </button>
              <TranscribeButton onText={(transcript) => setCapture((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
              <AttachFileButton programId={program.id}
                onExtracted={(filename, text, sourceKey) => void saveAttachedDoc(filename, text, sourceKey)} />
            </div>
          </div>
        </div>
      </details>
      {evFor ? <EvidenceReader entry={evFor} highlight={evHighlight ?? undefined} onClose={() => { setEvFor(null); setEvHighlight(null); }} /> : null}
    </>
  );
}
