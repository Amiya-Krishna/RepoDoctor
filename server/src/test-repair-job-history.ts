
import assert from "node:assert/strict";
import { getRepairJobHistory } from "./services/repair-job-history.service.js";

async function main() {
  const repairJobId = process.env.REPAIR_JOB_ID;

  if (!repairJobId) {
    throw new Error(
      "Set REPAIR_JOB_ID to an existing RepairJob id",
    );
  }

  const job = await getRepairJobHistory(repairJobId);

  assert.ok(job, "Repair job should exist");

  const attempts = job.attemptHistory;

  for (let index = 0; index < attempts.length; index++) {
    assert.equal(
      attempts[index].attemptNumber,
      index + 1,
      "Attempt numbers should be sequential",
    );
  }

  console.log("Repair job history read successfully.");
  console.log(`Repair job ID: ${job.id}`);
  console.log(`Recorded attempts: ${attempts.length}`);
}

main().catch((error: unknown) => {
  console.error("Repair job history test failed:", error);
  process.exitCode = 1;
});
