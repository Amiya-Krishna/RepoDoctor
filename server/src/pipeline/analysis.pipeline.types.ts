import type { BugDetectionResult } from "../agents/bug-detection.types.js";
import type { SecurityDetectionResult } from "../agents/security.types.js";
import type { TestGenerationResult } from "../agents/test-generation.types.js";
import type {
  EvaluatedFinding,
} from "../risk/risk.engine.js";
import type {
  RepositoryRiskSummary,
} from "../risk/risk.types.js";

export interface AnalysisPipelineInput {
  analysisId: string;
  repositoryPath: string;
}

export interface AnalysisPipelineResult {
  analysisId: string;

  bugResult: BugDetectionResult;

  securityResult: SecurityDetectionResult;

  testResult: TestGenerationResult;

  evaluatedFindings: EvaluatedFinding[];

  riskSummary: RepositoryRiskSummary;
}