export type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type RiskPriority =
  | "P0"
  | "P1"
  | "P2"
  | "P3";

export type FindingSource =
  | "BUG"
  | "SECURITY";

export interface RiskInput {
  source: FindingSource;

  severity: string;

  confidence: number;

  category: string;

  filePath: string;
}

export interface RiskAssessment {
  score: number;

  level: RiskLevel;

  priority: RiskPriority;

  factors: string[];
}

export interface RepositoryRiskSummary {
  overallScore: number;

  level: RiskLevel;

  priority: RiskPriority;

  totalFindings: number;

  criticalFindings: number;

  highFindings: number;

  mediumFindings: number;

  lowFindings: number;
}