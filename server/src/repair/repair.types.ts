export interface RepairWorkspace {
  id: string;
  rootPath: string;
  repositoryPath: string;
  branchName: string;
}

export interface RepairWorkspaceInput {
  sourceRepositoryPath: string;
  analysisId: string;
  findingId: string;
}

export interface AppliedRepairChange {
  filePath: string;
  changeType: "REPLACE" | "INSERT" | "DELETE";
  startLine: number;
  endLine: number;
}

export interface RepairResult {
  workspace: RepairWorkspace;
  changes: AppliedRepairChange[];
}