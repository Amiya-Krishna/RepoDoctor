import { createAIProvider } from "./ai/ai.provider.factory.js";

import { SecurityAgent } from "./agents/security.agent.js";

import {
  buildRepositoryContext,
} from "./context/context.builder.js";

import {
  formatRepositoryContext,
} from "./context/context.formatter.js";

const main = async () => {
  const workspacePath = process.argv[2];

  if (!workspacePath) {
    throw new Error(
      "Usage: npm run test:security-agent -- <workspace-path>"
    );
  }

  console.log(
    "Building repository context..."
  );

  const context =
    await buildRepositoryContext(
      workspacePath,
      "security-test-repository",
      {
        projectType: "Node.js",
        language: "TypeScript",
        framework: "Express",
        packageManager: "npm",
      }
    );

  console.log(
    `Selected files: ${context.files.length}`
  );

  const formattedContext =
    formatRepositoryContext(context);

  console.log(
    "Creating AIProviderManager..."
  );

  const aiProvider =
    createAIProvider();

  const agent =
    new SecurityAgent(
      aiProvider
    );

  console.log(
    "Running security analysis..."
  );

  const result =
    await agent.detect(
      context,
      formattedContext
    );

  console.log(
    "\nSECURITY FINDINGS\n"
  );

  console.dir(result, {
    depth: null,
  });
};

main().catch((error) => {
  console.error(
    "Security analysis failed:",
    error
  );

  process.exit(1);
});