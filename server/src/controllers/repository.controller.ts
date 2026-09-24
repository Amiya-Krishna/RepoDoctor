import { Request, Response } from "express";
import { getUserRepositories } from "../services/repository.service";

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