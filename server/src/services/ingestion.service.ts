import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { createWorkspace, removeWorkspace } from "./workspace.service.js";
import { analyzeRepository } from "../analyzers/repository.analyzer.js";
import { saveAnalysis } from "./analysis.service.js";
import { runAnalysisPipeline } from "../pipeline/analysis.pipeline.js";
import type { AnalysisPipelineResult } from "../pipeline/analysis.pipeline.types.js";

const execFileAsync = promisify(execFile);

interface IngestionInput {
  repositoryId: string;
  cloneUrl: string;
  accessToken: string;
  defaultBranch: string;
  analysisId?: string;
  sourceRef?: string;
  onProgress?: (stage: string, message: string, percent: number) => Promise<void> | void;
}

export interface IngestionResult {
  analysisId: string;
  snapshot: Awaited<ReturnType<typeof analyzeRepository>>;
  pipelineResult: AnalysisPipelineResult;
}

export const ingestRepository = async ({
  repositoryId,
  cloneUrl,
  accessToken,
  defaultBranch,
  analysisId,
  sourceRef,
  onProgress,
}: IngestionInput): Promise<IngestionResult> => {
  if (!repositoryId || !cloneUrl || !accessToken || !defaultBranch) {
    throw new Error("repositoryId, cloneUrl, accessToken and defaultBranch are required");
  }

  const workspace = await createWorkspace();

  try {
    const repositoryPath = path.join(workspace.path, "repository");
    const authHeader = Buffer.from(`x-access-token:${accessToken}`).toString("base64");

    await onProgress?.("clone", "Cloning selected repository branch", 5);

    // Credentials are passed to git through its environment, never embedded in
    // the clone URL or command-line arguments. They are not passed to Docker.
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--branch", defaultBranch, "--", cloneUrl, repositoryPath],
      {
        timeout: 120_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authHeader}`,
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    await onProgress?.("repository-analysis", "Inspecting repository structure", 15);
    const snapshot = await analyzeRepository(repositoryPath);
    const analysis = await saveAnalysis(repositoryId, snapshot, analysisId, sourceRef ?? defaultBranch);

    const pipelineResult = await runAnalysisPipeline({
      analysisId: analysis.id,
      repositoryId,
      repositoryPath,
      onProgress,
    });

    return {
      analysisId: analysis.id,
      snapshot,
      pipelineResult,
    };
  } finally {
    await removeWorkspace(workspace.path);
  }
};
