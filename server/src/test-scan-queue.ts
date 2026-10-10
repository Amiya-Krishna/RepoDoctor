import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  closeScanQueue,
  getRepositoryScanJob,
  queueRepositoryScan,
} from "./queue/scan.queue.js";

const jobId = `test-${randomUUID()}`;

try {
  const queued = await queueRepositoryScan(
    {
      repositoryId: "queue-test-repository",
      userId: "queue-test-user",
      trigger: "manual",
    },
    jobId,
  );

  assert.equal(queued.jobId, jobId);

  const job = await getRepositoryScanJob(jobId);
  assert.ok(job, "queued job should be retrievable");
  assert.equal(job?.data.repositoryId, "queue-test-repository");
  assert.equal(job?.data.userId, "queue-test-user");
  assert.equal(await job?.getState(), "waiting");

  await job?.remove();
  console.log("BullMQ scan queue test passed.");
} finally {
  await closeScanQueue();
}
