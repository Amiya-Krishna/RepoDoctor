import type { DockerTestResult } from "../../execution/docker.types.js";
import type { VerificationResult } from "../../agents/verification.types.js";
import type { FixResult } from "../../agents/fix.types.js";

export interface PriorFailure {
  attemptNumber: number;
  errorSummary: string;
  patchSummary?: string;
}

export interface ReplanningContext {
  attemptNumber: number;
  previousTestResult: DockerTestResult;
  previousVerification: VerificationResult;
  previousFixResult?: FixResult;
  priorFailures?: PriorFailure[];
}

export interface ExtractedErrorDiagnostic {
  category: "ESM_EXPORT_MISMATCH" | "MODULE_NOT_FOUND" | "ASSERTION_FAILURE" | "SYNTAX_ERROR" | "GENERAL_FAILURE";
  summary: string;
  details: string;
  targetFile?: string;
  missingExport?: string;
  actionableGuidance: string;
}

export const extractErrorDiagnostic = (
  testResult: DockerTestResult,
  verification?: VerificationResult,
): ExtractedErrorDiagnostic => {
  const combinedOutput = `${testResult.stderr || ""}\n${testResult.stdout || ""}`;

  // 1. Missing named export in ES Module
  const namedExportMatch = combinedOutput.match(
    /SyntaxError:\s*The requested module\s*['"](?<module>[^'"]+)['"]\s*does not provide an export named\s*['"](?<export>[^'"]+)['"]/i,
  );
  if (namedExportMatch?.groups) {
    const mod = namedExportMatch.groups.module;
    const exp = namedExportMatch.groups.export;
    return {
      category: "ESM_EXPORT_MISMATCH",
      summary: `Missing named export '${exp}' from module '${mod}' in ES Module environment.`,
      targetFile: mod,
      missingExport: exp,
      details: namedExportMatch[0],
      actionableGuidance: [
        `The project is configured as an ES Module ("type": "module" in package.json).`,
        `The test file imports named export '${exp}' via 'import { ${exp} } from "${mod}"'.`,
        `However, '${mod}' was either exported using CommonJS ('module.exports = ...') or is missing named export '${exp}'.`,
        `CommonJS 'module.exports' is completely incompatible with ES Module named imports in Node.js.`,
        `FIX REQUIRED: In '${mod}', define and export '${exp}' as a named export using ES Module syntax:`,
        `  export function ${exp}(...) { ... }`,
        `Do NOT use 'module.exports = ...' or change test imports to default imports.`,
      ].join("\n"),
    };
  }

  // 2. Missing default export in ES Module
  const defaultExportMatch = combinedOutput.match(
    /SyntaxError:\s*The requested module\s*['"](?<module>[^'"]+)['"]\s*does not provide an export named\s*['"]default['"]/i,
  );
  if (defaultExportMatch?.groups) {
    const mod = defaultExportMatch.groups.module;
    return {
      category: "ESM_EXPORT_MISMATCH",
      summary: `Missing default export from module '${mod}'.`,
      targetFile: mod,
      details: defaultExportMatch[0],
      actionableGuidance: [
        `The test attempted a default import from '${mod}', but the module does not provide 'export default'.`,
        `Ensure source exports match what the tests expect. Prefer named exports ('export function ...') when tests expect named imports.`,
      ].join("\n"),
    };
  }

  // 3. CommonJS variable in ES Module scope
  const cjsInEsmMatch = combinedOutput.match(
    /ReferenceError:\s*(?<var>module|exports|require)\s*is not defined in ES module scope/i,
  );
  if (cjsInEsmMatch?.groups) {
    const varName = cjsInEsmMatch.groups.var;
    return {
      category: "ESM_EXPORT_MISMATCH",
      summary: `Attempted to use CommonJS identifier '${varName}' in an ES Module.`,
      details: cjsInEsmMatch[0],
      actionableGuidance: [
        `This file is evaluated as an ES Module, where '${varName}' is not defined.`,
        `Replace CommonJS '${varName}' statements with standard ES Module 'export' / 'import' statements.`,
      ].join("\n"),
    };
  }

  // 4. Module Not Found
  const notFoundMatch =
    combinedOutput.match(/Error\s*\[ERR_MODULE_NOT_FOUND\]:\s*Cannot find module\s*['"](?<module>[^'"]+)['"]/i) ||
    combinedOutput.match(/Cannot find module\s*['"](?<module>[^'"]+)['"]/i);
  if (notFoundMatch?.groups) {
    const mod = notFoundMatch.groups.module;
    return {
      category: "MODULE_NOT_FOUND",
      summary: `Cannot find module '${mod}'.`,
      targetFile: mod,
      details: notFoundMatch[0],
      actionableGuidance: [
        `Node.js cannot find module '${mod}'.`,
        `In Node.js ES Modules, local relative imports must include the file extension (e.g. './src/utils.js') and reference an existing file.`,
      ].join("\n"),
    };
  }

  // 5. Test Assertion Failure
  const assertionMatch =
    combinedOutput.match(/(?<err>Error:\s*.*failed.*|AssertionError.*|expected.*got.*)/i) ||
    combinedOutput.match(/(?<err>FAIL.*)/i);
  if (assertionMatch?.groups?.err) {
    const errText = assertionMatch.groups.err.trim();
    return {
      category: "ASSERTION_FAILURE",
      summary: `Test assertion failed: ${errText}`,
      details: errText,
      actionableGuidance: [
        `The test executed but failed assertion: ${errText}`,
        `Fix the logical computation in the implementation file so it returns the expected value.`,
        `Do NOT delete, weaken, or skip the test assertions.`,
      ].join("\n"),
    };
  }

  // 6. General SyntaxError
  const syntaxMatch = combinedOutput.match(/SyntaxError:\s*(?<msg>[^\n]+)/i);
  if (syntaxMatch?.groups?.msg) {
    return {
      category: "SYNTAX_ERROR",
      summary: `Syntax error: ${syntaxMatch.groups.msg}`,
      details: syntaxMatch[0],
      actionableGuidance: `Correct the invalid JavaScript/TypeScript syntax in the target file.`,
    };
  }

  // Default fallback
  const fallbackSummary =
    verification?.summary ||
    testResult.errorMessage ||
    (testResult.exitCode !== null ? `Test process exited with non-zero code ${testResult.exitCode}` : "Test execution failed");

  return {
    category: "GENERAL_FAILURE",
    summary: fallbackSummary,
    details: (testResult.stderr || testResult.stdout || "").slice(-500).trim(),
    actionableGuidance: `Analyze the test output and propose a fix that directly resolves the error.`,
  };
};

export const buildReplanningContext = (
  context: ReplanningContext,
): string => {
  const diagnostic = extractErrorDiagnostic(
    context.previousTestResult,
    context.previousVerification,
  );

  const lines: string[] = [
    "============================================================",
    `PREVIOUS REPAIR ATTEMPT FAILED (Attempt ${context.attemptNumber - 1})`,
    "============================================================",
    `Failure Category: ${diagnostic.category}`,
    `Failure Summary:  ${diagnostic.summary}`,
    "",
    "ROOT CAUSE DIAGNOSTIC & REQUIRED FIX:",
    diagnostic.actionableGuidance,
    "",
  ];

  if (context.previousFixResult) {
    lines.push("PREVIOUS PATCH THAT FAILED:");
    lines.push(`Title:   ${context.previousFixResult.title}`);
    lines.push(`Summary: ${context.previousFixResult.summary}`);
    if (context.previousFixResult.changes?.length) {
      lines.push("Changes attempted:");
      for (const [idx, change] of context.previousFixResult.changes.entries()) {
        lines.push(`  [${idx + 1}] ${change.changeType} in ${change.filePath} (lines ${change.startLine}-${change.endLine}):`);
        if (change.originalCode) {
          lines.push(`      - Was: ${change.originalCode.replace(/\n/g, "\n        ")}`);
        }
        if (change.replacementCode) {
          lines.push(`      + Replaced with: ${change.replacementCode.replace(/\n/g, "\n        ")}`);
        }
      }
    }
    lines.push("");
  }

  if (context.priorFailures && context.priorFailures.length > 0) {
    const isRecurring = context.priorFailures.some(
      (f) => f.errorSummary.toLowerCase().includes("export") && diagnostic.summary.toLowerCase().includes("export"),
    );
    if (isRecurring) {
      lines.push("CRITICAL WARNING - RECURRING MODULE EXPORT FAILURE:");
      lines.push(
        "Multiple previous attempts have failed because the implementation used CommonJS exports ('module.exports') or wrong export names.",
      );
      lines.push("You MUST export the required functions as named ES Module exports: 'export function <name>(a, b) { ... }'.");
      lines.push("DO NOT repeat CommonJS syntax. DO NOT delete tests.");
      lines.push("");
    }
  }

  lines.push("ACTUAL DOCKER TEST OUTPUT (STDERR / STDOUT):");
  const rawOutput = `${context.previousTestResult.stderr || ""}\n${context.previousTestResult.stdout || ""}`.trim();
  lines.push(rawOutput.length > 2000 ? rawOutput.slice(-2000) : rawOutput || "(no output)");
  lines.push("");
  lines.push("STRICT INSTRUCTIONS FOR THIS ATTEMPT:");
  lines.push("1. Propose a NEW, corrected patch that satisfies the above diagnostic.");
  lines.push("2. DO NOT repeat the previous failed change.");
  lines.push("3. Fix the underlying implementation in the source file so it provides valid exports and passes tests.");

  return lines.join("\n");
};
