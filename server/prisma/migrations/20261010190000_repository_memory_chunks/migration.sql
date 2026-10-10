CREATE TABLE "RepositoryMemoryChunk" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryMemoryChunk_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepositoryMemoryChunk_repositoryId_contentHash_key"
ON "RepositoryMemoryChunk"("repositoryId", "contentHash");

CREATE INDEX "RepositoryMemoryChunk_repositoryId_sourceType_idx"
ON "RepositoryMemoryChunk"("repositoryId", "sourceType");

ALTER TABLE "RepositoryMemoryChunk"
ADD CONSTRAINT "RepositoryMemoryChunk_repositoryId_fkey"
FOREIGN KEY ("repositoryId")
REFERENCES "Repository"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;