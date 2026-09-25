import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { authHeaders } from "../lib/auth";
import type { Analysis } from "../types/repository";

interface Props {
  repositoryId: string;
}

function AnalysisHistory({
  repositoryId,
}: Props) {
  const [analyses, setAnalyses] =
    useState<Analysis[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get<{
          analyses: Analysis[];
        }>(
          `/repositories/${repositoryId}/analyses`,
          {
            headers: authHeaders(),
          }
        );

        setAnalyses(response.data.analyses);
      } catch (error) {
        console.error(error);
      }
    };

    load();
  }, [repositoryId]);

  return (
    <div>
      <h2>Analysis History</h2>

      {analyses.length === 0 ? (
        <p>No analyses yet.</p>
      ) : (
        analyses.map((analysis) => (
          <div key={analysis.id}>
            <p>
              {new Date(
                analysis.createdAt
              ).toLocaleString()}
            </p>

            <p>
              Status: {analysis.status}
            </p>

            <p>
              Files:{" "}
              {analysis.sourceFileCount}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

export default AnalysisHistory;