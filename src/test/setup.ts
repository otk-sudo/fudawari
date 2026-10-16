// 単体テスト（Vitest）の共通の準備。vitest.config.mts の setupFiles から各テストファイルの前に読み込む
import "@testing-library/jest-dom/vitest";
// jsdom には IndexedDB がないため、メモリ上の IndexedDB を globalThis に用意する（Dexie のテスト用）
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals を使わない設定のため、Testing Library の自動の後片付けは働かない。テストごとに描画した部品を外す
afterEach(() => {
  cleanup();
});
