export type BugSeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type BugCategory =
  | "LOGIC"
  | "RUNTIME"
  | "TYPE"
  | "ASYNC"
  | "SECURITY"
  | "PERFORMANCE"
  | "OTHER";

export interface BugFinding {
  title: string;
  description: string;
  category: BugCategory;
  severity: BugSeverity;

  filePath: string;
  lineStart: number;
  lineEnd: number;

  evidence: string;
  suggestedFix: string;

  confidence: number;
}

export interface BugDetectionResult {
  findings: BugFinding[];
}