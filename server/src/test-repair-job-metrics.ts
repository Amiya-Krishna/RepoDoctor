
import assert from "node:assert/strict";
import { prisma } from "./config/prisma.js";
import { getRepairJobMetrics } from "./services/repair-job-metrics.service.js";

async function main() {
  const analysisId = process.env.ANALYSIS_ID;

  assert.ok(analysisId, "Set ANALYSIS_ID before running this test");

  const metrics = await getRepairJobMetrics(analysisId!);

  assert.equal(metrics.analysisId, analysisId);
  assert.ok(metrics.totalJobs >= 0);

  const groupedTotal = metrics.statuses.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  assert.equal(groupedTotal, metrics.totalJobs);

  for (const item of metrics.statuses) {
    assert.ok(item.count > 0);
    assert.ok(item.status.length > 0);
  }

  await assert.rejects(
    () => getRepairJobMetrics(""),
    /analysisId is required/,
  );

  console.log("Repair job metrics tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
