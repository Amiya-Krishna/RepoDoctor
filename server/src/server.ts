import "dotenv/config";
import { createServer } from "node:http";
import app from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/prisma.js";
import { initRealtime, closeRealtime } from "./realtime/socket.js";
import { closeScanQueue } from "./queue/scan.queue.js";
import { closeRepairQueue } from "./queue/repair.queue.js";
import { assertSecureConfiguration } from "./config/startup-checks.js";
import { log } from "./logging/logger.js";

const PORT = Number(process.env.PORT ?? 4000);

const startServer = async () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured");
  }
  // In production this refuses to start on missing encryption key, weak secrets, http origin, etc.
  assertSecureConfiguration("api");

  await connectDatabase();

  const httpServer = createServer(app);

  try {
    await initRealtime(httpServer);
    httpServer.listen(PORT, () => {
      log("info", "server_listening", { port: PORT });
    });
  } catch (error) {
    await closeRealtime().catch(() => undefined);
    await closeScanQueue().catch(() => undefined);
    await closeRepairQueue().catch(() => undefined);
    await disconnectDatabase();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await closeRealtime();
      await closeScanQueue();
      await closeRepairQueue();
      await disconnectDatabase();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

process.on("unhandledRejection", (reason) => {
  log("error", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

startServer().catch((error) => {
  log("error", "startup_failed", { reason: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
