import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSandboxRunArgs, SANDBOX_IMAGE } from "../execution/docker.args.js";

const limits = { memory: "512m", cpus: "1", pids: 128, user: "1000:1000" };
const base = { repositoryPath: "/tmp/repodoctor/ws/repository", testCommand: ["npm", "test"] };
const args = (o = {}) => buildSandboxRunArgs({ ...base, ...o }, "c1", limits);
const after = (a: string[], flag: string) => a[a.indexOf(flag) + 1];

test("network is disabled and IPC is not shared", () => {
  const a = args();
  assert.equal(after(a, "--network"), "none");
  assert.equal(after(a, "--ipc"), "none");
});

test("all capabilities dropped, no privilege escalation, read-only root, non-root user", () => {
  const a = args();
  assert.equal(after(a, "--cap-drop"), "ALL");
  assert.ok(a.includes("no-new-privileges"));
  assert.ok(a.includes("--read-only"));
  assert.equal(after(a, "--user"), "1000:1000");
});

test("CPU, memory (no swap) and PID limits are applied", () => {
  const a = args();
  assert.equal(after(a, "--memory"), "512m");
  assert.equal(after(a, "--memory-swap"), "512m");
  assert.equal(after(a, "--cpus"), "1");
  assert.equal(after(a, "--pids-limit"), "128");
  assert.ok(a.includes("nofile=1024:1024"));
});

test("scratch space is tmpfs with noexec; only the disposable workspace is mounted", () => {
  const a = args();
  assert.ok(a.some((x) => x.startsWith("/tmp:rw,noexec,nosuid")));
  const mounts = a.flatMap((x, i) => (a[i - 1] === "-v" ? [x] : []));
  assert.deepEqual(mounts, [`${base.repositoryPath}:/workspace/repository:rw`]);
});

test("no dangerous flags can appear", () => {
  const joined = args({ environment: { FOO: "bar" } }).join(" ");
  for (const bad of ["--privileged", "docker.sock", "--network host", "--pid host", "--cap-add", "--device", "seccomp=unconfined", "--user root", "--user 0"]) {
    assert.ok(!joined.includes(bad), bad);
  }
});

test("host environment is not forwarded: only explicit variables are set", () => {
  process.env.SUPER_SECRET_HOST_VALUE = "leak-me";
  const a = args();
  const envs = a.flatMap((x, i) => (a[i - 1] === "-e" ? [x] : []));
  assert.ok(!a.join(" ").includes("leak-me"));
  assert.deepEqual(envs.sort(), ["CI=true", "HOME=/tmp", "npm_config_cache=/tmp/.npm"]);
  delete process.env.SUPER_SECRET_HOST_VALUE;
});

test("the test command comes after the image and cannot inject docker options", () => {
  const a = args({ testCommand: ["npm", "test", "--privileged"] });
  const img = a.indexOf(SANDBOX_IMAGE);
  assert.deepEqual(a.slice(img + 1), ["npm", "test", "--privileged"]);
  assert.ok(!a.slice(0, img).includes("--privileged"));
});

test("unsafe inputs are refused", () => {
  assert.throws(() => args({ environment: { "A=B": "x" } }), /Invalid environment/);
  assert.throws(() => args({ repositoryPath: "/tmp/a,b" }), /unsafe/);
  assert.throws(() => args({ repositoryPath: "/tmp/a:/etc" }), /unsafe/);
  assert.throws(() => args({ repositoryPath: "/" }), /unsafe/);
  assert.throws(() => args({ testCommand: [] }), /empty/);
});

// ---- Real container checks. These need a Docker daemon and the sandbox image; otherwise they are SKIPPED, not passed.
const dockerReady = (() => {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe", timeout: 15000 });
    execFileSync("docker", ["image", "inspect", SANDBOX_IMAGE], { stdio: "pipe", timeout: 15000 });
    return true;
  } catch { return false; }
})();
const skip = dockerReady ? false : "Docker daemon or node:22-bookworm-slim image not available - NOT verified in this environment";

function run(script: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sbx-"));
  fs.chmodSync(dir, 0o777);
  fs.writeFileSync(path.join(dir, "probe.js"), script);
  const a = buildSandboxRunArgs({ repositoryPath: dir, testCommand: ["node", "probe.js"] }, `rd-probe-${Date.now()}`, limits);
  const r = spawnSync("docker", a, { encoding: "utf8", timeout: 60000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test("real container: outbound network is unreachable", { skip }, () => {
  const r = run(`require("net").connect(443,"1.1.1.1").on("connect",()=>{console.log("CONNECTED");process.exit(0)}).on("error",e=>{console.log("BLOCKED "+e.code);process.exit(7)});setTimeout(()=>{console.log("BLOCKED timeout");process.exit(7)},5000)`);
  assert.ok(!r.stdout.includes("CONNECTED"), r.stdout);
  assert.match(r.stdout, /BLOCKED/);
});

test("real container: root filesystem is read-only and process is not root", { skip }, () => {
  const r = run(`const fs=require("fs");let ro=false;try{fs.writeFileSync("/etc/pwn","x")}catch(e){ro=true}console.log(JSON.stringify({ro,uid:process.getuid()}))`);
  const out = JSON.parse(r.stdout.trim().split("\n").pop()!);
  assert.equal(out.ro, true);
  assert.notEqual(out.uid, 0);
});

test("real container: memory limit kills a runaway allocation", { skip }, () => {
  const r = run(`const a=[];for(;;)a.push(Buffer.alloc(50*1024*1024,1))`);
  assert.notEqual(r.status, 0);
});
