/**
 * The meeting kit — if the input is a conversation, hand the user the
 * conversation: who to sit with, the script to run (derived from missing
 * facts and generated agendas), and capture right where the script is.
 * Open by default when the conversation hasn't happened; a quiet one-line
 * summary once it has.
 */
import { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { buildMeetingIcs, mailtoLink, stakeholderEmail, type MeetingKit } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, listDemoInvites, portalLinkFor, visibleLinks } from "@/v3/components/flow/flowPortal";
import { listFlowTracks } from "@/v3/components/flow/flowTracks";
import { AttachFileButton, TranscribeButton } from "@/v3/components/flow/flowCapture";

export default function MeetingKitCard({ kit, movementId, hasEvidence, program, docsStale, onRegenerateStale, onSaveInputs, onScheduleFollowUp, onMintFollowUp, onMintPacks, onMintDemoInvites, onCaptured }: {
  kit: MeetingKit | null;
  movementId: string;
  hasEvidence: boolean;
  /** Mint Listen's response links from the Discovery Kit. */
  onMintPacks?: () => Promise<void>;
  /** Mint Show's demo links from the Demo Scripts. */
  onMintDemoInvites?: () => Promise<void>;
  /** Fired after a capture lands — Show wires the contradiction watcher here. */
  onCaptured?: () => void;
  /** A movement document trails the evidence — answered gaps fall off this
   * script only when the documents regenerate. */
  docsStale?: boolean;
  /** Regenerate this movement's stale documents (the kit offers it in place
   * of a stale follow-up script). */
  onRegenerateStale?: () => Promise<void>;
  program: ProgramSummary;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
}) {
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [copied, setCopied] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const [scheduledTick, setScheduledTick] = useState(false);
  const [linkTick, setLinkTick] = useState(false);
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docSourceKey, setDocSourceKey] = useState<string | null>(null);
  const [docTick, setDocTick] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [fileContradiction, setFileContradiction] = useState(false);
  // Show captures attribute their track: default to the track that demos to
  // this stakeholder; "programme-wide" stays available for cross-track sessions.
  const trackNames = useMemo(
    () => (movementId === "show" ? listFlowTracks(program).map((track) => ({ name: track.name, lead: (track.leadStakeholder ?? "").toLowerCase() })) : []),
    [movementId, program],
  );
  const [trackSel, setTrackSel] = useState<string>(() => {
    const who = (kit?.who ?? "").toLowerCase();
    return trackNames.find((track) => track.lead && who.includes(track.lead))?.name ?? "";
  });
  const [resolveIdx, setResolveIdx] = useState<Set<number>>(() => new Set());
  // Open contradictions — offered as "this answer settles it" checkboxes on
  // the SPONSOR's capture (Frame): the sponsor arbitrates, the row resolves.
  const openContradictions = useMemo(() => {
    if (movementId !== "frame") return [] as Array<{ index: number; statement: string }>;
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
      ? ((inner.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
      : {};
    let rows: Array<Record<string, string>> = [];
    try {
      const parsed = JSON.parse(typeof bucket.contradictionLog === "string" ? bucket.contradictionLog : "[]");
      if (Array.isArray(parsed)) rows = parsed.filter((row) => row && typeof row === "object");
    } catch { rows = []; }
    return rows.map((row, index) => ({ index, statement: String(row.statement ?? ""), open: /open/i.test(String(row.status ?? "")) }))
      .filter((row) => row.open && row.statement)
      .map(({ index, statement }) => ({ index, statement }));
  }, [movementId, program.rawData]);

  // "Attach" on a referenced document: land in the ingest form with the
  // name prefilled — the capture area is where evidence arrives.
  const attachDocument = (name: string) => {
    setDocName(name);
    setDocOpen(true);
  };

  if (!kit) {
    return hasEvidence ? null : (
      <div className="v3fs-kit v3fs-kit-ghost">
        Generate the previous step’s document first — this conversation’s script is built from it.
      </div>
    );
  }

  const save = async () => {
    const text = capture.trim();
    if (!text) return;
    setBusy(true);
    try {
      const existing = (program.rawData && typeof program.rawData === "object"
        ? (() => {
            const raw = program.rawData as Record<string, unknown>;
            const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
            const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
              ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] ?? {}
              : {};
            const value = bucket[kit.captureField];
            return typeof value === "string" ? value : "";
          })()
        : "");
      const taggedHeader = movementId === "show" && trackSel
        ? kit.header.replace("Demo session", `Demo session (${trackSel})`)
        : kit.header;
      const block = taggedHeader ? `${taggedHeader}\n${text}` : text;
      const next = kit.header
        ? [existing.trimEnd(), block].filter(Boolean).join("\n\n")
        : text; // single-line refs (go/no-go) replace rather than append
      // Contradictions the sponsor's answer settles flip to Resolved in
      // Listen's log — a second write (conflict-rebase absorbs it), each row
      // naming the arbiter and pointing at the transcript.
      let resolvedRows: string | null = null;
      let resolvedCount = 0;
      if (resolveIdx.size && movementId === "frame") {
        const raw2 = (program.rawData ?? {}) as Record<string, unknown>;
        const inner2 = typeof raw2.data === "object" && raw2.data !== null ? (raw2.data as Record<string, unknown>) : raw2;
        const bucket2 = typeof inner2.phaseInputs === "object" && inner2.phaseInputs !== null
          ? ((inner2.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
          : {};
        try {
          const rows = JSON.parse(typeof bucket2.contradictionLog === "string" ? bucket2.contradictionLog : "[]");
          if (Array.isArray(rows)) {
            for (const index of resolveIdx) {
              if (rows[index] && typeof rows[index] === "object") {
                // The complete resolution: what was decided (the answer, in
                // the arbiter's words), who settled it, and when — the row
                // becomes the record, not a pointer to one.
                rows[index].status = "Resolved";
                rows[index].resolution = text.replace(/\s+/g, " ").slice(0, 200);
                rows[index].resolvedBy = kit.who;
                rows[index].resolvedAt = new Date().toISOString().slice(0, 10);
                resolvedCount += 1;
              }
            }
            if (resolvedCount) resolvedRows = JSON.stringify(rows);
          }
        } catch { /* malformed log — leave it untouched */ }
      }
      await onSaveInputs(movementId, { [kit.captureField]: next }, {
        attest: {
          action: `Evidence captured — ${kit.who}${resolvedCount ? ` · ${resolvedCount} contradiction${resolvedCount === 1 ? "" : "s"} settled` : ""}`,
          detail: text.replace(/\s+/g, " ").slice(0, 140),
        },
      });
      if (resolvedRows) {
        await onSaveInputs("listen", { contradictionLog: resolvedRows }, {
          attest: { action: `Contradictions resolved — arbitrated by ${kit.who}`, detail: `${resolvedCount} row${resolvedCount === 1 ? "" : "s"} settled` },
        });
      }
      setResolveIdx(new Set());
      // Demo feedback that disputes the record routes UPSTREAM too: an open
      // contradiction lands in Listen's log, so Listen's gate re-asks the
      // question and its documents re-derive from the corrected record.
      if (fileContradiction && movementId === "show") {
        const raw = (program.rawData ?? {}) as Record<string, unknown>;
        const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
        const listenBucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
          ? ((inner.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
          : {};
        let rows: Array<Record<string, string>> = [];
        try {
          const parsed = JSON.parse(typeof listenBucket.contradictionLog === "string" ? listenBucket.contradictionLog : "[]");
          if (Array.isArray(parsed)) rows = parsed.filter((row) => row && typeof row === "object");
        } catch { rows = []; }
        const statement = text.replace(/\s+/g, " ").slice(0, 110);
        rows.push({
          statement,
          between: `${kit.who} (demo session) vs the record`,
          positions: "Filed from Show feedback — see the demo session transcript",
          status: `Open — filed ${new Date().toISOString().slice(0, 10)}`,
        });
        await onSaveInputs("listen", { contradictionLog: JSON.stringify(rows) }, {
          attest: { action: `Contradiction filed to Listen — from ${kit.who}'s demo feedback`, detail: statement },
        });
        setFileContradiction(false);
      }
      // The system reads what just arrived: fire-and-forget watcher pass.
      onCaptured?.();
      setCapture("");
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  // Documents referenced in the conversation are evidence too — ingested
  // beside the transcript under their own attributed header, so every
  // generator reads them with the same grounding.
  const saveDoc = async () => {
    const name = docName.trim();
    const text = docText.trim();
    if (!name || !text) return;
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
        ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] ?? {}
        : {};
      const existing = typeof bucket[kit.captureField] === "string" ? bucket[kit.captureField] as string : "";
      const block = `— Document: ${name}, provided by ${kit.who}, ${new Date().toISOString().slice(0, 10)} —\n${docSourceKey ? `[source: ${docSourceKey}]\n` : ""}${text}`;
      await onSaveInputs(movementId, { [kit.captureField]: [existing.trimEnd(), block].filter(Boolean).join("\n\n") }, {
        attest: { action: `Document added — ${name}`, detail: `provided by ${kit.who}` },
      });
      setDocName("");
      setDocText("");
      setDocSourceKey(null);
      setDocTick(true);
      onCaptured?.();
      window.setTimeout(() => setDocTick(false), 2200);
    } finally { setBusy(false); }
  };

  const copyScript = async () => {
    const script = [`${kit.title} — ${kit.who}`, kit.purpose, "", ...kit.questions.map((q, i) => `${i + 1}. ${q}`)].join("\n");
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { window.prompt("Copy the script:", script); }
  };

  const schedule = async () => {
    if (!onScheduleFollowUp || !followDate) return;
    setBusy(true);
    try {
      await onScheduleFollowUp(movementId, kit.who, followDate);
      setFollowDate("");
      setScheduledTick(true);
      window.setTimeout(() => setScheduledTick(false), 2200);
    } finally { setBusy(false); }
  };

  // Minting is implicit: Copy/Send create the link if none is live yet.
  const mintLink = async (): Promise<string | null> => {
    if (!onMintFollowUp) return null;
    setBusy(true);
    try {
      return await onMintFollowUp({ movementId, who: kit.who, questions: kit.questions, captureField: kit.captureField });
    } finally { setBusy(false); }
  };
  const copyMintedLink = async () => {
    const link = await mintLink();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch { window.prompt("Copy the follow-up link:", link); }
    setLinkTick(true);
    window.setTimeout(() => setLinkTick(false), 2200);
  };
  const sendMintedLink = async (email: string) => {
    const link = await mintLink();
    if (!link) return;
    window.location.href = mailtoLink(email, { stakeholder: kit.who, programmeName: program.name, link });
  };

  return (
    <details className={`v3fs-kit${kit.followUp ? " v3fs-kit-fu" : ""}`} open={!kit.done && !hasEvidence}>
      <summary>
        <span className={`v3fs-st ${kit.followUp ? "stale" : kit.done ? "ok" : "none"}`} />
        <span className="v3fs-kit-t">
          {kit.title}
          <span className="v3fs-kit-who">{kit.who}{kit.followUp ? ` · ${kit.gaps.length} gap${kit.gaps.length === 1 ? "" : "s"} to close` : kit.done ? " · on record" : ""}</span>
        </span>
        <span className="v3fs-disc-c" aria-hidden="true" />
      </summary>
      <div className="v3fs-kit-b">
        <p className="v3fs-kit-p">{kit.purpose}</p>
        {kit.followUp && docsStale ? (
          <div className="v3fs-kit-regen">
            <p>
              New answers are on the record — the artifacts haven&rsquo;t read them yet, so this
              script would re-ask questions that may already be answered. Regenerate first;
              a fresh script builds from whatever remains open.
            </p>
            {onRegenerateStale ? (
              <button type="button" className="v3fs-btn pri" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await onRegenerateStale(); } finally { setBusy(false); }
              }}>{busy ? "Regenerating…" : "↻ Regenerate artifacts"}</button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="v3fs-kit-cap">Interview script — {kit.who}</div>
            <ol className="v3fs-kit-qs">
              {kit.questions.map((question, index) => <li key={index}>{question}</li>)}
            </ol>
            <div className="v3fs-kit-actions">
              <button type="button" className="v3fs-btn pri" onClick={() => void copyScript()}>
                {copied ? "Copied ✓" : "Copy the script"}
              </button>
            </div>
          </>
        )}
        {kit.documents.length ? (
          <div className="v3fs-script-docs">
            <div className="v3fs-script-docs-cap">Referenced documents</div>
            {kit.documents.map((name) => (
              <div key={name} className="v3fs-script-doc">
                <span className="v3fs-script-doc-n">{name}</span>
                <button type="button" className="v3fs-btn" onClick={() => attachDocument(name)}>
                  Attach
                </button>
              </div>
            ))}
            <p className="v3fs-script-docs-note">Attach it and it becomes evidence beside the conversation, with its source noted.</p>
          </div>
        ) : null}
        {(() => {
          // ONE list of links per movement: Listen owns the discovery packs,
          // Show adds its demo invites, every movement carries its own
          // follow-ups. Each row offers exactly one send action — email when
          // the address is on file, copy otherwise.
          const packRows = visibleLinks(listInterviewPacks(program).filter((pack) =>
            movementId === "listen" ? (!pack.movementId || pack.movementId === "listen") : pack.movementId === movementId,
          )).map((pack) => {
            // A link whose questions no longer match the current script is
            // OUTDATED — say so, and point at the refresh that re-mints it.
            const isKitPerson = pack.stakeholder.trim().toLowerCase() === kit.who.trim().toLowerCase() && pack.role !== "Follow-up";
            const outdated = isKitPerson && pack.questions.map(String).join(" ") !== kit.questions.slice(0, 8).map(String).join(" ");
            return {
              id: pack.id, who: pack.stakeholder, responded: Boolean(pack.respondedAt),
              meta: pack.respondedAt ? "responded"
                : outdated ? "script changed — refresh links to re-mint"
                : `${pack.role === "Follow-up" ? "follow-up · " : ""}${pack.questions.length} question${pack.questions.length === 1 ? "" : "s"} · waiting`,
              link: portalLinkFor(program.id, pack),
            };
          });
          const inviteRows = movementId === "show" ? listDemoInvites(program).map((invite) => ({
            id: invite.id, who: invite.stakeholder, responded: Boolean(invite.respondedAt),
            meta: invite.respondedAt ? "verdict received" : "demo · waiting for their verdict",
            link: portalLinkFor(program.id, invite),
          })) : [];
          // Responded links drop off — their answers are captured and live in
          // the Library; a "responded" row here is just clutter.
          const rows = [...inviteRows, ...packRows].filter((row) => !row.responded);
          const canMintPacks = movementId === "listen" && onMintPacks;
          const canMintInvites = movementId === "show" && onMintDemoInvites;
          if (!(onScheduleFollowUp || onMintFollowUp || canMintPacks || canMintInvites || rows.length)) return null;
          return (
          <>
            <div className="v3fs-kit-cap">Channels</div>
            <div className="v3fs-kit-ch">
              {onScheduleFollowUp && !(kit.followUp && docsStale) ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Meeting<span>Book it — the invite carries the script as its agenda</span></div>
                  <div className="v3fs-kit-chan-a">
                    <input type="date" value={followDate} onChange={(event) => setFollowDate(event.target.value)} aria-label="Follow-up date" />
                    <button type="button" className="v3fs-btn pri" disabled={busy || !followDate} onClick={() => void schedule()}>
                      {scheduledTick ? "Scheduled ✓" : "Schedule"}
                    </button>
                    <button type="button" className="v3fs-btn" disabled={!followDate}
                      title={stakeholderEmail(program, kit.who) ? `Attendee: ${stakeholderEmail(program, kit.who)}` : "No email on file — the invite downloads without an attendee"}
                      onClick={() => {
                        const ics = buildMeetingIcs({
                          who: kit.who, email: stakeholderEmail(program, kit.who), date: followDate,
                          programmeName: program.name, intro: kit.purpose, questions: kit.questions,
                        });
                        const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = `discovery-${kit.who.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                      }}>⤓ Invite (.ics)</button>
                  </div>
                </div>
              ) : null}
              {(onMintFollowUp && kit.questions.length > 0) || canMintPacks || canMintInvites || rows.length ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Links<span>ATOS asks for you — answers arrive in the Inbox, attributed</span></div>
                  {rows.length ? (
                    <div className="v3fs-kit-links">
                      {rows.map((row) => {
                        const email = row.responded ? null : stakeholderEmail(program, row.who);
                        return (
                          <div key={row.id} className="v3fs-async-row">
                            <span className={`v3fs-st ${row.responded ? "ok" : "none"}`} />
                            <div className="v3fs-async-who">
                              {row.who}
                              <span>{row.meta}</span>
                            </div>
                            {row.responded ? null : (
                              <span className="v3fs-async-cta">
                                <button type="button" className={`v3fs-btn${email ? "" : " pri"}`}
                                  onClick={() => { void navigator.clipboard.writeText(row.link).catch(() => window.prompt("Copy the link:", row.link)); }}>
                                  Copy link
                                </button>
                                {email ? (
                                  <button type="button" className="v3fs-btn pri" title={`Opens a draft to ${email} with the link inside`}
                                    onClick={() => { window.location.href = mailtoLink(email, { stakeholder: row.who, programmeName: program.name, link: row.link }); }}>
                                    ✉ Send link
                                  </button>
                                ) : null}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="v3fs-kit-chan-a">
                    {canMintPacks ? (
                      <button type="button" className="v3fs-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onMintPacks!(); } finally { setBusy(false); } }}>
                        {rows.length ? "↺ Refresh & add response links" : "✳ Create response links"}
                      </button>
                    ) : null}
                    {canMintInvites ? (
                      <button type="button" className="v3fs-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onMintDemoInvites!(); } finally { setBusy(false); } }}>
                        {inviteRows.length ? "↺ Demo links for new stakeholders" : "✳ Create demo links"}
                      </button>
                    ) : null}
                    {onMintFollowUp && kit.questions.length > 0 && (!kit.followUp || !docsStale) && !rows.some((row) => !row.responded && row.who.trim().toLowerCase() === kit.who.trim().toLowerCase()) ? (
                      <>
                        <button type="button" className={`v3fs-btn${stakeholderEmail(program, kit.who) ? "" : " pri"}`} disabled={busy} onClick={() => void copyMintedLink()}>
                          {linkTick ? "Link copied ✓" : "Copy link"}
                        </button>
                        {stakeholderEmail(program, kit.who) ? (
                          <button type="button" className="v3fs-btn pri" disabled={busy}
                            title={`Opens a draft to ${stakeholderEmail(program, kit.who)} with the link inside`}
                            onClick={() => void sendMintedLink(stakeholderEmail(program, kit.who)!)}>
                            ✉ Send link
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </>
          );
        })()}
        <div className="v3fs-kit-cap">What came back</div>
        <div className="v3fs-kit-capture">
          <textarea
            rows={3}
            placeholder={kit.header ? `${kit.captureLabel} — attribution added for you (${kit.header})` : kit.captureLabel}
            value={capture}
            onChange={(event) => setCapture(event.target.value)}
            aria-label={kit.captureLabel}
          />
          <TranscribeButton onText={(transcript) => setCapture((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
          {movementId === "show" && trackNames.length ? (
            <label className="v3fs-kit-track">
              <span>Track</span>
              <select value={trackSel} onChange={(event) => setTrackSel(event.target.value)} aria-label="Which track was demonstrated">
                <option value="">Programme-wide</option>
                {trackNames.map((track) => <option key={track.name} value={track.name}>{track.name}</option>)}
              </select>
            </label>
          ) : null}
          {openContradictions.length ? (
            <div className="v3fs-kit-resolves">
              {openContradictions.map(({ index, statement }) => (
                <label key={index} className="v3fs-kit-flag">
                  <input
                    type="checkbox"
                    checked={resolveIdx.has(index)}
                    onChange={(event) => setResolveIdx((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(index); else next.delete(index);
                      return next;
                    })}
                  />
                  <span>This answer settles: “{statement.slice(0, 90)}”</span>
                </label>
              ))}
            </div>
          ) : null}
          {movementId === "show" ? (
            <label className="v3fs-kit-flag">
              <input
                type="checkbox"
                checked={fileContradiction}
                onChange={(event) => setFileContradiction(event.target.checked)}
              />
              <span>This contradicts earlier evidence — also log it as an open contradiction in Listen</span>
            </label>
          ) : null}
          <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : savedTick ? "Captured ✓" : "Capture"}
          </button>
          <details className="v3fs-kit-doc" open={docOpen} onToggle={(event) => setDocOpen(event.currentTarget.open)}>
            <summary>＋ Add a referenced document</summary>
            <div className="v3fs-kit-docrow">
              <input value={docName} onChange={(event) => setDocName(event.target.value)}
                placeholder="Document name (e.g. Q2 pricing export)" aria-label="Document name" />
              <AttachFileButton programId={program.id} onExtracted={(filename, text, sourceKey) => {
                if (!docName.trim()) setDocName(filename.replace(/\.[^.]+$/, ""));
                if (sourceKey) setDocSourceKey(sourceKey);
                setDocText((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text));
              }} />
              <textarea rows={2} value={docText} onChange={(event) => setDocText(event.target.value)}
                placeholder="Paste its content — or attach the file above; review before adding." aria-label="Document content" />
              <button type="button" className="v3fs-btn" disabled={busy || !docName.trim() || !docText.trim()}
                onClick={() => void saveDoc()}>
                {docTick ? "Added ✓" : "Add the document"}
              </button>
            </div>
          </details>
        </div>
      </div>
    </details>
  );
}
