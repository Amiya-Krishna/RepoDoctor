import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ingestRepository } from "../services/ingestion.service";

export const ingest = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.userId;

    const { repositoryId } = req.body;

    if (!repositoryId) {
      return res.status(400).json({
        message: "repositoryId is required",
      });
    }

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

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user?.githubAccessToken) {
      return res.status(400).json({
        message: "GitHub is not connected",
      });
    }

    const result = await ingestRepository({
      cloneUrl: repository.cloneUrl,
      accessToken: user.githubAccessToken,
      defaultBranch: repository.defaultBranch,
    });

    return res.json({
      message: "Repository ingested successfully",
      workspaceId: result.workspaceId,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Repository ingestion failed",
    });
  }
};