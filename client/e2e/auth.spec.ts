import { expect, test } from "@playwright/test";

// Registers a unique throw-away user per run (rd_e2e_<timestamp>@example.test);
// existing accounts are never touched.
const email = `rd_e2e_${Date.now()}@example.test`;
const password = "E2e-Test-Pass-77";

test.describe.configure({ mode: "serial" });

test("login form is labelled and validates empty input inline", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("RepoDoctor AI");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});

test("register rejects invalid input client-side and toggles password visibility", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill("bad");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
});

test("register, refresh, logout, wrong password, login, duplicate, expired token", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByText("Account created successfully.")).toBeVisible();
  await expect(page.getByText("E2E Tester")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You have been logged out.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-Pass-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid email or password");

  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Logged in successfully.")).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("token"));
  await page.reload();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Dup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");

  await page.evaluate(() => localStorage.setItem("token", "not-a-valid-jwt"));
  await page.reload();
  await expect(page.getByText("Your session has expired")).toBeVisible();
});

test("mobile layout has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
