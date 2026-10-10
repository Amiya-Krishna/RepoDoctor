
import fs from "node:fs/promises";
import path from "node:path";

import {
  evaluateBenchmark,
  type GroundTruth,
  type BenchmarkRun,
} from "./benchmark-evaluator.js";

async function main() {
  const truthPath = path.resolve(
    process.argv[2] ?? "benchmarks/ground-truth.json",
  );

  const resultsPath = path.resolve(
    process.argv[3] ?? "benchmarks/run-results.json",
  );

  const truth = JSON.parse(
    await fs.readFile(truthPath, "utf8"),
  ) as GroundTruth;

  const run = JSON.parse(
    await fs.readFile(resultsPath, "utf8"),
  ) as BenchmarkRun;

  const report = evaluateBenchmark(truth, run);

  const reportDirectory = path.resolve(
    "benchmarks/reports",
  );

  await fs.mkdir(reportDirectory, { recursive: true });

  const reportPath = path.join(
    reportDirectory,
    "latest-report.json",
  );

  await fs.writeFile(
    reportPath,
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  console.log("RepoDoctor benchmark completed.");
  console.log(
    JSON.stringify(
      {
        runId: report.runId,
        detection: report.detection,
        repair: report.repair,
        runtime: report.runtime,
        reportPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Benchmark evaluation failed:", error);
  process.exitCode = 1;
});
