import { useEffect, useState } from "react";
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
        </>
      )}
    </div>
  );
}

export default RepositoryAnalysis;