import { useCallback, useEffect, useState } from "react";
import { api, getErrorInfo, getErrorMessage } from "../lib/api";
import { authHeaders } from "../lib/auth";

interface Change { filePath: string; changeType: string; startLine: number; endLine: number; originalCode: string; replacementCode: string; explanation: string }
interface Report {
  repair: { id: string; status: string; errorMessage: string | null; pullRequestUrl: string | null; branchName?: string | null; pullRequestNumber?: number | null };
  patch: { title: string; summary: string; risk: string; changes: Change[]; patchHash?: string } | null;
  verification: { status: string; summary: string; confidence: number; evidence: string[]; testPassed: boolean; regressionDetected: boolean } | null;
  testRun: { success: boolean; exitCode: number | null; timedOut: boolean; durationMs: number; testCommand: string[]; stdout: string; stderr: string } | null;
  limitations: string[];
}

/** Statuses in which a worker is (or should be) progressing the publication, so the page polls. */
const IN_FLIGHT = ["APPROVED", "PUBLISHING", "REVALIDATING", "TESTING", "BRANCH_PUSHED", "PR_CREATED", "PUBLISH_FAILED_RETRYABLE"];
/** Approval can still be withdrawn until a branch exists on GitHub. */
const REVOCABLE = ["APPROVED", "REVALIDATING", "TESTING"];

const PROGRESS: Record<string, string> = {
  APPROVED: "Approved. Waiting for a worker to start.",
  PUBLISHING: "Publishing…",
  REVALIDATING: "Re-applying the patch to a fresh clone of your repository…",
  TESTING: "Running the tests again before anything is pushed…",
  BRANCH_PUSHED: "The branch is on GitHub. Creating the pull request…",
  PR_CREATED: "The pull request was created. Recording it…",
  PUBLISH_FAILED_RETRYABLE: "A temporary problem interrupted publishing. RepoDoctor will retry automatically.",
};

const BADGE: Record<string, string> = { VERIFIED: "Verified by a real test run", FAILED: "Failed", INCONCLUSIVE: "Inconclusive — not enough evidence" };

