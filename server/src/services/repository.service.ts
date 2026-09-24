import { prisma } from "../config/prisma";

interface SaveRepositoryInput {
  githubId: string;
  name: string;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  userId: string;
}

export const saveRepository = async (
  data: SaveRepositoryInput
) => {
  return prisma.repository.upsert({
    where: {
      githubId: data.githubId,
    },
    update: {
      name: data.name,
      fullName: data.fullName,
      ownerLogin: data.ownerLogin,
      defaultBranch: data.defaultBranch,
      private: data.private,
      htmlUrl: data.htmlUrl,
      cloneUrl: data.cloneUrl,
    },
    create: data,
  });
};

export const getUserRepositories = async (
  userId: string
) => {
  return prisma.repository.findMany({
    where: {
      userId,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
};