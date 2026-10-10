import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { api } from "../lib/api";
import { authHeaders } from "../lib/auth";
import {
  getLatestAnalysis,
  getRepository,
} from "../services/repository.service";
import type {
  Analysis,
  Repository,
} from "../types/repository";

interface Props {
  repositoryId: string;
}

function RepositoryAnalysis({
  repositoryId,
}: Props) {
  const [repository, setRepository] =
    useState<Repository | null>(null);

  const [analysis, setAnalysis] =
    useState<Analysis | null>(null);

  const [loading, setLoading] =
    useState(true);
  const [testCommand, setTestCommand] = useState("npm test");
  const [repairStates, setRepairStates] = useState<Record<string, {
    jobId?: string;
    status: string;
    message: string;
    pullRequestUrl?: string;
  }>>({});
  const [repairError, setRepairError] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        const repositoryData =
          await getRepository(repositoryId);

        setRepository(repositoryData);

        try {
          const analysisData =
            await getLatestAnalysis(
              repositoryId
            );

          setAnalysis(analysisData);
        } catch {
          setAnalysis(null);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [repositoryId]);

  useEffect(() => {
    if (!analysis?.id) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    const socket = io(
      (import.meta.env.VITE_API_URL ?? "http://localhost:5000/api").replace(/\/api\/?$/, ""),
      { auth: { token }, transports: ["websocket", "polling"] },
    );

    socket.on("repair:progress", (event: {
      analysisId?: string; findingId?: string; jobId?: string;
      status?: string; stage?: string; message?: string;
    }) => {
      if (event.analysisId !== analysis.id || !event.findingId) return;
      setRepairStates((current) => ({
        ...current,
        [event.findingId!]: {
          ...current[event.findingId!],
          jobId: event.jobId,
          status: event.status ?? event.stage ?? "RUNNING",
          message: event.message ?? "Repair in progress",
        },
      }));
    });

    socket.on("repair:completed", (event: {
      analysisId?: string; findingId?: string; jobId?: string;
      result?: { status?: string; pullRequest?: { url?: string } };
    }) => {
      if (event.analysisId !== analysis.id || !event.findingId) return;
      setRepairStates((current) => ({
        ...current,
        [event.findingId!]: {
          jobId: event.jobId,
          status: event.result?.status ?? "COMPLETED",
          message: event.result?.pullRequest?.url
            ? "Verified repair published as a pull request."
            : `Repair finished with status ${event.result?.status ?? "COMPLETED"}. No pull request was created.`,
          pullRequestUrl: event.result?.pullRequest?.url,
        },
      }));
    });

    socket.on("repair:failed", (event: {
      analysisId?: string; findingId?: string; jobId?: string; message?: string;
    }) => {
      if (event.analysisId !== analysis.id || !event.findingId) return;
      setRepairStates((current) => ({
        ...current,
        [event.findingId!]: {
          jobId: event.jobId,
          status: "FAILED",
          message: event.message ?? "Repair failed",
        },
      }));
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [analysis?.id]);

  const queueRepair = async (findingId: string) => {
    if (!analysis) return;
    const command = testCommand.trim().split(/\s+/).filter(Boolean);
    setRepairError("");
    try {
      setRepairStates((current) => ({
        ...current,
        [findingId]: { status: "QUEUING", message: "Queueing autonomous repair…" },
      }));
      const response = await api.post("/repairs", {
        analysisId: analysis.id,
        findingId,
        testCommand: command,
      }, { headers: authHeaders() });
      setRepairStates((current) => ({
        ...current,
        [findingId]: {
          jobId: response.data.jobId,
          status: "QUEUED",
          message: `Repair queued (job ${response.data.jobId})`,
        },
      }));
    } catch (error: any) {
      const message = error.response?.data?.message ?? "Unable to queue repair";
      setRepairError(message);
      setRepairStates((current) => ({
        ...current,
        [findingId]: { status: "FAILED", message },
      }));
    }
  };

  if (loading) {
    return <p>Loading analysis...</p>;
  }

  if (!repository) {
    return <p>Repository not found.</p>;
  }

  return (
    <div>
      <h1>{repository.name}</h1>

      <p>{repository.fullName}</p>

      {!analysis ? (
        <p>
          This repository has not been analyzed yet.
        </p>
      ) : (
        <>
          <h2>Repository Overview</h2>

          <p>
            Status: {analysis.status}
          </p>

          <p>
            Language:{" "}
            {analysis.language ?? "Unknown"}
          </p>

          <p>
            Package Manager:{" "}
            {analysis.packageManager ?? "Unknown"}
          </p>

          <p>
            Framework:{" "}
            {analysis.framework ?? "None detected"}
          </p>

          <p>
            Test Framework:{" "}
            {analysis.testFramework ??
              "None detected"}
          </p>

          <p>
            Linter:{" "}
            {analysis.linter ??
              "None detected"}
          </p>

          <p>
            TypeScript:{" "}
            {analysis.hasTypeScript
              ? "Yes"
              : "No"}
          </p>

          <p>
            Source Files:{" "}
            {analysis.sourceFileCount}
          </p>

          <p>
            Test Files:{" "}
            {analysis.testFileCount}
          </p>

          <label style={{ display: "block", margin: "16px 0" }}>
            Docker test command (space-separated arguments)
            <input
              value={testCommand}
              onChange={(event) => setTestCommand(event.target.value)}
              placeholder="npm test"
              style={{ display: "block", minWidth: 280, marginTop: 6 }}
            />
          </label>
          <p>Tests run in an isolated Docker container with networking disabled. The command runs against the disposable repair workspace, not the original repository.</p>
          {repairError && <p role="alert" style={{ color: "crimson" }}>{repairError}</p>}

          <h2>Bug Findings ({analysis.bugFindings?.length ?? 0})</h2>
          {(analysis.bugFindings ?? []).map((finding) => (
            <article key={finding.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10 }}>
              <strong>{finding.severity}: {finding.title}</strong>
              <p>{finding.description}</p>
              <p>{finding.filePath}:{finding.lineStart}-{finding.lineEnd}</p>
              <p>Confidence: {Math.round(finding.confidence * 100)}%</p>
              <p><strong>Suggested fix:</strong> {finding.suggestedFix}</p>
              <button onClick={() => void queueRepair(finding.id)} disabled={repairStates[finding.id]?.status === "QUEUING" || repairStates[finding.id]?.status === "QUEUED" || repairStates[finding.id]?.status === "RUNNING"}>
                Attempt autonomous repair
              </button>
              {repairStates[finding.id] && (
                <p aria-live="polite">
                  {repairStates[finding.id].status}: {repairStates[finding.id].message}
                  {repairStates[finding.id].pullRequestUrl && (
                    <>{" "}<a href={repairStates[finding.id].pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a></>
                  )}
                </p>
              )}
            </article>
          ))}

          <h2>Security Findings ({analysis.securityFindings?.length ?? 0})</h2>
          {(analysis.securityFindings ?? []).map((finding) => (
            <article key={finding.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10 }}>
              <strong>{finding.severity}: {finding.title}</strong>
              <p>{finding.description}</p>
              <p>{finding.filePath}:{finding.lineStart}-{finding.lineEnd}</p>
              <p><strong>Evidence:</strong> {finding.evidence}</p>
              <button onClick={() => void queueRepair(finding.id)} disabled={repairStates[finding.id]?.status === "QUEUING" || repairStates[finding.id]?.status === "QUEUED" || repairStates[finding.id]?.status === "RUNNING"}>
                Attempt autonomous repair
              </button>
              {repairStates[finding.id] && (
                <p aria-live="polite">
                  {repairStates[finding.id].status}: {repairStates[finding.id].message}
                  {repairStates[finding.id].pullRequestUrl && (
                    <>{" "}<a href={repairStates[finding.id].pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a></>
                  )}
                </p>
              )}
            </article>
          ))}

          <h2>Generated Test Proposals ({analysis.generatedTests?.length ?? 0})</h2>
          {(analysis.generatedTests ?? []).map((test) => (
            <article key={test.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10 }}>
              <strong>{test.title}</strong>
              <p>{test.description}</p>
              <p>Target: {test.filePath}{test.targetFunction ? ` → ${test.targetFunction}` : ""}</p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{test.testCode}</pre>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

export default RepositoryAnalysis;