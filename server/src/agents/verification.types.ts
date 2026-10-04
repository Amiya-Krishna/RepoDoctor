export type VerificationStatus =
  | "VERIFIED"
  | "FAILED"
  | "INCONCLUSIVE"
  | "ERROR";

export interface VerificationResult {
  status: VerificationStatus;
  title: string;
  summary: string;
  confidence: number;
  evidence: string[];
  reasoning: string;
  testPassed: boolean;
  regressionDetected: boolean;
}