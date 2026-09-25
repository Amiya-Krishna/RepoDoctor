-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "framework" TEXT,
ADD COLUMN     "hasTypeScript" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "linter" TEXT,
ADD COLUMN     "packageManager" TEXT,
ADD COLUMN     "projectType" TEXT,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "sourceFileCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "testFileCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "testFramework" TEXT;
