export interface DockerTestInput {
  repositoryPath: string;
  testCommand: string[];
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  pidsLimit?: number;
  environment?: Record<string, string>;
}

export interface DockerTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}