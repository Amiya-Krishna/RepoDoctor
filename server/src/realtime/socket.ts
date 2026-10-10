import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import { QueueEvents } from "bullmq";
import { redisConnection, SCAN_QUEUE_NAME, scanQueue } from "../queue/scan.queue.js";
import { REPAIR_QUEUE_NAME, repairQueue } from "../queue/repair.queue.js";

interface TokenPayload {
  userId?: string;
}

let io: Server | undefined;
let scanEvents: QueueEvents | undefined;
let repairEvents: QueueEvents | undefined;

const userRoom = (userId: string) => `user:${userId}`;

function readToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.replace(/^Bearer\s+/i, "");
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === "string") {
    return authorization.replace(/^Bearer\s+/i, "");
  }

  return undefined;
}

function parseProgress(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }

  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

export async function initRealtime(httpServer: HttpServer): Promise<Server> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for WebSocket authentication");

  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = readToken(socket);
    if (!token) return next(new Error("Authentication required"));

    try {
      const payload = jwt.verify(token, secret) as TokenPayload;
      if (!payload.userId) return next(new Error("Invalid authentication token"));
      socket.data.userId = payload.userId;
      return next();
    } catch {
      return next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(userRoom(socket.data.userId as string));
  });

  scanEvents = new QueueEvents(SCAN_QUEUE_NAME, { connection: redisConnection });
  await scanEvents.waitUntilReady();

  scanEvents.on("progress", ({ jobId, data }) => {
    const progress = parseProgress(data);
    if (!progress || typeof progress.userId !== "string") return;
    const { userId, ...clientProgress } = progress;
    io?.to(userRoom(userId)).emit("scan:progress", {
      ...clientProgress,
      jobId,
    });
  });

  scanEvents.on("completed", ({ jobId }) => {
    void (async () => {
      const job = await scanQueue.getJob(jobId);
      if (!job) return;
      io?.to(userRoom(job.data.userId)).emit("scan:completed", {
        jobId,
        repositoryId: job.data.repositoryId,
        result: job.returnvalue,
      });
    })().catch((error) => console.error("Unable to publish scan completion", error));
  });

  scanEvents.on("failed", ({ jobId, failedReason }) => {
    void (async () => {
      const job = await scanQueue.getJob(jobId);
      if (!job) return;

      const state = await job.getState();
      if (state === "waiting" || state === "delayed" || state === "waiting-children") {
        io?.to(userRoom(job.data.userId)).emit("scan:progress", {
          jobId,
          repositoryId: job.data.repositoryId,
          stage: "retrying",
          status: "RETRYING",
          message: "A scan attempt failed; BullMQ will retry the job",
          percent: 0,
        });
        return;
      }

      io?.to(userRoom(job.data.userId)).emit("scan:failed", {
        jobId,
        repositoryId: job.data.repositoryId,
        message: failedReason || "Repository scan failed",
      });
    })().catch((error) => console.error("Unable to publish scan failure", error));
  });

  repairEvents = new QueueEvents(REPAIR_QUEUE_NAME, { connection: redisConnection });
  await repairEvents.waitUntilReady();

  repairEvents.on("progress", ({ jobId, data }) => {
    const progress = parseProgress(data);
    if (!progress || typeof progress.userId !== "string") return;
    const { userId, ...clientProgress } = progress;
    io?.to(userRoom(userId)).emit("repair:progress", { ...clientProgress, jobId });
  });

  repairEvents.on("completed", ({ jobId }) => {
    void (async () => {
      const job = await repairQueue.getJob(jobId);
      if (!job) return;
      io?.to(userRoom(job.data.userId)).emit("repair:completed", {
        jobId,
        analysisId: job.data.analysisId,
        findingId: job.data.findingId,
        result: job.returnvalue,
      });
    })().catch((error) => console.error("Unable to publish repair completion", error));
  });

  repairEvents.on("failed", ({ jobId, failedReason }) => {
    void (async () => {
      const job = await repairQueue.getJob(jobId);
      if (!job) return;
      io?.to(userRoom(job.data.userId)).emit("repair:failed", {
        jobId,
        analysisId: job.data.analysisId,
        findingId: job.data.findingId,
        message: failedReason || "Autonomous repair failed",
      });
    })().catch((error) => console.error("Unable to publish repair failure", error));
  });

  return io;
}

export async function closeRealtime(): Promise<void> {
  if (scanEvents) {
    await scanEvents.close();
    scanEvents = undefined;
  }
  if (repairEvents) {
    await repairEvents.close();
    repairEvents = undefined;
  }

  if (io) {
    await new Promise<void>((resolve) => io!.close(() => resolve()));
    io = undefined;
  }
}
