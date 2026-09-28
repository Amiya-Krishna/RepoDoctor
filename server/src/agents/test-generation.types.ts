export type GeneratedTestType =
  | "UNIT"
  | "INTEGRATION"
  | "EDGE_CASE"
  | "REGRESSION";

export interface GeneratedTest {
  title: string;
  description: string;
  type: GeneratedTestType;

  // Path where the generated test would be created.
  filePath: string;

  // Existing source file being tested.
  targetFilePath: string;

  targetFunction?: string;

  testCode: string;
  rationale: string;
  confidence: number;
}

export interface TestGenerationResult {
  tests: GeneratedTest[];
}