export default function RepairReport({ repairJobId, onClose }: { repairJobId: string; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.get<Report>(`/repairs/${encodeURIComponent(repairJobId)}`, { headers: authHeaders() })
      .then((r) => { setReport(r.data); setError(""); })
      .catch((e: unknown) => setError(getErrorMessage(e, "Could not load the repair report.")));
  }, [repairJobId]);
  useEffect(load, [load]);

  // While publishing, poll so the final state (PR link or an explained failure) appears without a reload.
  useEffect(() => {
    if (!report || !IN_FLIGHT.includes(report.repair.status)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [report, load]);

  const act = async (action: "approve" | "reject" | "revoke-approval") => {
    setBusy(true); setNote("");
    try {
      // Approval is bound to the exact patch that is on screen: if it changed, the server refuses (409 PATCH_CHANGED).
      const body = action === "approve" ? { patchHash: report?.patch?.patchHash ?? "" } : {};
      const r = await api.post<{ message?: string }>(`/repairs/${encodeURIComponent(repairJobId)}/${action}`, body, { headers: authHeaders() });
      setNote(r.data.message ?? (action === "reject" ? "Rejected. Nothing was published." : action === "revoke-approval" ? "Approval withdrawn. Nothing was pushed." : "Done."));
      load();
    } catch (e) {
      const { code } = getErrorInfo(e);
      if (code === "PATCH_CHANGED") {
        setNote("The patch changed after you opened this report, so it was NOT approved. The report has been reloaded: review the new patch and approve again.");
        load();
      } else {
        setNote(getErrorMessage(e, "That did not work. Nothing was published."));
      }
    } finally { setBusy(false); }
  };

  if (error) return <div role="alert" className="error"><p>{error}</p><button type="button" onClick={load}>Retry</button> <button type="button" className="secondary" onClick={onClose}>Close</button></div>;
  if (!report) return <p role="status">Loading repair report…</p>;

  const { repair, patch, verification, testRun } = report;
  const awaiting = repair.status === "AWAITING_APPROVAL";

  return (
    <section className="panel" aria-label="Repair report">
      <button type="button" className="secondary" onClick={onClose}>Close report</button>
      <h3>{patch?.title ?? "Repair"}</h3>
      <p><strong>Status:</strong> {repair.status.replace(/_/g, " ")}{verification && <> · <strong>{BADGE[verification.status] ?? verification.status}</strong></>}</p>
      {repair.errorMessage && <p role="alert" className="error">{repair.errorMessage}</p>}
      {patch && <p>{patch.summary} <em>(risk: {patch.risk})</em></p>}

      {patch?.changes.map((c, i) => (
        <div key={i} className="diff">
          <div><strong>{c.filePath}</strong> · lines {c.startLine}–{c.endLine} · {c.changeType}</div>
          <div className="diff-cols">
            <div><div className="diff-head">Before</div><pre className="del">{c.originalCode || "(nothing)"}</pre></div>
            <div><div className="diff-head">After</div><pre className="add">{c.replacementCode || "(removed)"}</pre></div>
          </div>
          <small>{c.explanation}</small>
        </div>
      ))}

      {testRun && (
        <details open>
          <summary>Test evidence: <code>{testRun.testCommand.join(" ")}</code> → exit code {testRun.exitCode ?? "none"}{testRun.timedOut ? " (timed out)" : ""}, {Math.round(testRun.durationMs / 1000)}s</summary>
          <pre className="log">{(testRun.stdout + testRun.stderr).trim() || "(no output)"}</pre>
        </details>
      )}
      {verification && (
        <details>
          <summary>Verification details (confidence {Math.round(verification.confidence * 100)}%)</summary>
          <p>{verification.summary}</p>
          <ul>{verification.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}
      <details><summary>Limitations</summary><ul>{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>

      {awaiting && (
        <div>
          <p>Approving re-applies this patch to a fresh clone, runs the tests again, and opens a pull request only if they still pass. RepoDoctor never merges.</p>
          <button type="button" disabled={busy} onClick={() => void act("approve")}>{busy ? "Working…" : "Approve and create pull request"}</button>{" "}
          <button type="button" className="secondary" disabled={busy} onClick={() => void act("reject")}>Reject</button>
        </div>
      )}
      {IN_FLIGHT.includes(repair.status) && <p role="status">{PROGRESS[repair.status] ?? "Working…"}</p>}
      {REVOCABLE.includes(repair.status) && (
        <p><button type="button" className="secondary" disabled={busy} onClick={() => void act("revoke-approval")}>Withdraw approval</button> <small>Possible until the branch is pushed to GitHub.</small></p>
      )}
      {repair.status === "NEEDS_REAPPROVAL" && <p role="alert" className="error">Your repository or the patch changed after you approved, so nothing was published. Reload and review the patch again to approve it.</p>}
      {repair.status === "APPROVAL_REVOKED" && <p role="status">You withdrew your approval. Nothing was published.</p>}
      {repair.status === "COMPLETED" && repair.pullRequestUrl && <p role="status" className="notice">A pull request was opened. RepoDoctor never merges: review and merge it on GitHub yourself.</p>}
      {repair.branchName && !repair.pullRequestUrl && ["PUBLISH_BLOCKED", "PUBLISH_FAILED_RETRYABLE", "BRANCH_PUSHED"].includes(repair.status) && (
        <p role="alert" className="error">The branch <code>{repair.branchName}</code> already exists on GitHub, but no pull request has been created. You can open one from that branch manually.</p>
      )}
      {repair.pullRequestUrl && <p><a href={repair.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request on GitHub</a></p>}
      {note && <p role="status" className="notice">{note}</p>}
    </section>
  );
}
