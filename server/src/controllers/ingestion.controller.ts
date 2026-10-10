import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import {
  getRepositoryScanJob,
  queueRepositoryScan,
} from "../queue/scan.queue.js";

export const ingest = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const repositoryId = req.body?.repositoryId;

    if (typeof repositoryId !== "string" || !repositoryId.trim()) {
      return res.status(400).json({ message: "repositoryId is required" });
    }

    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId },
      select: { id: true, defaultBranch: true },
    });

    if (!repository) {
      return res.status(404).json({ message: "Repository not found" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessToken: true },
    });

    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: "GitHub is not connected" });
    }

    const queued = await queueRepositoryScan({
      repositoryId: repository.id,
      userId,
      trigger: "manual",
      ref: repository.defaultBranch,
    });

    return res.status(202).json({
      message: "Repository scan queued",
      jobId: queued.jobId,
      repositoryId: repository.id,
      status: "QUEUED",
    });
  } catch (error) {
    console.error("Queue repository scan failed", error);
    return res.status(500).json({ message: "Unable to queue repository scan" });
  }
};

export const getScanJobStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const jobId = req.params.jobId as string;

    if (!jobId?.trim()) {
      return res.status(400).json({ message: "jobId is required" });
    }

    const job = await getRepositoryScanJob(jobId);
    if (!job || job.data.userId !== userId) {
      return res.status(404).json({ message: "Scan job not found" });
    }

    return res.json({
      jobId: String(job.id),
      repositoryId: job.data.repositoryId,
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    });
  } catch (error) {
    console.error("Fetch scan job status failed", error);
    return res.status(500).json({ message: "Unable to fetch scan job status" });
  }
};
