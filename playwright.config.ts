import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// 画面テスト（Playwright）の設定。静的書き出し（out/）を serve で配信し、本番に近い形で確かめる

// ポートはワークツリー（作業フォルダ）ごとに変える。複数のワークツリーで同時に実行しても、
// 他のワークツリーの out/ を配信しているサーバーに当たらないようにするため。
// 環境変数 E2E_PORT で上書きできる
function portForThisWorktree(): number {
  const fromEnv = Number(process.env.E2E_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  const hash = createHash("sha1").update(process.cwd()).digest();
  return 4300 + (hash.readUInt16BE(0) % 600);
}

const PORT = portForThisWorktree();
// 127.0.0.1 だけで待ち受ける（LAN に公開しない）
const BASE_URL = `http://127.0.0.1:${PORT}`;
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
    // ビルドは `npm run test:e2e` が先に行う（package.json）。ここでは out/ を配信するだけにする
    command: `npx serve out -l tcp://127.0.0.1:${PORT}`,
    url: BASE_URL,
    // 起動済みのサーバーは使い回さない（別の out/ を配信しているかもしれないため）。
    // ポートが使用中なら Playwright がはっきり失敗する
    reuseExistingServer: false,
    timeout: 60_000,
    // serve の更新確認（npm レジストリへの通信）を止める
    env: { NO_UPDATE_CHECK: "1" },
  },
});
