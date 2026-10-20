export interface DockerTestInput {
  repositoryPath: string;
  testCommand: string[];
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  pidsLimit?: number;
  environment?: Record<string, string>;
  /** Docker volume holding installed node_modules, mounted over the repository's node_modules. */
  nodeModulesVolume?: string;
}

export interface DockerTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}