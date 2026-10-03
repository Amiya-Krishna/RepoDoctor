import {
  buildRepositoryContext,
} from "./context/context.builder.js";

import {
  formatRepositoryContext,
} from "./context/context.formatter.js";

import {
  createAIProvider,
} from "./ai/ai.provider.factory.js";

import {
  FixAgent,
} from "./agents/fix.agent.js";

const repositoryPath =
  process.argv[2];

if (!repositoryPath) {
  throw new Error(
    "Usage: npm run test:fix-agent -- <repository-path>"
  );
}

const context =
  await buildRepositoryContext(
    repositoryPath,
    "fix-agent-test-repository"
  );

const formattedContext =
  formatRepositoryContext(
    context
  );

const aiProvider =
  createAIProvider();

const agent =
  new FixAgent(aiProvider);

const testFile =
  context.files.find(
    (file) =>
      file.path ===
      "src/calculator.ts"
  );

if (!testFile) {
  throw new Error(
    "src/calculator.ts not found."
  );
}

const finding = {
  title: "Division by zero handling",
  description:
    "Verify that division by zero is handled safely.",
  category: "RUNTIME" as const,
  severity: "HIGH" as const,
  filePath: "src/calculator.ts",
  lineStart: 1,
  lineEnd: 10,
  evidence: testFile.content,
  suggestedFix:
    "Ensure division by zero is rejected.",
  confidence: 0.9,
};

const result =
  await agent.generateFix(
    finding,
    context,
    formattedContext
  );

console.log(
  "\n================================"
);

console.log(
  "FIX AGENT RESULT"
);

console.log(
  "================================\n"
);

console.log(
  `Title: ${result.title}`
);

console.log(
  `Summary: ${result.summary}`
);

console.log(
  `Risk: ${result.risk}`
);

console.log(
  `Confidence: ${result.confidence}`
);

console.log(
  `Reasoning: ${result.reasoning}`
);

console.log(
  "\nChanges:\n"
);

for (const change of result.changes) {
  console.log(
    `File: ${change.filePath}`
  );

  console.log(
    `Type: ${change.changeType}`
  );

  console.log(
    `Lines: ${change.startLine}-${change.endLine}`
  );

  console.log(
    "\nOriginal:"
  );

  console.log(
    change.originalCode
  );

  console.log(
    "\nReplacement:"
  );

  console.log(
    change.replacementCode
  );

  console.log(
    "\nExplanation:"
  );

  console.log(
    change.explanation
  );

  console.log(
    "\n------------------------------\n"
  );
}