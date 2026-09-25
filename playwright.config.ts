import { defineConfig, devices } from "@playwright/test";

// Default: the production build (pnpm build), served with vercel.json's headers.
// E2E_BASE_URL points the suite at anything else: `pnpm dev` (http://localhost:5173) or a deployment.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  // Each test drives two apps (store + checkout iframe); more workers just starve each other.
  workers: 2,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: external
    ? undefined
    : { command: "node scripts/serve.mjs", url: "http://localhost:4173", reuseExistingServer: true },
});
