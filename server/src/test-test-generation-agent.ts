import { createAIProvider } from "./ai/ai.provider.factory.js";
import { TestGenerationAgent } from "./agents/test-generation.agent.js";

import {
  buildRepositoryContext,
} from "./context/context.builder.js";

import {
  formatRepositoryContext,
} from "./context/context.formatter.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error(
    "Usage: npm run test:test-generation -- <repository-path>"
  );
}

const context = await buildRepositoryContext(
  repositoryPath,
  "test-generation-local",
  {
    projectType: "unknown",
    language: "unknown",
    framework: "unknown",
    packageManager: "unknown",
  }
);

const formattedContext =
  formatRepositoryContext(context);

const aiProvider = createAIProvider();

const agent =
  new TestGenerationAgent(aiProvider);

const result = await agent.generate(
  context,
  formattedContext
);

console.log("\n==============================");
console.log("TEST GENERATION RESULTS");
console.log("==============================\n");

console.log(
  `Generated tests: ${result.tests.length}\n`
);

for (const test of result.tests) {
  console.log(`Title: ${test.title}`);
  console.log(`Type: ${test.type}`);
  console.log(`File: ${test.filePath}`);
  console.log(
    `Target: ${test.targetFunction ?? "N/A"}`
  );
  console.log(
    `Confidence: ${test.confidence}`
  );

  console.log("\nTest Code:");
  console.log(test.testCode);

  console.log("\nRationale:");
  console.log(test.rationale);

  console.log("\n------------------------------\n");
}