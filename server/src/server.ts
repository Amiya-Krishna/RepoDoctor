import "dotenv/config";
import { createServer } from "node:http";
import app from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/prisma.js";
import { initRealtime, closeRealtime } from "./realtime/socket.js";
import { closeScanQueue } from "./queue/scan.queue.js";
import { closeRepairQueue } from "./queue/repair.queue.js";

const PORT = Number(process.env.PORT ?? 5000);

const startServer = async () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured");
  }

  await connectDatabase();

  const httpServer = createServer(app);

  try {
    await initRealtime(httpServer);
    httpServer.listen(PORT, () => {
      console.log(`RepoDoctor API and realtime server listening on port ${PORT}`);
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

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
