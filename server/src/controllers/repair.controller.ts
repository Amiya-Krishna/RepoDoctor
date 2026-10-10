import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import {
  getAutonomousRepairQueueJob,
  queueAutonomousRepair,
} from "../queue/repair.queue.js";

const allowedCommands = new Set(["node", "npm", "npx", "pnpm", "yarn"]);

function validateTestCommand(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  if (!value.every((part) => typeof part === "string" && part.length > 0 && part.length <= 1000 && !part.includes("\0"))) {
    return null;
  }
  const command = value as string[];
  if (!allowedCommands.has(command[0])) return null;
  return command;
}

export const queueRepair = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const { analysisId, findingId } = req.body ?? {};
    const testCommand = validateTestCommand(req.body?.testCommand);

    if (typeof analysisId !== "string" || !analysisId.trim()
      || typeof findingId !== "string" || !findingId.trim()) {
      return res.status(400).json({ message: "analysisId and findingId are required" });
    }

    if (!testCommand) {
      return res.status(400).json({
        message: "testCommand must be an argument array starting with node, npm, npx, pnpm, or yarn",
      });
    }

    const analysis = await prisma.analysis.findFirst({
      where: { id: analysisId },
      include: { repository: { select: { id: true, userId: true } } },
    });

    if (!analysis || analysis.repository.userId !== userId) {
      return res.status(404).json({ message: "Analysis not found" });
    }

    const [bugFinding, securityFinding] = await Promise.all([
      prisma.bugFinding.findFirst({ where: { id: findingId, analysisId }, select: { id: true } }),
      prisma.securityFinding.findFirst({ where: { id: findingId, analysisId }, select: { id: true } }),
    ]);

    if (!bugFinding && !securityFinding) {
      return res.status(404).json({ message: "Finding not found in this analysis" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessToken: true },
    });
    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: "Connect GitHub before starting a repair" });
    }

    const queued = await queueAutonomousRepair({
      userId,
      repositoryId: analysis.repository.id,
      analysisId,
      findingId,
      testCommand,
    });

    return res.status(202).json({
      message: "Autonomous repair queued",
      jobId: queued.jobId,
      analysisId,
      findingId,
      status: "QUEUED",
    });
  } catch (error) {
    console.error("Queue autonomous repair failed", error);
    return res.status(500).json({ message: "Unable to queue repair" });
  }
};

export const getRepairQueueStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const jobId = req.params.jobId as string;
    if (!jobId?.trim()) return res.status(400).json({ message: "jobId is required" });

    const job = await getAutonomousRepairQueueJob(jobId);
    if (!job || job.data.userId !== userId) {
      return res.status(404).json({ message: "Repair job not found" });
    }

    return res.json({
      jobId: String(job.id),
      analysisId: job.data.analysisId,
      findingId: job.data.findingId,
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    });
  } catch (error) {
    console.error("Fetch repair queue status failed", error);
    return res.status(500).json({ message: "Unable to fetch repair status" });
  }
};
