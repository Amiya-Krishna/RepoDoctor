import { Request, Response } from "express";
import { getUserRepositories } from "../services/repository.service";
import { prisma } from "../config/prisma";

export const listRepositories = async (
  req: Request,
  res: Response
) => {
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

export const getRepository = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.userId;
    const repositoryId = req.params.repositoryId;

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