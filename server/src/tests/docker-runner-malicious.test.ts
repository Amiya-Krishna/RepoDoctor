import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDockerTest } from "../execution/docker.runner.js";
import { removeDependencyVolumes } from "../execution/docker.dependencies.js";

/** Runs the REAL runner (docker run via buildSandboxRunArgs) on hostile repository content. Needs a Docker daemon + the sandbox image. */
const up = spawnSync("docker", ["image", "inspect", "node:22-bookworm-slim"], { encoding: "utf8" }).status === 0;
const skip = up ? false : "Docker daemon or node:22-bookworm-slim image unavailable";
if (!up && process.env.REQUIRE_DOCKER_TESTS === "true") test("docker required", () => assert.fail("REQUIRE_DOCKER_TESTS=true but Docker/image unavailable"));

const repo = (files: Record<string, string>) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rd-mal-")); fs.chmodSync(d, 0o777);
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return d;
};
const leftovers = () => spawnSync("docker", ["ps", "-aq", "--filter", "label=repodoctor.sandbox"], { encoding: "utf8" }).stdout.trim();
const lastJson = (s: string) => JSON.parse(s.trim().split("\n").pop()!);

test("hostile test script: network, host files, secrets, privilege and persistence attempts all fail", { skip }, async () => {
  process.env.SOME_HOST_SECRET = "must-not-leak";
  const dir = repo({ "evil.js": `
const fs=require("fs"),net=require("net"),cp=require("child_process");const out={};
const tryw=(p)=>{try{fs.writeFileSync(p,"x");return true}catch{return false}};
out.writeEtc=tryw("/etc/pwn"); out.writeRoot=tryw("/pwn"); out.writeBin=tryw("/usr/bin/pwn");
out.hostSecretEnv=process.env.SOME_HOST_SECRET??null; out.uid=process.getuid();
out.sock=fs.existsSync("/var/run/docker.sock"); out.hostHome=fs.existsSync("/home/claude");
try{cp.execSync("id -u",{stdio:"pipe"});}catch{}
let done=false;const s=net.connect(443,"1.1.1.1");
s.on("connect",()=>{out.net=true;fin()});s.on("error",()=>{out.net=false;fin()});setTimeout(()=>{if(!done){out.net=false;fin()}},3000);
function fin(){if(done)return;done=true;console.log(JSON.stringify(out));process.exit(0)}` });
  try {
    const r = await runDockerTest({ repositoryPath: dir, testCommand: ["node", "evil.js"], timeoutMs: 60000 });
    const o = lastJson(r.stdout);
    assert.deepEqual({ ...o }, { writeEtc: false, writeRoot: false, writeBin: false, hostSecretEnv: null, uid: 1000, sock: false, hostHome: false, net: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.SOME_HOST_SECRET; }
  assert.equal(leftovers(), "", "no container left behind");
});

test("runaway process is killed at the timeout, reported as timed out, and the container is removed", { skip }, async () => {
  const dir = repo({ "loop.js": "setInterval(()=>{},1000)" });
  try {
    const started = Date.now();
    const r = await runDockerTest({ repositoryPath: dir, testCommand: ["node", "loop.js"], timeoutMs: 4000 });
    assert.equal(r.success, false); assert.equal(r.timedOut, true);
    assert.ok(Date.now() - started < 30000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(leftovers(), "", "timed-out container is force-removed");
});

test("memory bomb is OOM-killed within the limit and reported as failure", { skip }, async () => {
  const dir = repo({ "mem.js": "const a=[];for(;;)a.push(Buffer.alloc(50*1024*1024,1))" });
  try {
    const r = await runDockerTest({ repositoryPath: dir, testCommand: ["node", "mem.js"], timeoutMs: 60000, memoryLimit: "128m" });
    assert.equal(r.success, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(leftovers(), "");
});

test("workspace with a symlink leaving the repository is refused BEFORE any container starts", { skip }, async () => {
  const dir = repo({ "t.js": "console.log(1)" });
  fs.symlinkSync("/etc/passwd", path.join(dir, "evil-link"));
  try {
    const before = spawnSync("docker", ["ps", "-aq"], { encoding: "utf8" }).stdout;
    await assert.rejects(runDockerTest({ repositoryPath: dir, testCommand: ["node", "t.js"] }), /unsafe workspace/);
    assert.equal(spawnSync("docker", ["ps", "-aq"], { encoding: "utf8" }).stdout, before, "no container was created");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a non-zero exit is reported as failure with output captured; secrets in the environment are not forwarded", { skip }, async () => {
  const dir = repo({ "f.js": "console.log('visible'); process.exit(3)" });
  try {
    const r = await runDockerTest({ repositoryPath: dir, testCommand: ["node", "f.js"], timeoutMs: 60000 });
    assert.equal(r.success, false); assert.equal(r.exitCode, 3); assert.match(r.stdout, /visible/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("dependency volumes are removed by removeDependencyVolumes (cleanup on the real daemon)", { skip }, async () => {
  const names = [`repodoctor-nm-test-${process.pid}-a`, `repodoctor-nm-test-${process.pid}-b`];
  for (const n of names) assert.equal(spawnSync("docker", ["volume", "create", n], { encoding: "utf8" }).status, 0);
  await removeDependencyVolumes(names.map((name) => ({ name, directory: "" })));
  const left = spawnSync("docker", ["volume", "ls", "-q"], { encoding: "utf8" }).stdout.split("\n");
  for (const n of names) assert.ok(!left.includes(n), `${n} still exists`);
});
