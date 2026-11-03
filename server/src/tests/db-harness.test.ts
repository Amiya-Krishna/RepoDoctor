import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, integrationSkipReason, useDatabase } from "./db.js";

test("db helper + prisma seam work against real postgres", { skip: integrationSkipReason() }, async () => {
  const db = await createTestDatabase("smoke");
  try {
    const applied = await db.applyMigrations();
    assert.ok(applied.length >= 18);
    useDatabase(db);
    const { prisma } = await import("../config/prisma.js");
    const row = await prisma.webhookDelivery.create({ data: { deliveryId: "abcdef12-1", event: "push" } });
    assert.equal(row.status, "PENDING");
    await prisma.$disconnect();
  } finally { await db.drop(); }
});
