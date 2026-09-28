export type SecuritySeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type SecurityCategory =
  | "SECRET_EXPOSURE"
  | "INJECTION"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "CRYPTOGRAPHY"
  | "INPUT_VALIDATION"
  | "PATH_TRAVERSAL"
  | "SSRF"
  | "COMMAND_EXECUTION"
  | "DATA_EXPOSURE"
  | "INSECURE_CONFIGURATION"
  | "DEPENDENCY"
  | "OTHER";

export interface SecurityFinding {
  title: string;
  description: string;

  category: SecurityCategory;
  severity: SecuritySeverity;

  filePath: string;
  lineStart: number;
  lineEnd: number;

  evidence: string;
  suggestedFix: string;

  confidence: number;
}

export interface SecurityDetectionResult {
  findings: SecurityFinding[];
}