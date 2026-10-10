
import assert from "node:assert/strict";

import { chunkText, redactSecrets } from "./rag/chunker.js";
import {
  cosineSimilarity,
  createLexicalEmbedding,
} from "./rag/lexical-embedding.js";
import {
  indexRepositoryMemory,
  retrieveRepositoryMemory,
} from "./services/repository-memory.service.js";
import { prisma } from "./config/prisma.js";

async function main() {
  // 1. Chunking and overlap
  const chunks = chunkText(
    "line one\nline two\nline three\nline four\nline five",
    3,
    1,
  );

  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].content.includes("line three"));
  assert.ok(chunks[1].content.includes("line three"));

  // 2. Basic secret redaction
  const redacted = redactSecrets(
    'API_KEY="example-secret-value"',
  );

  assert.ok(redacted.includes("[REDACTED]"));
  assert.ok(!redacted.includes("example-secret-value"));

  // 3. Embedding properties
  const vector = createLexicalEmbedding(
    "authorization access control security",
  );

  assert.equal(vector.length, 384);
  assert.ok(
    cosineSimilarity(vector, vector) > 0.99,
    "A vector should have near-perfect similarity to itself",
  );

  assert.deepEqual(
    createLexicalEmbedding("same deterministic input"),
    createLexicalEmbedding("same deterministic input"),
  );

  console.log("RAG utility tests passed.");

  // 4. Optional PostgreSQL integration test
  const repositoryId = process.env.REPOSITORY_ID;
  const repositoryPath = process.env.REPOSITORY_PATH;

  if (!repositoryId || !repositoryPath) {
    console.log(
      "Database integration skipped. Set REPOSITORY_ID and REPOSITORY_PATH to run it.",
    );
    return;
  }

  const indexed = await indexRepositoryMemory(
    repositoryPath,
    repositoryId,
  );

  assert.ok(indexed.indexedChunks > 0);

  const results = await retrieveRepositoryMemory(
    repositoryId,
    "repository architecture previous bugs security fixes",
    5,
  );

  assert.ok(results.length <= 5);

  for (const result of results) {
    assert.ok(result.sourcePath.length > 0);
    assert.ok(result.content.length > 0);
    assert.ok(Number.isFinite(result.score));
  }

  console.log(
    `RAG integration passed: indexed ${indexed.indexedChunks} chunks; retrieved ${results.length}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
