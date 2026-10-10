import assert from "node:assert/strict";
import { scanStaticSecurity } from "./security/static-security-scanner.js";
import type { RepositoryContext } from "./context/context.types.js";

const context: RepositoryContext = {
  repositoryId: "static-security-test",
  files: [
    {
      path: "src/example.ts",
      language: "typescript",
      size: 150,
      content: [
        'const apiKey = "sk_live_123456789abcdef";',
        'eval(userInput);',
        'exec("cat " + userInput);',
        'const safe = process.env.API_KEY;',
      ].join("\n"),
    },
  ],
};

const findings = scanStaticSecurity(context);
assert.ok(findings.some((finding) => finding.category === "SECRET_EXPOSURE"));
assert.ok(findings.some((finding) => finding.category === "INJECTION"));
assert.ok(findings.some((finding) => finding.category === "COMMAND_EXECUTION"));
assert.ok(!findings.some((finding) => finding.evidence.includes("sk_live_123456789abcdef")));
assert.ok(!findings.some((finding) => finding.title === "Possible hardcoded secret" && finding.lineStart === 4));
console.log("Static security scanner tests passed.");
