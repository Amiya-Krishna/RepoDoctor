import type { Request, Response } from "express";
import { setAuditSink, type AuditEvent } from "../audit/audit.service.js";

/** Secret-shaped strings are assembled at runtime so this repo never contains a literal credential. */
export const fake = {
  githubToken: () => "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  awsKey: () => "AK" + "IA" + "ABCDEFGHIJKLMNOP",
  slack: () => "xo" + "xb-" + "123456789012-abcdefghijklmnop",
  stripe: () => "sk" + "_live_" + "abcdefghijklmnop1234",
  openai: () => "sk" + "-" + "proj_abcdefghijklmnopqrstuvwxyz0123",
  google: () => "AI" + "za" + "SyA-1234567890abcdefghijklmnopqrstu",
  jwt: () => ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnop12345"].join("."),
  pem: () => "-----BEGIN RSA PRIV" + "ATE KEY-----\nMIIEowIBAAKCAQEAabc123\n-----END RSA PRIV" + "ATE KEY-----",
};

export function captureAudit() {
  const events: AuditEvent[] = [];
  setAuditSink({ async write(e) { events.push(e); } });
  return events;
}

export function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
    send(b?: unknown) { this.body = b; return this; },
  };
  return res as typeof res & Response;
}

export function mockReq(init: { headers?: Record<string, string>; rawBody?: Buffer; body?: unknown }): Request {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers,
    header: (n: string) => headers[n.toLowerCase()],
    body: init.body,
    rawBody: init.rawBody,
  } as unknown as Request;
}
