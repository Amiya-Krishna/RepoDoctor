export interface Repository {
  id: string;
  githubId: string;
  name: string;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Analysis {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

  projectType: string | null;
  language: string | null;
  packageManager: string | null;
  framework: string | null;
  testFramework: string | null;
  linter: string | null;

  hasTypeScript: boolean;

  sourceFileCount: number;
  testFileCount: number;

  createdAt: string;
  completedAt: string | null;
}