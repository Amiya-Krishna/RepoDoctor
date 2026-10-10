import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  getAutonomousRepairQueueJob,
  queueAutonomousRepair,
  closeRepairQueue,
} from "./queue/repair.queue.js";
import { closeScanQueue } from "./queue/scan.queue.js";

const queuedId = `repair-test-${randomUUID()}`;

try {
  const queued = await queueAutonomousRepair({
    userId: "repair-test-user",
    repositoryId: "repair-test-repository",
    analysisId: "repair-test-analysis",
    findingId: "repair-test-finding",
    testCommand: ["node", "--version"],
  });

  assert.ok(queued.jobId.startsWith("repair-"));
  const job = await getAutonomousRepairQueueJob(queued.jobId);
  assert.ok(job);
  assert.equal(job?.data.analysisId, "repair-test-analysis");
  assert.deepEqual(job?.data.testCommand, ["node", "--version"]);
  assert.equal(await job?.getState(), "waiting");

  await job?.remove();
  console.log("BullMQ repair queue test passed.");
} finally {
  await closeRepairQueue();
  await closeScanQueue();
}
