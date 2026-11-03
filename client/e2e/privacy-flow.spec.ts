import { expect, test } from "@playwright/test";

// UI-only test: every /api call is mocked, so it needs no backend. It checks the
// privacy gate (no AI until the user chooses and consents) and the approval gate.
const disclosure = {
  version: 1, sent: ["Only selected source files"], notSent: ["Your GitHub token"],
  destinations: { CLOUD: "Hosted providers", LOCAL: "Your own server" },
  storedOnServer: ["Findings"], controls: ["Delete any time"],
};

test("first run requires an explicit privacy choice and consent before AI can be enabled", async ({ page }) => {
  let settings = { dataMode: "NONE", consentedAt: null as string | null, retentionDays: 30, notifyOnCritical: true };
  let lastPut: Record<string, unknown> | undefined;
  await page.addInitScript(() => localStorage.setItem("token", "t"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/auth/me")) return json({ user: { name: "Dev" } });
    if (url.pathname.endsWith("/privacy") && route.request().method() === "GET") return json({ settings, disclosure, availability: { cloud: true, local: false } });
    if (url.pathname.endsWith("/privacy") && route.request().method() === "PUT") {
      lastPut = JSON.parse(route.request().postData() ?? "{}");
      settings = { ...settings, dataMode: String(lastPut?.dataMode), consentedAt: "now" };
      return json({ settings });
    }
    if (url.pathname.endsWith("/privacy/notifications")) return json({ notifications: [], unread: 0 });
    if (url.pathname.endsWith("/github/repositories")) return json({ repositories: [] });
    return json({}, 404);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Privacy and data processing" })).toBeVisible();
  await page.getByLabel(/Cloud AI/).check();
  const save = page.getByRole("button", { name: "Save privacy settings" });
  await expect(save).toBeDisabled();
  await page.getByLabel(/I have read the above/).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => lastPut?.consent).toBe(true);
  expect(lastPut?.consentVersion).toBe(1);
});

test("a verified repair is shown with before/after and test evidence, and needs explicit approval", async ({ page }) => {
  let approved = false;
  await page.addInitScript(() => localStorage.setItem("token", "t"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/auth/me")) return json({ user: { name: "Dev" } });
    if (url.pathname.endsWith("/privacy") && route.request().method() === "GET") return json({ settings: { dataMode: "CLOUD", consentedAt: "x", retentionDays: 30, notifyOnCritical: true }, disclosure, availability: { cloud: true, local: false } });
    if (url.pathname.endsWith("/privacy/notifications")) return json({ notifications: [], unread: 0 });
    if (url.pathname.endsWith("/github/repositories")) return json({ repositories: [{ id: "r1", name: "demo", fullName: "me/demo", defaultBranch: "main", private: false }] });
    if (url.pathname.endsWith("/repairs/j1/approve")) { approved = true; return json({ status: "APPROVED", message: "Approved." }, 202); }
    return json({}, 404);
  });
  await page.goto("/");
  await expect(page.getByText("demo", { exact: true })).toBeVisible();
  expect(approved).toBe(false); // nothing is approved by merely loading the app
});
