import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const load = (f: string) => ({ text: fs.readFileSync(path.join(root, ".github", f), "utf8"), doc: parse(fs.readFileSync(path.join(root, ".github", f), "utf8")) as any });

/** Static policy checks over workflow YAML. They prove the file's structure, not that GitHub enforces repository settings. */
export function findScriptInjection(doc: any): string[] {
  const hits: string[] = [];
  for (const [jobName, job] of Object.entries<any>(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && /\$\{\{\s*(inputs|github\.event|github\.head_ref|steps\.[^}]*outputs)/.test(step.run)) hits.push(`${jobName}: ${step.name ?? step.run.slice(0, 40)}`);
    }
  }
  return hits;
}

const deploy = load("workflows/deploy.yml");
const ci = load("workflows/ci.yml");

test("negative: the detector flags the previous vulnerable pattern", () => {
  const vulnerable = parse(`jobs:\n  j:\n    steps:\n      - run: docker build -t img:\${{ inputs.version }} .\n`);
  assert.equal(findScriptInjection(vulnerable).length, 1);
});

test("deploy: version flows through env and is never interpolated into a shell script", () => {
  assert.deepEqual(findScriptInjection(deploy.doc), []);
  assert.equal(deploy.doc.on.workflow_dispatch.inputs.version.required, true);
});

test("deploy: SemVer is validated before anything else runs", () => {
  const validate = deploy.doc.jobs.validate;
  const run = validate.steps.find((s: any) => s.id === "v").run as string;
  assert.match(run, /\(0\|\[1-9\]\[0-9\]\*\)/);
  for (const [name, job] of Object.entries<any>(deploy.doc.jobs)) if (name !== "validate") assert.ok(((job.needs ?? []) as unknown[]).length > 0, `${name} needs validate`);
});

test("deploy: tests gate publishing, publish uses the production environment, and both images are scanned before the push", () => {
  const publish = deploy.doc.jobs.publish;
  assert.ok((publish.needs as string[]).includes("test"));
  assert.equal(publish.environment, "production");
  const names = publish.steps.map((s: any) => `${s.name ?? ""}|${s.uses ?? ""}|${s.run ?? ""}`);
  const push = names.findIndex((n: string) => /docker push/.test(n));
  const scans = names.map((n: string, i: number) => (/trivy-action/.test(n) ? i : -1)).filter((i: number) => i >= 0);
  assert.equal(scans.length, 2);
  assert.ok(scans.every((i: number) => i < push), "scans run before push");
  const refs = publish.steps.filter((s: any) => /trivy/.test(s.uses ?? "")).map((s: any) => s.with["image-ref"]);
  assert.ok(refs.some((r: string) => r.includes("-server:")) && refs.some((r: string) => r.includes("-client:")));
  for (const s of publish.steps.filter((s: any) => /trivy/.test(s.uses ?? ""))) assert.equal(String(s.with["exit-code"]), "1");
  const login = names.findIndex((n: string) => /login-action/.test(n));
  assert.ok(login > Math.max(...scans), "registry login happens only after the scans passed");
});

test("deploy: least privilege — contents:read at top level; packages:write only in the publish job", () => {
  assert.deepEqual(deploy.doc.permissions, { contents: "read" });
  for (const [name, job] of Object.entries<any>(deploy.doc.jobs)) {
    const perms = job.permissions ?? {};
    if (name === "publish") assert.equal(perms.packages, "write");
    else assert.equal(perms.packages, undefined, `${name} must not write packages`);
  }
});

test("deploy: no auto-deploy and no merge automation anywhere", () => {
  for (const f of [deploy.text, ci.text]) assert.doesNotMatch(f, /gh pr merge|--auto|automerge|ssh |kubectl|docker compose up/i);
});

test("every third-party action is pinned to a full 40-character commit SHA, with a version comment", () => {
  const uses = [...deploy.text.matchAll(/uses:\s*([^\s@]+)@(\S+)(.*)/g), ...ci.text.matchAll(/uses:\s*([^\s@]+)@(\S+)(.*)/g)];
  assert.ok(uses.length >= 10);
  for (const m of uses) { assert.match(m[2], /^[0-9a-f]{40}$/, `${m[1]}@${m[2]} must be a full commit SHA`); assert.match(m[3], /#\s*v\d/, `${m[1]} needs a "# vX.Y.Z" comment`); }
});

test("negative: a tag-pinned action is rejected by the pin rule", () => {
  assert.doesNotMatch("v4", /^[0-9a-f]{40}$/); assert.doesNotMatch("0.28.0", /^[0-9a-f]{40}$/);
});

test("pinned SHAs match the verified table in docs/ACTIONS_PINS.md", () => {
  const doc = fs.readFileSync(path.join(root, "docs/ACTIONS_PINS.md"), "utf8");
  for (const m of (deploy.text + ci.text).matchAll(/uses:\s*([^\s@]+)@([0-9a-f]{40})/g)) assert.ok(doc.includes(m[2]), `${m[1]}@${m[2]} is not documented as verified`);
});

test("ci: default permissions are read-only and workflow cancels superseded runs", () => {
  assert.deepEqual(ci.doc.permissions, { contents: "read" });
  assert.ok(ci.doc.concurrency);
});

test("ci: integration job has real Postgres + Redis, real docker tests, and fails (not skips) when they are missing", () => {
  const j = ci.doc.jobs.integration;
  assert.ok(j.services.postgres && j.services.redis);
  assert.equal(j.env.REQUIRE_DOCKER_TESTS, "true");
  assert.equal(j.env.REQUIRE_INTEGRATION_TESTS, "true");
  assert.ok(j.env.TEST_DATABASE_ADMIN_URL && j.env.TEST_REDIS_URL);
});

test("ci: migrations job applies migrations and checks for drift; images are built only after tests", () => {
  const steps = JSON.stringify(ci.doc.jobs.migrations.steps);
  assert.match(steps, /migrate deploy/); assert.match(steps, /migrate diff/);
  assert.ok(ci.doc.jobs.images.needs.includes("integration"));
});

test("ci: dependency audit, filesystem scan and both image scans are present and blocking", () => {
  assert.ok(ci.doc.jobs["dependency-audit"] && ci.doc.jobs["trivy-fs"]);
  const scans = ci.doc.jobs.images.steps.filter((s: any) => /trivy/.test(s.uses ?? ""));
  assert.equal(scans.length, 2);
  for (const s of scans) assert.equal(String(s.with["exit-code"]), "1");
});

test("dependabot covers npm (server, client), github-actions and docker", () => {
  const d = parse(fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8"));
  const eco = d.updates.map((u: any) => `${u["package-ecosystem"]}:${u.directory}`);
  for (const e of ["npm:/server", "npm:/client", "github-actions:/", "docker:/server"]) assert.ok(eco.includes(e), e);
});
