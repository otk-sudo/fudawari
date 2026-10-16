import { defineConfig, devices } from "@playwright/test";

// 画面テスト（Playwright）の設定。静的書き出し（out/）を serve で配信し、本番に近い形で確かめる
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // CI で test.only が残っていたら失敗にする
  forbidOnly: isCI,
  // CI では一時的な失敗に備えて 1 回だけ再実行する。手元では再実行しない
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  // レポートは playwright-report/ に出す。手元で失敗してもブラウザを自動で開かない
  reporter: [
    [isCI ? "github" : "list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    // 再実行したときだけトレースを残す（CI の失敗の調査用）
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // ビルドは `npm run test:e2e` が先に行う（package.json）。ここでは out/ を配信するだけにする。
    // 手元で起動済みのサーバーを使い回しても、serve は out/ をその都度読むので、最新のビルドに対して実行される
    command: `npx serve out -l ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    // serve の更新確認（npm レジストリへの通信）を止める
    env: { NO_UPDATE_CHECK: "1" },
  },
});
