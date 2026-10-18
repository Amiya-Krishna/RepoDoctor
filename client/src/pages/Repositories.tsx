import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import axios from "axios";
import { api, getErrorMessage, socketBaseUrl } from "../lib/api";
import { authHeaders } from "../lib/auth";
import {
  analyzeRepository,
  getRepositories,
} from "../services/repository.service";
import type { Repository } from "../types/repository";
import RepositoryAnalysis from "./RepositoryAnalysis";
import AnalysisHistory from "./AnalysisHistory";
import Spinner from "../components/Spinner";

interface ScanProgress {
  jobId?: string;
  stage?: string;
  message?: string;
  percent?: number;
  status?: string;
}

const NOT_CONNECTED_MESSAGE = "GitHub account is not connected";

/** True when the API says the user has not linked a GitHub account yet. */
const isGitHubNotConnected = (error: unknown) =>
  axios.isAxiosError(error) &&
  error.response?.status === 400 &&
  (error.response.data as { message?: unknown } | undefined)?.message === NOT_CONNECTED_MESSAGE;

function Repositories() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({});
  const [progressByRepository, setProgressByRepository] = useState<Record<string, ScanProgress>>({});
  const [error, setError] = useState("");
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [githubConnected, setGithubConnected] = useState(true);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);

  const loadRepositories = useCallback(async () => {
    try {
      setRepositories(await getRepositories());
      setGithubConnected(true);
      setError("");
    } catch (loadError) {
      if (isGitHubNotConnected(loadError)) {
        setGithubConnected(false);
        setError("");
      } else {
        console.error(loadError);
        setError(getErrorMessage(loadError, "Failed to load repositories."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Explicit refresh shows the loading state; the initial load starts with loading=true.
  const refreshRepositories = () => {
    setLoading(true);
    return loadRepositories();
  };

  useEffect(() => {
    let cancelled = false;

    getRepositories()
      .then((loaded) => {
        if (!cancelled) setRepositories(loaded);
      })
      .catch((loadError) => {
        if (cancelled) return;
        if (isGitHubNotConnected(loadError)) {
          setGithubConnected(false);
        } else {
          console.error(loadError);
          setError(getErrorMessage(loadError, "Failed to load repositories."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    setDeleteErrors((current) => {
      const next = { ...current };
      delete next[repositoryId];
      return next;
    });
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
    } catch (deleteError) {
      // Shown on the repository's own card (e.g. 409: it has repair jobs).
      setDeleteErrors((current) => ({
        ...current,
        [repositoryId]: getErrorMessage(deleteError, "Failed to remove repository"),
      }));
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

  if (loading) return <p role="status">Loading repositories…</p>;

  return (
    <section>
      <h2>Your GitHub Repositories</h2>
      <button onClick={() => void refreshRepositories()}>Refresh repositories</button>

      {error && <p role="alert" className="form-error">{error}</p>}

      {repositories.length === 0 ? (
        <p className="notice">
          {githubConnected
            ? "No repositories found. Refresh the list to sync from GitHub."
            : "Connect your GitHub account (button above) to list and analyze your repositories."}
        </p>
      ) : repositories.map((repository) => {
        const progress = progressByRepository[repository.id];
        const busy = Boolean(activeJobs[repository.id]);
        const working = busy || ["QUEUED", "PENDING", "RUNNING", "ACTIVE", "RETRYING"].includes(progress?.status ?? "");
        const deleteError = deleteErrors[repository.id];

        return (
          <article key={repository.id} className="card">
            <h3>{repository.name}</h3>
            <p>{repository.fullName}</p>
            <p>Default branch: {repository.defaultBranch}</p>
            <button onClick={() => void handleAnalyze(repository.id)} disabled={busy}>
              {busy && <Spinner label="Scan in progress" />}
              {busy ? "Scan queued/running…" : "Analyze Repository"}
            </button>
            <button onClick={() => setSelectedRepositoryId(repository.id)}>
              View analysis
            </button>
            <button type="button" className="danger" onClick={() => void handleDelete(repository.id)}>
              Remove repository
            </button>

            {deleteError && <p role="alert" className="form-error">{deleteError}</p>}

            {progress && (
              <div aria-live="polite" style={{ marginTop: 12 }}>
                <p>
                  {working && <Spinner label="Scan in progress" />}
                  <strong>Status:</strong> {progress.status ?? progress.stage ?? "Queued"}
                </p>
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
        <section className="analysis-panel">
          <button onClick={() => setSelectedRepositoryId(null)}>Close analysis</button>
          <RepositoryAnalysis repositoryId={selectedRepositoryId} />
          <AnalysisHistory repositoryId={selectedRepositoryId} />
        </section>
      )}
    </section>
  );
}

export default Repositories;
