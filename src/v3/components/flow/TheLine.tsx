/**
 * The Line — the production-line home view, mounted BESIDE the classic Flow
 * chrome as a flag-gated sibling (appbar toggle · `?ui=line` · localStorage).
 *
 * A projection with exactly three write affordances, every one of them the
 * classic chrome's own handler passed through untouched:
 *   - the Discovery Kit matrix (coverage edits via onSaveInputs),
 *   - the capture dialog (attributed evidence appended via onSaveInputs,
 *     byte-identical to the classic collection card's format),
 *   - per-person durable links (onMintFollowUp — which RETURNS the URL, so
 *     mint-and-copy is one click with no stale-closure read-back).
 * One write path, two skins: the chromes can run at the same time and can
 * never disagree, because there is nothing here to disagree with.
 */
import { Suspense, lazy, useMemo, useState, type ComponentProps } from "react";
import type { ProgramSummary } from "@/new/types";
import { buildLineModel, LINE_GLYPHS, type LineBand, type LineStation } from "@/v3/lib/lineModel";
import {
  evidenceStamp, flowMovements, movementEvidence, readMovementInputs, stakeholderEmail,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";
import { resolveMovementStakeholders, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { listenCoverageAreas, listenAreaCoverage } from "@/v3/components/flow/listenCoverage";
import { canonicalFrameArea, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { buildMeetingIcs, meetingKit, sponsorLinkQuestions } from "@/v3/components/flow/flowMeetings";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import "./theLine.css";

const FlowArtifactStudio = lazy(() => import("./studio/FlowArtifactStudio"));
const EvidenceReader = lazy(() => import("./EvidenceReader"));

type KitAlignProps = ComponentProps<typeof DiscoveryKitAlign>;

/** FlowShell's full save signature — wider than the Kit matrix's (it carries
 * `attest`, which the capture write uses); still assignable to the matrix's
 * narrower prop by parameter contravariance. */
type SaveInputsFn = (phaseId: string, inputs: Record<string, string>,
  opts?: { silent?: boolean; attest?: { action: string; detail?: string }; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;

interface CastRow {
  label: string;
  role: string;
  isRole: boolean;
  /** Which movement this voice is collected FOR — frame pre-Kit (the sponsor
   * is the starting voice), listen once the Kit casts the roster. Routes the
   * capture write and the link mint to the right conversation field. */
  movementId: "frame" | "listen";
  captureField: string;
  area: string;
  heard: boolean;
  awaiting: boolean;      // link out, nothing back yet
  questions: string[];
  stakeholder: MovementStakeholder;
}

interface TheLineProps {
  program: ProgramSummary;
  /** Classic write handlers, passed through untouched. All optional — omitted
   * (e.g. a future sponsor lens) the Line renders fully read-only. */
  onSaveInputs?: SaveInputsFn;
  onRenamePerson?: KitAlignProps["onRenamePerson"];
  onRenameRole?: KitAlignProps["onRenameRole"];
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}

const MATURITY_WORDS = ["not seeded", "provisional", "grounded", "reviewed", "approved"] as const;

function Segments({ station }: { station: LineStation }) {
  if (!station.perArea) return null;
  // A pill per area is legible up to a handful of lanes; past that the
  // initials collide and the strip reads as noise, so it collapses into a
  // maturity meter with the counts spelled out.
  if (station.perArea.length <= 8) {
    return (
      <div className="v3ln-seg" aria-label={`${station.title} — maturity per area`}>
        {station.perArea.map((seg) => (
          <span key={seg.area} className={`v3ln-sg m${seg.maturity}`}
            title={`${seg.area} · ${LINE_GLYPHS[seg.maturity]} ${MATURITY_WORDS[seg.maturity]}`}>
            {seg.maturity > 0 ? seg.initials : ""}
          </span>
        ))}
      </div>
    );
  }
  const buckets = [4, 3, 2, 1, 0]
    .map((m) => ({ m, areas: station.perArea!.filter((seg) => seg.maturity === m) }))
    .filter((bucket) => bucket.areas.length > 0);
  return (
    <div className="v3ln-seg-sum" aria-label={`${station.title} — maturity across ${station.perArea.length} areas`}>
      <span className="v3ln-meter" aria-hidden="true">
        {buckets.map((bucket) => (
          <span key={bucket.m} className={`v3ln-mt m${bucket.m}`}
            style={{ flexGrow: bucket.areas.length }}
            title={`${MATURITY_WORDS[bucket.m]} — ${bucket.areas.map((seg) => seg.area).join(", ")}`} />
        ))}
      </span>
      <span className="v3ln-seg-cap">
        {station.perArea.length} areas · {buckets.map((bucket) => `${bucket.areas.length} ${MATURITY_WORDS[bucket.m]}`).join(" · ")}
      </span>
    </div>
  );
}

function Station({ station, onOpen }: { station: LineStation; onOpen: (card: ArtifactCardModel) => void }) {
  const openable = !!station.card?.present;
  return (
    <button type="button" className="v3ln-stn" disabled={!openable}
      title={openable ? `Open ${station.title}` : `${station.title} — not seeded yet`}
      onClick={() => { if (station.card) onOpen(station.card); }}>
      <span className="v3ln-stn-h">
        {!station.perArea ? (
          <span className={`v3ln-g m${station.maturity}`} aria-hidden="true">{LINE_GLYPHS[station.maturity]}</span>
        ) : null}
        <span className="v3ln-stn-n">{station.title}</span>
        {station.needsRefresh ? <span className="v3ln-rf">needs refresh ↻</span> : null}
      </span>
      {station.subtitle ? <span className="v3ln-stn-sub">{station.subtitle}</span> : null}
      <Segments station={station} />
    </button>
  );
}

function GateSheet({ band, onClose }: { band: LineBand; onClose: () => void }) {
  return (
    <>
      <div className="v3ln-gate-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label={`${band.name} gate criteria`}>
        <div className="v3ln-gate-h">
          <h3>{band.name} — the gate, item by item</h3>
          <button type="button" className="v3ln-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {band.gate.length === 0 ? (
          <p className="v3ln-gate-empty">No criteria yet — this gate seeds with the movement.</p>
        ) : (
          <ul className="v3ln-crit">
            {band.gate.map((item, index) => (
              <li key={index} className={item.advisory ? "adv" : undefined}>
                <span className={`v3ln-tick ${item.done ? "d" : "o"}`} aria-hidden="true">{item.done ? "✓" : "…"}</span>
                <span className="v3ln-crit-b">
                  {item.label}
                  {item.why ? <em>{item.why}</em> : null}
                  {item.advisory ? <em>advisory — informs, never gates</em> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="v3ln-gate-f">Frame, Listen and the Loop close themselves when every criterion is met. Ship and Evolve stay deliberate decisions.</p>
      </div>
    </>
  );
}

/** Same matching classic uses: newest pack whose stakeholder name matches,
 * scoped to Listen (durable kit links carry no movementId). */
function packFor(program: ProgramSummary, who: string, movementId: "frame" | "listen") {
  const key = who.trim().toLowerCase();
  return [...listInterviewPacks(program)].reverse().find((pack) =>
    pack.stakeholder.trim().toLowerCase() === key
    && (movementId === "listen" ? (!pack.movementId || pack.movementId === "listen") : pack.movementId === movementId));
}

export default function TheLine({ program, onSaveInputs, onRenamePerson, onRenameRole, onMintFollowUp, onScheduleFollowUp, onRunAgent }: TheLineProps) {
  const model = useMemo(() => buildLineModel(program), [program]);
  const [gateFor, setGateFor] = useState<LineBand | null>(null);
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // Two projections of the one record: the WORK board (where the programme
  // is) and DISCOVERY (who it runs through — links, capture, invites; named
  // to match the classic chrome's Discovery tab). The surface itself stays
  // load-bearing past Listen — the same people carry demo verdicts and
  // sign-offs later, and they land here.
  const [tab, setTab] = useState<"work" | "discovery" | "record">("work");
  const [reading, setReading] = useState<EvidenceEntry | null>(null);
  // Discover's area filter — narrows the roster to one lane ("" = all).
  const [areaFilter, setAreaFilter] = useState<string>("");

  // ── the cast: the Listen roster with area, heard state and their questions.
  // Pre-Kit, the roster IS the sponsor: a new programme's Discover tab opens on
  // the Executive Sponsor (named from Frame, else a placeholder whose script
  // and link exist before the name does — a thread waiting).
  const cast = useMemo<CastRow[]>(() => {
    const movements = flowMovements();
    const packs = listInterviewPacks(program);
    const kitAreas = listenCoverageAreas(program).map((area) => area.label);
    const coverage = listenAreaCoverage(program);
    const rows = (movementId: "frame" | "listen", captureField: string, people: MovementStakeholder[]): CastRow[] => {
      const movement = movements.find((m) => m.id === movementId);
      const evidence = movement ? movementEvidence(program, movement) : [];
      return people.map((stakeholder) => {
        const label = stakeholder.name || stakeholder.role;
        const col = stakeholderCollection(movementId, stakeholder, packs, evidence);
        const covered = coverage.find((row) =>
          row.roles.some((who) => who.trim().toLowerCase() === label.trim().toLowerCase()));
        const area = covered?.area
          ?? canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, stakeholder.name ?? "", stakeholder.role));
        return {
          label, role: stakeholder.role, isRole: stakeholder.isRole, movementId, captureField, area,
          heard: col.heard, awaiting: !col.heard && !!col.pack,
          questions: stakeholder.linkQuestions ?? stakeholder.questions,
          stakeholder,
        };
      });
    };
    const listenRows = rows("listen", "interviewTranscripts", resolveMovementStakeholders(program, "listen"));
    if (listenRows.length) return listenRows;
    const kit = meetingKit(program, "frame");
    const captureField = kit?.captureField ?? "sponsorConversation";
    const framePeople = resolveMovementStakeholders(program, "frame");
    if (framePeople.length) return rows("frame", captureField, framePeople);
    // No sponsor named yet — the placeholder starts the thread anyway.
    const script = kit?.questions.length ? kit.questions : sponsorLinkQuestions(program);
    return rows("frame", captureField, [{
      id: "frame-sponsor", name: "", role: "Executive Sponsor",
      questions: script, isRole: true,
    } as MovementStakeholder]);
  }, [program]);

  // Distinct areas actually present on the roster, kit order preserved by
  // first appearance; the filter narrows without ever hiding its own option.
  const castAreas = useMemo(() => {
    const seen: string[] = [];
    for (const row of cast) if (!seen.includes(row.area)) seen.push(row.area);
    return seen;
  }, [cast]);
  const filteredCast = areaFilter && castAreas.includes(areaFilter)
    ? cast.filter((row) => row.area === areaFilter)
    : cast;

  // ── the record: every attributed evidence entry across the spine, newest
  // first, each mapped to its speaker's area so the Record projection can
  // group and filter the same way the roster does.
  const record = useMemo(() => {
    const areaOf = new Map(cast.map((row) => [row.label.trim().toLowerCase(), row.area]));
    const kitAreas = listenCoverageAreas(program).map((area) => area.label);
    // Leadership is ONE lane on the record — the sponsor's frame conversation
    // and every executive-titled voice merge under a single label (the
    // roster's client-facing title when it has one, else the frame role) —
    // never folded into a delivery area.
    const exec = (s?: string) => !!s && /\bexecutive\b/i.test(s);
    const frameVoices = resolveMovementStakeholders(program, "frame");
    const rosterExec = cast.find((row) => exec(row.role) || exec(row.label));
    const leadLane = (rosterExec && (exec(rosterExec.role) ? rosterExec.role : rosterExec.label))
      || frameVoices[0]?.role.trim()
      || "Executive Sponsor";
    const sponsorKeys = new Set<string>();
    for (const voice of frameVoices) {
      for (const key of [voice.name, voice.role]) {
        if (key?.trim()) sponsorKeys.add(key.trim().toLowerCase());
      }
    }
    return flowMovements()
      .flatMap((movement) => movementEvidence(program, movement))
      .map((entry) => {
        // "Name, Role, stamp" — voices off the roster still resolve to an
        // area the same way roster rows do.
        const parts = entry.who.split(",");
        const name = parts[0].trim();
        const role = (parts[1] ?? "").trim();
        const isLeadership = exec(role) || exec(name)
          || sponsorKeys.has(name.toLowerCase()) || sponsorKeys.has(role.toLowerCase())
          || entry.movementId === "frame";
        const area = (isLeadership ? leadLane : undefined)
          ?? areaOf.get(name.toLowerCase())
          ?? canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, name, role));
        return { entry, name, area: area ?? "" };
      })
      .sort((a, b) => (b.entry.capturedAt ?? "").localeCompare(a.entry.capturedAt ?? ""));
  }, [program, cast]);
  // The Record's filterable lanes: every area that actually holds entries —
  // roster areas in kit order, then off-roster lanes (the sponsor's included)
  // by first appearance.
  const recordAreas = useMemo(() => {
    const order = castAreas.filter((area) => record.some((r) => r.area === area));
    for (const r of record) if (r.area && !order.includes(r.area)) order.push(r.area);
    return order;
  }, [record, castAreas]);
  const recordGroups = useMemo(() => {
    const order: string[] = [...recordAreas];
    if (record.some((r) => !r.area)) order.push("");
    const groups = order.map((area) => ({ area, items: record.filter((r) => r.area === area) }));
    return areaFilter && recordAreas.includes(areaFilter)
      ? groups.filter((g) => g.area === areaFilter)
      : groups;
  }, [record, recordAreas, areaFilter]);

  // ── per-person link: existing pack's URL, else mint (returns the URL).
  // The URL ALWAYS renders inline; the clipboard is best-effort on top —
  // embedded previews and iframes deny clipboards silently, and a button
  // that only writes to a denied clipboard reads as broken.
  const [linkShown, setLinkShown] = useState<{ who: string; url: string } | null>(null);
  const [qOpen, setQOpen] = useState<Record<string, boolean>>({});
  const copyLink = async (row: CastRow) => {
    try {
      const existing = packFor(program, row.label, row.movementId);
      let url = existing ? portalLinkFor(program.id, existing) : null;
      if (!url && onMintFollowUp) {
        url = await onMintFollowUp({
          movementId: row.movementId, who: row.label, questions: row.questions,
          captureField: row.captureField, unnamed: row.isRole,
        });
      }
      if (!url) { setNote(`No link handler available for ${row.label} in this view.`); return; }
      setLinkShown({ who: row.label, url });
      setQOpen((s) => ({ ...s, [row.label]: true }));
      try {
        await navigator.clipboard.writeText(url);
        setNote(`Link copied — ${row.label}. It's also shown below their row.`);
      } catch {
        setNote(`Link ready — copy it from the field under ${row.label}'s row.`);
      }
      window.setTimeout(() => setNote(null), 6000);
    } catch (error) {
      setNote(`Couldn't create the link: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => setNote(null), 8000);
    }
  };

  const copyShown = async () => {
    if (!linkShown) return;
    try {
      await navigator.clipboard.writeText(linkShown.url);
      setNote(`Link copied — ${linkShown.who}.`);
    } catch {
      setNote("The clipboard is blocked here — select the link text and copy it manually.");
    }
    window.setTimeout(() => setNote(null), 5000);
  };

  // ── meeting invite: a VISIBLE inline date bar (hidden-input showPicker()
  // throws in embedded/iframe contexts, which read as a dead button), then
  // schedule the follow-up and download the .ics — classic's two halves.
  const [invitee, setInvitee] = useState<CastRow | null>(null);
  const [inviteDate, setInviteDate] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const pickDate = (row: CastRow) => {
    setInvitee((current) => (current?.label === row.label ? null : row));
    setInviteDate("");
  };
  const confirmInvite = async () => {
    if (!inviteDate || !invitee) return;
    try {
      await onScheduleFollowUp?.(invitee.movementId, invitee.label, inviteDate);
      const ics = buildMeetingIcs({
        who: invitee.label, email: stakeholderEmail(program, invitee.label), date: inviteDate,
        programmeName: program.name, questions: invitee.questions,
      });
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${invitee.movementId}-${invitee.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
      a.click(); URL.revokeObjectURL(url);
      setNote(`Invite downloaded · follow-up scheduled — ${invitee.label}, ${inviteDate}`);
    } catch (error) {
      setNote(`Couldn't schedule: ${error instanceof Error ? error.message : String(error)}`);
    }
    setInvitee(null); setInviteDate("");
    window.setTimeout(() => setNote(null), 6000);
  };

  // ── capture: append attributed evidence, byte-identical to classic.
  const [capFor, setCapFor] = useState<CastRow | "open" | null>(null);
  const [capWho, setCapWho] = useState<string>("");
  const [capText, setCapText] = useState("");
  const openCapture = (row?: CastRow) => {
    setCapFor(row ?? "open");
    setCapWho(row?.label ?? cast[0]?.label ?? "");
    setCapText("");
  };
  const saveCapture = async () => {
    const row = cast.find((r) => r.label === capWho);
    const text = capText.trim();
    if (!row || !text || !onSaveInputs) return;
    const existing = String(readMovementInputs(program, row.movementId)[row.captureField] ?? "");
    const header = `— ${[row.isRole ? row.role : row.label, row.isRole ? "" : row.role, evidenceStamp()].filter(Boolean).join(", ")} —`;
    const appended = [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n");
    await onSaveInputs(row.movementId, { [row.captureField]: appended }, { attest: { action: `Captured — ${row.label}` } });
    onRunAgent?.("contradiction-detector", row.movementId);
    setCapFor(null); setCapText("");
    setNote(row.movementId === "listen"
      ? `Captured — ${row.label}. The Ontology and Atlas will refresh for ${row.area}.`
      : `Captured — ${row.label}. The Charter and Discovery Kit will refresh.`);
    window.setTimeout(() => setNote(null), 6000);
  };

  return (
    <div className="v3ln">
      <div className="v3ln-tabs" role="tablist" aria-label="Line projections">
        <button type="button" role="tab" aria-selected={tab === "work"}
          className={tab === "work" ? "on" : undefined} onClick={() => setTab("work")}>
          Work<span>the board — bands, stations, gates</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "discovery"}
          className={tab === "discovery" ? "on" : undefined} onClick={() => setTab("discovery")}>
          Discover<span>the people — links, capture, invites</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "record"}
          className={tab === "record" ? "on" : undefined} onClick={() => setTab("record")}>
          Record<span>who said what, when — by area</span>
        </button>
      </div>

      {tab === "work" ? (
        <div className="v3ln-stats">
          <div><span className="v3ln-sl">Round</span><span className="v3ln-sv">{model.round}</span></div>
          <div><span className="v3ln-sl">Converged</span><span className="v3ln-sv">{model.stats.converged} of {model.stats.areasTotal} areas</span></div>
          <button type="button" className="v3ln-statbtn" onClick={() => setTab("discovery")}
            title="Open Discover — who has been heard, who is waiting">
            <span className="v3ln-sl">Voices heard</span><span className="v3ln-sv">{model.stats.heardTotal > 0 ? `${model.stats.heardDone} of ${model.stats.heardTotal}` : "—"}</span>
          </button>
          <div><span className="v3ln-sl">Needs refresh</span><span className={`v3ln-sv${model.stats.refresh > 0 ? " acc" : ""}`}>{model.stats.refresh > 0 ? `${model.stats.refresh} station${model.stats.refresh === 1 ? "" : "s"}` : "—"}</span></div>
        </div>
      ) : null}

      {note ? <div className="v3ln-toast" role="status">{note}</div> : null}

      {tab === "work" ? <div className="v3ln-spine">{model.bands.map((band, bi) => (
        <div key={band.id} className="v3ln-spine-row">
        <span className="v3ln-rail-n" aria-hidden="true">{String(bi + 1).padStart(2, "0")}</span>
        <section className={`v3ln-band${band.id === "loop" ? " loop" : ""}`} aria-label={band.name}>
          <header className="v3ln-band-h spine">
            <span className="v3ln-band-n">{band.name}</span>
            {band.half ? <span className="v3ln-half">{band.half}</span> : null}
            <span className="v3ln-scope">{band.scope}</span>
            <span className="v3ln-band-sp" />
            <button type="button" className={`v3ln-chip ${band.chip.tone}`}
              onClick={() => setGateFor(band)}
              title={`Open the ${band.name} gate's criteria`}>
              {band.chip.text}<span className="v3ln-chev" aria-hidden="true">›</span>
            </button>
          </header>
          {band.intake ? (
            <div className="v3ln-intake"><span>evidence in</span>{band.intake}
              {band.id === "listen" && onSaveInputs && cast.length > 0 ? (
                <button type="button" className="v3ln-a" onClick={() => openCapture()}>＋ add to the record</button>
              ) : null}
            </div>
          ) : null}
          <div className={`v3ln-stns n${band.stations.length}`}>
            {band.stations.map((s) => <Station key={s.id} station={s} onOpen={setDocFor} />)}
          </div>
        </section>
        </div>
      ))}</div> : null}

      {tab === "discovery" && cast.length > 0 ? (
        <section className="v3ln-band" aria-label="Discover">
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">Discover</span>
            {cast[0]?.movementId === "frame" ? (
              <span className="v3ln-scope">the sponsor is the starting voice — the Kit casts the rest</span>
            ) : null}
            <span className="v3ln-band-sp" />
            {castAreas.length > 1 ? (
              <label className="v3ln-filter">
                <span>Area</span>
                <select value={castAreas.includes(areaFilter) ? areaFilter : ""}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  aria-label="Filter the roster by area">
                  <option value="">All areas · {cast.length}</option>
                  {castAreas.map((area) => (
                    <option key={area} value={area}>{area} · {cast.filter((r) => r.area === area).length}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="v3ln-scope">{filteredCast.filter((r) => r.heard).length} of {filteredCast.length} heard{areaFilter && castAreas.includes(areaFilter) ? ` in ${areaFilter}` : ""}</span>
            {onSaveInputs ? (
              <button type="button" className="v3ln-a" onClick={() => openCapture()}>＋ add to the record</button>
            ) : null}
          </header>
          <div className="v3ln-cast">
            {filteredCast.map((row) => (
              <div key={row.label} className="v3ln-cr">
                <span className={`v3ln-dot ${row.heard ? "d" : row.awaiting ? "w" : "t"}`}
                  title={row.heard ? "Heard — evidence on the record" : row.awaiting ? "Link out — awaiting response" : "To reach"} />
                <span className="v3ln-cr-who">
                  <b>{row.label}</b>
                  {row.isRole ? <span>role — assign a name to send</span>
                    : row.role && row.role !== row.label ? <span>{row.role}</span> : null}
                </span>
                <button type="button" className="v3ln-cr-area"
                  title={areaFilter === row.area ? "Show all areas" : `Filter to ${row.area}`}
                  onClick={() => setAreaFilter(areaFilter === row.area ? "" : row.area)}>{row.area}</button>
                <details className="v3ln-cr-q" open={!!qOpen[row.label]}
                  onToggle={(e) => { const open = e.currentTarget.open; setQOpen((s) => (s[row.label] === open ? s : { ...s, [row.label]: open })); }}>
                  <summary>{row.questions.length} question{row.questions.length === 1 ? "" : "s"}</summary>
                  <ul>{row.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </details>
                <span className="v3ln-cr-act">
                  <button type="button" className="v3ln-a" onClick={() => void copyLink(row)}
                    title="Their one durable link — minted once, reused forever">⎘ link</button>
                  {onSaveInputs ? (
                    <button type="button" className="v3ln-a" onClick={() => openCapture(row)}
                      title={`Capture what ${row.label} said`}>✎ capture</button>
                  ) : null}
                  {onScheduleFollowUp ? (
                    <button type="button" className="v3ln-a" onClick={() => pickDate(row)}
                      title="Schedule a follow-up and download the calendar invite">🗓 invite</button>
                  ) : null}
                </span>
                {linkShown?.who === row.label && qOpen[row.label] ? (
                  <span className="v3ln-cr-url-row">
                    <input className="v3ln-cr-url" readOnly value={linkShown.url}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label={`${row.label}'s durable link`} />
                    <button type="button" className="v3ln-a" onClick={() => void copyShown()}
                      title="Copy the link">⧉ copy</button>
                  </span>
                ) : null}
                {invitee?.label === row.label ? (
                  <span className="v3ln-cr-invite">
                    <input type="date" value={inviteDate} onChange={(e) => setInviteDate(e.target.value)}
                      aria-label={`Follow-up date for ${row.label}`} />
                    <button type="button" className="v3ln-btn" disabled={!inviteDate}
                      onClick={() => void confirmInvite()}>Schedule &amp; download invite</button>
                    <button type="button" className="v3ln-a" onClick={() => setInvitee(null)}>cancel</button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {tab === "discovery" && cast.length === 0 ? (
        <div className="v3ln-note">No one to hear yet — the roster arrives when the Discovery Kit casts it.</div>
      ) : null}

      {tab === "record" ? (
        <section className="v3ln-band" aria-label="Record">
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">Record</span>
            <span className="v3ln-band-sp" />
            {recordAreas.length > 1 ? (
              <label className="v3ln-filter">
                <span>Area</span>
                <select value={recordAreas.includes(areaFilter) ? areaFilter : ""}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  aria-label="Filter the record by area">
                  <option value="">All areas · {record.length}</option>
                  {recordAreas.map((area) => (
                    <option key={area} value={area}>{area} · {record.filter((r) => r.area === area).length}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="v3ln-scope">{recordGroups.reduce((n, g) => n + g.items.length, 0)} entries</span>
          </header>
          {recordGroups.length === 0 ? (
            <div className="v3ln-note">Nothing on the record yet{areaFilter ? ` for ${areaFilter}` : ""} — capture a conversation or share a link from Discover.</div>
          ) : recordGroups.map((group) => (
            <div key={group.area || "programme"} className="v3ln-rec-grp">
              <div className="v3ln-rec-area">
                {group.area ? (
                  <button type="button" className="v3ln-cr-area"
                    title={areaFilter === group.area ? "Show all areas" : `Filter to ${group.area}`}
                    onClick={() => setAreaFilter(areaFilter === group.area ? "" : group.area)}>{group.area}</button>
                ) : <span className="v3ln-scope">programme-wide</span>}
                <span>{group.items.length} entr{group.items.length === 1 ? "y" : "ies"}</span>
              </div>
              {group.items.map(({ entry, name }) => (
                <button type="button" key={entry.id} className="v3ln-rec-row"
                  title="Read the full entry"
                  onClick={() => setReading(entry)}>
                  <span className="v3ln-rec-top">
                    <b>{name}</b>
                    <span className="v3ln-rec-fl">{entry.fieldLabel}</span>
                    {entry.capturedAt ? <time className="v3ln-rec-when">{entry.capturedAt}</time> : null}
                  </span>
                  <span className="v3ln-rec-ex">{entry.excerpt}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {reading ? (
        <Suspense fallback={null}>
          <EvidenceReader entry={reading} onClose={() => setReading(null)} />
        </Suspense>
      ) : null}

      {gateFor ? <GateSheet band={gateFor} onClose={() => setGateFor(null)} /> : null}

      {capFor ? (
        <>
          <div className="v3ln-gate-backdrop" onClick={() => setCapFor(null)} aria-hidden="true" />
          <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label="Add to the record">
            <div className="v3ln-gate-h">
              <h3>Add to the record</h3>
              <button type="button" className="v3ln-x" onClick={() => setCapFor(null)} aria-label="Close">✕</button>
            </div>
            <div className="v3ln-cap">
              <label className="v3ln-cap-f">
                <span>Who said it</span>
                <select value={capWho} onChange={(e) => setCapWho(e.target.value)}>
                  {cast.map((row) => <option key={row.label} value={row.label}>{row.label} — {row.role}</option>)}
                </select>
              </label>
              <label className="v3ln-cap-f">
                <span>What they said — attribution is added for you</span>
                <textarea rows={7} value={capText} onChange={(e) => setCapText(e.target.value)}
                  placeholder="Paste a transcript, meeting notes, an email thread…" />
              </label>
              <div className="v3ln-cap-bar">
                <button type="button" className="v3ln-btn" disabled={!capText.trim() || !capWho}
                  onClick={() => void saveCapture()}>Capture</button>
                <span>Lands as “— Name, Role, Date —” evidence and refreshes what depends on it. To record live or attach files, use the classic Listen board — same record.</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {docFor ? (
        <Suspense fallback={null}>
          <FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)}
            header={docFor.id === "discovery-kit"
              ? <DiscoveryKitAlign program={program} onSaveInputs={onSaveInputs}
                  onRenamePerson={onRenamePerson} onRenameRole={onRenameRole}
                  locked={program.gateReviews?.frame?.status === "approved"}
                  onOpenGate={() => setGateFor(model.bands.find((b) => b.id === "frame") ?? null)} />
              : undefined} />
        </Suspense>
      ) : null}
    </div>
  );
}
