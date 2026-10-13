// End-to-end registration / login test against the real Express app and the
// real database (DATABASE_URL). Requires JWT_SECRET, Redis settings and a
// migrated database. It creates uniquely named test users and deletes them
// afterwards, so repeated runs never collide and real accounts are untouched.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.JWT_SECRET ??= "auth-flow-test-secret";

const { default: app } = await import("./app.js");
const { prisma } = await import("./config/prisma.js");

const runId = randomUUID().slice(0, 8);
const email = `rd-auth-test-${runId}@example.test`;
const password = "Correct-Horse-9";
const createdEmails = [email];

const server = app.listen(0);
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}/api`;

const call = async (
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, text, json: text ? JSON.parse(text) : {} };
};

let passed = 0;
const check = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
};

try {
  await check("register rejects missing fields, short and non-string input", async () => {
    for (const body of [
      {},
      { name: "A", email, password: "short" },
      { name: " ", email, password },
      { name: "A", email, password: "x".repeat(129) },
      { name: { a: 1 }, email: ["x"], password: 12345678 },
    ]) {
      assert.equal((await call("/auth/register", { body })).status, 400);
    }
    assert.equal(
      (await call("/auth/register", { body: { name: "A", email: "not-an-email", password } })).status,
      400,
    );
  });

  let token = "";
  await check("register creates a user and never returns the password", async () => {
    const res = await call("/auth/register", { body: { name: "Auth Test", email: email.toUpperCase(), password } });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.email, email, "email is normalised to lower case");
    assert.ok(typeof res.json.token === "string" && res.json.token.length > 20);
    assert.ok(!res.text.includes(password));
    assert.ok(!("password" in res.json.user));
  });

  await check("password is stored as a bcrypt hash", async () => {
    const row = await prisma.user.findUnique({ where: { email } });
    assert.ok(row);
    assert.notEqual(row.password, password);
    assert.match(row.password, /^\$2[aby]\$\d{2}\$/);
  });

  await check("duplicate registration returns 409 (any letter case)", async () => {
    assert.equal((await call("/auth/register", { body: { name: "A", email, password } })).status, 409);
    assert.equal((await call("/auth/register", { body: { name: "A", email: email.toUpperCase(), password } })).status, 409);
  });

  await check("concurrent duplicate registrations yield one 201 and the rest 409", async () => {
    const racer = `rd-auth-race-${runId}@example.test`;
    createdEmails.push(racer);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call("/auth/register", { body: { name: "Racer", email: racer, password } })),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
  });

  await check("login succeeds with valid credentials", async () => {
    const res = await call("/auth/login", { body: { email, password } });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes(password));
    token = res.json.data.token;
    assert.ok(token);
  });

  await check("login rejects wrong password and unknown user with the same message", async () => {
    const wrong = await call("/auth/login", { body: { email, password: "Wrong-Password-1" } });
    const unknown = await call("/auth/login", { body: { email: `nobody-${runId}@example.test`, password } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.message, unknown.json.message);
    assert.equal((await call("/auth/login", { body: { email } })).status, 400);
  });

  await check("protected endpoints require a valid token", async () => {
    assert.equal((await call("/auth/me")).status, 401);
    assert.equal((await call("/auth/me", { token: "garbage" })).status, 401);
    assert.equal((await call("/repositories")).status, 401);
    const me = await call("/auth/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, email);
    assert.ok(!("password" in me.json.user));
    assert.equal((await call("/repositories", { token })).status, 200);
  });
} finally {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  server.close();
  await prisma.$disconnect();
}

console.log(`Auth flow test passed (${passed} checks).`);
process.exit(0);
