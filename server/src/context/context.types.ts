export interface ContextFile {
  path: string;
  content: string;
  language: string;
  size: number;
}

export interface RepositoryContext {
  repositoryId: string;
  projectType?: string;
  language?: string;
  framework?: string;
  packageManager?: string;
  files: ContextFile[];
}