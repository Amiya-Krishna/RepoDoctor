export interface DockerTestInput {
  repositoryPath: string;
  testCommand: string[];
  timeoutMs?: number;
  memoryLimit?: string;
  cpuLimit?: string;
  pidsLimit?: number;
  environment?: Record<string, string>;
  /** Docker volumes holding installed node_modules, mounted over each package folder's node_modules. */
  nodeModulesVolumes?: { name: string; directory: string }[];
  /** Folder (relative to the repository root) the command runs in. Default: the root. */
  workingDirectory?: string;
}

export interface DockerTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** Set when the run did not complete (timeout, Docker failure, output overflow). */
  errorMessage?: string;
}