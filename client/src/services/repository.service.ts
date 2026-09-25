import { api } from "../lib/api";
import { authHeaders } from "../lib/auth";
import type {
  Repository,
  Analysis,
} from "../types/repository";

export const getRepositories = async () => {
  const response = await api.get<{
    repositories: Repository[];
  }>("/repositories", {
    headers: authHeaders(),
  });

  return response.data.repositories;
};

export const getRepository = async (
  repositoryId: string
) => {
  const response = await api.get<{
    repository: Repository;
  }>(`/repositories/${repositoryId}`, {
    headers: authHeaders(),
  });

  return response.data.repository;
};

export const analyzeRepository = async (
  repositoryId: string
) => {
  const response = await api.post(
    "/repositories/ingest",
    {
      repositoryId,
    },
    {
      headers: authHeaders(),
    }
  );

  return response.data;
};

export const getLatestAnalysis = async (
  repositoryId: string
) => {
  const response = await api.get<{
    analysis: Analysis;
  }>(
    `/repositories/${repositoryId}/analysis/latest`,
    {
      headers: authHeaders(),
    }
  );

  return response.data.analysis;
};