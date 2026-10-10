import type{ Request, Response } from "express";
import { prisma } from "../config/prisma.js";

export const getLatestAnalysis = async (req: Request, res: Response) => {
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

    const analysis = await prisma.analysis.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: "desc" },
      include: {
        bugFindings: {
          select: {
            id: true, title: true, description: true, category: true,
            severity: true, filePath: true, lineStart: true, lineEnd: true,
            evidence: true, suggestedFix: true, confidence: true,
          },
        },
        securityFindings: {
          select: {
            id: true, title: true, description: true, category: true,
            severity: true, filePath: true, lineStart: true, lineEnd: true,
            evidence: true, suggestedFix: true, confidence: true,
          },
        },
        generatedTests: {
          select: {
            id: true, title: true, description: true, type: true,
            filePath: true, targetFunction: true, testCode: true,
            rationale: true, confidence: true,
          },
        },
        riskAssessments: {
          select: {
            id: true, findingId: true, source: true, score: true,
            level: true, priority: true, factors: true,
          },
        },
      },
    });

    if (!analysis) {
      return res.status(404).json({
        message: "No analysis found",
      });
    }

    return res.json({
      analysis,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to fetch latest analysis",
    });
  }
};

export const getRepositoryAnalyses = async (req: Request, res: Response) => {
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

    const analyses = await prisma.analysis.findMany({
      where: {
        repositoryId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        status: true,
        projectType: true,
        language: true,
        packageManager: true,
        framework: true,
        testFramework: true,
        linter: true,
        hasTypeScript: true,
        sourceFileCount: true,
        testFileCount: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return res.json({
      analyses,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to fetch analyses",
    });
  }
};