import {
  execFile as execFileCallback,
} from "node:child_process";

import {
  promisify,
} from "node:util";

import {
  mkdtemp,
  writeFile,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  publishVerifiedRepair,
} from "./services/pull-request.service.js";

import type {
  RepairWorkspace,
} from "./repair/repair.types.js";

import type {
  VerificationResult,
} from "./agents/verification.types.js";

const execFile =
  promisify(execFileCallback);

const repositoryPath =
  process.argv[2];

if (!repositoryPath) {
  throw new Error(
    'Usage: npm run test:github-pr -- "F:\\RepoDoctor\\test-generation-repo"',
  );
};

const runGit = async (
  cwd: string,
  args: string[],
) => {
  return execFile(
    "git",
    args,
    {
      cwd,
      maxBuffer: 2_000_000,
    },
  );
};

const uniqueBranch =
  `repodoctor/test/day20-${Date.now()}`;

const temporaryRoot =
  await mkdtemp(
    join(
      tmpdir(),
      "repodoctor-day20-",
    ),
  );

const workspacePath =
  join(
    temporaryRoot,
    "repository",
  );

const workspace: RepairWorkspace = {
  id: `day20-test-${Date.now()}`,

  rootPath:
    temporaryRoot,

  repositoryPath:
    workspacePath,

  branchName:
    uniqueBranch,
};

try {
  console.log(
    "================================",
  );

  console.log(
    "DAY 20 GITHUB PR TEST",
  );

  console.log(
    "================================",
  );

  console.log(
    `Source repository: ${repositoryPath}`,
  );

  console.log(
    `Test branch: ${uniqueBranch}`,
  );

  /*
   * Make sure the source repository is clean.
   * The source repository itself will NOT be modified.
   */
  const {
    stdout: sourceStatus,
  } = await runGit(
    repositoryPath,
    [
      "status",
      "--porcelain",
    ],
  );

  if (sourceStatus.trim()) {
    throw new Error(
      "Source repository must have a clean working tree.",
    );
  }

  /*
   * Create an isolated Git worktree and branch.
   */
  console.log(
    "\nCreating isolated worktree...",
  );

  await runGit(
    repositoryPath,
    [
      "worktree",
      "add",
      "-b",
      uniqueBranch,
      workspacePath,
      "main",
    ],
  );

  console.log(
    "Isolated worktree created.",
  );

  /*
   * Controlled change used only to verify
   * the commit/push/PR pipeline.
   */
  const testFile =
    join(
      workspacePath,
      "repodoctor-day20-test.txt",
    );

  await writeFile(
    testFile,
    [
      "RepoDoctor Day 20 GitHub PR integration test.",
      `Branch: ${uniqueBranch}`,
      "This file was created by the automated test.",
    ].join("\n"),
    "utf8",
  );

  /*
   * Synthetic VERIFIED result.
   *
   * This test is specifically testing the GitHub
   * publishing layer, not the repair/verification layer.
   */
  const verification: VerificationResult = {
    status: "VERIFIED",

    title:
      "Day 20 GitHub PR integration test",

    summary:
      "Controlled verified result used to test GitHub PR publishing.",

    confidence: 1,

    evidence: [
      "Controlled Day 20 integration test.",
      "The GitHub publishing layer received VERIFIED status.",
    ],

    reasoning:
      "This test intentionally supplies a valid VERIFIED result so the GitHub branch, commit, push, and PR flow can be exercised.",

    testPassed: true,

    regressionDetected: false,
  };

  console.log(
    "\nPublishing verified repair...",
  );

  const result =
    await publishVerifiedRepair(
      workspace,
      verification,
      "test: RepoDoctor Day 20 GitHub PR",
      [
        "This is an automated RepoDoctor Day 20 integration test.",
        "",
        "The repair was intentionally marked VERIFIED to test:",
        "- verification gate",
        "- isolated repair branch",
        "- commit creation",
        "- GitHub push",
        "- Pull Request creation",
        "",
        "This PR must NOT be automatically merged.",
      ].join("\n"),
    );

  console.log(
    "\n================================",
  );

  console.log(
    "DAY 20 TEST PASSED",
  );

  console.log(
    "================================",
  );

  console.log(
    `Commit: ${result.commitSha}`,
  );

  console.log(
    `PR number: ${result.pullRequest.number}`,
  );

  console.log(
    `PR URL: ${result.pullRequest.htmlUrl}`,
  );

} catch (error) {
  console.error(
    "\n================================",
  );

  console.error(
    "DAY 20 TEST FAILED",
  );

  console.error(
    "================================",
  );

  console.error(
    error instanceof Error
      ? error.message
      : String(error),
  );

  process.exitCode = 1;

} finally {
  /*
   * Remove only the temporary worktree.
   * The GitHub branch and PR remain available
   * for inspection.
   */
  try {
    await runGit(
      repositoryPath,
      [
        "worktree",
        "remove",
        "--force",
        workspacePath,
      ],
    );
  } catch {
    // Cleanup failure should not hide the actual test result.
  }

  await rm(
    temporaryRoot,
    {
      recursive: true,
      force: true,
    },
  );
}