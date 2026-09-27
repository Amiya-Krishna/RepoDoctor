import {
  buildRepositoryContext,
} from "./context/context.builder.js";

import {
  formatRepositoryContext,
} from "./context/context.formatter.js";

const testContext = async () => {
  const workspacePath = process.argv[2];

  if (!workspacePath) {
    throw new Error(
      "Usage: npm run test:context -- <workspace-path>"
    );
  }

  const context = await buildRepositoryContext(
    workspacePath,
    "test-repository",
    {
      projectType: "Node.js",
      language: "TypeScript",
      framework: "Express",
      packageManager: "npm",
    }
  );

  console.log("\nCONTEXT SUMMARY\n");
  console.log(`Files selected: ${context.files.length}`);

  console.log("\nSELECTED FILES\n");

  for (const file of context.files) {
    console.log(
      `${file.path} (${file.size} bytes)`
    );
  }

  console.log("\nFORMATTED CONTEXT\n");

  console.log(
    formatRepositoryContext(context)
  );
};

testContext().catch((error) => {
  console.error(error);
  process.exit(1);
});