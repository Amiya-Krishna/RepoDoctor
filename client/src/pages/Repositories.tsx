import { useEffect, useState } from "react";
import {
  analyzeRepository,
  getRepositories,
} from "../services/repository.service";
import type { Repository } from "../types/repository";

function Repositories() {
  const [repositories, setRepositories] =
    useState<Repository[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [analyzingId, setAnalyzingId] =
    useState<string | null>(null);

  const [error, setError] =
    useState("");

  const loadRepositories = async () => {
    try {
      setLoading(true);

      const data = await getRepositories();

      setRepositories(data);
    } catch (error) {
      console.error(error);
      setError("Failed to load repositories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRepositories();
  }, []);

  const handleAnalyze = async (
    repositoryId: string
  ) => {
    try {
      setAnalyzingId(repositoryId);
      setError("");

      await analyzeRepository(repositoryId);

      alert("Repository analyzed successfully");
    } catch (error) {
      console.error(error);
      setError("Repository analysis failed");
    } finally {
      setAnalyzingId(null);
    }
  };

  if (loading) {
    return <p>Loading repositories...</p>;
  }

  return (
    <div>
      <h1>Your GitHub Repositories</h1>

      {error && (
        <p style={{ color: "red" }}>
          {error}
        </p>
      )}

      {repositories.length === 0 ? (
        <p>No repositories found.</p>
      ) : (
        repositories.map((repository) => (
          <div
            key={repository.id}
            style={{
              border: "1px solid #ddd",
              padding: "20px",
              marginBottom: "15px",
              borderRadius: "8px",
            }}
          >
            <h2>{repository.name}</h2>

            <p>
              {repository.fullName}
            </p>

            <p>
              Default branch:{" "}
              {repository.defaultBranch}
            </p>

            <button
              onClick={() =>
                handleAnalyze(repository.id)
              }
              disabled={
                analyzingId === repository.id
              }
            >
              {analyzingId === repository.id
                ? "Analyzing..."
                : "Analyze Repository"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export default Repositories;