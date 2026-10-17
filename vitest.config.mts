import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// 単体テスト（Vitest）の設定。画面テスト（Playwright）は playwright.config.ts と e2e/ に分ける
export default defineConfig({
  // React の JSX・TSX を変換する
  plugins: [react()],
  resolve: {
    // `@/*` などの別名を tsconfig.json の paths から読む（tsconfig と二重に書かない）
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 単体テストは対象のファイルの隣に *.test.ts(x) で置く
    include: ["src/**/*.test.{ts,tsx}"],
    // e2e/ は Playwright の担当なので Vitest では読まない
    exclude: [...configDefaults.exclude, "e2e/**"],
    // 画面テストは全体を並べて流すと負荷で遅くなり、既定の 5 秒で時間切れになることがある（定義画面のテストで確認）。
    // 振る舞いを確かめる待ちは findBy・waitFor で行うので、1 件の上限だけを広げる
    testTimeout: 15_000,
    css: {
      // CSS は処理せず空にする。CSS Modules は import できて、クラス名は安定した文字列を返す
      include: [],
      modules: { classNameStrategy: "stable" },
    },
  },
});
