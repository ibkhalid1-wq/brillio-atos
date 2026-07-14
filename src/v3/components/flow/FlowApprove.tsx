import { useEffect, useState } from "react";

/**
 * The public artifact-approval page — what a chosen approver sees when they open
 * an approval link (?flowApprove=programId.secret). No sign-in: the token IS the
 * access, served by the flow-portal edge. The approver reads a frozen snapshot
 * of the document and returns Approve or Request-changes; the verdict lands in a
 * quarantined inbox for the operator to record. Same tokens as the shell.
 */

interface ApprovalPack {
  kind: "approval";
  programme: string;
  artifactTitle: string;
  movement: string;
  approver: { name: string; role: string };
  snapshot: string;
  responded: boolean;
}

type State =
  | { phase: "loading" }
  | { phase: "invalid" }
  | { phase: "ready"; pack: ApprovalPack }
  | { phase: "sent"; verdict: "approved" | "changes" };

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

export default function FlowApprove({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approved" | "changes" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${FUNCTIONS_BASE}/flow-portal?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (live) setState(data && data.kind === "approval" ? { phase: "ready", pack: data } : { phase: "invalid" }); })
      .catch(() => { if (live) setState({ phase: "invalid" }); });
    return () => { live = false; };
  }, [token]);

  const submit = async (verdict: "approved" | "changes") => {
    if (verdict === "changes" && !comment.trim()) { setError("Add a note so the team knows what to change."); return; }
    setError(""); setBusy(verdict);
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, verdict, comment: comment.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Could not send that. Please try again.");
      } else {
        setState({ phase: "sent", verdict });
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="v3-shell v3fs-shell">
      <div className="v3fs-app">
        <div className="v3fs-wrap v3fs-portal">
          {state.phase === "loading" ? (
            <div className="v3fs-quiet"><h2>One moment…</h2></div>
          ) : state.phase === "invalid" ? (
            <div className="v3fs-quiet">
              <h2>This link isn&rsquo;t valid.</h2>
              <p>It may have been replaced — ask the person who sent it for a fresh one.</p>
            </div>
          ) : state.phase === "sent" ? (
            <div className="v3fs-quiet">
              <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
              <h2>{state.verdict === "approved" ? "Thank you — your approval is in." : "Thank you — your changes are noted."}</h2>
              <p>The programme team has your response. This link is now closed.</p>
            </div>
          ) : state.pack.responded ? (
            <div className="v3fs-quiet">
              <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
              <h2>This link has done its job.</h2>
              <p>Your decision is on the record — each link takes one response. Ask the programme team for a fresh link if you need to revisit it.</p>
            </div>
          ) : (
            <>
              <header className="v3fs-hero">
                <h1 className="v3fs-hero-title">
                  <span className="v3fs-hero-brand">ATOS Flow</span> · {state.pack.programme}
                </h1>
                <p className="v3fs-how">
                  {state.pack.approver.name ? `${state.pack.approver.name} — ` : ""}you&rsquo;ve been asked to approve
                  {" "}<b>{state.pack.artifactTitle}</b>. Read it below, then approve or request changes.
                </p>
              </header>
              <article className="v3fs-panel v3fs-approve-doc" aria-label={state.pack.artifactTitle}>
                <div className="v3fs-ph"><h3>{state.pack.artifactTitle}</h3><span>as prepared for your sign-off</span></div>
                <div className="v3fs-approve-snap">{state.pack.snapshot || "The document text wasn't captured — ask the team to re-send with the content."}</div>
              </article>
              <div className="v3fs-panel v3fs-approve-act">
                <label className="v3fs-approve-note-l" htmlFor="approve-note">Add a note (required to request changes)</label>
                <textarea id="approve-note" className="v3fs-approve-note" value={comment} rows={3}
                  placeholder="Optional for an approval; tell the team what to change if you're requesting changes…"
                  onChange={(event) => setComment(event.target.value)} />
                {error ? <p className="v3fs-approve-err" role="alert">{error}</p> : null}
                <div className="v3fs-approve-btns">
                  <button type="button" className="v3fs-btn pri" disabled={!!busy} onClick={() => void submit("approved")}>
                    {busy === "approved" ? "Sending…" : "✓ Approve"}
                  </button>
                  <button type="button" className="v3fs-btn" disabled={!!busy} onClick={() => void submit("changes")}>
                    {busy === "changes" ? "Sending…" : "↺ Request changes"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
