import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next の既定の除外を上書きするため、既定の分も含めて並べる
  globalIgnores([
    // eslint-config-next の既定の除外
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // テストの生成物（Vitest のカバレッジ、Playwright の結果・レポート）
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
