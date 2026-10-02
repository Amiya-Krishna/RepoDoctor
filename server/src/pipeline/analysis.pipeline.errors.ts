export class AnalysisPipelineError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly cause?: unknown
  ) {
    super(message);

    this.name = "AnalysisPipelineError";
  }
}