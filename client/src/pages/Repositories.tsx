import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "../lib/api";
import { authHeaders } from "../lib/auth";
import {
  analyzeRepository,
  getRepositories,
} from "../services/repository.service";
import type { Repository } from "../types/repository";
import RepositoryAnalysis from "./RepositoryAnalysis";
import AnalysisHistory from "./AnalysisHistory";

interface ScanProgress {
  jobId?: string;
  stage?: string;
  message?: string;
  percent?: number;
  status?: string;
}

const socketBaseUrl = () =>
  (import.meta.env.VITE_API_URL ?? "http://localhost:5000/api")
    .replace(/\/api\/?$/, "");

function Repositories() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({});
  const [progressByRepository, setProgressByRepository] = useState<Record<string, ScanProgress>>({});
  const [error, setError] = useState("");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);

  const loadRepositories = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setRepositories(await getRepositories());
    } catch (loadError) {
      console.error(loadError);
      setError("Failed to load repositories. Check your login and GitHub connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  useEffect(() => {
    const entries = Object.entries(activeJobs);
    if (entries.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      await Promise.all(entries.map(async ([repositoryId, jobId]) => {
        try {
          const response = await api.get(`/repositories/jobs/${encodeURIComponent(jobId)}`, {
            headers: authHeaders(),
          });
          if (cancelled) return;

          const status = String(response.data.status ?? "").toLowerCase();
          const progress = response.data.progress as ScanProgress | undefined;
          if (status === "completed" || status === "failed") {
            setActiveJobs((current) => {
              if (current[repositoryId] !== jobId) return current;
              const next = { ...current };
              delete next[repositoryId];
              return next;
            });
          }
          if (progress) {
            setProgressByRepository((current) => ({
              ...current,
              [repositoryId]: {
                ...progress,
                status: status.toUpperCase(),
              },
            }));
          }
        } catch (pollError) {
          console.warn("Unable to refresh scan status", pollError);
        }
      }));
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobs]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const socket: Socket = io(socketBaseUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
    });

    socket.on("connect_error", (socketError) => {
      console.warn("Live scan updates are unavailable:", socketError.message);
    });

    socket.on("scan:progress", (event: ScanProgress & { repositoryId?: string }) => {
      if (!event.repositoryId) return;
      setProgressByRepository((current) => ({
        ...current,
        [event.repositoryId!]: event,
      }));
    });

    socket.on("scan:completed", (event: { repositoryId?: string; jobId?: string; result?: { analysisId?: string } }) => {
      if (!event.repositoryId) return;
      setActiveJobs((current) => {
        const next = { ...current };
        delete next[event.repositoryId!];
        return next;
      });
      setProgressByRepository((current) => ({
        ...current,
        [event.repositoryId!]: {
          jobId: event.jobId,
          stage: "completed",
          status: "COMPLETED",
          percent: 100,
          message: `Analysis completed${event.result?.analysisId ? ` (analysis ${event.result.analysisId})` : ""}`,
        },
      }));
      void loadRepositories();
    });

    socket.on("scan:failed", (event: { repositoryId?: string; jobId?: string; message?: string }) => {
      if (!event.repositoryId) return;
      setActiveJobs((current) => {
        const next = { ...current };
        delete next[event.repositoryId!];
        return next;
      });
      setProgressByRepository((current) => ({
        ...current,
        [event.repositoryId!]: {
          jobId: event.jobId,
          stage: "failed",
          status: "FAILED",
          message: event.message ?? "Repository scan failed",
        },
      }));
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [loadRepositories]);

  const handleDelete = async (repositoryId: string) => {
    if (!window.confirm("Remove this repository and its analysis history from RepoDoctor?")) return;
    try {
      await api.delete(`/repositories/${encodeURIComponent(repositoryId)}`, {
        headers: authHeaders(),
      });
      setRepositories((current) => current.filter((repository) => repository.id !== repositoryId));
      setProgressByRepository((current) => {
        const next = { ...current };
        delete next[repositoryId];
        return next;
      });
      if (selectedRepositoryId === repositoryId) setSelectedRepositoryId(null);
    } catch (deleteError: any) {
      setError(deleteError.response?.data?.message ?? "Failed to remove repository");
    }
  };

  const handleAnalyze = async (repositoryId: string) => {
    try {
      setError("");
      setProgressByRepository((current) => ({
        ...current,
        [repositoryId]: {
          stage: "queued",
          status: "QUEUED",
          percent: 0,
          message: "Submitting repository scan to the worker queue",
        },
      }));

      const result = await analyzeRepository(repositoryId);
      setActiveJobs((current) => ({ ...current, [repositoryId]: result.jobId }));
      setProgressByRepository((current) => ({
        ...current,
        [repositoryId]: {
          ...current[repositoryId],
          jobId: result.jobId,
          status: "QUEUED",
          message: `Scan queued (job ${result.jobId})`,
        },
      }));
    } catch (scanError) {
      console.error(scanError);
      setError("Failed to queue repository analysis.");
      setProgressByRepository((current) => ({
        ...current,
        [repositoryId]: { status: "FAILED", message: "Failed to queue scan" },
      }));
    }
  };

  if (loading) return <p>Loading repositories...</p>;

  return (
    <section>
      <h2>Your GitHub Repositories</h2>
      <button onClick={() => void loadRepositories()}>Refresh repositories</button>

      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}

      {repositories.length === 0 ? (
        <p>No repositories found. Connect GitHub and refresh this list.</p>
      ) : repositories.map((repository) => {
        const progress = progressByRepository[repository.id];
        const busy = Boolean(activeJobs[repository.id]);

        return (
          <article key={repository.id} style={{ border: "1px solid #ddd", padding: 20, margin: "15px 0", borderRadius: 8 }}>
            <h3>{repository.name}</h3>
            <p>{repository.fullName}</p>
            <p>Default branch: {repository.defaultBranch}</p>
            <button onClick={() => void handleAnalyze(repository.id)} disabled={busy}>
              {busy ? "Scan queued/running…" : "Analyze Repository"}
            </button>
            <button onClick={() => setSelectedRepositoryId(repository.id)}>
              View analysis
            </button>
            <button onClick={() => void handleDelete(repository.id)}>
              Remove repository
            </button>

            {progress && (
              <div aria-live="polite" style={{ marginTop: 12 }}>
                <p><strong>Status:</strong> {progress.status ?? progress.stage ?? "Queued"}</p>
                <p>{progress.message}</p>
                {typeof progress.percent === "number" && (
                  <progress value={progress.percent} max={100} />
                )}
              </div>
            )}
          </article>
        );
      })}

      {selectedRepositoryId && (
        <section style={{ marginTop: 28, borderTop: "2px solid #ddd", paddingTop: 20 }}>
          <button onClick={() => setSelectedRepositoryId(null)}>Close analysis</button>
          <RepositoryAnalysis repositoryId={selectedRepositoryId} />
          <AnalysisHistory repositoryId={selectedRepositoryId} />
        </section>
      )}
    </section>
  );
}

export default Repositories;
