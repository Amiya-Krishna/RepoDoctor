import {
  createAIProvider,
} from "./ai/ai.provider.factory.js";

import {
  VerificationAgent,
} from "./agents/verification.agent.js";

import type {
  BugFinding,
} from "./agents/bug-detection.types.js";

import type {
  FixResult,
} from "./agents/fix.types.js";

import type {
  DockerTestResult,
} from "./execution/docker.types.js";

const finding: BugFinding = {
  title:
    "Division by zero handling",

  description:
    "The divide function must reject division by zero.",

  category:
    "RUNTIME",

  severity:
    "HIGH",

  filePath:
    "src/calculator.ts",

  lineStart:
    1,

  lineEnd:
    10,

  evidence:
    "Division by zero is an important runtime edge case.",

  suggestedFix:
    "Ensure division by zero throws an error.",

  confidence:
    0.95,
};

const fixResult: FixResult = {
  title:
    "Protect division from zero",

  summary:
    "The divide function rejects zero denominators.",

  changes: [
    {
      filePath:
        "src/calculator.ts",

      changeType:
        "REPLACE",

      startLine:
        1,

      endLine:
        10,

      originalCode:
        "original code from isolated workspace",

      replacementCode:
        "replacement code",

      explanation:
        "Prevent invalid division.",
    },
  ],

  risk:
    "LOW",

  confidence:
    0.92,

  reasoning:
    "The proposed change addresses the reported runtime issue.",
};

const testResult: DockerTestResult = {
  success:
    true,

  exitCode:
    0,

  stdout:
    "All tests passed.",

  stderr:
    "",

  durationMs:
    1250,

  timedOut:
    false,
};

const aiProvider =
  createAIProvider();

const agent =
  new VerificationAgent(
    aiProvider,
  );

console.log(
  "\nRunning Verification Agent...",
);

const result =
  await agent.verify(
    finding,
    fixResult,
    testResult,
  );

console.log(
  "\nVerification Result:",
);

console.log(
  JSON.stringify(
    result,
    null,
    2,
  ),
);