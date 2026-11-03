import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertWorkspaceSafe, scanWorkspace, isInside } from "../execution/safe-path.js";
import { assertInstallPolicy, checkInstallPolicy, isRegistrySpec } from "../execution/install-policy.js";
import { loadSandboxConfig, sandboxConfigProblems, assertSandboxConfig } from "../execution/sandbox-config.js";
import { buildInstallRunArgs } from "../execution/docker.dependencies.js";
import { buildSandboxRunArgs } from "../execution/docker.args.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rd-pol-"));
const after = (a: string[], f: string) => a[a.indexOf(f) + 1];

test("workspace: absolute and relative symlinks escaping the root are rejected; internal links allowed", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "a.txt"), "x");
  fs.symlinkSync("a.txt", path.join(d, "ok-link"));
  await assertWorkspaceSafe(d);
  fs.symlinkSync("/etc/passwd", path.join(d, "abs"));
  fs.mkdirSync(path.join(d, "sub")); fs.symlinkSync("../../../etc", path.join(d, "sub/rel"));
  const v = await scanWorkspace(d);
  assert.deepEqual(v.map((x) => x.path).sort(), ["abs", path.join("sub", "rel")]);
  await assert.rejects(assertWorkspaceSafe(d), /unsafe workspace/);
});

test("workspace: FIFOs and excessive size/depth are rejected", async () => {
  const d = tmp();
  execFileSync("mkfifo", [path.join(d, "pipe")]);
  assert.equal((await scanWorkspace(d))[0].reason, "SPECIAL_FILE");
  const e = tmp(); let cur = e; for (let i = 0; i < 6; i++) { cur = path.join(cur, "d"); fs.mkdirSync(cur); }
  assert.ok((await scanWorkspace(e, { maxEntries: 100, maxDepth: 3 })).some((x) => x.reason === "TOO_DEEP"));
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(e, `f${i}`), "");
  assert.ok((await scanWorkspace(e, { maxEntries: 5, maxDepth: 64 })).some((x) => x.reason === "TOO_MANY_FILES"));
});

test("isInside handles traversal lookalikes", () => {
  assert.equal(isInside("/w/r", "/w/r/a"), true);
  assert.equal(isInside("/w/r", "/w/r-evil"), false);
  assert.equal(isInside("/w/r", "/w/r/../x"), false);
});

test("install policy: registry specs only", () => {
  for (const ok of ["^1.2.3", "~2", "1.x", "latest", "npm:left-pad@1", "workspace:*"]) assert.equal(isRegistrySpec(ok), true, ok);
  for (const bad of ["git+https://x/y.git", "github:u/r", "u/r", "https://x/t.tgz", "file:../x", "link:../x", "git://x/y", "./local", "/abs"]) assert.equal(isRegistrySpec(bad), false, bad);
});

