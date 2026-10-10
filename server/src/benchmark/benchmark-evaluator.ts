
export interface ExpectedFinding {
  id: string;
  filePath: string;
  category: string;
  severity?: string;
}

export interface DetectedFinding {
  filePath: string;
  category: string;
  severity?: string;
}

export interface GroundTruth {
  datasetName: string;
  version: string;
  findings: ExpectedFinding[];
}

export interface RepairResult {
  caseId: string;
  attempted: boolean;
  testsPassed: boolean;
  verified: boolean;
  prCreated: boolean;
  attempts: number;
  durationMs: number;
}

export interface BenchmarkRun {
  runId: string;
  startedAt: string;
  completedAt: string;
  findings: DetectedFinding[];
  repairs: RepairResult[];
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function normalizeCategory(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function validateInputs(
  truth: GroundTruth,
  run: BenchmarkRun,
): void {
  if (!truth.findings.length) {
    throw new Error("Ground truth must contain findings");
  }

  if (!run.runId.trim()) {
    throw new Error("runId is required");
  }

  const ids = new Set<string>();

  for (const finding of truth.findings) {
    if (
      !finding.id ||
      !finding.filePath ||
      !finding.category ||
      ids.has(finding.id)
    ) {
      throw new Error(
        "Ground truth findings need unique IDs, paths and categories",
      );
    }

    ids.add(finding.id);
  }

  for (const finding of run.findings) {
    if (!finding.filePath || !finding.category) {
      throw new Error(
        "Detected findings need filePath and category",
      );
    }
  }

  const repairIds = new Set<string>();

  for (const repair of run.repairs) {
    if (
      !repair.caseId ||
      repairIds.has(repair.caseId) ||
      !Number.isInteger(repair.attempts) ||
      repair.attempts < 0 ||
      !Number.isFinite(repair.durationMs) ||
      repair.durationMs < 0
    ) {
      throw new Error("Invalid repair benchmark result");
    }

    if (
      (repair.verified || repair.testsPassed || repair.prCreated) &&
      !repair.attempted
    ) {
      throw new Error(
        "A repair cannot pass tests, verify or publish without being attempted",
      );
    }

    if (repair.prCreated && !repair.verified) {
      throw new Error(
        "A benchmark PR cannot be marked created for an unverified repair",
      );
    }

    repairIds.add(repair.caseId);
  }
}

export function evaluateBenchmark(
  truth: GroundTruth,
  run: BenchmarkRun,
) {
  validateInputs(truth, run);

  const unmatched = new Set(
    run.findings.map((_, index) => index),
  );

  let truePositives = 0;
  let falseNegatives = 0;

  const matches: Array<{
    expectedId: string;
    detectedIndex: number;
  }> = [];

  for (const expected of truth.findings) {
    const matchIndex = [...unmatched].find((index) => {
      const detected = run.findings[index];

      return (
        normalizePath(detected.filePath) ===
          normalizePath(expected.filePath) &&
        normalizeCategory(detected.category) ===
          normalizeCategory(expected.category)
      );
    });

    if (matchIndex === undefined) {
      falseNegatives++;
      continue;
    }

    truePositives++;
    unmatched.delete(matchIndex);

    matches.push({
      expectedId: expected.id,
      detectedIndex: matchIndex,
    });
  }

  const falsePositives = unmatched.size;
  const precision = ratio(
    truePositives,
    truePositives + falsePositives,
  );
  const recall = ratio(
    truePositives,
    truePositives + falseNegatives,
  );

  const f1 = ratio(
    2 * precision * recall,
    precision + recall,
  );

  const attemptedRepairs = run.repairs.filter(
    (repair) => repair.attempted,
  );

  const verifiedRepairs = attemptedRepairs.filter(
    (repair) => repair.verified,
  );

  const passedTests = attemptedRepairs.filter(
    (repair) => repair.testsPassed,
  );

  const createdPRs = attemptedRepairs.filter(
    (repair) => repair.prCreated,
  );

  const totalAttempts = attemptedRepairs.reduce(
    (sum, repair) => sum + repair.attempts,
    0,
  );

  const totalRepairDuration = attemptedRepairs.reduce(
    (sum, repair) => sum + repair.durationMs,
    0,
  );

  const elapsedMs =
    Date.parse(run.completedAt) - Date.parse(run.startedAt);

  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  ) {
    throw new Error("Invalid benchmark run timestamps");
  }

  return {
    dataset: {
      name: truth.datasetName,
      version: truth.version,
    },
    runId: run.runId,
    detection: {
      expectedFindings: truth.findings.length,
      detectedFindings: run.findings.length,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
      falseDiscoveryRate: ratio(
        falsePositives,
        truePositives + falsePositives,
      ),
      matches,
    },
    repair: {
      attempted: attemptedRepairs.length,
      verified: verifiedRepairs.length,
      testsPassed: passedTests.length,
      pullRequestsCreated: createdPRs.length,
      verificationRate: ratio(
        verifiedRepairs.length,
        attemptedRepairs.length,
      ),
      testPassRate: ratio(
        passedTests.length,
        attemptedRepairs.length,
      ),
      prCreationRate: ratio(
        createdPRs.length,
        verifiedRepairs.length,
      ),
      averageAttempts: ratio(
        totalAttempts,
        attemptedRepairs.length,
      ),
      averageRepairDurationMs: ratio(
        totalRepairDuration,
        attemptedRepairs.length,
      ),
    },
    runtime: {
      elapsedMs,
    },
  };
}
