import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyGitHubWebhookSignature } from "./github/github-webhook.signature.js";

const secret = "test-webhook-secret";
const body = Buffer.from(JSON.stringify({ action: "opened", repository: { id: 123 } }));
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

assert.equal(verifyGitHubWebhookSignature(body, signature, secret), true);
assert.equal(verifyGitHubWebhookSignature(Buffer.from("tampered"), signature, secret), false);
assert.equal(verifyGitHubWebhookSignature(body, "sha256=bad", secret), false);
assert.equal(verifyGitHubWebhookSignature(body, signature, "wrong-secret"), false);

console.log("GitHub webhook signature tests passed.");
