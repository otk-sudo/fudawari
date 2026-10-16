"use client";

import type { ReactNode } from "react";

/**
 * 設定のウィンドウの中身（要件 3.6、roadmap T2-12、モック SettingsDialog.dc.html）。
 * レイアウトで `<SettingsDialog><SettingsContent /></SettingsDialog>` と差し込む。
 *
 * まだ中身がない（PR-08 第 2 段の先行テスト〔Red〕の型を通すための空の入れ物）。
 * 公開する形とテストが探す形は SettingsContent.test.tsx の冒頭にまとめてある。
 */
export function SettingsContent(): ReactNode {
  return null;
}
