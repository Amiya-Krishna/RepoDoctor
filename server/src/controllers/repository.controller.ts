import type{ Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { getUserRepositories } from "../services/repository.service.js";

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

    const result = await prisma.repository.deleteMany({
      where: { id: repositoryId, userId },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repository not found" });
    }

    return res.status(204).send();
  } catch (error: any) {
    if (error?.code === "P2003") {
      return res.status(409).json({
        message: "Repository cannot be deleted while related repair records still exist",
      });
    }
    console.error("Delete repository failed", error);
    return res.status(500).json({ message: "Failed to delete repository" });
  }
};
