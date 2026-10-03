import fs from "node:fs/promises";

import {
  createRepairWorkspace,
  removeRepairWorkspace,
} from "./repair/repair.workspace.js";

import {
  getCurrentBranch,
  getWorkingTreeStatus,
} from "./repair/repair.branch.js";

import {
  applyFixResult,
} from "./repair/repair.patch.js";

import type {
  FixResult,
} from "./agents/fix.types.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error(
    'Usage: npm run test:repair-workspace -- "repository-path"',
  );
}

const originalFilePath =
`${repositoryPath}/src/calculator.ts`;

const originalContent =
await fs.readFile(
  originalFilePath,
  "utf8",
);

let workspace:
Awaited<
ReturnType<typeof createRepairWorkspace>
> | undefined;

try {
  console.log(
    "\n[1] Creating isolated repair workspace...",
  );
  
  workspace =
  await createRepairWorkspace({
    sourceRepositoryPath: repositoryPath,
    analysisId: "test-analysis",
    findingId: "test-finding",
  });
  
  console.log(
    `Workspace: ${workspace.repositoryPath}`,
  );
  
  console.log(
    `Branch: ${workspace.branchName}`,
  );
  
  console.log(
    "\n[2] Verifying repair branch...",
  );
  
  const currentBranch =
  await getCurrentBranch(
    workspace.repositoryPath,
  );
  
  console.log(
    `Current branch: ${currentBranch}`,
  );
  
  if (
    currentBranch !==
    workspace.branchName
  ) {
    throw new Error(
      `Expected branch ${workspace.branchName}, got ${currentBranch}`,
    );
  }
  
  console.log(
    "\n[3] Creating test fix proposal...",
  );
  
  const fixResult: FixResult = {
    title: "Test calculator fix",
    summary:
    "Day 16 isolated repair test.",
    changes: [
      {
        filePath:
        "src/calculator.ts",
        changeType: "REPLACE",
        startLine: 1,
        endLine: 6,
        originalCode:
`export function divide(
  a: number,
  b: number
): number {
  return a / b;
}`,
        replacementCode:
`export function divide(
  a: number,
  b: number
): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
        
  return a / b;
}`,
        explanation:
        "Test replacement validation.",
      },
    ],
    risk: "LOW",
    confidence: 1,
    reasoning:
    "Synthetic Day 16 test proposal.",
  };
  
  console.log(
    "\n[4] Applying proposal inside isolated workspace...",
  );
  
  const changes =
  await applyFixResult(
    workspace.repositoryPath,
    fixResult,
  );
  
  console.log(
    `Applied changes: ${changes.length}`,
  );
  
  console.log(
    "\n[5] Checking isolated repository status...",
  );
  
  const status =
  await getWorkingTreeStatus(
    workspace.repositoryPath,
  );
  
  console.log(
    status || "(clean)",
  );
  
  console.log(
    "\n[6] Verifying ORIGINAL repository...",
  );
  
  const currentOriginalContent =
  await fs.readFile(
    originalFilePath,
    "utf8",
  );
  
  if (
    currentOriginalContent !==
    originalContent
  ) {
    throw new Error(
      "SAFETY FAILURE: original repository was modified.",
    );
  }
  
  console.log(
    "Original repository unchanged.",
  );
  
  console.log(
    "\nDay 16 repair workspace test passed.",
  );
} finally {
  if (workspace) {
    console.log(
      "\n[7] Removing temporary workspace...",
    );
    
    await removeRepairWorkspace(
      workspace.rootPath,
    );
    
    console.log(
      "Temporary workspace removed.",
    );
  }
}