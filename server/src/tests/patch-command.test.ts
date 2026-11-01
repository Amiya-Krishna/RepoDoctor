import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateTestCommand, isAllowedTestCommand } from "../security/test-command-policy.js";
import { PATCH_LIMITS, PatchPolicyError, assertNoSymlinkInPath, checkPathAllowed, validatePatchPolicy } from "../repair/patch-policy.js";
import { applyFixResult } from "../repair/repair.patch.js";
import type { FixResult } from "../agents/fix.types.js";
import { fake } from "./helpers.js";

test("allowed test commands", () => {
  for (const c of [["npm", "test"], ["npm", "run", "test:unit"], ["pnpm", "run", "lint"], ["yarn", "build"], ["node", "--check", "src/a.js"], ["node", "--test", "tests/a.test.js"], ["node", "test.js"]]) {
    assert.equal(validateTestCommand(c).ok, true, c.join(" "));
  }
});

test("arbitrary code execution through the test command is refused", () => {
  const bad: unknown[] = [
    ["node", "-e", "require('child_process').exec('id')"], ["node", "-p", "1"], ["node", "--eval", "1"],
    ["node", "--require", "./x.js", "a.js"], ["node", "/etc/passwd.js"], ["node", "../../a.js"],
    ["npx", "evil-package"], ["npx", "--yes", "x"], ["sh", "-c", "id"], ["bash"], ["curl", "http://x"],
    ["npm", "install"], ["npm", "run", "postinstall"], ["npm", "run", "test;id"], ["npm", "test", "&&", "id"],
    ["npm", "test", "$(id)"], ["npm", "exec", "x"], [], "npm test", [1], [""], ["npm", "x".repeat(300)],
    Array(10).fill("npm"),
  ];
  for (const c of bad) assert.equal(validateTestCommand(c).ok, false, JSON.stringify(c));
  assert.equal(isAllowedTestCommand("npm test && whoami"), false);
});

const change = (o: Partial<FixResult["changes"][number]> = {}): FixResult["changes"][number] => ({
  filePath: "src/a.ts", changeType: "REPLACE", startLine: 1, endLine: 1, originalCode: "old", replacementCode: "new", explanation: "e", ...o,
});
const fix = (...changes: FixResult["changes"]): FixResult => ({ title: "t", summary: "s", risk: "LOW", confidence: 0.9, reasoning: "r", changes });
const rejects = (f: FixResult, rule?: string) => assert.throws(() => validatePatchPolicy(f), (e: unknown) => e instanceof PatchPolicyError && (!rule || e.rule === rule));

test("malicious patches are rejected: paths", () => {
  for (const p of ["../../etc/passwd", "/etc/passwd", "a/../../b", ".github/workflows/ci.yml", ".git/config", "Dockerfile", "docker-compose.yml", ".env", ".env.production", ".npmrc", "package.json", "web/package.json", "package-lock.json", "yarn.lock", "node_modules/x/index.js", "keys/server.pem", ".gitlab-ci.yml"]) {
    assert.throws(() => checkPathAllowed(p), PatchPolicyError, p);
  }
});

test("malicious patches are rejected: content and size", () => {
  rejects(fix(change({ replacementCode: `const t = "${fake.githubToken()}"` })), "secret-in-patch");
  rejects(fix(change({ replacementCode: "eval(input)" })), "dangerous-addition");
  rejects(fix(change({ replacementCode: "const cp = require('child_process')" })), "dangerous-addition");
  rejects(fix(change({ replacementCode: "x\n".repeat(PATCH_LIMITS.maxChangedLinesPerChange + 1) })), "change-too-large");
  rejects(fix(...Array.from({ length: PATCH_LIMITS.maxFiles + 1 }, (_, i) => change({ filePath: `src/f${i}.ts` }))), "too-many-files");
  rejects(fix(...Array.from({ length: PATCH_LIMITS.maxChanges + 1 }, () => change())), "too-many-changes");
  rejects(fix(), "empty");
});

test("benign patches pass; removing a dangerous call is a fix, not a hazard", () => {
  assert.doesNotThrow(() => validatePatchPolicy(fix(change({ replacementCode: "return a + b;" }))));
  assert.doesNotThrow(() => validatePatchPolicy(fix(change({ originalCode: "eval(x)", replacementCode: "JSON.parse(x)" }))));
});

test("symlinks planted by a repository cannot redirect a write outside the workspace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-patch-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rd-outside-"));
  fs.writeFileSync(path.join(outside, "victim.ts"), "secret\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(path.join(outside, "victim.ts"), path.join(root, "src", "a.ts"));
  fs.symlinkSync(outside, path.join(root, "linkdir"));

  await assert.rejects(() => assertNoSymlinkInPath(root, "src/a.ts"), (e: unknown) => (e as PatchPolicyError).rule === "symlink");
  await assert.rejects(() => assertNoSymlinkInPath(root, "linkdir/victim.ts"), PatchPolicyError);

  await assert.rejects(() => applyFixResult(root, fix(change({ filePath: "src/a.ts", originalCode: "secret", replacementCode: "pwned" }))), PatchPolicyError);
  assert.equal(fs.readFileSync(path.join(outside, "victim.ts"), "utf8"), "secret\n", "file outside the workspace is untouched");
});

test("applier: DELETE must match the text it claims to remove, and valid patches apply", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-apply-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), "line1\nline2\nline3\n");

  await assert.rejects(() => applyFixResult(root, fix(change({ changeType: "DELETE", startLine: 2, endLine: 2, originalCode: "not what is there", replacementCode: "" }))));
  assert.equal(fs.readFileSync(path.join(root, "src", "a.ts"), "utf8"), "line1\nline2\nline3\n");

  await applyFixResult(root, fix(change({ startLine: 2, endLine: 2, originalCode: "line2", replacementCode: "fixed" })));
  assert.equal(fs.readFileSync(path.join(root, "src", "a.ts"), "utf8"), "line1\nfixed\nline3\n");
});
