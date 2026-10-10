import type { RetryAttemptResult } from "../repair/retry/retry.types.js";

export type AutonomousRepairStatus =
  | "VERIFIED"
  | "FAILED"
  | "INCONCLUSIVE"
  | "MAX_RETRIES_REACHED"
  | "ERROR";

export interface AutonomousRepairResult {
  status: AutonomousRepairStatus;
  repairJobId?: string;

  analysisId: string;
  findingId: string;

  attempts: RetryAttemptResult[];

  successfulAttempt?: number;

  pullRequest?: {
    number: number;
    url: string;
    branchName: string;
    commitSha: string;
  };
}