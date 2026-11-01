import { describeError } from "../security/safe-error.js";
import type{ Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { getUserRepositories } from "../services/repository.service.js";
import { deleteRepositoryData } from "../services/lifecycle.service.js";

export const listRepositories = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const repositories = await getUserRepositories(userId);

    return res.json({
      repositories,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to fetch repositories",
    });
  }
};

export const getRepository = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const repositoryId = req.params.repositoryId as string;

    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        userId,
      },
    });

    if (!repository) {
      return res.status(404).json({
        message: "Repository not found",
      });
    }

    return res.json({
      repository,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to fetch repository",
    });
  }
};


export const deleteRepository = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId as string;
    const repositoryId = req.params.repositoryId as string;

    // Removes the repository and every analysis, patch, test output and repair record for it.
    const deleted = await deleteRepositoryData(userId, repositoryId);
    if (!deleted) return res.status(404).json({ message: "Repository not found" });
    return res.status(204).send();
  } catch (error) {
    console.error("Delete repository failed:", describeError(error));
    return res.status(500).json({ message: "Failed to delete repository data. Try again; nothing is reported as deleted." });
  }
};

export const setAutoScan = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId as string;
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") return res.status(400).json({ message: "enabled must be true or false" });
  const result = await prisma.repository.updateMany({
    where: { id: req.params.repositoryId as string, userId },
    data: { autoScan: enabled },
  });
  if (result.count === 0) return res.status(404).json({ message: "Repository not found" });
  return res.json({ autoScan: enabled });
};
