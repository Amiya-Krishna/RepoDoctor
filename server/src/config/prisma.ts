import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient instance across the app instead of creating
// a new one in every controller/service.
export const prisma = new PrismaClient();

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();

  console.log("PostgreSQL connected successfully");
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
