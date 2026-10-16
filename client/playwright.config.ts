import { defineConfig } from "@playwright/test";

// Browser tests run against an already running stack: the API plus the client
// (Compose: http://localhost:8080; local: `npm run dev` or `npm run build && npm run preview`, both on 8080).
// Override the client URL with E2E_BASE_URL.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
});
