import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSandboxRunArgs } from "../execution/docker.args.js";

/**
 * Real-container isolation tests. They need a Docker daemon and the node image; without one they SKIP with an
 * explicit reason. Set REQUIRE_DOCKER_TESTS=true (CI does) to make an absent daemon a hard failure instead.
 * Reproduce: `docker pull node:22-bookworm-slim && REQUIRE_DOCKER_TESTS=true npm run test:docker`.
 */
const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", timeout: 20000 });
const dockerUp = info.status === 0;
const required = process.env.REQUIRE_DOCKER_TESTS === "true";
const skip = dockerUp ? false : "Docker daemon unavailable in this environment";

test("Docker is available when REQUIRE_DOCKER_TESTS=true", () => {
  if (required) assert.equal(dockerUp, true, "REQUIRE_DOCKER_TESTS=true but no Docker daemon is reachable");
  else if (!dockerUp) assert.ok(true);
});

const limits = { memory: "256m", cpus: "1", pids: 64, user: "1000:1000" };
function probe(script: string, extra: Partial<typeof limits> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-iso-"));
  fs.chmodSync(dir, 0o777);
  fs.writeFileSync(path.join(dir, "probe.js"), script);
  const name = `rd-iso-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const r = spawnSync("docker", buildSandboxRunArgs({ repositoryPath: dir, testCommand: ["node", "probe.js"] }, name, { ...limits, ...extra }), { encoding: "utf8", timeout: 90000 });
  spawnSync("docker", ["rm", "-f", name]);
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}
const last = (r: { stdout: string }) => JSON.parse(r.stdout.trim().split("\n").pop()!);

test("container: non-root, read-only rootfs, no capabilities, no new privileges", { skip }, () => {
  const o = last(probe(`const fs=require("fs");let ro=false;try{fs.writeFileSync("/etc/x","1")}catch{ro=true}
const st=fs.readFileSync("/proc/self/status","utf8");const cap=/CapEff:\\s*(\\w+)/.exec(st)[1];const nnp=/NoNewPrivs:\\s*(\\d)/.exec(st)[1];
console.log(JSON.stringify({uid:process.getuid(),ro,cap,nnp}))`));
  assert.notEqual(o.uid, 0); assert.equal(o.ro, true); assert.match(o.cap, /^0+$/); assert.equal(o.nnp, "1");
});

test("container: no network", { skip }, () => {
  const o = last(probe(`const n=require("net");const s=n.connect(443,"1.1.1.1");s.on("connect",()=>{console.log(JSON.stringify({c:true}));process.exit(0)});s.on("error",()=>{console.log(JSON.stringify({c:false}));process.exit(0)});setTimeout(()=>{console.log(JSON.stringify({c:false}));process.exit(0)},4000)`));
  assert.equal(o.c, false);
});

test("container: host paths and the Docker socket are not visible", { skip }, () => {
  const o = last(probe(`const fs=require("fs");console.log(JSON.stringify({sock:fs.existsSync("/var/run/docker.sock"),home:fs.existsSync("/home/claude"),env:Object.keys(process.env).filter(k=>/TOKEN|SECRET|KEY|PASSWORD/.test(k))}))`));
  assert.equal(o.sock, false); assert.equal(o.home, false); assert.deepEqual(o.env, []);
});

test("container: /tmp is noexec", { skip }, () => {
  const o = last(probe(`const fs=require("fs"),cp=require("child_process");fs.writeFileSync("/tmp/x.sh","#!/bin/sh\\necho hi\\n",{mode:0o755});const r=cp.spawnSync("/tmp/x.sh");console.log(JSON.stringify({ran:r.status===0}))`));
  assert.equal(o.ran, false);
});

test("container: pids limit stops a fork bomb; memory limit kills a runaway allocation", { skip }, () => {
  // spawn() reports EAGAIN asynchronously, so count 'spawn' vs 'error' events (not exceptions).
  const o = last(probe(`const cp=require("child_process");let ok=0,fail=0,done=0;const N=200;
for(let i=0;i<N;i++){const c=cp.spawn("sleep",["3"],{stdio:"ignore"});c.on("spawn",()=>{ok++;chk()});c.on("error",()=>{fail++;chk()})}
function chk(){if(++done===N){console.log(JSON.stringify({ok,fail}));process.exit(0)}}`));
  assert.ok(o.fail > 0 && o.ok < 200, `pids limit (64) did not stop the fork bomb: ${JSON.stringify(o)}`);
  const m = probe(`const a=[];for(;;)a.push(Buffer.alloc(50*1024*1024,1))`);
  assert.notEqual(m.status, 0);
});

test("container: writes to the mounted workspace stay inside it; a symlink created inside cannot reach host files", { skip }, () => {
  const o = last(probe(`const fs=require("fs");try{fs.symlinkSync("/etc/shadow","evil")}catch{}let leak=false;try{leak=fs.readFileSync("evil","utf8").length>0}catch{}console.log(JSON.stringify({leak}))`));
  assert.equal(o.leak, false);
});
