export type RetryAttemptStatus =
  | "STARTED"
  | "TEST_FAILED"
  | "VERIFICATION_FAILED"
  | "VERIFIED"
  | "INCONCLUSIVE"
  | "ERROR"
  | "MAX_RETRIES_REACHED";

export interface RetryPolicy {
  maxAttempts: number;
}

export interface RetryAttemptResult {
  attemptNumber: number;
  status: RetryAttemptStatus;
  fixProposalId?: string;
  dockerTestRunId?: string;
  verificationResultId?: string;
  summary: string;
}

export interface RetryLoopResult {
  status:
    | "VERIFIED"
    | "FAILED"
    | "INCONCLUSIVE"
    | "MAX_RETRIES_REACHED"
    | "ERROR";

  attempts: RetryAttemptResult[];

  successfulAttempt?: number;
}

