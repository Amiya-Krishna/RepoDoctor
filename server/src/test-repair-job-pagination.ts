
import assert from "node:assert/strict";
import { listRepairJobs } from "./services/repair-job-history.service.js";

async function main() {
  const analysisId = process.env.ANALYSIS_ID;

  if (!analysisId) {
    throw new Error(
      "Set ANALYSIS_ID to an existing analysis ID",
    );
  }

  const firstPage = await listRepairJobs({
    analysisId,
    limit: 2,
  });

  assert.ok(firstPage.items.length <= 2);
  assert.equal(firstPage.page.limit, 2);

  if (firstPage.page.hasMore) {
    assert.ok(firstPage.page.nextCursor);

    const secondPage = await listRepairJobs({
      analysisId,
      limit: 2,
      cursor: firstPage.page.nextCursor!,
    });

    const firstIds = new Set(
      firstPage.items.map((job) => job.id),
    );

    for (const job of secondPage.items) {
      assert.ok(
        !firstIds.has(job.id),
        "Pages must not repeat a repair job",
      );
    }
  } else {
    assert.equal(firstPage.page.nextCursor, null);
  }

  const filtered = await listRepairJobs({
    analysisId,
    status: "VERIFIED",
    limit: 10,
  });

  for (const job of filtered.items) {
    assert.equal(job.analysisId, analysisId);
    assert.equal(job.status, "VERIFIED");
  }

  await assert.rejects(
    () => listRepairJobs({ analysisId, limit: 0 }),
    /limit must be an integer/,
  );

  await assert.rejects(
    () => listRepairJobs({ analysisId, limit: 51 }),
    /limit must be an integer/,
  );

  console.log("Repair job pagination tests passed.");
  console.log(`First page items: ${firstPage.items.length}`);
  console.log(`Has more: ${firstPage.page.hasMore}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