test("install policy: rejects git/url deps, rc files, overrides, and foreign lockfile hosts; accepts a clean project", async () => {
  const clean = tmp();
  fs.writeFileSync(path.join(clean, "package.json"), JSON.stringify({ dependencies: { a: "^1.0.0" } }));
  fs.writeFileSync(path.join(clean, "package-lock.json"), JSON.stringify({ packages: { "node_modules/a": { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" } } }));
  await assertInstallPolicy(clean);

  const bad = tmp();
  fs.writeFileSync(path.join(bad, "package.json"), JSON.stringify({ dependencies: { a: "git+https://evil.test/a.git", b: "^1" }, overrides: { c: "https://evil.test/c.tgz" } }));
  fs.writeFileSync(path.join(bad, ".npmrc"), "registry=https://evil.test\n");
  fs.writeFileSync(path.join(bad, "package-lock.json"), JSON.stringify({ packages: { x: { resolved: "https://evil.test/x.tgz" } } }));
  fs.writeFileSync(path.join(bad, "yarn.lock"), 'x@^1:\n  resolved "https://evil.test/y.tgz#abc"\n');
  const rules = (await checkInstallPolicy(bad)).map((v) => v.rule);
  for (const r of ["FORBIDDEN_CONFIG_FILE", "NON_REGISTRY_DEPENDENCY", "NON_REGISTRY_OVERRIDE", "LOCKFILE_UNAPPROVED_HOST"]) assert.ok(rules.includes(r), r);
  await assert.rejects(assertInstallPolicy(bad), /refused by policy/);
});

test("sandbox config: root user, bad runtime and bad network fail closed; hardened-runtime requirement enforced", () => {
  assert.deepEqual(sandboxConfigProblems(loadSandboxConfig({})), []);
  assert.equal(sandboxConfigProblems(loadSandboxConfig({ REPAIR_SANDBOX_USER: "0:0" })).length, 1);
  assert.equal(sandboxConfigProblems(loadSandboxConfig({ REPAIR_SANDBOX_USER: "1000:0" })).length, 1);
  assert.equal(sandboxConfigProblems(loadSandboxConfig({ REPAIR_SANDBOX_USER: "root" })).length, 1);
  assert.equal(sandboxConfigProblems(loadSandboxConfig({ REPAIR_SANDBOX_RUNTIME: "x; rm -rf /" })).length, 1);
  assert.equal(sandboxConfigProblems(loadSandboxConfig({ REPAIR_INSTALL_NETWORK: "host" })).length, 1);
  const env = { NODE_ENV: "production", REPAIR_REQUIRE_HARDENED_RUNTIME: "true" };
  assert.equal(sandboxConfigProblems(loadSandboxConfig(env), env).length, 1);
  assert.deepEqual(sandboxConfigProblems(loadSandboxConfig({ ...env, REPAIR_SANDBOX_RUNTIME: "runsc" }), env), []);
  assert.throws(() => assertSandboxConfig({ REPAIR_SANDBOX_USER: "0:0" }), /Invalid sandbox configuration/);
});

test("install container args: non-root, no caps, read-only root, limits, no host mounts beyond workspace and volume", () => {
  const a = buildInstallRunArgs({ resolved: "/w/repo", volumeName: "vol", containerDirectory: "/workspace/repository", command: ["npm", "ci", "--ignore-scripts"], config: loadSandboxConfig({}) });
  assert.equal(after(a, "--user"), "1000:1000");
  assert.equal(after(a, "--cap-drop"), "ALL");
  assert.equal(after(a, "--security-opt"), "no-new-privileges");
  assert.ok(a.includes("--read-only"));
  assert.equal(after(a, "--ipc"), "none");
  assert.ok(a.includes("--pids-limit") && a.includes("--memory"));
  assert.equal(a.filter((x) => x === "-v").length, 2);
  assert.ok(!a.includes("--privileged") && !a.some((x) => /docker\.sock|--pid=host|--network=host/.test(x)));
  assert.ok(a.slice(a.indexOf("node:22-bookworm-slim")).includes("--ignore-scripts"));
  assert.equal(after(buildInstallRunArgs({ resolved: "/w", volumeName: "v", containerDirectory: "/workspace/repository", command: ["npm"], config: loadSandboxConfig({ REPAIR_INSTALL_NETWORK: "none" }) }), "--network"), "none");
});

test("gVisor runtime is passed through to both install and test containers when configured", () => {
  const cfg = loadSandboxConfig({ REPAIR_SANDBOX_RUNTIME: "runsc" });
  const install = buildInstallRunArgs({ resolved: "/w", volumeName: "v", containerDirectory: "/workspace/repository", command: ["npm"], config: cfg });
  const run = buildSandboxRunArgs({ repositoryPath: "/tmp/ws/repository", testCommand: ["npm", "test"] }, "c", { memory: "1g", cpus: "1", pids: 64, user: "1000:1000", runtime: "runsc" });
  assert.equal(after(install, "--runtime"), "runsc");
  assert.equal(after(run, "--runtime"), "runsc");
  assert.ok(!buildSandboxRunArgs({ repositoryPath: "/tmp/ws/repository", testCommand: ["npm"] }, "c", { memory: "1g", cpus: "1", pids: 64, user: "1000:1000" }).includes("--runtime"));
});

test("test command cannot smuggle docker options or shell metacharacters into the argv", () => {
  const a = buildSandboxRunArgs({ repositoryPath: "/tmp/ws/repository", testCommand: ["npm", "test", "--privileged", "-v", "/:/host"] }, "c", { memory: "1g", cpus: "1", pids: 64, user: "1000:1000" });
  const img = a.indexOf("node:22-bookworm-slim");
  assert.ok(!a.slice(0, img).includes("--privileged"));
  assert.ok(!a.slice(0, img).includes("/:/host"));
});
