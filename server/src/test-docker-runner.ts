import {
  runRepositoryTests,
} from "./services/test-runner.service.js";

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error(
    'Usage: npm run test:docker-runner -- "repository-path"',
  );
}

console.log(
  "\n[1] Starting Dockerized test execution...",
);

console.log(
  `Repository: ${repositoryPath}`,
);

const result =
  await runRepositoryTests(
    repositoryPath,
    [
  "node",
  "-e",
  "setTimeout(() => {}, 300000)",
],
  );

console.log(
  "\n[2] Docker execution result",
);

console.log(
  `Success: ${result.success}`,
);

console.log(
  `Exit code: ${result.exitCode}`,
);

console.log(
  `Timed out: ${result.timedOut}`,
);

console.log(
  `Duration: ${result.durationMs}ms`,
);

console.log(
  "\n--- STDOUT ---",
);

console.log(result.stdout);

console.log(
  "\n--- STDERR ---",
);

console.log(result.stderr);

if (!result.success) {
  process.exitCode = 1;
}