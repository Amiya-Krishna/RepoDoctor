import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// The auth routes must receive a parsed JSON body and CORS headers. These
// assertions only exercise request validation, so no database is touched.
process.env.JWT_SECRET ??= "test-secret";
process.env.FRONTEND_URL = "http://localhost:5173";
// Read when the app module loads: behave as if behind one reverse proxy (nginx).
process.env.TRUST_PROXY = "1";

const { default: app } = await import("./app.js");

const server = app.listen(0);
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}/api`;

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify(body),
  });

try {
  // Body is parsed: a well-formed payload with a bad email reaches the email
  // check. Without the JSON parser this would answer "Name and email are required".
  const badEmail = await post("/auth/register", {
    name: "Test User",
    email: "not-an-email",
    password: "longenoughpassword",
  });
  assert.equal(badEmail.status, 400);
  assert.equal(((await badEmail.json()) as { message: string }).message, "Enter a valid email address");

  // Missing fields are still rejected.
  const missing = await post("/auth/register", { email: "a@b.co" });
  assert.equal(missing.status, 400);

  // Login with an empty password is rejected before any database lookup.
  const noPassword = await post("/auth/login", { email: "a@b.co", password: "" });
  assert.equal(noPassword.status, 400);

  // CORS headers are present on auth responses.
  assert.equal(
    badEmail.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );

  // Health endpoint and protected routes.
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const me = await fetch(`${base}/auth/me`);
  assert.equal(me.status, 401);

  // Preflight is answered by CORS and is not blocked.
  const preflight = await fetch(`${base}/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.ok(preflight.status === 204 || preflight.status === 200);

  // Rate limiting is per client behind a proxy: after 10 failed logins one
  // X-Forwarded-For client is blocked, a different client is not, and the 429
  // still carries CORS headers (CORS runs before the limiter).
  const failLogin = (ip: string) =>
    fetch(`${base}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Forwarded-For": ip,
      },
      body: JSON.stringify({ email: "a@b.co", password: "" }),
    });
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await failLogin("203.0.113.10")).status, 400);
  }
  const blocked = await failLogin("203.0.113.10");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal((await failLogin("203.0.113.11")).status, 400);

  // GitHub webhook: the HMAC must be checked against the exact raw request
  // bytes (odd whitespace below would change under JSON re-serialisation).
  const webhookSecret = "test-webhook-secret";
  const sendWebhook = (
    event: string,
    rawBody: string,
    signature?: string,
    withHeaders = true,
  ) =>
    fetch(`${base}/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(withHeaders
          ? { "X-GitHub-Event": event, "X-GitHub-Delivery": "delivery-1" }
          : {}),
        ...(signature ? { "X-Hub-Signature-256": signature } : {}),
      },
      body: rawBody,
    });
  const sign = (rawBody: string) =>
    `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;

  delete process.env.GITHUB_WEBHOOK_SECRET;
  assert.equal((await sendWebhook("ping", "{}", sign("{}"))).status, 503);

  process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
  const pingBody = '{  "zen" :   "Keep it logically awesome"  }';
  assert.equal((await sendWebhook("ping", pingBody, undefined, false)).status, 400);
  assert.equal((await sendWebhook("ping", pingBody, "sha256=" + "0".repeat(64))).status, 401);
  const ping = await sendWebhook("ping", pingBody, sign(pingBody));
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { accepted: true, event: "ping" });

  // A correctly signed non-branch push is acknowledged and ignored without
  // touching the database or the queue.
  const tagPush = '{"ref":"refs/tags/v1","repository":{"id":1}}';
  const ignored = await sendWebhook("push", tagPush, sign(tagPush));
  assert.equal(ignored.status, 202);

  console.log("App middleware tests passed.");
} finally {
  server.close();
  // Importing the app opens BullMQ/Redis connections that would keep the
  // process alive; the test is done, so exit explicitly.
  setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
}
