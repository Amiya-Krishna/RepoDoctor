export interface DockerTestInput {
  repositoryPath: string;
  testCommand: string[];
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  pidsLimit?: number;
}

export interface DockerTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}