export interface Repository {
  id: string;
  githubId: string;
  name: string;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Analysis {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

  projectType: string | null;
  language: string | null;
  packageManager: string | null;
  framework: string | null;
  testFramework: string | null;
  linter: string | null;

  hasTypeScript: boolean;

  sourceFileCount: number;
  testFileCount: number;

  createdAt: string;
  completedAt: string | null;
  bugFindings?: AnalysisFinding[];
  securityFindings?: AnalysisFinding[];
  generatedTests?: GeneratedTestSummary[];
  riskAssessments?: RiskAssessmentSummary[];
}
export interface AnalysisFinding {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  evidence: string;
  suggestedFix: string;
  confidence: number;
}

export interface GeneratedTestSummary {
  id: string;
  title: string;
  description: string;
  type: string;
  filePath: string;
  targetFunction: string | null;
  testCode: string;
  rationale: string;
  confidence: number;
}

export interface RiskAssessmentSummary {
  id: string;
  findingId: string;
  source: string;
  score: number;
  level: string;
  priority: string;
  factors: unknown;
}
