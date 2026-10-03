export type FixChangeType =
  | "REPLACE"
  | "INSERT"
  | "DELETE";

export type FixRisk =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export interface FixChange {
  filePath: string;

  changeType: FixChangeType;

  startLine: number;

  endLine: number;

  originalCode: string;

  replacementCode: string;

  explanation: string;
}

export interface FixResult {
  title: string;

  summary: string;

  changes: FixChange[];

  risk: FixRisk;

  confidence: number;

  reasoning: string;
}